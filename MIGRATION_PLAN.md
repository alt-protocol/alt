# Unified Node.js Backend + MCP Server

## Context

Akashi's Python backend (~4,300 lines) handles yield data fetching, position tracking, and API serving. The frontend (TypeScript) builds all transactions via protocol SDKs. The goal is to:

1. **Migrate** the Python backend to Node.js/TypeScript — single language across the entire stack
2. **Add transaction building** endpoints so agents can get unsigned transactions
3. **Create a thin MCP server** that wraps the transaction API for AI agent integration

This eliminates language switching, enables code sharing (protocol adapters, types), and positions the platform as infrastructure for autonomous yield management at scale.

## Architecture Overview

```
                    Frontend (Next.js, Vercel)
                         ↓ HTTP
Unified Node.js Backend (Railway)
  ├── Data API (/api/yields, /api/protocols, /api/portfolio)  ← replaces Python
  ├── Transaction API (/api/tx/build-deposit, /api/tx/submit) ← NEW
  ├── Background Jobs (yield fetchers, position fetchers)      ← replaces APScheduler
  └── Protocol Adapters (shared with frontend origin code)
                         ↓
                    PostgreSQL (same DB, same schema)

Thin MCP Server (npm package, runs locally on agent's machine)
  └── Translates MCP tool calls → HTTP requests to backend /api/tx/*
```

### Non-Custodial MCP Flow

```
Agent                          MCP Server                    Backend                     Solana
  |                                |                            |                          |
  |-- list_opportunities --------->|-- GET /api/yields -------->|                          |
  |<-- yields + APYs -------------|<-- JSON -------------------|                          |
  |                                |                            |                          |
  |-- build_deposit(opp, amt) ---->|-- POST /api/tx/build ----->|                          |
  |                                |                            |-- build unsigned tx ----->|
  |                                |                            |<-- simulate tx ----------|
  |<-- unsigned tx + simulation --|<-- JSON -------------------|                          |
  |                                |                            |                          |
  |   [agent verifies & signs]     |                            |                          |
  |                                |                            |                          |
  |-- submit_transaction(signed)-->|-- POST /api/tx/submit ---->|                          |
  |                                |                            |-- send to Helius RPC --->|
  |                                |                            |<-- confirmation ---------|
  |<-- tx signature + status -----|<-- JSON -------------------|                          |
```

Key: Backend never holds private keys. Signing happens on the agent's side.

## Tech Stack

| Concern | Choice | Why |
|---------|--------|-----|
| Framework | **Hono** | TypeScript-first, fast, lightweight, works everywhere (Node, Bun, edge) |
| ORM | **Drizzle** | Type-safe, schema-as-code, lightweight, excellent PostgreSQL support |
| Validation | **Zod** | TypeScript-first, pairs with Drizzle and Hono |
| Scheduler | **node-cron** (Phase 1) → **BullMQ** (Phase 2) | Simple cron first, Redis-backed queues when scaling |
| HTTP client | **Native fetch** + retry wrapper | Node.js 18+ built-in, no deps needed |
| Rate limiting | **hono-rate-limiter** | Middleware pattern, in-memory → Redis at scale |
| MCP SDK | **@modelcontextprotocol/sdk** | Official SDK, stdio transport |

## Project Structure

