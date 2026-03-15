"""Seed the database with initial protocol metadata."""
import sys
import os

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "../backend/.env"))

from backend.app.models.base import SessionLocal, engine, Base
from backend.app.models.protocol import Protocol

Base.metadata.create_all(bind=engine)

PROTOCOLS = [
    {
        "slug": "kamino",
        "name": "Kamino Finance",
        "description": "Automated liquidity management and lending vaults on Solana.",
        "website_url": "https://kamino.finance",
        "audit_status": "audited",
        "auditors": ["OtterSec", "Halborn"],
        "integration": "full",
    },
    {
        "slug": "drift",
        "name": "Drift Protocol",
        "description": "Decentralized perpetuals exchange with earn vaults on Solana.",
        "website_url": "https://drift.trade",
        "audit_status": "audited",
        "auditors": ["OtterSec"],
        "integration": "full",
    },
    {
        "slug": "exponent",
        "name": "Exponent Finance",
        "description": "Fixed-yield tokenization protocol on Solana (Pendle-equivalent).",
        "website_url": "https://exponent.finance",
        "audit_status": "audited",
        "auditors": [],
        "integration": "full",
    },
    {
        "slug": "solstice",
        "name": "Solstice",
        "description": "Delta-neutral yield strategies on Solana (USX/eUSX).",
        "website_url": "https://solstice.finance",
        "audit_status": "unaudited",
        "auditors": [],
        "integration": "data_only",
    },
    {
        "slug": "jupiter",
        "name": "Jupiter",
        "description": "Leading DEX aggregator on Solana with stable AMM LP pools.",
        "website_url": "https://jup.ag",
        "audit_status": "audited",
        "auditors": ["OtterSec"],
        "integration": "data_only",
    },
]

if __name__ == "__main__":
    db = SessionLocal()
    try:
        for p in PROTOCOLS:
            existing = db.query(Protocol).filter(Protocol.slug == p["slug"]).first()
            if not existing:
                db.add(Protocol(**p))
                print(f"  Added: {p['name']}")
            else:
                print(f"  Skipped (exists): {p['name']}")
        db.commit()
        print("Done.")
    finally:
        db.close()
