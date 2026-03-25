"""Backfill Drift Insurance Fund historical APY from Drift data API.

Drift's /market/{symbol}/insuranceFund/{year}/{month}/{day} endpoint returns
daily revenue settlement events. We derive daily APY from vault growth and
insert YieldSnapshot records so that apy_7d_avg / apy_30d_avg can be computed.

Idempotent: skips inserting if a snapshot already exists within 12h of
the data point.

Usage (from repo root):
    python scripts/backfill_drift_if.py
"""
import sys
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

_repo_root = os.path.join(os.path.dirname(__file__), "..")
sys.path.append(_repo_root)
sys.path.append(os.path.join(_repo_root, "backend"))

from dotenv import load_dotenv
load_dotenv(os.path.join(_repo_root, "backend/.env"))

import httpx

from app.models.base import SessionLocal, engine, Base
from app.models.protocol import Protocol
from app.models.yield_opportunity import YieldOpportunity, YieldSnapshot

Base.metadata.create_all(bind=engine)

DRIFT_DATA_API = "https://data.api.drift.trade"
DRIFT_MAINNET_API = "https://mainnet-beta.api.drift.trade"
BACKFILL_DAYS = 45
SOURCE = "drift_api_backfill"


def fetch_market_decimals(client: httpx.Client) -> dict[int, int]:
    """Fetch decimals per spot market index from Drift mainnet API."""
    r = client.get(f"{DRIFT_MAINNET_API}/stats/spotMarketAccounts", timeout=30)
    r.raise_for_status()
    raw = r.json()
    if isinstance(raw, dict):
        raw = raw.get("result", [])
    result = {}
    for acct in raw:
        idx = acct.get("marketIndex")
        if idx is not None:
            result[int(idx)] = acct.get("decimals", 6)
    return result


def fetch_daily_if_records(
    client: httpx.Client,
    symbol: str,
    date: "datetime.date",
) -> list[dict]:
    """Fetch insurance fund revenue records for a single day."""
    url = f"{DRIFT_DATA_API}/market/{symbol}/insuranceFund/{date.year}/{date.month}/{date.day}"
    try:
        r = client.get(url, timeout=30)
        r.raise_for_status()
        body = r.json()
    except Exception as exc:
        print(f"    WARN: Failed to fetch {symbol} {date}: {exc}")
        return []
    if isinstance(body, dict):
        return body.get("records", [])
    return body if isinstance(body, list) else []


def compute_daily_apy(records: list[dict], decimals: int) -> Optional[float]:
    """Derive annualised APY from a day's revenue settlement events."""
    if not records:
        return None
    records.sort(key=lambda r: r.get("ts", 0))
    vault_raw = records[0].get("vaultAmountBefore") or records[0].get("insuranceVaultAmountBefore")
    if vault_raw is None:
        return None
    vault_balance = float(vault_raw) / 10**decimals
    if vault_balance <= 0:
        return None
    total_revenue = sum(float(r.get("amount", 0)) / 10**decimals for r in records)
    apy = total_revenue / vault_balance * 365 * 100
    return round(apy, 4)


def snapshot_avg(db, opp_id: int, days: int) -> Optional[float]:
    """Compute average APY over the last N days from snapshots."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    half_window = datetime.now(timezone.utc) - timedelta(days=days // 2)
    has_old_enough = (
        db.query(YieldSnapshot.id)
        .filter(
            YieldSnapshot.opportunity_id == opp_id,
            YieldSnapshot.snapshot_at <= half_window,
        )
        .first()
    )
    if has_old_enough is None:
        return None
    rows = (
        db.query(YieldSnapshot.apy)
        .filter(
            YieldSnapshot.opportunity_id == opp_id,
            YieldSnapshot.snapshot_at >= since,
            YieldSnapshot.apy.isnot(None),
        )
        .all()
    )
    if len(rows) < 2:
        return None
    return float(sum(r.apy for r in rows) / len(rows))


def main():
    db = SessionLocal()
    try:
        # 1. Load Drift protocol
        protocol = db.query(Protocol).filter(Protocol.slug == "drift").first()
        if not protocol:
            print("ERROR: Protocol 'drift' not found — run seed_protocols.py first")
            return

        # 2. Load insurance fund opportunities
        if_opps = (
            db.query(YieldOpportunity)
            .filter(
                YieldOpportunity.protocol_id == protocol.id,
                YieldOpportunity.category == "insurance_fund",
            )
            .all()
        )
        if not if_opps:
            print("No Drift insurance fund opportunities found — run the fetcher first")
            return

        print(f"Found {len(if_opps)} Drift IF opportunities")

        with httpx.Client(timeout=30) as client:
            # 3. Fetch token decimals
            print("Fetching market decimals from spotMarketAccounts...")
            market_decimals = fetch_market_decimals(client)
            print(f"Got decimals for {len(market_decimals)} markets")

            # 4. Backfill each opportunity
            today = datetime.now(timezone.utc).date()
            total_inserted = 0
            total_skipped = 0

            for opp in if_opps:
                extra = opp.extra_data or {}
                market_index = extra.get("market_index")
                symbol = (extra.get("symbol") or (opp.tokens[0] if opp.tokens else None))
                if not symbol or market_index is None:
                    print(f"  Skipping {opp.name}: missing symbol or market_index")
                    continue

                decimals = market_decimals.get(int(market_index), 6)
                inserted = 0
                skipped = 0
                no_data = 0

                for days_ago in range(BACKFILL_DAYS, 0, -1):
                    target_date = today - timedelta(days=days_ago)
                    snapshot_at = datetime(
                        target_date.year, target_date.month, target_date.day,
                        12, 0, 0, tzinfo=timezone.utc,
                    )

                    # Idempotency: skip if snapshot exists within 12h
                    window_start = snapshot_at - timedelta(hours=12)
                    window_end = snapshot_at + timedelta(hours=12)
                    existing = (
                        db.query(YieldSnapshot.id)
                        .filter(
                            YieldSnapshot.opportunity_id == opp.id,
                            YieldSnapshot.snapshot_at >= window_start,
                            YieldSnapshot.snapshot_at <= window_end,
                        )
                        .first()
                    )
                    if existing:
                        skipped += 1
                        continue

                    # Fetch and compute
                    records = fetch_daily_if_records(client, symbol, target_date)
                    apy = compute_daily_apy(records, decimals)

                    if apy is None:
                        no_data += 1
                        continue

                    db.add(YieldSnapshot(
                        opportunity_id=opp.id,
                        apy=apy,
                        tvl_usd=None,
                        snapshot_at=snapshot_at,
                        source=SOURCE,
                    ))
                    inserted += 1

                    # Small delay to avoid rate limiting
                    time.sleep(0.1)

                total_inserted += inserted
                total_skipped += skipped
                print(f"  {symbol} (IF-{market_index}): "
                      f"{inserted} inserted, {skipped} skipped, {no_data} no-data days")

        db.commit()
        print(f"\nTotal: {total_inserted} snapshots inserted, {total_skipped} skipped.")

        # 5. Recalculate averages
        print("\nRecalculating apy_7d_avg and apy_30d_avg...")
        for opp in if_opps:
            avg_7 = snapshot_avg(db, opp.id, 7)
            avg_30 = snapshot_avg(db, opp.id, 30)
            opp.apy_7d_avg = avg_7
            opp.apy_30d_avg = avg_30
            print(f"  {opp.name}: 7d={avg_7}, 30d={avg_30}")

        db.commit()
        print("\nDone.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
