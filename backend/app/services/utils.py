"""Shared utilities for yield fetchers and position fetchers."""
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

logger = logging.getLogger(__name__)


def safe_float(val) -> Optional[float]:
    """Safely coerce a string or number to float."""
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout)),
    reraise=True,
)
def get_with_retry(url: str, client: httpx.Client, timeout: int = 30):
    """GET with tenacity retry (3 attempts, exponential backoff)."""
    r = client.get(url, timeout=timeout)
    r.raise_for_status()
    return r.json()


def get_or_none(url: str, client: httpx.Client, timeout: int = 30,
                log_label: str = "API") -> Optional[dict | list]:
    """GET with retry, returning None on failure instead of raising."""
    try:
        return get_with_retry(url, client, timeout)
    except Exception as exc:
        logger.warning("%s %s failed after retries: %s", log_label, url, exc)
        return None


# ---------------------------------------------------------------------------
# TTL cache for expensive, slowly-changing API data
# ---------------------------------------------------------------------------
_cache: dict[str, tuple[float, Any]] = {}


def cached(key: str, ttl: float, fn):
    """Return cached result if fresh, otherwise call fn() and store."""
    now = time.monotonic()
    if key in _cache and (now - _cache[key][0]) < ttl:
        return _cache[key][1]
    result = fn()
    if result is not None:
        _cache[key] = (now, result)
    return result


def compute_realized_apy(
    pnl_usd: Optional[float],
    initial_deposit_usd: Optional[float],
    held_days: Optional[float],
) -> Optional[float]:
    """Annualized return from actual PnL. None if data is missing or < 1 day held."""
    if pnl_usd is None or not initial_deposit_usd or held_days is None or held_days < 1:
        return None
    return round((pnl_usd / initial_deposit_usd) * (365.0 / held_days) * 100, 4)


def load_opportunity_map(db) -> dict[str, dict]:
    """Batch-load all active opportunities keyed by deposit_address and external_id.

    Returns {key: {"id": int, "apy_current": float|None, "first_token": str|None}}.
    Both keys indexed for O(1) lookup — call once per snapshot, not per position.
    """
    from app.models.yield_opportunity import YieldOpportunity

    rows = (
        db.query(
            YieldOpportunity.id,
            YieldOpportunity.deposit_address,
            YieldOpportunity.external_id,
            YieldOpportunity.apy_current,
            YieldOpportunity.tokens,
        )
        .filter(YieldOpportunity.is_active.is_(True))
        .all()
    )
    result: dict[str, dict] = {}
    for row in rows:
        entry = {
            "id": row.id,
            "apy_current": float(row.apy_current) if row.apy_current is not None else None,
            "first_token": row.tokens[0] if row.tokens else None,
        }
        if row.deposit_address:
            result[row.deposit_address] = entry
        if row.external_id:
            result[row.external_id] = entry
    return result


def store_position_rows(db, positions: list[dict], snapshot_at: datetime) -> int:
    """Store a list of position dicts as UserPosition rows. Returns count."""
    from app.models.user_position import UserPosition

    count = 0
    for pos_data in positions:
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
            apy_realized=pos_data.get("apy_realized"),
            is_closed=pos_data.get("is_closed"),
            closed_at=pos_data.get("closed_at"),
            close_value_usd=pos_data.get("close_value_usd"),
            token_symbol=pos_data.get("token_symbol"),
            extra_data=pos_data.get("extra_data"),
            snapshot_at=snapshot_at,
        )
        db.add(position)
        count += 1
    return count


def upsert_opportunity(
    db, protocol, external_id: str, name: str, category: str,
    tokens: list[str], apy_current: Optional[float],
    tvl_usd: Optional[float], deposit_address: Optional[str],
    risk_tier: str, extra: dict, now: datetime, source: str,
    *,
    apy_7d_avg: Optional[float] = None,
    apy_30d_avg: Optional[float] = None,
    min_deposit: Optional[float] = None,
    max_leverage: Optional[float] = None,
    lock_period_days: Optional[int] = None,
    liquidity_available_usd: Optional[float] = None,
    is_automated: Optional[bool] = None,
    depeg: Optional[float] = None,
):
    """Create or update a YieldOpportunity + record a snapshot.

    Consolidates the _upsert_opportunity pattern from kamino/drift/jupiter fetchers.
    """
    from app.models.yield_opportunity import YieldOpportunity, YieldSnapshot

    opp = db.query(YieldOpportunity).filter(
        YieldOpportunity.external_id == external_id,
    ).first()

    if opp:
        opp.name = name
        opp.apy_current = apy_current
        opp.apy_7d_avg = apy_7d_avg
        opp.apy_30d_avg = apy_30d_avg
        opp.tvl_usd = tvl_usd
        opp.tokens = tokens
        opp.deposit_address = deposit_address
        opp.protocol_name = protocol.name
        opp.is_active = True
        opp.extra_data = extra
        opp.updated_at = now
        if max_leverage is not None:
            opp.max_leverage = max_leverage
        if liquidity_available_usd is not None:
            opp.liquidity_available_usd = liquidity_available_usd
        if is_automated is not None:
            opp.is_automated = is_automated
        if depeg is not None:
            opp.depeg = depeg
        if lock_period_days is not None:
            opp.lock_period_days = lock_period_days
    else:
        opp = YieldOpportunity(
            protocol_id=protocol.id,
            external_id=external_id,
            name=name,
            category=category,
            tokens=tokens,
            apy_current=apy_current,
            apy_7d_avg=apy_7d_avg,
            apy_30d_avg=apy_30d_avg,
            tvl_usd=tvl_usd,
            deposit_address=deposit_address,
            protocol_name=protocol.name,
            risk_tier=risk_tier,
            is_active=True,
            extra_data=extra,
            min_deposit=min_deposit,
            max_leverage=max_leverage,
            lock_period_days=lock_period_days or 0,
            liquidity_available_usd=liquidity_available_usd,
            is_automated=is_automated,
            depeg=depeg,
        )
        db.add(opp)
        db.flush()

    snapshot = YieldSnapshot(
        opportunity_id=opp.id,
        apy=apy_current,
        tvl_usd=tvl_usd,
        snapshot_at=now,
        source=source,
    )
    db.add(snapshot)
    return opp


