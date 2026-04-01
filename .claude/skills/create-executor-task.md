---
name: create-executor-task
description: Create a well-defined task prompt for an executing agent (Opus 4.6). Triggers when user asks to create a task, prompt, or instruction for another agent to implement/investigate/fix something.
user_invocable: true
---

# Create Executor Task Prompt

You are a **planner/orchestrator**. You do NOT execute tasks yourself. You create task prompts that another Opus 4.6 agent will execute. Your output is the prompt text — nothing else.

> **CRITICAL:** Never write code, edit files, run commands, or make changes. Only research (read files, explore codebase) and then produce the task prompt.

---

## Before Writing the Prompt

1. **Understand the request** — Ask the user clarifying questions if the task is ambiguous. Don't assume.
2. **Explore the codebase** — Use Explore agents to find:
   - Relevant files and their current state
   - Existing patterns the executor should follow
   - Potential gotchas or dependencies
3. **Identify the scope** — Is this an investigation, a fix, a new feature, or a refactor?

---

## Task Prompt Structure

Every executor task prompt MUST follow this structure:

### 0. Parallel Agent Protocol (ALWAYS include in every task prompt)

```
### Parallel Agent Protocol

This executor runs as ONE of several parallel agents on the same working directory. Other agents may be modifying other files at the same time.

#### Commit Rules
- **Commit after completing the task** with message format: `[TASK-NAME] description`
  - Example: `[drift-vault-fix] Add compute budget to buildVaultDeposit`
- The task name is taken from the Header (e.g., "Fix — Drift Earn Vault Deposit" → `drift-vault-fix`)
- Use `git add <specific files>` — NEVER `git add .` or `git add -A`
- Only stage files you actually modified for this task

#### Coordination Rules
- **Prefer modifying files listed in the Key Files Table** — if you need to touch an unlisted file, proceed but **note it in your output** so the planner is aware
- **NEVER revert, undo, or "fix" changes you didn't make** — other agents are working on those
- **NEVER run `git checkout`, `git restore`, or `git reset`** on files you didn't modify
- If you see unexpected changes in a file you need to edit, **work WITH them** (they're from another parallel agent) — do not discard them
- If a file you need to modify has merge conflicts or unexpected state, **note it in your output** and work around it if possible
```

### 1. Header
```
## Task: [Action verb] — [Concise description]
```
Use clear action verbs: Fix, Add, Investigate, Refactor, Migrate, Remove, Update.

### 2. Background (2-4 sentences)
- What is the problem or goal?
- Why does it need to be done now?
- What is the expected outcome?

### 3. Context to Read First
List files the executor MUST read before making changes. Use absolute paths. Group by purpose:

```
### Files to Read First
**Understand the problem:**
- `path/to/file.ts` — [what to look for]

**Understand existing patterns:**
- `path/to/similar-file.ts` — [what pattern to follow]

**Understand constraints:**
- `path/to/config.ts` — [what constraint this imposes]
```

This section is critical — it prevents the executor from guessing and ensures they understand context before acting.

### 4. Steps
Numbered, ordered steps. Each step should be:
- **Specific** — name exact files, functions, line numbers when known
- **Verifiable** — executor can confirm each step is done
- **Scoped** — one concern per step

For **investigation tasks**, structure as a decision tree:
```
1. Check X
2. If X shows A → do this
3. If X shows B → do that instead
```

For **implementation tasks**, structure as a checklist:
```
1. Modify file X — change Y to Z
2. Update file W — add the new registration
3. Verify: run command
```

### 5. Key Facts (don't re-discover)
Include facts you already found during exploration so the executor doesn't waste time:
```
### Key Facts
- DB connection: postgresql://postgres:postgres@localhost:5432/alt
- Backend port: 8001, health: GET /api/health
- Frontend port: 3000
- [any other known values]
```

### 6. Key Files Table
```
| File | What to check/modify |
|------|---------------------|
| path | description |
```

### 7. What NOT to Do
Explicit anti-patterns and guardrails:
```
### Do NOT
- Do not modify files outside the [module] directory
- Do not add new dependencies without checking existing utilities in shared/
- Do not use `any` types — find or create proper types
- Do not use `console.log` — use the project's logger (shared/logger.ts)
- Do not hardcode URLs — use env vars
- Do not run `git add .` or `git add -A` — only stage files you modified for this task
- Do not revert, checkout, or restore files you didn't modify — other agents may have changed them
```

### 8. Validation
How the executor verifies their work is complete and correct:
```
### Validation
1. `cd backend && npx tsc --noEmit` — 0 errors
2. `cd frontend && npm run build` — succeeds
3. `curl http://localhost:8001/api/health` — returns ok
4. [task-specific checks with exact commands]
5. **Commit:** `git add <specific files> && git commit -m "[TASK-NAME] description"`
```

Always include:
- TypeScript compilation check (if backend changed)
- Frontend build check (if frontend changed)
- Health check (if backend changed)
- Functional verification (task-specific curl/query commands)

---

## Quality Checklist for Your Prompt

Before delivering the prompt, verify:

- [ ] **No ambiguity** — Could two different agents interpret this differently? If yes, be more specific.
- [ ] **Files are named** — Every file to read or modify has an explicit path
- [ ] **Patterns referenced** — If the executor should follow an existing pattern, point to a concrete example file
- [ ] **Validation is runnable** — Every validation step is a command that can be copy-pasted
- [ ] **Scope is clear** — The executor knows exactly when they're done
- [ ] **Anti-patterns listed** — Common mistakes for this type of task are called out
- [ ] **No execution** — You (the planner) did NOT make any changes, only produced the prompt

---

## Prompt Sizing Guide

| Task complexity | Prompt length | Investigation depth |
|----------------|---------------|-------------------|
| Simple rename/fix | 30-50 lines | List the file + line to change |
| Multi-file change | 80-120 lines | List all files, patterns, validation |
| Investigation + fix | 120-200 lines | Decision tree, multiple hypotheses, DB queries |
| New feature/integration | 150-250 lines | Architecture context, all touch points, examples |

Don't pad simple tasks. Don't compress complex ones.

---

## Save to File & Summary (ALWAYS do BOTH after the task prompt)

### Step 1: Save the prompt to a file
Write the FULL executor prompt (everything from `## Task:` through `### Validation` including the Parallel Agent Protocol) to:
`tasks/executor-<task-name>.md`
- Example: `tasks/executor-drift-vault-fix.md`
- The task-name is derived from the Header (lowercase, hyphens, no spaces)

### Step 2: Produce a summary with file link
This is NOT part of the executor prompt — it's for the planner to quickly verify correctness.

Format:
```
### Task Summary: [Task Name]
📋 **Prompt:** `tasks/executor-<task-name>.md`
**Problem:** [1 sentence — what's broken/missing]
**Root cause:** [1 sentence — why it's happening]
**Fix:** [1-2 sentences — what the executor will change and why that solves it]
**Files:** [comma-separated list of files to modify]
```

Keep it under 5 sentences total. Focus on concept and logic, not implementation details.
