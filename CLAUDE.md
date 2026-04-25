# CLAUDE.md

## Project
Akashi — non-custodial Solana yield aggregator. Three backend modules: Discover (yields), Manage (tx building), Monitor (portfolio). Frontend: Next.js + TanStack Query.

## Critical Constraints

### Non-Custodial (NEVER violate)
Backend NEVER handles private keys or signs transactions. It builds unsigned instructions only. Client signs and submits.

### Module Isolation (backend)
- No cross-module table access — each module queries only its own tables
- Cross-module reads via TypeScript service interfaces (function calls, not HTTP)
- No cross-module writes
- Shared code in `src/shared/`

### Design System (frontend)
All UI follows `DESIGN.md`. Key: dark-only, no 1px borders, `rounded-sm` or `rounded-none` only, no bouncy animations, Orbitron for brand, Space Grotesk for headlines, Manrope for body.

### Solana SDK
Always use `@solana/kit` + `@solana/react` (Wallet Standard). NEVER use legacy `@solana/wallet-adapter-*` or `@solana/web3.js` v1.

### Run Tests Before Finishing
Before completing your task, run the test suite for every module you modified. Fix all failures before finishing.
- Backend: `cd backend && npm run test:unit`
- Frontend: `cd frontend && npm run lint`
- Telegram bot: `cd telegram-bot && npx tsc --noEmit`

## Architecture

Backend: modular monolith — one Fastify process, 3 modules as Fastify plugins.

| Module | Purpose | Routes |
|--------|---------|--------|
| **Discover** | Yield opportunity data | `/api/discover/*` |
| **Manage** | Transaction building | `/api/manage/*` |
| **Monitor** | Portfolio tracking | `/api/monitor/*` |

Frontend: Next.js App Router, `(app)` route group, category registry in `lib/categories/` drives UI.

## Context Directives

### Never read
`node_modules/`, `backend/dist/`, `backend/drizzle/`, `frontend/.next/`, `package-lock.json` files.
Read `DESIGN.md` only for UI/styling work. Read `TODO_ARCHITECTURE.md` only when asked about roadmap.

### Module scoping
- Stay in the relevant module (Discover/Manage/Monitor). Don't read files from other modules unless the task explicitly crosses boundaries.
- Stay in the relevant protocol (Kamino/Drift/Jupiter). Don't read other protocol files unless comparing patterns.
- Read `frontend/CLAUDE.md` or `backend/CLAUDE.md` when starting work in that directory.

### Large files (protocol files are 600-960 lines)
- Never read an entire 500+ line file upfront. Use partial reads (`offset`/`limit`) — read the first 50 lines for structure, then `Grep` for the specific function needed.
- Use `Grep` to find functions/types before reading files. Use `Glob` to find files before exploring directories.
- Don't read files speculatively — have a reason for each read.

### Navigation order
- Backend: `index.ts` → `routes/` → `services/` → `db/` (top-down)
- Frontend: page → component → hook → utility (top-down)
- Don't read utility files (`format.ts`, `constants.ts`) unless you need a specific function — grep for it.

### One reference, not all
- When adding a new protocol/fetcher/adapter, read ONE existing implementation as reference, not all three.
- When modifying a component, don't read sibling components unless they share logic.
- Prefer editing existing files over creating new ones.
- Use skills for scaffolding: `add-protocol`, `add-category`, `add-page`, `add-backend-route`, `start-dev`.

## Dev Setup
```
docker compose up -d          # Postgres
cd backend && npm run dev     # :8001
cd frontend && npm run dev    # :3000
```
Use `/start-dev` skill for full setup. Backend needs `backend/.env`, frontend needs `frontend/.env.local`.
