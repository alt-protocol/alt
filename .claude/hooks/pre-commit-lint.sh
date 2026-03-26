#!/bin/bash

# Pre-commit gate: runs lint checks before git commit
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only run when the command is a git commit
if ! echo "$COMMAND" | grep -qE '^git commit'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
FAILED=0

# Run ESLint on frontend
ESLINT_OUTPUT=$(cd frontend && npm run lint 2>&1)
if [ $? -ne 0 ]; then
  echo "PRE-COMMIT: ESLint failed:" >&2
  echo "$ESLINT_OUTPUT" | grep -E '(Error|Warning|✖)' | tail -15 >&2
  FAILED=1
fi

# Run ruff only on staged Python files
RUFF="$CLAUDE_PROJECT_DIR/backend/venv/bin/ruff"
STAGED_PY=$(git diff --cached --name-only --diff-filter=ACM -- 'backend/*.py' 'backend/**/*.py')
if [ -n "$STAGED_PY" ]; then
  RUFF_OUTPUT=$("$RUFF" check $STAGED_PY 2>&1)
  if [ $? -ne 0 ]; then
    echo "PRE-COMMIT: Ruff failed:" >&2
    echo "$RUFF_OUTPUT" | tail -15 >&2
    FAILED=1
  fi
fi

if [ $FAILED -ne 0 ]; then
  echo "Pre-commit lint gate BLOCKED. Fix the above issues before committing." >&2
  exit 2
fi

echo "Pre-commit lint gate OK"
exit 0
