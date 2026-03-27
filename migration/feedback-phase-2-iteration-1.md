# Phase 2 Feedback — Iteration 1

## Overall Assessment

Solid implementation. All 3 position fetchers faithfully port the Python logic including Modified Dietz PnL, IF staking, and Jupiter earn positions. Module isolation is correct. Two important bugs need fixing before Phase 3.

---

## Checklist Results

### 1. Module Isolation ✅

- [x] Monitor only queries its own tables (tracked_wallets, user_positions, user_position_events)
- [x] Cross-module read uses `discoverService.getOpportunityMap()` — NOT direct DB query
- [x] No imports from `discover/db/` or `discover/routes/`
- [x] Only import from Discover is `discover/service.ts` (the service interface)

### 2. Architecture ✅

- [x] Fastify plugin: `monitorPlugin` in `monitor/index.ts`, registered at `/api/monitor`
- [x] Module structure: `db/`, `routes/`, `services/`, `service.ts`, `scheduler.ts`, `index.ts`
- [x] Background fetch: `Promise.allSettled` for parallel protocol fetching
- [x] POST /track returns immediately, status polling works
- [x] Shared `snapshot_at` across all 3 fetchers in scheduler

### 3. Position Fetcher Correctness

**Kamino** (913 lines) ✅:
- [x] Earn vault: shares + PnL from dedicated API, fallback to share_price × token_price
- [x] Obligations: all markets, reserve map (cached 3min), tx history
- [x] Modified Dietz PnL: lifecycle detection, cash flow accumulation, weighted capital
- [x] Recycled obligation detection (collateral token change → PnL reset)
- [x] Forward APY resolution (opp_map → reserve rates → leverage formula)
- [x] Event extraction from obligation txs

**Drift** (442 lines) ✅:
- [x] IF staking: (shares / total_shares) × vault_balance
- [x] Monthly backfill fallback (up to 6 months)
- [x] Vault positions: 1d + 100d windows, dedup by (vault, ts)
- [x] Stale position filtering (> 7 days)

