"""Fetch user positions from Drift Protocol and store snapshots.

Drift API endpoints used (base: https://data.api.drift.trade):
  - GET /authority/{wallet}/insuranceFundStake — IF stake events (last 31 days)
  - GET /authority/{wallet}/insuranceFundStake/{year}/{month} — historical IF events
  - GET /stats/insuranceFund — IF pool APYs
  - GET /stats/spotMarketAccounts — on-chain IF vault totals
  - GET /authority/{wallet}/snapshots/vaults?days={1,100} — strategy vault snapshots (multi-window)
"""
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from app.models.base import SessionLocal
from app.models.user_position import TrackedWallet
from app.services.utils import (
    safe_float, get_or_none, cached, parse_timestamp, compute_realized_apy,
    load_opportunity_map, compute_held_days, build_position_dict,
    store_events_batch,
)

logger = logging.getLogger(__name__)

DRIFT_API = "https://data.api.drift.trade"


def _get(path: str, client: httpx.Client) -> Optional[dict | list]:
    return get_or_none(f"{DRIFT_API}{path}", client, log_label="Drift API")


_float = safe_float
_cached = cached
_parse_timestamp = parse_timestamp
_held_days = compute_held_days
_pos = build_position_dict


# ---------------------------------------------------------------------------
# IF pool state (shared across all wallets)
# ---------------------------------------------------------------------------

def _get_if_pool_apys(client: httpx.Client) -> dict[int, float]:
    """Fetch IF pool APYs: {marketIndex: apy_pct}."""
    def _fetch():
        data = _get("/stats/insuranceFund", client)
        if not isinstance(data, dict):
            return {}
        result = {}
        for entry in data.get("marketSharePriceData", []):
            idx = entry.get("marketIndex")
            apy = _float(entry.get("apy"))
            if idx is not None and apy is not None:
                result[idx] = apy
        return result
    return _cached("drift_if_apys", 300, _fetch)


# ---------------------------------------------------------------------------
# Insurance Fund positions
# ---------------------------------------------------------------------------

