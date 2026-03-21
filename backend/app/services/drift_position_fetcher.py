"""Fetch user positions from Drift Protocol and store snapshots.

Drift API endpoints used (base: https://data.api.drift.trade):
  - GET /authority/{wallet}/insuranceFundStake — IF stake events (last 31 days)
  - GET /authority/{wallet}/insuranceFundStake/{year}/{month} — historical IF events
  - GET /stats/insuranceFund — IF pool APYs
  - GET /stats/spotMarketAccounts — on-chain IF vault totals
  - GET /authority/{wallet}/snapshots/vaults?days={1,100} — strategy vault snapshots (multi-window)
"""
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from app.models.base import SessionLocal
from app.models.user_position import TrackedWallet, UserPosition, UserPositionEvent
from app.models.yield_opportunity import YieldOpportunity

logger = logging.getLogger(__name__)

DRIFT_API = "https://data.api.drift.trade"

# ---------------------------------------------------------------------------
# Simple TTL cache
# ---------------------------------------------------------------------------
_cache: dict[str, tuple[float, Any]] = {}


def _cached(key: str, ttl: float, fn):
    now = time.monotonic()
    if key in _cache and (now - _cache[key][0]) < ttl:
        return _cache[key][1]
    result = fn()
    if result is not None:
        _cache[key] = (now, result)
    return result


def _get(path: str, client: httpx.Client) -> Optional[dict | list]:
    try:
        r = client.get(f"{DRIFT_API}{path}", timeout=30)
        r.raise_for_status()
        return r.json()
    except Exception as exc:
        logger.warning("Drift API %s failed: %s", path, exc)
        return None


def _float(val) -> Optional[float]:
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _parse_timestamp(ts) -> Optional[datetime]:
    if ts is None:
        return None
    try:
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except (ValueError, OSError):
        return None


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _match_opportunity_by_external(external_id: str, db: Session) -> Optional[tuple[int, float | None]]:
    """Find YieldOpportunity by external_id. Returns (id, apy) or None."""
    opp = (
        db.query(YieldOpportunity.id, YieldOpportunity.apy_current)
        .filter(
            YieldOpportunity.external_id == external_id,
            YieldOpportunity.is_active.is_(True),
        )
        .first()
    )
    if opp:
        return opp.id, float(opp.apy_current) if opp.apy_current is not None else None
    return None


def _match_opportunity_by_deposit_address(deposit_address: str, db: Session) -> Optional[tuple[int, float | None, str | None]]:
    """Find YieldOpportunity by deposit_address. Returns (id, apy, first_token) or None."""
    opp = (
        db.query(YieldOpportunity.id, YieldOpportunity.apy_current, YieldOpportunity.tokens)
        .filter(
            YieldOpportunity.deposit_address == deposit_address,
            YieldOpportunity.is_active.is_(True),
        )
        .first()
    )
    if opp:
        first_token = opp.tokens[0] if opp.tokens else None
        return opp.id, float(opp.apy_current) if opp.apy_current is not None else None, first_token
    return None


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


