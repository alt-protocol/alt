# Phase 4 Validator: Frontend Migration

Review the frontend changes against `MIGRATION_PLAN.md`.

Do NOT make code changes. Only review and report.

## Review checklist

### 1. SDK removal
- [ ] No protocol SDK imports in any frontend file: `grep -r "@kamino-finance\|@drift-labs\|@jup-ag/lend" frontend/src/`
- [ ] These packages removed from `frontend/package.json`
- [ ] `frontend/src/lib/protocols/` directory deleted
- [ ] `instruction-converter.ts`, `jupiter-swap.ts`, `multiply-luts.ts`, `kswap.ts` deleted
- [ ] `npm run build` passes with no errors

### 2. API URL migration
- [ ] All API calls use new prefixes: `/api/discover/*`, `/api/monitor/*`, `/api/manage/*`
- [ ] No references to old URLs: `grep -r '"/api/yields\|"/api/portfolio\|"/api/protocols"' frontend/src/` (should find none)
- [ ] API functions in `lib/api.ts` updated with new paths

### 3. Transaction flow
- [ ] `DepositWithdrawPanel` calls `api.buildDeposit()` instead of `adapter.buildDepositTx()`
- [ ] Response deserialized: `deserializeInstructions(response.instructions)` produces valid `Instruction[]`
- [ ] `useTransaction` hook still works (builds tx message, signs, submits)
- [ ] LUT compression still works (lookup_table_addresses from API response)
- [ ] Setup transactions handled (setup_instruction_sets from API response)
- [ ] `MultiplyPanel` calls API instead of adapter

### 4. Instruction deserializer
- [ ] `instruction-deserializer.ts` exists
- [ ] Correctly reconstructs `Instruction` objects: programAddress, accounts with roles, data as Uint8Array
- [ ] Base64 data decoding works
- [ ] Account roles map correctly (0-3)

### 5. Wallet connection unchanged
- [ ] `@solana/react` + `@solana/kit` still used for wallet
- [ ] `SolanaProviders.tsx` unchanged
- [ ] `WalletButton.tsx` unchanged
- [ ] Signer obtained from `useWalletAccountTransactionSendingSigner`

### 6. No broken pages
- [ ] Dashboard loads (yields from Discover API)
- [ ] Portfolio page loads (positions from Monitor API)
- [ ] Yield detail pages load
- [ ] Category filters work
- [ ] No console errors

### 7. Balance hooks
- [ ] `usePositionBalance` still works (may need adjustment if it called adapter.getBalance)
- [ ] `useTokenBalance` unchanged (reads from RPC directly)
- [ ] Withdraw tab shows correct balance

## Output format

🔴 **CRITICAL** / 🟡 **IMPORTANT** / 🟢 **MINOR**
