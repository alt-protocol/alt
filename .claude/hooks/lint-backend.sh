#!/bin/bash

# Runs ruff check after Claude edits/writes backend Python files
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only run for backend Python files
if ! echo "$FILE_PATH" | grep -qE 'backend/.*\.py$'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

RUFF="$CLAUDE_PROJECT_DIR/backend/venv/bin/ruff"
if [ ! -f "$RUFF" ]; then
  echo "Ruff not installed in venv, skipping"
  exit 0
fi

LINT_OUTPUT=$("$RUFF" check "$FILE_PATH" 2>&1)
LINT_EXIT=$?

if [ $LINT_EXIT -ne 0 ]; then
  echo "RUFF ERRORS:" >&2
  echo "$LINT_OUTPUT" | tail -20 >&2
  exit 2
fi

echo "Ruff OK"
exit 0
