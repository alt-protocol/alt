# Add a New Protocol Integration

Add end-to-end support for a new DeFi protocol. The user will provide the protocol name and details.

## Arguments
- `$ARGUMENTS` — protocol name and any relevant details (e.g. "marginfi - lending protocol, uses marginfi SDK")

## Checklist

### 1. Backend Fetcher
**File:** `backend/app/services/<name>_fetcher.py`

Reference `kamino_fetcher.py` for structure. Must implement:
- `fetch_<name>_yields()` — fetch yield opportunities from the protocol's API/SDK
- Parse response into `YieldOpportunity` model fields: `name`, `apy_current`, `tvl_usd`, `tokens`, `category`, `deposit_address`, `product_type`, `extra_data`
- Handle errors gracefully (log and continue, don't crash the cron)
- Use `utils.py` helpers if applicable

### 2. Backend Position Fetcher
**File:** `backend/app/services/<name>_position_fetcher.py`

Reference `kamino_position_fetcher.py`. Must implement:
- `fetch_<name>_positions(wallet_address: str)` — fetch user positions from on-chain data
- Return list of position dicts matching `UserPosition` model fields
- Include `pnl_usd`, `apy`, `deposit_amount_usd`, `initial_deposit_usd` where available

### 3. Register in Backend Cron + Router
**File:** `backend/app/main.py`
- Import the new fetcher
- Add to the APScheduler cron job (runs every 15 min)

**File:** `backend/app/routers/portfolio.py`
- Import position fetcher
- Add to the position aggregation logic

### 4. Frontend Adapter
**File:** `frontend/src/lib/protocols/<name>.ts`

Implement the `ProtocolAdapter` interface from `types.ts`:

```typescript
import type { ProtocolAdapter, BuildTxParams } from "./types";
import { convertLegacyInstruction } from "@/lib/instruction-converter";

export const <name>Adapter: ProtocolAdapter = {
  async buildDepositTx(params: BuildTxParams) {
    // Build deposit instructions using protocol SDK
    // Return { instructions: Instruction[], lookupTableAddresses?: Address[] }
  },

  async buildWithdrawTx(params: BuildTxParams) {
    // Build withdraw instructions using protocol SDK
    // Return { instructions: Instruction[], lookupTableAddresses?: Address[] }
  },
};
```

Key rules:
- Use `convertLegacyInstruction` or `convertJupiterApiInstruction` from `@/lib/instruction-converter.ts` to convert SDK instructions to `@solana/kit` format
- Never use legacy `@solana/web3.js` v1 types in the return — always convert
- Include lookup table addresses if the protocol uses ALTs

### 5. Register Frontend Adapter
**File:** `frontend/src/lib/protocols/index.ts`

Add the new adapter to the registry:
```typescript
import { <name>Adapter } from "./<name>";
// Add to ADAPTERS map
```

### 6. Seed Script Entry
**File:** `scripts/seed_protocols.py`

Add protocol metadata:
```python
{
    "name": "<Protocol Name>",
    "slug": "<name>",
    "website_url": "https://...",
    "icon_url": "https://...",
}
```

### 7. Verification
- Run `alembic upgrade head` (if schema changes needed)
- Run `python scripts/seed_protocols.py` to seed the protocol
- Run `python scripts/refresh_all.py` to test the fetcher
- Run `npm run build` in frontend to verify adapter compiles
- Test deposit/withdraw flow with a devnet/mainnet wallet

### Summary
A complete protocol integration requires exactly 6 files:
1. `backend/app/services/<name>_fetcher.py` — yield data fetcher
2. `backend/app/services/<name>_position_fetcher.py` — position fetcher
3. `backend/app/main.py` — cron registration (edit)
4. `backend/app/routers/portfolio.py` — position aggregation (edit)
5. `frontend/src/lib/protocols/<name>.ts` — transaction adapter
6. `frontend/src/lib/protocols/index.ts` — registry entry (edit)
7. `scripts/seed_protocols.py` — seed data (edit)
