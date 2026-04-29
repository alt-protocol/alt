---
name: integrate-protocol
description: Complete protocol integration guide across Discover (yield fetcher), Monitor (position fetcher), Manage (tx adapter), and Frontend (category, logos, columns). Covers architecture, interfaces, data flow, testing, and common pitfalls.
user_invocable: true
---

# Integrate Protocol

Full-depth guide for integrating a new DeFi protocol into Akashi. Covers ALL backend modules, frontend registry, and verification.

> **Architecture:** Modular monolith — one Fastify process, 3 backend modules (Discover, Manage, Monitor). Frontend: Next.js App Router with category registry. Each protocol needs 3 backend files + registration points + frontend wiring.

**Ask the user for:**
- Protocol name, slug, API base URL
- Description, website URL, audit status, auditors
- Which product types / categories (lending, earn, multiply, vault, earn_vault, insurance_fund)
- Does it need a custom action panel? A new category?
- Data source: REST API, SDK, or on-chain RPC?

---

## Prerequisite: Read Reference Implementation

**Before writing any code, read ONE existing implementation as reference.** Pick the closest match:

| If the new protocol is... | Read this reference |
|---------------------------|---------------------|
| REST API-based, simple yields | `backend/src/discover/services/exponent-fetcher.ts` |
| REST API + on-chain data, complex categories | `backend/src/discover/services/kamino-fetcher.ts` (first 80 lines for structure, then grep) |
| Simple SDK adapter (no leverage) | `backend/src/manage/protocols/exponent.ts` |
| Complex adapter (leverage, setup txs) | `backend/src/manage/protocols/kamino.ts` |
| Token-balance position detection | `backend/src/monitor/services/exponent-position-fetcher.ts` |
| API-based positions with events/PnL | `backend/src/monitor/services/kamino-position-fetcher.ts` |

**Also read first:** `backend/CLAUDE.md` and `frontend/CLAUDE.md`.

---

## Phase 1: Backend — Discover Module (Yield Fetcher)

### 1.1 Create the fetcher

**File:** `backend/src/discover/services/{slug}-fetcher.ts`

**Required imports (exact paths — do NOT recreate these):**

```typescript
import { getOrNull } from "../../shared/http.js";              // GET → data | null
import { getWithRetry } from "../../shared/http.js";           // GET → data | throws
import { logger } from "../../shared/logger.js";
import { db } from "../db/connection.js";
import {
  safeFloat,              // parse any value → number | null
  upsertOpportunity,      // idempotent opportunity + snapshot insert
  deactivateStale,        // set is_active=false for missing external_ids
  getProtocol,            // look up { id, name } by slug
  batchSnapshotAvg,       // precompute 7d/30d APY averages (batch)
  tokenType,              // "stablecoin" | "lst" | "volatile" | "yield_bearing_stable"
  buildUnderlyingTokens,  // auto-build UnderlyingToken[] from category+tokens+extra
  deriveAssetClass,       // auto-derive asset_class from tokens
} from "./utils.js";
// Optional:
// import { classifyMultiplyPair } from "./utils.js";  // for multiply: vault_tag
// import { cachedAsync } from "../../shared/utils.js"; // cache API responses
```

**Required export:**

```typescript
export async function fetch{Name}Yields(): Promise<number>
```

Returns count of opportunities upserted. Import `db` directly — no parameter needed.

### 1.2 Fetcher structure

