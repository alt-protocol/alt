# Phase 6: Deploy + Cut Over

Read `MIGRATION_PLAN.md` for architecture. Phases 1-5 must be complete.

## What to do

Deploy the Node.js backend to Railway, verify production parity, switch over, clean up.

## Steps

### 1. Deploy backend-ts to Railway
- Create new Railway service from `backend-ts/` directory
- Set env vars: `DATABASE_URL`, `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `JUPITER_API_KEY`, `CORS_ORIGINS`, `PORT=8000`
- Deploy alongside Python backend (on different internal hostname)
- Verify health: `curl https://{new-service}.railway.app/api/health`

### 2. Production parity check
Compare responses between Python and Node.js backends for every endpoint:
- `/api/discover/yields` vs `/api/yields`
- `/api/discover/protocols` vs `/api/protocols`
- `/api/monitor/portfolio/{wallet}/positions` vs `/api/portfolio/{wallet}/positions`
- Run fetchers on both, compare yield data after one cycle

### 3. Switch frontend
- Update Vercel env var: `NEXT_PUBLIC_API_URL` → new Node.js backend URL
- Deploy frontend
- Verify all pages work in production

### 4. Retire Python backend
- Stop Python Railway service
- Keep it available (don't delete) for 1 week as safety net

### 5. Clean up repo
- Rename `backend-ts/` → `backend/` (delete old Python `backend/` first)
- Update `Dockerfile` path in Railway
- Update `.github/workflows/ci.yml` for Node.js backend
- Update `docker-compose.yml` if needed

### 6. Update CLAUDE.md
Full rewrite — remove all Python references, document new architecture:
- Dev setup: Node.js commands only
- Architecture: 3-module monolith (Discover/Manage/Monitor)
- Tech stack: Fastify/Drizzle/Zod
- Protocol integrations: Discover fetcher + Manage adapter
- Context optimization: new file structure
- Hooks: update health check path
- Add MCP server section

### 7. DB schema migration (optional, can defer)
Move tables from `public` schema to proper schemas:
```sql
ALTER TABLE protocols SET SCHEMA discover;
ALTER TABLE yield_opportunities SET SCHEMA discover;
ALTER TABLE yield_snapshots SET SCHEMA discover;
ALTER TABLE tracked_wallets SET SCHEMA monitor;
ALTER TABLE user_positions SET SCHEMA monitor;
ALTER TABLE user_position_events SET SCHEMA monitor;
```
Update Drizzle schema files to use schema prefixes.

### 8. Clean up migration files
- Delete `MIGRATION_PLAN.md`
- Delete `MIGRATION_PROMPT.md`
- Delete `migration/` directory
- These were working documents, not needed after cutover

## Verify
1. Production frontend works end-to-end
2. Yields load, portfolio loads, deposit/withdraw works
3. MCP server connects to production backend
4. Python backend is stopped, nothing breaks
5. CI/CD pipeline passes

Commit: `git add -A && git commit -m "Phase 6: production cutover"`
