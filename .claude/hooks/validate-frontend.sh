#!/bin/bash

# Runs after Claude edits/writes files — validates frontend builds correctly
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only run for frontend TypeScript/React files
if ! echo "$FILE_PATH" | grep -qE 'frontend/.*\.(tsx?|jsx?|css)$'; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR/frontend"

# Run build check
BUILD_OUTPUT=$(npm run build 2>&1)
BUILD_EXIT=$?

if [ $BUILD_EXIT -ne 0 ]; then
  echo "FRONTEND BUILD FAILED:" >&2
  echo "$BUILD_OUTPUT" | tail -30 >&2
  exit 2  # Block — tells Claude the edit broke the build
fi

echo "Frontend build OK"
exit 0