**Jupiter** (386 lines) ⚠️:
- [x] jToken shares + underlying amount via /earn/positions + /earn/earnings
- [x] Token metadata cached 3min, first deposit cached 1h
- [ ] ATA derivation — **BUG** (see issue #1 below)
- [x] batchEarliestSnapshots fallback for opened_at

### 4. Code Quality

- [x] `npm run build` — compiles with zero errors
- [x] No `any` types (zero occurrences)
- [x] Error handling per wallet (one failure doesn't stop others)
- [x] Scheduler overlap protection (`running` flag)
- [x] Proper null handling throughout
- [x] Rate limiting (30/min portfolio, 5/min track, 60/min other)
- [x] Wallet validation (base58 regex)

---

## Issues Found

### 🔴 CRITICAL

**1. Jupiter ATA derivation uses wrong byte encoding**

**File:** `backend-ts/src/monitor/services/jupiter-position-fetcher.ts:42-57`

**Problem:** `getAta()` uses `new TextEncoder().encode(walletAddr)` which produces UTF-8 bytes of the base58 string (44-48 bytes), not the raw 32-byte public key. The derived ATA address is wrong, so `firstDepositTs()` queries the wrong account and always returns null.

**Python equivalent:**
```python
Pubkey.find_program_address(
    [bytes(Pubkey.from_string(wallet)), bytes(Pubkey.from_string(TOKEN_PROGRAM)), bytes(Pubkey.from_string(mint))],
    Pubkey.from_string(ATA_PROGRAM),
)
```
Python converts base58 → 32-byte raw public key via `bytes(Pubkey.from_string(...))`.

**Fix:** Use `getAddressEncoder()` from `@solana/addresses` to convert Address → Uint8Array(32):

```typescript
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/addresses";

const addressEncoder = getAddressEncoder();

async function getAta(wallet: string, mint: string): Promise<string> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds: [
      addressEncoder.encode(address(wallet)),
      addressEncoder.encode(address(TOKEN_PROGRAM)),
      addressEncoder.encode(address(mint)),
    ],
  });
  return pda;
}
```

If `getAddressEncoder` isn't available in your version, use `@solana/codecs-strings`:
```typescript
import { getBase58Decoder } from "@solana/codecs-strings";
const b58 = getBase58Decoder();
// then: b58.decode(wallet) → Uint8Array(32)
```

**Impact:** Without fix, all Jupiter positions have `opened_at: null` and `apy_realized: null`. Positions themselves are correct (fetched from Jupiter API), but PnL timing data is missing.

**Verify:** After fix, `getAta("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", ...)` should match the Python output for the same inputs.

---

### 🟡 IMPORTANT

**2. Dead SQL query in `latestPositions()` — doubles DB work**

**File:** `backend-ts/src/monitor/routes/portfolio.ts:66-80`

**Problem:** Lines 66-80 execute a raw SQL query (`db.execute(sql\`...\`)`) whose result is assigned to `rows` but never used. The actual data comes from the Drizzle ORM query on lines 83-115. Every call to `/positions` or `/track` runs this redundant query.

**Fix:** Delete lines 62-80 (the `conditions` array and the raw SQL `db.execute` call). Keep only the Drizzle subquery approach starting at line 83.

```typescript
async function latestPositions(
  walletAddress: string,
  protocol?: string,
  productType?: string,
) {
  // Start directly with the Drizzle subquery approach (current line 83)
  const latestSub = db
    .select({
      protocol_slug: userPositions.protocol_slug,
      latest_at: sql<Date>`MAX(${userPositions.snapshot_at})`.as("latest_at"),
    })
    // ... rest unchanged
```

**3. Jupiter `snapshotAllWallets` doesn't update `last_fetched_at`**

**File:** `backend-ts/src/monitor/services/jupiter-position-fetcher.ts:334-386`

**Problem:** Kamino and Drift both call `database.update(trackedWallets).set({ last_fetched_at: now })` per wallet in their `snapshotAllWallets` loops. Jupiter's loop doesn't. If Jupiter is the only fetcher that finds positions for a wallet, `last_fetched_at` won't be updated.

**Fix:** Add after `storePositionRows` in the Jupiter loop:
```typescript
await database
  .update(trackedWallets)
  .set({ last_fetched_at: now })
  .where(eq(trackedWallets.id, wallet.id));
```

---

### 🟢 MINOR

**4. Kamino events not collected during background fetch (POST /track)**

**File:** `backend-ts/src/monitor/routes/portfolio.ts:133-157`

`fetchKaminoPositions` doesn't return events (only positions + summary). During POST /track, Drift IF events are stored but Kamino obligation/vault events are not. Events are only stored during scheduled snapshots. This matches Python behavior but is inconsistent within the TS codebase (Drift events stored on-demand, Kamino not).

**5. Position fetchers lack transaction boundaries**

Same pattern as Phase 1 (before fix): `storePositionRows` and `storeEventsBatch` auto-commit each insert. If a wallet snapshot fails midway, partial data persists. Python uses a single `db.commit()` at the end of each fetcher's snapshot loop.

---

## What Passed Review (no changes needed)

- Modified Dietz PnL (lifecycle detection, cash flow accumulation, weighted capital, pnl_pct)
- Recycled obligation detection in Kamino
- Drift IF staking: proportional share computation, monthly backfill
- Drift vault deduplication (1d + 100d windows, stale filter)
- Position dict structure (all fields present, consistent rounding)
- Event deduplication by tx_signature (batch lookup in chunks of 500)
- Shared utilities: computeRealizedApy, computeHeldDays, buildPositionDict, storePositionRows, storeEventsBatch
- Cross-module reads via DiscoverService interface
- Monitor scheduler: unified 15-min job, shared snapshot_at, overlap protection
- Route schemas (Zod validation for all query params)
- History bucketing (date_bin with 1h/4h/12h intervals)

---

## Verdict

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 1 (ATA derivation) |
| 🟡 IMPORTANT | 2 (dead query, missing last_fetched_at) |
| 🟢 MINOR | 2 (events inconsistency, no transactions) |

Fix the critical ATA bug and the 2 important issues before proceeding to Phase 3.
