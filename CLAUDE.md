# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**Akashi** is a curated, non-custodial Solana yield aggregator evolving into a platform with three core services: **Discover** (yield opportunities), **Manage** (transaction building), and **Monitor** (portfolio tracking). The backend never touches private keys or signs transactions.

> **Migration in progress:** The Python backend (`backend/`) is being migrated to a Node.js modular monolith (`backend-ts/`). See `MIGRATION_PLAN.md` for the full architecture. During migration, both backends may coexist — Python on port 8000 (production), Node.js on port 8001 (development).

## Development Setup

### 1. Start Postgres
```bash
docker compose up -d      # starts only Postgres (port 5432)
```

### 2. Backend — Python (legacy, port 8000)
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```
Requires `backend/.env` with `DATABASE_URL`, `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `JUPITER_API_KEY`.

### 3. Backend — Node.js (new, port 8001) *(when available)*
```bash
cd backend-ts
npm install
npm run dev                # http://localhost:8001
```
Requires `backend-ts/.env` with `DATABASE_URL`, `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `JUPITER_API_KEY`, `CORS_ORIGINS`.

### 4. Frontend (`frontend/`, port 3000)
```bash
cd frontend
npm install
npm run dev
```
Requires `frontend/.env.local` with `NEXT_PUBLIC_HELIUS_RPC_URL`. `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000` (see `lib/constants.ts`). Set to `http://localhost:8001` to test against Node.js backend.

### Alembic migrations (run from `backend/`)
```bash
alembic revision --autogenerate -m "description"
alembic upgrade head
```

### Scripts (`scripts/`)
- `seed_protocols.py` — seed protocol rows (run from repo root)
- `refresh_all.py` — trigger all fetchers manually
- `backfill_*` — one-off DeFiLlama backfills for historical snapshots
- `validate_positions.py` — verify position fetcher output

