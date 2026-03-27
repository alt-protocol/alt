# Phase 3 Review: Manage Module — Iteration 2

**Date:** 2026-03-27
**Scope:** `backend-ts/src/manage/` (18 files)
**Compared against:** `MIGRATION_PLAN.md`, `frontend/src/lib/protocols/`
**Iteration 1 fixes verified:** all 4 critical items resolved

---

## Iteration 1 Fix Verification

| # | Issue | Status |
|---|-------|--------|
| 1 | `guardProgramWhitelist` not called | **Fixed** — called at `tx-builder.ts:96` after serialization |
| 2 | Stablecoin guard | **Implemented as opt-in** — exists at `guards.ts:73-83`, disabled by default. User decision to keep opt-in. |
| 3 | No category blocklist | **Fixed** — `guardCategoryAllowed` at `guards.ts:89-99`, multiply blocked by default |
| 4 | Rate limiting not per-key | **Fixed** — in-memory per-key tracker at `auth.ts:18-69`, reads `rate_limit` column |
| 5 | Env var `MAX_DEPOSIT_USD` | **Fixed** — renamed to `MCP_MAX_DEPOSIT_USD` at `guards.ts:57` |
| 6 | Auth disabled by default | **Fixed** — now enabled by default, `MANAGE_AUTH_DISABLED=true` to skip (`auth.ts:30`) |
| 7 | Fee always null | **Fixed** — returns base fee 5000 lamports when CU available (`tx-preview.ts:84`) |
| 8 | Submit status enum too broad | **Fixed** — narrowed to `z.enum(["submitted"])` (`schemas.ts:65`) |

---

## Checklist Review

### 1. Module Isolation

- [x] Manage only queries `manage.*` tables (`api_keys` — `db/schema.ts`)
- [x] Reads opportunity data via `discoverService.getOpportunityById()` (`tx-builder.ts:46`)
- [x] No imports from `discover/db/` or `monitor/` (grep-confirmed: zero matches)

**Verdict:** Pass. Clean isolation.

---

### 2. Protocol Adapter Correctness

**Kamino (`protocols/kamino.ts`):**
- [x] Vault deposit: loads KaminoVault, converts amount with Decimal, returns `depositIxs` + `stakeInFarmIfNeededIxs`
- [x] Vault withdraw: converts to shares (capped at total), returns with vault LUT when present
- [x] Lending deposit: parses extraData (`market`, `token_mint`, `decimals`), `KaminoAction.buildDepositTxns`
- [x] Lending withdraw: `KaminoAction.buildWithdrawTxns`
- [x] Signer replaced with `walletAddress: string`

**Drift (`protocols/drift.ts`):**
- [x] IF deposit: checks if stake account exists (`getAccountInfo`), sets `initializeStakeAccount` flag
- [x] IF withdraw: 2-step — `requestRemoveInsuranceFundStake` → `removeInsuranceFundStake` after cooldown
- [x] Vault deposit: checks depositor exists, creates `initVaultDepositorIx` if needed
- [x] Vault withdraw: checks `lastWithdrawRequest.shares`, request or execute based on state

**Jupiter (`protocols/jupiter.ts`):**
- [x] Earn deposit/withdraw via `@jup-ag/lend/earn` (`getDepositIxs`, `getRedeemIxs`, `getWithdrawIxs`)
- [x] Token decimals lookup (hardcoded map: USDC, USDT, SOL, USDS, mSOL, jitoSOL)

**Verdict:** All three adapters are 1:1 ports from frontend. Pass.

---

### 3. Instruction Serialization

- [x] `SerializableInstruction` format: `{ programAddress, accounts: [{address, role}], data }` (`shared/types.ts:31-35`)
- [x] `data` field is base64 encoded (`instruction-serializer.ts:19`)
- [x] Account `role` correct: 0=readonly, 1=writable, 2=readonly+signer, 3=writable+signer (`instruction-converter.ts:19`)
- [x] Lookup table addresses included in response (`instruction-serializer.ts:40`)
- [x] Setup instruction sets serialized correctly (`instruction-serializer.ts:43-46`)
- [ ] Round-trip test: **not implemented**