```
backend-ts/                          # New Node.js backend (replaces backend/)
  package.json
  tsconfig.json
  drizzle.config.ts
  Dockerfile
  src/
    index.ts                         # Entry point: start server + scheduler
    app.ts                           # Hono app with all routes + middleware

    db/
      schema.ts                      # Drizzle schema (all 6 tables)
      index.ts                       # DB connection pool
      seed.ts                        # Protocol seed data

    api/
      yields.ts                      # GET /api/yields, /api/yields/:id, /api/yields/:id/history
      protocols.ts                   # GET /api/protocols
      portfolio.ts                   # POST /api/portfolio/:wallet/track + 5 GET endpoints
      tx.ts                          # POST /api/tx/build-deposit, build-withdraw, submit
      health.ts                      # GET /api/health

    services/
      kamino-fetcher.ts              # Port from Python (850 lines → ~600 TS)
      drift-fetcher.ts               # Port from Python (422 lines → ~350 TS)
      jupiter-fetcher.ts             # Port from Python (340 lines → ~280 TS)
      kamino-position-fetcher.ts     # Port from Python
      drift-position-fetcher.ts      # Port from Python
      jupiter-position-fetcher.ts    # Port from Python
      utils.ts                       # retry, cache, timestamps, PnL, DB helpers

    protocols/                       # From frontend (shared tx building logic)
      types.ts
      kamino.ts
      drift.ts
      jupiter.ts
      index.ts

    lib/
      rpc.ts                         # Solana RPC singleton
      instruction-converter.ts       # From frontend (verbatim)
      tx-builder.ts                  # Build unsigned transactions
      tx-preview.ts                  # Simulate + describe transactions
      guards.ts                      # Safety checks (stablecoin, limits)
      constants.ts                   # Token mints, program IDs

    middleware/
      rate-limit.ts                  # Per-endpoint rate limiting
      auth.ts                        # API key auth (for /api/tx/* endpoints)
      error-handler.ts               # Unified error responses

    scheduler.ts                     # Cron jobs (yield + position fetchers)

mcp-server/                          # Thin MCP wrapper (~200 lines)
  package.json
  tsconfig.json
  src/
    index.ts                         # stdio entry point
    server.ts                        # Tool definitions → HTTP calls to backend
```

## Database Migration

**Same PostgreSQL, same 6 tables, same schema.** Drizzle connects to the existing database. No data migration needed.

**Migration strategy:** Use Drizzle's `drizzle-kit pull` to introspect the existing DB and generate the schema file, ensuring exact match.

## API Endpoints (100% backward compatible)

### Existing endpoints (same contract as Python):

| Endpoint | Method | Rate limit | Notes |
|----------|--------|-----------|-------|
| `/api/yields` | GET | 60/min | Same query params: category, sort, tokens, vault_tag, stablecoins_only, limit, offset |
| `/api/yields/:id` | GET | 60/min | Same response with deposit_address, extra_data, protocol, recent_snapshots |
| `/api/yields/:id/history` | GET | 60/min | Same: period (7d/30d/90d), limit, offset |
| `/api/protocols` | GET | 60/min | Same response |
| `/api/portfolio/:wallet/track` | POST | 5/min | Same background fetch pattern |
| `/api/portfolio/:wallet/status` | GET | 60/min | Same fetch_status response |
| `/api/portfolio/:wallet/positions` | GET | 60/min | Same filters, latest snapshot logic |
| `/api/portfolio/:wallet/positions/history` | GET | 60/min | Same bucketing (1h/4h/12h) |
| `/api/portfolio/:wallet/events` | GET | 60/min | Same event history |
| `/api/portfolio/:wallet` | GET | 30/min | Same Helius RPC token balance fetch |
| `/api/health` | GET | — | Same DB check |

### New transaction endpoints:

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/tx/build-deposit` | POST | API key | Build unsigned deposit transaction |
| `/api/tx/build-withdraw` | POST | API key | Build unsigned withdraw transaction |
| `/api/tx/submit` | POST | API key | Submit signed transaction via RPC |
| `/api/tx/simulate` | POST | API key | Simulate a transaction (optional standalone) |

### Transaction API request/response:

**POST `/api/tx/build-deposit`**
```json
// Request
{
  "opportunity_id": 42,
  "amount": "100",
  "wallet_address": "7xKX..."
}

// Response
{
  "unsigned_transaction": "<base64 serialized tx>",
  "preview": {
    "description": "Deposit 100 USDC into Kamino USDC Vault",
    "protocol": "Kamino",
    "category": "vault",
    "programs_involved": [
      { "name": "Kamino Vault Program", "address": "kvau..." }
    ],
    "expected_balance_changes": [
      { "token": "USDC", "change": "-100.00" },
      { "token": "kUSDC", "change": "+99.85" }
    ],
    "simulation_status": "success",
    "estimated_fee_sol": "0.000005"
  }
}
```

**POST `/api/tx/submit`**
```json
// Request
{ "signed_transaction": "<base64 signed tx>" }

