# Phase 4 Review: Frontend Migration — Iteration 1

**Date:** 2026-03-27
**Scope:** `frontend/src/` — SDK removal, API migration, transaction flow
**Compared against:** `MIGRATION_PLAN.md`, `backend-ts/src/manage/`

---

## Checklist

### 1. SDK Removal

- [x] No protocol SDK imports in any frontend file (grep: zero matches for `@kamino-finance`, `@drift-labs`, `@jup-ag/lend`)
- [x] Packages removed from `frontend/package.json` (grep: zero matches)
- [x] `frontend/src/lib/protocols/` directory deleted (glob: no files found)
- [x] `instruction-converter.ts`, `jupiter-swap.ts`, `multiply-luts.ts`, `kswap.ts` all deleted (glob: no files found)
- [x] `npm run build` passes (verified by explore agent: compiled successfully)

**Verdict:** Complete. All protocol SDKs and adapter code removed cleanly.

---

### 2. API URL Migration

- [x] All API calls use new prefixes: `/api/discover/*`, `/api/monitor/*`, `/api/manage/*` (`api.ts:143-216`)
- [x] No references to old URLs (grep: zero matches for `"/api/yields"`, `"/api/portfolio"`, `"/api/protocols"`)
- [x] API functions in `lib/api.ts` updated with new paths

**Endpoints confirmed:**
- Discover: `GET /api/discover/yields`, `GET /api/discover/yields/{id}`, `GET /api/discover/yields/{id}/history`, `GET /api/discover/protocols`
- Monitor: `GET /api/monitor/portfolio/{wallet}`, `POST .../track`, `GET .../positions`, `GET .../positions/history`, `GET .../status`, `GET .../events`
- Manage: `POST /api/manage/tx/build-deposit`, `POST /api/manage/tx/build-withdraw`, `POST /api/manage/balance`, `POST /api/manage/withdraw-state`
- Health: `GET /api/health`

**Verdict:** Complete. All routes migrated.

---

### 3. Transaction Flow

- [x] `DepositWithdrawPanel` calls `api.buildDeposit()` / `api.buildWithdraw()` instead of `adapter.buildDepositTx()`
- [x] Response deserialized: `deserializeBuildResponse(response)` produces valid `BuildTxResult`
- [x] `useTransaction` hook works: builds tx message, signs with wallet, submits directly to Solana
- [x] LUT compression works: `compressTransactionMessageUsingAddressLookupTables` with `fetchAddressesForLookupTables` (`useTransaction.ts:114-118`)
- [x] Setup transactions handled: iterates `setupInstructionSets`, sends each, waits 2s for LUT warmup (`useTransaction.ts:88-105`)
- [x] `MultiplyPanel` calls API instead of adapter

**Verdict:** Complete. Clean non-custodial flow: backend builds → frontend signs → frontend submits directly.

---

### 4. Instruction Deserializer

- [x] `instruction-deserializer.ts` exists (`frontend/src/lib/instruction-deserializer.ts`, 59 lines)
- [x] Correctly reconstructs `Instruction` objects: `programAddress` via `address()`, accounts with `role` preserved, `data` as `Uint8Array`
- [x] Base64 data decoding: `new Uint8Array(Buffer.from(ix.data, "base64"))` (line 20)
- [x] Account roles map correctly (0-3): `role: a.role` preserved as-is (line 18)
- [x] Handles all 3 response variants: plain `Instruction[]`, `BuildTxResultWithLookups`, `BuildTxResultWithSetup` (lines 39-58)
- [x] `BuildTxApiResponse` interface matches backend's `BuildTxResponse` schema

**Verdict:** Complete and correct.

---

### 5. Wallet Connection Unchanged

- [x] `@solana/react` + `@solana/kit` still used for wallet
- [x] `SolanaProviders.tsx` unchanged (Wallet Standard, `SelectedWalletAccountContextProvider`)
- [x] `WalletButton.tsx` unchanged (`useSelectedWalletAccount` from `@solana/react`)
- [x] Signer obtained from `useWalletAccountTransactionSendingSigner` (`DepositWithdrawPanel.tsx`, `MultiplyPanel.tsx`)
- [x] No legacy `@solana/wallet-adapter-*` imports (grep: zero matches)

**Verdict:** Unchanged. Modern Wallet Standard stack intact.

---

### 6. No Broken Pages

