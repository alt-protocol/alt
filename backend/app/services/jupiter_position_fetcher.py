"""Fetch user positions from Jupiter Lend API and store snapshots.

Jupiter Lend API endpoints used:
  - GET /lend/v1/earn/tokens — token metadata (prices, rates, symbols). Cached 3 min.
  - GET /lend/v1/earn/positions?users={wallet} — user share balances + underlying amounts
  - GET /lend/v1/earn/earnings?user={wallet}&positions={pos1},{pos2} — PnL per position
"""
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.models.base import SessionLocal
from app.models.user_position import TrackedWallet
from app.models.yield_opportunity import YieldOpportunity
from app.services.utils import safe_float, cached

logger = logging.getLogger(__name__)

JUPITER_LEND_API = "https://api.jup.ag/lend/v1"


_float = safe_float
_cached = cached


def _build_headers() -> dict[str, str]:
    import os
    key = os.getenv("JUPITER_API_KEY", "")
    headers: dict[str, str] = {}
    if key:
        headers["x-api-key"] = key
    return headers


def _get_earn_tokens(client: httpx.Client) -> list[dict]:
    """Fetch earn token metadata (cached 3 min)."""
    def _fetch():
        try:
            r = client.get(f"{JUPITER_LEND_API}/earn/tokens", timeout=30)
            r.raise_for_status()
            data = r.json()
            return data if isinstance(data, list) else []
        except Exception as exc:
            logger.warning("Jupiter /earn/tokens failed: %s", exc)
            return []
    return _cached("jup_earn_tokens", 180, _fetch)


def _match_opportunity(deposit_address: str, db: Session) -> Optional[int]:
    """Link a position to a YieldOpportunity by deposit_address (asset mint)."""
    opp = (
        db.query(YieldOpportunity.id)
        .filter(
            YieldOpportunity.deposit_address == deposit_address,
            YieldOpportunity.is_active.is_(True),
        )
        .first()
    )
    return opp.id if opp else None


def _lookup_opportunity_apy(deposit_address: str, db: Session) -> Optional[float]:
    """Get current APY from yield_opportunities for fallback."""
    opp = (
        db.query(YieldOpportunity.apy_current)
        .filter(
            YieldOpportunity.deposit_address == deposit_address,
            YieldOpportunity.is_active.is_(True),
        )
        .first()
    )
    if opp and opp.apy_current is not None:
        return float(opp.apy_current)
    return None


# ---------------------------------------------------------------------------
# Earn positions
# ---------------------------------------------------------------------------

def _fetch_earn_positions(
    wallet: str, client: httpx.Client, db: Session, now: datetime,
) -> list[dict]:
    """Fetch Jupiter Lend earn positions for a wallet.

    1. GET /earn/tokens → token metadata (prices, symbols)
    2. GET /earn/positions?users={wallet} → share balances + underlying
    3. GET /earn/earnings?user={wallet}&positions={...} → PnL
    """
    # Step 1: token metadata (cached)
    tokens_list = _get_earn_tokens(client)
    # Build lookup: asset_address → token info
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

    # Step 2: positions
    try:
        r = client.get(
            f"{JUPITER_LEND_API}/earn/positions",
            params={"users": wallet},
            timeout=30,
        )
        r.raise_for_status()
        positions_data = r.json()
    except Exception as exc:
        logger.warning("Jupiter /earn/positions failed for %s: %s", wallet[:8], exc)
        return []

    if not isinstance(positions_data, list) or not positions_data:
        return []

    # Step 3: earnings — collect position IDs for the earnings call
    # The positions response contains objects with assetAddress and position data
    position_ids = []
    positions_by_asset: dict[str, dict] = {}
    for pos in positions_data:
        token_obj = pos.get("token", {})
        asset_address = token_obj.get("assetAddress", "")
        if not asset_address:
            continue
        shares = _float(pos.get("shares"))
        if not shares or shares <= 0:
            continue  # skip zero-balance positions
        positions_by_asset[asset_address] = pos
        position_ids.append(asset_address)

    earnings_map: dict[str, float] = {}
    if position_ids:
        try:
            r = client.get(
                f"{JUPITER_LEND_API}/earn/earnings",
                params={
                    "user": wallet,
                    "positions": ",".join(position_ids),
                },
                timeout=30,
            )
            r.raise_for_status()
            earnings_data = r.json()
            # Response may be a list of {assetAddress, earnings} or a dict
            if isinstance(earnings_data, list):
                for e in earnings_data:
                    addr = e.get("address", e.get("assetAddress", ""))
                    val = _float(e.get("earnings")) or _float(e.get("earningsUsd"))
                    if addr and val is not None:
                        earnings_map[addr] = val
            elif isinstance(earnings_data, dict):
                for addr, val in earnings_data.items():
                    parsed = _float(val) if not isinstance(val, dict) else _float(val.get("usd", val.get("earnings")))
                    if parsed is not None:
                        earnings_map[addr] = parsed
        except Exception as exc:
            logger.warning("Jupiter /earn/earnings failed for %s: %s", wallet[:8], exc)

    # Build position dicts
    results = []
    for asset_address, pos in positions_by_asset.items():
        token_info = token_map.get(asset_address, {})
        symbol = token_info.get("symbol", "")
        decimals = token_info.get("decimals", 6)
        price = token_info.get("price")

        # Extract amounts from position
        underlying_raw = _float(pos.get("underlyingAssets"))
        if underlying_raw is None or underlying_raw <= 0:
            continue
        underlying_amount = underlying_raw / 10**decimals
        shares = _float(pos.get("shares"))

        if underlying_amount is None or underlying_amount <= 0:
            continue

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

        opportunity_id = _match_opportunity(asset_address, db)
        apy = _lookup_opportunity_apy(asset_address, db)

        # Fallback APY from token metadata
        if apy is None:
            rate_bps = token_info.get("total_rate_bps")
            if rate_bps is not None:
                apy = rate_bps / 100

        results.append({
            "wallet_address": wallet,
            "protocol_slug": "jupiter",
            "product_type": "earn",
            "external_id": asset_address,
            "opportunity_id": opportunity_id,
            "deposit_amount": underlying_amount,
            "deposit_amount_usd": round(deposit_amount_usd, 2) if deposit_amount_usd else None,
            "pnl_usd": round(pnl_usd, 2) if pnl_usd is not None else None,
            "pnl_pct": round(pnl_pct, 4) if pnl_pct is not None else None,
            "initial_deposit_usd": round(initial_deposit_usd, 2) if initial_deposit_usd else None,
            "opened_at": None,
            "held_days": None,
            "apy": apy,
            "is_closed": False,
            "closed_at": None,
            "close_value_usd": None,
            "token_symbol": symbol,
            "extra_data": {
                "shares": shares,
                "underlying_amount": underlying_amount,
                "mint": asset_address,
                "source": "jupiter_api",
            },
        })

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

    with httpx.Client(headers=headers) as client:
        earn_positions = _fetch_earn_positions(wallet_address, client, db, now)
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

    with httpx.Client(headers=headers) as client:
        for wallet in wallets:
            try:
                earn_positions = _fetch_earn_positions(
                    wallet.wallet_address, client, db, now,
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


def snapshot_all_wallets_job():
    """APScheduler entry point — creates its own DB session."""
    logger.info("Starting Jupiter position snapshot job")
    db: Session = SessionLocal()
    try:
        count = snapshot_all_wallets(db)
        logger.info("Jupiter position snapshot job complete: %d snapshots", count)
    except Exception as exc:
        db.rollback()
        logger.error("Jupiter position snapshot job failed: %s", exc)
    finally:
        db.close()
