# Phase 2 Validator: Monitor Module

Review the Monitor module in `backend-ts/src/monitor/` against `MIGRATION_PLAN.md` and the Python source.

Do NOT make code changes. Only review and report.

## Review checklist

### 1. Module isolation
- [ ] Monitor only queries its own tables (tracked_wallets, user_positions, user_position_events)
- [ ] Cross-module read uses `discoverService.getOpportunityMap()` — NOT a direct DB query to yield_opportunities
- [ ] No imports from `discover/db/` or `discover/routes/`

### 2. API parity

Compare with Python (use a tracked wallet address):
```bash
# Python
curl -s http://localhost:8000/api/portfolio/{wallet}/positions | jq '.data | length'
curl -s http://localhost:8000/api/portfolio/{wallet}/positions | jq '.data[0] | keys'

# Node.js
curl -s http://localhost:8001/api/monitor/portfolio/{wallet}/positions | jq '.data | length'
curl -s http://localhost:8001/api/monitor/portfolio/{wallet}/positions | jq '.data[0] | keys'
```

- [ ] Same position count
- [ ] Same response shape (all fields: deposit_amount_usd, pnl_usd, pnl_pct, apy_realized, etc.)
- [ ] Position history: bucketing (1h/4h/12h) matches Python
- [ ] Events: same tx_signatures, amounts, timestamps
- [ ] Track endpoint: POST works, status polling works
- [ ] Token balances: GET /portfolio/:wallet returns SPL balances

### 3. Position fetcher correctness

**Kamino positions** (`kamino_position_fetcher.py` vs `kamino-position-fetcher.ts`):
- [ ] Vault positions: shares + current value
- [ ] Lending obligations: collateral + debt
- [ ] Multiply obligations: same structure as lending
- [ ] **Modified Dietz PnL**: accumulates deposits/withdraws/borrows/repays, detects full-withdrawal resets, computes `pnl_usd = current_net_value - initial_deposit_usd`
- [ ] `apy_realized` = `(pnl / initial_deposit) × (365 / held_days)`

**Drift positions** (`drift_position_fetcher.py`):
- [ ] IF staking: `(shares / total_shares) × vault_balance`
- [ ] Vault positions from snapshots (1d + 100d windows)
- [ ] Deduplication of stale positions (>7 days old)

**Jupiter positions** (`jupiter_position_fetcher.py`):
- [ ] jToken shares + underlying amount
- [ ] ATA address derivation
- [ ] First deposit timestamp via RPC pagination

### 4. Background fetch pattern
- [ ] POST /track returns immediately (doesn't block on fetching)
- [ ] Position fetchers run in background
- [ ] Status polling (pending → fetching → ready → error) works
- [ ] Shared `snapshot_at` timestamp across all 3 fetchers

### 5. Code quality
- [ ] No `any` types
- [ ] Error handling per wallet (one wallet failure doesn't stop others)
- [ ] Scheduler: jobs don't overlap
- [ ] Proper null handling for positions without matching opportunities

## Output format

🔴 **CRITICAL** / 🟡 **IMPORTANT** / 🟢 **MINOR**
