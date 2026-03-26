#!/bin/bash

# Runs ESLint after Claude edits/writes frontend JS/TS files
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only run for frontend JS/TS files
if ! echo "$FILE_PATH" | grep -qE 'frontend/.*\.(tsx?|jsx?)$'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR/frontend"

LINT_OUTPUT=$(npm run lint 2>&1)
LINT_EXIT=$?

if [ $LINT_EXIT -ne 0 ]; then
  echo "ESLINT ERRORS:" >&2
  echo "$LINT_OUTPUT" | grep -E '(Error|Warning|✖)' | tail -20 >&2
  exit 2
fi

echo "ESLint OK"
exit 0
