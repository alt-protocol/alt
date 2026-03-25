"""Fetch live yield data directly from the Drift Data API.

Two data sources:
  - Insurance Fund staking: /stats/insuranceFund — per-token APY from protocol fees
  - Earn Vaults: /stats/vaults — managed strategy vaults with on-chain pubkeys

Vault APYs come from app.drift.trade/api/vaults (7d/30d/90d/180d/365d breakdowns).
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from solders.pubkey import Pubkey
from sqlalchemy.orm import Session

from app.models.base import SessionLocal
from app.models.protocol import Protocol
from app.models.yield_opportunity import YieldOpportunity, YieldSnapshot
from app.services.utils import safe_float, get_or_none, upsert_opportunity

logger = logging.getLogger(__name__)

DRIFT_API = "https://data.api.drift.trade"
DRIFT_APP_API = "https://app.drift.trade"
DRIFT_BASE = "https://app.drift.trade"
MIN_VAULT_TVL_USD = 10_000
HELIUS_RPC_URL = os.getenv("HELIUS_RPC_URL", "")
DRIFT_PROGRAM = Pubkey.from_string("dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH")
IF_UNSTAKING_PERIOD_DAYS = 13  # Standard Drift IF unstaking period

STABLE_SYMBOLS = {"USDC", "USDT", "PYUSD", "USDe", "USDS", "DAI", "USDY"}
SOL_LST_SYMBOLS = {"SOL", "JITOSOL", "MSOL", "BSOL"}


def _get(path: str, client: httpx.Client) -> Optional[dict | list]:
    return get_or_none(f"{DRIFT_API}{path}", client, log_label="Drift API")


_float = safe_float


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


def _if_vault_pda(market_index: int) -> str:
    """Derive the Insurance Fund vault PDA for a given market index."""
    pda, _ = Pubkey.find_program_address(
        [b"insurance_fund_vault", market_index.to_bytes(2, "little")],
        DRIFT_PROGRAM,
    )
    return str(pda)


def _fetch_vault_token_balances(
    vault_map: dict[int, str], client: httpx.Client,
) -> dict[int, float]:
    """Fetch actual token balances for IF vault addresses via Helius RPC.

    Takes {market_index: vault_pubkey}, returns {market_index: balance_tokens}.
    """
    if not HELIUS_RPC_URL or not vault_map:
        return {}

    pubkeys = list(vault_map.values())
    idx_by_pubkey = {v: k for k, v in vault_map.items()}

    try:
        resp = client.post(
            HELIUS_RPC_URL,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "getMultipleAccounts",
                "params": [pubkeys, {"encoding": "jsonParsed"}],
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        logger.warning("Helius RPC getMultipleAccounts failed: %s", exc)
        return {}

    accounts = data.get("result", {}).get("value", [])
    balances: dict[int, float] = {}
    for pubkey, acct in zip(pubkeys, accounts):
        if acct is None:
            continue
        try:
            parsed = acct["data"]["parsed"]["info"]["tokenAmount"]
            balance = float(parsed["uiAmount"])
            balances[idx_by_pubkey[pubkey]] = balance
        except (KeyError, TypeError, ValueError):
            continue

    logger.info("Helius RPC: fetched %d IF vault balances", len(balances))
    return balances


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


def fetch_insurance_fund(
    client: httpx.Client,
    protocol: Protocol,
    db: Session,
    now: datetime,
) -> tuple[int, dict[int, str]]:
    """Fetch stablecoin insurance fund staking opportunities.

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

    # Build market_index_map (all symbols) and stablecoin vault map (PDAs)
    market_index_map: dict[int, str] = {}
    stable_vaults: dict[int, str] = {}
    for entry in data:
        idx = entry.get("marketIndex")
        symbol = entry.get("symbol", "")
        if idx is not None and symbol:
            market_index_map[int(idx)] = symbol
        if symbol in STABLE_SYMBOLS and idx is not None:
            stable_vaults[int(idx)] = _if_vault_pda(int(idx))

    # Fetch actual on-chain vault balances for stablecoin IFs
    vault_balances = _fetch_vault_token_balances(stable_vaults, client)

    count = 0
    for entry in data:
        idx = entry.get("marketIndex")
        symbol = entry.get("symbol", "")
        apy = _float(entry.get("apy"))

        # Only ingest stablecoin IFs
        if symbol not in STABLE_SYMBOLS or apy is None or idx is None:
            continue

        deposit_address = stable_vaults.get(int(idx))

        # TVL from on-chain vault balance (stablecoins = 1:1 USD)
        tvl_usd = vault_balances.get(int(idx))

        external_id = f"drift-if-{idx}"
        opp = upsert_opportunity(
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
                "vault_balance_tokens": tvl_usd,
                "deposit_address": deposit_address,
                "unstaking_period_days": IF_UNSTAKING_PERIOD_DAYS,
                "protocol_url": f"{DRIFT_BASE}/vaults/insurance-fund-vaults",
            },
            now=now,
            source="drift_api",
            lock_period_days=IF_UNSTAKING_PERIOD_DAYS,
            is_automated=True,
        )
        opp.apy_7d_avg = _snapshot_avg(db, opp.id, 7)
        opp.apy_30d_avg = _snapshot_avg(db, opp.id, 30)
        count += 1

    logger.info("Drift insurance fund: %d stablecoin entries", count)
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

        opp = upsert_opportunity(
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
            source="drift_api",
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