// Response
{ "signature": "5xYz...", "status": "confirmed" }
```

## Service Migration Map

### Yield Fetchers

| Python | TypeScript | Key changes |
|--------|-----------|-------------|
| `kamino_fetcher.py` (850 lines) | `kamino-fetcher.ts` (~600 lines) | `httpx` → native `fetch`, `tenacity` → custom retry, `safe_float` → TS helper |
| `drift_fetcher.py` (422 lines) | `drift-fetcher.ts` (~350 lines) | `solders.Pubkey.find_program_address` → `@solana/kit` `getProgramDerivedAddress` |
| `jupiter_fetcher.py` (340 lines) | `jupiter-fetcher.ts` (~280 lines) | Straightforward port, simplest fetcher |

### Position Fetchers

| Python | TypeScript | Key changes |
|--------|-----------|-------------|
| `kamino_position_fetcher.py` (700 lines) | `kamino-position-fetcher.ts` (~550 lines) | Modified Dietz PnL logic preserved exactly |
| `drift_position_fetcher.py` (500 lines) | `drift-position-fetcher.ts` (~400 lines) | IF vault PDA derivation → `@solana/kit` |
| `jupiter_position_fetcher.py` (400 lines) | `jupiter-position-fetcher.ts` (~320 lines) | ATA derivation → `@solana/kit` |

### Shared Utilities

| Python function | TypeScript equivalent |
|----------------|----------------------|
| `safe_float(val)` | `safeFloat(val: unknown): number \| null` |
| `get_with_retry(url, client)` | `fetchWithRetry(url, opts)` using native fetch + retry logic |
| `get_or_none(url, client)` | `fetchOrNull(url, opts)` |
| `cached(key, ttl, fn)` | `cached<T>(key, ttlMs, fn)` with Map + TTL |
| `parse_timestamp(ts)` | `parseTimestamp(ts: string \| number): Date \| null` |
| `compute_realized_apy(pnl, deposit, days)` | `computeRealizedApy(pnl, deposit, days): number \| null` |
| `load_opportunity_map(db)` | `loadOpportunityMap(db)` with Drizzle queries |
| `store_position_rows(db, positions, ts)` | `storePositionRows(db, positions, ts)` with Drizzle insert |
| `upsert_opportunity(db, ...)` | `upsertOpportunity(db, ...)` with Drizzle upsert |

## Protocol Adapters (Transaction Building)

Adapted from `frontend/src/lib/protocols/` for server-side use:

**Changes from frontend versions:**
1. Accept `walletAddress: string` instead of `TransactionSendingSigner` (build unsigned tx, no signer needed at build time)
2. Remove `"use client"` directives
3. Replace `@/lib/*` imports with local imports
4. Replace `NEXT_PUBLIC_*` env vars with server env vars
5. Remove Kamino multiply support (blocked by guards for agents)

**Files to adapt:**
- `frontend/src/lib/protocols/types.ts` → `backend-ts/src/protocols/types.ts`
- `frontend/src/lib/protocols/kamino.ts` → vault + lending only
- `frontend/src/lib/protocols/drift.ts` → insurance fund + vault
- `frontend/src/lib/protocols/jupiter.ts` → earn/lending
- `frontend/src/lib/instruction-converter.ts` → copy verbatim
- `frontend/src/lib/transaction-utils.ts` → extract `buildTransactionMessage`

## Safety Guards

Applied to all `/api/tx/*` endpoints:

1. **API key authentication** — agents must register for a key
2. **Stablecoin-only** — reject opportunities without USDC/USDT/USDS
3. **Category blocklist** — `multiply` blocked (configurable)
4. **Per-tx spend limit** — `MCP_MAX_DEPOSIT_USD` (default $1000)
5. **Simulation before return** — every build endpoint simulates; fail fast
6. **Program verification** — validate instruction program IDs match known protocols

## MCP Server (Thin Wrapper)

~200 lines total. Zero protocol SDKs, zero RPC connections.

**Tools:**

| Tool | HTTP call |
|------|----------|
| `list_opportunities` | `GET /api/yields?stablecoins_only=true` |
| `get_opportunity_details` | `GET /api/yields/:id` |
| `get_positions` | `GET /api/portfolio/:wallet/positions` |
| `get_wallet_balance` | `GET /api/portfolio/:wallet` |
| `build_deposit` | `POST /api/tx/build-deposit` |
| `build_withdraw` | `POST /api/tx/build-withdraw` |
| `submit_transaction` | `POST /api/tx/submit` |

**Config:** Just needs `AKASHI_API_URL` and `AKASHI_API_KEY` env vars.

## Environment Variables (backend-ts)

```
DATABASE_URL=postgresql://...
HELIUS_API_KEY=...
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=...
JUPITER_API_KEY=...                    # optional, higher rate limits
CORS_ORIGINS=http://localhost:3000     # comma-separated
PORT=8000
MCP_MAX_DEPOSIT_USD=1000               # per-tx limit for agent endpoints
MCP_BLOCKED_CATEGORIES=multiply        # comma-separated
```

## Implementation Phases

### Phase 1: Backend scaffold + data API (replaces Python)
1. Create `backend-ts/` with package.json, tsconfig, Dockerfile
2. Set up Drizzle with `drizzle-kit pull` from existing DB
3. Port `api/yields.ts`, `api/protocols.ts`, `api/health.ts`
4. Port `services/utils.ts` (retry, cache, timestamps, PnL)
5. Port `api/portfolio.ts` (all 6 endpoints)
6. Set up scheduler with node-cron
7. Port yield fetchers (kamino → drift → jupiter)
8. Port position fetchers
9. **Verify:** all existing frontend calls work against new backend

### Phase 2: Transaction building API
1. Copy + adapt protocol adapters from frontend
2. Create `tx-builder.ts`, `tx-preview.ts`, `guards.ts`
3. Create `api/tx.ts` with build-deposit, build-withdraw, submit endpoints
4. Add API key auth middleware
5. **Verify:** build unsigned tx, sign externally, submit, confirm on-chain

### Phase 3: MCP server
1. Create `mcp-server/` with minimal deps
2. Register 7 tools mapping to backend HTTP endpoints
3. Test with MCP Inspector
4. Test with Claude Desktop
5. **Verify:** full agent flow (discover → build → sign → submit)

### Phase 4: Deploy + cut over
1. Deploy `backend-ts` to Railway alongside Python backend
2. Run both in parallel, compare responses
3. Switch frontend `NEXT_PUBLIC_API_URL` to new backend
4. Retire Python backend
5. Publish MCP server as npm package

## Key Files to Reference

**Python backend (source of truth for business logic):**
- `backend/app/services/kamino_fetcher.py` — most complex fetcher
- `backend/app/services/utils.py` — shared utility patterns
- `backend/app/routers/portfolio.py` — most complex router (438 lines)
- `backend/app/routers/yields.py` — query/filter/sort logic
- `backend/app/models/` — all table definitions
- `backend/app/schemas/__init__.py` — all response types

**Frontend (source for protocol adapters):**
- `frontend/src/lib/protocols/types.ts` — ProtocolAdapter interface
- `frontend/src/lib/protocols/kamino.ts` — Kamino adapter
- `frontend/src/lib/protocols/drift.ts` — Drift adapter
- `frontend/src/lib/protocols/jupiter.ts` — Jupiter adapter
- `frontend/src/lib/hooks/useTransaction.ts` — tx lifecycle to extract
- `frontend/src/lib/instruction-converter.ts` — copy verbatim
- `frontend/src/lib/transaction-utils.ts` — buildTransactionMessage

## Verification Plan

1. **Data API parity:** Run Python and Node.js backends side-by-side, compare responses for every endpoint with same inputs
2. **Fetcher parity:** Compare yield data ingested by both backends after one cron cycle
3. **Position parity:** Track same wallet, compare position snapshots
4. **Transaction flow:** build-deposit → sign with test wallet → submit → verify on-chain
5. **MCP flow:** Claude Desktop → list opportunities → build deposit → sign → submit → check position
6. **Load test:** verify Node.js backend handles target throughput