```typescript
export async function fetch{Name}Yields(): Promise<number> {
  // 1. Look up protocol (must be seeded first)
  const protocol = await getProtocol(db, "{slug}");
  if (!protocol) { logger.warn("{slug} not seeded"); return 0; }

  // 2. Fetch API data
  const data = await getOrNull("{API_URL}");
  if (!data) { logger.warn("{slug} API returned null"); return 0; }

  // 3. Pre-compute 7d/30d averages (optional, for batch efficiency)
  const now = new Date();
  const avgs = await batchSnapshotAvg(db, protocol.id, "{category}");

  // 4. Track active IDs for stale detection
  const activeIds = new Set<string>();
  let count = 0;

  // 5. Loop: filter → transform → upsert
  for (const item of data) {
    if (shouldSkip(item)) continue;

    const extId = `{slug}-{type}-${item.uniqueKey}`;
    activeIds.add(extId);
    const itemAvgs = avgs[extId];

    await upsertOpportunity(db, {
      protocolId: protocol.id,
      protocolName: protocol.name,
      externalId: extId,
      name: "...",
      category: "{category}",
      tokens: [symbol],
      apyCurrent: apy,           // percentage scale: 5.5 means 5.5%
      apy7dAvg: itemAvgs?.["7d"] ?? null,
      apy30dAvg: itemAvgs?.["30d"] ?? null,
      tvlUsd: tvl,
      depositAddress: onChainAddress,
      riskTier: "low",
      extra: { /* protocol-specific JSONB */ },
      now,
      source: "{slug}_api",
      underlyingTokens: [{ symbol, mint, role: "underlying", type: tokenType(symbol) }],
    });
    count++;
  }

  // 6. Deactivate stale (pattern must match extId prefix)
  await deactivateStale(db, "{slug}-{type}-%", activeIds);

  logger.info({ count }, "{Name} fetch complete");
  return count;
}
```

### 1.3 upsertOpportunity field reference

| Field | Type | Notes |
|-------|------|-------|
| `externalId` | string | Globally unique: `{slug}-{type}-{key}`. Used by `deactivateStale` LIKE pattern. |
| `apyCurrent` | number \| null | **Percentage scale**: 5.5 = 5.5%. If API returns decimal (0.055), multiply by 100. |
| `tvlUsd` | number \| null | Total value locked in USD. |
| `tokens` | string[] | Primary token symbols. Multiply: `[collateral, debt]`. |
| `depositAddress` | string | On-chain address the user deposits to. Used by Manage adapter. |
| `extra` | Record | Protocol-specific JSONB. Include mints, rates, addresses — anything adapter/frontend needs. |
| `underlyingTokens` | UnderlyingToken[] | Token exposure. Role: "underlying", "collateral", "debt", "pool_a". |
| `assetClass` | string \| undefined | "stablecoin", "sol", "btc", "eth", "other". Omit to auto-derive from tokens. |
| `source` | string | Snapshot source tag (e.g. "{slug}_api"). |

### 1.4 Register in scheduler

**Edit:** `backend/src/discover/scheduler.ts`

1. Add import: `import { fetch{Name}Yields } from "./services/{slug}-fetcher.js";`
2. Add to `FETCHERS` array: `{ name: "{slug}", fn: fetch{Name}Yields },`

### 1.5 Seed protocol

**Edit:** `backend/src/discover/index.ts` — add to `SEED_PROTOCOLS` array:

```typescript
{
  slug: "{slug}",
  name: "{Name}",
  description: "...",
  website_url: "https://...",
  audit_status: "audited",   // or "unaudited"
  auditors: ["..."],          // empty [] if unaudited
  integration: "full",        // "full" or "data_only"
},
```

---

## Phase 2: Backend — Manage Module (Protocol Adapter)

### 2.1 Create the adapter

**File:** `backend/src/manage/protocols/{slug}.ts`

**Required imports:**

```typescript
import type { Instruction } from "@solana/kit";
import type {
  ProtocolAdapter, BuildTxParams, BuildTxResult,
  GetBalanceParams, WithdrawState,
  PriceImpactParams, PriceImpactEstimate,
} from "./types.js";
import { convertLegacyInstruction } from "../services/instruction-converter.js";
import { getLegacyConnection } from "../../shared/rpc.js";
import { resolveDecimals } from "../services/decimals.js";
import { logger } from "../../shared/logger.js";
```

**Required export:**

