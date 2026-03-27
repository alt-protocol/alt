# Phase 5 Review: MCP Server

## Review Checklist Results

### 1. Project setup
- [x] Minimal dependencies (only `@modelcontextprotocol/sdk`)
- [x] No protocol SDK imports
- [x] Compiles: `cd mcp-server && npm run build` — clean, no errors
- [x] Under ~200 lines of source code — **187 lines**, single file `src/index.ts`

### 2. All 7 tools registered
- [x] `list_opportunities` → `GET /api/discover/yields` with optional `stablecoins_only` param
- [x] `get_opportunity_details` → `GET /api/discover/yields/:id`
- [x] `get_positions` → `GET /api/monitor/portfolio/:wallet/positions`
- [x] `get_wallet_balance` → `GET /api/monitor/portfolio/:wallet`
- [x] `build_deposit` → `POST /api/manage/tx/build-deposit` with `simulate: true`
- [x] `build_withdraw` → `POST /api/manage/tx/build-withdraw` with `simulate: true`
- [x] `submit_transaction` → `POST /api/manage/tx/submit`

### 3. Tool schemas
- [x] Each tool has Zod input schema defining required/optional params
- [x] `build_deposit`: requires `opportunity_id`, `wallet_address`, `amount`
- [x] `list_opportunities`: optional `category`, `sort`, `stablecoins_only`, `limit` filters
- [x] `get_positions`: requires `wallet_address`, optional `protocol`

### 4. API key auth
- [x] `submit_transaction` includes `Authorization: Bearer <key>` header (only endpoint that needs it)
- [x] API key read from `AKASHI_API_KEY` env var
- [x] Discover/Monitor endpoints don't use auth
- **Note:** Backend only requires auth on `/tx/submit` (has `preHandler: [authHook]`), NOT on `build-deposit`/`build-withdraw`. MCP server correctly mirrors this.

### 5. Error handling
- [x] HTTP errors surfaced via thrown `Error` with status + path + body text
- [ ] Missing env vars caught at startup — **NOT DONE** (see 🟡 below)
- [x] Network failures handled (fetch errors propagate to MCP framework)

### 6. MCP Inspector test
- Not tested during review (would require running backend)

---

## Issues Found

### 🟡 IMPORTANT: No startup validation for `AKASHI_API_KEY`

**File:** `mcp-server/src/index.ts:12`

`AKASHI_API_KEY` defaults to empty string `""`. If a user forgets to set it, `submit_transaction` will silently send requests without the `Authorization` header (line 29: `if (auth && API_KEY)` — empty string is falsy). The backend returns 401, but the error message ("API 401: /api/manage/tx/submit — Missing API key") is confusing because it comes from the backend, not the MCP server.

**Fix:** Add a `console.error` warning at startup if `AKASHI_API_KEY` is not set:
```typescript
if (!API_KEY) {
  console.error("Warning: AKASHI_API_KEY not set — submit_transaction will fail");
}
```

### 🟡 IMPORTANT: Tool errors not explicitly caught — relies on MCP framework

**File:** `mcp-server/src/index.ts` (all tool handlers)

None of the 7 tool handlers wrap their logic in try/catch. When `apiGet`/`apiPost` throws, the error propagates to the MCP SDK framework. The SDK does handle uncaught errors, but returning explicit `{ isError: true }` responses gives cleaner error messages to the AI client.

**Fix:** Wrap each tool handler (or the helpers) to catch errors and return:
```typescript
{ isError: true, content: [{ type: "text", text: error.message }] }
```

### 🟢 MINOR: `zod` is not a direct dependency

**File:** `mcp-server/package.json`

`zod` is imported at line 5 (`import { z } from "zod"`) but is not listed in `package.json` dependencies. It works because it's installed as a transitive dependency of `@modelcontextprotocol/sdk`. This is fragile — if the SDK ever stops depending on zod (or bundles it differently), the import breaks.

**Fix:** Add `zod` as a direct dependency:
```bash
cd mcp-server && npm install zod
```

### 🟢 MINOR: `get_positions` fire-and-forget tracking silently swallows errors

**File:** `mcp-server/src/index.ts:115`

```typescript
apiPost(`/api/monitor/portfolio/${wallet_address}/track`, {}).catch(() => {});
```

This is intentionally fire-and-forget, which is fine. But `.catch(() => {})` discards all errors including network errors that might indicate the backend is unreachable. Consider logging:
```typescript
.catch((err) => console.error("Track wallet:", err.message));
```

---

## Summary

Phase 5 is clean and well-structured — 187 lines, single file, zero protocol SDK imports, correct auth pattern matching the backend. All 7 tools are registered with proper Zod schemas and correct endpoint mappings. The two 🟡 issues (startup validation, explicit error handling) are quality improvements, not blockers.
