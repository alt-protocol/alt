# Akashi MCP Server

Non-custodial Solana yield aggregator exposed as an MCP (Model Context Protocol) server. Provides 20 tools across 3 modules — Discover (yield data), Monitor (portfolio tracking), and Manage (transaction building). Any MCP-compatible agent (Claude Desktop, Claude Code, Cursor, ChatGPT) can search yields, check portfolios, and build transactions.

**Non-custodial:** The server never handles private keys. Transaction tools return unsigned base64-encoded transactions. The agent or user signs externally.

## Connect

The MCP server is exposed as an HTTP endpoint on the backend at `POST /api/mcp` using the Streamable HTTP transport.

### Claude Desktop / Claude Code

```json
{
  "mcpServers": {
    "akashi": {
      "type": "url",
      "url": "https://your-app.railway.app/api/mcp"
    }
  }
}
```

For local development (backend running on :8001):
```json
{
  "mcpServers": {
    "akashi": {
      "type": "url",
      "url": "http://localhost:8001/api/mcp"
    }
  }
}
```

### MCP Inspector (testing)

```bash
npx @modelcontextprotocol/inspector --url http://localhost:8001/api/mcp
```

## Tool Reference

### Discover (4 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `search_yields` | Search yield opportunities with filters | `category?`, `tokens?`, `asset_class?`, `sort?`, `limit?` |
| `get_yield_details` | Get full details for one opportunity | `opportunity_id` |
| `get_yield_history` | APY/TVL snapshots over time | `opportunity_id`, `period?` (7d/30d/90d) |
| `get_protocols` | List all supported protocols | (none) |

### Monitor (7 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_portfolio` | DeFi positions with PnL and APY | `wallet_address`, `include_analytics?` |
| `track_wallet` | Register wallet for monitoring | `wallet_address` |
| `get_wallet_status` | Check fetch status (fetching/ready/error) | `wallet_address` |
| `get_wallet_balances` | Raw SPL token balances | `wallet_address` |
| `get_position_history` | Portfolio value over time (bucketed) | `wallet_address`, `period?`, `external_id?` |
| `get_position_events` | Transaction events (deposits, withdrawals) | `wallet_address`, `protocol?`, `limit?` |
| `sync_position` | Sync a position after transaction | `wallet_address`, `opportunity_id` |

### Manage (9 tools)

| Tool | Description | Key Params |
|------|-------------|------------|
| `build_deposit_tx` | Build unsigned deposit transaction | `opportunity_id`, `wallet_address`, `amount`, `leverage?` |
| `build_withdraw_tx` | Build unsigned withdrawal transaction | `opportunity_id`, `wallet_address`, `amount` |
| `submit_transaction` | Submit a pre-signed transaction (**auth required**) | `signed_transaction` (base64) |
| `get_balance` | Protocol-specific vault balance | `opportunity_id`, `wallet_address` |
| `get_wallet_balance` | On-chain SPL token balance | `wallet_address`, `mint` |
| `get_withdraw_state` | Withdrawal state (e.g. Drift redeem timers) | `opportunity_id`, `wallet_address` |
| `get_position_stats` | Multiply position stats (leverage, LTV) | `opportunity_id`, `wallet_address` |
| `get_price_impact` | Price impact estimate for deposit/withdraw | `opportunity_id`, `wallet_address`, `amount`, `direction` |
| `swap` | Jupiter swap (quote or build) (**auth required for build**) | `wallet_address`, `input_mint`, `output_mint`, `amount`, `quote_only?` |

## Authentication

Most tools are open (no API key needed). Only mutation tools require auth:
- `submit_transaction` — always requires API key
- `swap` with `quote_only=false` — requires API key for building transactions

Pass auth via HTTP header: `Authorization: Bearer <key>`

Build tools (`build_deposit_tx`, `build_withdraw_tx`) are open because they return unsigned transactions — no funds can move without a signature.

## Transaction Flow

Transactions are non-custodial — the MCP server builds but never signs.

```
1. Agent calls build_deposit_tx (or build_withdraw_tx / swap)
   Returns: { transaction (base64), blockhash, lastValidBlockHeight, summary, sign }

2. Agent or user signs the transaction externally
   - sign.web: Browser signing page URL
   - sign.deeplink: Mobile wallet deeplink (Phantom/Solflare)
   - sign.qr: QR code for mobile scanning
   - sign.action_api: Solana Actions URL (blink-compatible)
   - Direct: Agent signs with local keypair

3. Agent calls submit_transaction with the signed base64 transaction
   Returns: { signature, status: "submitted" }
```

The `transaction` field is a base64-encoded unsigned `VersionedTransaction` (v0). The `blockhash` expires in ~60-90 seconds — if signing takes too long, call `build_*_tx` again.

Some operations (e.g. Kamino Multiply) return `setup_transactions[]` — these must be signed and submitted in order before the main transaction.

## Architecture

```
backend/src/mcp/
  server.ts              MCP server creation + tool registration
  plugin.ts              Fastify plugin — Streamable HTTP transport at /api/mcp
  tools/
    discover.ts          4 tools wrapping discoverService
    monitor.ts           7 tools wrapping monitorService
    manage.ts            9 tools wrapping tx-builder + adapters
  __tests__/
    tools.int.test.ts    Integration tests (InMemoryTransport + Client)
```

The MCP layer is a thin wrapper — all business logic lives in the service modules (Discover, Manage, Monitor). Tools call service methods directly via TypeScript imports, no HTTP overhead.
