import { APP_URL } from "./constants.js";

/**
 * Returns the full skill.md content with the current APP_URL interpolated.
 * Served at GET /skill.md and GET /api/skill.
 */
export function getSkillContent(): string {
  return `# Akashi — Non-Custodial Solana Yield Aggregator

Read this skill file and follow the instructions to start using Akashi.

Akashi lets you discover DeFi yield opportunities on Solana, build deposit/withdraw transactions, monitor portfolios, and swap tokens — all through a REST API. Akashi is **non-custodial**: the backend NEVER handles private keys. All transactions are returned **unsigned** — you sign them yourself.

Base URL: ${APP_URL}

## Quick Start

1. Register for an API key
2. Search for yield opportunities
3. Build a deposit transaction (use \`format=assembled\` for a ready-to-sign base64 transaction)
4. Choose a signing method (direct sign, web link, deeplink, or QR code)
5. Submit the signed transaction

\`\`\`bash
# 1. Register
curl -X POST ${APP_URL}/api/auth/register \\
  -H "Content-Type: application/json" \\
  -d '{"name": "my-agent"}'
# → { "api_key": "ak_...", "name": "my-agent" }

# 2. Search yields
curl "${APP_URL}/api/discover/yields?asset_class=stablecoin&sort=apy_desc&limit=5"

# 3. Build assembled transaction
curl -X POST "${APP_URL}/api/manage/tx/build-deposit?format=assembled" \\
  -H "Content-Type: application/json" \\
  -d '{"opportunity_id": 1, "wallet_address": "YOUR_WALLET", "amount": "100"}'
# → { "transaction": "base64...", "sign": { "web": "...", "deeplink": "...", "qr": "...", "action_api": "..." }, ... }

# 4. After signing, submit
curl -X POST ${APP_URL}/api/manage/tx/submit \\
  -H "Authorization: Bearer ak_..." \\
  -H "Content-Type: application/json" \\
  -d '{"signed_transaction": "base64_signed_tx"}'
\`\`\`

---

## Authentication

### Register for an API Key

\`\`\`
POST ${APP_URL}/api/auth/register
Content-Type: application/json

{ "name": "your-agent-name" }
→ { "api_key": "ak_...", "name": "your-agent-name" }
\`\`\`

**IMPORTANT**: The API key is returned exactly ONCE. Store it securely. Never log or print it.

### Using Your Key

Include in the Authorization header for protected endpoints:

\`\`\`
Authorization: Bearer ak_...
\`\`\`

### What Requires Auth

- \`POST /api/manage/tx/submit\` (submitting signed transactions)

### What Is Open (No Auth)

- All \`GET\` endpoints (yields, protocols, portfolio, stablecoins)
- All build endpoints (\`build-deposit\`, \`build-withdraw\`, \`build-swap\`)
- Balance and state endpoints
- Quote endpoints

---

## Transaction Formats

Build endpoints (\`/tx/build-deposit\`, \`/tx/build-withdraw\`, \`/tx/build-swap\`) accept a \`format\` query parameter:

| Format | Description |
|--------|-------------|
| \`instructions\` (default) | Raw serialized instructions + lookup table addresses. Use if you construct transactions yourself. |
| \`assembled\` | Ready-to-sign base64 transaction + signing options. **Recommended for agents.** |

### Assembled Response Shape

\`\`\`json
{
  "transaction": "base64_unsigned_versioned_transaction",
  "blockhash": "...",
  "lastValidBlockHeight": 12345,
  "setup_transactions": ["base64..."],
  "summary": "Deposit 100 USDC into Kamino USDC Vault on Kamino (~8.2% APY)",
  "sign": {
    "web": "https://app.akashi.so/sign?action=...",
    "deeplink": "solana-action:https://...",
    "qr": "data:image/png;base64,...",
    "action_api": "https://api.akashi.so/api/manage/actions/deposit?..."
  }
}
\`\`\`

Notes:
- \`setup_transactions\` — optional pre-transactions (e.g. create token accounts). Sign and send these first.
- The transaction expires in ~60 seconds (recent blockhash TTL).
- For swaps, \`sign\` is not included (no Actions endpoint for swaps).

---

## Signing Methods

Since Akashi is non-custodial, you must sign transactions yourself. Choose the method that fits your setup:

### Option 1: Direct Signing (Agent Has Keypair)

Decode the base64 \`transaction\`, sign it with your keypair, re-encode, and submit:

\`\`\`
POST ${APP_URL}/api/manage/tx/submit
Authorization: Bearer ak_...
Content-Type: application/json

{ "signed_transaction": "base64_signed_transaction" }
\`\`\`

### Option 2: Web Signing Link (\`sign.web\`)

Open \`sign.web\` URL in a browser. The user connects their wallet (Phantom, Solflare, etc.) and signs.

### Option 3: Mobile Deeplink (\`sign.deeplink\`)

Open \`sign.deeplink\` — this triggers Phantom or Solflare on mobile to sign the transaction.

### Option 4: QR Code (\`sign.qr\`)

Display \`sign.qr\` (a data URL PNG). The user scans it with their mobile wallet to sign.

### Option 5: Blink / Solana Action (\`sign.action_api\`)

Use \`sign.action_api\` as a Solana Actions URL. Compatible with Blink clients, Dialect, and any Solana Actions-compatible wallet.

---

## API Reference

### Discover Module — Yield Opportunities

#### GET /api/discover/yields

Search and filter yield opportunities.

Query parameters:
- \`category\` — \`earn\`, \`lending\`, \`vault\`, \`multiply\`, \`insurance-fund\`
- \`asset_class\` — \`stablecoin\`, \`sol\`, \`btc\`, \`eth\`, \`other\`
- \`tokens\` — comma-separated token symbols (e.g. \`USDC,SOL\`)
- \`protocol\` — filter by protocol slug
- \`sort\` — \`apy_desc\` (default), \`apy_asc\`, \`tvl_desc\`, \`tvl_asc\`
- \`apy_min\`, \`apy_max\` — APY range filter
- \`tvl_min\`, \`tvl_max\` — TVL range filter
- \`limit\` (default 100, max 500), \`offset\` (default 0)

Returns: array of opportunities with \`id\`, \`name\`, \`apy_current\`, \`tvl_usd\`, \`tokens\`, \`category\`, \`protocol\`, \`risk_tier\`, \`liquidity_available_usd\`.

#### GET /api/discover/yields/:id

Full details for one opportunity including protocol info and recent APY snapshots.

#### GET /api/discover/yields/:id/history

Historical APY and TVL. Query: \`period\` (\`7d\`|\`30d\`|\`90d\`), \`limit\`, \`offset\`.

#### GET /api/discover/protocols

List all supported DeFi protocols with name, website, audit status.

#### GET /api/discover/stablecoins/peg-stats

Peg stability metrics for all tracked stablecoins.

#### GET /api/discover/stablecoins/:symbol/price-history

Price history for a stablecoin. Query: \`period\` (\`7d\`|\`30d\`).

---

### Monitor Module — Portfolio Tracking

#### GET /api/monitor/portfolio/:wallet

SPL token balances for a wallet (on-chain fetch).

#### POST /api/monitor/portfolio/:wallet/track

Register a wallet for DeFi position tracking. Kicks off background fetching of positions across Kamino, Drift, Jupiter. Returns current state + fetch status.

#### GET /api/monitor/portfolio/:wallet/status

Check tracking status: \`fetching\`, \`ready\`, or \`error\`. Poll this after \`/track\`.

#### GET /api/monitor/portfolio/:wallet/positions

List tracked DeFi positions. Query: \`protocol\`, \`product_type\`.

Returns: array of positions with \`id\`, \`protocol_slug\`, \`product_type\`, \`opportunity_id\`, \`deposit_amount\`, \`deposit_amount_usd\`, \`pnl_usd\`, \`pnl_pct\`, \`apy\`, \`is_closed\`.

#### GET /api/monitor/portfolio/:wallet/positions/history

Historical portfolio value over time. Query: \`period\` (\`7d\`|\`30d\`|\`90d\`), \`external_id\` (optional, per-position), \`limit\`, \`offset\`.

#### GET /api/monitor/portfolio/:wallet/events

Transaction events (deposits, withdrawals). Query: \`protocol\`, \`product_type\`, \`limit\` (default 50).

#### GET /api/monitor/portfolio/:wallet/analytics

Comprehensive portfolio metrics:
- \`summary\`: total value, PnL, ROI, weighted APY, projected yearly yield
- \`stablecoin\`: idle vs allocated, allocation APY
- \`diversification\`: breakdown by protocol, category, token

#### POST /api/monitor/portfolio/:wallet/sync

Sync a specific position after a transaction. Body: \`{ "opportunity_id": 123 }\`.

---

### Manage Module — Transaction Building

#### POST /api/manage/tx/build-deposit?format=assembled

Build an unsigned deposit transaction.

Body:
\`\`\`json
{
  "opportunity_id": 1,
  "wallet_address": "base58...",
  "amount": "100.5",
  "extra_data": {
    "leverage": 2.0,
    "slippageBps": 200
  }
}
\`\`\`

- \`extra_data.leverage\` — required for multiply positions (e.g. 2.0 = 2x)
- \`extra_data.slippageBps\` — slippage tolerance (default 30 = 0.3%)
- \`extra_data.action\` — \`open\` (default), \`adjust\`, \`add_collateral\`, \`borrow_more\`
- \`extra_data.position_id\` — for managing existing multiply positions
- \`extra_data.deposit_token\` — \`debt\` or \`collateral\` for multiply

#### POST /api/manage/tx/build-withdraw?format=assembled

Build an unsigned withdrawal transaction. Same body shape as deposit.

- \`extra_data.action\` — \`close\` (default), \`adjust\`, \`withdraw_collateral\`, \`repay_debt\`
- \`extra_data.position_id\` — for multiply close/adjust

#### POST /api/manage/tx/submit (AUTH REQUIRED)

Submit a signed transaction to the Solana network.

\`\`\`
Authorization: Bearer ak_...
Content-Type: application/json

{ "signed_transaction": "base64_signed_tx" }
→ { "signature": "...", "status": "submitted" }
\`\`\`

#### GET /api/manage/swap/quote

Get a Jupiter swap quote (no transaction built).

Query: \`input_mint\`, \`output_mint\`, \`amount\` (smallest units), \`slippage_bps\`, \`taker\` (wallet).

#### POST /api/manage/tx/build-swap?format=assembled

Build an unsigned swap transaction.

Body:
\`\`\`json
{
  "wallet_address": "base58...",
  "input_mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "output_mint": "So11111111111111111111111111111111111111112",
  "amount": "1000000",
  "slippage_bps": 50
}
\`\`\`

Note: \`amount\` is in smallest units (e.g. 1000000 = 1 USDC with 6 decimals).

#### POST /api/manage/tx/balance

Protocol-specific vault/position balance. Body: \`{ "opportunity_id": 1, "wallet_address": "..." }\`.

#### POST /api/manage/tx/wallet-balance

On-chain SPL token balance. Body: \`{ "wallet_address": "...", "mint": "..." }\`.

#### POST /api/manage/tx/withdraw-state

Check withdrawal state for protocols with redemption periods (e.g. Drift 3-day redeem).

Body: \`{ "opportunity_id": 1, "wallet_address": "..." }\`.

#### POST /api/manage/tx/position-stats

On-chain multiply position stats (Kamino/Jupiter). Body: \`{ "opportunity_id": 1, "wallet_address": "..." }\`.

---

## MCP Server

Akashi also exposes an MCP (Model Context Protocol) server for clients that support it:

\`\`\`
POST ${APP_URL}/api/mcp
Authorization: Bearer ak_...
X-Agent-Id: your-agent-name
\`\`\`

The MCP server provides the same capabilities as the REST API through 22 tools. Use this if your client supports MCP natively.

---

## Common Workflows

### Find Best Stablecoin Yield and Deposit

1. \`GET /api/discover/yields?asset_class=stablecoin&sort=apy_desc&limit=5\`
2. Pick the best opportunity (check \`apy_current\`, \`tvl_usd\`, \`risk_tier\`)
3. \`POST /api/manage/tx/build-deposit?format=assembled\` with \`opportunity_id\`, \`wallet_address\`, \`amount\`
4. Sign using your preferred method (see Signing Methods)
5. \`POST /api/manage/tx/submit\` with \`signed_transaction\`

### Monitor a Portfolio

1. \`POST /api/monitor/portfolio/:wallet/track\` — register wallet
2. Poll \`GET /api/monitor/portfolio/:wallet/status\` until \`ready\`
3. \`GET /api/monitor/portfolio/:wallet/analytics\` — full metrics

### Withdraw from a Position

1. \`GET /api/monitor/portfolio/:wallet/positions\` — find the position
2. Note the \`opportunity_id\` from the position
3. \`POST /api/manage/tx/withdraw-state\` — check for redemption period (Drift has 3-day redeem)
4. \`POST /api/manage/tx/build-withdraw?format=assembled\`
5. Sign and submit

### Swap Tokens

1. \`GET /api/manage/swap/quote\` — preview the swap
2. \`POST /api/manage/tx/build-swap?format=assembled\` — build the transaction
3. Sign and submit

---

## Supported Protocols

| Protocol | Categories | Notes |
|----------|-----------|-------|
| **Kamino** | Lending, Vaults, Multiply | Full integration (deposit, withdraw, leverage) |
| **Drift** | Insurance Fund | 3-day redemption period on withdrawals |
| **Jupiter** | Earn (lending), Multiply | Flash-loan based leverage positions |
| **Exponent** | Fixed-yield tokenization | Data only (no tx building yet) |
| **Solstice** | Delta-neutral strategies | Data only |

---

## Rate Limits

- **Global**: 100 requests/minute per IP
- **Per API key**: 100 requests/minute (configurable)
- **Build endpoints**: 10 requests/minute
- **Submit endpoint**: 20 requests/minute
- **Registration**: 5 requests/minute

## Errors

All errors return JSON:

\`\`\`json
{ "message": "Description of what went wrong" }
\`\`\`

| Status | Meaning |
|--------|---------|
| 400 | Invalid request body or parameters |
| 401 | Missing or invalid API key |
| 404 | Resource not found |
| 422 | Valid request but operation failed (e.g. insufficient balance) |
| 429 | Rate limited — slow down |
| 502 | Upstream RPC/API error |

---

## Security Notes

- **Never share your API key.** Store it in environment variables or a secure config file.
- **Transactions expire in ~60 seconds** — sign promptly after building.
- **Always verify transaction instructions** before signing. The backend validates programs against a whitelist, but you should verify too.
- **Non-custodial guarantee**: Akashi never has access to your private keys. The backend only builds unsigned transactions.
`;
}
