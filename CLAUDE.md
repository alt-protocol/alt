# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

**Akashi** is a curated, non-custodial Solana yield aggregator. Users discover and deposit into yield opportunities across Kamino, Drift, and Jupiter — the app never touches their funds. The backend only serves market data; all transactions are built client-side via protocol SDKs and signed by the user's wallet.

## Development Setup

### 1. Start Postgres
```bash
docker compose up -d      # starts only Postgres (port 5432)
```

### 2. Backend (`backend/`, port 8000)
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```
Requires `backend/.env` with `DATABASE_URL`, `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `JUPITER_API_KEY`.

### 3. Frontend (`frontend/`, port 3000)
```bash
cd frontend
npm install
npm run dev
```
Requires `frontend/.env.local` with `NEXT_PUBLIC_HELIUS_RPC_URL`. `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000` (see `lib/constants.ts`).

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

### Non-Custodial Transaction Flow (critical constraint)
The backend **never** handles private keys or signs transactions. All deposit/withdraw flows:
1. Frontend protocol adapter builds unsigned instructions
2. Wallet prompts the user to sign
3. Frontend submits to Solana via Helius RPC

### Backend (`backend/app/`)
- `main.py` — FastAPI app, CORS (configurable via `CORS_ORIGINS`), APScheduler cron (15min, `coalesce=True`), slowapi rate limiting
- `routers/` — `yields.py`, `protocols.py`, `portfolio.py` under `/api`
- `models/` — SQLAlchemy: 6 tables (`protocols`, `yield_opportunities`, `yield_snapshots`, `tracked_wallets`, `user_positions`, `user_position_events`)
- `schemas/` — Pydantic response schemas (fully implemented)
- `services/` — Fetchers (`kamino_fetcher`, `drift_fetcher`, `jupiter_fetcher`) and position fetchers (`*_position_fetcher.py`) run by unified cron
- See `backend/CLAUDE.md` for fetcher-specific details

### Frontend (`frontend/src/`)
- Uses `(app)` route group layout — see `frontend/CLAUDE.md` for details
- `lib/protocols/` — Adapter pattern: `kamino.ts`, `drift.ts`, `jupiter.ts` implement `ProtocolAdapter` interface from `types.ts`; `index.ts` is the registry
- `components/` — `DepositWithdrawPanel`, `ApyChart`, `PortfolioChart`, `WalletButton`, etc.
- State: TanStack Query, no global store
- Frontend has extracted shared utilities (`format.ts`, `instruction-converter.ts`, hooks, `PositionTable`, `FilterPanel`) — see `frontend/CLAUDE.md` for the full module reference. Always check existing modules before creating new functions.

### Protocol Integrations
| Protocol | Backend fetcher | Frontend adapter | Status |
|---|---|---|---|
| Kamino | kamino_fetcher | kamino.ts | Full (deposit/withdraw) |
| Drift | drift_fetcher | drift.ts | Full (deposit/withdraw) |
| Jupiter | jupiter_fetcher | jupiter.ts | Full (deposit/withdraw) |

### Design System
All frontend work MUST follow `DESIGN.md`. Key constraints: dark-only, no 1px borders, no large border-radius (`rounded-sm` or `rounded-none`), no bouncy animations, high-density layouts, Orbitron for brand only, Space Grotesk for headlines, Manrope for body.

## Tech Stack
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, TanStack Query, `@solana/react` + `@solana/kit` (Wallet Standard)
- **Backend:** FastAPI, SQLAlchemy 2.0, Alembic, APScheduler, slowapi, `solana-py` + `solders`
- **Database:** PostgreSQL (6 tables)
- **RPC:** Helius
- **Hosting:** Vercel (frontend), Railway (backend + Postgres)

## Context Optimization

- Don't read `node_modules/`, `venv/`, `alembic/versions/`, or `__pycache__/` — these waste context
- Don't read `DESIGN.md` unless doing UI work — root CLAUDE.md has the key constraints
- Prefer editing existing files over creating new ones
- When adding a new protocol: need 1 backend fetcher, 1 position fetcher, 1 frontend adapter, 1 registry entry — that's it
- Root skills (`.claude/skills/`): `add-protocol`, `add-page`, `add-backend-route`, `start-dev`
- Backend skills (`backend/.claude/skills/`): `add-backend-route`

## Roadmap
See `TODO_ARCHITECTURE.md` for tracked architecture improvements, known issues, and future work.

## Hooks
- **PostToolUse** hook validates backend `/api/health` after edits to backend files
- **PostToolUse** hook runs `npm run build` after edits to frontend files