def _get_spot_market_accounts(client: httpx.Client) -> dict[int, dict]:
    """Fetch spot market accounts for IF vault balances: {marketIndex: {...}}."""
    def _fetch():
        data = _get("/stats/spotMarketAccounts", client)
        if not isinstance(data, list):
            return {}
        result = {}
        for acct in data:
            idx = acct.get("marketIndex")
            if idx is not None:
                result[idx] = acct
        return result
    return _cached("drift_spot_markets", 300, _fetch)


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
) -> tuple[list[dict], list[dict]]:
    """Fetch Insurance Fund staking positions.

    Returns (positions, events).
    """
    events = _fetch_if_events(wallet, client)
    if not events:
        return [], []

    # Get pool APYs and spot market accounts
    if_apys = _get_if_pool_apys(client)
    spot_accounts = _get_spot_market_accounts(client)

    # Group events by marketIndex, keep latest per market
    by_market: dict[int, list[dict]] = defaultdict(list)
    for evt in events:
        idx = evt.get("marketIndex")
        if idx is not None:
            by_market[idx].append(evt)

    positions = []
    position_events = []

    for market_index, market_events in by_market.items():
        # Sort by timestamp ascending
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

        # Compute USD value from spot market accounts (fresh pool state)
        deposit_amount_usd = None
        spot_acct = spot_accounts.get(market_index, {})
        if spot_acct:
            # Insurance fund vault balance and total shares from on-chain state
            # The spot market account has insuranceFund data
            if_data = spot_acct.get("insuranceFund", {})
            total_shares = _float(if_data.get("totalShares"))
            vault_balance = _float(if_data.get("revenueSettleBalance"))

            # Fallback: use event-level approximation
            if total_shares and total_shares > 0 and vault_balance:
                deposit_amount_usd = (shares_after / total_shares) * vault_balance

        # Fallback: approximate from last event data
        if deposit_amount_usd is None:
            total_shares_after = _float(latest.get("totalIfSharesAfter"))
            vault_amount = _float(latest.get("insuranceVaultAmountBefore"))
            if total_shares_after and total_shares_after > 0 and vault_amount:
                deposit_amount_usd = (shares_after / total_shares_after) * vault_amount

        # Compute net staked from events
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

        pnl_usd = None
        pnl_pct = None
        if deposit_amount_usd is not None and initial_deposit_usd > 0:
            pnl_usd = deposit_amount_usd - initial_deposit_usd
            pnl_pct = (pnl_usd / initial_deposit_usd) * 100

        held_days = None
        if opened_at:
            held_days = (now - opened_at).total_seconds() / 86400.0

        apy = if_apys.get(market_index)

        # Match to YieldOpportunity
        opportunity_id = None
        match = _match_opportunity_by_external(external_id, db)
        if match:
            opportunity_id, db_apy = match
            if apy is None and db_apy is not None:
                apy = db_apy

        positions.append({
            "wallet_address": wallet,
            "protocol_slug": "drift",
            "product_type": "insurance_fund",
            "external_id": external_id,
            "opportunity_id": opportunity_id,
            "deposit_amount": shares_after,
            "deposit_amount_usd": round(deposit_amount_usd, 2) if deposit_amount_usd else None,
            "pnl_usd": round(pnl_usd, 2) if pnl_usd is not None else None,
            "pnl_pct": round(pnl_pct, 4) if pnl_pct is not None else None,
            "initial_deposit_usd": round(initial_deposit_usd, 2) if initial_deposit_usd else None,
            "opened_at": opened_at,
            "held_days": round(held_days, 4) if held_days is not None else None,
            "apy": round(apy, 4) if apy is not None else None,
            "is_closed": False,
            "closed_at": None,
            "close_value_usd": None,
            "token_symbol": symbol,
            "extra_data": {
                "if_shares": shares_after,
                "market_index": market_index,
                "symbol": symbol,
                "total_staked": total_staked,
                "total_unstaked": total_unstaked,
            },
            "snapshot_at": now,
        })

        # Convert events
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

        # Match to YieldOpportunity by deposit_address or external_id
        opportunity_id = None
        apy = None
        token_symbol = None
        match = _match_opportunity_by_deposit_address(vault_pubkey, db)
        if match:
            opportunity_id, apy, token_symbol = match
        if not opportunity_id:
            ext_match = _match_opportunity_by_external(external_id, db)
            if ext_match:
                opportunity_id, apy = ext_match

        # Fallback token symbol from marketIndex
        if not token_symbol:
            token_symbol = f"MARKET-{market_index}" if market_index is not None else None

        # Estimate opened_at from earliest snapshot
        opened_at = _parse_timestamp(snapshots[0].get("ts"))
        held_days = None
        if opened_at:
            held_days = (now - opened_at).total_seconds() / 86400.0

        positions.append({
            "wallet_address": wallet,
            "protocol_slug": "drift",
            "product_type": "earn_vault",
            "external_id": external_id,
            "opportunity_id": opportunity_id,
            "deposit_amount": total_value,
            "deposit_amount_usd": round(total_value, 2),
            "pnl_usd": round(pnl_usd, 2),
            "pnl_pct": round(pnl_pct, 4) if pnl_pct is not None else None,
            "initial_deposit_usd": round(net_deposits, 2) if net_deposits > 0 else None,
            "opened_at": opened_at,
            "held_days": round(held_days, 4) if held_days is not None else None,
            "apy": round(apy, 4) if apy is not None else None,
            "is_closed": False,
            "closed_at": None,
            "close_value_usd": None,
            "token_symbol": token_symbol,
            "extra_data": {
                "vault_pubkey": vault_pubkey,
                "market_index": market_index,
                "net_deposits": net_deposits,
                "total_account_value": total_value,
                "total_account_base_value": _float(latest.get("totalAccountBaseValue")),
            },
            "snapshot_at": now,
        })

    return positions


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fetch_wallet_positions(wallet_address: str, db: Session) -> dict:
    """Fetch all Drift positions for a wallet. Returns dict with positions list."""
    now = datetime.now(timezone.utc)

    with httpx.Client() as client:
        if_positions, if_events = _fetch_if_positions(wallet_address, client, db, now)
        vault_positions = _fetch_vault_positions(wallet_address, client, db, now)

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