```typescript
export const {slug}Adapter: ProtocolAdapter = {
  async buildDepositTx(params: BuildTxParams): Promise<BuildTxResult> { ... },
  async buildWithdrawTx(params: BuildTxParams): Promise<BuildTxResult> { ... },
  // Optional methods:
  // async getBalance(params: GetBalanceParams): Promise<number | null> { ... },
  // async getWithdrawState(params: GetBalanceParams): Promise<WithdrawState> { ... },
  // async getPriceImpact(params: PriceImpactParams): Promise<PriceImpactEstimate | null> { ... },
};
```

### 2.2 BuildTxParams fields

| Field | Type | Source |
|-------|------|--------|
| `walletAddress` | string | User's Solana wallet (base58) |
| `depositAddress` | string | Opportunity's `deposit_address` column |
| `amount` | string | Human-readable (e.g. "100.5") — adapter converts to lamports |
| `category` | string | Opportunity's category slug |
| `extraData` | Record | Merged: opportunity's `extra_data` + client overrides (mints, addresses, etc.) |

### 2.3 Return types

- **Simple:** `Instruction[]` — single transaction
- **With lookups:** `{ instructions, lookupTableAddresses }` — needs address lookup tables
- **With setup:** `{ instructions, lookupTableAddresses, setupInstructionSets? }` — needs setup txs first (e.g. user LUT creation)

### 2.4 Key patterns

**Lazy SDK loading** (avoid slowing startup):
```typescript
let _sdk: typeof import("@protocol/sdk") | undefined;
async function loadSdk() {
  if (!_sdk) _sdk = await import("@protocol/sdk");
  return _sdk;
}
```

**Instruction conversion** (most SDKs return legacy `@solana/web3.js` TransactionInstruction):
```typescript
import { convertLegacyInstruction } from "../services/instruction-converter.js";
const kitIx: Instruction = convertLegacyInstruction(legacyIx);
```

**Amount conversion** (human-readable → lamports):
```typescript
const decimals = await resolveDecimals(params.extraData, mintAddress);
const lamports = Math.floor(parseFloat(params.amount) * 10 ** decimals);
```

### 2.5 NON-CUSTODIAL rule

**NEVER** handle private keys, sign transactions, or import keypairs. Return unsigned instructions only. The client wallet signs and submits.

### 2.6 Register the adapter

**Edit:** `backend/src/manage/protocols/index.ts`

1. Add slug to `SUPPORTED_ADAPTERS` set
2. Add dynamic import branch:
```typescript
if (key === "{slug}") {
  const { {slug}Adapter } = await import("./{slug}.js");
  adapterCache.set(key, {slug}Adapter);
  return {slug}Adapter;
}
```

---

## Phase 3: Backend — Monitor Module (Position Fetcher)

### 3.1 Create the position fetcher

**File:** `backend/src/monitor/services/{slug}-position-fetcher.ts`

**Required imports:**

```typescript
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import { userPositions, trackedWallets } from "../db/schema.js";
import { getOrNull } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { safeFloat } from "../../shared/utils.js";
import type { UnderlyingToken } from "../../shared/types.js";
import {
  buildPositionDict,
  computeHeldDays,
  computeRealizedApy,
  storePositionRows,
  storeEventsBatch,
  loadOpportunityMap,
  batchEarliestSnapshots,
  batchEarliestDeposits,
  batchEventNetInvested,
  type PositionDict,
  type EventDict,
} from "./utils.js";
```

### 3.2 Required exports

```typescript
export async function snapshotAllWallets(
  database: NodePgDatabase,
  snapshotAt: Date,
): Promise<number>

export async function fetchWalletPositions(
  walletAddress: string,
): Promise<{ positions: PositionDict[]; events: EventDict[] }>
```

### 3.3 snapshotAllWallets pattern

