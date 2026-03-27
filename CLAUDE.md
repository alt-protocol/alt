# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**Akashi** is a curated, non-custodial Solana yield aggregator with three core services: **Discover** (yield opportunities), **Manage** (transaction building), and **Monitor** (portfolio tracking). The backend never touches private keys or signs transactions.

## Development Setup

### 1. Start Postgres
```bash
docker compose up -d      # starts only Postgres (port 5432)
```

### 2. Backend (port 8001)
```bash
cd backend
npm install
npm run dev                # http://localhost:8001
```
Requires `backend/.env` with `DATABASE_URL`, `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `JUPITER_API_KEY`, `CORS_ORIGINS`.

### 3. Frontend (port 3000)
```bash
cd frontend
npm install
npm run dev
```
Requires `frontend/.env.local` with `NEXT_PUBLIC_HELIUS_RPC_URL`. `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8001` (see `lib/constants.ts`).

### Deployment
- **Backend** on Railway (Dockerfile). Env vars: `DATABASE_URL`, `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `JUPITER_API_KEY`, `CORS_ORIGINS`.
- **Frontend** on Vercel (Next.js auto-detected). Env vars: `NEXT_PUBLIC_HELIUS_RPC_URL`, `NEXT_PUBLIC_API_URL`.
- **MCP Server** runs locally via Claude Desktop (stdio). Env vars: `AKASHI_API_URL`, `AKASHI_API_KEY`.
- **CI/CD** via GitHub Actions (`.github/workflows/ci.yml`) — runs `tsc --noEmit` for backend, lint + build for frontend.
- `docker-compose.yml` is for local dev only (Postgres).

## Architecture

### Modular Monolith with 3 Modules

The backend (`backend/`) is a modular monolith — one Fastify process with 3 independent modules:

| Module | Purpose | Tables | Routes | Background Jobs |
|--------|---------|--------|--------|----------------|
| **Discover** | Yield opportunity data | protocols, yield_opportunities, yield_snapshots | `/api/discover/*` | Yield fetchers (15min) |
| **Manage** | Transaction building | api_keys | `/api/manage/*` | None |
| **Monitor** | Portfolio tracking | tracked_wallets, user_positions, user_position_events | `/api/monitor/*` | Position fetchers (15min) |

**Module isolation rules:**
- No cross-module table access — each module queries only its own tables
- Cross-module reads via TypeScript service interfaces (function calls, not HTTP)
- No cross-module writes
- Shared code in `src/shared/` (auth, types, RPC, error handling)
- Can split to separate services later by replacing function calls with HTTP calls

### Non-Custodial Transaction Flow (critical constraint)
The backend **never** handles private keys or signs transactions. Transaction flow:
1. Client calls `POST /api/manage/tx/build-deposit` → backend builds unsigned instructions
2. Client signs locally (browser wallet, keypair, Privy, Ledger — any custody solution)
3. Client submits:
   - **Direct:** submit to Solana via own RPC (frontend default, lower latency)
   - **Via backend:** `POST /api/manage/tx/submit` → backend submits via Helius RPC (for MCP agents, bots)
4. Simulation is opt-in (`simulate: true`) — browser wallets simulate themselves

### Backend (`backend/src/`)
- `index.ts` — Entry point: env validation, Fastify listen on `PORT` (default 8001), graceful shutdown
- `app.ts` — Fastify setup, CORS, rate limiting, health endpoint, module registration
- `discover/` — Yield fetchers (Kamino, Drift, Jupiter), protocol seeding, routes
- `manage/` — Protocol adapters (Kamino, Drift, Jupiter), tx building, instruction serialization
- `monitor/` — Position fetchers, wallet tracking, portfolio routes
- `shared/` — DB connection (Drizzle + pg), auth, RPC, error handler, HTTP client, logger

### Frontend (`frontend/src/`)
- Uses `(app)` route group layout — see `frontend/CLAUDE.md` for details
- `lib/categories/` — Category registry: `registry.ts` (types + map), `definitions/` (one `.ts` file per category), `extra-data.ts` (typed extractors), `index.ts` (re-exports). Drives detail page layout, filter dropdowns, sidebar labels.
- `components/` — `CategoryDetailView` (shared detail page shell), `DepositWithdrawPanel`, `MultiplyPanel`, `ApyChart`, `PortfolioChart`, `WalletButton`, etc.
- State: TanStack Query, no global store
- See `frontend/CLAUDE.md` for the full module reference. Always check existing modules before creating new functions.

### MCP Server (`mcp-server/`)
Thin wrapper (~200 lines) over the backend API. 7 tools: `list_opportunities`, `get_opportunity_details`, `get_positions`, `get_wallet_balance`, `build_deposit`, `build_withdraw`, `submit_transaction`. Runs locally via stdio (Claude Desktop), not deployed.

### Protocol Integrations
| Protocol | Discover (fetcher) | Manage (adapter) | Monitor (position fetcher) | Status |
|---|---|---|---|---|
| Kamino | kamino-fetcher.ts | kamino.ts | kamino-position-fetcher.ts | Full |
| Drift | drift-fetcher.ts | drift.ts | drift-position-fetcher.ts | Full |
| Jupiter | jupiter-fetcher.ts | jupiter.ts | jupiter-position-fetcher.ts | Full |

When adding a new protocol: need 1 Discover fetcher, 1 Monitor position fetcher, 1 Manage adapter — zero UI changes needed.

### Chain Support
Currently Solana-only. Multi-chain support is designed but not yet implemented. See `TODO_ARCHITECTURE.md`.

### Design System
All frontend work MUST follow `DESIGN.md`. Key constraints: dark-only, no 1px borders, no large border-radius (`rounded-sm` or `rounded-none`), no bouncy animations, high-density layouts, Orbitron for brand only, Space Grotesk for headlines, Manrope for body.

## Tech Stack
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, TanStack Query, `@solana/react` + `@solana/kit` (Wallet Standard)
- **Backend:** Fastify, Drizzle ORM, Zod, node-cron, `@solana/kit`, protocol SDKs (Kamino, Drift, Jupiter)
- **Database:** PostgreSQL
- **RPC:** Helius
- **Hosting:** Vercel (frontend), Railway (backend + Postgres)
- **MCP:** `@modelcontextprotocol/sdk` (thin wrapper, ~200 lines)

## Context Optimization

- Don't read `node_modules/`, `backend/dist/`, or `backend/drizzle/` — these waste context
- Don't read `DESIGN.md` unless doing UI work — root CLAUDE.md has the key constraints
- Prefer editing existing files over creating new ones
- When adding a new protocol: need 1 Discover fetcher, 1 Monitor position fetcher, 1 Manage adapter — zero UI changes
- When adding a new category: need 1 category definition file in `frontend/src/lib/categories/definitions/` — UI auto-adapts
- Root skills (`.claude/skills/`): `add-protocol`, `add-category`, `add-page`, `add-backend-route`, `start-dev`

## Roadmap
- See `TODO_ARCHITECTURE.md` for tracked architecture improvements, known issues, and future work.

## Hooks
- **PostToolUse** hook validates backend `/api/health` (port 8001) after edits to backend `.ts` files
- **PostToolUse** hook runs `tsc --noEmit` after edits to backend `.ts` files
- **PostToolUse** hook runs `npm run build` after edits to frontend files
- **PreToolUse** hook runs lint checks before `git commit`
