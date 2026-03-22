"""Backfill Jupiter earn historical APY from DeFiLlama yields API.

DeFiLlama tracks ~7 Jupiter Lend "Earn" pools with daily APY history.
This script matches them to our DB opportunities by token mint address
and inserts YieldSnapshot records so that apy_7d_avg / apy_30d_avg
can be computed by the regular fetcher.

Idempotent: skips inserting if a snapshot already exists within 12h of
the DeFiLlama data point.

Usage (from repo root):
    python scripts/backfill_jupiter_defillama.py
"""
import sys
import os
from datetime import datetime, timezone, timedelta

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

DEFILLAMA_POOLS_URL = "https://yields.llama.fi/pools"
DEFILLAMA_CHART_URL = "https://yields.llama.fi/chart"


def main():
    db = SessionLocal()
    try:
        # 1. Load Jupiter earn opportunities from DB
        protocol = db.query(Protocol).filter(Protocol.slug == "jupiter").first()
        if not protocol:
            print("ERROR: Protocol 'jupiter' not found — run seed_protocols.py first")
            return

        earn_opps = (
            db.query(YieldOpportunity)
            .filter(
                YieldOpportunity.protocol_id == protocol.id,
                YieldOpportunity.category == "lending",
            )
            .all()
        )
        if not earn_opps:
            print("No Jupiter earn opportunities found in DB — run the fetcher first")
            return

        # Map deposit_address (token mint) → opportunity
        mint_to_opp = {opp.deposit_address: opp for opp in earn_opps if opp.deposit_address}
        print(f"Found {len(mint_to_opp)} Jupiter earn opportunities in DB")

        # 2. Fetch DeFiLlama pools
        print("Fetching DeFiLlama pools...")
        with httpx.Client(timeout=30) as client:
            resp = client.get(DEFILLAMA_POOLS_URL)
            resp.raise_for_status()
            all_pools = resp.json().get("data", [])

        # Filter to Jupiter Lend earn pools
        jup_earn_pools = [
            p for p in all_pools
            if p.get("project") == "jupiter-lend" and p.get("poolMeta") == "Earn"
        ]
        print(f"DeFiLlama: {len(jup_earn_pools)} Jupiter Lend Earn pools")

        # 3. Match by underlyingTokens[0] → deposit_address
        matched = []
        unmatched_db = set(mint_to_opp.keys())
        unmatched_llama = []

        for pool in jup_earn_pools:
            tokens = pool.get("underlyingTokens", [])
            if not tokens:
                unmatched_llama.append(pool.get("symbol", "?"))
                continue
            mint = tokens[0]
            if mint in mint_to_opp:
                matched.append((pool, mint_to_opp[mint]))
                unmatched_db.discard(mint)
            else:
                unmatched_llama.append(pool.get("symbol", "?"))

        print(f"Matched: {len(matched)} pools")
        if unmatched_db:
            print(f"Unmatched DB opportunities (no DeFiLlama pool): {len(unmatched_db)}")
        if unmatched_llama:
            print(f"Unmatched DeFiLlama pools (no DB entry): {unmatched_llama}")

        if not matched:
            print("Nothing to backfill.")
            return

        # 4. Fetch chart data and insert snapshots
        total_inserted = 0
        total_skipped = 0

        with httpx.Client(timeout=30) as client:
            for pool, opp in matched:
                pool_id = pool["pool"]
                symbol = pool.get("symbol", "?")
                print(f"\n  Fetching chart for {symbol} (pool {pool_id})...")

                try:
                    resp = client.get(f"{DEFILLAMA_CHART_URL}/{pool_id}")
                    resp.raise_for_status()
                    chart_data = resp.json().get("data", [])
                except Exception as exc:
                    print(f"    WARN: Failed to fetch chart for {symbol}: {exc}")
                    continue

                inserted = 0
                skipped = 0

                for point in chart_data:
                    ts_str = point.get("timestamp")
                    apy = point.get("apy")
                    tvl = point.get("tvlUsd")
                    if ts_str is None or apy is None:
                        continue

                    # Parse timestamp — DeFiLlama uses ISO format like "2025-03-01T00:00:00.000Z"
                    try:
                        snapshot_at = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    except (ValueError, AttributeError):
                        continue

                    # Idempotency: skip if a snapshot exists within 12h
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

                    db.add(YieldSnapshot(
                        opportunity_id=opp.id,
                        apy=round(apy, 4),
                        tvl_usd=round(tvl, 2) if tvl is not None else None,
                        snapshot_at=snapshot_at,
                        source="defillama",
                    ))
                    inserted += 1

                total_inserted += inserted
                total_skipped += skipped
                print(f"    {symbol}: {inserted} inserted, {skipped} skipped (already exist)")

        db.commit()
        print(f"\nDone. Total: {total_inserted} snapshots inserted, {total_skipped} skipped.")

    finally:
        db.close()


if __name__ == "__main__":
    main()