def parse_timestamp(ts) -> Optional[datetime]:
    """Parse a timestamp from API response (ISO string or epoch)."""
    if ts is None:
        return None
    try:
        if isinstance(ts, (int, float)):
            return datetime.fromtimestamp(ts, tz=timezone.utc)
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (ValueError, OSError):
        return None


# ---------------------------------------------------------------------------
# Shared position-fetcher utilities
# ---------------------------------------------------------------------------

# Well-known Solana token mints → symbols (fallback when API omits tokenSymbol)
KNOWN_TOKEN_MINTS: dict[str, str] = {
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
    "So11111111111111111111111111111111111111112": "SOL",
    "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn": "JITOSOL",
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": "MSOL",
    "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": "stSOL",
    "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1": "bSOL",
}


def compute_held_days(
    opened_at: Optional[datetime], now: Optional[datetime] = None,
) -> Optional[float]:
    """Days between opened_at and now, rounded to 4 decimals. None if opened_at is None."""
    if opened_at is None:
        return None
    if now is None:
        now = datetime.now(timezone.utc)
    return round((now - opened_at).total_seconds() / 86400.0, 4)


def build_position_dict(
    *,
    wallet_address: str,
    protocol_slug: str,
    product_type: str,
    external_id: str,
    snapshot_at: datetime,
    opportunity_id: Optional[int] = None,
    deposit_amount: Optional[float] = None,
    deposit_amount_usd: Optional[float] = None,
    pnl_usd: Optional[float] = None,
    pnl_pct: Optional[float] = None,
    initial_deposit_usd: Optional[float] = None,
    opened_at: Optional[datetime] = None,
    held_days: Optional[float] = None,
    apy: Optional[float] = None,
    is_closed: bool = False,
    closed_at: Optional[datetime] = None,
    close_value_usd: Optional[float] = None,
    token_symbol: Optional[str] = None,
    extra_data: Optional[dict] = None,
) -> dict:
    """Build a standardized position dict with consistent rounding and realized APY."""
    return {
        "wallet_address": wallet_address,
        "protocol_slug": protocol_slug,
        "product_type": product_type,
        "external_id": external_id,
        "opportunity_id": opportunity_id,
        "deposit_amount": deposit_amount,
        "deposit_amount_usd": round(deposit_amount_usd, 2) if deposit_amount_usd is not None else None,
        "pnl_usd": round(pnl_usd, 2) if pnl_usd is not None else None,
        "pnl_pct": round(pnl_pct, 4) if pnl_pct is not None else None,
        "initial_deposit_usd": round(initial_deposit_usd, 2) if initial_deposit_usd is not None else None,
        "opened_at": opened_at,
        "held_days": held_days,
        "apy": round(apy, 4) if apy is not None else None,
        "apy_realized": compute_realized_apy(pnl_usd, initial_deposit_usd, held_days),
        "is_closed": is_closed,
        "closed_at": closed_at,
        "close_value_usd": round(close_value_usd, 2) if close_value_usd is not None else None,
        "token_symbol": token_symbol,
        "extra_data": extra_data or {},
        "snapshot_at": snapshot_at,
    }


def store_events_batch(db, events: list[dict]) -> int:
    """Deduplicate events by tx_signature (batch lookup) and store new ones. Returns count."""
    from app.models.user_position import UserPositionEvent

    if not events:
        return 0

    # Batch-load existing tx_signatures — avoids N+1 queries
    sigs = [e["tx_signature"] for e in events if e.get("tx_signature")]
    existing_sigs: set[str] = set()
    if sigs:
        for i in range(0, len(sigs), 500):
            chunk = sigs[i:i + 500]
            rows = (
                db.query(UserPositionEvent.tx_signature)
                .filter(UserPositionEvent.tx_signature.in_(chunk))
                .all()
            )
            existing_sigs.update(r[0] for r in rows)

    count = 0
    for evt in events:
        sig = evt.get("tx_signature")
        if sig and sig in existing_sigs:
            continue
        event = UserPositionEvent(
            wallet_address=evt["wallet_address"],
            protocol_slug=evt["protocol_slug"],
            product_type=evt["product_type"],
            external_id=evt["external_id"],
            event_type=evt["event_type"],
            amount=evt.get("amount"),
            amount_usd=evt.get("amount_usd"),
            tx_signature=sig,
            event_at=evt["event_at"],
            extra_data=evt.get("extra_data"),
        )
        db.add(event)
        count += 1
    return count


def batch_earliest_snapshots(
    db, wallet_address: str,
) -> dict[str, datetime]:
    """Load earliest snapshot_at per external_id for a wallet. Single GROUP BY query."""
    from app.models.user_position import UserPosition
    from sqlalchemy import func

    rows = (
        db.query(
            UserPosition.external_id,
            func.min(UserPosition.snapshot_at),
        )
        .filter(UserPosition.wallet_address == wallet_address)
        .group_by(UserPosition.external_id)
        .all()
    )
    result: dict[str, datetime] = {}
    for ext_id, min_ts in rows:
        if min_ts is not None:
            ts = min_ts.replace(tzinfo=timezone.utc) if min_ts.tzinfo is None else min_ts
            result[ext_id] = ts
    return result
