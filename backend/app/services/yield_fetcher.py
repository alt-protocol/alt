"""Fetch live yield data from DeFiLlama and upsert into the database."""
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from app.models.base import SessionLocal
from app.models.protocol import Protocol
from app.models.yield_opportunity import YieldOpportunity, YieldSnapshot

logger = logging.getLogger(__name__)

DEFILLAMA_POOLS_URL = "https://yields.llama.fi/pools"

# Map our protocol slugs → DeFiLlama project name(s)
# Note: Kamino is fetched via its own API (kamino_fetcher.py) for richer data
PROTOCOL_SLUG_TO_DEFILLAMA = {
    "drift": ["drift-protocol"],
    "exponent": ["exponent-finance"],
    "solstice": ["solstice-fi"],
    "jupiter": ["jupiter"],
}

# Map DeFiLlama pool categories to our category schema
CATEGORY_MAP = {
    "Lending": "lending",
    "Yield": "vault",
    "Liquidity Mining": "lp",
    "Algo-Stable": "stable",
    "CDP": "cdp",
    "RWA": "rwa",
    "Perps": "perp",
    "DEX": "lp",
    "Yield Aggregator": "vault",
}


def _map_category(llama_exposure: str) -> str:
    return CATEGORY_MAP.get(llama_exposure, "vault")


def fetch_and_store_yields() -> int:
    """Fetch all pools from DeFiLlama, filter to our protocols, upsert DB rows.

    Returns the number of opportunities updated/inserted.
    """
    logger.info("Starting yield fetch from DeFiLlama")

    try:
        resp = httpx.get(DEFILLAMA_POOLS_URL, timeout=30)
        resp.raise_for_status()
        pools = resp.json().get("data", [])
    except Exception as exc:
        logger.error("Failed to fetch DeFiLlama pools: %s", exc)
        return 0

    # Build reverse lookup: defillama project name → our protocol slug
    defillama_to_slug: dict[str, str] = {}
    for slug, llama_names in PROTOCOL_SLUG_TO_DEFILLAMA.items():
        for name in llama_names:
            defillama_to_slug[name] = slug

    # Filter to relevant pools
    relevant = [p for p in pools if p.get("project") in defillama_to_slug]
    logger.info("Found %d relevant pools out of %d total", len(relevant), len(pools))

    if not relevant:
        logger.warning("No matching pools found — check DeFiLlama project slugs")
        return 0

    db: Session = SessionLocal()
    count = 0
    now = datetime.now(timezone.utc)

    try:
        # Cache protocol rows by slug
        protocol_cache: dict[str, Protocol] = {
            p.slug: p for p in db.query(Protocol).all()
        }

        for pool in relevant:
            slug = defillama_to_slug[pool["project"]]
            protocol = protocol_cache.get(slug)
            if not protocol:
                continue

            external_id = pool.get("pool")
            apy = pool.get("apy")
            apy_7d = pool.get("apyMean30d") or pool.get("apy7d") or apy
            apy_30d = pool.get("apyMean30d") or apy
            tvl = pool.get("tvlUsd")
            tokens = pool.get("underlyingTokens") or []
            symbol = pool.get("symbol", "")
            category = _map_category(pool.get("exposure", ""))

            # Token list: prefer underlyingTokens, fallback to symbol split
            if not tokens and symbol:
                tokens = [t.strip() for t in symbol.split("-") if t.strip()]

            opportunity = (
                db.query(YieldOpportunity)
                .filter(YieldOpportunity.external_id == external_id)
                .first()
            )

            if opportunity:
                opportunity.apy_current = apy
                opportunity.apy_7d_avg = apy_7d
                opportunity.apy_30d_avg = apy_30d
                opportunity.tvl_usd = tvl
                opportunity.tokens = tokens
                opportunity.is_active = True
                opportunity.updated_at = now
            else:
                opportunity = YieldOpportunity(
                    protocol_id=protocol.id,
                    external_id=external_id,
                    name=f"{protocol.name} — {symbol}",
                    category=category,
                    tokens=tokens,
                    apy_current=apy,
                    apy_7d_avg=apy_7d,
                    apy_30d_avg=apy_30d,
                    tvl_usd=tvl,
                    risk_tier="medium",
                    is_active=True,
                    extra_data={"chain": pool.get("chain"), "project": pool.get("project")},
                )
                db.add(opportunity)
                db.flush()  # get opportunity.id

            # Always record a snapshot
            snapshot = YieldSnapshot(
                opportunity_id=opportunity.id,
                apy=apy,
                tvl_usd=tvl,
                snapshot_at=now,
                source="defillama",
            )
            db.add(snapshot)
            count += 1

        db.commit()
        logger.info("Upserted %d yield opportunities", count)
    except Exception as exc:
        db.rollback()
        logger.error("DB error during yield upsert: %s", exc)
        raise
    finally:
        db.close()

    return count
