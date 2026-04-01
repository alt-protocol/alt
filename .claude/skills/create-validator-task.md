---
name: create-validator-task
description: Create a validation task prompt for a reviewer agent (Opus 4.6). Triggers when user asks to create a validation, review, or QA task for another agent to verify completed work.
user_invocable: true
---

# Create Validator Task Prompt

You are a **planner/orchestrator**. You create validation task prompts that another Opus 4.6 agent will execute to review completed work. Your output is the prompt text — nothing else.

> **CRITICAL:** Never write code, edit files, or make changes. Only research and produce the validation prompt.

---

## Before Writing the Prompt

1. **Understand what was done** — Read the original task that was executed. What was the goal? What changes were expected?
2. **Check the diff** — Run `git diff main --stat` to see what files were changed (read-only).
3. **Identify risk areas** — What could go wrong? What are the common mistakes for this type of change?

---

## Validator Prompt Structure

Every validator task prompt MUST have these sections:

### 1. Header & Role
```
## Task: Validate [Task Name] — Round [N]

### Your Role
You are a **validator**. You do NOT fix anything. You verify whether the executing agent's changes are correct and complete. Report pass/fail for each check with evidence.
```

Always state the role explicitly — validators must not drift into fixing.

### 1.5. Parallel Agent Protocol (ALWAYS include)

```
### Parallel Agent Protocol

This validator runs alongside other agents who may have made their own changes. You MUST only validate changes from YOUR task.

#### How to Find Your Task's Changes
1. Find the task commit: `git log --oneline | grep "[TASK-NAME]"`
2. Get the commit hash, then diff ONLY that commit: `git diff <COMMIT>~1..<COMMIT>`
3. If no task commit exists yet, use file-scoped diff: `git diff main -- <file1> <file2> ...` using ONLY the files listed in "Expected files modified"

#### Critical Rules
- **NEVER run bare `git diff main`** — this shows ALL agents' changes, not just yours
- **NEVER flag, revert, or comment on changes from other tasks**
- **ONLY validate files listed in "Expected files modified"**
- If you see changes in your files that you don't recognize, they may be from a prerequisite task — verify they don't conflict but do NOT flag them as issues
- **NEVER run `git checkout`, `git restore`, or `git reset`** — you are a validator, not a fixer
```

### 2. Context (what was supposed to change)
- Original problem (1-2 sentences)
- Expected fix (1-2 sentences)
- What files should have been modified

### 3. Functional Verification (Did the fix work?)
Concrete checks with exact commands that verify the original problem is resolved:

```
#### F1: [Check name]
[exact command to run]
- [ ] **PASS** if [expected result]
- [ ] **FAIL** if [failure condition]
```

