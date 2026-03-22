#!/bin/bash

# Runs after Claude edits/writes files — validates backend is still responding
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only run for backend Python files
if ! echo "$FILE_PATH" | grep -qE 'backend/.*\.py$'; then
  exit 0
fi

# Give uvicorn reload a moment to pick up the change
sleep 2

# Check if backend health endpoint responds
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:8000/api/health 2>/dev/null)

if [ "$HEALTH" = "200" ]; then
  exit 0
fi

# Try once more after a longer wait (uvicorn may still be reloading)
sleep 3
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:8000/api/health 2>/dev/null)

if [ "$HEALTH" = "200" ]; then
  exit 0
fi

echo "BACKEND HEALTH CHECK FAILED: /api/health returned $HEALTH (expected 200)" >&2
echo "The backend may have crashed after this edit. Check the uvicorn logs." >&2

# Show Docker backend logs as fallback (in case full Docker stack is running)
docker compose logs --tail=20 backend 2>/dev/null

exit 2
