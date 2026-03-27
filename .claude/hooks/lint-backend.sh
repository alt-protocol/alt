#!/bin/bash

# Runs tsc type-check after Claude edits/writes backend TypeScript files
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only run for backend TypeScript files
if ! echo "$FILE_PATH" | grep -qE 'backend/.*\.ts$'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR/backend"

TSC_OUTPUT=$(npx tsc --noEmit 2>&1)
TSC_EXIT=$?

if [ $TSC_EXIT -ne 0 ]; then
  echo "TSC ERRORS:" >&2
  echo "$TSC_OUTPUT" | tail -20 >&2
  exit 2
fi

echo "tsc OK"
exit 0
