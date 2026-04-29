# Backend CLAUDE.md

## Commands
```
npm run dev      # tsx watch, :8001
npm run build    # tsc (PostToolUse hook validates after edits)
npm run db:push  # drizzle-kit push
npm run db:pull  # drizzle-kit pull
npm test         # vitest — run all tests (requires Docker Postgres)
npm run test:watch  # vitest watch mode
                 # MCP endpoint at /api/mcp (Streamable HTTP, no separate process)
```

## Architecture
Entry: `index.ts` → `app.ts` → 3 modules registered as Fastify plugins.
Each module: `index.ts` (setup + scheduler), `routes/`, `services/`, `db/schema.ts`.

### Protocol Integration Pattern
Each protocol needs 3 files:
- `src/discover/services/<protocol>-fetcher.ts` — yield fetcher (15min cron)
- `src/manage/protocols/<protocol>.ts` — tx adapter
- `src/monitor/services/<protocol>-position-fetcher.ts` — position fetcher (15min cron)

Use `/integrate-protocol` skill for scaffolding.

Current protocols (full integration): Kamino, Drift, Jupiter.
Seeded on startup: Kamino, Drift, Jupiter, Exponent, Solstice.

## Rules

### Do
- Zod schemas on all route inputs (`fastify-type-provider-zod`)
- Pagination: `limit` (default 100, max 500) + `offset` (default 0)
- `requireApiKey` preHandler on mutation endpoints (Manage module)
- Skip fetcher run if previous still active (prevent overlap)

### Don't
- Access another module's tables — module isolation (see root CLAUDE.md)
- Handle private keys or sign transactions — non-custodial (see root CLAUDE.md)
- Import from another module's `db/schema.ts`

## Key Shared Modules (`src/shared/`)
- `rpc.ts` — `getRpc()`, `getRpcSubscriptions()`, `getLegacyConnection()`
- `http.ts` — `getWithRetry()` (3 retries, exponential backoff), `getOrNull()`, `postJson()`
- `utils.ts` — `safeFloat()`, `parseTimestamp()`, `cached()`, `cachedAsync()`
- `error-handler.ts` — ZodError, NotFoundError → JSON responses
- `auth.ts` — API key middleware, validates against `manage.api_keys` table
