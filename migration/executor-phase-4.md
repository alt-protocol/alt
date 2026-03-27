# Phase 4: Frontend Migration to Thin Client

Read `MIGRATION_PLAN.md` for architecture. Phases 1-3 must be complete.

## What to build

Migrate the frontend from heavy client (protocol SDKs in browser) to thin client (calls backend API for transaction building).

## Steps

### 1. Update API client
Edit `frontend/src/lib/api.ts`:
- Update base URLs: `/api/yields` → `/api/discover/yields`, `/api/portfolio` → `/api/monitor/portfolio`
- Add new tx API functions:
  ```typescript
  buildDeposit(params: { opportunity_id: number, amount: string, wallet_address: string, simulate?: boolean }): Promise<BuildTxResponse>
  buildWithdraw(params: { opportunity_id: number, amount: string, wallet_address: string, simulate?: boolean }): Promise<BuildTxResponse>
  submitTransaction(signedTx: string): Promise<{ signature: string, status: string }>
  ```
- Add `BuildTxResponse` type matching the Manage API response
- Add `SerializableInstruction` type

### 2. Add instruction deserializer
Create `frontend/src/lib/instruction-deserializer.ts`:
```typescript
import type { Instruction } from "@solana/kit";

interface SerializableInstruction {
  programAddress: string;
  accounts: { address: string; role: number }[];
  data: string; // base64
}

export function deserializeInstruction(ix: SerializableInstruction): Instruction {
  return {
    programAddress: address(ix.programAddress),
    accounts: ix.accounts.map(a => ({ address: address(a.address), role: a.role })),
    data: new Uint8Array(Buffer.from(ix.data, 'base64')),
  };
}

export function deserializeInstructions(ixs: SerializableInstruction[]): Instruction[] {
  return ixs.map(deserializeInstruction);
}
```

### 3. Update DepositWithdrawPanel
Replace local adapter calls with API calls:
```typescript
// BEFORE:
const adapter = await getAdapter(protocolSlug);
const result = await adapter.buildDepositTx({ signer, depositAddress, amount, category, extraData });

// AFTER:
const response = await api.buildDeposit({ opportunity_id: yield_.id, amount, wallet_address: signer.address });
const instructions = deserializeInstructions(response.instructions);
// Return in BuildTxResult format for useTransaction hook
```

The `useTransaction` hook stays unchanged — it still handles signing, LUT compression, and submission.

### 4. Update MultiplyPanel
Same pattern as DepositWithdrawPanel — replace adapter calls with API calls.
Handle setup_instruction_sets from the API response.

### 5. Remove protocol SDK dependencies
Edit `frontend/package.json` — remove:
- `@kamino-finance/klend-sdk`
- `@kamino-finance/kswap-sdk`
- `@kamino-finance/scope-sdk`
- `@drift-labs/sdk`
- `@drift-labs/vaults-sdk`
- `@jup-ag/lend`

Run `npm install` to clean up node_modules.

### 6. Delete protocol-related files
- Delete `frontend/src/lib/protocols/` (entire directory)
- Delete `frontend/src/lib/instruction-converter.ts` (moved to backend)
- Delete `frontend/src/lib/jupiter-swap.ts` (moved to backend)
- Delete `frontend/src/lib/multiply-luts.ts` (moved to backend)
- Delete `frontend/src/lib/kswap.ts` (moved to backend)

Keep:
- `frontend/src/lib/hooks/useTransaction.ts` — still handles signing + submission
- `frontend/src/lib/transaction-utils.ts` — `buildTransactionMessage()` still used
- `frontend/src/lib/multiply-utils.ts` — UI helpers (leverage table parsing, APY interpolation)

### 7. Update useMultiplySetup hook
If this hook exists and references protocol adapters, update it to call the API instead.

### 8. Update balance hooks
`usePositionBalance` and similar hooks that call `adapter.getBalance()` — these may need to call a backend endpoint instead, or use the existing Monitor positions data.

## Key constraints
- `useTransaction` hook stays — it handles signing and submission client-side
- Frontend still connects wallet via `@solana/react` — wallet connection doesn't change
- Frontend still submits transactions directly via RPC (default path) — `POST /api/manage/tx/submit` is for agents
- `npm run build` must pass with no errors after all changes

## Verify before committing
1. `npm run build` — no errors
2. `npm run dev` — app loads, all pages render
3. Yield listing page works (data from `/api/discover/yields`)
4. Portfolio page works (data from `/api/monitor/portfolio/:wallet/*`)
5. Deposit flow: click deposit → enter amount → builds tx via API → wallet prompts → confirms on chain
6. Withdraw flow: same via API
7. No protocol SDK imports remain in frontend code

Commit: `git add -A && git commit -m "Phase 4: frontend thin client migration"`