🟢 **MINOR — No round-trip test.** No unit test verifying serialize → deserialize → compare. Low risk since the serializer is straightforward, but would catch regressions.

**Verdict:** Serialization logic is correct. Round-trip test is a nice-to-have.

---

### 4. Transaction Flow

- [x] Build endpoint: returns unsigned instructions (never signs)
- [x] Submit endpoint: accepts base64 signed tx, submits via Helius RPC (`sendRawTransaction`)
- [x] Submit is optional — clients can submit directly to Solana
- [x] Simulation opt-in: `simulate: true/false`, default `false` (`schemas.ts:21`)
- [x] When `simulate=true`: returns `success`, `computeUnits`, `fee`, `error`, `logs`
- [x] When `simulate=false`: just instructions, no preview overhead

🟡 **IMPORTANT — Fee estimate is base fee only.** `tx-preview.ts:84` returns 5000 lamports (1 signature base fee). Most Kamino/Drift transactions include `ComputeBudgetProgram.setComputeUnitPrice` instructions that add priority fees. The actual fee = `baseFee + (computeUnits * priorityFee)`. Consider parsing the `setComputeUnitPrice` instruction from the built ixs to give a more accurate estimate, or document that `fee` is the base fee only.

🟡 **IMPORTANT — Simulation creates duplicate Connection.** `tx-preview.ts` creates a `web3.Connection` at line 53 (for LUT fetching) and again at line 75 (for simulation). Should reuse a single instance. Not a correctness issue but wastes a TCP connection.

**Verdict:** Flow is correct and non-custodial. Fee estimate and Connection reuse are improvement areas.

---

### 5. Safety Guards

- [N/A] Stablecoin-only — **intentionally opt-in** (`STABLECOIN_ONLY=true` to enable). Removed from mandatory checklist per user decision.
- [x] Category blocklist: multiply blocked by default (`BLOCKED_CATEGORIES` defaults to `"multiply"`, `guards.ts:90`)
- [x] Per-tx limit: checks `MCP_MAX_DEPOSIT_USD` env var (`guards.ts:57`)
- [x] Program verification: `guardProgramWhitelist` called on serialized instructions (`tx-builder.ts:96`)
- [x] Guards run before building: wallet + deposit limit are pre-build (`tx-builder.ts:42-43`); opp + adapter + category are pre-build (`tx-builder.ts:47-50`); program whitelist is post-build (`tx-builder.ts:96`)

🟡 **IMPORTANT — Program whitelist only checks main instructions, not setupInstructionSets.** `tx-builder.ts:96` calls `guardProgramWhitelist(serialized.instructions)` but if `serialized.setupInstructionSets` exists, those instructions are not validated. Currently no adapter returns setup instructions (multiply returns `BuildTxResultWithLookups`, not `BuildTxResultWithSetup`), so this is theoretical. But if a future adapter returns setup txs, they'd bypass the whitelist.

**Fix (preventive):** After the main whitelist check, also iterate `serialized.setupInstructionSets?.flat()` through the same guard.

🟢 **MINOR — JSDoc comment contradicts code in `guardStablecoinOnly`.** Comment at `guards.ts:69-71` says "When STABLECOIN_ONLY !== 'false' (default: enabled)" but code at line 74 checks `!== "true"` (default: disabled). The code is correct per user intent; the comment is wrong.

**Verdict:** All safety guards are wired and functional. Setup instruction gap is theoretical but should be patched preventively.

---

### 6. API Key Auth

- [x] All `/api/manage/*` routes require API key (`index.ts:7` — `authHook` as `preHandler`)
- [x] Key hashed with SHA-256 (`auth.ts:39`)
- [x] Missing/invalid key returns 401 (`auth.ts:34`, `auth.ts:48`)
- [x] Per-key rate limiting implemented (`auth.ts:54-69`) — reads `rate_limit` column, default 100 req/min

