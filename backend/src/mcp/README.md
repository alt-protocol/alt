# Akashi MCP Server

Non-custodial Solana yield aggregator exposed as an MCP (Model Context Protocol) server. Provides 17 tools across 3 modules — Discover (yield data), Monitor (portfolio tracking), and Manage (transaction building). Any MCP-compatible agent (Claude Desktop, Claude Code, custom bots) can search yields, check portfolios, and build transactions.

**Non-custodial:** The server never handles private keys. Transaction tools return unsigned base64-encoded transactions. The agent or user signs externally.

## Quick Start

```bash
cd backend
npm run mcp          # starts MCP server over stdio
```

Required environment variables (in `backend/.env`):
```
DATABASE_URL=postgresql://localhost:5432/alt
HELIUS_API_KEY=your-helius-key
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your-helius-key
```

## Claude Desktop Configuration

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "akashi": {
      "command": "npx",
      "args": ["tsx", "src/mcp/cli.ts"],
      "cwd": "/absolute/path/to/backend",
      "env": {
        "DATABASE_URL": "postgresql://localhost:5432/alt",
        "HELIUS_API_KEY": "your-key",
        "HELIUS_RPC_URL": "https://mainnet.helius-rpc.com/?api-key=your-key"
      }
    }
  }
}
```

## Tool Reference

### Discover (yield data)

| Tool | Description | Key Params |
|------|-------------|------------|
| `search_yields` | Search yield opportunities with filters | `category?`, `tokens?`, `stablecoins_only?`, `sort?`, `limit?` |
| `get_yield_details` | Get full details for one opportunity | `opportunity_id` |
| `get_yield_history` | APY/TVL snapshots over time | `opportunity_id`, `period?` (7d/30d/90d) |
| `get_protocols` | List all supported protocols | (none) |

### Monitor (portfolio tracking)

| Tool | Description | Key Params |
|------|-------------|------------|
| `get_portfolio` | DeFi positions with PnL and APY | `wallet_address` |
| `track_wallet` | Register wallet for monitoring | `wallet_address` |
| `get_wallet_status` | Check fetch status (fetching/ready/error) | `wallet_address` |
| `get_wallet_balances` | Raw SPL token balances | `wallet_address` |
| `get_position_history` | Portfolio value over time (bucketed) | `wallet_address`, `period?`, `external_id?` |
| `get_position_events` | Transaction events (deposits, withdrawals) | `wallet_address`, `protocol?`, `limit?` |

### Manage (transaction building)

| Tool | Description | Key Params |
|------|-------------|------------|
| `build_deposit_tx` | Build unsigned deposit transaction | `opportunity_id`, `wallet_address`, `amount` |
| `build_withdraw_tx` | Build unsigned withdrawal transaction | `opportunity_id`, `wallet_address`, `amount` |
| `submit_transaction` | Submit a pre-signed transaction | `signed_transaction` (base64) |
| `get_balance` | Protocol-specific vault balance | `opportunity_id`, `wallet_address` |
| `get_withdraw_state` | Withdrawal state (e.g. Drift redeem timers) | `opportunity_id`, `wallet_address` |
| `get_swap_quote` | Jupiter swap quote | `input_mint`, `output_mint`, `amount`, `taker` |
| `build_swap_tx` | Build unsigned swap transaction | `wallet_address`, `input_mint`, `output_mint`, `amount` |

## Transaction Flow

Transactions are non-custodial — the MCP server builds but never signs.

```
1. Agent calls build_deposit_tx (or build_withdraw_tx / build_swap_tx)
   Returns: { transaction (base64), blockhash, lastValidBlockHeight, summary }

2. Agent or user signs the transaction externally
   - Agent with keypair: signs with local wallet
   - Human in the loop: agent shows summary, user signs with Phantom/CLI

3. Agent calls submit_transaction with the signed base64 transaction
   Returns: { signature, status: "submitted" }
```

The `transaction` field is a base64-encoded unsigned `VersionedTransaction` (v0). The `blockhash` expires in ~60-90 seconds — if signing takes too long, call `build_*_tx` again.

Some operations (e.g. Kamino Multiply) return `setup_transactions[]` — these must be signed and submitted in order before the main transaction.

## Architecture

```
backend/src/mcp/
  server.ts              MCP server creation + tool registration
  cli.ts                 stdio entry point (Claude Desktop / Claude Code)
  tools/
    discover.ts          4 tools wrapping discoverService
    monitor.ts           6 tools wrapping monitorService
    manage.ts            7 tools wrapping tx-builder + adapters
  __tests__/
    tools.test.ts        Integration tests (InMemoryTransport + Client)
```

The MCP layer is a thin wrapper — all business logic lives in the service modules (Discover, Manage, Monitor). Tools call service methods directly via TypeScript imports, no HTTP overhead.
