# Phase 1 Validator: Scaffold + Discover Module

Review the Phase 1 implementation in `backend-ts/` against `MIGRATION_PLAN.md`.

You are a strict code reviewer. Do NOT make any code changes. Only review and report issues.

## What to review

The executor should have created `backend-ts/` with a Fastify server and the Discover module (yield data + protocols).

## Review checklist

### 1. Project setup
- [ ] `package.json` has correct dependencies (fastify, drizzle-orm, zod, node-cron, etc.)
- [ ] `tsconfig.json` has strict mode enabled
- [ ] `Dockerfile` exists and follows `node:20-slim` pattern
- [ ] `.env.example` lists all required env vars
- [ ] `npm run build` compiles without errors

### 2. Architecture compliance
- [ ] Fastify plugin pattern: Discover registers as a plugin in `discover/index.ts`
- [ ] Module structure: `discover/db/`, `discover/routes/`, `discover/services/`, `discover/service.ts`
- [ ] `shared/` contains only cross-cutting concerns (auth, types, RPC, error handling)
- [ ] No business logic in `shared/`
- [ ] Service interface defined in `discover/service.ts` (getOpportunityById, getOpportunityMap)

### 3. API parity — compare with Python backend

Run both backends and compare:
```bash
# Python (should already be running on 8000)
curl -s http://localhost:8000/api/yields | jq '.data | length'
curl -s http://localhost:8000/api/yields | jq '.data[0] | keys'

# Node.js
curl -s http://localhost:8001/api/discover/yields | jq '.data | length'
curl -s http://localhost:8001/api/discover/yields | jq '.data[0] | keys'
```

Check:
- [ ] Same number of yields returned
- [ ] Same response shape (`data` array + `meta` object with total/limit/offset)
- [ ] Same fields per yield (id, name, category, tokens, apy_current, apy_7d_avg, tvl_usd, etc.)
- [ ] Query params work: `?category=lending`, `?sort=apy_desc`, `?stablecoins_only=true`, `?tokens=USDC`
- [ ] Single yield: `/api/discover/yields/1` matches Python `/api/yields/1`
- [ ] History: `/api/discover/yields/1/history?period=7d` matches Python
- [ ] Protocols: `/api/discover/protocols` matches Python

### 4. Fetcher correctness — compare with Python line by line

Read the Python fetcher files and compare with TypeScript ports:

**Kamino fetcher** (most complex — `backend/app/services/kamino_fetcher.py` vs `backend-ts/src/discover/services/kamino-fetcher.ts`):
- [ ] Earn vault fetch: calls `/kvaults/vaults` + per-vault `/metrics`
- [ ] Lending reserve fetch: calls `/v2/kamino-market` + reserve metrics
- [ ] Multiply market fetch: all markets + per-reserve history
- [ ] APY calculations match (7d/30d averages from snapshots)
- [ ] TVL computation matches
- [ ] Risk tier classification matches
- [ ] Multiply net APY formula: `(collateral_yield × leverage) - (borrow_apy × (leverage - 1))`
- [ ] Min TVL filter: $100k

**Drift fetcher** (`backend/app/services/drift_fetcher.py`):
- [ ] Insurance fund: `/stats/insuranceFund` + on-chain vault balances
- [ ] Vaults: `/stats/vaults` + app.drift.trade APY breakdown
- [ ] IF vault PDA derivation correct
- [ ] Only stablecoin IFs ingested

**Jupiter fetcher** (`backend/app/services/jupiter_fetcher.py`):
- [ ] Earn tokens: `/lend/v1/earn/tokens`
- [ ] Multiply vaults: `/lend/v1/borrow/vaults`
- [ ] Max leverage formula matches
- [ ] Net APY capped at 0

### 5. Shared utilities
- [ ] `safeFloat()` matches Python `safe_float()`
- [ ] `fetchWithRetry()` — 3 attempts, exponential backoff (matches tenacity config)
- [ ] `fetchOrNull()` — returns null on failure (matches `get_or_none()`)
- [ ] `cached()` — TTL cache with Map (matches Python `_cache` dict)
- [ ] `parseTimestamp()` — handles ISO string and epoch (matches Python)
- [ ] `upsertOpportunity()` — create or update + snapshot (matches Python)

### 6. Code quality
- [ ] No `any` types (TypeScript strict)
- [ ] Proper error handling (what happens when Kamino API is down?)
- [ ] Structured logging (not console.log)
- [ ] Scheduler: coalesce=true equivalent (don't overlap jobs)
- [ ] DB connection pool configured
- [ ] Health endpoint checks DB connectivity

### 7. Missing pieces
- [ ] Seed data for protocols (Kamino, Drift, Jupiter, Exponent, Solstice)
- [ ] Swagger/OpenAPI docs generated from Zod schemas
- [ ] Rate limiting on endpoints

## Output format

Categorize each issue as:
- 🔴 **CRITICAL** — must fix before proceeding to Phase 2
- 🟡 **IMPORTANT** — should fix before Phase 2
- 🟢 **MINOR** — can fix later

Example:
```
🔴 CRITICAL: Kamino fetcher missing multiply market fetch — only earn vaults and lending implemented
🟡 IMPORTANT: upsertOpportunity doesn't record yield_snapshots — Python version does
🟢 MINOR: Missing JSDoc on service interface methods
```
