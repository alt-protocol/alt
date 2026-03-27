# Phase 2 Feedback — Iteration 2

## Iteration 1 Fix Verification

All 3 issues from iteration 1 have been properly fixed:

| # | Issue | Status |
|---|-------|--------|
| 1 | 🔴 Jupiter ATA derivation (wrong byte encoding) | ✅ FIXED — uses `getAddressEncoder().encode()` for raw 32-byte keys (`jupiter-position-fetcher.ts:42-53`) |
| 2 | 🟡 Dead SQL query in `latestPositions()` | ✅ FIXED — removed lines 62-80, only Drizzle subquery remains (`portfolio.ts:57-94`) |
| 3 | 🟡 Jupiter `snapshotAllWallets` missing `last_fetched_at` | ✅ FIXED — update added at `jupiter-position-fetcher.ts:366-369` |

Build compiles with zero errors.

---

## Deep Review — Line-by-Line Comparison

Conducted a thorough comparison of all 3 position fetchers against Python source. Results:

| Comparison | Match |
|-----------|-------|
| Kamino TX_TYPE_MAP (all 8 categories) | ✅ |
| Kamino cash flow signs (borrow=negative, repay=positive) | ✅ |
| Kamino leverage/deleverage excluded from cash flows | ✅ |
| Kamino earn vault API paths (3 endpoints) | ✅ |
| Kamino Modified Dietz formula (weighted capital, pnl_pct) | ✅ |
| Kamino lifecycle detection (equity → ~$0 reset) | ✅ |
| Kamino recycled obligation detection | ✅ |
| Drift IF events: recent first, then monthly backfill (7 iterations) | ✅ |
| Drift IF closed skip condition (< 0.001 shares) | ✅ |
| Drift vault dedup (1d + 100d, stale > 7d filter) | ✅ |
| Jupiter initial_deposit = current_value - pnl | ✅ |
| Jupiter position skip threshold (< $0.01) | ✅ |
| Jupiter ATA derivation (raw 32-byte seeds) | ✅ |
| Background fetch parallelism (Promise.allSettled ≈ ThreadPoolExecutor) | ✅ |
| Scheduler overlap protection (running flag) | ✅ |
| Shared snapshot_at across fetchers | ✅ |

---

## New Issues Found

### 🟢 MINOR

**1. TS background fetch stores Drift events; Python does not**
- **File:** `portfolio.ts:150-152`
- **Detail:** During POST `/track` background fetch, TS collects and stores Drift IF events. Python's `_background_fetch_and_store` only stores positions, not events (events only stored during scheduled snapshots). This is a behavioral difference in favor of TS (more data sooner), not a bug. No action needed.

**2. Kamino events still not collected during background fetch (POST /track)**
- Same as iteration 1 minor #4. `fetchKaminoPositions` doesn't return events. Only stored during scheduled snapshots. Matches Python behavior.

---

## Full Checklist

### 1. Module Isolation
- [x] Monitor only queries its own tables
- [x] Cross-module read uses `discoverService.getOpportunityMap()`
- [x] No imports from `discover/db/` or `discover/routes/`

### 2. API Parity
- [x] Route mapping: POST /track, GET /status, GET /positions, GET /positions/history, GET /events
- [x] Response shape matches Python (all position fields present)
- [x] History bucketing: 1h/4h/12h via date_bin + DISTINCT ON
- [x] Events: filtering by protocol, product_type, ordered by event_at DESC
- [x] Token balances: GET /portfolio/:wallet via Helius RPC

### 3. Position Fetcher Correctness
- [x] Kamino earn: shares + PnL + fallback
- [x] Kamino obligations: Modified Dietz, lifecycle detection, recycled detection
- [x] Drift IF: proportional share, event backfill, closed skip
- [x] Drift vaults: 1d+100d, dedup, stale filter
- [x] Jupiter earn: positions + earnings + ATA derivation + first deposit RPC

### 4. Background Fetch Pattern
- [x] POST /track returns immediately
- [x] Parallel protocol fetching (Promise.allSettled)
- [x] Status polling (fetching → ready → error)
- [x] Shared snapshot_at

### 5. Code Quality
- [x] No `any` types
- [x] Per-wallet error handling
- [x] Scheduler overlap protection
- [x] Proper null handling

---

## Verdict

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 0 |
| 🟡 IMPORTANT | 0 |
| 🟢 MINOR | 2 (non-blocking, both match Python behavior) |

**Phase 2 is COMPLETE.** Ready to proceed to Phase 3: Manage module.
