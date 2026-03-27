# Phase 3 Validator: Manage Module

Review the Manage module in `backend-ts/src/manage/` against `MIGRATION_PLAN.md` and frontend adapter source.

Do NOT make code changes. Only review and report.

## Review checklist

### 1. Module isolation
- [ ] Manage only queries `manage.*` tables (api_keys)
- [ ] Reads opportunity data via `discoverService.getOpportunityById()` — not direct DB query
- [ ] No imports from `discover/db/` or `monitor/`

### 2. Protocol adapter correctness

Compare with frontend source (`frontend/src/lib/protocols/`):

**Kamino adapter** (`kamino.ts`):
- [ ] Vault deposit: loads KaminoVault, converts amount to shares, returns deposit + stake instructions
- [ ] Vault withdraw: returns withdraw instructions with lookup tables
- [ ] Lending deposit: parses extraData (market, mint, decimals), calls KaminoAction.buildDepositTxns
- [ ] Lending withdraw: KaminoAction.buildWithdrawTxns
- [ ] Signer replaced with `walletAddress: string` (no TransactionSendingSigner)

**Drift adapter** (`drift.ts`):
- [ ] IF deposit: checks if stake account exists, creates if needed
- [ ] IF withdraw: 2-step (request unstake → execute after cooldown)
- [ ] Vault deposit: checks depositor exists, initializes if needed
- [ ] Vault withdraw: handles pending request state

**Jupiter adapter** (`jupiter.ts`):
- [ ] Earn deposit/withdraw via `@jup-ag/lend/earn`
- [ ] Token decimals lookup

### 3. Instruction serialization
- [ ] `SerializableInstruction` format: `{ programAddress, accounts: [{address, role}], data }`
- [ ] `data` field is base64 encoded
- [ ] Account `role` uses correct values: 0=readonly, 1=writable, 2=readonly+signer, 3=writable+signer
- [ ] Lookup table addresses included in response
- [ ] Setup instruction sets (for multiply) serialized correctly
- [ ] Round-trip test: serialize → deserialize → compare with original

### 4. Transaction flow
- [ ] Build endpoint: returns unsigned instructions (never signs)
- [ ] Submit endpoint: accepts base64 signed tx, submits via Helius RPC, confirms
- [ ] Submit is optional — documented that clients can submit directly
- [ ] Simulation is opt-in (`simulate: true/false`, default false)
- [ ] When simulate=true: preview includes description, programs, balance changes, fee estimate
- [ ] When simulate=false: no preview, just instructions (~200ms faster)

### 5. Safety guards
- [ ] Stablecoin-only: rejects opportunities without USDC/USDT/USDS in tokens
- [ ] Category blocklist: multiply blocked (or configurable)
- [ ] Per-tx limit: checks against MCP_MAX_DEPOSIT_USD env var
- [ ] Program verification: validates instruction program IDs against known protocol programs
- [ ] Guards run BEFORE building instructions (fail fast)

### 6. API key auth
- [ ] All `/api/manage/tx/*` routes require API key
- [ ] Key hashed with SHA-256, compared against DB
- [ ] Missing/invalid key returns 401
- [ ] Rate limiting per key

### 7. Error handling
- [ ] SDK errors surfaced clearly (out of liquidity, insufficient balance, etc.)
- [ ] Protocol API failures handled gracefully
- [ ] Invalid opportunity_id returns 404
- [ ] Invalid wallet_address returns 400

## Output format

🔴 **CRITICAL** / 🟡 **IMPORTANT** / 🟢 **MINOR**
