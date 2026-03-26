"""Fetch live yield data directly from the Kamino Finance API.

Three data sources:
  - Earn Vaults: /kvaults/vaults + /kvaults/vaults/{pubkey}/metrics
  - Lending Reserves: /v2/kamino-market (primary) + /kamino-market/{market}/reserves/metrics
  - Multiply Markets: /v2/kamino-market (non-primary) + reserve metrics + reserve history

The vault/reserve pubkey is stored as deposit_address so the frontend can build
deposit transactions without a separate lookup.
"""
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from app.models.base import SessionLocal
from app.models.protocol import Protocol
from app.models.yield_opportunity import YieldOpportunity, YieldSnapshot
from app.services.utils import safe_float, get_with_retry, get_or_none, upsert_opportunity

logger = logging.getLogger(__name__)

KAMINO_API = "https://api.kamino.finance"
KAMINO_APP = "https://app.kamino.finance"
MIN_TVL_USD = 100_000  # skip entries with < $100k TVL

# ---------------------------------------------------------------------------
# Token classification
# ---------------------------------------------------------------------------

YIELD_BEARING_STABLES = {
    "PRIME", "syrupUSDC", "ONyc", "USCC", "PST", "eUSX",
    "JUICED", "sUSDe", "USDY",
}
REGULAR_STABLES = {
    "USDC", "PYUSD", "USDG", "USDS", "CASH", "USD1", "USDT", "USX", "FDUSD",
    "USDe", "USDH", "AUSD", "JupUSD",
}
LST_SYMBOLS = {
    "JITOSOL", "MSOL", "BSOL", "JUPSOL", "HSOL", "VSOL", "INF", "DSOL",
    "BONKSOL", "COMPASSSOL", "LAINESOL", "PATHSOL", "PICOSOL", "HUBSOL",
}


def _classify_token(symbol: str) -> str:
    """Classify a token symbol into a category."""
    upper = symbol.upper()
    if symbol in YIELD_BEARING_STABLES:
        return "yield_bearing_stable"
    if upper in {s.upper() for s in REGULAR_STABLES}:
        return "stable"
    if upper in LST_SYMBOLS:
        return "lst"
    return "volatile"


def _classify_multiply_pair(coll_symbol: str, debt_symbol: str) -> str:
    """Classify a multiply pair into a vault tag."""
    coll_type = _classify_token(coll_symbol)
    debt_type = _classify_token(debt_symbol)

    if coll_type == "yield_bearing_stable" and debt_type in ("stable", "yield_bearing_stable"):
        return "rwa_loop"
    if coll_type == "stable" and debt_type == "stable":
        return "stable_loop"
    if coll_type == "lst" and debt_type in ("lst", "volatile"):
        return "sol_loop"
    return "directional_leverage"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get(path: str, client: httpx.Client) -> Optional[dict | list]:
    return get_or_none(f"{KAMINO_API}{path}", client, log_label="Kamino API")


_float = safe_float


def _build_mint_map(client: httpx.Client) -> dict[str, str]:
    """Return {mint: symbol} from Kamino oracle prices."""
    prices = _get("/oracles/prices", client)
    if not isinstance(prices, list):
        return {}
    return {p["mint"]: p["name"] for p in prices if "mint" in p and "name" in p}


def _parse_max_leverage(description: str) -> Optional[int]:
    """Extract max leverage from market description like 'JitoSOL-SOL 10x leverage pool'."""
    match = re.search(r"(\d+)x", description)
    return int(match.group(1)) if match else None


def _max_leverage_from_ltv(ltv: Optional[float]) -> Optional[float]:
    """Calculate max leverage from LTV: leverage = 1 / (1 - ltv).

    Returns float rounded to 1 decimal (e.g. 8.3x for LTV=0.88).
    """
    if ltv is None or ltv <= 0 or ltv >= 1:
        return None
    return round(1.0 / (1.0 - ltv), 1)


