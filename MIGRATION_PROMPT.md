# Prompt for Next Session

Copy and paste this into a new Claude Code session to start the migration:

---

## Prompt

I need you to build a new Node.js/TypeScript backend as a modular monolith with 3 independent services, plus a thin MCP server. The full plan is in `MIGRATION_PLAN.md` at the project root — read it first.

**Three modules (each with its own DB schema, routes, and business logic):**
1. **Discover** (`/api/discover/*`) — yield opportunity discovery, protocol data, yield fetchers
2. **Manage** (`/api/manage/*`) — transaction building (deposit/withdraw), protocol SDKs, safety guards
3. **Monitor** (`/api/monitor/*`) — portfolio tracking, position fetchers, PnL calculation

**Important context:**
- This is a modular monolith — one Fastify process, 3 independent modules, 3 PostgreSQL schemas in 1 instance
- Modules communicate via TypeScript service interfaces (function calls), NOT HTTP — can split to separate services later
- The existing Python backend (`backend/`) stays running on port 8000 while we build `backend-ts/` on port 8001
- Same PostgreSQL database — use Drizzle's `drizzle-kit pull` to introspect existing tables, then assign to schemas
- All existing API endpoints must remain backward compatible (just with `/api/discover/`, `/api/manage/`, `/api/monitor/` prefixes)
- The Manage module centralizes ALL transaction building — frontend becomes a thin client (no protocol SDKs)
- MCP server is ~200 lines, just HTTP calls to the three modules

**Migration strategy:**
- Same repo: `backend-ts/` alongside existing `backend/`
- Both share the same PostgreSQL
- Verify by comparing responses between Python (8000) and Node.js (8001)
- After cutover: rename `backend-ts/` → `backend/`, delete old Python backend

**Start with Phase 1:**
1. Read `MIGRATION_PLAN.md` for the full architecture
2. Read the Python backend files to understand business logic being ported
3. Create `backend-ts/` with package.json, tsconfig.json, Dockerfile
4. Set up Fastify with plugin architecture (each module = Fastify plugin)
5. Create `shared/` (auth, types, RPC, error handling)
6. Set up Drizzle with `discover` schema
7. Port the Discover module first (yields, protocols, fetchers)

**Tech stack:** Fastify, Drizzle, Zod, node-cron, @fastify/swagger, @fastify/rate-limit

**Key constraints:**
- Module isolation: no cross-module table access, reads only via service interfaces
- Non-custodial: backend never touches private keys
- Transaction API returns unsigned instructions; agents/users sign externally
- Work incrementally — get each module working before starting the next
