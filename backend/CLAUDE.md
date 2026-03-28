# Backend CLAUDE.md

## Commands
```bash
npm install
npm run dev      # tsx watch, http://localhost:8001
npm run build    # tsc (PostToolUse hook runs tsc --noEmit after edits)
npm start        # node dist/index.js
npm run db:pull  # drizzle-kit pull
npm run db:push  # drizzle-kit push
```

Requires Docker Postgres running (`docker compose up -d` from project root).

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| DATABASE_URL | Yes | — | PostgreSQL connection string |
| HELIUS_API_KEY | Yes | — | Helius API key |
| HELIUS_RPC_URL | Yes | — | Helius RPC endpoint URL |
| JUPITER_API_KEY | No | — | Jupiter API key (higher rate limits) |
| PORT | No | 8001 | Server port |
| LOG_LEVEL | No | "info" | Pino log level |
| CORS_ORIGINS | No | "http://localhost:3000" | Comma-separated allowed origins |

## Architecture

Entry: `index.ts` → `app.ts` → 3 modules registered as Fastify plugins.

Each module has: `index.ts` (setup + scheduler), `routes/`, `services/`, `db/schema.ts`.

### Module Isolation Rules
- No cross-module table access — each module queries only its own tables
- Cross-module reads via TypeScript service interfaces (function calls, not HTTP)
- No cross-module writes
- Shared code in `src/shared/`

### Non-Custodial Constraint
The backend **never** handles private keys or signs transactions. It only builds unsigned instructions.

## Routes

### Health
- `GET /api/health` — database connectivity check

### Discover (`src/discover/routes/`)
- `GET /api/discover/yields` — list yield opportunities (query: category, vault_tag, tokens, stablecoins_only, sort, limit, offset)
- `GET /api/discover/yields/:id` — single opportunity with 7d snapshots
- `GET /api/discover/yields/:id/history` — APY history (query: period, limit, offset)
- `GET /api/discover/protocols` — list all protocols

### Manage (`src/manage/routes/`)
- `POST /api/manage/tx/build-deposit` — build unsigned deposit instructions
- `POST /api/manage/tx/build-withdraw` — build unsigned withdraw instructions
- `POST /api/manage/tx/submit` — submit signed transaction (**API key required**)
- `POST /api/manage/balance` — protocol-specific vault balance
- `POST /api/manage/withdraw-state` — multi-step withdrawal state (e.g., Drift redeem period)

### Monitor (`src/monitor/routes/`)
- `GET /api/monitor/portfolio/:wallet` — SPL token balances via Helius
- `POST /api/monitor/portfolio/:wallet/track` — register wallet for background position tracking
- `GET /api/monitor/portfolio/:wallet/status` — fetch status (fetch_status, last_fetched_at)
- `GET /api/monitor/portfolio/:wallet/positions` — current positions (query: protocol, product_type)
- `GET /api/monitor/portfolio/:wallet/positions/history` — position value history with time bucketing (query: period, external_id, limit, offset)
- `GET /api/monitor/portfolio/:wallet/events` — transaction events (query: protocol, product_type, limit)

## Shared Modules (`src/shared/`)

| File | Purpose |
|------|---------|
| `db.ts` | Drizzle ORM + pg pool (max 20 connections) |
| `auth.ts` | API key middleware; validates against manage.api_keys table |
| `rpc.ts` | Lazy-initialized Solana RPC clients (`getRpc()`, `getRpcSubscriptions()`, `getLegacyConnection()`) |
| `error-handler.ts` | Fastify error handler; ZodError, NotFoundError, generic errors → JSON |
| `http.ts` | `getWithRetry()` (3 retries, exponential backoff), `getOrNull()`, `postJson()` |
| `logger.ts` | Pino logger; pretty-printed in dev, JSON in prod |
| `constants.ts` | `KNOWN_TOKEN_MINTS`, `STABLECOIN_SYMBOLS`, depeg calculator |
| `utils.ts` | `safeFloat()`, `parseTimestamp()`, `cached()`, `cachedAsync()` |
| `types.ts` | `OpportunityDetail`, `OpportunityMapEntry`, `DiscoverService`, `SerializableInstruction` |

## Protocol Integrations

Protocols seeded on startup: Kamino, Drift, Jupiter, Exponent, Solstice.

Each protocol needs 3 files:
- `src/discover/services/<protocol>-fetcher.ts` — yield data fetcher (15min cron)
- `src/manage/services/<protocol>.ts` — transaction adapter
- `src/monitor/services/<protocol>-position-fetcher.ts` — position fetcher (15min cron)

## Key Constraints

- **Rate limiting:** 100 req/min global + per-API-key limits
- **Fetchers:** Skip if previous run still active (prevents overlap)
- **Background jobs:** Yield + position fetchers run every 15 minutes via node-cron
- **Validation:** Zod schemas on all route inputs via `fastify-type-provider-zod`
- **Database:** 3 schemas (discover, manage, monitor), Drizzle ORM, migrations via drizzle-kit
