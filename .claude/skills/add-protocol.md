---
name: add-protocol
description: Scaffold a complete protocol integration across backend fetcher, position fetcher, main.py registrations, frontend adapter, and adapter registry
user_invocable: true
---

# Add Protocol Integration

Scaffold a new protocol integration for Akashi. This creates 4 files and updates 2 registrations.

**Ask the user for:** protocol name, slug, API base URL, description, website URL, audit status, and auditors.

---

## Step 1: Backend yield fetcher

Create `backend/app/services/{slug}_fetcher.py`:

```python
"""Fetch live yield data from {Name} API."""
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.models.base import SessionLocal
from app.models.protocol import Protocol
from app.services.utils import safe_float, get_or_none, upsert_opportunity

logger = logging.getLogger(__name__)

{SLUG}_API = "{api_base_url}"

_float = safe_float


def _get(path: str, client: httpx.Client) -> Optional[dict | list]:
    return get_or_none(f"{{{SLUG}_API}}{{path}}", client, log_label="{Name} API")


def _risk_tier(symbol: str) -> str:
    # TODO: classify tokens by risk
    return "medium"


def fetch_{slug}_yields() -> int:
    """Fetch {Name} yield opportunities. Returns count updated/inserted."""
    logger.info("Starting {Name} yield fetch")
    now = datetime.now(timezone.utc)

    db: Session = SessionLocal()
    try:
        protocol = db.query(Protocol).filter(Protocol.slug == "{slug}").first()
        if not protocol:
            logger.error("Protocol '{slug}' not found in DB — run seed first")
            return 0

        with httpx.Client() as client:
            # TODO: fetch opportunities from API
            raw = _get("/endpoint", client)
            if not isinstance(raw, list):
                logger.error("Unexpected {Name} API response")
                return 0

            count = 0
            for entry in raw:
                external_id = f"{slug}-{{entry.get('id', '')}}"
                opp = upsert_opportunity(
                    db, protocol, external_id,
                    name=f"{Name} — {{entry.get('name', '')}}",
                    category="vault",  # or lending, pool, etc.
                    tokens=[],  # fill from API
                    apy_current=_float(entry.get("apy")),
                    tvl_usd=_float(entry.get("tvl")),
                    deposit_address=entry.get("address"),
                    risk_tier=_risk_tier(""),
                    extra={
                        "source": "{slug}_api",
                        "protocol_url": "{website_url}",
                    },
                    now=now,
                    source="{slug}_api",
                )
                count += 1

        db.commit()
        logger.info("{Name} fetch complete: %d opportunities", count)
        return count

    except Exception as exc:
        db.rollback()
        logger.error("{Name} fetch failed: %s", exc)
        raise
    finally:
        db.close()
```

**Key patterns:**
- Import `safe_float`, `get_or_none`, `upsert_opportunity` from `app.services.utils`
- Alias: `_float = safe_float`
- Private `_get()` wraps `get_or_none` with base URL and log label
- Private `_risk_tier()` classifies tokens
- Main function: `SessionLocal()` in try/finally, load protocol row, `httpx.Client()`, call `upsert_opportunity()`, commit
- Functions ≤ 80 lines — extract helpers with `_` prefix
- Use `extra_data` for protocol-specific fields, never add columns
- Deactivate stale entries with `is_active=False`, never delete

---

## Step 2: Backend position fetcher

Create `backend/app/services/{slug}_position_fetcher.py`:

