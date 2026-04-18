---
name: start-dev
description: Start Postgres, backend, frontend, and telegram bot for local development
user_invocable: true
---

# Start Dev Environment

Start the dev environment: Docker Postgres + backend, frontend, and telegram bot.

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

4. **Start telegram bot** — run in background:
   ```bash
   cd /Users/andreiyazepchyk/Projects/alt/telegram-bot && npm run dev
   ```

5. **Wait 4 seconds**, then verify all services:
   - `docker compose ps` — `db` service should be running and healthy
   - `curl -s http://localhost:8001/api/health` — should return `{"status":"ok"}`
   - `curl -s -X GET http://localhost:8001/api/mcp` — MCP server is embedded in backend, should return `405` (accepts POST only)
   - `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` — should return `200`
   - Check telegram bot output for successful startup (no crash/error)

6. Report the results to the user.
