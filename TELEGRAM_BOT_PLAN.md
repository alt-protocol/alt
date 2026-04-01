# Plan: Telegram Bot — No Frontend Signing, Solana Actions + Claude Sonnet

## Context

Building a Telegram bot for Akashi that lets users view yields/positions and execute deposits/withdrawals. Signing happens via **Solana Actions (Blinks)** — user taps a link in Telegram, their wallet app (Phantom, Solflare, etc.) opens, shows the tx, user signs. No frontend `/sign` page needed.

AI layer: **Claude Sonnet** via Anthropic API for natural language → tool calls.

## Architecture

```
User (Telegram)       telegram-bot/           Backend (existing)        User's Wallet
───────────────      ───────────────          ──────────────────       ─────────────
"deposit 100         Claude Sonnet            POST /api/actions/       Opens wallet app
 USDC into Kamino"   parses → tool call       deposit                  Shows tx preview
                     ───────────────▶         → builds instructions    User signs
                                              → fetches blockhash      Wallet submits
                     ◀───────────────         → assembles full tx      to Solana
                     Gets action URL          → returns serialized tx

                     Sends blink to user
                     in Telegram chat
                     ──────────────────────────────────────────────▶
```

## What Needs to Be Built

### 1. Backend: Solana Actions endpoints (new routes in manage module)