```python
"""Fetch user positions from {Name} and store snapshots."""
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from app.models.base import SessionLocal
from app.models.user_position import TrackedWallet
from app.models.yield_opportunity import YieldOpportunity
from app.services.utils import safe_float, get_or_none, cached, parse_timestamp, store_position_rows

logger = logging.getLogger(__name__)

{SLUG}_API = "{api_base_url}"

_float = safe_float
_cached = cached
_parse_timestamp = parse_timestamp


def _get(path: str, client: httpx.Client) -> Optional[dict | list]:
    return get_or_none(f"{{{SLUG}_API}}{{path}}", client, log_label="{Name} API")


def _match_opportunity_by_external(external_id: str, db: Session) -> Optional[tuple[int, float | None]]:
    """Find YieldOpportunity by external_id. Returns (id, apy) or None."""
    opp = (
        db.query(YieldOpportunity.id, YieldOpportunity.apy_current)
        .filter(
            YieldOpportunity.external_id == external_id,
            YieldOpportunity.is_active.is_(True),
        )
        .first()
    )
    if opp:
        return opp.id, float(opp.apy_current) if opp.apy_current is not None else None
    return None


def fetch_wallet_positions(wallet_address: str, db: Session) -> dict:
    """Fetch all {Name} positions for a wallet. Returns dict with positions list."""
    now = datetime.now(timezone.utc)

    with httpx.Client() as client:
        # TODO: fetch positions from API
        positions = []

    total_value_usd = sum(_float(p.get("deposit_amount_usd")) or 0 for p in positions)
    total_pnl_usd = sum(_float(p.get("pnl_usd")) or 0 for p in positions if p.get("pnl_usd") is not None)

    return {
        "wallet": wallet_address,
        "positions": positions,
        "events": [],
        "summary": {
            "total_value_usd": total_value_usd,
            "total_pnl_usd": total_pnl_usd,
            "position_count": len(positions),
        },
    }


def snapshot_all_wallets(db: Session, snapshot_at: datetime | None = None) -> int:
    """Iterate all active TrackedWallets, fetch {Name} positions, store snapshots."""
    wallets = (
        db.query(TrackedWallet)
        .filter(TrackedWallet.is_active.is_(True))
        .all()
    )
    if not wallets:
        logger.info("No tracked wallets for {Name} snapshot")
        return 0

    logger.info("Snapshotting {Name} positions for %d wallets", len(wallets))
    now = snapshot_at or datetime.now(timezone.utc)
    total_snapshots = 0

    with httpx.Client() as client:
        for wallet in wallets:
            try:
                result = fetch_wallet_positions(wallet.wallet_address, db)
                total_snapshots += store_position_rows(db, result["positions"], now)
                wallet.last_fetched_at = now
                db.flush()

                logger.info(
                    "{Name} wallet %s: %d positions snapshotted",
                    wallet.wallet_address[:8],
                    len(result["positions"]),
                )
            except Exception as exc:
                logger.error(
                    "Failed to snapshot {Name} wallet %s: %s",
                    wallet.wallet_address[:8],
                    exc,
                )
                continue

    db.commit()
    logger.info("{Name} position snapshot complete: %d total snapshots", total_snapshots)
    return total_snapshots
```

**Key patterns:**
- Must expose: `snapshot_all_wallets(db, snapshot_at) → int` and `fetch_wallet_positions(wallet, db) → dict`
- Import `safe_float, get_or_none, cached, parse_timestamp, store_position_rows` from utils
- Aliases: `_float = safe_float`, `_cached = cached`, `_parse_timestamp = parse_timestamp`
- Private `_get()` wrapper, `_match_opportunity_by_external()` helper
- Position dict must include: `wallet_address`, `protocol_slug`, `product_type`, `external_id`, `opportunity_id`, `deposit_amount`, `deposit_amount_usd`, `pnl_usd`, `pnl_pct`, `initial_deposit_usd`, `opened_at`, `held_days`, `apy`, `is_closed`, `token_symbol`, `extra_data`, `snapshot_at`
- Background jobs own their DB session — `SessionLocal()`, try/finally close

---

## Step 3: Register in `backend/app/main.py`

Three changes needed:

### 3a. Add import and register yield fetcher
```python
from app.services.{slug}_fetcher import fetch_{slug}_yields  # noqa: E402
from app.services.{slug}_position_fetcher import snapshot_all_wallets as snapshot_all_wallets_{slug}  # noqa: E402
```

Add `fetch_{slug}_yields` to the `YIELD_FETCHERS` list.

### 3b. Add to `snapshot_all_positions_job()`
```python
{slug}_count = snapshot_all_wallets_{slug}(db, snapshot_at=now)
```
Update the logger.info call to include the new count.

