# Phase 2: Monitor Module

Read `MIGRATION_PLAN.md` for architecture. Phase 1 (Discover) must be complete.

## What to build

Add the **Monitor** module to `backend-ts/` — portfolio tracking, position fetchers, wallet management.

## Steps

### 1. Set up Monitor DB
- `monitor/db/schema.ts` — map `tracked_wallets`, `user_positions`, `user_position_events` (keep in `public` schema for now, same as Phase 1)
- `monitor/db/connection.ts` — DB pool

### 2. Port Monitor routes
Port from Python `backend/app/routers/portfolio.py`:
- `GET /api/monitor/portfolio/:wallet` — SPL token balances via Helius RPC
- `POST /api/monitor/portfolio/:wallet/track` — register wallet for tracking (5/min rate limit)
- `GET /api/monitor/portfolio/:wallet/status` — fetch status (pending/fetching/ready/error)
- `GET /api/monitor/portfolio/:wallet/positions` — current positions (filters: protocol, product_type)
- `GET /api/monitor/portfolio/:wallet/positions/history` — time-series with bucketing (1h/4h/12h)
- `GET /api/monitor/portfolio/:wallet/events` — deposit/withdraw events

Match Python response shapes exactly.

### 3. Port position fetchers
- `monitor/services/utils.ts` — port `compute_realized_apy`, `load_opportunity_map`, `store_position_rows` from Python utils
- `monitor/services/kamino-position-fetcher.ts` — port from `kamino_position_fetcher.py` (vault + lending + multiply positions, Modified Dietz PnL)
- `monitor/services/drift-position-fetcher.ts` — port from `drift_position_fetcher.py` (IF staking + vault positions)
- `monitor/services/jupiter-position-fetcher.ts` — port from `jupiter_position_fetcher.py` (lending positions)

### 4. Wire cross-module read
Monitor needs to read from Discover to link positions to opportunities:
```typescript
import { discoverService } from '../discover/service';
const opportunityMap = await discoverService.getOpportunityMap();
```
**Important:** This is a function call (same process), NOT an HTTP call or direct DB query. Monitor never queries `discover.*` tables directly.

### 5. Set up scheduler
- `monitor/scheduler.ts` — node-cron job running all 3 position fetchers every 15 minutes (with shared snapshot_at timestamp)

### 6. Create Monitor service interface
- `monitor/service.ts`:
  ```typescript
  getPositions(wallet: string, filters?: { protocol?: string, productType?: string }): Promise<Position[]>
  trackWallet(wallet: string): Promise<void>
  getWalletStatus(wallet: string): Promise<WalletStatus>
  ```

### 7. Register as Fastify plugin
- `monitor/index.ts` — registers routes, starts scheduler, receives discoverService reference

## Key constraints
- **Modified Dietz PnL calculation must match Python exactly** — this is the most error-prone part
- **Background fetch pattern**: POST /track returns immediately, runs fetchers in background thread
- Position snapshots use a shared `snapshot_at` timestamp across all 3 protocol fetchers
- `load_opportunity_map` reads from Discover service interface (not DB)

## Verify before committing
1. `npm run build` compiles
2. `curl http://localhost:8001/api/monitor/portfolio/{wallet}/positions` matches Python
3. `curl http://localhost:8001/api/monitor/portfolio/{wallet}/events` matches Python
4. POST track + poll status works

Commit: `git add -A && git commit -m "Phase 2: Monitor module"`