🟡 **IMPORTANT — Rate limit tracker never evicts old entries.** `rateLimitTracker` Map at `auth.ts:19` grows unboundedly. Each unique API key hash gets an entry that is never removed, only overwritten when a new window starts. For a handful of keys this is fine, but if many keys are created/rotated over time, the map will accumulate stale entries.

**Fix:** Add a periodic cleanup (e.g., every 5 minutes, delete entries with `windowStart` older than 2 minutes), or use a simple TTL cache.

🟢 **MINOR — Rate limit window is fixed-window, not sliding.** A client could send `keyRateLimit` requests at :59, then another `keyRateLimit` at :00 (window rollover), getting 2x the limit in 2 seconds. Sliding window would be more accurate, but fixed window is standard for this scale.

**Verdict:** Auth is solid. Rate limiter works but needs cleanup for long-running processes.

---

### 7. Error Handling

- [x] SDK errors surfaced clearly (out of liquidity, insufficient balance, cooldown messages with redeemable dates)
- [x] Protocol API failures handled gracefully (Jupiter price fetch, CDN resources, KSwap routing all have descriptive errors)
- [x] Invalid `opportunity_id` returns 404 (`guardOpportunityActive` → `GuardError(…, 404)`)
- [x] Invalid `wallet_address` returns 400 (Zod schema rejects + `guardWalletValid`)
- [x] `GuardError.statusCode` correctly propagated via shared `errorHandler` (`shared/error-handler.ts:29-32`)

**Verdict:** Pass. Error handling is thorough.

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| 🔴 CRITICAL | 0 | — |
| 🟡 IMPORTANT | 4 | Fee estimate base-only, duplicate Connection, program whitelist gap for setup ixs, rate limit no eviction |
| 🟢 MINOR | 3 | No round-trip test, JSDoc comment wrong, fixed-window rate limit |

### 🟡 IMPORTANT — Recommended before production

1. **Program whitelist for setup instructions** (`tx-builder.ts`): After line 96, add:
   ```ts
   if (serialized.setupInstructionSets) {
     for (const set of serialized.setupInstructionSets) {
       guardProgramWhitelist(set);
     }
   }
   ```
   No adapter currently returns setup ixs, but this prevents a future gap.

2. **Fee estimate improvement** (`tx-preview.ts`): Parse the `setComputeUnitPrice` instruction from the built instructions to compute `baseFee + (computeUnits * microLamportsPerCU / 1_000_000)`. Or rename the field / add a doc comment clarifying it's base fee only.

3. **Reuse Connection in simulation** (`tx-preview.ts`): Move `const connection = new web3.Connection(...)` before the LUT fetch block and reuse it for both LUT resolution and simulation.

4. **Rate limit tracker cleanup** (`shared/auth.ts`): Add a `setInterval` or check-on-access cleanup for entries older than `RATE_LIMIT_WINDOW_MS`. Prevents unbounded memory growth.

### 🟢 MINOR — Nice to have

5. **Fix JSDoc** on `guardStablecoinOnly` (`guards.ts:69-71`): Change "default: enabled" to "default: disabled".

6. **Serialization round-trip test**: Unit test that serializes a known `Instruction`, then deserializes the JSON back, and asserts equality.

7. **Sliding-window rate limit**: Replace fixed-window with token bucket or sliding log for more accurate rate limiting. Not urgent at current scale.

---

### Overall Assessment

The Manage module is in good shape. All 4 critical issues from iteration 1 are resolved. The module correctly:
- Maintains non-custodial design (never signs)
- Isolates from other modules (Discover read via service interface only)
- Ports all 3 protocol adapters faithfully from frontend
- Serializes instructions correctly for JSON transport
- Validates inputs pre-build and programs post-build
- Authenticates and rate-limits per API key

The remaining items are hardening improvements, not blockers.
