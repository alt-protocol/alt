"""Fetch live yield data from Jupiter Lend API.

Two data sources:
  - Earn tokens: GET /earn/tokens — supply/lend opportunities
  - Multiply vaults: GET /borrow/vaults — leveraged strategy vaults
"""
import logging
import math
import os
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy.orm import Session
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.models.base import SessionLocal
from app.models.protocol import Protocol
from app.config.stablecoins import compute_depeg
from app.models.yield_opportunity import YieldOpportunity, YieldSnapshot
from app.services.kamino_fetcher import _classify_multiply_pair as classify_multiply_pair
from app.services.kamino_fetcher import _batch_snapshot_avg

logger = logging.getLogger(__name__)

JUPITER_LEND_API = "https://api.jup.ag/lend/v1"
MIN_TVL_USD = 100_000


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.ConnectError, httpx.ReadTimeout)),
    reraise=True,
)
def _get_with_retry(url: str, client: httpx.Client, timeout: int = 30):
    r = client.get(url, timeout=timeout)
    r.raise_for_status()
    return r.json()


def _build_headers() -> dict[str, str]:
    key = os.getenv("JUPITER_API_KEY", "")
    headers: dict[str, str] = {}
    if key:
        headers["x-api-key"] = key
    return headers


def _float(val) -> Optional[float]:
    try:
        return float(val) if val is not None else None
    except (TypeError, ValueError):
        return None


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
    max_leverage: Optional[float] = None,
    liquidity_available_usd: Optional[float] = None,
    is_automated: Optional[bool] = None,
    depeg: Optional[float] = None,
    apy_7d_avg: Optional[float] = None,
    apy_30d_avg: Optional[float] = None,
) -> YieldOpportunity:
    opp = db.query(YieldOpportunity).filter(YieldOpportunity.external_id == external_id).first()

    if opp:
        opp.name = name
        opp.apy_current = apy_current
        opp.tvl_usd = tvl_usd
        opp.tokens = tokens
        opp.deposit_address = deposit_address
        opp.protocol_name = "Jupiter"
        opp.is_active = True
        opp.extra_data = extra
        opp.max_leverage = max_leverage
        opp.liquidity_available_usd = liquidity_available_usd
        opp.is_automated = is_automated
        opp.depeg = depeg
        opp.updated_at = now
    else:
        opp = YieldOpportunity(
            protocol_id=protocol.id,
            external_id=external_id,
            name=name,
            category=category,
            tokens=tokens,
            apy_current=apy_current,
            tvl_usd=tvl_usd,
            deposit_address=deposit_address,
            risk_tier=risk_tier,
            protocol_name="Jupiter",
            is_active=True,
            extra_data=extra,
            min_deposit=min_deposit,
            max_leverage=max_leverage,
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
        source="jupiter_api",
    )
    db.add(snapshot)
    opp.apy_7d_avg = apy_7d_avg
    opp.apy_30d_avg = apy_30d_avg
    return opp


