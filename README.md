# Alt

A curated, non-custodial Solana yield dashboard. Discover, deposit, and monitor yield positions across Kamino, Drift, Jupiter, and more — without leaving the app.

## Structure

```
alt/
├── frontend/           # Next.js 16, TypeScript, Tailwind
├── backend/            # Python, FastAPI, PostgreSQL
├── scripts/            # DB seed, backfill, and validation scripts
└── README.md
```

## Quick Start

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local   # add Helius RPC URL
npm run dev                   # http://localhost:3000
```

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add DB URL and Helius API key
alembic upgrade head
uvicorn app.main:app --reload  # http://localhost:8000
```

### Seed protocols
```bash
python scripts/seed_protocols.py
```
