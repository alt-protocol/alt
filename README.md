# Alt

A curated, non-custodial Solana yield dashboard. Discover, deposit, and monitor yield positions across Kamino, Drift, Jupiter, and more — without leaving the app.

## Structure

```
alt/
├── frontend/           # Next.js 16, TypeScript, Tailwind
├── backend/            # Node.js, Fastify, Drizzle, PostgreSQL (MCP at /api/mcp)
└── README.md
```

## Quick Start

### Database
```bash
docker compose up -d          # starts Postgres on port 5432
```

### Backend
```bash
cd backend
npm install
cp .env.example .env          # add DB URL and API keys
npm run dev                    # http://localhost:8001
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local   # add Helius RPC URL
npm run dev                   # http://localhost:3000
```