def _batch_snapshot_avg(
    db: Session, protocol_id: int, category: str,
) -> dict[str, dict[str, Optional[float]]]:
    """Compute 7d and 30d APY averages from snapshots for all opportunities in a category.

    Returns {external_id: {"7d": float|None, "30d": float|None}}.
    Only returns an average when snapshots cover at least half the window
    (i.e. the oldest snapshot is at least days/2 old).
    """
    now = datetime.now(timezone.utc)
    result: dict[str, dict[str, Optional[float]]] = {}

    for days, key in [(7, "7d"), (30, "30d")]:
        since = now - timedelta(days=days)
        half_window = now - timedelta(days=days // 2)
        # Subquery: opportunity IDs that have at least one snapshot older than half the window
        has_enough = (
            db.query(YieldSnapshot.opportunity_id)
            .join(YieldOpportunity, YieldOpportunity.id == YieldSnapshot.opportunity_id)
            .filter(
                YieldOpportunity.protocol_id == protocol_id,
                YieldOpportunity.category == category,
                YieldSnapshot.snapshot_at <= half_window,
            )
            .distinct()
            .subquery()
        )
        rows = (
            db.query(
                YieldOpportunity.external_id,
                sa_func.avg(YieldSnapshot.apy).label("avg_apy"),
            )
            .join(YieldSnapshot, YieldSnapshot.opportunity_id == YieldOpportunity.id)
            .filter(
                YieldOpportunity.id.in_(db.query(has_enough.c.opportunity_id)),
                YieldSnapshot.snapshot_at >= since,
                YieldSnapshot.apy.isnot(None),
            )
            .group_by(YieldOpportunity.external_id)
            .all()
        )
        for ext_id, avg_apy in rows:
            result.setdefault(ext_id, {})
            result[ext_id][key] = float(avg_apy) if avg_apy is not None else None

    return result


# ---------------------------------------------------------------------------
# Earn Vaults
# ---------------------------------------------------------------------------

def _fetch_vault_metrics(pubkey: str, client: httpx.Client) -> Optional[dict]:
    return _get(f"/kvaults/vaults/{pubkey}/metrics", client)


def fetch_earn_vaults(
    client: httpx.Client,
    mint_map: dict[str, str],
    protocol: Protocol,
    db: Session,
    now: datetime,
) -> int:
    vaults_raw = _get("/kvaults/vaults", client)
    if not isinstance(vaults_raw, list):
        logger.error("Unexpected /kvaults/vaults response")
        return 0

    active_vaults = [
        v for v in vaults_raw
        if int(v.get("state", {}).get("sharesIssued", "0") or "0") > 0
    ]
    logger.info("Kamino earn vaults: %d total, %d with shares", len(vaults_raw), len(active_vaults))

    vault_metrics: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=20) as pool:
        futures = {
            pool.submit(_fetch_vault_metrics, v["address"], client): v["address"]
            for v in active_vaults
        }
        for future in as_completed(futures):
            pubkey = futures[future]
            result = future.result()
            if result:
                vault_metrics[pubkey] = result

    logger.info("Fetched metrics for %d / %d vaults", len(vault_metrics), len(active_vaults))

    count = 0
    for vault in active_vaults:
        pubkey = vault["address"]
        metrics = vault_metrics.get(pubkey)
        if not metrics:
            continue

        tvl = (
            _float(metrics.get("tokensInvestedUsd", 0)) or 0
        ) + (
            _float(metrics.get("tokensAvailableUsd", 0)) or 0
        )

        if tvl < MIN_TVL_USD:
            continue

        token_mint = vault.get("state", {}).get("tokenMint", "")
        symbol = mint_map.get(token_mint, token_mint[:8])
        name = f"Kamino Earn — {symbol} ({pubkey[:6]})"

        apy_current = _float(metrics.get("apy"))
        apy_7d = _float(metrics.get("apy7d"))
        apy_30d = _float(metrics.get("apy30d"))

        if apy_current is not None:
            apy_current *= 100
        if apy_7d is not None:
            apy_7d *= 100
        if apy_30d is not None:
            apy_30d *= 100

        tokens_available_usd = _float(metrics.get("tokensAvailableUsd"))

        upsert_opportunity(
            db=db,
            protocol=protocol,
            external_id=pubkey,
            name=name,
            category="vault",
            tokens=[symbol],
            apy_current=apy_current,
            apy_7d_avg=apy_7d,
            apy_30d_avg=apy_30d,
            tvl_usd=tvl,
            deposit_address=pubkey,
            risk_tier="low",
            extra={
                "token_mint": token_mint,
                "shares_mint": vault.get("state", {}).get("sharesMint"),
                "protocol_url": f"{KAMINO_APP}/lending/earn/{pubkey}",
                "source": "kamino_api",
                "type": "earn_vault",
            },
            now=now,
            source="kamino_api",
            liquidity_available_usd=round(tokens_available_usd, 2) if tokens_available_usd is not None else None,
        )
        count += 1

    return count