```typescript
export async function snapshotAllWallets(database, snapshotAt) {
  // 1. Load tracked wallets
  const wallets = await database.select().from(trackedWallets)
    .where(eq(trackedWallets.is_active, true));
  if (wallets.length === 0) return 0;

  const now = snapshotAt ?? new Date();

  // 2. Load opportunity map (cross-module read via service)
  const oppMap = await loadOpportunityMap();
  // Filter to this protocol: oppMap entries keyed by external_id starting with "{slug}-"

  // 3. Per-wallet: fetch, detect closures, store
  let totalSnapshots = 0;
  for (const wallet of wallets) {
    try {
      const positions = await fetchPositionsForWallet(wallet.wallet_address, now, oppMap);

      // Detect closures: DB open positions not in fresh fetch → mark closed
      // Guard: if fresh fetch returns 0 but DB has many, likely RPC failure — skip

      if (positions.length > 0) {
        totalSnapshots += await storePositionRows(database, positions, now);
      }
    } catch (err) {
      logger.error({ err, wallet: wallet.wallet_address.slice(0, 8) }, "{slug} position error");
    }
  }
  return totalSnapshots;
}
```

### 3.4 Building PositionDict

Use `buildPositionDict()` for every position:

```typescript
const pos = buildPositionDict({
  wallet_address: walletAddress,
  protocol_slug: "{slug}",
  product_type: "{category}",                // must match discover category slug
  external_id: `{slug}-{type}-${uniqueKey}`, // must match discover external_id exactly
  snapshot_at: now,
  opportunity_id: oppMap[extId]?.id ?? null,  // links to discover.yield_opportunities
  deposit_amount: tokenAmount,
  deposit_amount_usd: usdValue,
  pnl_usd: currentValue - netInvested,
  pnl_pct: ((currentValue - netInvested) / netInvested) * 100,
  initial_deposit_usd: firstDeposit,          // from batchEarliestDeposits
  opened_at: firstSeen,                       // from batchEarliestSnapshots
  held_days: computeHeldDays(firstSeen, now),
  apy: currentApy,                            // from opportunity map
  token_symbol: symbol,
  extra_data: { /* protocol-specific position data */ },
  underlying_tokens: [{ symbol, mint, role: "underlying", type: "stablecoin" }],
});
```

### 3.5 PnL calculation

Use **Net Invested** method:
```
PnL ($) = current_value_usd - net_invested_usd
PnL (%) = (PnL / net_invested) * 100
net_invested = sum(deposits) - sum(withdrawals)   // from events
```
Fallback: if no events, use earliest snapshot's `deposit_amount_usd` as initial deposit.

`apy_realized` is auto-computed by `buildPositionDict()` from `pnl_pct` and `held_days`.

### 3.6 Events (for PnL accuracy)

If the protocol provides transaction history, emit events via `storeEventsBatch()`:

```typescript
const events: EventDict[] = [{
  wallet_address: walletAddress,
  protocol_slug: "{slug}",
  product_type: "{category}",
  external_id: extId,
  event_type: "deposit",  // "deposit" | "withdraw" | "borrow" | "repay" | "claim"
  amount: tokenAmount,
  amount_usd: usdValue,
  tx_signature: txSig,    // unique — deduplicates by this
  event_at: new Date(timestamp),
  extra_data: null,
}];
await storeEventsBatch(database, events);
```

### 3.7 Register in scheduler

**Edit:** `backend/src/monitor/scheduler.ts`

1. Import: `import { snapshotAllWallets as snapshot{Name} } from "./services/{slug}-position-fetcher.js";`
2. Add call in `snapshotAllPositionsJob()`: `const {slug}Count = await snapshot{Name}(db, now);`
3. Add `{slug}Count` to the logger.info call

---

## Phase 4: Frontend — Category Definition (if new category)

Skip if the protocol reuses an existing category (lending, earn, multiply, vault, earn_vault, insurance_fund).

### 4.1 Create definition

