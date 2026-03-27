# Akashi Platform — Modular Monolith with 3 Independent Services

## Context

Akashi is evolving from a simple yield aggregator into a platform with three distinct functions:
1. **Discover** — find and compare yield opportunities across protocols
2. **Manage** — build and execute deposit/withdraw transactions
3. **Monitor** — track portfolio positions, PnL, and events

These are architecturally independent concerns with separate data models. Building them as 3 independent modules within a modular monolith gives clean boundaries without operational overhead. Each module has its own DB schema, routes, and business logic — no cross-module imports.

Future extensions (out of scope — discussed verbally, architecture supports them as additional modules):
- **AI Agents** — executor + validator sub-agents (compose Discover + Manage + Monitor)
- **Social Layer** — strategy sharing, copy trading (new module with own schema)

## Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Web App   │  │  MCP Server │  │ Mobile App  │  │ Telegram Bot│
│  (Next.js)  │  │  (~200 LOC) │  │  (future)   │  │  (future)   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       └────────────────┴────────────────┴────────────────┘
                                │
                    ┌───────────┴───────────┐
                    │   Modular Monolith    │
                    │   (Node.js/Fastify)   │
                    │                       │
                    │  ┌─────────────────┐  │
                    │  │    DISCOVER     │  │  /api/discover/*
                    │  │  yields, protos │  │  schema: discover
                    │  │  fetcher jobs   │  │
                    │  └─────────────────┘  │
                    │  ┌─────────────────┐  │
                    │  │     MANAGE      │  │  /api/manage/*
                    │  │  tx build/submit│  │  schema: manage
                    │  │  protocol SDKs  │  │
                    │  └─────────────────┘  │
                    │  ┌─────────────────┐  │
                    │  │    MONITOR      │  │  /api/monitor/*
                    │  │  positions, PnL │  │  schema: monitor
                    │  │  position jobs  │  │
                    │  └─────────────────┘  │
                    │                       │
                    │  shared/ (auth, types)│
                    └───────────┬───────────┘
                                │
                    ┌───────────┴───────────┐
                    │  PostgreSQL (1 inst)  │
                    │  3 schemas:           │
                    │  discover │ manage │  │
                    │  monitor             │
                    └───────────────────────┘
```

## Module Boundaries

### DISCOVER — "What opportunities exist?"
**Schema: `discover`**
- `discover.protocols` — protocol metadata (Kamino, Drift, Jupiter)
- `discover.yield_opportunities` — live yield data (APY, TVL, risk, deposit_address)
- `discover.yield_snapshots` — historical APY/TVL time-series

**Routes:** `/api/discover/yields`, `/api/discover/yields/:id`, `/api/discover/yields/:id/history`, `/api/discover/protocols`

**Background jobs:** Yield fetchers (Kamino, Drift, Jupiter) on 15-min cron. **Dependencies:** None — fully independent.

### MANAGE — "Execute a deposit or withdrawal"
**Schema: `manage`**
- `manage.api_keys` — API key auth for agent access

**Routes:** `/api/manage/tx/build-deposit`, `/api/manage/tx/build-withdraw`, `/api/manage/tx/submit` (all POST, API key auth)

**Contains:** Protocol adapters (Kamino, Drift, Jupiter SDKs), instruction serializer, safety guards.

**Transaction flow — dual submission:**
1. Client calls `POST /api/manage/tx/build-deposit` → gets unsigned instructions (+ optional simulation preview)
2. Client signs locally (wallet, keypair, Privy, Ledger — any custody)
3. Client chooses submission path:
   - **Direct:** client submits signed tx to Solana via their own RPC (lower latency, frontend default)
   - **Via backend:** client sends signed tx to `POST /api/manage/tx/submit` → backend submits via Helius RPC (for MCP agents, bots)

**Simulation is opt-in:**
- `simulate: true` in build request → response includes preview (balance changes, programs, fee estimate)
- `simulate: false` (default) → response is just instructions (~200ms faster)
- Browser wallets already simulate before signing, so frontend skips it. MCP agents pass `simulate: true`.

**Dependencies:** Reads from Discover (`discoverService.getOpportunityById(id)`). Read-only cross-module call.

### MONITOR — "What's in my portfolio?"
**Schema: `monitor`**
- `monitor.tracked_wallets` — registered wallets + fetch status
- `monitor.user_positions` — position snapshots (value, PnL, APY)
- `monitor.user_position_events` — deposit/withdraw transaction history

**Routes:** `/api/monitor/portfolio/:wallet`, `/api/monitor/portfolio/:wallet/track`, `/api/monitor/portfolio/:wallet/status`, `/api/monitor/portfolio/:wallet/positions`, `/api/monitor/portfolio/:wallet/positions/history`, `/api/monitor/portfolio/:wallet/events`

**Background jobs:** Position fetchers on 15-min cron. **Dependencies:** Reads from Discover (`discoverService.getOpportunityMap()`). Read-only.

## Module Isolation Rules

1. No cross-module table access — each module only queries its own schema
2. Cross-module reads via service interfaces — defined TypeScript interfaces, not direct DB queries
3. No cross-module writes — modules never modify another module's data
4. Shared code in `shared/` — auth middleware, common types, error handling, RPC client
5. Each module registers its own Fastify plugin — routes, jobs, DB connection are self-contained
6. Splitting to separate services later = replace service interface calls with HTTP calls

## Project Structure

```
backend-ts/
  package.json, tsconfig.json, drizzle.config.ts, Dockerfile
  src/
    index.ts                           # Starts Fastify, registers all 3 modules
    shared/                            # Common code (types, auth, RPC, error handling, rate limiting, constants)
    discover/                          # MODULE 1
      index.ts, service.ts, scheduler.ts
      db/ (schema.ts, connection.ts)
      routes/ (yields.ts, protocols.ts)
      services/ (kamino-fetcher.ts, drift-fetcher.ts, jupiter-fetcher.ts, utils.ts)
    manage/                            # MODULE 2
      index.ts, service.ts
      db/ (schema.ts, connection.ts)
      routes/ (tx.ts)
      protocols/ (types.ts, kamino.ts, drift.ts, jupiter.ts, index.ts)
      services/ (tx-builder.ts, tx-preview.ts, instruction-serializer.ts, instruction-converter.ts, guards.ts)
    monitor/                           # MODULE 3
      index.ts, service.ts, scheduler.ts
      db/ (schema.ts, connection.ts)
      routes/ (portfolio.ts)
      services/ (kamino-position-fetcher.ts, drift-position-fetcher.ts, jupiter-position-fetcher.ts, utils.ts)

mcp-server/                            # Thin MCP wrapper (~200 lines)
  src/ (index.ts, server.ts)
```

## Tech Stack

| Concern | Choice |
|---------|--------|
| Framework | **Fastify** (each module = Fastify plugin) |
| ORM | **Drizzle** (per-schema connections) |
| Validation | **Zod** via `fastify-type-provider-zod` |
| Scheduler | **node-cron** → **BullMQ** at scale |
| MCP SDK | **@modelcontextprotocol/sdk** |

## Migration Strategy

Same repo, parallel backends. `backend-ts/` alongside `backend/`.

```
During migration:
  backend/       ← Python (port 8000, production)
  backend-ts/    ← Node.js (port 8001, development)
  frontend/      ← Points to 8000, switch to 8001 for testing
  mcp-server/    ← Added in Phase 5
```

## Implementation Phases

### Phase 1: Scaffold + Discover module (~1.5 weeks)
1. Create `backend-ts/` with package.json, tsconfig, Dockerfile
2. Set up Fastify with plugin architecture
3. Create `shared/` (auth, types, RPC, error handling)
4. Set up Drizzle with `discover` schema — pull existing tables
5. Port `discover/` module: routes + services (3 yield fetchers) + scheduler
6. **Verify:** `/api/discover/yields` matches Python `/api/yields`

### Phase 2: Monitor module (~1 week)
1. Set up Drizzle with `monitor` schema — pull existing tables
2. Port `monitor/` module: routes + services (3 position fetchers) + scheduler
3. Wire cross-module read: Monitor reads from Discover service interface
4. **Verify:** `/api/monitor/portfolio/:w/positions` matches Python

### Phase 3: Manage module (~1 week)
1. Set up Drizzle with `manage` schema (api_keys table)
2. Move protocol adapters from frontend → `manage/protocols/`
3. Create tx-builder, instruction-serializer, guards, tx-preview
4. Create routes: build-deposit, build-withdraw, submit, simulate
5. Wire cross-module read: Manage reads from Discover service interface
6. **Verify:** POST build-deposit returns valid unsigned instructions

### Phase 4: Frontend migration (~3-5 days)
1. Update API client URLs (`/api/yields` → `/api/discover/yields`, etc.)
2. Add instruction deserializer (JSON → @solana/kit Instruction)
3. Replace protocol adapter calls with `/api/manage/tx/*` API calls
4. Remove protocol SDK dependencies from package.json
5. Delete: `frontend/src/lib/protocols/`, `jupiter-swap.ts`, `multiply-luts.ts`
6. **Verify:** all flows work through new API

### Phase 5: MCP server (~2-3 days)
1. Create `mcp-server/` (~200 lines)
2. Register 7 tools → HTTP calls to discover/manage/monitor endpoints
3. Test with MCP Inspector + Claude Desktop

### Phase 6: Deploy + cut over (~2-3 days)
1. Deploy `backend-ts` to Railway alongside Python backend
2. Run both in parallel, compare responses
3. Switch frontend, retire Python backend
4. Rename `backend-ts/` → `backend/`
5. **CLAUDE.md:** Full rewrite for new architecture

## Key Files to Reference

**Python backend (port source):**
- `backend/app/services/kamino_fetcher.py` → `discover/services/`
- `backend/app/services/utils.py` → split into `discover/services/utils.ts` + `monitor/services/utils.ts`
- `backend/app/routers/portfolio.py` → `monitor/routes/`
- `backend/app/routers/yields.py` → `discover/routes/`
- `backend/app/models/` → split across 3 schema files
- `backend/app/schemas/__init__.py` → Zod schemas per module

**Frontend (adapter source):**
- `frontend/src/lib/protocols/*.ts` → `manage/protocols/`
- `frontend/src/lib/instruction-converter.ts` → `manage/services/`
- `frontend/src/lib/hooks/useTransaction.ts` — stays on frontend
- `frontend/src/components/DepositWithdrawPanel.tsx` — changes to call API

## Verification Plan

1. **Discover parity:** compare yield/protocol responses with Python backend
2. **Monitor parity:** compare portfolio/position responses with Python backend
3. **Manage tx build:** POST build-deposit → valid unsigned instructions
4. **End-to-end:** discover → build → sign → submit → monitor position
5. **MCP flow:** Claude Desktop → all 7 tools work
6. **Module isolation:** verify no cross-schema DB queries
7. **Frontend:** all pages work with new API routes