# ---------------------------------------------------------------------------
# Lending Reserves (primary market only)
# ---------------------------------------------------------------------------

def fetch_lending_reserves(
    client: httpx.Client,
    mint_map: dict[str, str],
    protocol: Protocol,
    db: Session,
    now: datetime,
) -> int:
    markets_raw = _get("/v2/kamino-market", client)
    if not isinstance(markets_raw, list):
        logger.error("Unexpected /v2/kamino-market response")
        return 0

    primary_markets = [m for m in markets_raw if m.get("isPrimary")]
    logger.info("Kamino lending: %d primary markets", len(primary_markets))

    avg_map = _batch_snapshot_avg(db, protocol.id, "lending")

    count = 0
    for market in primary_markets:
        market_pubkey = market["lendingMarket"]
        market_name = market.get("name", market_pubkey[:8])

        reserves = _get(f"/kamino-market/{market_pubkey}/reserves/metrics", client)
        if not isinstance(reserves, list):
            continue

        for reserve in reserves:
            symbol = reserve.get("liquidityToken", "")
            token_mint = reserve.get("liquidityTokenMint", "")
            tvl = _float(reserve.get("totalSupplyUsd")) or 0

            if tvl < MIN_TVL_USD:
                continue

            supply_apy = _float(reserve.get("supplyApy"))
            borrow_apy = _float(reserve.get("borrowApy"))

            if supply_apy is not None:
                supply_apy *= 100
            if borrow_apy is not None:
                borrow_apy *= 100

            reserve_pubkey = reserve.get("reserve", "")
            external_id = f"klend-{market_pubkey[:8]}-{reserve_pubkey[:8]}"
            avgs = avg_map.get(external_id, {})

            upsert_opportunity(
                db=db,
                protocol=protocol,
                external_id=external_id,
                name=f"Kamino Lend — {symbol} ({market_name})",
                category="lending",
                tokens=[symbol],
                apy_current=supply_apy,
                apy_7d_avg=avgs.get("7d"),
                apy_30d_avg=avgs.get("30d"),
                tvl_usd=tvl,
                deposit_address=reserve_pubkey,
                risk_tier="low",
                extra={
                    "token_mint": token_mint,
                    "reserve": reserve_pubkey,
                    "protocol_url": f"{KAMINO_APP}/lending/reserve/{reserve_pubkey}/{market_pubkey}",
                    "supply_apy_raw": reserve.get("supplyApy"),
                    "borrow_apy_raw": reserve.get("borrowApy"),
                    "borrow_apy_pct": borrow_apy,
                    "max_ltv": reserve.get("maxLtv"),
                    "total_supply": reserve.get("totalSupply"),
                    "total_borrow": reserve.get("totalBorrow"),
                    "total_supply_usd": reserve.get("totalSupplyUsd"),
                    "total_borrow_usd": reserve.get("totalBorrowUsd"),
                    "market": market_pubkey,
                    "market_name": market_name,
                    "source": "kamino_api",
                    "type": "lending",
                },
                now=now,
                source="kamino_api",
            )
            count += 1

    return count