The [Solana Actions spec](https://solana.com/docs/advanced/actions) requires:

**`GET /api/actions/deposit?opportunity_id=X`** — Returns action metadata:
```json
{
  "icon": "https://...",
  "title": "Deposit into Kamino USDC Earn",
  "description": "Deposit USDC into Kamino Earn vault. Current APY: 8.2%",
  "label": "Deposit",
  "links": {
    "actions": [
      { "label": "Deposit 100 USDC", "href": "/api/actions/deposit?opportunity_id=X&amount=100" },
      { "label": "Deposit", "href": "/api/actions/deposit?opportunity_id=X&amount={amount}", "parameters": [{ "name": "amount", "label": "Amount (USDC)" }] }
    ]
  }
}
```

**`POST /api/actions/deposit?opportunity_id=X&amount=100`** — Returns serialized tx:
```json
{
  "transaction": "<base64-encoded-unsigned-transaction>",
  "message": "Deposit 100 USDC into Kamino Earn"
}
```

The POST handler:
1. Calls existing `buildDeposit()` from `tx-builder.ts` (reuse, no duplication)
2. Fetches recent blockhash via `getRpc()` from `shared/rpc.ts`
3. Assembles v0 transaction message using `@solana/kit` (already a dependency)
4. Serializes to base64
5. Returns in Actions spec format

Same pattern for withdraw: `GET/POST /api/actions/withdraw`.

**CORS requirement:** Solana Actions requires specific CORS headers — `Access-Control-Allow-Origin: *` on the actions routes only, plus `Access-Control-Allow-Methods: GET,POST,OPTIONS`.

**actions.json:** Serve `GET /actions.json` at backend root — maps URL patterns to action endpoints.

### 2. `telegram-bot/` service (new, separate from monolith)

**Tech stack:**
- `grammy` — Telegram Bot API framework (modern, TypeScript-native)
- `@anthropic-ai/sdk` — Claude Sonnet for natural language
- `better-sqlite3` — conversation persistence + wallet linking (file-based, no extra DB)

**Tools (same as MCP server, 7 total):**
- `list_opportunities` → GET /api/discover/yields
- `get_opportunity_details` → GET /api/discover/yields/:id
- `get_positions` → GET /api/monitor/portfolio/:wallet/positions
- `get_wallet_balance` → GET /api/monitor/portfolio/:wallet
- `build_deposit` → constructs Solana Action blink URL
- `build_withdraw` → constructs Solana Action blink URL
- `check_transaction` → checks tx status on Solana (new, uses RPC)

**Conversation flow for transactions:**
1. User: "deposit 100 USDC into Kamino"
2. Bot (Claude): calls `get_opportunity_details` to find the vault, calls `build_deposit`
3. Bot sends message with blink URL: `solana-action:https://backend.akashi.com/api/actions/deposit?opportunity_id=123&amount=100&wallet=<user_wallet>`
4. User taps → wallet app opens → signs → wallet submits to Solana
5. User comes back to Telegram, bot can check tx status

**Wallet linking:**
- User sends `/connect` → bot returns message "What's your Solana wallet address?"
- User pastes address (or bot could use Phantom connect deeplink for verification)
- Bot stores `telegram_id ↔ wallet_address` in SQLite
- For POC: trust the address. For production: verify via signed message.

### 3. No frontend changes needed

The existing frontend is untouched. The Telegram bot is a completely independent client that talks to the same backend API.

## Development Phases

### Phase 1: Read-only bot (~3-4 days)
- Scaffold `telegram-bot/` with grammy + Claude Sonnet
- Implement read-only tools (list yields, get details, view positions, check balance)
- Wallet linking (address paste, SQLite storage)
- Conversation persistence
- **Deliverable:** Bot that answers "what are the best yields?" and "show my positions"

### Phase 2: Solana Actions on backend (~2-3 days)
- Add `/api/actions/deposit` and `/api/actions/withdraw` endpoints
- Add `actions.json` route
- Transaction assembly logic (instructions → blockhash → serialize)
- CORS headers for Actions spec
- **Deliverable:** Blink URLs that open in Phantom/Solflare and let user sign

### Phase 3: Transaction flow in bot (~2-3 days)
- Wire `build_deposit`/`build_withdraw` tools to generate blink URLs
- Bot sends blink in chat → user signs in wallet
- `check_transaction` tool for confirmation
- Single-step rule: one tx at a time, build fresh on confirm
- **Deliverable:** Full deposit/withdraw flow via Telegram

### Phase 4: Polish (~1-2 days)
- Error handling + retry logic
- Rate limiting on bot commands
- Formatted messages (Telegram markdown)
- Bot commands menu (/start, /connect, /positions, /yields)

## Key Files

### Backend (modify)
| File | Change |
|------|--------|
| `backend/src/manage/routes/actions.ts` | **New** — Solana Actions endpoints |
| `backend/src/manage/routes/actions-schemas.ts` | **New** — Zod schemas for Actions |
| `backend/src/manage/index.ts` | Register new routes |
| `backend/src/app.ts` | Add CORS exception for /api/actions/* |

### Telegram bot (create)
| File | Purpose |
|------|---------|
| `telegram-bot/package.json` | grammy, @anthropic-ai/sdk, better-sqlite3 |
| `telegram-bot/tsconfig.json` | TypeScript config |
| `telegram-bot/src/index.ts` | Bot entry + command handlers |
| `telegram-bot/src/ai.ts` | Claude Sonnet integration + tool definitions |
| `telegram-bot/src/tools.ts` | Tool implementations (API calls to backend) |
| `telegram-bot/src/wallet-store.ts` | SQLite wallet linking |
| `telegram-bot/src/blinks.ts` | Solana Action URL generation |
| `telegram-bot/.env.example` | TELEGRAM_BOT_TOKEN, ANTHROPIC_API_KEY, AKASHI_API_URL |

## Key Constraints
- **Non-custodial** — bot never holds keys, signing in user's wallet app
- **Single-step rule** — one tx at a time, build fresh when user confirms (blockhash expiry)
- **Separate service** — `telegram-bot/` is not a backend module, has its own deployment
- **Reuse** — Actions endpoints reuse existing `buildDeposit()`/`buildWithdraw()`, zero duplication

## Verification (per phase)

**Phase 1:** Bot responds to messages, returns yield data, shows positions for linked wallet
**Phase 2:** `curl -X POST /api/actions/deposit?opportunity_id=1&amount=100` returns valid base64 tx
**Phase 3:** Full flow: message → blink → sign in Phantom → tx confirmed on Solana
**Phase 4:** Error cases handled, bot commands work, messages formatted
