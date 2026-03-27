# Phase 3: Manage Module

Read `MIGRATION_PLAN.md` for architecture. Phases 1-2 must be complete.

## What to build

Add the **Manage** module — transaction building, protocol adapters, safety guards. This centralizes all transaction logic so any client (web, MCP, mobile) can build unsigned transactions via API.

## Steps

### 1. Set up Manage DB
- `manage/db/schema.ts` — `manage.api_keys` table (id, key_hash, name, created_at, is_active, rate_limit)
- `manage/db/connection.ts` — DB pool

### 2. Copy + adapt protocol adapters from frontend
Source files: `frontend/src/lib/protocols/`

- `manage/protocols/types.ts` — adapt `BuildTxParams`: accept `walletAddress: string` instead of `TransactionSendingSigner`. Add `SerializableInstruction` type for JSON output.
- `manage/protocols/kamino.ts` — port from `frontend/src/lib/protocols/kamino.ts` (vault + lending). Remove `"use client"`, replace `@/lib/*` imports.
- `manage/protocols/drift.ts` — port from `frontend/src/lib/protocols/drift.ts` (insurance fund + vault)
- `manage/protocols/jupiter.ts` — port from `frontend/src/lib/protocols/jupiter.ts` (earn/lending)
- `manage/protocols/index.ts` — registry

### 3. Create transaction building services
- `manage/services/instruction-converter.ts` — copy from `frontend/src/lib/instruction-converter.ts`
- `manage/services/instruction-serializer.ts` — NEW: convert `@solana/kit` `Instruction` objects to JSON-safe format:
  ```typescript
  interface SerializableInstruction {
    programAddress: string;
    accounts: { address: string; role: number }[];  // role: 0-3
    data: string;  // base64 encoded
  }
  ```
- `manage/services/tx-builder.ts` — orchestrates: fetch opportunity from Discover → load adapter → build instructions → serialize
- `manage/services/tx-preview.ts` — simulation via RPC `simulateTransaction()`, extract balance changes
- `manage/services/guards.ts` — safety checks:
  - Stablecoin-only: reject non-USDC/USDT/USDS opportunities
  - Category blocklist: multiply blocked by default (configurable)
  - Per-tx spend limit: `MCP_MAX_DEPOSIT_USD` env var (default $1000)
  - Program verification: validate program IDs match known protocols

### 4. Create Manage routes
- `manage/routes/tx.ts`:
  - `POST /api/manage/tx/build-deposit` — build unsigned deposit instructions
    - Request: `{ opportunity_id, amount, wallet_address, simulate?: boolean }`
    - Response: `{ instructions, lookup_table_addresses, setup_instruction_sets, preview? }`
  - `POST /api/manage/tx/build-withdraw` — same shape
  - `POST /api/manage/tx/submit` — submit signed tx via Helius RPC (optional — clients can submit directly)
    - Request: `{ signed_transaction: string }` (base64)
    - Response: `{ signature, status }`

### 5. Wire cross-module read
Manage reads from Discover to get opportunity details:
```typescript
const opp = await discoverService.getOpportunityById(opportunity_id);
// Use opp.deposit_address, opp.protocol_slug, opp.category, opp.extra_data
```

### 6. Add API key auth
- `shared/auth.ts` — middleware that checks `Authorization: Bearer <api_key>` header
- Hash keys with SHA-256, compare against `manage.api_keys` table
- All `/api/manage/tx/*` routes require API key

### 7. Create Manage service interface
- `manage/service.ts`:
  ```typescript
  buildDeposit(params: BuildRequest): Promise<BuildResponse>
  buildWithdraw(params: BuildRequest): Promise<BuildResponse>
  submitTransaction(signedTx: string): Promise<SubmitResponse>
  ```

## Key constraints
- **Non-custodial**: never hold private keys. Build unsigned instructions only.
- **Simulation is opt-in**: `simulate: true` adds ~200ms. Browser wallets simulate themselves.
- **Dual submission**: clients can submit directly via own RPC OR via `POST /submit`.
- **Guards run before building**: reject early if opportunity is not stablecoin, over limit, etc.
- Protocol SDKs are heavy — use dynamic imports to avoid loading all SDKs at startup.

## Verify before committing
1. `npm run build` compiles
2. POST build-deposit with a real opportunity_id returns valid instructions JSON
3. Instructions can be deserialized back into `@solana/kit` Instruction objects
4. Guards reject non-stablecoin opportunities
5. Simulation preview includes balance changes when `simulate: true`

Commit: `git add -A && git commit -m "Phase 3: Manage module"`
