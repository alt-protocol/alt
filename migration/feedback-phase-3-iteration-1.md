# Phase 3 Review: Manage Module — Iteration 1

**Date:** 2026-03-27
**Scope:** `backend-ts/src/manage/` (18 files)
**Compared against:** `MIGRATION_PLAN.md`, `frontend/src/lib/protocols/`

---

## 1. Module Isolation

- [x] Manage only queries `manage.*` tables (`api_keys`)
- [x] Reads opportunity data via `discoverService.getOpportunityById()` — not direct DB query (`tx-builder.ts:43`)
- [x] No imports from `discover/db/` or `monitor/` (confirmed via grep)

**Verdict:** Clean isolation. The only cross-module read is `discoverService.getOpportunityById()` in `tx-builder.ts`.

---

## 2. Protocol Adapter Correctness

### Kamino (`protocols/kamino.ts` — 634 lines)

- [x] Vault deposit: loads KaminoVault, converts amount with Decimal, returns `depositIxs` + `stakeInFarmIfNeededIxs`
- [x] Vault withdraw: converts token amount to shares (capped at total to avoid dust), returns with vault LUT when available
- [x] Lending deposit: parses extraData (market, token_mint, decimals), `KaminoAction.buildDepositTxns` with `VanillaObligation`
- [x] Lending withdraw: `KaminoAction.buildWithdrawTxns` with `VanillaObligation`
- [x] Multiply open: `getDepositWithLeverageIxs` with KSwap quoter/swapper, scope oracle refresh, LUT assembly from 5 sources
- [x] Multiply close: `getRepayWithCollIxs` with share-based redemption
- [x] Signer replaced with `walletAddress: string` (no `TransactionSendingSigner`)

**Matches frontend 1:1.** One note: multiply close uses `VanillaObligation` for `getObligationByWallet` — this matches the frontend and appears intentional (the SDK resolves obligation type internally).

### Drift (`protocols/drift.ts` — 634 lines)

- [x] IF deposit: checks if stake account exists, creates if needed (`initializeStakeAccount` flag)
- [x] IF withdraw: 2-step — `requestRemoveInsuranceFundStake` → `removeInsuranceFundStake` after cooldown
- [x] Vault deposit: checks depositor exists, initializes if needed (init param passed when account is null)
- [x] Vault withdraw: 2-step — `getRequestWithdrawIx` → `getWithdrawIx` after redeem period
- [x] SOL market handling: creates wrapped SOL account + close instruction
- [x] Proper cleanup: `DriftClient.unsubscribe()` in `finally` blocks
- [x] Cooldown: 13 days default (configurable via `unstaking_period_days`)

**Matches frontend 1:1.**

### Jupiter (`protocols/jupiter.ts` — 207 lines)

- [x] Earn deposit/withdraw via `@jup-ag/lend/earn`
- [x] Token decimals lookup (hardcoded map: USDC, USDT, SOL, USDS, mSOL, jitoSOL)
- [x] Share-based redemption via `getRedeemIxs` with fallback to asset-based
- [x] Full withdrawal detection (99.9% threshold)

**Matches frontend 1:1.**

---

## 3. Instruction Serialization

- [x] `SerializableInstruction` format: `{ programAddress, accounts: [{address, role}], data }` (`shared/types.ts:31-35`)
- [x] `data` field is base64 encoded (`instruction-serializer.ts:19`)
- [x] Account `role` uses correct values: 0=readonly, 1=writable, 2=readonly+signer, 3=writable+signer (`instruction-converter.ts:19`)
- [x] Lookup table addresses included in response (`instruction-serializer.ts:40-41`)
- [x] Setup instruction sets serialized correctly (`instruction-serializer.ts:43-46`)
- [ ] Round-trip test: **not implemented** (see 🟢 below)

---

## 4. Transaction Flow

