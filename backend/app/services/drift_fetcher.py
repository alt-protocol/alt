"""Fetch live yield data directly from the Drift Data API.

Two data sources:
  - Insurance Fund staking: /stats/insuranceFund — per-token APY from protocol fees
  - Earn Vaults: /stats/vaults — managed strategy vaults with on-chain pubkeys

Vault APYs come from app.drift.trade/api/vaults (7d/30d/90d/180d/365d breakdowns).
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlalchemy.orm import Session
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.models.base import SessionLocal
from app.models.protocol import Protocol
from app.models.yield_opportunity import YieldOpportunity, YieldSnapshot

logger = logging.getLogger(__name__)

DRIFT_API = "https://data.api.drift.trade"
DRIFT_APP_API = "https://app.drift.trade"
DRIFT_BASE = "https://app.drift.trade"
DRIFT_MAINNET_API = "https://mainnet-beta.api.drift.trade"
MIN_VAULT_TVL_USD = 10_000

STABLE_SYMBOLS = {"USDC", "USDT", "PYUSD", "USDe", "USDS", "DAI", "USDY"}
SOL_LST_SYMBOLS = {"SOL", "JITOSOL", "MSOL", "BSOL"}


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout)),
    reraise=True,
)
def _get_with_retry(url: str, client: httpx.Client):
    r = client.get(url, timeout=30)
    r.raise_for_status()
    return r.json()


def _get(path: str, client: httpx.Client) -> Optional[dict | list]:
    try:
        return _get_with_retry(f"{DRIFT_API}{path}", client)
    except Exception as exc:
        logger.warning("Drift API %s failed after retries: %s", path, exc)
        return None


def _float(val) -> Optional[float]:
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


def _risk_tier(symbol: str) -> str:
    if symbol in STABLE_SYMBOLS:
        return "low"
    if symbol in SOL_LST_SYMBOLS:
        return "medium"
    return "high"


def _snapshot_avg(db: Session, opp_id: int, days: int) -> Optional[float]:
    since = datetime.now(timezone.utc) - timedelta(days=days)
    half_window = datetime.now(timezone.utc) - timedelta(days=days // 2)
    # Only compute if we have at least one snapshot older than half the window.
    # This matches Kamino's approach so averages appear sooner.
    has_old_enough = (
        db.query(YieldSnapshot.id)
        .filter(
            YieldSnapshot.opportunity_id == opp_id,
            YieldSnapshot.snapshot_at <= half_window,
        )
        .first()
    )
    if has_old_enough is None:
        return None
    rows = (
        db.query(YieldSnapshot.apy)
        .filter(
            YieldSnapshot.opportunity_id == opp_id,
            YieldSnapshot.snapshot_at >= since,
            YieldSnapshot.apy.isnot(None),
        )
        .all()
    )
    if len(rows) < 2:
        return None
    return float(sum(r.apy for r in rows) / len(rows))


def _fetch_if_market_data(client: httpx.Client) -> dict[int, dict]:
    """Fetch insurance fund vault addresses and staked shares from spotMarketAccounts.

    Returns dict keyed by marketIndex with deposit_address, tvl_tokens, decimals.
    """
    try:
        r = client.get(f"{DRIFT_MAINNET_API}/stats/spotMarketAccounts", timeout=30)
        r.raise_for_status()
        raw = r.json()
    except Exception as exc:
        logger.warning("Drift mainnet API /stats/spotMarketAccounts failed: %s", exc)
        return {}

    if isinstance(raw, dict):
        raw = raw.get("result", [])
    if not isinstance(raw, list):
        logger.warning("Unexpected /stats/spotMarketAccounts response type: %s", type(raw))
        return {}

    result: dict[int, dict] = {}
    for acct in raw:
        market_index = acct.get("marketIndex")
        if market_index is None:
            continue

        insurance_fund = acct.get("insuranceFund", {})
        vault = insurance_fund.get("vault")
        total_shares_hex = insurance_fund.get("totalShares")
        decimals = acct.get("decimals", 6)

        tvl_tokens = None
        if total_shares_hex is not None:
            try:
                tvl_tokens = int(total_shares_hex, 16) / 10**decimals
            except (ValueError, TypeError):
                pass

        unstaking_period_days = None
        unstaking_hex = insurance_fund.get("unstakingPeriod")
        if unstaking_hex is not None:
            try:
                unstaking_period_days = round(int(unstaking_hex, 16) / 86400, 1)
            except (ValueError, TypeError):
                pass

        result[int(market_index)] = {
            "deposit_address": vault,
            "tvl_tokens": tvl_tokens,
            "decimals": decimals,
            "unstaking_period_days": unstaking_period_days,
        }

    logger.info("Drift spotMarketAccounts: %d markets with IF data", len(result))
    return result


def _fetch_vault_apys(client: httpx.Client) -> dict[str, dict]:
    """Fetch vault APY data from app.drift.trade/api/vaults.

    Returns dict keyed by vault pubkey with APY breakdown and metadata.
    """
    try:
        r = client.get(f"{DRIFT_APP_API}/api/vaults", timeout=30)
        r.raise_for_status()
        raw = r.json()
    except Exception as exc:
        logger.warning("Drift app API /api/vaults failed: %s", exc)
        return {}

    result: dict[str, dict] = {}
    if not isinstance(raw, dict):
        logger.warning("Unexpected /api/vaults response type: %s", type(raw))
        return result

    for pubkey, info in raw.items():
        if not isinstance(info, dict):
            continue
        apys = info.get("apys", {})
        result[pubkey] = {
            "apy_7d": _float(apys.get("7d")),
            "apy_30d": _float(apys.get("30d")),
            "apy_90d": _float(apys.get("90d")),
            "apy_180d": _float(apys.get("180d")),
            "apy_365d": _float(apys.get("365d")),
            "max_drawdown_pct": _float(info.get("maxDrawdownPct")),
            "num_snapshots": info.get("numOfVaultSnapshots"),
        }
    logger.info("Drift app API: fetched APY data for %d vaults", len(result))
    return result



def _upsert_opportunity(
    db: Session,
    protocol: Protocol,
    external_id: str,
    name: str,
    category: str,
    tokens: list[str],
    apy_current: Optional[float],
    tvl_usd: Optional[float],
    deposit_address: Optional[str],
    risk_tier: str,
    min_deposit: Optional[float],
    extra: dict,
    now: datetime,
    apy_7d_avg: Optional[float] = None,
    apy_30d_avg: Optional[float] = None,
    lock_period_days: Optional[int] = None,
    liquidity_available_usd: Optional[float] = None,
    is_automated: Optional[bool] = None,
) -> YieldOpportunity:
    opp = db.query(YieldOpportunity).filter(YieldOpportunity.external_id == external_id).first()

    if opp:
        opp.name = name
        opp.apy_current = apy_current
        opp.apy_7d_avg = apy_7d_avg
        opp.apy_30d_avg = apy_30d_avg
        opp.tvl_usd = tvl_usd
        opp.tokens = tokens
        opp.deposit_address = deposit_address
        opp.protocol_name = "Drift"
        opp.is_active = True
        opp.extra_data = extra
        opp.liquidity_available_usd = liquidity_available_usd
        opp.is_automated = is_automated
        if lock_period_days is not None:
            opp.lock_period_days = lock_period_days
        opp.updated_at = now
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
            risk_tier=risk_tier,
            protocol_name="Drift",
            is_active=True,
            extra_data=extra,
            min_deposit=min_deposit,
            lock_period_days=lock_period_days or 0,
            liquidity_available_usd=liquidity_available_usd,
            is_automated=is_automated,
        )
        db.add(opp)
        db.flush()

    snapshot = YieldSnapshot(
        opportunity_id=opp.id,
        apy=apy_current,
        tvl_usd=tvl_usd,
        snapshot_at=now,
        source="drift_api",
    )
    db.add(snapshot)
    return opp


def fetch_insurance_fund(
    client: httpx.Client,
    protocol: Protocol,
    db: Session,
    now: datetime,
) -> tuple[int, dict[int, str]]:
    """Fetch insurance fund staking opportunities.

    Returns (count, market_index_map) where market_index_map is {marketIndex: symbol}.
    """
    raw = _get("/stats/insuranceFund", client)
    # API wraps response: {"success": true, "data": {"marketSharePriceData": [...]}}
    if isinstance(raw, dict):
        inner = raw.get("data", {})
        data = inner.get("marketSharePriceData", inner) if isinstance(inner, dict) else inner
    else:
        data = raw
    if not isinstance(data, list):
        logger.error("Unexpected /stats/insuranceFund response")
        return 0, {}

    # Fetch IF vault addresses and staked shares
    if_market_data = _fetch_if_market_data(client)

    market_index_map: dict[int, str] = {}
    count = 0

    for entry in data:
        idx = entry.get("marketIndex")
        symbol = entry.get("symbol", "")
        if idx is not None and symbol:
            market_index_map[int(idx)] = symbol

        apy = _float(entry.get("apy"))
        if apy is None:
            continue

        # Enrich with spotMarketAccounts data
        mkt_data = if_market_data.get(int(idx), {}) if idx is not None else {}
        deposit_address = mkt_data.get("deposit_address")
        tvl_tokens = mkt_data.get("tvl_tokens")

        # TVL in USD: stablecoins map 1:1, others need a price oracle
        tvl_usd = tvl_tokens if symbol in STABLE_SYMBOLS and tvl_tokens is not None else None

        # Unstaking period from spotMarketAccounts
        unstaking_days = mkt_data.get("unstaking_period_days")

        external_id = f"drift-if-{idx}"
        opp = _upsert_opportunity(
            db=db,
            protocol=protocol,
            external_id=external_id,
            name=f"Drift Insurance Fund — {symbol}",
            category="insurance_fund",
            tokens=[symbol] if symbol else [],
            apy_current=apy,  # already in percent (e.g. 6.17 = 6.17%)
            tvl_usd=tvl_usd,
            deposit_address=deposit_address,
            risk_tier="low",
            min_deposit=None,
            extra={
                "market_index": idx,
                "source": "drift_api",
                "type": "insurance_fund",
                "tvl_tokens": tvl_tokens,
                "deposit_address": deposit_address,
                "unstaking_period_days": unstaking_days,
                "protocol_url": f"{DRIFT_BASE}/vaults/insurance-fund-vaults",
            },
            now=now,
            lock_period_days=int(unstaking_days) if unstaking_days is not None else None,
            is_automated=True,
        )
        opp.apy_7d_avg = _snapshot_avg(db, opp.id, 7)
        opp.apy_30d_avg = _snapshot_avg(db, opp.id, 30)
        count += 1

    logger.info("Drift insurance fund: %d entries", count)
    return count, market_index_map


def fetch_vaults(
    client: httpx.Client,
    market_index_map: dict[int, str],
    protocol: Protocol,
    db: Session,
    now: datetime,
) -> tuple[int, set[str]]:
    """Fetch Drift earn vaults with APY and on-chain names.

    Returns (count, set_of_external_ids).
    """
    raw = _get("/stats/vaults", client)
    # API wraps response: {"success": true, "vaults": [...]}
    if isinstance(raw, dict):
        data = raw.get("vaults", raw.get("data", []))
    else:
        data = raw
    if not isinstance(data, list):
        logger.error("Unexpected /stats/vaults response")
        return 0, set()

    # Fetch APY data from app.drift.trade
    vault_apys = _fetch_vault_apys(client)

    count = 0
    upserted_ids: set[str] = set()

    for vault in data:
        net_deposits = _float(vault.get("netDeposits"))
        if net_deposits is None or net_deposits <= 0:
            continue

        pubkey = vault.get("pubkey", "")
        if not pubkey:
            continue

        spot_market_index = vault.get("spotMarketIndex", 0)

        # USDC only (market index 0)
        if int(spot_market_index) != 0:
            continue

        tvl_usd = net_deposits
        if tvl_usd < MIN_VAULT_TVL_USD:
            continue

        external_id = f"drift-vault-{pubkey}"
        name = f"Drift Vault — USDC ({pubkey[:6]})"

        # APY from app.drift.trade
        apy_info = vault_apys.get(pubkey, {})
        apy_7d = apy_info.get("apy_7d")
        apy_30d = apy_info.get("apy_30d")
        apy_90d = apy_info.get("apy_90d")
        # Use 90d as the current APY (most stable signal)
        apy_current = apy_90d

        min_deposit_raw = _float(vault.get("minDepositAmount"))

        extra = {
            "market_index": spot_market_index,
            "net_deposits_tokens": net_deposits,
            "max_tokens": _float(vault.get("maxTokens")),
            "profit_share": vault.get("profitShare"),
            "management_fee": vault.get("managementFee"),
            "hurdle_rate": vault.get("hurdleRate"),
            "permissioned": vault.get("permissioned"),
            "total_deposits": _float(vault.get("totalDeposits")),
            "total_withdraws": _float(vault.get("totalWithdraws")),
            "source": "drift_api",
            "type": "vault",
            # APY breakdown
            "apy_7d": apy_7d,
            "apy_30d": apy_30d,
            "apy_90d": apy_info.get("apy_90d"),
            "apy_180d": apy_info.get("apy_180d"),
            "apy_365d": apy_info.get("apy_365d"),
            "max_drawdown_pct": apy_info.get("max_drawdown_pct"),
            "num_snapshots": apy_info.get("num_snapshots"),
            "protocol_url": f"{DRIFT_BASE}/vaults/strategy-vaults/{pubkey}",
        }

        max_tokens = _float(vault.get("maxTokens"))
        vault_liq_usd = (max_tokens - net_deposits) if max_tokens and max_tokens > 0 else None

        opp = _upsert_opportunity(
            db=db,
            protocol=protocol,
            external_id=external_id,
            name=name,
            category="vault",
            tokens=["USDC"],
            apy_current=apy_current,
            tvl_usd=tvl_usd,
            deposit_address=pubkey,
            risk_tier="low",
            min_deposit=min_deposit_raw,
            extra=extra,
            now=now,
            apy_7d_avg=apy_7d,
            apy_30d_avg=apy_30d,
            liquidity_available_usd=round(vault_liq_usd, 2) if vault_liq_usd is not None else None,
            is_automated=True,
        )
        if apy_7d is None:
            opp.apy_7d_avg = _snapshot_avg(db, opp.id, 7)
        if apy_30d is None:
            opp.apy_30d_avg = _snapshot_avg(db, opp.id, 30)
        upserted_ids.add(external_id)
        count += 1

    # Deactivate stale vault entries not seen in current run
    stale_rows = (
        db.query(YieldOpportunity)
        .filter(
            YieldOpportunity.external_id.like("drift-vault-%"),
            YieldOpportunity.is_active.is_(True),
        )
        .all()
    )
    deactivated = 0
    for row in stale_rows:
        if row.external_id not in upserted_ids:
            row.is_active = False
            deactivated += 1
    if deactivated:
        logger.info("Deactivated %d stale Drift vault entries", deactivated)

    logger.info("Drift vaults: %d entries", count)
    return count, upserted_ids


def fetch_drift_yields() -> int:
    """Fetch Drift insurance fund staking + earn vaults.

    Returns total number of opportunities updated/inserted.
    """
    logger.info("Starting Drift yield fetch")
    now = datetime.now(timezone.utc)

    db: Session = SessionLocal()
    try:
        protocol = db.query(Protocol).filter(Protocol.slug == "drift").first()
        if not protocol:
            logger.error("Protocol 'drift' not found in DB — run seed first")
            return 0

        with httpx.Client() as client:
            if_count, market_index_map = fetch_insurance_fund(client, protocol, db, now)
            vault_count, _ = fetch_vaults(client, market_index_map, protocol, db, now)

        db.commit()
        total = if_count + vault_count
        logger.info(
            "Drift fetch complete: %d insurance fund + %d vaults",
            if_count, vault_count,
        )
        return total

    except Exception as exc:
        db.rollback()
        logger.error("Drift fetch failed: %s", exc)
        raise
    finally:
        db.close()
