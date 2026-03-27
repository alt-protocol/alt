# Phase 1: Scaffold + Discover Module

Read `MIGRATION_PLAN.md` at the project root for the full architecture.

## What to build

Create `backend-ts/` — a Node.js modular monolith with the **Discover** module as the first service.

## Steps

### 1. Scaffold `backend-ts/`
- `package.json` with dependencies: `fastify`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/swagger`, `drizzle-orm`, `pg`, `zod`, `fastify-type-provider-zod`, `node-cron`, `dotenv`
- Dev deps: `typescript`, `tsx`, `drizzle-kit`, `@types/node`, `@types/pg`
- `tsconfig.json` — strict mode, target ES2022, module NodeNext
- `Dockerfile` — `node:20-slim`, `npm ci --production`, run `dist/index.js`
- `.env.example` with `DATABASE_URL`, `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `JUPITER_API_KEY`, `CORS_ORIGINS`, `PORT`
- Scripts: `dev` (tsx watch), `build` (tsc), `start` (node dist/index.js), `db:pull` (drizzle-kit pull)

### 2. Set up Fastify with plugin architecture
- `src/index.ts` — entry point: load env, start Fastify, register modules
- `src/app.ts` — create Fastify instance with CORS, rate limiting, swagger, error handler, health endpoint

### 3. Create `shared/`
- `shared/types.ts` — cross-module interfaces (DiscoverService interface)
- `shared/auth.ts` — API key auth middleware (placeholder for Phase 3)
- `shared/rpc.ts` — Solana RPC singleton using `@solana/kit` `createSolanaRpc()`
- `shared/error-handler.ts` — unified error responses
- `shared/rate-limit.ts` — rate limiting config
- `shared/constants.ts` — token mints, program IDs

### 4. Set up Drizzle with `discover` schema
- Run `drizzle-kit pull` to introspect existing PostgreSQL tables
- Create `discover/db/schema.ts` — map `protocols`, `yield_opportunities`, `yield_snapshots` to `discover` schema
- Create `discover/db/connection.ts` — DB pool with `search_path` set to `discover`
- **Important:** The existing tables are in the `public` schema. For now, keep them in `public` and reference them directly. Schema migration to `discover.*` happens at cutover (Phase 6). Don't break the Python backend.

### 5. Port Discover routes
Port from Python `backend/app/routers/yields.py` and `protocols.py`:
- `GET /api/discover/yields` — list/filter/sort opportunities (same query params as Python: category, sort, tokens, vault_tag, stablecoins_only, limit, offset)
- `GET /api/discover/yields/:id` — single opportunity with recent snapshots
- `GET /api/discover/yields/:id/history` — APY/TVL time-series (period: 7d/30d/90d)
- `GET /api/discover/protocols` — list all protocols
- `GET /api/health` — DB health check

Use Zod schemas for validation and response types. Match the Python response shape exactly.

### 6. Port yield fetchers
Port from Python `backend/app/services/`:
- `discover/services/utils.ts` — port `safe_float`, `get_with_retry`, `get_or_none`, `cached`, `parse_timestamp`, `upsert_opportunity` from `backend/app/services/utils.py`
- `discover/services/kamino-fetcher.ts` — port from `kamino_fetcher.py` (earn vaults, lending reserves, multiply markets)
- `discover/services/drift-fetcher.ts` — port from `drift_fetcher.py` (insurance fund, vaults)
- `discover/services/jupiter-fetcher.ts` — port from `jupiter_fetcher.py` (earn tokens, multiply vaults)

### 7. Set up scheduler
- `discover/scheduler.ts` — node-cron job running all 3 fetchers every 15 minutes

### 8. Create Discover service interface
- `discover/service.ts` — public interface:
  ```typescript
  getOpportunityById(id: number): Promise<OpportunityDetail | null>
  getOpportunityMap(): Promise<Record<string, { id: number, apy_current: number | null, first_token: string }>>
  ```
  These are consumed by Monitor and Manage modules in later phases.

### 9. Register as Fastify plugin
- `discover/index.ts` — registers routes, starts scheduler

## Key constraints
- **Don't break the Python backend** — both must share the same PostgreSQL. Keep tables in `public` schema for now.
- **Port logic faithfully** — read each Python file and translate carefully. APY calculations, TVL computation, risk classification must match.
- Run on port 8001 (`PORT=8001` in .env).

## Verify before committing
1. `npm run build` compiles without errors
2. `npm run dev` starts on port 8001
3. `curl http://localhost:8001/api/health` returns `{"status":"ok"}`
4. `curl http://localhost:8001/api/discover/yields` returns yield data matching Python's `curl http://localhost:8000/api/yields`
5. `curl http://localhost:8001/api/discover/protocols` matches Python

When done, commit: `git add backend-ts/ && git commit -m "Phase 1: scaffold + Discover module"`
