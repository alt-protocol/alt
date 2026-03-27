# Phase 6 Validator: Deploy + Cut Over

Review the cutover against `MIGRATION_PLAN.md`.

Do NOT make destructive changes. Only verify and report.

## Review checklist

### 1. Production parity
- [ ] Node.js `/api/discover/yields` returns same data as Python `/api/yields` (count, fields, values)
- [ ] Node.js `/api/discover/protocols` matches Python
- [ ] Node.js `/api/monitor/portfolio/{wallet}/positions` matches Python
- [ ] Fetchers running: new yields appearing every 15 minutes
- [ ] Position fetchers running: snapshots updating

### 2. Frontend pointing to new backend
- [ ] Vercel `NEXT_PUBLIC_API_URL` set to Node.js backend
- [ ] All pages load without errors
- [ ] Network tab shows requests going to new backend URL

### 3. Repo cleanup
- [ ] `backend-ts/` renamed to `backend/` (or old Python `backend/` removed)
- [ ] No Python files remaining in `backend/` (only Node.js)
- [ ] CI/CD pipeline updated for Node.js
- [ ] `CLAUDE.md` fully updated — no Python references

### 4. MCP server
- [ ] Connects to production backend URL
- [ ] All 7 tools return production data
- [ ] `build_deposit` builds valid transactions against mainnet

### 5. Safety
- [ ] Python backend still available (not deleted, just stopped) for 1 week
- [ ] Database backup exists before schema migration
- [ ] Rollback plan: can re-enable Python backend by changing Vercel env var back

## Output format

🔴 **CRITICAL** / 🟡 **IMPORTANT** / 🟢 **MINOR**