def _fetch_if_events(
    wallet: str, client: httpx.Client,
) -> list[dict]:
    """Fetch IF stake events. Tries recent 31 days first, then goes back month by month."""
    raw = _get(f"/authority/{wallet}/insuranceFundStake", client)
    events = raw.get("records", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
    if events:
        return events

    # Search backwards month by month (up to 6 months)
    now = datetime.now(timezone.utc)
    all_events = []
    for months_back in range(0, 7):
        year = now.year
        month = now.month - months_back
        while month <= 0:
            month += 12
            year -= 1
        raw = _get(f"/authority/{wallet}/insuranceFundStake/{year}/{month}", client)
        monthly = raw.get("records", []) if isinstance(raw, dict) else (raw if isinstance(raw, list) else [])
        if monthly:
            all_events.extend(monthly)

    return all_events


def _fetch_if_positions(
    wallet: str, client: httpx.Client, db: Session, now: datetime,
    opp_map: dict | None = None,
) -> tuple[list[dict], list[dict]]:
    """Fetch Insurance Fund staking positions. Returns (positions, events)."""
    events = _fetch_if_events(wallet, client)
    if not events:
        return [], []

    if_apys = _get_if_pool_apys(client)

    # Group events by marketIndex, keep latest per market
    by_market: dict[int, list[dict]] = defaultdict(list)
    for evt in events:
        idx = evt.get("marketIndex")
        if idx is not None:
            by_market[idx].append(evt)

    positions = []
    position_events = []

    for market_index, market_events in by_market.items():
        market_events.sort(key=lambda e: e.get("ts", 0))
        latest = market_events[-1]

        shares_after = _float(latest.get("ifSharesAfter")) or 0.0
        if shares_after < 0.001:
            # Position is closed — still record events but skip position
            for evt in market_events:
                position_events.append(_if_event_to_record(evt, wallet))
            continue

        symbol = latest.get("symbol", f"MARKET-{market_index}")
        external_id = f"drift-if-{market_index}"

        # Current value: proportional share of IF vault (stablecoins — token units ≈ USD).
        total_shares_ev = _float(latest.get("totalIfSharesAfter"))
        vault_amount_ev = _float(latest.get("insuranceVaultAmountBefore"))
        deposit_amount_usd = (
            (shares_after / total_shares_ev) * vault_amount_ev
            if total_shares_ev and total_shares_ev > 0 and vault_amount_ev
            else None
        )

        total_staked = 0.0
        total_unstaked = 0.0
        opened_at = None
        for evt in market_events:
            action = (evt.get("action") or "").lower()
            amount = _float(evt.get("amount")) or 0.0
            if action == "stake":
                total_staked += amount
                if opened_at is None:
                    opened_at = _parse_timestamp(evt.get("ts"))
            elif action in ("unstake", "unstakerequest"):
                total_unstaked += amount

        net_staked = total_staked - total_unstaked
        initial_deposit_usd = net_staked if net_staked > 0 else total_staked

        pnl_usd = (deposit_amount_usd - initial_deposit_usd) if deposit_amount_usd is not None and initial_deposit_usd > 0 else None
        pnl_pct = (pnl_usd / initial_deposit_usd * 100) if pnl_usd is not None else None
        held_days = _held_days(opened_at, now)

        apy = if_apys.get(market_index)

        _omap = opp_map if opp_map is not None else load_opportunity_map(db)
        entry = _omap.get(external_id)
        opportunity_id = entry["id"] if entry else None
        if apy is None and entry:
            apy = entry["apy_current"]

        positions.append(_pos(
            wallet_address=wallet, protocol_slug="drift",
            product_type="insurance_fund", external_id=external_id,
            snapshot_at=now, opportunity_id=opportunity_id,
            deposit_amount=shares_after, deposit_amount_usd=deposit_amount_usd,
            pnl_usd=pnl_usd, pnl_pct=pnl_pct,
            initial_deposit_usd=initial_deposit_usd,
            opened_at=opened_at, held_days=held_days, apy=apy,
            token_symbol=symbol,
            extra_data={
                "if_shares": shares_after, "market_index": market_index,
                "symbol": symbol, "total_staked": total_staked,
                "total_unstaked": total_unstaked,
            },
        ))

        for evt in market_events:
            position_events.append(_if_event_to_record(evt, wallet))

    return positions, position_events


def _if_event_to_record(evt: dict, wallet: str) -> dict:
    """Convert a Drift IF stake event to UserPositionEvent format."""
    action = (evt.get("action") or "unknown").lower()
    market_index = evt.get("marketIndex", 0)
    return {
        "wallet_address": wallet,
        "protocol_slug": "drift",
        "product_type": "insurance_fund",
        "external_id": f"drift-if-{market_index}",
        "event_type": action,
        "amount": _float(evt.get("amount")),
        "amount_usd": _float(evt.get("amount")),  # IF stakes are in the token itself
        "tx_signature": evt.get("txSig"),
        "event_at": _parse_timestamp(evt.get("ts")) or datetime.now(timezone.utc),
        "extra_data": {
            "symbol": evt.get("symbol"),
            "market_index": market_index,
            "if_shares_before": _float(evt.get("ifSharesBefore")),
            "if_shares_after": _float(evt.get("ifSharesAfter")),
        },
    }


# ---------------------------------------------------------------------------
# Strategy Vault positions
# ---------------------------------------------------------------------------

def _fetch_vault_positions(
    wallet: str, client: httpx.Client, db: Session, now: datetime,
    opp_map: dict | None = None,
) -> list[dict]:
    """Fetch Strategy Vault positions from daily snapshots.

    Fetches from multiple time windows (1 day + 100 days) because the Drift API
    partitions data differently by time range — recent vaults may only appear in
    short windows. Deduplicates and filters stale positions.
    """
    STALE_DAYS = 7

    # Fetch from multiple windows to catch both recent and historical vaults
    by_vault: dict[str, list[dict]] = defaultdict(list)
    seen_keys: set[tuple[str, Any]] = set()  # (vault, ts) for dedup

    for days in (1, 100):
        raw = _get(f"/authority/{wallet}/snapshots/vaults?days={days}", client)
        if not isinstance(raw, dict):
            continue
        for account in raw.get("accounts", []):
            for snap in account.get("snapshots", []):
                vault = snap.get("vault")
                if not vault:
                    continue
                dedup_key = (vault, snap.get("ts"))
                if dedup_key in seen_keys:
                    continue
                seen_keys.add(dedup_key)
                by_vault[vault].append(snap)

    if not by_vault:
        return []

    positions = []
    for vault_pubkey, snapshots in by_vault.items():
        snapshots.sort(key=lambda s: s.get("ts", 0))
        latest = snapshots[-1]

        # Skip stale positions — user likely withdrew
        latest_ts = _parse_timestamp(latest.get("ts"))
        if latest_ts and (now - latest_ts).total_seconds() > STALE_DAYS * 86400:
            logger.info("Skipping stale vault %s (last snapshot %s)", vault_pubkey[:12], latest_ts)
            continue

        total_value = _float(latest.get("totalAccountValue")) or 0.0
        if total_value <= 0:
            continue

        net_deposits = _float(latest.get("netDeposits")) or 0.0
        market_index = latest.get("marketIndex")

        pnl_usd = total_value - net_deposits
        pnl_pct = (pnl_usd / net_deposits * 100) if net_deposits > 0 else None

        external_id = f"drift-vault-{vault_pubkey}"

        _omap = opp_map if opp_map is not None else load_opportunity_map(db)
        entry = _omap.get(vault_pubkey) or _omap.get(external_id)
        opportunity_id = entry["id"] if entry else None
        apy = entry["apy_current"] if entry else None
        token_symbol = entry["first_token"] if entry else None

        if not token_symbol:
            token_symbol = f"MARKET-{market_index}" if market_index is not None else None

        # Estimate opened_at from earliest snapshot
        opened_at = _parse_timestamp(snapshots[0].get("ts"))
        held_days = _held_days(opened_at, now)

        positions.append(_pos(
            wallet_address=wallet, protocol_slug="drift",
            product_type="earn_vault", external_id=external_id,
            snapshot_at=now, opportunity_id=opportunity_id,
            deposit_amount=total_value, deposit_amount_usd=total_value,
            pnl_usd=pnl_usd, pnl_pct=pnl_pct,
            initial_deposit_usd=net_deposits if net_deposits > 0 else None,
            opened_at=opened_at, held_days=held_days, apy=apy,
            token_symbol=token_symbol,
            extra_data={
                "vault_pubkey": vault_pubkey, "market_index": market_index,
                "net_deposits": net_deposits,
                "total_account_value": total_value,
                "total_account_base_value": _float(latest.get("totalAccountBaseValue")),
            },
        ))

    return positions


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_wallet_positions(wallet_address: str, db: Session) -> dict:
    """Fetch all Drift positions for a wallet. Returns dict with positions list."""
    now = datetime.now(timezone.utc)
    opp_map = load_opportunity_map(db)

    with httpx.Client() as client:
        if_positions, if_events = _fetch_if_positions(wallet_address, client, db, now, opp_map=opp_map)
        vault_positions = _fetch_vault_positions(wallet_address, client, db, now, opp_map=opp_map)

    all_positions = if_positions + vault_positions

    total_value_usd = sum(_float(p.get("deposit_amount_usd")) or 0 for p in all_positions)
    total_pnl_usd = sum(_float(p.get("pnl_usd")) or 0 for p in all_positions if p.get("pnl_usd") is not None)

    return {
        "wallet": wallet_address,
        "positions": all_positions,
        "events": if_events,
        "summary": {
            "total_value_usd": total_value_usd,
            "total_pnl_usd": total_pnl_usd,
            "position_count": len(all_positions),
        },
    }


def fetch_wallet_events(wallet_address: str) -> list[dict]:
    """Fetch IF stake/unstake events for a wallet."""
    with httpx.Client() as client:
        events = _fetch_if_events(wallet_address, client)

    return [_if_event_to_record(evt, wallet_address) for evt in events]


# ---------------------------------------------------------------------------
# Background job: snapshot all tracked wallets
# ---------------------------------------------------------------------------

def snapshot_all_wallets(db: Session, snapshot_at: datetime | None = None) -> int:
    """Iterate all active TrackedWallets, fetch Drift positions, store snapshots."""
    wallets = (
        db.query(TrackedWallet)
        .filter(TrackedWallet.is_active.is_(True))
        .all()
    )
    if not wallets:
        logger.info("No tracked wallets for Drift snapshot")
        return 0

    logger.info("Snapshotting Drift positions for %d wallets", len(wallets))
    now = snapshot_at or datetime.now(timezone.utc)
    total_snapshots = 0
    opp_map = load_opportunity_map(db)

    with httpx.Client() as client:
        _get_if_pool_apys(client)

        for wallet in wallets:
            try:
                if_positions, if_events = _fetch_if_positions(
                    wallet.wallet_address, client, db, now, opp_map=opp_map,
                )
                vault_positions = _fetch_vault_positions(
                    wallet.wallet_address, client, db, now, opp_map=opp_map,
                )
                all_positions = if_positions + vault_positions

                from app.services.utils import store_position_rows
                total_snapshots += store_position_rows(db, all_positions, now)

                store_events_batch(db, if_events)

                wallet.last_fetched_at = now
                db.flush()

                logger.info(
                    "Drift wallet %s: %d positions snapshotted",
                    wallet.wallet_address[:8],
                    len(all_positions),
                )

            except Exception as exc:
                logger.error(
                    "Failed to snapshot Drift wallet %s: %s",
                    wallet.wallet_address[:8],
                    exc,
                )
                continue

    db.commit()
    logger.info("Drift position snapshot complete: %d total snapshots", total_snapshots)
    return total_snapshots


