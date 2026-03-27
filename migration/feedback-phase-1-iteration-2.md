# Phase 1 Feedback — Iteration 2

## Iteration 1 Fix Verification

All 6 issues from iteration 1 have been properly fixed:

| # | Issue | Status |
|---|-------|--------|
| 1 | 🔴 Scheduler overlap protection | ✅ FIXED — `running` Set with guard in `scheduler.ts:14-38` |
| 2 | 🟡 batchSnapshotAvg half-window | ✅ FIXED — `Math.floor(days / 2)` at `utils.ts:195,239` |
| 3 | 🟡 @fastify/swagger removed | ✅ FIXED — removed from package.json |
| 4 | 🟡 Transaction boundaries | ✅ FIXED — all 3 fetchers wrapped in `db.transaction()` |
| 5 | 🟡 db:push script | ✅ FIXED — added to package.json scripts |
| 6 | 🟢 Kamino multiply debug logging | ✅ FIXED — `logger.debug()` at `kamino-fetcher.ts:735-745` |

---

## Full Checklist Review

### 1. Project Setup

- [x] `package.json` — correct deps (fastify 5, drizzle-orm, zod, node-cron, pino, @solana/addresses, pg)
- [x] `tsconfig.json` — `"strict": true`, ES2022, NodeNext
- [x] `Dockerfile` — node:20-slim, multi-stage build, `npm ci --production`
- [x] `.env.example` — DATABASE_URL, HELIUS_API_KEY, HELIUS_RPC_URL, JUPITER_API_KEY, CORS_ORIGINS, PORT
- [x] `npm run build` — compiles with zero errors

### 2. Architecture Compliance

- [x] Fastify plugin: `discoverPlugin` in `discover/index.ts`, registered at `/api/discover`
- [x] Module structure: `db/`, `routes/`, `services/`, `service.ts`, `scheduler.ts`, `index.ts`
- [x] `shared/` — db, error-handler, http, logger, types, utils, constants (no business logic)
- [x] Service interface: `DiscoverService` in `shared/types.ts`, implemented in `discover/service.ts`
- [x] Cross-module methods: `getOpportunityById()`, `getOpportunityMap()`

### 3. API Parity

- [x] Route mapping: `/api/yields` → `/api/discover/yields` (+ detail, history, protocols)
- [x] Response shape: `{data: [...], meta: {total, last_updated, limit, offset}}`
- [x] All fields present per yield (id, name, category, tokens, apy_current, apy_7d_avg, tvl_usd, etc.)
- [x] Query params: category, sort (4 options), tokens (csv), vault_tag, stablecoins_only, limit, offset
- [x] Stablecoins filter: multiply → stable_loop/rwa_loop; non-multiply → token overlap; PT-* → unnest
- [x] Detail endpoint: full opportunity + protocol + recent_snapshots (7d)
- [x] History endpoint: period (7d/30d/90d), limit, offset

### 4. Fetcher Correctness

**Kamino** (793 lines):
- [x] Earn vaults: `/kvaults/vaults` + `/metrics`, batch 20, MIN_TVL $100k, APY×100
- [x] Lending reserves: primary markets, batchSnapshotAvg, APY×100
- [x] Multiply markets: all markets, pair enumeration, linreg, leverage table, rich extra_data
- [x] Token classification: YIELD_BEARING_STABLES, REGULAR_STABLES, LST_SYMBOLS
- [x] Net APY formula: `collYield × leverage - borrowApy × (leverage - 1)`
- [x] Deactivate stale: `kmul-%` pattern

**Drift** (427 lines):
- [x] Insurance Fund: stablecoin-only, PDA derivation, on-chain balances via Helius RPC
- [x] Earn Vaults: USDC-only, 90d APY as current, snapshot fallback
- [x] Vault APYs from app.drift.trade (7d/30d/90d/180d/365d)
- [x] Deactivate stale: `drift-vault-%`

**Jupiter** (332 lines):
- [x] Earn Tokens: MIN_TVL $100k, APY = totalRateBps/100, depeg, batchSnapshotAvg
- [x] Multiply Vaults: multiply.enabled, max leverage formula, net APY capped at 0
- [x] Headers: JUPITER_API_KEY as x-api-key
- [x] Deactivate stale: `juplend-earn-%`, `juplend-mult-%`

### 5. Shared Utilities

- [x] safeFloat() — Number.isFinite check
- [x] getWithRetry() — 3 attempts, exponential backoff 1s→10s
- [x] getOrNull() — wraps getWithRetry, returns null on failure
- [x] cached() / cachedAsync() — TTL cache with Map
- [x] parseTimestamp() — handles epoch (auto ms/sec) and ISO
- [x] upsertOpportunity() — find by external_id, update/insert + snapshot
- [x] batchSnapshotAvg() — half-window check + AVG query
- [x] deactivateStale() — shared function with LIKE pattern

### 6. Code Quality

- [x] No `any` types — zero occurrences
- [x] Proper error handling — fetchers catch and log, getOrNull returns null
- [x] Structured logging — Pino throughout (no console.log in business logic)
- [x] Scheduler overlap protection — `running` Set prevents concurrent runs
- [x] DB pool — max 20 connections
- [x] Health endpoint — `/api/health` checks DB with `SELECT 1`
- [x] Seed data — 5 protocols (kamino, drift, jupiter, exponent, solstice), idempotent
- [x] Rate limiting — global 100/min + per-route 60/min

---

## New Issues Found

### 🟢 MINOR

**1. `console.error` in startup error path**
- **File:** `backend-ts/src/index.ts:32`
- **Detail:** Uses `console.error("Failed to start server:", err)` instead of Pino logger. Acceptable since logger may not be initialized yet, but could use a startup logger instance.

**2. STABLECOIN_SYMBOLS still has minor additions vs Python**
- **File:** `backend-ts/src/shared/constants.ts`
- **Detail:** TS version includes USDC-1, USDC-Dep, EURC, sUSDe, PST, FWDI, wYLDS not in Python `config/stablecoins.py`. This is likely intentional (more up-to-date) but `?stablecoins_only=true` will return slightly different results during parallel backend operation.

**3. getWithRetry retries on ALL errors (Python retries selectively)**
- **File:** `backend-ts/src/shared/http.ts:31`
- **Detail:** Python tenacity retries only HTTPStatusError/ConnectError/ReadTimeout. TS retries any thrown error. Low risk but may waste time on non-transient errors.

---

## Verdict

**Phase 1 is COMPLETE.** All critical and important issues from iteration 1 are resolved. The remaining 3 minor issues do not block Phase 2.

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 0 |
| 🟡 IMPORTANT | 0 |
| 🟢 MINOR | 3 (non-blocking) |

**Ready to proceed to Phase 2: Monitor module.**