def snapshot_all_wallets_drift(db: Session) -> int:
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
    now = datetime.now(timezone.utc)
    total_snapshots = 0

    with httpx.Client() as client:
        # Pre-fetch shared pool data
        _get_if_pool_apys(client)
        _get_spot_market_accounts(client)

        for wallet in wallets:
            try:
                if_positions, if_events = _fetch_if_positions(
                    wallet.wallet_address, client, db, now,
                )
                vault_positions = _fetch_vault_positions(
                    wallet.wallet_address, client, db, now,
                )
                all_positions = if_positions + vault_positions

                for pos_data in all_positions:
                    position = UserPosition(
                        wallet_address=pos_data["wallet_address"],
                        protocol_slug=pos_data["protocol_slug"],
                        product_type=pos_data["product_type"],
                        external_id=pos_data["external_id"],
                        opportunity_id=pos_data.get("opportunity_id"),
                        deposit_amount=pos_data.get("deposit_amount"),
                        deposit_amount_usd=pos_data.get("deposit_amount_usd"),
                        pnl_usd=pos_data.get("pnl_usd"),
                        pnl_pct=pos_data.get("pnl_pct"),
                        initial_deposit_usd=pos_data.get("initial_deposit_usd"),
                        opened_at=pos_data.get("opened_at"),
                        held_days=pos_data.get("held_days"),
                        apy=pos_data.get("apy"),
                        is_closed=pos_data.get("is_closed"),
                        closed_at=pos_data.get("closed_at"),
                        close_value_usd=pos_data.get("close_value_usd"),
                        token_symbol=pos_data.get("token_symbol"),
                        extra_data=pos_data.get("extra_data"),
                        snapshot_at=now,
                    )
                    db.add(position)
                    total_snapshots += 1

                # Store IF events (deduplicate by tx_signature)
                for evt in if_events:
                    if evt.get("tx_signature"):
                        existing = (
                            db.query(UserPositionEvent.id)
                            .filter(UserPositionEvent.tx_signature == evt["tx_signature"])
                            .first()
                        )
                        if existing:
                            continue

                    event = UserPositionEvent(
                        wallet_address=evt["wallet_address"],
                        protocol_slug=evt["protocol_slug"],
                        product_type=evt["product_type"],
                        external_id=evt["external_id"],
                        event_type=evt["event_type"],
                        amount=evt.get("amount"),
                        amount_usd=evt.get("amount_usd"),
                        tx_signature=evt.get("tx_signature"),
                        event_at=evt["event_at"],
                        extra_data=evt.get("extra_data"),
                    )
                    db.add(event)

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


def snapshot_all_wallets_drift_job():
    """APScheduler entry point — creates its own DB session."""
    logger.info("Starting Drift position snapshot job")
    db: Session = SessionLocal()
    try:
        count = snapshot_all_wallets_drift(db)
        logger.info("Drift position snapshot job complete: %d snapshots", count)
    except Exception as exc:
        db.rollback()
        logger.error("Drift position snapshot job failed: %s", exc)
    finally:
        db.close()
