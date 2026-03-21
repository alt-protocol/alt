"""Validate kamino_position_fetcher.py against real Kamino API.

Usage:
    cd backend
    python ../scripts/validate_positions.py

No DB required for raw API tests. DB required for fetch_wallet_positions() integration test.
"""
import json
import sys
import httpx

KAMINO_API = "https://api.kamino.finance"
WALLET = "D8E6t4oe1szSsDuwNmVTiSHFLFZY5sNBxQnuaCQ8FEHm"

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
WARN = "\033[93mWARN\033[0m"


def check(label: str, condition: bool, detail: str = ""):
    status = PASS if condition else FAIL
    suffix = f" — {detail}" if detail else ""
    print(f"  [{status}] {label}{suffix}")
    return condition


def get(path: str, client: httpx.Client):
    url = f"{KAMINO_API}{path}"
    print(f"\n>>> GET {url}")
    try:
        r = client.get(url, timeout=30)
        r.raise_for_status()
        data = r.json()
        return data
    except Exception as exc:
        print(f"  ERROR: {exc}")
        return None


def dump(data, max_lines=30):
    """Pretty-print JSON, truncating if too long."""
    text = json.dumps(data, indent=2, default=str)
    lines = text.split("\n")
    if len(lines) > max_lines:
        print("\n".join(lines[:max_lines]))
        print(f"  ... ({len(lines) - max_lines} more lines)")
    else:
        print(text)


