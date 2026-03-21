---
name: start-dev
description: Start both frontend and backend dev servers locally
user_invocable: true
---

# Start Dev Servers

Start both the backend and frontend development servers in the background, then verify they're healthy.

## Steps

1. **Start backend** (port 8000) — run in background:
   ```bash
   cd /Users/andreiyazepchyk/Projects/alt/backend && source venv/bin/activate && uvicorn app.main:app --reload
   ```

2. **Start frontend** (port 3000) — run in background:
   ```bash
   cd /Users/andreiyazepchyk/Projects/alt/frontend && npm run dev
   ```

3. **Wait 4 seconds**, then verify both servers:
   - `curl -s http://localhost:8000/api/health` — should return `{"status":"ok"}`
   - `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000` — should return `200`

4. Report the results to the user.
