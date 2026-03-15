# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Alt** is a curated, non-custodial Solana yield aggregator. Users discover and deposit into yield opportunities across Kamino, Drift, and Exponent — the app never touches their funds. The backend only serves market data; all transactions are built client-side via protocol SDKs and signed by the user's wallet.

## Commands

### Frontend (`frontend/`)
```bash
npm install
npm run dev       # http://localhost:3000
npm run build
npm run lint
```
Requires `frontend/.env.local` with a Helius RPC URL (copy from `.env.example`).

### Backend (`backend/`)
```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head                    # run from backend/
uvicorn app.main:app --reload           # http://localhost:8000
```
Requires `backend/.env` with `DATABASE_URL` and Helius API key (copy from `.env.example`).

### Alembic migrations (run from `backend/`)
```bash
alembic revision --autogenerate -m "description"
alembic upgrade head
alembic downgrade -1
```

### Seed database
```bash
python scripts/seed_protocols.py        # run from repo root
```

## Architecture

### Non-Custodial Transaction Flow (most important constraint)
The backend **never** handles private keys or signs transactions. All deposit/withdraw flows:
1. Frontend calls a protocol SDK to build an unsigned transaction
2. Wallet adapter prompts the user to sign
3. Frontend submits directly to Solana via Helius RPC

The backend is only used for: serving yield data, reading public on-chain positions, and storing historical yield snapshots.

### Backend (`backend/app/`)
- `main.py` — FastAPI app with CORS (localhost:3000 allowed)
- `routers/` — `yields.py`, `protocols.py`, `portfolio.py` mounted under `/api`
- `models/` — SQLAlchemy models: `Protocol`, `YieldOpportunity`, `YieldSnapshot`
- `schemas/` — Pydantic schemas (empty, to be filled)
- `services/` — Business logic: yield fetcher cron (APScheduler, every 15min), portfolio reader via Helius DAS API

No user table exists by design. Portfolio data is read live from on-chain state using the wallet's public key.

### Frontend (`frontend/src/`)
- `app/` — Next.js App Router pages: `page.tsx` (landing), `dashboard/`, `portfolio/`
- `components/` — Shared React components (to be created per architecture doc)
- `lib/protocols/` — Protocol adapter pattern: each protocol (`kamino.ts`, `drift.ts`, `exponent.ts`) implements a common `ProtocolAdapter` interface with `buildDepositTx`, `buildWithdrawTx`, and `getPosition` methods. `index.ts` is the registry mapping protocol slugs to adapters.
- `lib/api.ts` — Backend API client
- `lib/constants.ts` — RPC endpoints, token mints

State management uses TanStack Query (React Query) for yield data fetching and caching.

### Database
Three tables: `protocols`, `yield_opportunities`, `yield_snapshots`. The yield_snapshots table is the proprietary data moat — populated every 15 minutes from DeFiLlama, protocol APIs, and Helius RPC.

### API Endpoints
- `GET /api/yields` — all active opportunities; query params: `category`, `sort`, `tokens`
- `GET /api/yields/{id}/history` — historical APY snapshots; query param: `period` (7d/30d/90d)
- `GET /api/portfolio/{wallet_address}` — on-chain positions for a wallet
- `GET /api/protocols` — supported protocols with metadata
- `GET /api/health`

### Protocol Integrations
| Protocol | Category | Integration level |
|---|---|---|
| Kamino | Lending / Liquidity Vaults | Full (deposit/withdraw) |
| Drift | Perps + Earn | Full (deposit/withdraw) |
| Exponent | Yield Tokenization | Full (deposit/withdraw) |
| Solstice | Delta Neutral | Data only |
| Jupiter LP | Stable AMM | Data only |

Frontend TypeScript SDKs: `@kamino-finance/kliquidity-sdk`, `@drift-labs/sdk`, Exponent TBD.

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, TanStack Query, `@solana/wallet-adapter-react`
- **Backend:** FastAPI 0.135, SQLAlchemy 2.0, Alembic, APScheduler, `solana-py` + `solders`
- **Database:** PostgreSQL
- **RPC:** Helius (free tier, 100K credits/day)
- **Hosting:** Vercel (frontend), Railway (backend + Postgres)
