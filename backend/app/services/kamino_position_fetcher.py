"""Fetch user positions from Kamino Finance API and store snapshots.

Kamino API endpoints used:
  - GET /kvaults/users/{wallet}/positions — Earn Vault positions
  - GET /kvaults/{vault}/users/{wallet}/pnl — Per-vault P&L
  - GET /kvaults/users/{wallet}/transactions — Vault deposit/withdraw history
  - GET /kamino-market/{market}/users/{wallet}/obligations — Lending + Multiply obligations
  - GET /v2/kamino-market/{market}/users/{wallet}/transactions — Obligation tx history
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.models.base import SessionLocal
from app.models.user_position import TrackedWallet, UserPositionEvent
from app.models.yield_opportunity import YieldOpportunity
from app.services.utils import safe_float, get_with_retry, get_or_none, cached, parse_timestamp, compute_realized_apy

logger = logging.getLogger(__name__)

KAMINO_API = "https://api.kamino.finance"

# Well-known Solana token mints → symbols (fallback when API omits tokenSymbol)
_KNOWN_MINTS: dict[str, str] = {
    "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
    "So11111111111111111111111111111111111111112": "SOL",
    "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn": "JITOSOL",
    "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": "MSOL",
    "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": "stSOL",
    "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1": "bSOL",
}


def _get(path: str, client: httpx.Client) -> Optional[dict | list]:
    return get_or_none(f"{KAMINO_API}{path}", client, log_label="Kamino API")


_float = safe_float
_parse_timestamp = parse_timestamp
_cached = cached


def _load_opportunity_map(db: Session) -> dict[str, dict]:
    """Batch-load all active opportunities keyed by deposit_address AND external_id.

    Returns {key: {"id": ..., "apy_current": ...}} where key is either
    deposit_address or external_id.  The external_id index is essential for
    multiply positions where multiple entries share the same collateral reserve
    (deposit_address) but differ by debt token.
    """
    rows = (
        db.query(
            YieldOpportunity.id,
            YieldOpportunity.deposit_address,
            YieldOpportunity.external_id,
            YieldOpportunity.apy_current,
        )
        .filter(YieldOpportunity.is_active.is_(True))
        .all()
    )
    result: dict[str, dict] = {}
    for row in rows:
        entry = {
            "id": row.id,
            "apy_current": float(row.apy_current) if row.apy_current is not None else None,
        }
        if row.deposit_address:
            result[row.deposit_address] = entry
        if row.external_id:
            result[row.external_id] = entry
    return result


def _match_opportunity(external_id: str, opp_map: dict[str, dict]) -> Optional[int]:
    """Link a position to a YieldOpportunity by deposit_address (in-memory lookup)."""
    entry = opp_map.get(external_id)
    return entry["id"] if entry else None


def _lookup_opportunity_apy(deposit_address: str, opp_map: dict[str, dict]) -> Optional[float]:
    """Get current APY from pre-loaded opportunity map."""
    entry = opp_map.get(deposit_address)
    return entry["apy_current"] if entry else None


def _get_all_markets(client: httpx.Client) -> list[dict]:
    """Fetch all Kamino lending markets with metadata (cached 10 min)."""
    def _fetch():
        markets = _get("/v2/kamino-market", client)
        if not isinstance(markets, list):
            return []
        return [m for m in markets if m.get("lendingMarket")]
    return _cached("all_markets", 600, _fetch)


def _build_reserve_map(market_pk: str, client: httpx.Client) -> dict[str, dict]:
    """Build {reserve_pubkey: {symbol, mint, supply_apy, borrow_apy}} (cached 3 min per market)."""
    def _fetch():
        reserves = _get(f"/kamino-market/{market_pk}/reserves/metrics", client)
        if not isinstance(reserves, list):
            return {}
        result = {}
        for r in reserves:
            if "reserve" not in r:
                continue
            result[r["reserve"]] = {
                "symbol": r.get("liquidityToken", ""),
                "mint": r.get("liquidityTokenMint", ""),
                "supply_apy": _float(r.get("supplyInterestAPY", r.get("supplyApy"))),
                "borrow_apy": _float(r.get("borrowInterestAPY", r.get("borrowApy"))),
            }
        return result
    return _cached(f"reserve_map:{market_pk}", 180, _fetch)


# ---------------------------------------------------------------------------
# Obligation transaction fetching & PnL computation
# ---------------------------------------------------------------------------

def _fetch_obligation_transactions(
    market_pk: str, wallet: str, client: httpx.Client,
) -> dict[str, list[dict]]:
    """Fetch obligation transaction history for a market.

    GET /v2/kamino-market/{market}/users/{wallet}/transactions
    Returns: {obligation_address: [tx, ...]} grouped by obligation.
    """
    raw = _get(f"/v2/kamino-market/{market_pk}/users/{wallet}/transactions", client)
    if raw is None:
        return {}

    # API returns {obligation_address: [tx, ...]} dict, not a flat list
    if isinstance(raw, dict):
        by_obligation: dict[str, list[dict]] = {}
        for obligation_addr, txs in raw.items():
            if isinstance(txs, list) and txs:
                by_obligation[obligation_addr] = txs
        # Sort each obligation's txs by timestamp ascending (oldest first)
        for txs in by_obligation.values():
            txs.sort(key=lambda t: t.get("createdOn", ""))
        return by_obligation

    # Fallback: handle flat list format (legacy/unexpected)
    if isinstance(raw, list):
        by_obligation = {}
        for tx in raw:
            obligation = tx.get("obligationAddress", "")
            if not obligation:
                continue
            by_obligation.setdefault(obligation, []).append(tx)
        for txs in by_obligation.values():
            txs.sort(key=lambda t: t.get("createdOn", ""))
        return by_obligation

    return {}


_TX_TYPE_MAP = {
    "deposit": "deposit",
    "create": "deposit",
    "withdraw": "withdraw",
    "borrow": "borrow",
    "repay": "repay",
    "depositandborrow": "deposit",
    "withdrawandrepay": "withdraw",
    "leverageanddeposit": "leverage",
    "deleverageandwithdraw": "deleverage",
}


def _find_lifecycle_start(txs: list[dict]) -> list[dict]:
    """Detect full-withdrawal resets and return txs from the current lifecycle only.

    If the running equity balance drops to ~$0 at any point, the user closed and
    re-opened under the same obligation address. Only deposit/withdraw are tracked
    — borrow/repay are leverage mechanics that would cause false resets.
    """
    reset_idx = None
    running = 0.0
    seen_deposit = False
    for i, tx in enumerate(txs):
        display_name = (tx.get("transactionDisplayName") or "").lower()
        usd_val = _float(tx.get("liquidityUsdValue")) or 0.0
        category = _TX_TYPE_MAP.get(display_name)
        if category == "deposit":
            running += usd_val
            if usd_val > 0:
                seen_deposit = True
        elif category == "withdraw":
            running -= usd_val
        if seen_deposit and running < 0.01 and i < len(txs) - 1:
            reset_idx = i + 1
            running = 0.0
            seen_deposit = False
    return txs[reset_idx:] if reset_idx is not None else txs


def _accumulate_cash_flows(txs: list[dict]) -> dict:
    """Sum deposits/withdraws/borrows/repays and build time-weighted cash flows.

    Returns dict with sum_deposit, sum_withdraw, sum_borrow, sum_repay,
    cash_flows, token_symbol, opened_at.
    """
    sum_deposit = 0.0
    sum_withdraw = 0.0
    sum_borrow = 0.0
    sum_repay = 0.0
    cash_flows: list[tuple[datetime, float]] = []
    token_symbol = None
    opened_at = None

    for tx in txs:
        display_name = (tx.get("transactionDisplayName") or "").lower()
        usd_val = _float(tx.get("liquidityUsdValue")) or 0.0
        tx_time = _parse_timestamp(tx.get("createdOn"))
        category = _TX_TYPE_MAP.get(display_name)

        if category == "deposit":
            sum_deposit += usd_val
            if tx_time and usd_val > 0:
                cash_flows.append((tx_time, usd_val))
        elif category == "withdraw":
            sum_withdraw += usd_val
            if tx_time and usd_val > 0:
                cash_flows.append((tx_time, -usd_val))
        elif category == "borrow":
            sum_borrow += usd_val
            if tx_time and usd_val > 0:
                cash_flows.append((tx_time, -usd_val))
        elif category == "repay":
            sum_repay += usd_val
            if tx_time and usd_val > 0:
                cash_flows.append((tx_time, usd_val))

        if category == "deposit" and opened_at is None and tx_time:
            opened_at = tx_time
        if token_symbol is None and tx.get("liquidityToken"):
            token_symbol = tx["liquidityToken"]

    return {
        "sum_deposit": sum_deposit, "sum_withdraw": sum_withdraw,
        "sum_borrow": sum_borrow, "sum_repay": sum_repay,
        "cash_flows": cash_flows, "token_symbol": token_symbol,
        "opened_at": opened_at,
    }


def _compute_modified_dietz(
    cf: dict, current_net_value: float, now: datetime,
) -> dict:
    """Compute PnL, APY, and position metadata using Modified Dietz method."""
    sum_deposit = cf["sum_deposit"]
    sum_withdraw = cf["sum_withdraw"]
    sum_borrow = cf["sum_borrow"]
    sum_repay = cf["sum_repay"]
    cash_flows = cf["cash_flows"]
    opened_at = cf["opened_at"]

    net_equity = sum_deposit - sum_withdraw - sum_borrow + sum_repay
    initial_deposit_usd = net_equity if net_equity > 0 else sum_deposit
    is_closed = current_net_value < 0.01

    closed_at = None
    close_value_usd = None
    if is_closed:
        close_value_usd = sum_withdraw + sum_repay - sum_borrow

    held_days = None
    T = None
    if opened_at:
        end_time = closed_at if is_closed and closed_at else now
        T = (end_time - opened_at).total_seconds() / 86400.0
        held_days = T

    pnl_usd = None
    pnl_pct = None

    if T and T > 0 and cash_flows:
        total_net_cf = sum(c for _, c in cash_flows)
        weighted_capital = 0.0
        for cf_time, cf_amount in cash_flows:
            days_from_start = (cf_time - opened_at).total_seconds() / 86400.0
            w_i = max(0.0, min(1.0, (T - days_from_start) / T))
            weighted_capital += cf_amount * w_i

        v_end = 0.0 if is_closed else current_net_value
        pnl_usd = v_end - total_net_cf

        if weighted_capital > 0:
            modified_dietz_return = pnl_usd / weighted_capital
            pnl_pct = modified_dietz_return * 100

    return {
        "initial_deposit_usd": round(initial_deposit_usd, 2) if initial_deposit_usd else None,
        "pnl_usd": round(pnl_usd, 2) if pnl_usd is not None else None,
        "pnl_pct": round(pnl_pct, 4) if pnl_pct is not None else None,
        "opened_at": opened_at,
        "held_days": round(held_days, 4) if held_days is not None else None,
        "token_symbol": cf["token_symbol"],
        "is_closed": is_closed,
        "closed_at": closed_at if is_closed else None,
        "close_value_usd": round(close_value_usd, 2) if is_closed and close_value_usd is not None else None,
    }


def _compute_obligation_pnl(txs: list[dict], current_net_value: float, now: datetime) -> dict:
    """Compute PnL, APY, and metadata from obligation transaction history."""
    txs = _find_lifecycle_start(txs)
    cf = _accumulate_cash_flows(txs)

    logger.info(
        "obligation tx breakdown: deposit=%.2f withdraw=%.2f borrow=%.2f repay=%.2f "
        "net_value=%.2f | tx_types=%s",
        cf["sum_deposit"], cf["sum_withdraw"], cf["sum_borrow"], cf["sum_repay"],
        current_net_value,
        [tx.get("transactionDisplayName", "?") for tx in txs],
    )

    result = _compute_modified_dietz(cf, current_net_value, now)

    # Find closed_at from last tx timestamp for closed positions
    if result["is_closed"]:
        for tx in reversed(txs):
            t = _parse_timestamp(tx.get("createdOn"))
            if t:
                result["closed_at"] = t
                break

    return result


def _obligation_txs_to_events(
    txs: list[dict], wallet: str, obligation_address: str, product_type: str,
) -> list[dict]:
    """Convert obligation transactions to the common UserPositionEvent format."""
    events = []
    for tx in txs:
        display_name = (tx.get("transactionDisplayName") or "unknown").lower()
        event_at = _parse_timestamp(tx.get("createdOn"))
        if not event_at:
            event_at = datetime.now(timezone.utc)

        events.append({
            "wallet_address": wallet,
            "protocol_slug": "kamino",
            "product_type": product_type,
            "external_id": obligation_address,
            "event_type": display_name,
            "amount": _float(tx.get("liquidityAmount")),
            "amount_usd": _float(tx.get("liquidityUsdValue")),
            "tx_signature": tx.get("transactionSignature"),
            "event_at": event_at,
            "extra_data": {
                "token_symbol": tx.get("liquidityToken"),
                "token_mint": tx.get("liquidityTokenMint"),
                "obligation_type": tx.get("obligationType"),
            },
        })
    return events


# ---------------------------------------------------------------------------
# Earn Vault positions
# ---------------------------------------------------------------------------

def _fetch_earn_positions(
    wallet: str, client: httpx.Client, db: Session, now: datetime,
    opp_map: dict[str, dict] | None = None,
) -> list[dict]:
    """Fetch Earn Vault positions via transaction-history discovery.

    The list endpoint ``/kvaults/users/{wallet}/positions`` returns empty
    for staked vault positions (Kamino auto-stakes shares into farms).
    Instead we:
      1. Fetch ``/kvaults/users/{wallet}/transactions`` → unique vault addresses
      2. Query each vault directly via ``/kvaults/users/{wallet}/positions/{vault}``
      3. Skip vaults where ``totalShares == 0`` (fully withdrawn)
      4. Get USD value from per-vault metrics history
      5. Get P&L from ``/kvaults/{vault}/users/{wallet}/pnl``
    """
    # Step 1: discover vaults from transaction history
    txs_raw = _get(f"/kvaults/users/{wallet}/transactions", client)
    if not isinstance(txs_raw, list) or not txs_raw:
        return []

    # Build vault → token info and first deposit timestamp from transactions.
    # Transactions are ordered newest-first; first occurrence has latest prices.
    vault_token_info: dict[str, dict] = {}
    first_deposit_ts: dict[str, datetime] = {}
    for tx in txs_raw:
        vault = tx.get("kvault", "")
        if not vault:
            continue
        if vault not in vault_token_info:
            mint = tx.get("tokenMint", "")
            symbol = tx.get("tokenSymbol") or _KNOWN_MINTS.get(mint)
            vault_token_info[vault] = {
                "token_mint": mint,
                "token_symbol": symbol,
                "share_price": _float(tx.get("sharePrice")),
                "token_price": _float(tx.get("tokenPrice")),
            }
        if "deposit" in (tx.get("instruction") or "").lower():
            ts = _parse_timestamp(tx.get("createdOn"))
            if ts and (vault not in first_deposit_ts or ts < first_deposit_ts[vault]):
                first_deposit_ts[vault] = ts

    results = []
    for vault_address, token_info in vault_token_info.items():
        # Step 2: get position for this specific vault
        pos_data = _get(
            f"/kvaults/users/{wallet}/positions/{vault_address}", client,
        )
        if not isinstance(pos_data, dict):
            continue

        total_shares = _float(pos_data.get("totalShares"))
        # Step 3: skip if no shares (fully withdrawn)
        if not total_shares or total_shares <= 0:
            continue

        staked_shares = _float(pos_data.get("stakedShares"))
        unstaked_shares = _float(pos_data.get("unstakedShares"))

        # Step 4: get USD value from metrics history
        start_ts = int((now - timedelta(hours=24)).timestamp())
        end_ts = int(now.timestamp())
        metrics_data = _get(
            f"/kvaults/users/{wallet}/vaults/{vault_address}"
            f"/metrics/history?start={start_ts}&end={end_ts}",
            client,
        )
        deposit_amount_usd = None
        deposit_amount = None
        if isinstance(metrics_data, list) and metrics_data:
            last_entry = metrics_data[-1]
            deposit_amount_usd = _float(last_entry.get("totalValueUsd",
                                        last_entry.get("totalValue")))
            deposit_amount = _float(last_entry.get("tokenAmount"))

        # Fallback: compute from shares x share_price x token_price
        if deposit_amount_usd is None:
            share_price = token_info.get("share_price")
            token_price = token_info.get("token_price")
            if share_price and token_price and total_shares:
                deposit_amount = total_shares * share_price
                deposit_amount_usd = deposit_amount * token_price

        # Step 5: P&L
        pnl_data = _get(f"/kvaults/{vault_address}/users/{wallet}/pnl", client)
        pnl_usd = None
        pnl_pct = None
        cost_basis_usd = None
        if isinstance(pnl_data, dict):
            # API returns {"totalPnl": {"usd": ...}, "totalCostBasis": {"usd": ...}}
            total_pnl = pnl_data.get("totalPnl")
            if isinstance(total_pnl, dict):
                pnl_usd = _float(total_pnl.get("usd"))
            else:
                # Fallback for alternative response shape
                pnl_usd = _float(pnl_data.get("pnlUsd"))

            total_cost_basis = pnl_data.get("totalCostBasis")
            if isinstance(total_cost_basis, dict):
                cost_basis_usd = _float(total_cost_basis.get("usd"))
            else:
                cost_basis_usd = _float(pnl_data.get("costBasisUsd"))

            if cost_basis_usd and cost_basis_usd > 0 and pnl_usd is not None:
                pnl_pct = (pnl_usd / cost_basis_usd) * 100

        _omap = opp_map if opp_map is not None else _load_opportunity_map(db)
        opportunity_id = _match_opportunity(vault_address, _omap)

        # Earn vault APY: lookup from yield_opportunities table
        earn_apy = _lookup_opportunity_apy(vault_address, _omap)

        token_sym = token_info.get("token_symbol")
        opened_at = first_deposit_ts.get(vault_address)
        held_days = round((now - opened_at).total_seconds() / 86400.0, 4) if opened_at else None

        results.append({
            "wallet_address": wallet,
            "protocol_slug": "kamino",
            "product_type": "earn_vault",
            "external_id": vault_address,
            "opportunity_id": opportunity_id,
            "deposit_amount": deposit_amount,
            "deposit_amount_usd": deposit_amount_usd,
            "pnl_usd": pnl_usd,
            "pnl_pct": pnl_pct,
            "initial_deposit_usd": cost_basis_usd,
            "opened_at": opened_at,
            "held_days": held_days,
            "apy": earn_apy,
            "apy_realized": compute_realized_apy(pnl_usd, cost_basis_usd, held_days),
            "is_closed": False,
            "closed_at": None,
            "close_value_usd": None,
            "token_symbol": token_sym,
            "extra_data": {
                "shares": total_shares,
                "staked_shares": staked_shares,
                "unstaked_shares": unstaked_shares,
                "cost_basis_usd": cost_basis_usd,
                "token_mint": token_info.get("token_mint"),
                "token_symbol": token_sym,
            },
            "snapshot_at": now,
        })

    return results


# ---------------------------------------------------------------------------
# Lending + Multiply obligations
# ---------------------------------------------------------------------------

def _resolve_forward_apy(
    product_type: str, market_pk: str,
    collateral_reserves: list[str], borrow_reserves: list[str],
    leverage: Optional[float], reserve_map: dict, opp_map: dict,
) -> Optional[float]:
    """Resolve forward-looking APY (what Kamino UI shows — current market rates)."""
    forward_apy = None
    if product_type == "multiply" and collateral_reserves and borrow_reserves:
        mul_ext_id = f"kmul-{market_pk[:8]}-{collateral_reserves[0][:6]}-{borrow_reserves[0][:6]}"
        forward_apy = _lookup_opportunity_apy(mul_ext_id, opp_map)
    if forward_apy is None and collateral_reserves:
        forward_apy = _lookup_opportunity_apy(collateral_reserves[0], opp_map)
    if forward_apy is None and collateral_reserves and product_type == "lending":
        supply_apy = reserve_map.get(collateral_reserves[0], {}).get("supply_apy")
        if supply_apy is not None:
            forward_apy = supply_apy * 100
    if (forward_apy is None and product_type == "multiply"
            and collateral_reserves and borrow_reserves and leverage and leverage > 1):
        coll_supply = reserve_map.get(collateral_reserves[0], {}).get("supply_apy")
        debt_borrow = reserve_map.get(borrow_reserves[0], {}).get("borrow_apy")
        if coll_supply is not None and debt_borrow is not None:
            forward_apy = (coll_supply * leverage - debt_borrow * (leverage - 1)) * 100
    return forward_apy


def _fetch_obligation_positions(
    wallet: str, client: httpx.Client, db: Session, now: datetime,
    all_markets: list[dict] | None = None,
    opp_map: dict[str, dict] | None = None,
) -> list[dict]:
    """Fetch lending and multiply obligations across all markets."""
    if all_markets is None:
        all_markets = _get_all_markets(client)
    results = []

    # Build market name lookup
    market_names: dict[str, str] = {
        m["lendingMarket"]: m.get("marketName", m.get("name", ""))
        for m in all_markets
    }

    # Collect obligation events across all markets for later
    all_obligation_events: list[dict] = []

    for market_info in all_markets:
        market_pk = market_info["lendingMarket"]
        obligations_raw = _get(
            f"/kamino-market/{market_pk}/users/{wallet}/obligations", client,
        )
        if not isinstance(obligations_raw, list) or not obligations_raw:
            continue

        # Build reserve map only for markets that have obligations
        reserve_map = _build_reserve_map(market_pk, client)

        # Fetch transaction history once per market (covers all obligations)
        obligation_txs = _fetch_obligation_transactions(market_pk, wallet, client)

        for obligation in obligations_raw:
            obligation_address = obligation.get("obligationAddress", "")

            # Use refreshedStats for all computed values
            stats = obligation.get("refreshedStats", {})
            net_value = _float(stats.get("netAccountValue"))
            leverage = _float(stats.get("leverage"))
            ltv = _float(stats.get("loanToValue"))
            total_deposit = _float(stats.get("userTotalDeposit"))
            total_borrow = _float(stats.get("userTotalBorrow"))
            liq_ltv = _float(stats.get("liquidationLtv"))
            health_factor = liq_ltv / ltv if ltv and liq_ltv and ltv > 0 else None

            # Determine product type from humanTag
            human_tag = obligation.get("humanTag", "").lower()
            product_type = "multiply" if human_tag == "multiply" else "lending"

            # Extract collateral/debt reserves from state
            state_deposits = obligation.get("state", {}).get("deposits", [])
            state_borrows = obligation.get("state", {}).get("borrows", [])

            ZERO_PK = "11111111111111111111111111111111"

            collateral_reserves = [
                d["depositReserve"] for d in state_deposits
                if d.get("depositReserve") and d["depositReserve"] != ZERO_PK
                and int(d.get("depositedAmount", "0")) > 0
            ]
            borrow_reserves = [
                b["borrowReserve"] for b in state_borrows
                if b.get("borrowReserve") and b["borrowReserve"] != ZERO_PK
                and b.get("borrowedAmountSf", "0") != "0"
            ]

            collateral_info = [{
                "reserve": r,
                "symbol": reserve_map.get(r, {}).get("symbol", ""),
                "mint": reserve_map.get(r, {}).get("mint", ""),
            } for r in collateral_reserves]

            debt_info = [{
                "reserve": r,
                "symbol": reserve_map.get(r, {}).get("symbol", ""),
                "mint": reserve_map.get(r, {}).get("mint", ""),
            } for r in borrow_reserves]

            # Try to match to a YieldOpportunity by first collateral reserve
            _omap = opp_map if opp_map is not None else _load_opportunity_map(db)
            opportunity_id = None
            if collateral_reserves:
                opportunity_id = _match_opportunity(collateral_reserves[0], _omap)

            market_name = market_names.get(market_pk, "")

            # --- PnL computation from transaction history ---
            txs_for_obligation = obligation_txs.get(obligation_address, [])
            current_net = net_value if net_value else 0.0

            pnl_data = {}
            if txs_for_obligation:
                pnl_data = _compute_obligation_pnl(txs_for_obligation, current_net, now)

                # Convert obligation txs to events
                all_obligation_events.extend(
                    _obligation_txs_to_events(
                        txs_for_obligation, wallet, obligation_address, product_type,
                    )
                )

            pnl_usd = pnl_data.get("pnl_usd")
            pnl_pct = pnl_data.get("pnl_pct")
            initial_deposit_usd = pnl_data.get("initial_deposit_usd")
            opened_at = pnl_data.get("opened_at")
            held_days = pnl_data.get("held_days")
            is_closed = pnl_data.get("is_closed", False)
            closed_at = pnl_data.get("closed_at")
            close_value_usd = pnl_data.get("close_value_usd")
            token_symbol = pnl_data.get("token_symbol")

            # Detect "recycled" obligations: the current collateral token
            # differs from the historical tx token, meaning the user withdrew
            # everything and re-deposited a different token.  PnL from the
            # old token's tx history is meaningless for the new position.
            current_collateral_sym = (
                collateral_info[0].get("symbol") if collateral_info else None
            )
            tx_token_sym = pnl_data.get("token_symbol")
            is_recycled = (
                not is_closed
                and product_type != "multiply"  # multiply deposits differ from collateral by design
                and current_collateral_sym
                and tx_token_sym
                and current_collateral_sym != tx_token_sym
            )
            if is_recycled:
                logger.info(
                    "Recycled obligation %s: tx token=%s, current=%s — resetting PnL",
                    obligation_address[:16], tx_token_sym, current_collateral_sym,
                )
                pnl_usd = 0.0
                pnl_pct = 0.0
                initial_deposit_usd = net_value  # best approximation
                opened_at = None
                held_days = None

            apy = _resolve_forward_apy(
                product_type, market_pk, collateral_reserves, borrow_reserves,
                leverage, reserve_map, _omap,
            )

            # Use current collateral symbol (always prefer live state over tx history)
            if current_collateral_sym:
                token_symbol = current_collateral_sym
            elif not token_symbol and collateral_info:
                token_symbol = collateral_info[0].get("symbol")

            # Skip positions with no value unless they're closed (we want to track those)
            if (not net_value or net_value <= 0) and not is_closed:
                continue

            results.append({
                "wallet_address": wallet,
                "protocol_slug": "kamino",
                "product_type": product_type,
                "external_id": obligation_address,
                "opportunity_id": opportunity_id,
                "deposit_amount": total_deposit,
                "deposit_amount_usd": net_value if not is_closed else 0.0,
                "pnl_usd": pnl_usd,
                "pnl_pct": pnl_pct,
                "initial_deposit_usd": initial_deposit_usd,
                "opened_at": opened_at,
                "held_days": held_days,
                "apy": apy,
                "apy_realized": compute_realized_apy(pnl_usd, initial_deposit_usd, held_days),
                "is_closed": is_closed,
                "closed_at": closed_at,
                "close_value_usd": close_value_usd,
                "token_symbol": token_symbol,
                "extra_data": {
                    "obligation_address": obligation_address,
                    "human_tag": obligation.get("humanTag"),
                    "obligation_tag": obligation.get("obligationTag"),
                    "market": market_pk,
                    "market_name": market_name,
                    "collateral": collateral_info,
                    "debt": debt_info,
                    "total_deposit_usd": total_deposit,
                    "total_borrow_usd": total_borrow,
                    "net_value_usd": net_value,
                    "leverage": leverage,
                    "ltv": ltv,
                    "liquidation_ltv": liq_ltv,
                    "health_factor": health_factor,
                    "borrow_limit": _float(stats.get("borrowLimit")),
                    "borrow_utilization": _float(stats.get("borrowUtilization")),
                    "forward_apy": round(forward_apy, 4) if forward_apy is not None else None,
                },
                "snapshot_at": now,
                "_obligation_events": all_obligation_events,
            })

    return results


# ---------------------------------------------------------------------------
# Transaction events
# ---------------------------------------------------------------------------

def fetch_wallet_events(
    wallet: str, client: httpx.Client,
    all_markets: list[dict] | None = None,
    obligation_events: list[dict] | None = None,
) -> list[dict]:
    """Fetch deposit/withdraw transaction history from Kamino vaults and obligations.

    If *obligation_events* is provided (pre-fetched from _fetch_obligation_positions),
    only earn-vault events are fetched from the API — obligation events are reused.
    """
    events = []

    # --- Earn vault events ---
    txs_raw = _get(f"/kvaults/users/{wallet}/transactions", client)
    if isinstance(txs_raw, list):
        for tx in txs_raw:
            event_type = tx.get("instruction", "unknown").lower()
            vault = tx.get("kvault", "")
            amount = _float(tx.get("tokenAmount"))
            amount_usd = _float(tx.get("usdValue"))
            signature = tx.get("transaction")
            event_at = _parse_timestamp(tx.get("createdOn"))
            if not event_at:
                event_at = datetime.now(timezone.utc)

            events.append({
                "wallet_address": wallet,
                "protocol_slug": "kamino",
                "product_type": "earn_vault",
                "external_id": vault,
                "event_type": event_type,
                "amount": amount,
                "amount_usd": amount_usd,
                "tx_signature": signature,
                "event_at": event_at,
                "extra_data": {
                    "token_mint": tx.get("tokenMint"),
                    "token_symbol": tx.get("tokenSymbol"),
                    "shares": _float(tx.get("numberOfShares")),
                    "token_price": _float(tx.get("tokenPrice")),
                    "sol_price": _float(tx.get("solPrice")),
                    "share_price": _float(tx.get("sharePrice")),
                },
            })

    # --- Lending/Multiply obligation events ---
    if obligation_events is not None:
        # Reuse events already collected during _fetch_obligation_positions
        events.extend(obligation_events)
    else:
        if all_markets is None:
            all_markets = _get_all_markets(client)
        for market_info in all_markets:
            market_pk = market_info["lendingMarket"]
            obligation_txs = _fetch_obligation_transactions(market_pk, wallet, client)
            for obligation_addr, txs in obligation_txs.items():
                ob_type = ""
                if txs:
                    ob_type = (txs[0].get("obligationType") or "").lower()
                product_type = "multiply" if ob_type in ("multiply", "leverage") else "lending"

                events.extend(
                    _obligation_txs_to_events(txs, wallet, obligation_addr, product_type)
                )

    return events


# ---------------------------------------------------------------------------
# Public API: real-time fetch (called on wallet connect)
# ---------------------------------------------------------------------------

def fetch_wallet_positions(wallet_address: str, db: Session) -> dict:
    """Fetch current Kamino positions for a wallet. Returns structured data."""
    now = datetime.now(timezone.utc)
    opp_map = _load_opportunity_map(db)

    with httpx.Client() as client:
        earn_positions = _fetch_earn_positions(wallet_address, client, db, now, opp_map=opp_map)
        obligation_positions = _fetch_obligation_positions(wallet_address, client, db, now, opp_map=opp_map)

    all_positions = earn_positions + obligation_positions

    # Strip internal-only keys before returning
    for p in all_positions:
        p.pop("_obligation_events", None)

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
    """Iterate all active TrackedWallets, fetch positions, store snapshots."""
    wallets = (
        db.query(TrackedWallet)
        .filter(TrackedWallet.is_active.is_(True))
        .all()
    )
    if not wallets:
        logger.info("No tracked wallets to snapshot")
        return 0

    logger.info("Snapshotting positions for %d wallets", len(wallets))
    now = snapshot_at or datetime.now(timezone.utc)
    total_snapshots = 0

    with httpx.Client() as client:
        # Fetch shared data once — reused across all wallets
        all_markets = _get_all_markets(client)
        opp_map = _load_opportunity_map(db)

        for wallet in wallets:
            try:
                earn_positions = _fetch_earn_positions(
                    wallet.wallet_address, client, db, now, opp_map=opp_map,
                )
                obligation_positions = _fetch_obligation_positions(
                    wallet.wallet_address, client, db, now,
                    all_markets=all_markets, opp_map=opp_map,
                )
                all_positions = earn_positions + obligation_positions

                # Extract obligation events collected during position fetch
                # (avoids re-fetching obligation transactions)
                collected_obligation_events: list[dict] = []
                for pos_data in all_positions:
                    ob_evts = pos_data.pop("_obligation_events", None)
                    if ob_evts:
                        collected_obligation_events.extend(ob_evts)

                from app.services.utils import store_position_rows
                total_snapshots += store_position_rows(db, all_positions, now)

                # Fetch events — reuse obligation events from position fetch
                events_raw = fetch_wallet_events(
                    wallet.wallet_address, client,
                    all_markets=all_markets,
                    obligation_events=collected_obligation_events,
                )
                for evt in events_raw:
                    # Skip if tx_signature already recorded
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
                    "Wallet %s: %d positions snapshotted",
                    wallet.wallet_address[:8],
                    len(all_positions),
                )

            except Exception as exc:
                logger.error(
                    "Failed to snapshot wallet %s: %s",
                    wallet.wallet_address[:8],
                    exc,
                )
                continue

    db.commit()
    logger.info("Position snapshot complete: %d total snapshots", total_snapshots)
    return total_snapshots


def snapshot_all_wallets_job():
    """APScheduler entry point — creates its own DB session."""
    logger.info("Starting position snapshot job")
    db: Session = SessionLocal()
    try:
        count = snapshot_all_wallets(db)
        logger.info("Position snapshot job complete: %d snapshots", count)
    except Exception as exc:
        db.rollback()
        logger.error("Position snapshot job failed: %s", exc)
    finally:
        db.close()