# ---------------------------------------------------------------------------
# Multiply Markets — one row per market (collateral/debt pair)
# ---------------------------------------------------------------------------

def _fetch_reserve_history(
    market_pk: str,
    reserve_pk: str,
    start: str,
    end: str,
    client: httpx.Client,
) -> list[dict]:
    """Fetch hourly reserve history for a date range."""
    data = _get(
        f"/kamino-market/{market_pk}/reserves/{reserve_pk}/metrics/history"
        f"?start={start}&end={end}",
        client,
    )
    if isinstance(data, dict):
        return data.get("history", [])
    return []


def _enumerate_collateral_debt_pairs(
    reserves: list[dict],
    is_primary: bool = False,
) -> list[tuple[dict, dict]]:
    """Enumerate valid collateral/debt pairs in a market.

    Collateral: reserves with maxLtv > 0.
    Debt: all other reserves with non-zero borrow activity or supply.
    For primary markets: only emit pairs where BOTH tokens are stables or
    yield-bearing stables (to avoid pair explosion).
    """
    collateral_candidates = [
        r for r in reserves if (_float(r.get("maxLtv", "0")) or 0) > 0
    ]
    if not collateral_candidates:
        return []

    pairs = []
    for coll in collateral_candidates:
        coll_symbol = coll.get("liquidityToken", "")
        for debt in reserves:
            if debt["reserve"] == coll["reserve"]:
                continue
            # Debt must have some activity
            debt_borrow = _float(debt.get("totalBorrowUsd", "0")) or 0
            debt_supply = _float(debt.get("totalSupplyUsd", "0")) or 0
            if debt_borrow <= 0 and debt_supply <= 0:
                continue

            debt_symbol = debt.get("liquidityToken", "")

            if is_primary:
                # Only stable-stable and rwa loops for primary markets
                tag = _classify_multiply_pair(coll_symbol, debt_symbol)
                if tag not in ("stable_loop", "rwa_loop"):
                    continue

            pairs.append((coll, debt))

    return pairs


def _avg_from_history(history: list[dict], field: str, last_n: int) -> Optional[float]:
    """Average a metrics field over the last N entries."""
    if not history:
        return None
    entries = history[-last_n:] if len(history) >= last_n else history
    values = []
    for h in entries:
        v = h.get("metrics", {}).get(field)
        if v is not None:
            values.append(float(v))
    return sum(values) / len(values) if values else None


def _linreg(x: list[float], y: list[float]) -> tuple[float, float]:
    """Simple linear regression. Returns (slope, intercept)."""
    n = len(x)
    sx = sum(x)
    sy = sum(y)
    sxy = sum(a * b for a, b in zip(x, y))
    sxx = sum(a * a for a in x)
    denom = n * sxx - sx * sx
    if denom == 0:
        return 0.0, 0.0
    slope = (n * sxy - sx * sy) / denom
    intercept = (sy - slope * sx) / n
    return slope, intercept


def _derive_collateral_yield(
    coll_history: list[dict],
    debt_history: list[dict],
    last_n: int,
) -> Optional[float]:
    """Derive annualised collateral yield via linear regression over price ratio.

    Uses linear regression (least squares fit) over the hourly price ratio
    time series instead of comparing start/end points. This smooths out
    oracle noise and gives a more stable annualised yield estimate.
    """
    usable = min(len(coll_history), len(debt_history))
    if usable < last_n:
        if usable < 48:  # need at least 2 days
            return None
        last_n = usable

    # Build ratio time series for the window
    ratios = []
    ch = coll_history[-last_n:]
    dh = debt_history[-last_n:]
    for i in range(min(len(ch), len(dh))):
        try:
            cp = float(ch[i]["metrics"]["assetPriceUSD"])
            dp = float(dh[i]["metrics"]["assetPriceUSD"])
            if dp > 0:
                ratios.append(cp / dp)
        except (KeyError, TypeError, ValueError):
            continue

    if len(ratios) < 48:
        return None

    # Linear regression: ratio = slope * hour + intercept
    hours = list(range(len(ratios)))
    slope, _ = _linreg(hours, ratios)
    avg_ratio = sum(ratios) / len(ratios)

    if avg_ratio <= 0:
        return None

    # Annualise: slope is change per hour, multiply by 8760 hours/year
    return (slope * 8760) / avg_ratio


