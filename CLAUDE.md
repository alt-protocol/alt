# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Akashi** is a curated, non-custodial Solana yield aggregator. Users discover and deposit into yield opportunities across Kamino, Drift, and Exponent — the app never touches their funds. The backend only serves market data; all transactions are built client-side via protocol SDKs and signed by the user's wallet.

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
Requires `backend/.env` with `DATABASE_URL=postgresql://localhost/alt` and Helius API key.

### 3. Frontend (`frontend/`, port 3000)
```bash
cd frontend
npm install
npm run dev
```
Requires `frontend/.env.local` with Helius RPC URL. `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000` if not set (see `lib/constants.ts`).

### Alembic migrations (run from `backend/`)
```bash
alembic revision --autogenerate -m "description"
alembic upgrade head
alembic downgrade -1
```

### Seed database (run from repo root)
```bash
python scripts/seed_protocols.py
```

### Deployment
- **Backend** is live on Railway (Dockerfile-based, auto-runs `alembic upgrade head` on deploy)
- **Frontend** is live on Vercel (auto-detected Next.js)
- `docker-compose.yml` is for local development only (Postgres)

**Required Railway env vars:** `DATABASE_URL` (Railway Postgres), `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `JUPITER_API_KEY`, `CORS_ORIGINS` (Vercel domain), `PORT` (set by Railway)

**Required Vercel env vars:** `NEXT_PUBLIC_API_URL` (Railway backend URL), `NEXT_PUBLIC_HELIUS_RPC_URL`

## Architecture

### Non-Custodial Transaction Flow (most important constraint)
The backend **never** handles private keys or signs transactions. All deposit/withdraw flows:
1. Frontend calls a protocol SDK to build an unsigned transaction
2. Wallet adapter prompts the user to sign
3. Frontend submits directly to Solana via Helius RPC

The backend is only used for: serving yield data, reading public on-chain positions, and storing historical yield snapshots.

### Backend (`backend/app/`)
- `main.py` — FastAPI app with CORS (localhost:3000 default, production via CORS_ORIGINS env var)
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

## Design System ("The Kinetic Architect")

All frontend work MUST follow the design system in `DESIGN.md`. Key rules:

### Colors (dark-only, no light mode)
- **Surface (base):** `#131313` | **Surface low:** `#1c1b1b` | **Surface high:** `#2a2a2a`
- **Neon primary:** `#d9f99d` (accents, success states) | **CTA gradient:** `#ceee93` → `#b3d17a`
- **Secondary purple:** `#4f319c` (chips, tags) | **Tertiary:** `#c0c1ff`
- Use CSS variables defined in `globals.css` (e.g., `var(--surface)`, `var(--neon-primary)`)

### Typography
- **Brand/logo:** Orbitron (Bauhaus-inspired geometric), used only for "AKASHI" wordmark
- **Headlines:** Space Grotesk, tight letter-spacing (`-0.02em`)
- **Body/labels:** Manrope
- Labels: uppercase, `+0.05em` letter-spacing for "blueprint" feel

### Critical Do's and Don'ts
- **NO 1px borders** — use surface color shifts to define sections
- **NO large border-radius** — use `rounded-sm` (2px) or `rounded-none` only
- **NO Material-style shadows** — use tonal depth or `0 10px 40px rgba(0,0,0,0.4)` for floating elements
- **NO friendly/bouncy animations** — keep it institutional
- **High density layouts** — tight spacing (0.2–0.5rem internal), data-rich
- **Asymmetric editorial layout** — labels left, data right
- **Glassmorphism for modals** — `backdrop-blur-[16px]` on 60% opaque surface

### Components
- **Primary button:** white bg `#ffffff`, dark text `#243600`, `rounded-sm`
- **Neon button:** `#d9f99d` bg, `#131f00` text (for commit/success actions)
- **Cards:** no dividers, `surface_container_lowest` bg, `rounded-sm` or `rounded-none`
- **Inputs:** no border unfocused (bg shift only), neon 2px underline on focus
- **Chips:** rectangular `rounded-sm`, purple `#4f319c` bg

## Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, TanStack Query, `@solana/react` + `@solana/kit` (Wallet Standard)
- **Backend:** FastAPI 0.135, SQLAlchemy 2.0, Alembic, APScheduler, `solana-py` + `solders`
- **Database:** PostgreSQL
- **RPC:** Helius (free tier, 100K credits/day)
- **Hosting:** Vercel (frontend), Railway (backend + Postgres)