**File:** `frontend/src/lib/categories/definitions/{slug}.ts`

This is a pure `.ts` file (no JSX). Reference: `definitions/earn.ts` (simple) or `definitions/multiply.ts` (complex).

Key `CategoryDefinition` fields:
- `slug` — matches DB `category` column
- `displayName` — human-readable
- `sidebarLabel` — uppercase short label for portfolio sidebar
- `statsGrid(y)` — returns `StatItem[]` for detail page header
- `detailFields(y)` — returns `DetailFieldDef[]` for detail section
- `actionPanelType` — `"deposit-withdraw"` (default) or `"custom"`
- `transactionType` — `"simple"` or `"multi-step"` (if setup txs needed)
- Optional: `titleFormatter`, `titleBadge`, `uncappedLiquidity`, `strategyDescription`, `chartReferenceLines`

### 4.2 Register

**Edit:** `frontend/src/lib/categories/index.ts`

```typescript
import { {camelName}Category } from "./definitions/{slug}";
registerCategory({camelName}Category);
```

### 4.3 Position table columns

**Edit:** `frontend/src/components/PositionTable.tsx`

Add cases to both `getColumnsForType()` and `getCardFields()` for the new slug. Follow existing patterns (Name, Token, Net Value, APY, PnL, Days Held).

---

## Phase 5: Frontend — Extra Data Types (if protocol-specific fields)

If the protocol has `extra_data` fields the frontend needs to read:

**Edit:** `frontend/src/lib/categories/extra-data.ts`

```typescript
export interface {Name}ExtraData {
  field_name: type;
}

export function get{Name}Extra(
  raw: Record<string, unknown> | null | undefined,
): {Name}ExtraData {
  const r = raw ?? {};
  return {
    field_name: (r.field_name as type) ?? defaultValue,
  };
}
```

**Rule:** Never cast `extra_data` inline in components — always use typed extractors.

---

## Phase 6: Frontend — Protocol Logo

1. Place SVG/PNG at: `frontend/public/logos/{slug}.svg`
2. **Edit** `frontend/src/components/ProtocolChip.tsx` — add to `LOCAL_LOGOS`:
   ```typescript
   {slug}: "/logos/{slug}.svg",
   ```

---

## Phase 7: Frontend — Custom Action Panel (if needed)

Only if category has `actionPanelType: "custom"`.

**File:** `frontend/src/components/{Name}Panel.tsx`

Props interface: `{ yield_: YieldOpportunityDetail; protocolSlug: string }`

Set in category definition:
```typescript
actionPanelComponent: () => import("@/components/{Name}Panel"),
```

The consuming component (`CategoryDetailView`) lazy-loads it with `{ ssr: false }`.

---

## Phase 8: Testing

### 8.1 Discover fetcher unit test

**File:** `backend/src/discover/__tests__/{slug}-fetcher.unit.test.ts`

**Reference:** `exponent-fetcher.unit.test.ts`

Mock pattern:
```typescript
const mockGetOrNull = vi.fn();
vi.mock("../../shared/http.js", () => ({ getOrNull: (...a: any[]) => mockGetOrNull(...a) }));

const mockUpsert = vi.fn().mockResolvedValue({ id: 1 });
const mockDeactivate = vi.fn().mockResolvedValue(0);
const mockGetProtocol = vi.fn();
vi.mock("../services/utils.js", () => ({
  upsertOpportunity: (...a: any[]) => mockUpsert(...a),
  deactivateStale: (...a: any[]) => mockDeactivate(...a),
  getProtocol: (...a: any[]) => mockGetProtocol(...a),
  batchSnapshotAvg: vi.fn().mockResolvedValue({}),
  safeFloat: (v: unknown) => (v != null ? Number(v) : null),
  tokenType: () => "stablecoin",
}));
vi.mock("../db/connection.js", () => ({ db: {} }));
```

Test cases: protocol not seeded, empty API response, filtered items, successful upsert count, deactivation calls.