def _get_collateral_yield(
    coll_symbol: str,
    coll_history: list[dict],
    debt_history: list[dict],
    coll_reserve: dict,
    last_n: int,
) -> tuple[Optional[float], str]:
    """Dispatch collateral yield calculation by token type.

    Returns (yield_as_decimal_or_None, apy_source_string).
    """
    token_type = _classify_token(coll_symbol)

    if token_type == "yield_bearing_stable":
        # Price ratio linreg IS their yield (price appreciation vs debt stablecoin)
        result = _derive_collateral_yield(coll_history, debt_history, last_n)
        return result, "price_ratio"

    if token_type == "stable":
        # Use supplyApy from reserve metrics
        supply_apy = _float(coll_reserve.get("supplyApy"))
        return supply_apy, "supply_apy"

    if token_type == "lst":
        # Try staking APY from history, fall back to price ratio linreg
        result = _derive_collateral_yield(coll_history, debt_history, last_n)
        if result is not None:
            return result, "staking_apy"
        return None, "unavailable"

    # volatile — price movement ≠ yield
    return None, "unavailable"


def _compute_net_apy(
    collateral_yield: Optional[float],
    borrow_apy: Optional[float],
    leverage: int,
) -> Optional[float]:
    """net_apy = (collateral_yield × leverage) − (borrow_apy × (leverage − 1))"""
    if collateral_yield is None or borrow_apy is None:
        return None
    return (collateral_yield * leverage) - (borrow_apy * (leverage - 1))


