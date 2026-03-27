# Phase 5: MCP Server

Read `MIGRATION_PLAN.md` for architecture. Phases 1-4 must be complete.

## What to build

Create `mcp-server/` — a thin MCP wrapper (~200 lines) that translates MCP tool calls into HTTP requests to the backend.

## Steps

### 1. Create `mcp-server/`
- `package.json` — minimal deps: `@modelcontextprotocol/sdk`
- `tsconfig.json` — strict, target ES2022
- Scripts: `build` (tsc), `start` (node dist/index.js)

### 2. Create MCP server
`src/index.ts` — stdio entry point:
```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server({ name: "akashi", version: "1.0.0" }, { capabilities: { tools: {} } });
// Register tools...
const transport = new StdioServerTransport();
await server.connect(transport);
```

### 3. Register 7 tools

`src/server.ts` — tool definitions:

| Tool | Method | Backend endpoint |
|------|--------|-----------------|
| `list_opportunities` | GET | `/api/discover/yields?stablecoins_only=true` |
| `get_opportunity_details` | GET | `/api/discover/yields/:id` |
| `get_positions` | GET | `/api/monitor/portfolio/:wallet/positions` |
| `get_wallet_balance` | GET | `/api/monitor/portfolio/:wallet` |
| `build_deposit` | POST | `/api/manage/tx/build-deposit` (with `simulate: true`) |
| `build_withdraw` | POST | `/api/manage/tx/build-withdraw` (with `simulate: true`) |
| `submit_transaction` | POST | `/api/manage/tx/submit` |

Each tool:
- Defines input schema (Zod or JSON Schema)
- Makes HTTP call to backend
- Returns formatted result

### 4. Configuration
Only needs 2 env vars:
- `AKASHI_API_URL` — backend URL (default `http://localhost:8001`)
- `AKASHI_API_KEY` — API key for Manage endpoints

### 5. Add `.env.example`

## Key constraints
- Zero protocol SDKs — just HTTP calls
- Zero RPC connections — backend handles everything
- MCP agents always pass `simulate: true` to get balance change previews
- Keep it under ~200 lines total

## Verify before committing
1. `cd mcp-server && npm run build` — compiles
2. Test with MCP Inspector: `npx @modelcontextprotocol/inspector node dist/index.js`
3. All 7 tools appear and return data
4. `list_opportunities` returns yield data
5. `build_deposit` returns unsigned instructions + simulation preview
6. Test with Claude Desktop: add to `claude_desktop_config.json`, verify tools work

Commit: `git add mcp-server/ && git commit -m "Phase 5: MCP server"`