### Deployment
- **Backend** on Railway (Dockerfile, auto-runs `alembic upgrade head`). Env vars: `DATABASE_URL`, `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `JUPITER_API_KEY`, `CORS_ORIGINS`.
- **Frontend** on Vercel (Next.js auto-detected, deploys from source — `frontend/Dockerfile` is not used in production). Env vars: `NEXT_PUBLIC_HELIUS_RPC_URL`, `NEXT_PUBLIC_API_URL`.
- **CI/CD** via GitHub Actions (`.github/workflows/ci.yml`) — runs lint + build for frontend, import validation for backend.
- `docker-compose.yml` is for local dev only (Postgres).

## Architecture

### Target: Modular Monolith with 3 Services

The new backend (`backend-ts/`) is a modular monolith — one Fastify process with 3 independent modules, each with its own DB schema:

| Module | Purpose | Schema | Routes | Background Jobs |
|--------|---------|--------|--------|----------------|
| **Discover** | Yield opportunity data | `discover` (protocols, yield_opportunities, yield_snapshots) | `/api/discover/*` | Yield fetchers (15min) |
| **Manage** | Transaction building | `manage` (api_keys) | `/api/manage/*` | None |
| **Monitor** | Portfolio tracking | `monitor` (tracked_wallets, user_positions, user_position_events) | `/api/monitor/*` | Position fetchers (15min) |

**Module isolation rules:**
- No cross-module table access — each module queries only its own schema
- Cross-module reads via TypeScript service interfaces (function calls, not HTTP)
- No cross-module writes
- Shared code in `shared/` (auth, types, RPC, error handling)
- Can split to separate services later by replacing function calls with HTTP calls

### Non-Custodial Transaction Flow (critical constraint)
The backend **never** handles private keys or signs transactions. Transaction flow:
1. Client calls `POST /api/manage/tx/build-deposit` → backend builds unsigned instructions
2. Client signs locally (browser wallet, keypair, Privy, Ledger — any custody solution)
3. Client submits:
   - **Direct:** submit to Solana via own RPC (frontend default, lower latency)
   - **Via backend:** `POST /api/manage/tx/submit` → backend submits via Helius RPC (for MCP agents, bots)
4. Simulation is opt-in (`simulate: true`) — browser wallets simulate themselves

### Legacy Backend (`backend/app/`) — *being migrated*
- `main.py` — FastAPI app, CORS (configurable via `CORS_ORIGINS`), APScheduler cron (15min, `coalesce=True`), slowapi rate limiting
- `routers/` — `yields.py`, `protocols.py`, `portfolio.py` under `/api`
- `models/` — SQLAlchemy: 6 tables (`protocols`, `yield_opportunities`, `yield_snapshots`, `tracked_wallets`, `user_positions`, `user_position_events`)
- `schemas/` — Pydantic response schemas (fully implemented)
- `services/` — Fetchers (`kamino_fetcher`, `drift_fetcher`, `jupiter_fetcher`) and position fetchers (`*_position_fetcher.py`) run by unified cron
- See `backend/CLAUDE.md` for fetcher-specific details

### Frontend (`frontend/src/`)
- Uses `(app)` route group layout — see `frontend/CLAUDE.md` for details
- `lib/categories/` — Category registry: `registry.ts` (types + map), `definitions/` (one `.ts` file per category), `extra-data.ts` (typed extractors), `index.ts` (re-exports). Drives detail page layout, filter dropdowns, sidebar labels. Position table columns are in `PositionTable.tsx`.
- `lib/protocols/` — Adapter pattern: `kamino.ts`, `drift.ts`, `jupiter.ts` implement `ProtocolAdapter` interface from `types.ts`; `index.ts` is the registry. **Moving to backend Manage module** — frontend will call `/api/manage/tx/*` instead.
- `components/` — `CategoryDetailView` (shared detail page shell), `DepositWithdrawPanel`, `MultiplyPanel`, `ApyChart`, `PortfolioChart`, `WalletButton`, etc.
- State: TanStack Query, no global store
- Frontend has extracted shared utilities (`format.ts`, `instruction-converter.ts`, hooks, `PositionTable`, `FilterPanel`) — see `frontend/CLAUDE.md` for the full module reference. Always check existing modules before creating new functions.

### Protocol Integrations
| Protocol | Discover (data) | Manage (tx building) | Status |
|---|---|---|---|
| Kamino | kamino-fetcher | kamino.ts adapter | Full (deposit/withdraw) |
| Drift | drift-fetcher | drift.ts adapter | Full (deposit/withdraw) |
| Jupiter | jupiter-fetcher | jupiter.ts adapter | Full (deposit/withdraw) |

When adding a new protocol: need 1 Discover fetcher, 1 Monitor position fetcher, 1 Manage adapter — zero UI changes needed.

### Chain Support
Currently Solana-only. Multi-chain support is designed but not yet implemented. The architecture will use a **Chain Registry** pattern (`src/lib/chains/`) mirroring the category registry — each chain defines its RPC, tx executor, and explorer URL. Protocol adapters will gain a `chain` field. When adding non-Solana protocols, this abstraction layer must be built first (see plan in `TODO_ARCHITECTURE.md`).

### Design System
All frontend work MUST follow `DESIGN.md`. Key constraints: dark-only, no 1px borders, no large border-radius (`rounded-sm` or `rounded-none`), no bouncy animations, high-density layouts, Orbitron for brand only, Space Grotesk for headlines, Manrope for body.

## Tech Stack
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, TanStack Query, `@solana/react` + `@solana/kit` (Wallet Standard)
- **Backend (legacy):** FastAPI, SQLAlchemy 2.0, Alembic, APScheduler, slowapi, `solana-py` + `solders`
- **Backend (new):** Fastify, Drizzle ORM, Zod, node-cron, `@solana/kit`, protocol SDKs (Kamino, Drift, Jupiter)
- **Database:** PostgreSQL (3 schemas: discover, manage, monitor)
- **RPC:** Helius
- **Hosting:** Vercel (frontend), Railway (backend + Postgres)
- **MCP:** `@modelcontextprotocol/sdk` (thin wrapper, ~200 lines)

## Context Optimization

- Don't read `node_modules/`, `venv/`, `alembic/versions/`, or `__pycache__/` — these waste context
- Don't read `DESIGN.md` unless doing UI work — root CLAUDE.md has the key constraints
- Prefer editing existing files over creating new ones
- When adding a new protocol: need 1 Discover fetcher, 1 Monitor position fetcher, 1 Manage adapter — zero UI changes
- When adding a new category: need 1 category definition file in `frontend/src/lib/categories/definitions/` — UI auto-adapts
- Root skills (`.claude/skills/`): `add-protocol`, `add-category`, `add-page`, `add-backend-route`, `start-dev`
- See `MIGRATION_PLAN.md` for the full backend migration architecture

## Roadmap
- See `TODO_ARCHITECTURE.md` for tracked architecture improvements, known issues, and future work.
- See `MIGRATION_PLAN.md` for the backend migration plan (Python → Node.js modular monolith + MCP server).

## Hooks
- **PostToolUse** hook validates backend `/api/health` after edits to backend files
- **PostToolUse** hook runs `npm run build` after edits to frontend files
