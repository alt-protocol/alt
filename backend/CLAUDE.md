# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload          # http://localhost:8000
```

Requires `backend/.env` with `DATABASE_URL`, `HELIUS_API_KEY`, and optionally `CORS_ORIGINS` (defaults to `http://localhost:3000`).

### Alembic migrations (run from `backend/`)
```bash
alembic revision --autogenerate -m "description"
alembic upgrade head
alembic downgrade -1
```

### Seed database (run from repo root)
```bash
python scripts/seed_protocols.py
```

## Architecture

### Yield Fetchers
Multiple fetchers run every 15 minutes (APScheduler):

1. **`services/kamino_fetcher.py`** — hits the Kamino Finance API directly for richer data across three product lines:
   - *Earn Vaults*: `fetch_earn_vaults` via `/kvaults/vaults` + per-vault `/metrics`
   - *Lending Reserves*: `fetch_lending_reserves` via `/v2/kamino-market` (primary markets only)
   - *Multiply Markets*: `fetch_multiply_markets` via all markets + per-reserve history

2. **`services/drift_fetcher.py`** — fetches Drift yield opportunities.

3. **`services/jupiter_fetcher.py`** — fetches Jupiter LP yield opportunities.

### Key Field: `deposit_address`
`YieldOpportunity.deposit_address` stores the on-chain pubkey (vault address, reserve address, or collateral reserve pubkey) that the frontend needs to build deposit transactions via protocol SDKs. This is the bridge between backend data and the non-custodial frontend flow.

### Key Field: `extra_data` (JSONB)
Rich protocol-specific metadata stored per opportunity — the frontend reads these directly. Notable fields for Kamino Multiply:
- `leverage_table` — net APY at each leverage step (2x/3x/5x/8x/10x)
- `borrow_apy_current_pct`, `borrow_apy_7d_pct`, `borrow_apy_30d_pct`
- `collateral_yield_7d_pct`, `collateral_yield_30d_pct`
- `debt_available_usd` — liquidity headroom for new positions
- `vault_tag` — pair classification (`stable_loop`, `rwa_loop`, `sol_loop`, `directional_leverage`)

### Kamino Multiply APY Computation
Net APY formula: `(collateral_yield × leverage) − (borrow_apy × (leverage − 1))`

Collateral yield is derived differently per token type (`_classify_token`):
- `yield_bearing_stable` (e.g., PRIME, syrupUSDC): linear regression on the price ratio time series vs the debt token
- `stable` (e.g., USDC): `supplyApy` from reserve metrics
- `lst` (e.g., JITOSOL, MSOL): price ratio regression
- `volatile`: yield is unavailable (not displayed)

### Stale Entry Deactivation
After each Kamino fetch, multiply entries not seen in the current run are set `is_active=False` (not deleted). The `MIN_TVL_USD = 100_000` filter in `kamino_fetcher.py` prevents noise from low-TVL entries.

### API Extras
`GET /api/yields` accepts an undocumented `vault_tag` query param (in addition to `category`, `sort`, `tokens`) — filters by `extra_data->vault_tag` for Kamino Multiply pair types.

### Database Models
- `protocols` / `yield_opportunities` / `yield_snapshots` — see `app/models/`
- Pydantic schemas live in `app/schemas/__init__.py` (fully implemented)
- `get_db()` in `app/dependencies.py` is the FastAPI dependency for DB sessions