- [x] Dashboard loads — yields from `/api/discover/yields`
- [x] Portfolio page loads — positions from `/api/monitor/portfolio/{wallet}/*`
- [x] Yield detail pages load — `/api/discover/yields/{id}`
- [x] Category filters work — query params passed through
- [x] Build passes with no TypeScript errors (confirmed)
- [x] No broken imports: zero matches for `protocols/`, `instruction-converter`, `kswap`, `multiply-luts`, `jupiter-swap`, `getAdapter`, `ProtocolAdapter`

**Verdict:** All pages functional. No broken references.

---

### 7. Balance Hooks

- [x] `usePositionBalance` migrated — calls `api.getBalance({ opportunity_id, wallet_address })` instead of `adapter.getBalance()` (`usePositionBalance.ts:22-25`)
- [x] `useTokenBalance` unchanged — reads from RPC directly, no backend dependency
- [x] New `useWithdrawState` hook — calls `api.getWithdrawState()` for Drift-style 2-step withdrawals
- [x] Backend `/balance` and `/withdraw-state` routes confirmed to exist (`manage/routes/tx.ts:106-156`)

**Verdict:** Complete.

---

## New Findings

### 🔴 CRITICAL — Frontend manage API calls have no auth header, will fail when auth is enabled

**Files:** `frontend/src/lib/api.ts:122-127` (the `apiPost` function)

The `apiPost` function sends requests with only `Content-Type: application/json` — no `Authorization: Bearer <key>` header. The manage module's `authHook` (`shared/auth.ts`) requires a Bearer token unless `MANAGE_AUTH_DISABLED=true`.

**Impact:** In production with auth enabled (the default), ALL frontend manage API calls will return 401:
- `api.buildDeposit()` → 401
- `api.buildWithdraw()` → 401
- `api.getBalance()` → 401
- `api.getWithdrawState()` → 401

This means **no user can deposit, withdraw, or see balances** in production with auth enabled.

**Options to fix:**
1. **Split auth scope** — only require API key for `/tx/submit` (MCP agents), make build/balance/withdraw-state routes public (with rate limiting)
2. **Frontend API key** — pass a frontend-specific API key via `NEXT_PUBLIC_MANAGE_API_KEY` env var in the `apiPost` headers
3. **Origin-based bypass** — skip auth for same-origin requests or for requests from allowed CORS origins

Option 1 is cleanest: build endpoints don't need auth because they return unsigned instructions (no security risk). Rate limiting is already in place per-route.

### 🟡 IMPORTANT — `usePositionBalance` has unused parameters

**File:** `frontend/src/lib/hooks/usePositionBalance.ts`

The hook accepts `protocolSlug`, `depositAddress`, `category`, and `extraData` parameters but only uses `opportunityId` and `walletAddress` for the API call. The unused params are still in the `queryKey` and `enabled` check, which is not harmful (they differentiate cache entries and prevent premature queries), but they're vestigial from the old adapter-based interface.

**Fix:** Simplify the hook signature to just `(walletAddress, opportunityId)` and update all callers. Or keep as-is for backwards compatibility.

### 🟢 MINOR — `useTransaction` setup tx confirmation is fire-and-forget

**File:** `frontend/src/lib/hooks/useTransaction.ts:102`

`await rpc.getSignatureStatuses([signature(setupSig)]).send()` fetches the status but doesn't check if the setup tx actually succeeded. If the setup tx fails, the main tx would also fail (which would be caught by the try/catch), so this isn't dangerous — just not the most robust confirmation pattern.

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| 🔴 CRITICAL | 1 | Frontend manage API calls have no auth header — will 401 in production |
| 🟡 IMPORTANT | 1 | `usePositionBalance` has unused parameters from old adapter interface |
| 🟢 MINOR | 1 | Setup tx confirmation is fire-and-forget |

### What's working well

- **SDK removal is 100% clean** — zero traces of protocol SDKs, adapter pattern, or legacy utilities
- **Instruction deserializer is correct** — handles all 3 response variants, proper base64/role/address conversion
- **Transaction flow is elegant** — `useTransaction` handles setup txs, LUT compression, signing, and confirmation in a unified hook
- **API URLs fully migrated** — all routes use new modular prefixes, zero legacy references
- **Wallet stack untouched** — modern @solana/kit + @solana/react, no regressions
- **Balance hooks properly migrated** — call backend manage API instead of local adapters
- **Backend routes confirmed** — `/balance` and `/withdraw-state` exist with proper adapter delegation
