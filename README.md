# Alt

A curated, non-custodial Solana yield dashboard. Discover, deposit, and monitor yield positions across Kamino, Drift, Exponent, and more — without leaving the app.

## Structure

```
alt/
├── docs/               # Strategy, architecture, roadmap
├── frontend/           # Next.js 14, TypeScript, Tailwind
├── backend/            # Python, FastAPI, PostgreSQL
├── scripts/            # DB seed scripts
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

## Docs
- [Brainstorm Summary](docs/00-BRAINSTORM-SUMMARY.md)
- [MVP Scope](docs/01-MVP-SCOPE.md)
- [Architecture](docs/02-ARCHITECTURE.md)
- [Roadmap](docs/03-ROADMAP.md)
