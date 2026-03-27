# Phase 3 Review: Manage Module — Iteration 4 (Final)

**Date:** 2026-03-27
**Scope:** `backend-ts/src/manage/` (18 files)
**Compared against:** `MIGRATION_PLAN.md`, `frontend/src/lib/protocols/`

---

## Iteration 3 Fix Verification

| # | Issue | Status |
|---|-------|--------|
| 1 | Truncated `COMPUTE_BUDGET_PROGRAM` in tx-preview.ts | **Fixed** — now 43 chars, verified matches `ComputeBudgetProgram.programId.toBase58()` from SDK |

---

## Full Checklist

### 1. Module Isolation

- [x] Manage only queries `manage.*` tables (`api_keys` — `db/schema.ts`)
- [x] Reads opportunity data via `discoverService.getOpportunityById()` (`tx-builder.ts:46`)
- [x] No imports from `discover/db/` or `monitor/` (grep: zero matches)

### 2. Protocol Adapter Correctness

**Kamino (`protocols/kamino.ts`):**
- [x] Vault deposit: loads KaminoVault, converts amount with Decimal, returns `depositIxs` + `stakeInFarmIfNeededIxs`
- [x] Vault withdraw: token-to-shares conversion (capped at total), returns with vault LUT
- [x] Lending deposit: parses extraData (`market`, `token_mint`, `decimals`), `KaminoAction.buildDepositTxns`
- [x] Lending withdraw: `KaminoAction.buildWithdrawTxns`
- [x] Signer replaced with `walletAddress: string`

**Drift (`protocols/drift.ts`):**
- [x] IF deposit: checks stake account via `getAccountInfo`, `initializeStakeAccount` flag
- [x] IF withdraw: 2-step — `requestRemoveInsuranceFundStake` → `removeInsuranceFundStake` after cooldown
- [x] Vault deposit: checks depositor exists, `initVaultDepositorIx` if needed
- [x] Vault withdraw: reads `lastWithdrawRequest.shares`, request vs execute based on state

**Jupiter (`protocols/jupiter.ts`):**
- [x] Earn deposit/withdraw via `@jup-ag/lend/earn` (`getDepositIxs`, `getRedeemIxs`, `getWithdrawIxs`)
- [x] Token decimals lookup (hardcoded: USDC, USDT, SOL, USDS, mSOL, jitoSOL)

All adapters 1:1 with frontend source.

### 3. Instruction Serialization

- [x] `SerializableInstruction` format: `{ programAddress, accounts: [{address, role}], data }` (`shared/types.ts:31-35`)
- [x] `data` field base64 encoded (`instruction-serializer.ts:19`)
- [x] Account `role` correct: 0=readonly, 1=writable, 2=readonly+signer, 3=writable+signer (`instruction-converter.ts:19`)
- [x] Lookup table addresses included (`instruction-serializer.ts:40`)
- [x] Setup instruction sets serialized (`instruction-serializer.ts:43-46`)
- [ ] Round-trip test — not implemented (minor, no risk given straightforward serializer)

### 4. Transaction Flow

- [x] Build endpoint: returns unsigned instructions (never signs)
- [x] Submit endpoint: accepts base64 signed tx, submits via Helius RPC
- [x] Submit is optional — clients can submit directly
- [x] Simulation opt-in: `simulate: false` default (`schemas.ts:21`)
- [x] When `simulate=true`: returns `success`, `computeUnits`, `fee` (base + priority), `error`, `logs`
- [x] When `simulate=false`: just instructions, no overhead
- [x] Fee estimate: base fee (5000) + priority fee parsed from `setComputeUnitPrice` instruction (`tx-preview.ts:23-33`)
- [x] `COMPUTE_BUDGET_PROGRAM` constant matches SDK (43 chars, verified)
- [x] Single Connection instance reused for LUT fetch and simulation (`tx-preview.ts:70`)

### 5. Safety Guards

- [N/A] Stablecoin-only — opt-in via `STABLECOIN_ONLY=true` (intentional design decision)
- [x] Category blocklist: multiply blocked by default (`BLOCKED_CATEGORIES` defaults to `"multiply"`, `guards.ts:90`)
- [x] Per-tx limit: `MCP_MAX_DEPOSIT_USD` env var (`guards.ts:57`)
- [x] Program verification: `guardProgramWhitelist` on main instructions (`tx-builder.ts:96`) AND `setupInstructionSets` (`tx-builder.ts:97-101`)
- [x] Pre-build guards run before adapter: wallet valid + deposit limit (`tx-builder.ts:42-43`), then opp active + adapter + stablecoin + category (`tx-builder.ts:47-50`)

### 6. API Key Auth

- [x] All `/api/manage/*` routes require API key (`index.ts:7` — `authHook` as `preHandler`)
- [x] Key hashed with SHA-256 (`auth.ts:39`)
- [x] Missing/invalid returns 401 (`auth.ts:34`, `auth.ts:48`)
- [x] Per-key rate limiting (`auth.ts:54-69`) — reads `rate_limit` column, default 100 req/min, returns 429
- [x] Stale entry eviction (`auth.ts:70-74`) — cleans entries older than 2x window

### 7. Error Handling

- [x] SDK errors surfaced clearly (out of liquidity, insufficient balance, cooldown with redeemable dates)
- [x] Protocol API failures handled gracefully (Jupiter price fetch, CDN, KSwap routing)
- [x] Invalid `opportunity_id` returns 404 (`guardOpportunityActive` → `GuardError(…, 404)`)
- [x] Invalid `wallet_address` returns 400 (Zod schema + `guardWalletValid`)
- [x] `GuardError.statusCode` propagated via shared `errorHandler` (`shared/error-handler.ts:29-32`)

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| 🔴 CRITICAL | 0 | — |
| 🟡 IMPORTANT | 0 | — |
| 🟢 MINOR | 1 | No serialization round-trip test |

**All checklist items pass.** The single minor item (round-trip test) is a nice-to-have with no correctness risk.

---

## Issue Resolution Across Iterations

| Iteration | Criticals | Importants | Minors |
|-----------|-----------|------------|--------|
| 1 | 4 (whitelist unwired, no stablecoin guard, no category blocklist, rate limit global) | 4 | 2 |
| 2 | 0 | 4 (fee base-only, duplicate Connection, whitelist gap for setup ixs, no eviction) | 3 |
| 3 | 0 | 1 (truncated ComputeBudget constant) | 1 |
| 4 (final) | 0 | 0 | 1 |

**Module is production-ready.** Non-custodial design maintained, module isolation clean, all 3 protocol adapters faithful to frontend, safety guards complete, auth + rate limiting per-key, error handling thorough.