- [x] Build endpoint: returns unsigned instructions (never signs)
- [x] Submit endpoint: accepts base64 signed tx, submits via Helius RPC (`sendRawTransaction`)
- [x] Submit is optional — documented that clients can submit directly
- [x] Simulation is opt-in (`simulate: true/false`, default `false`)
- [x] When `simulate=true`: returns `success`, `computeUnits`, `error`, `logs`

🟡 **IMPORTANT — `fee` always `null`:** `tx-preview.ts:84` hardcodes `fee: null` with comment "Fee estimation requires commitment level". The migration plan says preview includes "fee estimate".

🟡 **IMPORTANT — No balance changes or description in preview:** The migration plan says simulation preview includes "description, programs, balance changes, fee estimate". The current implementation only returns `success`, `computeUnits`, `fee` (null), `error`, and `logs`.

🟡 **IMPORTANT — No confirmation after submit:** Submit returns `{ signature, status: "submitted" }` immediately. It never waits for or polls confirmation. The response schema declares `status: z.enum(["submitted", "confirmed", "failed"])` but only "submitted" is ever returned. For MCP agents this means they don't know if the tx landed.

---

## 5. Safety Guards

🔴 **CRITICAL — `guardProgramWhitelist` is defined but NEVER CALLED.** The function exists in `guards.ts:104-114` with a whitelist of 18 known programs, but it is not imported or invoked anywhere in `tx-builder.ts` or `routes/tx.ts`. This means a compromised SDK can inject calls to arbitrary programs and they will be passed through to the client unsigned.

**Fix:** In `tx-builder.ts`, after `serializeResult(result)`, call `guardProgramWhitelist(serialized.instructions)` before returning.

🔴 **CRITICAL — No stablecoin-only guard.** The checklist requires "rejects opportunities without USDC/USDT/USDS in tokens" but no such guard exists. Any opportunity with any token (including volatile assets) can have transactions built. This is important for MCP agent safety — agents should not accidentally build txs for non-stablecoin pools.

**Fix:** Add `guardStablecoinOnly(opp: OpportunityDetail)` that checks `opp.tokens` contains at least one of USDC/USDT/USDS. Call it in `tx-builder.ts` pre-build guards. Make it configurable via env var (`STABLECOIN_ONLY=true`) so it can be relaxed later.

🔴 **CRITICAL — No category blocklist.** The checklist says "multiply blocked (or configurable)" but no such restriction exists. Any category including `multiply` (which involves flash loans and leverage) can be built through the API. For MCP agents this is a risk — an agent could open a leveraged position.

**Fix:** Add `BLOCKED_CATEGORIES` env var (default: `"multiply"`) and a `guardCategoryAllowed(opp)` check.

- [x] Per-tx limit: `guardDepositLimit` checks `MAX_DEPOSIT_USD` env var
- [ ] Program verification: **defined but not wired** (see 🔴 above)
- [x] Guards run BEFORE building instructions (wallet valid + deposit limit are pre-build)

🟡 **IMPORTANT — Env var name mismatch.** The migration plan references `MCP_MAX_DEPOSIT_USD` but the implementation uses `MAX_DEPOSIT_USD`. Should be consistent.

---

## 6. API Key Auth

- [x] All `/api/manage/*` routes require API key (`managePlugin` adds `authHook` as `preHandler`)
- [x] Key hashed with SHA-256, compared against DB (`shared/auth.ts:27`)
- [x] Missing/invalid key returns 401
- [ ] Rate limiting per key: **NOT IMPLEMENTED** (see 🔴 below)

🔴 **CRITICAL — Rate limiting is per-route globally, not per API key.** The `rate_limit` column on `api_keys` table (`db/schema.ts:19`) is never read or enforced. The route-level rate limits (10 req/min build, 20 req/min submit via Fastify config) apply to ALL clients combined, not per key. A single key holder can exhaust the entire rate limit for all users.