def fetch_earn_tokens(
    client: httpx.Client,
    protocol: Protocol,
    db: Session,
    now: datetime,
) -> tuple[int, set[str]]:
    """Fetch Jupiter Lend earn (supply) opportunities.

    Returns (count, set_of_external_ids).
    """
    try:
        data = _get_with_retry(f"{JUPITER_LEND_API}/earn/tokens", client)
    except Exception as exc:
        logger.warning("Jupiter Lend API /earn/tokens failed after retries: %s", exc)
        return 0, set()

    if not isinstance(data, list):
        logger.error("Unexpected /earn/tokens response type: %s", type(data))
        return 0, set()

    count = 0
    upserted_ids: set[str] = set()
    avgs = _batch_snapshot_avg(db, protocol.id, "lending")

    for token in data:
        asset = token.get("asset", {})
        asset_address = token.get("assetAddress", "")
        if not asset_address:
            continue

        decimals = asset.get("decimals", 6)
        price = _float(asset.get("price"))
        total_assets = _float(token.get("totalAssets"))
        if total_assets is None or price is None:
            continue

        tvl_usd = total_assets / 10**decimals * price
        if tvl_usd < MIN_TVL_USD:
            continue

        total_rate_bps = _float(token.get("totalRate"))
        if total_rate_bps is None:
            continue

        apy = total_rate_bps / 100

        symbol = asset.get("uiSymbol", asset.get("symbol", ""))
        external_id = f"juplend-earn-{asset_address[:8]}"

        supply_rate = _float(token.get("supplyRate"))
        rewards_rate = _float(token.get("rewardsRate"))

        opp_avgs = avgs.get(external_id, {})
        _upsert_opportunity(
            db=db,
            protocol=protocol,
            external_id=external_id,
            name=f"Jupiter Lend — {symbol}",
            category="lending",
            tokens=[symbol] if symbol else [],
            apy_current=apy,
            tvl_usd=tvl_usd,
            deposit_address=asset_address,
            risk_tier="low",
            min_deposit=None,
            extra={
                "source": "jupiter_api",
                "mint": asset_address,
                "supply_rate_bps": supply_rate,
                "rewards_rate_bps": rewards_rate,
                "total_rate_bps": total_rate_bps,
            },
            now=now,
            is_automated=True,
            depeg=compute_depeg(symbol, price),
            apy_7d_avg=opp_avgs.get("7d"),
            apy_30d_avg=opp_avgs.get("30d"),
        )
        upserted_ids.add(external_id)
        count += 1

    # Deactivate stale earn entries
    stale_rows = (
        db.query(YieldOpportunity)
        .filter(
            YieldOpportunity.external_id.like("juplend-earn-%"),
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
        logger.info("Deactivated %d stale Jupiter earn entries", deactivated)

    logger.info("Jupiter earn: %d entries", count)
    return count, upserted_ids


def fetch_multiply_vaults(
    client: httpx.Client,
    protocol: Protocol,
    db: Session,
    now: datetime,
) -> tuple[int, set[str]]:
    """Fetch Jupiter Lend multiply (leveraged) vaults.

    Returns (count, set_of_external_ids).
    """
    try:
        data = _get_with_retry(f"{JUPITER_LEND_API}/borrow/vaults", client)
    except Exception as exc:
        logger.warning("Jupiter Lend API /borrow/vaults failed after retries: %s", exc)
        return 0, set()

    if not isinstance(data, list):
        logger.error("Unexpected /borrow/vaults response type: %s", type(data))
        return 0, set()

    count = 0
    upserted_ids: set[str] = set()
    avgs = _batch_snapshot_avg(db, protocol.id, "multiply")

    for vault in data:
        # Only multiply-enabled vaults
        metadata = vault.get("metadata", {})
        multiply = metadata.get("multiply", {})
        if not multiply.get("enabled"):
            continue

        vault_id = vault.get("id", "")
        vault_address = vault.get("address", "")
        if not vault_id or not vault_address:
            continue

        supply_token = vault.get("supplyToken", {})
        borrow_token = vault.get("borrowToken", {})

        supply_decimals = supply_token.get("decimals", 6)
        supply_price = _float(supply_token.get("price"))
        total_supply = _float(vault.get("totalSupply"))
        if total_supply is None or supply_price is None:
            continue

        tvl_usd = total_supply / 10**supply_decimals * supply_price
        if tvl_usd < MIN_TVL_USD:
            continue

        # Collateral APR (bps): supplyRate + stakingApr
        supply_rate = _float(vault.get("supplyRate")) or 0
        staking_apr = _float(supply_token.get("stakingApr")) or 0
        collateral_apr_bps = supply_rate + staking_apr

        # Borrow APR (bps)
        borrow_rate = _float(vault.get("borrowRate")) or 0

        # Max leverage
        collateral_factor = _float(vault.get("collateralFactor")) or 0
        reduce_factor = _float(vault.get("reduceFactor")) or 0
        raw_lev = 1 / (1 - collateral_factor / 1000) if collateral_factor < 1000 else 100
        max_leverage = math.floor(raw_lev * (1 - reduce_factor / 10000) * 10) / 10

        # Net multiply APR → APY
        collateral_apr_pct = collateral_apr_bps / 100
        borrow_apr_pct = borrow_rate / 100
        net_apr_pct = collateral_apr_pct * max_leverage - borrow_apr_pct * (max_leverage - 1)
        max_apy = net_apr_pct

        # Cap at 0 if negative (matching website)
        apy_current = max(max_apy, 0)

        collateral_apy = collateral_apr_pct
        borrow_cost_apy = borrow_apr_pct

        # Liquidity available
        liquidity_data = vault.get("liquidityBorrowData", {})
        borrowable = _float(liquidity_data.get("borrowable"))
        borrow_decimals = borrow_token.get("decimals", 6)
        borrow_price = _float(borrow_token.get("price"))
        liquidity_usd = None
        if borrowable is not None and borrow_price is not None:
            liquidity_usd = borrowable / 10**borrow_decimals * borrow_price

        supply_symbol = supply_token.get("uiSymbol", supply_token.get("symbol", ""))
        borrow_symbol = borrow_token.get("uiSymbol", borrow_token.get("symbol", ""))

        external_id = f"juplend-mult-{vault_id}"

        # Compute depeg for pegged vaults
        multiply_depeg = None
        if multiply.get("pegged"):
            multiply_depeg = compute_depeg(supply_symbol, supply_price)

        vault_tag = classify_multiply_pair(supply_symbol, borrow_symbol)

        opp_avgs = avgs.get(external_id, {})
        _upsert_opportunity(
            db=db,
            protocol=protocol,
            external_id=external_id,
            name=f"Jupiter Multiply — {supply_symbol}/{borrow_symbol}",
            category="multiply",
            tokens=[supply_symbol, borrow_symbol],
            apy_current=apy_current,
            tvl_usd=tvl_usd,
            deposit_address=vault_address,
            risk_tier="medium",
            min_deposit=None,
            extra={
                "source": "jupiter_api",
                "vault_id": vault_id,
                "vault_tag": vault_tag,
                "market": metadata.get("market", ""),
                "collateral_apy": collateral_apy,
                "borrow_cost": borrow_cost_apy,
                "max_leverage": max_leverage,
                "max_apy": max_apy,
                "liquidity_available_usd": liquidity_usd,
                "collateral_factor": collateral_factor,
                "liquidation_threshold": _float(vault.get("liquidationThreshold")),
                "liquidation_penalty": _float(vault.get("liquidationPenalty")),
                "total_positions": vault.get("totalPositions"),
                "pegged": multiply.get("pegged"),
                "staking_apr_bps": staking_apr,
                "supply_token_mint": supply_token.get("address", ""),
                "borrow_token_mint": borrow_token.get("address", ""),
            },
            now=now,
            max_leverage=max_leverage,
            liquidity_available_usd=round(liquidity_usd, 2) if liquidity_usd is not None else None,
            is_automated=True,
            depeg=multiply_depeg,
            apy_7d_avg=opp_avgs.get("7d"),
            apy_30d_avg=opp_avgs.get("30d"),
        )
        upserted_ids.add(external_id)
        count += 1

    # Deactivate stale multiply entries
    stale_rows = (
        db.query(YieldOpportunity)
        .filter(
            YieldOpportunity.external_id.like("juplend-mult-%"),
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
        logger.info("Deactivated %d stale Jupiter multiply entries", deactivated)

    logger.info("Jupiter multiply: %d entries", count)
    return count, upserted_ids


def fetch_jupiter_yields() -> int:
    """Fetch Jupiter Lend earn + multiply vaults.

    Returns total number of opportunities updated/inserted.
    """
    logger.info("Starting Jupiter Lend yield fetch")
    now = datetime.now(timezone.utc)

    db: Session = SessionLocal()
    try:
        protocol = db.query(Protocol).filter(Protocol.slug == "jupiter").first()
        if not protocol:
            logger.error("Protocol 'jupiter' not found in DB — run seed first")
            return 0

        headers = _build_headers()
        with httpx.Client(headers=headers) as client:
            earn_count, _ = fetch_earn_tokens(client, protocol, db, now)
            mult_count, _ = fetch_multiply_vaults(client, protocol, db, now)

        db.commit()
        total = earn_count + mult_count
        logger.info(
            "Jupiter fetch complete: %d earn + %d multiply",
            earn_count, mult_count,
        )
        return total

    except Exception as exc:
        db.rollback()
        logger.error("Jupiter fetch failed: %s", exc)
        raise
    finally:
        db.close()
