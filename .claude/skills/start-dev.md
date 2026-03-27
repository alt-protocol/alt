---
name: start-dev
description: Start Postgres, backend, and frontend for local development
user_invocable: true
---

# Start Dev Environment

Start the dev environment: Docker Postgres + backend and frontend.

## Steps

1. **Start Postgres** via Docker Compose:
   ```bash
   cd /Users/andreiyazepchyk/Projects/alt && docker compose up -d
   ```
   Wait for the health check to pass: `docker compose ps` should show `db` as healthy.

2. **Start backend** (port 8001) — run in background:
   ```bash
   cd /Users/andreiyazepchyk/Projects/alt/backend && npm run dev
   ```

3. **Start frontend** (port 3000) — run in background:
   ```bash
   cd /Users/andreiyazepchyk/Projects/alt/frontend && npm run dev
   ```

4. **Wait 4 seconds**, then verify all services:
   - `docker compose ps` — `db` service should be running and healthy
   - `curl -s http://localhost:8001/api/health` — should return `{"status":"ok"}`
   - `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` — should return `200`

5. Report the results to the user.
