"""Fetch user positions from Jupiter Lend API and store snapshots.

Jupiter Lend API endpoints used:
  - GET /lend/v1/earn/tokens — token metadata (prices, rates, symbols). Cached 3 min.
  - GET /lend/v1/earn/positions?users={wallet} — user share balances + underlying amounts
  - GET /lend/v1/earn/earnings?user={wallet}&positions={pos1},{pos2} — PnL per position

Helius RPC (HELIUS_RPC_URL):
  - getSignaturesForAddress on each position's ATA — first deposit timestamp (no REST alternative)

Helius RPC (HELIUS_RPC_URL env var) is used to resolve first-deposit timestamps, since
the Jupiter Lend REST API exposes no transaction history.
"""
import logging
import os
from datetime import datetime, timezone
from typing import Optional

import httpx
from solders.pubkey import Pubkey
from sqlalchemy.orm import Session

from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.models.base import SessionLocal
from app.models.user_position import TrackedWallet
from app.services.utils import (
    safe_float, get_or_none, cached, compute_realized_apy, load_opportunity_map,
    compute_held_days, build_position_dict, batch_earliest_snapshots,
)

logger = logging.getLogger(__name__)

JUPITER_LEND_API = "https://api.jup.ag/lend/v1"

_TOKEN_PROGRAM = Pubkey.from_string("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA")
_ATA_PROGRAM   = Pubkey.from_string("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bXo")

_float = safe_float
_cached = cached
_held_days = compute_held_days
_pos = build_position_dict


def _build_headers() -> dict[str, str]:
    key = os.getenv("JUPITER_API_KEY", "")
    headers: dict[str, str] = {}
    if key:
        headers["x-api-key"] = key
    return headers


def _get_ata(wallet: str, mint: str) -> str:
    """Derive the Associated Token Account address for a wallet + mint."""
    w, m = Pubkey.from_string(wallet), Pubkey.from_string(mint)
    ata, _ = Pubkey.find_program_address(
        [bytes(w), bytes(_TOKEN_PROGRAM), bytes(m)], _ATA_PROGRAM,
    )
    return str(ata)


def _first_deposit_ts(
    wallet: str, mint: str, helius_url: str, client: httpx.Client,
) -> Optional[datetime]:
    """Return the timestamp of the wallet's first jlToken receipt via Helius RPC.

    Paginate getSignaturesForAddress on the ATA (newest-first) to find the oldest
    transaction = initial deposit. Result cached 1 h since it never changes.
    """
    def _fetch() -> Optional[int]:
        ata = _get_ata(wallet, mint)
        before: Optional[str] = None
        oldest_block_time: Optional[int] = None
        while True:
            params: dict = {"limit": 1000, "commitment": "confirmed"}
            if before:
                params["before"] = before
            try:
                r = client.post(
                    helius_url,
                    json={"jsonrpc": "2.0", "id": 1,
                          "method": "getSignaturesForAddress",
                          "params": [ata, params]},
                    timeout=30,
                )
                r.raise_for_status()
                sigs = r.json().get("result") or []
            except Exception as exc:
                logger.warning("Helius getSignaturesForAddress %s: %s", ata[:12], exc)
                break
            if not sigs:
                break
            oldest_block_time = sigs[-1].get("blockTime")
            if len(sigs) < 1000:
                break
            before = sigs[-1]["signature"]
        return oldest_block_time

    block_time = _cached(f"jup_opened_{wallet[:8]}_{mint[:8]}", 3600, _fetch)
    return datetime.fromtimestamp(block_time, tz=timezone.utc) if block_time else None



