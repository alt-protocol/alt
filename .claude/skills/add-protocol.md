---
name: add-protocol
description: Scaffold a complete protocol integration across Discover (yield fetcher), Monitor (position fetcher), and Manage (tx adapter)
user_invocable: true
---

# Add Protocol Integration

Scaffold a new protocol integration for Akashi. Creates files across 3 backend modules + registrations.

> **Architecture:** The backend is a modular monolith with 3 modules: Discover (yield data), Manage (tx building), Monitor (positions).

**Ask the user for:** protocol name, slug, API base URL, description, website URL, audit status, and auditors.

---

## For Node.js backend (`backend/`)

### Step 1: Discover — yield fetcher

Create `backend/src/discover/services/{slug}-fetcher.ts`:

```typescript
import { fetchWithRetry, fetchOrNull } from './utils';
import { upsertOpportunity } from './utils';
import type { DrizzleDB } from '../db/connection';

const API_BASE = '{api_base_url}';

export async function fetch{Name}Yields(db: DrizzleDB): Promise<number> {
  // Fetch yield data from protocol API
  // Use upsertOpportunity() to create/update in discover schema
  // Return count of opportunities updated
  return 0;
}
```

Register in `backend/src/discover/scheduler.ts`.

### Step 2: Monitor — position fetcher

Create `backend/src/monitor/services/{slug}-position-fetcher.ts`:

```typescript
import type { DrizzleDB } from '../db/connection';

export async function snapshotAllWallets(db: DrizzleDB, snapshotAt: Date): Promise<number> {
  // Fetch positions for all tracked wallets
  // Store via storePositionRows()
  return 0;
}

export async function fetchWalletPositions(wallet: string, db: DrizzleDB) {
  // Fetch positions for a single wallet
  return { positions: [], events: [] };
}
```

Register in `backend/src/monitor/scheduler.ts`.

### Step 3: Manage — protocol adapter

Create `backend/src/manage/protocols/{slug}.ts`:

```typescript
import type { ProtocolAdapter, BuildTxParams, SerializableInstruction } from './types';

export const {slug}Adapter: ProtocolAdapter = {
  async buildDepositInstructions(params: BuildTxParams): Promise<SerializableInstruction[]> {
    // Build unsigned deposit instructions using protocol SDK
    // Return JSON-serializable instruction format
    throw new Error('{Name} deposit not yet implemented');
  },

  async buildWithdrawInstructions(params: BuildTxParams): Promise<SerializableInstruction[]> {
    throw new Error('{Name} withdraw not yet implemented');
  },
};
```

Register in `backend/src/manage/protocols/index.ts`.

### Step 4: Seed protocol

Add to `backend/src/discover/db/seed.ts`:
```typescript
{ slug: '{slug}', name: '{Name}', description: '...', websiteUrl: '...', auditStatus: '...', auditors: [...], integration: 'full' }
```

### Step 5: Verify

1. Health check: `curl http://localhost:8001/api/health`
2. Frontend build: `cd frontend && npm run build`
3. Manual fetcher test: run the fetcher function directly

---

## Checklist

- [ ] Discover: yield fetcher created + registered in scheduler
- [ ] Monitor: position fetcher created + registered in scheduler
- [ ] Manage: protocol adapter created + registered
- [ ] Protocol seed entry added
- [ ] Health check passes
- [ ] Frontend builds
