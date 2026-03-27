# Phase 5 Validator: MCP Server

Review `mcp-server/` against `MIGRATION_PLAN.md`.

Do NOT make code changes. Only review and report.

## Review checklist

### 1. Project setup
- [ ] Minimal dependencies (only `@modelcontextprotocol/sdk`)
- [ ] No protocol SDK imports
- [ ] Compiles: `cd mcp-server && npm run build`
- [ ] Under ~200 lines of source code

### 2. All 7 tools registered
- [ ] `list_opportunities` → GET /api/discover/yields?stablecoins_only=true
- [ ] `get_opportunity_details` → GET /api/discover/yields/:id
- [ ] `get_positions` → GET /api/monitor/portfolio/:wallet/positions
- [ ] `get_wallet_balance` → GET /api/monitor/portfolio/:wallet
- [ ] `build_deposit` → POST /api/manage/tx/build-deposit (with simulate: true)
- [ ] `build_withdraw` → POST /api/manage/tx/build-withdraw (with simulate: true)
- [ ] `submit_transaction` → POST /api/manage/tx/submit

### 3. Tool schemas
- [ ] Each tool has input schema defining required/optional params
- [ ] `build_deposit`: requires opportunity_id, amount, wallet_address
- [ ] `list_opportunities`: optional category, sort, tokens filters
- [ ] `get_positions`: requires wallet_address

### 4. API key auth
- [ ] Manage endpoints include `Authorization: Bearer <key>` header
- [ ] API key read from `AKASHI_API_KEY` env var
- [ ] Discover/Monitor endpoints don't need auth

### 5. Error handling
- [ ] HTTP errors surfaced as tool errors (not crashes)
- [ ] Missing env vars caught at startup
- [ ] Network failures handled gracefully

### 6. MCP Inspector test
Run: `npx @modelcontextprotocol/inspector node mcp-server/dist/index.js`
- [ ] All 7 tools appear in tool list
- [ ] `list_opportunities` returns data
- [ ] `build_deposit` returns instructions + preview

## Output format

🔴 **CRITICAL** / 🟡 **IMPORTANT** / 🟢 **MINOR**
