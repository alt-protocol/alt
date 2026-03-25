# Backend CLAUDE.md

## Commands

**Prerequisite:** Postgres must be running — `docker compose up -d` from repo root.

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload          # http://localhost:8000
```
Requires `backend/.env` with `DATABASE_URL`, `HELIUS_API_KEY`, `HELIUS_RPC_URL`, `JUPITER_API_KEY`, and optionally `CORS_ORIGINS` (defaults to `http://localhost:3000`).

### Alembic migrations (run from `backend/`)
```bash
alembic revision --autogenerate -m "description"
alembic upgrade head
alembic downgrade -1
```

## Architecture

### Database (6 tables)
- `protocols`, `yield_opportunities`, `yield_snapshots` — market data
- `tracked_wallets`, `user_positions`, `user_position_events` — portfolio tracking
- Pydantic schemas in `app/schemas/__init__.py` (fully implemented)
- `get_db()` in `app/dependencies.py` for DB sessions

### Yield Fetchers (APScheduler, every 15 min, `coalesce=True`)

1. **`services/kamino_fetcher.py`** — Kamino Finance API for three product lines:
   - *Earn Vaults*: `fetch_earn_vaults` via `/kvaults/vaults` + per-vault `/metrics`
   - *Lending Reserves*: `fetch_lending_reserves` via `/v2/kamino-market` (primary markets only)
   - *Multiply Markets*: `fetch_multiply_markets` via all markets + per-reserve history

2. **`services/drift_fetcher.py`** — Drift vault and insurance fund opportunities via Drift API. Fetches vault APYs, TVL, and manager metadata.

3. **`services/jupiter_fetcher.py`** — Jupiter Lend API for lending reserves. Fetches reserve APYs, TVL, and token metadata directly from Jupiter's lending endpoints.

### Position Fetchers
Each protocol has a `*_position_fetcher.py` (`kamino_position_fetcher`, `drift_position_fetcher`, `jupiter_position_fetcher`) that reads on-chain positions for tracked wallets. These are called by `snapshot_all_positions_job()` in `main.py`.

### Key Field: `deposit_address`
`YieldOpportunity.deposit_address` stores the on-chain pubkey (vault, reserve, or pool address) that the frontend needs to build deposit transactions. This bridges backend data to the non-custodial frontend flow.

### Key Field: `extra_data` (JSONB)
Protocol-specific metadata per opportunity. Never add protocol-specific columns — use this JSONB field instead.

### `services/utils.py` — Shared Utilities
All fetchers import from this module. **Never redefine these patterns locally.**

| Function | Purpose |
|---|---|
| `safe_float(val)` | Safely coerce string/number to `Optional[float]` |
| `get_with_retry(url, client)` | GET with tenacity retry (3 attempts, exponential backoff) |
| `get_or_none(url, client, log_label)` | GET with retry, returns `None` on failure |
| `cached(key, ttl, fn)` | TTL cache for expensive, slowly-changing API data |
| `parse_timestamp(ts)` | Parse ISO string or epoch to `Optional[datetime]` (UTC) |
| `store_position_rows(db, positions, snapshot_at)` | Bulk-insert `UserPosition` rows from position dicts |
| `upsert_opportunity(db, protocol, ...)` | Create-or-update `YieldOpportunity` + record `YieldSnapshot` |

## Code Style

1. **Reuse `services/utils.py`** — never redefine `_float`, retry logic, cache, timestamp parsing, position storage, or opportunity upsert. Import and alias: `_float = safe_float`.
2. **Local aliases for frequently-called imports** — `_float = safe_float`, `_cached = cached`, `_parse_timestamp = parse_timestamp`. Keeps call sites dense.
3. **Each fetcher gets a private `_get()` wrapper** — calls `get_or_none(f"{BASE_URL}{path}", client, log_label="Protocol API")`. This keeps the base URL in one place.
4. **Fetcher isolation** — one file per protocol, shared logic only via `utils.py`. Exception: `jupiter_fetcher` imports `_batch_snapshot_avg` and `_classify_multiply_pair` from `kamino_fetcher` (cross-protocol data classification).
5. **Position fetcher contract** — must expose `snapshot_all_wallets(db, snapshot_at)` → `int` and `fetch_wallet_positions(wallet, db)` → `dict`. Registered in `main.py` `snapshot_all_positions_job()`.
6. **Router pattern** — `Depends(get_db)`, Pydantic `response_model`, `@limiter.limit()` on mutation endpoints, private `_validate_wallet()`.
7. **Background jobs own their DB session** — `SessionLocal()`, try/finally close. Never share sessions across threads.
8. **Timestamps always UTC** — `datetime.now(timezone.utc)`, never `.utcnow()`.
9. **Functions ≤ 80 lines** — extract helpers with `_` prefix. Complex PnL/APY logic lives in named sub-functions.
10. **`extra_data` JSONB for protocol-specific fields** — never add protocol-specific columns.
11. **Deactivate, don't delete** — stale opportunities get `is_active=False`.
12. **Logging** — `logger = logging.getLogger(__name__)`, no print.

## Adding a New Protocol

1. `services/{protocol}_fetcher.py` — yield fetcher, register in `main.py` `YIELD_FETCHERS` + scheduler
2. `services/{protocol}_position_fetcher.py` — position fetcher, add to `snapshot_all_positions_job()`
3. Seed row in `SEED_PROTOCOLS` in `main.py`
4. Use `upsert_opportunity()` and `store_position_rows()` from `utils.py`
5. Never add protocol-specific DB columns — use `extra_data`
