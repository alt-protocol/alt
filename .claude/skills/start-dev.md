---
name: start-dev
description: Start Postgres, backend(s), and frontend for local development
user_invocable: true
---

# Start Dev Environment

Start the hybrid dev environment: Docker Postgres + native backend(s) and frontend.

## Steps

1. **Start Postgres** via Docker Compose:
   ```bash
   cd /Users/andreiyazepchyk/Projects/alt && docker compose up -d
   ```
   Wait for the health check to pass: `docker compose ps` should show `db` as healthy.

2. **Start Python backend** (port 8000) — run in background:
   ```bash
   cd /Users/andreiyazepchyk/Projects/alt/backend && source venv/bin/activate && uvicorn app.main:app --reload
   ```

3. **Start Node.js backend** (port 8001) — run in background *(if `backend-ts/` exists)*:
   ```bash
   cd /Users/andreiyazepchyk/Projects/alt/backend-ts && npm run dev
   ```

4. **Start frontend** (port 3000) — run in background:
   ```bash
   cd /Users/andreiyazepchyk/Projects/alt/frontend && npm run dev
   ```

5. **Wait 4 seconds**, then verify all services:
   - `docker compose ps` — `db` service should be running and healthy
   - `curl -s http://localhost:8000/api/health` — should return `{"status":"ok"}`
   - If `backend-ts/` exists: `curl -s http://localhost:8001/api/health` — should return `{"status":"ok"}`
   - `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` — should return `200`

6. Report the results to the user.

## Testing against Node.js backend

To test the frontend against the Node.js backend, set `NEXT_PUBLIC_API_URL=http://localhost:8001` in `frontend/.env.local` and restart the frontend.