def _get_earn_tokens(client: httpx.Client) -> list[dict]:
    """Fetch earn token metadata (cached 3 min)."""
    def _fetch():
        data = get_or_none(f"{JUPITER_LEND_API}/earn/tokens", client, log_label="Jupiter Lend API")
        return data if isinstance(data, list) else []
    return _cached("jup_earn_tokens", 180, _fetch)


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout)),
    reraise=False,
)
def _get_earn_positions(client: httpx.Client, wallet: str):
    """GET /earn/positions for one wallet with tenacity retry."""
    r = client.get(f"{JUPITER_LEND_API}/earn/positions", params={"users": wallet}, timeout=30)
    r.raise_for_status()
    return r.json()


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout)),
    reraise=False,
)
def _get_earn_earnings(client: httpx.Client, wallet: str, position_ids: list[str]):
    """GET /earn/earnings for a set of position IDs with tenacity retry."""
    r = client.get(
        f"{JUPITER_LEND_API}/earn/earnings",
        params={"user": wallet, "positions": ",".join(position_ids)},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Earn positions
# ---------------------------------------------------------------------------

def _fetch_earn_positions(
    wallet: str, client: httpx.Client, db: Session, now: datetime,
    helius_url: str = "",
    opp_map: dict | None = None,
) -> list[dict]:
    """Fetch Jupiter Lend earn positions for a wallet.

    1. GET /earn/tokens → token metadata (prices, symbols) — cached 3 min
    2. GET /earn/positions?users={wallet} → share balances + underlying
    3. GET /earn/earnings?user={wallet}&positions={...} → PnL
    4. Helius RPC getSignaturesForAddress → first deposit timestamp (if HELIUS_RPC_URL set)
    """
    tokens_list = _get_earn_tokens(client)
    token_map: dict[str, dict] = {}
    for token in tokens_list:
        asset_address = token.get("assetAddress", "")
        if not asset_address:
            continue
        asset = token.get("asset", {})
        token_map[asset_address] = {
            "symbol": asset.get("uiSymbol", asset.get("symbol", "")),
            "decimals": asset.get("decimals", 6),
            "price": _float(asset.get("price")),
            "total_rate_bps": _float(token.get("totalRate")),
        }

    positions_data = _get_earn_positions(client, wallet)
    if not isinstance(positions_data, list) or not positions_data:
        if positions_data is None:
            logger.warning("Jupiter /earn/positions failed for %s", wallet[:8])
        return []

    position_ids = []
    positions_by_asset: dict[str, dict] = {}
    for pos in positions_data:
        asset_address = pos.get("token", {}).get("assetAddress", "")
        if not asset_address:
            continue
        shares = _float(pos.get("shares"))
        if not shares or shares <= 0:
            continue
        positions_by_asset[asset_address] = pos
        position_ids.append(asset_address)

    earnings_map: dict[str, float] = {}
    if position_ids:
        earnings_data = _get_earn_earnings(client, wallet, position_ids)
        if earnings_data is None:
            logger.warning("Jupiter /earn/earnings failed for %s", wallet[:8])
        elif isinstance(earnings_data, list):
            for e in earnings_data:
                addr = e.get("address", e.get("assetAddress", ""))
                raw = e.get("earningsUsd") if e.get("earningsUsd") is not None else e.get("earnings")
                val = _float(raw)
                if addr and val is not None:
                    earnings_map[addr] = val
        elif isinstance(earnings_data, dict):
            for addr, val in earnings_data.items():
                parsed = _float(val) if not isinstance(val, dict) else _float(val.get("usd", val.get("earnings")))
                if parsed is not None:
                    earnings_map[addr] = parsed

    _omap = opp_map if opp_map is not None else load_opportunity_map(db)
    earliest_map = batch_earliest_snapshots(db, wallet)
    results = []
    for asset_address, pos in positions_by_asset.items():
        token_info = token_map.get(asset_address, {})
        decimals = token_info.get("decimals", 6)
        price = token_info.get("price")

        underlying_raw = _float(pos.get("underlyingAssets"))
        if underlying_raw is None or underlying_raw <= 0:
            continue
        underlying_amount = underlying_raw / 10**decimals

        deposit_amount_usd = underlying_amount * price if price else None
        if deposit_amount_usd is None or deposit_amount_usd < 0.01:
            continue

        pnl_usd = earnings_map.get(asset_address)
        initial_deposit_usd = None
        pnl_pct = None
        if pnl_usd is not None and deposit_amount_usd:
            initial_deposit_usd = deposit_amount_usd - pnl_usd
            if initial_deposit_usd > 0:
                pnl_pct = (pnl_usd / initial_deposit_usd) * 100

        entry = _omap.get(asset_address)
        opportunity_id = entry["id"] if entry else None
        apy = entry["apy_current"] if entry else None
        if apy is None:
            rate_bps = token_info.get("total_rate_bps")
            if rate_bps is not None:
                apy = rate_bps / 100

        opened_at = _first_deposit_ts(wallet, asset_address, helius_url, client) if helius_url else None
        if opened_at is None:
            opened_at = earliest_map.get(asset_address)
        held_days = _held_days(opened_at, now)

        results.append(_pos(
            wallet_address=wallet, protocol_slug="jupiter",
            product_type="earn", external_id=asset_address,
            snapshot_at=now, opportunity_id=opportunity_id,
            deposit_amount=underlying_amount, deposit_amount_usd=deposit_amount_usd,
            pnl_usd=pnl_usd, pnl_pct=pnl_pct,
            initial_deposit_usd=initial_deposit_usd,
            opened_at=opened_at, held_days=held_days, apy=apy,
            token_symbol=token_info.get("symbol", ""),
            extra_data={
                "shares": _float(pos.get("shares")),
                "underlying_amount": underlying_amount,
                "mint": asset_address, "source": "jupiter_api",
            },
        ))

    return results


def _fetch_multiply_positions(
    wallet: str, client: httpx.Client, db: Session, now: datetime,
) -> list[dict]:
    """Stub — Jupiter multiply/borrow position REST API not yet available."""
    logger.debug("Jupiter multiply positions: REST API not yet available, skipping")
    return []


# ---------------------------------------------------------------------------
# Transaction events (stub)
# ---------------------------------------------------------------------------

def fetch_wallet_events(wallet: str, client: httpx.Client) -> list[dict]:
    """Stub — Jupiter Lend does not yet expose a transaction history API."""
    return []


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_wallet_positions(wallet_address: str, db: Session) -> dict:
    """Fetch current Jupiter Lend positions for a wallet."""
    now = datetime.now(timezone.utc)
    headers = _build_headers()
    helius_url = os.getenv("HELIUS_RPC_URL", "")
    opp_map = load_opportunity_map(db)

    with httpx.Client(headers=headers) as client:
        earn_positions = _fetch_earn_positions(
            wallet_address, client, db, now, helius_url=helius_url, opp_map=opp_map,
        )
        multiply_positions = _fetch_multiply_positions(wallet_address, client, db, now)

    all_positions = earn_positions + multiply_positions

    total_value_usd = sum(_float(p.get("deposit_amount_usd")) or 0 for p in all_positions)
    total_pnl_usd = sum(_float(p.get("pnl_usd")) or 0 for p in all_positions if p.get("pnl_usd") is not None)

    return {
        "wallet": wallet_address,
        "positions": all_positions,
        "summary": {
            "total_value_usd": total_value_usd,
            "total_pnl_usd": total_pnl_usd,
            "position_count": len(all_positions),
        },
    }


# ---------------------------------------------------------------------------
# Background job: snapshot all tracked wallets
# ---------------------------------------------------------------------------

def snapshot_all_wallets(db: Session, snapshot_at: datetime | None = None) -> int:
    """Iterate all active TrackedWallets, fetch Jupiter positions, store snapshots."""
    wallets = (
        db.query(TrackedWallet)
        .filter(TrackedWallet.is_active.is_(True))
        .all()
    )
    if not wallets:
        return 0

    logger.info("Jupiter position snapshot: %d wallets", len(wallets))
    now = snapshot_at or datetime.now(timezone.utc)
    total_snapshots = 0
    headers = _build_headers()
    helius_url = os.getenv("HELIUS_RPC_URL", "")
    opp_map = load_opportunity_map(db)

    with httpx.Client(headers=headers) as client:
        for wallet in wallets:
            try:
                earn_positions = _fetch_earn_positions(
                    wallet.wallet_address, client, db, now,
                    helius_url=helius_url, opp_map=opp_map,
                )
                from app.services.utils import store_position_rows
                total_snapshots += store_position_rows(db, earn_positions, now)

                db.flush()
                logger.info(
                    "Jupiter wallet %s: %d positions",
                    wallet.wallet_address[:8],
                    len(earn_positions),
                )
            except Exception as exc:
                logger.error(
                    "Jupiter snapshot failed for %s: %s",
                    wallet.wallet_address[:8],
                    exc,
                )
                continue

    db.commit()
    logger.info("Jupiter position snapshot complete: %d snapshots", total_snapshots)
    return total_snapshots


