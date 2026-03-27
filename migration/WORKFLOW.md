# Migration Workflow

## Setup (once)

```bash
git checkout -b migration/backend-ts
```

## Per-Phase Workflow

For each phase (1-6):

1. **Open Terminal 1** — start Claude Code
2. **Paste the executor prompt** from `migration/executor-phase-{N}.md`
3. Wait for executor to finish and commit
4. **Open Terminal 2** — start Claude Code
5. **Paste the validator prompt** from `migration/validator-phase-{N}.md`
6. Validator produces issue list
7. **Copy issues back to Terminal 1**: "Fix these issues from the validator: [paste list]"
8. Executor fixes and commits
9. **Back to Terminal 2**: "Re-review. Previous issues were: [paste list]. Check if fixed, report any new issues."
10. Repeat steps 7-9 until validator says no critical/important issues
11. Move to next phase

## Useful Git Commands

```bash
# See all commits on the migration branch
git log --oneline main..migration/backend-ts

# See what changed in the last commit
git diff HEAD~1

# See all changes since branching from main
git diff main..migration/backend-ts

# Compare two specific commits
git log --oneline     # find commit hashes
git diff abc123..def456

# See what files changed
git diff --stat HEAD~1
```

## After All Phases Complete

```bash
# Merge to main
git checkout main
git merge migration/backend-ts

# Push
git push origin main
```

## Phase Overview

| Phase | Executor | Validator | Estimated time |
|-------|----------|-----------|---------------|
| 1 | Scaffold + Discover module | Verify API parity, fetcher correctness | ~1.5 weeks |
| 2 | Monitor module | Verify position fetchers, PnL calculations | ~1 week |
| 3 | Manage module | Verify tx building, safety guards | ~1 week |
| 4 | Frontend migration | Verify all flows work through API | ~3-5 days |
| 5 | MCP server | Verify all 7 tools work | ~2-3 days |
| 6 | Deploy + cut over | Verify production parity | ~2-3 days |