### 3c. Add seed protocol entry
Add to `SEED_PROTOCOLS` list:
```python
{
    "slug": "{slug}",
    "name": "{Name}",
    "description": "{description}",
    "website_url": "{website_url}",
    "audit_status": "{audit_status}",
    "auditors": {auditors},
    "integration": "full",
},
```

---

## Step 4: Frontend adapter

Create `frontend/src/lib/protocols/{slug}.ts`:

```typescript
import type { Instruction } from "@solana/kit";
import type { ProtocolAdapter, BuildTxParams, BuildTxResult } from "./types";
import { HELIUS_RPC_URL } from "../constants";

// If the protocol SDK uses legacy @solana/web3.js:
import { convertLegacyInstruction as convertIx } from "../instruction-converter";

async function buildDeposit(params: BuildTxParams): Promise<Instruction[]> {
  // TODO: load protocol SDK, build deposit instructions
  // Use convertIx() to convert legacy web3.js instructions to @solana/kit format
  throw new Error("{Name} deposit not yet implemented");
}

async function buildWithdraw(params: BuildTxParams): Promise<Instruction[]> {
  // TODO: load protocol SDK, build withdraw instructions
  throw new Error("{Name} withdraw not yet implemented");
}

export const {slug}Adapter: ProtocolAdapter = {
  async buildDepositTx(params) {
    return buildDeposit(params);
  },

  async buildWithdrawTx(params) {
    return buildWithdraw(params);
  },

  // Optional: protocol-specific balance fetching (e.g. vault shares → USD)
  // async getBalance({ walletAddress, depositAddress, category }) {
  //   return null;
  // },
};
```

**Key patterns:**
- Implement `ProtocolAdapter` from `./types`
- `buildDepositTx` and `buildWithdrawTx` return `Promise<BuildTxResult>` (either `Instruction[]` or `BuildTxResultWithLookups`)
- Optional `getBalance` method for protocol-specific balance fetching (e.g. vault share → USD conversion)
- Use `convertLegacyInstruction` from `../instruction-converter` if SDK uses legacy web3.js
- Dynamic import SDKs to avoid bundling at compile time
- Export as `{slug}Adapter`
- Never sign or submit — only build instructions (non-custodial constraint)
- Category-specific UI is handled by the category registry — no UI changes needed when adding a protocol to an existing category

---

## Step 5: Register frontend adapter

Edit `frontend/src/lib/protocols/index.ts`:

### 5a. Add slug to SUPPORTED_ADAPTERS
```typescript
const SUPPORTED_ADAPTERS = new Set(["kamino", "jupiter", "drift", "{slug}"]);
```

### 5b. Add lazy-load block in `getAdapter()`
```typescript
if (key === "{slug}") {
  const { {slug}Adapter } = await import("./{slug}");
  adapterCache.set(key, {slug}Adapter);
  return {slug}Adapter;
}
```

---

## Step 6: Verify category compatibility

Ensure the protocol's yield categories are already registered in the category registry (`frontend/src/lib/categories/`). If the protocol introduces a new category, run the `add-category` skill first.

---

## Step 7: Verify

1. **Backend health check:** `curl http://localhost:8000/api/health` → `{"status":"ok"}`
2. **Frontend build:** `cd frontend && npm run build` → no errors
3. **Manual fetcher test:** `cd backend && python -c "from app.services.{slug}_fetcher import fetch_{slug}_yields; fetch_{slug}_yields()"`
4. Update the protocol table in root `CLAUDE.md` (Protocol Integrations section)

---

## Checklist

- [ ] `backend/app/services/{slug}_fetcher.py` — yield fetcher
- [ ] `backend/app/services/{slug}_position_fetcher.py` — position fetcher
- [ ] `backend/app/main.py` — import, YIELD_FETCHERS, snapshot_all_positions_job, SEED_PROTOCOLS
- [ ] `frontend/src/lib/protocols/{slug}.ts` — adapter
- [ ] `frontend/src/lib/protocols/index.ts` — SUPPORTED_ADAPTERS + getAdapter()
- [ ] Health check passes
- [ ] Frontend builds
