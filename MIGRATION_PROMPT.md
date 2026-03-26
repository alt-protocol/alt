# Prompt for Next Session

Copy and paste this into a new Claude Code session to start the migration:

---

## Prompt

I need you to migrate my Python backend to a unified Node.js/TypeScript backend and add an MCP server for AI agent integration. The full plan is in `MIGRATION_PLAN.md` at the project root — read it first.

**Important context:**
- The existing Python backend (`backend/`) has ~4,300 lines across 6 fetchers, 3 routers, 6 DB models, and shared utilities
- The frontend (`frontend/`) already has TypeScript protocol adapters that build Solana transactions — these will be reused in the new backend for the transaction building API
- The database (PostgreSQL) stays the same — same tables, same schema. Use Drizzle's `drizzle-kit pull` to introspect and generate the schema
- All existing API endpoints must remain 100% backward compatible — the frontend should work without changes
- The MCP server is a thin wrapper (~200 lines) that translates MCP tool calls into HTTP requests to the backend

**Start with Phase 1, Step 1:**
1. Read `MIGRATION_PLAN.md` for the full architecture and file structure
2. Read the Python backend files to understand the business logic you're porting
3. Create the `backend-ts/` directory with package.json, tsconfig.json, Dockerfile
4. Set up Drizzle ORM and pull the schema from the existing database
5. Work through the plan one step at a time, verifying each step before moving to the next

**Tech stack:** Hono (framework), Drizzle (ORM), Zod (validation), node-cron (scheduler), native fetch (HTTP client)

**Key constraints:**
- Non-custodial: backend never touches private keys
- Transaction API returns unsigned transactions + simulation preview; agents sign externally
- Stablecoin-only guard on transaction endpoints
- API key auth on `/api/tx/*` endpoints
- Work incrementally — get each phase working before starting the next