def main():
    passed = 0
    failed = 0

    with httpx.Client() as client:
        # ---------------------------------------------------------------
        # 1. Earn Vault Discovery (via transactions)
        # ---------------------------------------------------------------
        print("\n" + "=" * 60)
        print("1. EARN VAULT DISCOVERY (via transactions)")
        print("=" * 60)

        txs = get(f"/kvaults/users/{WALLET}/transactions", client)
        if txs is not None and len(txs) > 0:
            # Extract unique vault addresses from transactions
            vault_addresses = list(dict.fromkeys(
                tx.get("kvault") for tx in txs if tx.get("kvault")
            ))
            print(f"  Found {len(txs)} transaction(s) across {len(vault_addresses)} vault(s)")
            for v in vault_addresses:
                print(f"    - Vault: {v[:16]}...")

            # Find first vault with a deposit (totalShares > 0)
            earn_vault = None
            earn_pos_data = None
            for v in vault_addresses:
                pos_data = get(f"/kvaults/users/{WALLET}/positions/{v}", client)
                if isinstance(pos_data, dict):
                    total_shares = float(pos_data.get("totalShares", 0))
                    if total_shares > 0:
                        earn_vault = v
                        earn_pos_data = pos_data
                        print(f"  Active vault found: {v[:16]}... (totalShares={total_shares})")
                        break

            if check("Active earn vault found (totalShares > 0)", earn_vault is not None):
                passed += 1

                if check("totalShares > 0", float(earn_pos_data.get("totalShares", 0)) > 0,
                          str(earn_pos_data.get("totalShares"))):
                    passed += 1
                else:
                    failed += 1

                # Earn vault P&L
                pnl_data = get(f"/kvaults/{earn_vault}/users/{WALLET}/pnl", client)
                if pnl_data:
                    print("  P&L response:")
                    dump(pnl_data)
                    if check("P&L data has totalPnl field", "totalPnl" in pnl_data):
                        passed += 1
                    else:
                        failed += 1
                else:
                    failed += 1
            else:
                failed += 1
                print(f"  {WARN} No active vault found among {len(vault_addresses)} vault(s)")
        else:
            failed += 1
            print(f"  [{FAIL}] Could not fetch vault transactions")

        # ---------------------------------------------------------------
        # 3. All lending markets
        # ---------------------------------------------------------------
        print("\n" + "=" * 60)
        print("2. LENDING MARKETS")
        print("=" * 60)

        markets = get("/v2/kamino-market", client)
        if markets is not None:
            print(f"  Found {len(markets)} markets")
            for m in markets:
                pk = m.get("lendingMarket", "?")
                name = m.get("marketName", m.get("name", "?"))
                print(f"    - {name}: {pk[:16]}...")
            if check("Markets list non-empty", len(markets) > 0):
                passed += 1
            else:
                failed += 1
        else:
            failed += 1

        # ---------------------------------------------------------------
        # 4. Obligations per market
        # ---------------------------------------------------------------
        print("\n" + "=" * 60)
        print("3. OBLIGATIONS PER MARKET")
        print("=" * 60)

        found_multiply = False
        multiply_market_pk = None
        multiply_obligation = None

        if markets:
            for m in markets:
                pk = m.get("lendingMarket", "")
                name = m.get("marketName", m.get("name", "?"))
                if not pk:
                    continue
                obligations = get(f"/kamino-market/{pk}/users/{WALLET}/obligations", client)
                if obligations and len(obligations) > 0:
                    print(f"  ** Found {len(obligations)} obligation(s) in '{name}' ({pk[:16]}...)")
                    for obl in obligations:
                        obl_addr = obl.get("obligationAddress", "?")
                        tag = obl.get("humanTag", "?")
                        stats = obl.get("refreshedStats", {})
                        net_val = stats.get("netAccountValue")
                        leverage = stats.get("leverage")
                        ltv = stats.get("loanToValue")
                        print(f"    obligation={obl_addr[:16]}... tag={tag} net_value={net_val} leverage={leverage} ltv={ltv}")

                        if tag and tag.lower() == "multiply":
                            found_multiply = True
                            multiply_market_pk = pk
                            multiply_obligation = obl

        if check("Multiply position found", found_multiply):
            passed += 1
        else:
            failed += 1

        # ---------------------------------------------------------------
        # 5. Validate multiply obligation details
        # ---------------------------------------------------------------
        if multiply_obligation:
            print("\n" + "=" * 60)
            print("4. MULTIPLY POSITION VALIDATION")
            print("=" * 60)

            stats = multiply_obligation.get("refreshedStats", {})
            net_value = float(stats.get("netAccountValue", 0))
            leverage = float(stats.get("leverage", 0))
            ltv = float(stats.get("loanToValue", 0))
            liq_ltv = float(stats.get("liquidationLtv", 0))
            total_deposit = float(stats.get("userTotalDeposit", 0))
            total_borrow = float(stats.get("userTotalBorrow", 0))
            health_factor = liq_ltv / ltv if ltv > 0 else None

            print(f"  net_value     = ${net_value:,.2f}")
            print(f"  leverage      = {leverage:.2f}x")
            print(f"  ltv           = {ltv:.4f} ({ltv*100:.2f}%)")
            print(f"  liq_ltv       = {liq_ltv:.4f}")
            print(f"  health_factor = {health_factor:.4f}" if health_factor else "  health_factor = N/A")
            print(f"  total_deposit = ${total_deposit:,.2f}")
            print(f"  total_borrow  = ${total_borrow:,.2f}")

            # Checks — values can shift over time, so use wide tolerances
            if check("product_type is multiply", multiply_obligation.get("humanTag", "").lower() == "multiply"):
                passed += 1
            else:
                failed += 1

            if check("net_value > $1000", net_value > 1000, f"${net_value:,.2f}"):
                passed += 1
            else:
                failed += 1

            if check("LTV between 0.5 and 0.95", 0.5 < ltv < 0.95, f"{ltv:.4f}"):
                passed += 1
            else:
                failed += 1

            if check("leverage > 2x", leverage > 2, f"{leverage:.2f}x"):
                passed += 1
            else:
                failed += 1

            if check("health_factor > 1.0", health_factor is not None and health_factor > 1.0, f"{health_factor:.4f}" if health_factor else "N/A"):
                passed += 1
            else:
                failed += 1

            # Reserve metrics to validate collateral/debt symbols
            print("\n" + "=" * 60)
            print("5. RESERVE METRICS (symbol resolution)")
            print("=" * 60)

            reserves = get(f"/kamino-market/{multiply_market_pk}/reserves/metrics", client)
            if reserves:
                reserve_map = {
                    r["reserve"]: {
                        "symbol": r.get("liquidityToken", ""),
                        "mint": r.get("liquidityTokenMint", ""),
                    }
                    for r in reserves if "reserve" in r
                }
                print(f"  Built reserve map with {len(reserve_map)} entries")

                # Extract collateral/debt from state
                state = multiply_obligation.get("state", {})
                deposits = state.get("deposits", [])
                borrows = state.get("borrows", [])
                ZERO_PK = "11111111111111111111111111111111"

                collateral_reserves = [
                    d["depositReserve"] for d in deposits
                    if d.get("depositReserve") and d["depositReserve"] != ZERO_PK
                    and int(d.get("depositedAmount", "0")) > 0
                ]
                borrow_reserves = [
                    b["borrowReserve"] for b in borrows
                    if b.get("borrowReserve") and b["borrowReserve"] != ZERO_PK
                    and b.get("borrowedAmountSf", "0") != "0"
                ]

                coll_symbols = [reserve_map.get(r, {}).get("symbol", "UNKNOWN") for r in collateral_reserves]
                debt_symbols = [reserve_map.get(r, {}).get("symbol", "UNKNOWN") for r in borrow_reserves]
                print(f"  Collateral: {coll_symbols} (reserves: {[r[:12]+'...' for r in collateral_reserves]})")
                print(f"  Debt:       {debt_symbols} (reserves: {[r[:12]+'...' for r in borrow_reserves]})")

                if check("Collateral includes PRIME", "PRIME" in coll_symbols, str(coll_symbols)):
                    passed += 1
                else:
                    failed += 1

                if check("Debt includes USDC", "USDC" in debt_symbols, str(debt_symbols)):
                    passed += 1
                else:
                    failed += 1
            else:
                failed += 2

            # Full obligation dump for reference
            print("\n  Full refreshedStats:")
            dump(stats)

        # ---------------------------------------------------------------
        # 6. Transaction events
        # ---------------------------------------------------------------
        print("\n" + "=" * 60)
        print("6. TRANSACTION EVENTS")
        print("=" * 60)

        txs = get(f"/kvaults/users/{WALLET}/transactions", client)
        if txs is not None:
            print(f"  Found {len(txs)} transaction(s)")
            if len(txs) > 0:
                # Show first few
                for tx in txs[:3]:
                    instr = tx.get("instruction", "?")
                    vault = tx.get("kvault", "?")
                    usd = tx.get("usdValue", "?")
                    sig = tx.get("transaction", "?")
                    ts = tx.get("createdOn", "?")
                    print(f"    - {instr} | vault={str(vault)[:16]}... | usd={usd} | sig={str(sig)[:16]}... | ts={ts}")

                first = txs[0]
                if check("Has 'instruction' field", "instruction" in first):
                    passed += 1
                else:
                    failed += 1
                if check("Has 'transaction' field", "transaction" in first):
                    passed += 1
                else:
                    failed += 1
                if check("Has 'createdOn' field", "createdOn" in first):
                    passed += 1
                else:
                    failed += 1
                if check("Has 'kvault' field", "kvault" in first):
                    passed += 1
                else:
                    failed += 1
                if check("Has 'usdValue' field", "usdValue" in first):
                    passed += 1
                else:
                    failed += 1

                print("\n  Full first transaction:")
                dump(first)
            else:
                print(f"  {WARN} No transactions found (wallet may not have vault history)")
        else:
            failed += 1

        # ---------------------------------------------------------------
        # 7. Integration test: fetch_wallet_positions()
        # ---------------------------------------------------------------
        print("\n" + "=" * 60)
        print("7. INTEGRATION TEST: fetch_wallet_positions()")
        print("=" * 60)

        try:
            sys.path.insert(0, ".")
            from app.services.kamino_position_fetcher import fetch_wallet_positions
            from app.models.base import SessionLocal

            db = SessionLocal()
            try:
                result = fetch_wallet_positions(WALLET, db)
                positions = result.get("positions", [])
                summary = result.get("summary", {})

                print(f"  Total positions: {summary.get('position_count', 0)}")
                print(f"  Total value:     ${summary.get('total_value_usd', 0):,.2f}")
                print(f"  Total P&L:       ${summary.get('total_pnl_usd', 0):,.2f}")

                for pos in positions:
                    pt = pos.get("product_type", "?")
                    ext = pos.get("external_id", "?")
                    usd = pos.get("deposit_amount_usd", 0)
                    extra = pos.get("extra_data", {})
                    label = ""
                    if pt == "earn_vault":
                        label = extra.get("token_symbol", "")
                    elif pt == "multiply":
                        coll = extra.get("collateral", [{}])
                        debt = extra.get("debt", [{}])
                        c_sym = coll[0].get("symbol", "?") if coll else "?"
                        d_sym = debt[0].get("symbol", "?") if debt else "?"
                        label = f"{c_sym}/{d_sym} {extra.get('leverage', '?')}x"
                    print(f"    - [{pt}] {label} | ${usd:,.2f} | id={ext[:16]}...")
                    # Full position details
                    init_dep = pos.get("initial_deposit_usd")
                    pnl_usd = pos.get("pnl_usd")
                    pnl_pct = pos.get("pnl_pct")
                    apy = pos.get("apy")
                    opened = pos.get("opened_at")
                    held = pos.get("held_days")
                    is_closed = pos.get("is_closed")
                    closed_at = pos.get("closed_at")
                    close_val = pos.get("close_value_usd")
                    tok = pos.get("token_symbol") or extra.get("token_symbol")
                    print(f"        Token:           {tok}")
                    print(f"        Initial deposit: ${init_dep:,.2f}" if init_dep is not None else "        Initial deposit: N/A")
                    print(f"        Current value:   ${usd:,.2f}")
                    print(f"        PnL:             ${pnl_usd:,.2f} ({pnl_pct:,.2f}%)" if pnl_usd is not None and pnl_pct is not None else f"        PnL:             N/A")
                    print(f"        APY:             {apy:,.2f}%" if apy is not None else "        APY:             N/A")
                    print(f"        Opened:          {opened}")
                    print(f"        Held days:       {held}")
                    if is_closed:
                        print(f"        CLOSED at:       {closed_at}")
                        print(f"        Close value:     ${close_val:,.2f}" if close_val is not None else "        Close value:     N/A")
                    if pt == "multiply":
                        lev = extra.get("leverage")
                        ltv = extra.get("ltv")
                        hf = extra.get("health_factor")
                        td = extra.get("total_deposit_usd")
                        tb = extra.get("total_borrow_usd")
                        coll = extra.get("collateral", [{}])
                        debt = extra.get("debt", [{}])
                        c_sym = coll[0].get("symbol", "?") if coll else "?"
                        d_sym = debt[0].get("symbol", "?") if debt else "?"
                        print(f"        Leverage:        {lev}x")
                        print(f"        LTV:             {ltv}")
                        print(f"        Health factor:   {hf}")
                        print(f"        Collateral:      {c_sym}")
                        print(f"        Debt:            {d_sym}")
                        print(f"        Total deposit:   ${td:,.2f}" if td is not None else "        Total deposit:   N/A")
                        print(f"        Total borrow:    ${tb:,.2f}" if tb is not None else "        Total borrow:    N/A")

                if check("At least 1 position returned", len(positions) >= 1, str(len(positions))):
                    passed += 1
                else:
                    failed += 1

                multiply_positions = [p for p in positions if p.get("product_type") == "multiply"]
                if check("Multiply position in results", len(multiply_positions) > 0):
                    passed += 1
                    mp = multiply_positions[0]
                    mp_extra = mp.get("extra_data", {})
                    if check("leverage populated", mp_extra.get("leverage") is not None, str(mp_extra.get("leverage"))):
                        passed += 1
                    else:
                        failed += 1
                    if check("ltv populated", mp_extra.get("ltv") is not None, str(mp_extra.get("ltv"))):
                        passed += 1
                    else:
                        failed += 1
                    if check("health_factor populated", mp_extra.get("health_factor") is not None, str(mp_extra.get("health_factor"))):
                        passed += 1
                    else:
                        failed += 1
                    if check("collateral list non-empty", len(mp_extra.get("collateral", [])) > 0):
                        passed += 1
                    else:
                        failed += 1
                else:
                    failed += 1

                earn_positions = [p for p in positions if p.get("product_type") == "earn_vault"]
                if check("Earn vault position in results", len(earn_positions) > 0):
                    passed += 1
                else:
                    failed += 1

            finally:
                db.close()

        except Exception as exc:
            print(f"  {WARN} Integration test skipped: {exc}")
            print("  (This is expected if DB is not available)")

        # ---------------------------------------------------------------
        # 8. DB-FREE POSITION COMPARISON
        # ---------------------------------------------------------------
        print("\n" + "=" * 60)
        print("8. DB-FREE POSITION COMPARISON")
        print("=" * 60)

        _KNOWN_MINTS = {
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": "USDC",
            "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": "USDT",
            "So11111111111111111111111111111111111111112": "SOL",
            "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn": "JITOSOL",
            "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So": "MSOL",
            "7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj": "stSOL",
            "bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1": "bSOL",
        }

        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)

        def _float(val):
            try:
                return float(val) if val is not None else None
            except (TypeError, ValueError):
                return None

        def _parse_ts(ts):
            if ts is None:
                return None
            try:
                if isinstance(ts, (int, float)):
                    return datetime.fromtimestamp(ts, tz=timezone.utc)
                return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            except (ValueError, OSError):
                return None

        our_positions = []  # collect for comparison table

        # --- 8a. Earn Vaults (DB-free) ---
        print("\n  --- 8a. EARN VAULTS (DB-free) ---")

        vault_txs = get(f"/kvaults/users/{WALLET}/transactions", client)
        if isinstance(vault_txs, list) and vault_txs:
            # Build vault → token info
            vault_token_info = {}
            for tx in vault_txs:
                vault = tx.get("kvault", "")
                if vault and vault not in vault_token_info:
                    mint = tx.get("tokenMint", "")
                    symbol = tx.get("tokenSymbol") or _KNOWN_MINTS.get(mint)
                    vault_token_info[vault] = {
                        "token_mint": mint,
                        "token_symbol": symbol,
                        "share_price": _float(tx.get("sharePrice")),
                        "token_price": _float(tx.get("tokenPrice")),
                    }

            for vault_address, token_info in vault_token_info.items():
                pos_data = get(f"/kvaults/users/{WALLET}/positions/{vault_address}", client)
                if not isinstance(pos_data, dict):
                    continue
                total_shares = _float(pos_data.get("totalShares"))
                if not total_shares or total_shares <= 0:
                    continue

                # USD value from metrics history
                start_ts = int((now - timedelta(hours=24)).timestamp())
                end_ts = int(now.timestamp())
                metrics_data = get(
                    f"/kvaults/users/{WALLET}/vaults/{vault_address}"
                    f"/metrics/history?start={start_ts}&end={end_ts}",
                    client,
                )
                deposit_amount_usd = None
                if isinstance(metrics_data, list) and metrics_data:
                    last_entry = metrics_data[-1]
                    deposit_amount_usd = _float(last_entry.get("totalValueUsd",
                                                last_entry.get("totalValue")))

                # Fallback: shares × share_price × token_price
                if deposit_amount_usd is None:
                    sp = token_info.get("share_price")
                    tp = token_info.get("token_price")
                    if sp and tp and total_shares:
                        deposit_amount_usd = total_shares * sp * tp

                # PnL
                pnl_data = get(f"/kvaults/{vault_address}/users/{WALLET}/pnl", client)
                pnl_usd = None
                pnl_pct = None
                cost_basis_usd = None
                if isinstance(pnl_data, dict):
                    total_pnl = pnl_data.get("totalPnl")
                    if isinstance(total_pnl, dict):
                        pnl_usd = _float(total_pnl.get("usd"))
                    else:
                        pnl_usd = _float(pnl_data.get("pnlUsd"))
                    total_cost_basis = pnl_data.get("totalCostBasis")
                    if isinstance(total_cost_basis, dict):
                        cost_basis_usd = _float(total_cost_basis.get("usd"))
                    else:
                        cost_basis_usd = _float(pnl_data.get("costBasisUsd"))
                    if cost_basis_usd and cost_basis_usd > 0 and pnl_usd is not None:
                        pnl_pct = (pnl_usd / cost_basis_usd) * 100

                token_sym = token_info.get("token_symbol")
                print(f"\n  Earn Vault: {vault_address[:16]}...")
                print(f"    Token:      {token_sym}")
                print(f"    Shares:     {total_shares}")
                print(f"    USD value:  ${deposit_amount_usd:,.2f}" if deposit_amount_usd else "    USD value:  N/A")
                print(f"    PnL:        ${pnl_usd:,.6f}" if pnl_usd is not None else "    PnL:        N/A")
                print(f"    PnL %:      {pnl_pct:,.4f}%" if pnl_pct is not None else "    PnL %:      N/A")
                print(f"    Cost basis: ${cost_basis_usd:,.2f}" if cost_basis_usd else "    Cost basis: N/A")
                print(f"    APY:        (requires DB)")

                our_positions.append({
                    "name": f"Earn {token_sym or vault_address[:8]}",
                    "type": "Earn Vault",
                    "value_usd": deposit_amount_usd,
                    "pnl_usd": pnl_usd,
                    "ltv": None,
                    "apy": None,
                })

                if check("Earn vault USD value > 0", deposit_amount_usd is not None and deposit_amount_usd > 0,
                          f"${deposit_amount_usd:,.2f}" if deposit_amount_usd else "N/A"):
                    passed += 1
                else:
                    failed += 1
        else:
            print("  No vault transactions found")

        # --- 8b. Lending & Multiply Obligations (DB-free) ---
        print("\n  --- 8b. LENDING & MULTIPLY OBLIGATIONS (DB-free) ---")

        all_markets = get("/v2/kamino-market", client)
        if isinstance(all_markets, list):
            for market_info in all_markets:
                market_pk = market_info.get("lendingMarket", "")
                market_name = market_info.get("marketName", market_info.get("name", "?"))
                if not market_pk:
                    continue

                obligations_raw = get(f"/kamino-market/{market_pk}/users/{WALLET}/obligations", client)
                if not isinstance(obligations_raw, list) or not obligations_raw:
                    continue

                # Build reserve map for symbol resolution
                reserves_raw = get(f"/kamino-market/{market_pk}/reserves/metrics", client)
                reserve_map = {}
                if isinstance(reserves_raw, list):
                    for r in reserves_raw:
                        if "reserve" not in r:
                            continue
                        reserve_map[r["reserve"]] = {
                            "symbol": r.get("liquidityToken", ""),
                            "mint": r.get("liquidityTokenMint", ""),
                            "supplyInterestAPY": _float(r.get("supplyInterestAPY", r.get("supplyApy"))),
                            "borrowInterestAPY": _float(r.get("borrowInterestAPY", r.get("borrowApy"))),
                        }

                # Fetch tx history for PnL
                raw_txs = get(f"/v2/kamino-market/{market_pk}/users/{WALLET}/transactions", client)
                obligation_txs = {}
                if isinstance(raw_txs, dict):
                    for obl_addr, txlist in raw_txs.items():
                        if isinstance(txlist, list) and txlist:
                            txlist.sort(key=lambda t: t.get("createdOn", ""))
                            obligation_txs[obl_addr] = txlist

                ZERO_PK = "11111111111111111111111111111111"

                for obligation in obligations_raw:
                    obligation_address = obligation.get("obligationAddress", "")
                    stats = obligation.get("refreshedStats", {})
                    net_value = _float(stats.get("netAccountValue"))
                    leverage = _float(stats.get("leverage"))
                    ltv = _float(stats.get("loanToValue"))
                    total_deposit = _float(stats.get("userTotalDeposit"))
                    total_borrow = _float(stats.get("userTotalBorrow"))
                    liq_ltv = _float(stats.get("liquidationLtv"))
                    health_factor = liq_ltv / ltv if ltv and liq_ltv and ltv > 0 else None

                    human_tag = obligation.get("humanTag", "").lower()
                    product_type = "multiply" if human_tag == "multiply" else "lending"

                    # Extract collateral/debt symbols
                    state_deposits = obligation.get("state", {}).get("deposits", [])
                    state_borrows = obligation.get("state", {}).get("borrows", [])

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

                    coll_symbols = [reserve_map.get(r, {}).get("symbol", "?") for r in collateral_reserves]
                    debt_symbols = [reserve_map.get(r, {}).get("symbol", "?") for r in borrow_reserves]

                    # PnL computation (inlined from _compute_obligation_pnl)
                    txs_for_obl = obligation_txs.get(obligation_address, [])
                    pnl_usd = None
                    pnl_pct = None
                    initial_deposit_usd = None
                    opened_at = None
                    held_days = None
                    realized_apy = None
                    is_closed = False
                    closed_at_ts = None
                    close_value_usd = None
                    unrecognized_types = set()
                    cash_flows = []
                    token_symbol_tx = None

                    if txs_for_obl:
                        tx_type_map = {
                            "deposit": "deposit", "create": "deposit",
                            "withdraw": "withdraw", "borrow": "borrow", "repay": "repay",
                            # Multiply compound operations
                            "depositandborrow": "deposit",
                            "withdrawandrepay": "withdraw",
                            "leverageanddeposit": "deposit",
                            "deleverageandwithdraw": "withdraw",
                        }
                        sum_deposit = sum_withdraw = sum_borrow = sum_repay = 0.0
                        cash_flows = []  # list of (datetime, float) for Modified Dietz
                        token_symbol_tx = None
                        unrecognized_types = set()

                        for tx in txs_for_obl:
                            display_name = (tx.get("transactionDisplayName") or "").lower()
                            usd_val = _float(tx.get("liquidityUsdValue")) or 0.0
                            tx_time = _parse_ts(tx.get("createdOn"))
                            category = tx_type_map.get(display_name)
                            if category is None and display_name:
                                unrecognized_types.add(display_name)
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
                            if token_symbol_tx is None and tx.get("liquidityToken"):
                                token_symbol_tx = tx["liquidityToken"]

                        net_equity = sum_deposit - sum_withdraw - sum_borrow + sum_repay
                        initial_deposit_usd = net_equity if net_equity > 0 else sum_deposit
                        current_net = net_value if net_value else 0.0

                        # Absolute is_closed threshold.
                        # Relative thresholds break for "recycled" obligations
                        # where a user withdrew everything and re-deposited a
                        # small amount under the same obligation address.
                        is_closed = current_net < 0.01

                        if is_closed:
                            close_value_usd = sum_withdraw + sum_repay - sum_borrow
                            for tx in reversed(txs_for_obl):
                                t = _parse_ts(tx.get("createdOn"))
                                if t:
                                    closed_at_ts = t
                                    break

                        T = None
                        if opened_at:
                            end_time = closed_at_ts if is_closed and closed_at_ts else now
                            T = (end_time - opened_at).total_seconds() / 86400.0
                            held_days = T

                        # Modified Dietz PnL
                        if T and T > 0 and cash_flows:
                            total_net_cf = sum(cf for _, cf in cash_flows)
                            weighted_capital = 0.0
                            for cf_time, cf_amount in cash_flows:
                                days_from_start = (cf_time - opened_at).total_seconds() / 86400.0
                                w_i = max(0.0, min(1.0, (T - days_from_start) / T))
                                weighted_capital += cf_amount * w_i

                            v_end = 0.0 if is_closed else current_net
                            pnl_usd = v_end - total_net_cf

                            if weighted_capital > 0:
                                modified_dietz_return = pnl_usd / weighted_capital
                                pnl_pct = modified_dietz_return * 100
                                realized_apy = modified_dietz_return * (365.0 / T) * 100

                    # Detect "recycled" obligations: current collateral token
                    # differs from tx history token → PnL is meaningless.
                    current_coll_sym = coll_symbols[0] if coll_symbols else None
                    is_recycled = (
                        not is_closed
                        and product_type != "multiply"  # multiply deposits differ from collateral by design
                        and current_coll_sym
                        and token_symbol_tx
                        and current_coll_sym != token_symbol_tx
                    )
                    if is_recycled:
                        pnl_usd = 0.0
                        pnl_pct = 0.0
                        realized_apy = None
                        initial_deposit_usd = net_value  # best approximation
                        token_symbol_tx = current_coll_sym

                    # APY logic: use realized if held long enough, else fallback
                    MIN_DAYS_FOR_REALIZED_APY = 3.0
                    apy = None
                    if realized_apy is not None and held_days is not None and held_days >= MIN_DAYS_FOR_REALIZED_APY:
                        apy = realized_apy
                    # Fallback: supply APY from reserve metrics (for lending positions)
                    if apy is None and collateral_reserves and product_type == "lending":
                        reserve_data = reserve_map.get(collateral_reserves[0], {})
                        supply_apy = _float(reserve_data.get("supplyInterestAPY", reserve_data.get("supplyApy")))
                        if supply_apy is not None:
                            apy = supply_apy * 100  # decimal → percentage
                    # Fallback for multiply: net APY from reserve metrics
                    if apy is None and product_type == "multiply" and collateral_reserves and borrow_reserves and leverage and leverage > 1:
                        coll_data = reserve_map.get(collateral_reserves[0], {})
                        debt_data = reserve_map.get(borrow_reserves[0], {})
                        coll_supply = _float(coll_data.get("supplyInterestAPY", coll_data.get("supplyApy")))
                        debt_borrow = _float(debt_data.get("borrowInterestAPY", debt_data.get("borrowApy")))
                        if coll_supply is not None and debt_borrow is not None:
                            apy = (coll_supply * leverage - debt_borrow * (leverage - 1)) * 100

                    # Skip zero-value unless closed
                    if (not net_value or net_value <= 0) and not is_closed:
                        continue

                    label = "/".join(coll_symbols) if coll_symbols else "?"
                    if debt_symbols:
                        label += "/" + "/".join(debt_symbols)

                    print(f"\n  [{product_type.upper()}] {label} (market: {market_name})")
                    print(f"    Obligation:       {obligation_address[:16]}...")
                    print(f"    Collateral:       {coll_symbols}")
                    print(f"    Debt:             {debt_symbols}")
                    print(f"    Net value:        ${net_value:,.2f}" if net_value else "    Net value:        N/A")
                    print(f"    Leverage:         {leverage:.2f}x" if leverage else "    Leverage:         N/A")
                    print(f"    LTV:              {ltv*100:.2f}%" if ltv else "    LTV:              N/A")
                    print(f"    Health factor:    {health_factor:.4f}" if health_factor else "    Health factor:    N/A")
                    print(f"    Total deposit:    ${total_deposit:,.2f}" if total_deposit else "    Total deposit:    N/A")
                    print(f"    Total borrow:     ${total_borrow:,.2f}" if total_borrow else "    Total borrow:     N/A")
                    print(f"    Initial deposit:  ${initial_deposit_usd:,.2f}" if initial_deposit_usd else "    Initial deposit:  N/A")
                    print(f"    PnL:              ${pnl_usd:,.2f}" if pnl_usd is not None else "    PnL:              N/A")
                    print(f"    PnL %:            {pnl_pct:,.4f}%" if pnl_pct is not None else "    PnL %:            N/A")
                    print(f"    APY:              {apy:,.2f}%" if apy is not None else "    APY:              N/A")
                    if realized_apy is not None:
                        print(f"    (Realized APY:    {realized_apy:,.2f}%, held {held_days:.1f}d — {'used' if apy == realized_apy else 'skipped, too short'})")
                    print(f"    Opened at:        {opened_at}" if opened_at else "    Opened at:        N/A")
                    print(f"    Held days:        {held_days:,.1f}" if held_days else "    Held days:        N/A")
                    if txs_for_obl:
                        print(f"    Tx types:         {len(txs_for_obl)} txs, cash_flows={len(cash_flows)}")
                        print(f"    Σ deposit/withdraw/borrow/repay: ${sum_deposit:,.2f} / ${sum_withdraw:,.2f} / ${sum_borrow:,.2f} / ${sum_repay:,.2f}")
                    if unrecognized_types:
                        print(f"    ** UNRECOGNIZED:  {unrecognized_types}")
                    if is_recycled:
                        print(f"    ** RECYCLED:      tx_token={token_symbol_tx}, current={current_coll_sym}")
                    if is_closed:
                        print(f"    ** CLOSED **")
                        print(f"    Close value:      ${close_value_usd:,.2f}" if close_value_usd is not None else "    Close value:      N/A")

                    our_positions.append({
                        "name": label,
                        "type": product_type.capitalize(),
                        "value_usd": net_value if not is_closed else 0.0,
                        "pnl_usd": pnl_usd,
                        "ltv": ltv * 100 if ltv else None,
                        "apy": apy,
                    })

                    if not is_closed:
                        if check(f"{product_type} net_value > 0", net_value is not None and net_value > 0,
                                  f"${net_value:,.2f}" if net_value else "N/A"):
                            passed += 1
                        else:
                            failed += 1

        # --- 8c. Comparison Table ---
        print("\n  --- 8c. COMPARISON vs KAMINO WEB APP ---")
        print()

        expected = [
            {"name": "Gauntlet USDC Frontier", "type": "Earn Vault", "value": 1.00, "pnl": 0.00, "ltv": None, "apy": 4.99},
            {"name": "Main Market USDC",       "type": "Lending (borrow)", "value": 1.00, "pnl": None, "ltv": None, "apy": 1.42},
            {"name": "USDG/PYUSD",             "type": "Multiply",   "value": 0.99, "pnl": -0.00006, "ltv": 81.08, "apy": 5.24},
            {"name": "PRIME/USDC",             "type": "Multiply",   "value": 5099.14, "pnl": 117.25, "ltv": 85.70, "apy": 14.02},
        ]

        header = f"  {'Position':<30} {'Type':<18} {'Expected $':>12} {'Our $':>12} {'Expected PnL':>14} {'Our PnL':>14} {'Exp LTV':>10} {'Our LTV':>10} {'Exp APY':>10} {'Our APY':>10}"
        print(header)
        print("  " + "-" * (len(header) - 2))

        for i, exp in enumerate(expected):
            our = our_positions[i] if i < len(our_positions) else {}
            our_val = our.get("value_usd")
            our_pnl = our.get("pnl_usd")
            our_ltv = our.get("ltv")
            our_apy = our.get("apy")

            val_str = f"${our_val:,.2f}" if our_val is not None else "N/A"
            pnl_str = f"${our_pnl:,.2f}" if our_pnl is not None else "N/A"
            ltv_str = f"{our_ltv:.2f}%" if our_ltv is not None else "N/A"
            apy_str = f"{our_apy:.2f}%" if our_apy is not None else "N/A"

            exp_val_str = f"${exp['value']:,.2f}"
            exp_pnl_str = f"${exp['pnl']:,.5f}" if exp["pnl"] is not None else "N/A"
            exp_ltv_str = f"{exp['ltv']:.2f}%" if exp["ltv"] is not None else "N/A"
            exp_apy_str = f"{exp['apy']:.2f}%" if exp["apy"] is not None else "N/A"

            print(f"  {exp['name']:<30} {exp['type']:<18} {exp_val_str:>12} {val_str:>12} {exp_pnl_str:>14} {pnl_str:>14} {exp_ltv_str:>10} {ltv_str:>10} {exp_apy_str:>10} {apy_str:>10}")

        print()
        print(f"  Note: APY for earn vaults requires DB lookup. Realized APY for obligations")
        print(f"  is computed from tx history and may differ from displayed APY on Kamino web app.")
        print(f"  Values shift in real-time; small differences are expected.")

    # ---------------------------------------------------------------
    # Summary
    # ---------------------------------------------------------------
    print("\n" + "=" * 60)
    total = passed + failed
    print(f"RESULTS: {passed}/{total} passed, {failed}/{total} failed")
    print("=" * 60)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