Rules:
- Every check must have a runnable command
- Every check must have explicit PASS and FAIL criteria
- Checks should be independent (one failing doesn't block others)
- Include the "happy path" AND edge cases

### 4. Code Quality Checks
These checks apply to EVERY validation task — include all of them:

```
#### C1: No `any` Types Introduced
git diff main -- <EXPECTED_FILES> | grep '^\+' | grep -E ': any\b|as any\b' | grep -v '\.d\.ts' | grep -v 'eslint-disable'
- [ ] PASS if 0 matches
- [ ] FAIL if any — list each with file and line
*(Replace `<EXPECTED_FILES>` with the space-separated file paths from "Expected files modified")*

#### C2: No console.log (use project logger)
git diff main -- <EXPECTED_FILES> | grep '^\+' | grep 'console\.\(log\|warn\|error\|debug\)'
- [ ] PASS if 0 matches

#### C3: No Hardcoded URLs or Secrets
git diff main -- <EXPECTED_FILES> | grep '^\+' | grep -iE '(https?://[^ "]+\.(railway|vercel|helius))'
git diff main -- <EXPECTED_FILES> | grep '^\+' | grep -iE '(api_key|secret|password)\s*[:=]\s*["\x27][a-zA-Z0-9]'
- [ ] PASS if 0 matches
- [ ] FAIL if any — severity CRITICAL

#### C4: No Dead Code or Debug Artifacts
git diff main -- <EXPECTED_FILES> | grep '^\+' | grep -iE '(TODO|FIXME|HACK|XXX|TEMP|debugger)'
- [ ] PASS if 0 (or TODOs have context like "TODO(#123): description")
- [ ] WARN if bare TODOs

#### C5: Error Handling
For each changed file that makes external calls (API, DB, RPC):
- [ ] External calls wrapped in try/catch
- [ ] Errors logged with logger, not swallowed silently
- [ ] Single item failure doesn't crash a loop/batch

#### C6: Import Cleanliness
- [ ] No unused imports in changed files
- [ ] Import order matches neighboring files
- [ ] No circular imports introduced

#### C7: Consistent Patterns
- [ ] Same naming convention as rest of codebase (camelCase functions, PascalCase types)
- [ ] Same async/await style (not mixing .then() chains)
- [ ] Same error handling approach as neighboring code
- [ ] Database queries use Drizzle consistently (no raw SQL mixed in)
```

### 5. Compilation & Build Checks
Always include:

```
#### B1: TypeScript Compiles
cd backend && npx tsc --noEmit
- [ ] PASS if 0 errors

#### B2: Frontend Builds
cd frontend && npm run build
- [ ] PASS if succeeds

#### B3: Backend Health
curl -sf http://localhost:8001/api/health
- [ ] PASS if returns ok
```

### 6. Long-Term Maintainability (for non-trivial changes)
Include for any change that adds new logic, patterns, or architecture:

```
#### M1: Future-Proofing
- [ ] If someone adds a similar [thing], does the pattern scale?
- [ ] Are extension points clear?

#### M2: Resilience
- [ ] If external dependency fails, does the system degrade gracefully?
- [ ] Are timeouts and retries reasonable?

#### M3: Module Isolation
- [ ] No cross-module imports introduced
- [ ] Shared code changes are backward-compatible

#### M4: Schema Stability (if DB changed)
- [ ] Changes are backward-compatible (new nullable columns, not drops)
- [ ] Existing queries still work

#### M5: Test Recommendations (advisory)
- [ ] List what tests WOULD cover if tests existed
- [ ] Not a blocker, but documents the verification gap
```

### 7. Spot-Check (for investigations/data tasks)
If the original task involved data or API results, the validator should independently verify:

```
### Spot-Check
Don't trust the executor's reported numbers — re-run key queries independently:
[exact commands]
- [ ] PASS if your results match what the executor reported
- [ ] FAIL if discrepancy — show both values
```

### 8. Report Format
Always end with a structured report template:

```
### Report Format

**Task:** [TASK-NAME]
**Commit:** [commit hash if found, or "uncommitted"]

| Check | Description | Result | Evidence |
|-------|-------------|--------|----------|
| S0 | Only my task's files checked | PASS/FAIL | [list files checked] |
| F1 | [name] | PASS/FAIL | [what you saw] |
| ... | ... | ... | ... |

### Final Verdict
**Ready to merge: YES / NO**

If NO: list blocking issues.
If YES: list non-blocking recommendations.

**Summary:** [1-3 sentences on overall quality]
```

---

## Round-Specific Guidance

### Round 1 (First Review)
- Be thorough — check everything
- Expect to find issues
- Categorize findings: blocking vs non-blocking
- Provide clear fix instructions for each finding

### Round 2+ (Follow-Up Reviews)
- Focus on: were Round N-1 findings actually fixed?
- Re-run all functional checks (don't skip — regressions happen)
- Code quality: verify fixes didn't introduce new issues
- If this is the final round, explicitly state "Ready to merge: YES/NO"

---

## Quality Checklist for Your Prompt

Before delivering the validation prompt, verify:

- [ ] **Every check is runnable** — commands can be copy-pasted
- [ ] **PASS/FAIL criteria are unambiguous** — no subjective judgment needed
- [ ] **Code quality section is complete** — all C1-C7 checks included
- [ ] **Build checks included** — tsc, frontend build, health check
- [ ] **Report template included** — validator knows the output format
- [ ] **Scope matches the task** — don't validate things that weren't changed
- [ ] **Round context is clear** — validator knows if this is round 1, 2, or final

---

## Save to File & Summary (ALWAYS do BOTH after the validation prompt)

### Step 1: Save the prompt to a file
Write the FULL validator prompt (everything from `## Task: Validate` through the Report Format) to:
`tasks/validator-<task-name>.md`
- Example: `tasks/validator-drift-vault-fix.md`
- The task-name matches the executor task name

### Step 2: Produce a summary with file link
This is NOT part of the validator prompt — it's for the planner to quickly verify coverage.

Format:
```
### Validation Summary: [Task Name]
📋 **Prompt:** `tasks/validator-<task-name>.md`
**Verifying:** [1 sentence — what was supposed to change]
**Key checks:** [2-3 bullet points — the most important PASS/FAIL checks]
**Files scoped:** [comma-separated list of expected files]
```