def fetch_multiply_markets(
    client: httpx.Client,
    protocol: Protocol,
    db: Session,
    now: datetime,
) -> tuple[int, set[str]]:
    """Fetch multiply markets. Returns (count, set_of_external_ids)."""
    markets_raw = _get("/v2/kamino-market", client)
    if not isinstance(markets_raw, list):
        logger.error("Unexpected /v2/kamino-market response")
        return 0, set()

    # Include ALL markets (primary + non-primary); primary markets will be
    # filtered to stable-only pairs by _enumerate_collateral_debt_pairs.
    multiply_markets = [m for m in markets_raw if m.get("name")]
    logger.info("Kamino multiply: %d markets (incl primary)", len(multiply_markets))

    # Date range strings for history queries
    end_str = now.strftime("%Y-%m-%d")
    start_30d = (now - timedelta(days=30)).strftime("%Y-%m-%d")

    count = 0
    upserted_ids: set[str] = set()

    for market in multiply_markets:
        market_pubkey = market["lendingMarket"]
        market_name = market.get("name", market_pubkey[:8])
        market_description = market.get("description", "")
        is_primary = bool(market.get("isPrimary"))

        reserves = _get(f"/kamino-market/{market_pubkey}/reserves/metrics", client)
        if not isinstance(reserves, list):
            continue

        # Calculate total market TVL
        market_tvl = sum(_float(r.get("totalSupplyUsd", "0")) or 0 for r in reserves)
        if market_tvl < MIN_TVL_USD:
            continue

        # Enumerate all valid collateral/debt pairs
        pairs = _enumerate_collateral_debt_pairs(reserves, is_primary=is_primary)
        if not pairs:
            logger.debug("Skipping %s — no valid pairs", market_name)
            continue

        # Cache reserve history per market (fetch each unique reserve once)
        reserve_histories: dict[str, list[dict]] = {}

        def _get_history(reserve_pk: str) -> list[dict]:
            if reserve_pk not in reserve_histories:
                reserve_histories[reserve_pk] = _fetch_reserve_history(
                    market_pubkey, reserve_pk, start_30d, end_str, client,
                )
            return reserve_histories[reserve_pk]

        # Max leverage from description (applies to single-pair eMode markets)
        max_leverage_from_desc = _parse_max_leverage(market_description)

        for coll_reserve, debt_reserve in pairs:
            coll_symbol = coll_reserve.get("liquidityToken", "")
            debt_symbol = debt_reserve.get("liquidityToken", "")
            coll_pk = coll_reserve["reserve"]
            debt_pk = debt_reserve["reserve"]

            # Pair-specific leverage from LTV
            coll_ltv_val = _float(coll_reserve.get("maxLtv"))
            # For single-pair markets, description leverage is accurate.
            # For multi-pair markets, use per-reserve LTV.
            if max_leverage_from_desc and len(pairs) == 1:
                max_leverage = max_leverage_from_desc
            else:
                max_leverage = _max_leverage_from_ltv(coll_ltv_val)

            # Current borrow APY (cost of leverage)
            borrow_apy_current = _float(debt_reserve.get("borrowApy"))

            # Fetch history (cached per reserve)
            coll_history = _get_history(coll_pk)
            debt_history = _get_history(debt_pk)

            # Average borrow APY from history
            borrow_avg_7d = _avg_from_history(debt_history, "borrowInterestAPY", 168)
            borrow_avg_30d = _avg_from_history(debt_history, "borrowInterestAPY", 720)

            # Collateral yield — dispatched by token type
            coll_yield_7d, apy_source = _get_collateral_yield(
                coll_symbol, coll_history, debt_history, coll_reserve, 168,
            )
            coll_yield_30d, _ = _get_collateral_yield(
                coll_symbol, coll_history, debt_history, coll_reserve, 720,
            )

            # Net APY at max leverage
            effective_leverage = max_leverage or 3
            net_apy_current = _compute_net_apy(coll_yield_30d, borrow_apy_current, effective_leverage)
            net_apy_7d = _compute_net_apy(coll_yield_30d, borrow_avg_7d, effective_leverage)
            net_apy_30d = _compute_net_apy(coll_yield_30d, borrow_avg_30d, effective_leverage)

            def to_pct(v: Optional[float]) -> Optional[float]:
                return v * 100 if v is not None else None

            net_apy_current_pct = to_pct(net_apy_current)
            net_apy_7d_pct = to_pct(net_apy_7d)
            net_apy_30d_pct = to_pct(net_apy_30d)

            # Build leverage APY table
            leverage_table = {}
            lev_steps = [2, 3, 5, 8, 10]
            if effective_leverage not in lev_steps:
                lev_steps.append(effective_leverage)
                lev_steps.sort()
            for lev in lev_steps:
                if max_leverage and lev > max_leverage + 0.1:
                    continue
                apy_current_lev = _compute_net_apy(coll_yield_30d, borrow_apy_current, lev)
                apy_7d_lev = _compute_net_apy(coll_yield_30d, borrow_avg_7d, lev)
                apy_30d_lev = _compute_net_apy(coll_yield_30d, borrow_avg_30d, lev)
                leverage_table[f"{lev}x"] = {
                    "net_apy_current_pct": to_pct(apy_current_lev),
                    "net_apy_7d_pct": to_pct(apy_7d_lev),
                    "net_apy_30d_pct": to_pct(apy_30d_lev),
                }

            # Extract richer data from reserve history
            latest_coll_metrics = coll_history[-1].get("metrics", {}) if coll_history else {}
            latest_debt_metrics = debt_history[-1].get("metrics", {}) if debt_history else {}

            coll_total_supply_tokens = _float(latest_coll_metrics.get("totalSupply"))
            coll_price = _float(latest_coll_metrics.get("assetPriceUSD"))
            if coll_total_supply_tokens is not None and coll_price is not None:
                collateral_supplied_usd = coll_total_supply_tokens * coll_price
            else:
                collateral_supplied_usd = _float(coll_reserve.get("totalSupplyUsd")) or 0

            debt_total_supply = _float(latest_debt_metrics.get("totalSupply")) or _float(debt_reserve.get("totalSupply")) or 0
            debt_total_borrow = _float(latest_debt_metrics.get("totalBorrows")) or _float(debt_reserve.get("totalBorrow")) or 0
            debt_decimals = int(latest_debt_metrics.get("decimals", 6))
            debt_borrow_limit_raw = _float(latest_debt_metrics.get("reserveBorrowLimit")) or 0
            debt_borrow_limit = debt_borrow_limit_raw / (10 ** debt_decimals) if debt_borrow_limit_raw > 0 else float("inf")
            debt_price = _float(latest_debt_metrics.get("assetPriceUSD")) or 1.0

            supply_available = debt_total_supply - debt_total_borrow
            borrow_limit_remaining = debt_borrow_limit - debt_total_borrow
            liq_available_tokens = max(0, min(supply_available, borrow_limit_remaining))
            liq_available_usd = liq_available_tokens * debt_price

            coll_deposit_limit_raw = _float(latest_coll_metrics.get("reserveDepositLimit")) or 0
            coll_decimals = int(latest_coll_metrics.get("decimals", 6))
            coll_deposit_limit = coll_deposit_limit_raw / (10 ** coll_decimals) if coll_deposit_limit_raw > 0 else None

            utilization = (debt_total_borrow / debt_total_supply * 100) if debt_total_supply > 0 else 0

            coll_ltv_history = latest_coll_metrics.get("loanToValue") or coll_ltv_val
            coll_liq_threshold = latest_coll_metrics.get("liquidationThreshold")
            borrow_curve = latest_debt_metrics.get("borrowCurve")

            vault_tag = _classify_multiply_pair(coll_symbol, debt_symbol)
            external_id = f"kmul-{market_pubkey[:8]}-{coll_pk[:6]}-{debt_pk[:6]}"
            name = f"Kamino Multiply — {coll_symbol}/{debt_symbol} ({market_name})"

            extra = {
                # Deep link
                "protocol_url": "https://kamino.com/multiply",
                # Market info
                "market": market_pubkey,
                "market_name": market_name,
                "market_description": market_description,
                "market_lookup_table": market.get("lookupTable", ""),
                "market_is_curated": market.get("isCurated", False),
                "max_leverage": max_leverage,
                # Classification & source
                "vault_tag": vault_tag,
                "apy_source": apy_source,
                # Collateral reserve
                "collateral_symbol": coll_symbol,
                "collateral_mint": coll_reserve.get("liquidityTokenMint", ""),
                "collateral_reserve": coll_pk,
                "collateral_reserve_supply_usd": collateral_supplied_usd,
                "collateral_supply_tokens": coll_total_supply_tokens,
                "collateral_price_usd": coll_price,
                "collateral_deposit_limit": coll_deposit_limit,
                "debt_available_usd": liq_available_usd,
                "debt_available_tokens": liq_available_tokens,
                "debt_borrow_limit": debt_borrow_limit if debt_borrow_limit != float("inf") else None,
                "debt_borrow_limit_remaining": borrow_limit_remaining if debt_borrow_limit != float("inf") else None,
                "debt_price_usd": debt_price,
                "collateral_ltv": coll_ltv_history,
                "collateral_liquidation_threshold": coll_liq_threshold,
                # Collateral yield
                "collateral_yield_7d_pct": to_pct(coll_yield_7d),
                "collateral_yield_30d_pct": to_pct(coll_yield_30d),
                # Debt reserve
                "debt_symbol": debt_symbol,
                "debt_mint": debt_reserve.get("liquidityTokenMint", ""),
                "debt_reserve": debt_pk,
                "debt_supply_usd": debt_total_supply * debt_price,
                "debt_borrow_usd": debt_total_borrow * debt_price,
                # Borrow cost
                "borrow_apy_current_pct": to_pct(borrow_apy_current),
                "borrow_apy_7d_pct": to_pct(borrow_avg_7d),
                "borrow_apy_30d_pct": to_pct(borrow_avg_30d),
                # Utilization & rate curve
                "utilization_pct": round(utilization, 2),
                "borrow_curve": borrow_curve,
                # Net APY at max leverage
                "net_apy_current_pct": net_apy_current_pct,
                "net_apy_7d_pct": net_apy_7d_pct,
                "net_apy_30d_pct": net_apy_30d_pct,
                "leverage_used": effective_leverage,
                # APY at each leverage level
                "leverage_table": leverage_table,
                # All reserves summary
                "all_reserves": [
                    {
                        "symbol": r.get("liquidityToken"),
                        "mint": r.get("liquidityTokenMint"),
                        "reserve": r.get("reserve"),
                        "max_ltv": r.get("maxLtv"),
                        "supply_apy": r.get("supplyApy"),
                        "borrow_apy": r.get("borrowApy"),
                        "total_supply_usd": r.get("totalSupplyUsd"),
                        "total_borrow_usd": r.get("totalBorrowUsd"),
                    }
                    for r in reserves
                ],
                "source": "kamino_api",
                "type": "multiply",
            }

            opp = upsert_opportunity(
                db=db,
                protocol=protocol,
                external_id=external_id,
                name=name,
                category="multiply",
                tokens=[coll_symbol, debt_symbol],
                apy_current=net_apy_current_pct,
                apy_7d_avg=net_apy_7d_pct,
                apy_30d_avg=net_apy_30d_pct,
                tvl_usd=market_tvl,
                deposit_address=coll_pk,
                risk_tier="high" if (max_leverage or 0) >= 8 else "medium",
                extra=extra,
                now=now,
                source="kamino_api",
            )
            opp.liquidity_available_usd = liq_available_usd
            upserted_ids.add(external_id)
            count += 1
            logger.info(
                "Multiply %s: %.1fx, src=%s, borrow=%.2f%%, coll_yield_7d=%s, net_7d=%s",
                name,
                effective_leverage,
                apy_source,
                (borrow_apy_current or 0) * 100,
                f"{coll_yield_7d * 100:.2f}%" if coll_yield_7d else "N/A",
                f"{net_apy_7d_pct:.2f}%" if net_apy_7d_pct else "N/A",
            )

    return count, upserted_ids


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def fetch_kamino_yields() -> int:
    """Fetch Kamino earn vaults + lending reserves + multiply markets.

    Returns total number of opportunities updated/inserted.
    """
    logger.info("Starting Kamino yield fetch")
    now = datetime.now(timezone.utc)

    db: Session = SessionLocal()
    try:
        protocol = db.query(Protocol).filter(Protocol.slug == "kamino").first()
        if not protocol:
            logger.error("Protocol 'kamino' not found in DB — run seed first")
            return 0

        with httpx.Client() as client:
            mint_map = _build_mint_map(client)
            logger.info("Loaded %d token symbols from oracle", len(mint_map))

            earn_count = fetch_earn_vaults(client, mint_map, protocol, db, now)
            lend_count = fetch_lending_reserves(client, mint_map, protocol, db, now)
            mul_count, mul_ids = fetch_multiply_markets(client, protocol, db, now)

        # Deactivate stale multiply entries not in current run
        stale_rows = (
            db.query(YieldOpportunity)
            .filter(
                YieldOpportunity.external_id.like("kmul-%"),
                YieldOpportunity.is_active.is_(True),
            )
            .all()
        )
        deactivated = 0
        for row in stale_rows:
            if row.external_id not in mul_ids:
                row.is_active = False
                deactivated += 1
        if deactivated:
            logger.info("Deactivated %d stale multiply entries", deactivated)

        db.commit()
        total = earn_count + lend_count + mul_count
        logger.info(
            "Kamino fetch complete: %d earn vaults + %d lending reserves + %d multiply markets",
            earn_count, lend_count, mul_count,
        )
        return total

    except Exception as exc:
        db.rollback()
        logger.error("Kamino fetch failed: %s", exc)
        raise
    finally:
        db.close()