### 8.2 Monitor position fetcher unit test

**File:** `backend/src/monitor/__tests__/{slug}-position.unit.test.ts`

**Reference:** `exponent-position.unit.test.ts`

### 8.3 Run test suites

```bash
cd backend && npm run test:unit   # all backend unit tests
cd frontend && npm run lint        # frontend lint
```

---

## Verification Checklist

### Backend
- [ ] `discover/services/{slug}-fetcher.ts` created
- [ ] `discover/scheduler.ts` — registered in FETCHERS
- [ ] `discover/index.ts` — seed entry in SEED_PROTOCOLS
- [ ] `manage/protocols/{slug}.ts` created
- [ ] `manage/protocols/index.ts` — SUPPORTED_ADAPTERS + dynamic import
- [ ] `monitor/services/{slug}-position-fetcher.ts` created
- [ ] `monitor/scheduler.ts` — registered
- [ ] `discover/__tests__/{slug}-fetcher.unit.test.ts` passes
- [ ] `monitor/__tests__/{slug}-position.unit.test.ts` passes
- [ ] `cd backend && npm run test:unit` — all pass
- [ ] `curl http://localhost:8001/api/health` — OK

### Frontend
- [ ] `lib/categories/definitions/{slug}.ts` (if new category)
- [ ] `lib/categories/index.ts` — registered (if new category)
- [ ] `lib/categories/extra-data.ts` — typed extractor (if extra_data fields)
- [ ] `components/PositionTable.tsx` — columns added (if new category)
- [ ] `public/logos/{slug}.svg` — logo file
- [ ] `components/ProtocolChip.tsx` — LOCAL_LOGOS entry
- [ ] `components/{Name}Panel.tsx` (if custom action panel)
- [ ] `cd frontend && npm run lint` — passes

### Functional
- [ ] Fetcher populates yield_opportunities (check `/api/discover/yields`)
- [ ] Yields appear in Discover page with correct APY, TVL, category filter
- [ ] Position snapshot works for tracked wallets
- [ ] Positions appear in Portfolio with Net Value, PnL, APY
- [ ] Deposit/withdraw builds unsigned transaction
- [ ] Protocol logo renders in ProtocolChip

---

## Common Pitfalls

1. **APY scale mismatch.** Protocol APIs often return decimals (0.055 = 5.5%). Akashi stores percentages (5.5). Multiply by 100 at upsert time.

2. **external_id inconsistency.** Must be globally unique with protocol prefix. `deactivateStale` uses SQL LIKE (e.g. `{slug}-pt-%`). If the prefix doesn't match your upserted IDs, stale detection breaks.

3. **Amount units.** `BuildTxParams.amount` is human-readable ("100.5"). Convert to lamports via `resolveDecimals()`. If the SDK expects lamports, multiply. If it expects human-readable, pass through.

4. **Cross-module external_id mismatch.** Monitor's position `external_id` must match Discover's `external_id` exactly, or the `opportunity_id` link will be null (positions won't link to yields in the UI).

5. **Closed position false positives.** If the fresh fetch returns 0 positions but DB has many, it's likely an RPC/API failure, not mass withdrawal. Guard against marking all positions as closed.

6. **Instruction conversion.** Most SDKs return legacy `TransactionInstruction` from `@solana/web3.js`. You MUST convert to `@solana/kit` `Instruction` using `convertLegacyInstruction()`. Skipping this crashes the tx-assembler.

7. **Unknown tokens.** If the protocol uses tokens not in `KNOWN_TOKEN_MINTS` (`backend/src/shared/constants.ts`), add them. Otherwise `tokenType()` returns "volatile" for stablecoins, breaking asset_class derivation.

8. **extra_data field naming.** Frontend reads `extra_data` via typed extractors. Keep field names consistent between what the fetcher stores and what the extractor expects. If naming doesn't match, the frontend silently gets null/defaults.
