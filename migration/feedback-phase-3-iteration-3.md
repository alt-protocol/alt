# Phase 3 Review: Manage Module — Iteration 3

**Date:** 2026-03-27
**Scope:** `backend-ts/src/manage/` (18 files)
**Compared against:** `MIGRATION_PLAN.md`, `frontend/src/lib/protocols/`
**Iteration 2 fixes verified:** 4 of 5 fully resolved, 1 has a bug

---

## Iteration 2 Fix Verification

| # | Issue | Status |
|---|-------|--------|
| 1 | Program whitelist for setup instructions | **Fixed** — `tx-builder.ts:97-101` iterates `setupInstructionSets` through `guardProgramWhitelist` |
| 2 | Fee estimate with priority fees | **Partially broken** — logic is correct but constant is wrong (see 🟡 below) |
| 3 | Reuse Connection in simulation | **Fixed** — single `connection` at `tx-preview.ts:70`, reused for LUT fetch and simulation |
| 4 | Rate limit tracker cleanup | **Fixed** — eviction at `auth.ts:70-74` with `2 * RATE_LIMIT_WINDOW_MS` threshold |
| 5 | JSDoc comment on stablecoin guard | **Fixed** — `guards.ts:70` now reads "default: disabled" |

---

## Findings

### 🟡 IMPORTANT — `COMPUTE_BUDGET_PROGRAM` address is truncated in tx-preview.ts

**File:** `backend-ts/src/manage/services/tx-preview.ts:7`

Verified via Node.js (`ComputeBudgetProgram.programId.toBase58()`):

| Source | String | Length | Correct? |
|--------|--------|--------|----------|
| SDK (ground truth) | `ComputeBudget111111111111111111111111111111` | 43 | — |
| `guards.ts:111` | `ComputeBudget111111111111111111111111111111` | 43 | Yes |
| `tx-preview.ts:7` | `ComputeBudget111111111111111111111111111` | 40 | **No** (3 chars short) |

**Impact:** `extractPriorityFee()` compares instruction program addresses against the truncated 40-char string. It never matches, silently returns 0 microLamports. Fee estimate is always just 5000 lamports (base fee only). The extraction logic itself (discriminator parsing, u64 LE read) is correct — only the constant is wrong.

**Fix:** Line 7 of `tx-preview.ts`:
```diff
- const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111";
+ const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
```

---

## Full Checklist

### 1. Module Isolation

- [x] Manage only queries `manage.*` tables (`api_keys`)
- [x] Reads opportunity data via `discoverService.getOpportunityById()` (`tx-builder.ts:46`)
- [x] No imports from `discover/db/` or `monitor/` (grep-confirmed)

### 2. Protocol Adapter Correctness

**Kamino** — [x] vault deposit/withdraw, lending deposit/withdraw, multiply open/close, signer as `walletAddress: string`

**Drift** — [x] IF deposit (stake account check), IF withdraw (2-step), vault deposit (depositor init), vault withdraw (pending state)

**Jupiter** — [x] Earn deposit/withdraw via `@jup-ag/lend/earn`, token decimals lookup

All adapters unchanged from iteration 2, 1:1 match with frontend.

### 3. Instruction Serialization

- [x] `SerializableInstruction` format correct
- [x] `data` field base64 encoded
- [x] Account `role` values: 0=readonly, 1=writable, 2=readonly+signer, 3=writable+signer
- [x] Lookup table addresses included
- [x] Setup instruction sets serialized correctly
- [ ] Round-trip test — not implemented (minor, unchanged)

### 4. Transaction Flow

- [x] Build returns unsigned instructions
- [x] Submit accepts base64 signed tx, submits via Helius RPC
- [x] Submit is optional
- [x] Simulation opt-in (`simulate: false` default)
- [x] When `simulate=true`: returns `success`, `computeUnits`, `fee`, `error`, `logs`
- [x] When `simulate=false`: just instructions

Fee estimate logic is correct but produces wrong results due to truncated constant (see 🟡 above).

### 5. Safety Guards

- [N/A] Stablecoin-only — opt-in via `STABLECOIN_ONLY=true` (intentional design decision)
- [x] Category blocklist: multiply blocked by default (`BLOCKED_CATEGORIES`)
- [x] Per-tx limit: `MCP_MAX_DEPOSIT_USD`
- [x] Program verification: `guardProgramWhitelist` on main instructions AND `setupInstructionSets`
- [x] Pre-build guards run before adapter call

### 6. API Key Auth

- [x] All `/api/manage/*` routes require API key
- [x] SHA-256 hashed, compared against DB
- [x] Missing/invalid returns 401
- [x] Per-key rate limiting with `rate_limit` column, stale entry eviction

### 7. Error Handling

- [x] SDK errors surfaced clearly
- [x] Protocol API failures handled gracefully
- [x] Invalid `opportunity_id` returns 404
- [x] Invalid `wallet_address` returns 400

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| 🔴 CRITICAL | 0 | — |
| 🟡 IMPORTANT | 1 | Truncated ComputeBudget address in tx-preview.ts (fee estimate always base-only) |
| 🟢 MINOR | 1 | No serialization round-trip test |

### Single fix needed

Replace the truncated `COMPUTE_BUDGET_PROGRAM` constant at `tx-preview.ts:7` with the correct 43-character address from `guards.ts:111`. This is a 3-character string fix.

### Overall

Module is production-ready pending the one constant fix. All critical and important items from iterations 1 and 2 are resolved. Module isolation, protocol adapters, serialization, auth, rate limiting, safety guards, and error handling are all solid.