**Fix:** Read the `rate_limit` column from the auth query and apply per-key rate limiting (e.g., track request counts in memory per `apiKeyName`).

🟡 **IMPORTANT — Auth disabled by default.** `shared/auth.ts:19` skips all auth when `MANAGE_AUTH_REQUIRED !== "true"`. This is fine for dev but should be documented clearly, and production deployments MUST set `MANAGE_AUTH_REQUIRED=true`.

---

## 7. Error Handling

- [x] SDK errors surfaced clearly (out of liquidity, insufficient balance, cooldown messages)
- [x] Protocol API failures handled gracefully (Jupiter price fetch, CDN resources, KSwap routing)
- [x] Invalid `opportunity_id` returns 404 (via `guardOpportunityActive`)
- [x] Invalid `wallet_address` returns 400 (via Zod schema + `guardWalletValid`)
- [x] `GuardError.statusCode` properly propagated via shared `errorHandler` (`shared/error-handler.ts:29-32`)

**Error handling is solid.** The shared Fastify error handler correctly maps `statusCode` from thrown errors to HTTP response codes.

---

## Summary

| Severity | Count | Items |
|----------|-------|-------|
| 🔴 CRITICAL | 4 | Program whitelist not wired, no stablecoin guard, no category blocklist, rate limiting not per-key |
| 🟡 IMPORTANT | 4 | Simulation preview incomplete (fee/balance changes), no tx confirmation, auth disabled by default, env var name mismatch |
| 🟢 MINOR | 2 | No serialization round-trip test, submit only returns "submitted" |

### 🔴 CRITICAL — Must fix before shipping

1. **Wire `guardProgramWhitelist`** — call it on serialized instructions in `tx-builder.ts` before returning. Without this, the post-build safety net is entirely bypassed.

2. **Add stablecoin-only guard** — `guardStablecoinOnly(opp)` checking `opp.tokens` for USDC/USDT/USDS. Configurable via `STABLECOIN_ONLY` env var.

3. **Add category blocklist** — `guardCategoryAllowed(opp)` blocking `multiply` by default. Configurable via `BLOCKED_CATEGORIES` env var.

4. **Per-key rate limiting** — use the `rate_limit` column from `api_keys` to enforce per-key limits. The current global route limits don't prevent a single key from monopolizing the endpoint.

### 🟡 IMPORTANT — Should fix before production

5. **Simulation preview** — add fee estimation (use `getFeeForMessage` or estimate from compute units), and optionally balance change simulation for richer previews.

6. **Transaction confirmation** — add optional confirmation polling after submit (with timeout). At minimum, document that "submitted" != "confirmed" so MCP agents know to poll themselves.

7. **Document auth requirement** — clearly document that `MANAGE_AUTH_REQUIRED=true` must be set in production. Consider making auth enabled by default and adding a `MANAGE_AUTH_DISABLED=true` escape hatch for dev instead.

8. **Env var name** — unify to `MCP_MAX_DEPOSIT_USD` per migration plan, or update the migration plan to reflect `MAX_DEPOSIT_USD`.

### 🟢 MINOR — Nice to have

9. **Serialization round-trip test** — add a unit test that serializes an instruction, then deserializes it, and compares with the original.

10. **Submit status accuracy** — consider returning "confirmed" after polling, or remove "confirmed"/"failed" from the `status` enum to avoid implying capabilities that don't exist.

---

### What's working well

- **Module isolation is clean** — Discover read via service interface, no cross-module DB access
- **Protocol adapters are 1:1 ports from frontend** — vault, lending, multiply, insurance fund, earn all match
- **Instruction serialization is correct** — base64 data, proper account roles, LUT and setup tx support
- **Non-custodial design is maintained** — backend never signs, only builds unsigned instructions
- **Error handling is solid** — proper status codes, meaningful error messages, graceful SDK error handling
- **Code structure is clean** — good separation between guards, builder, serializer, preview, and adapters
