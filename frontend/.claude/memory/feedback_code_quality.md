---
name: Code quality expectations
description: User expects elegant, clean, reusable code — no ISLOBs, use utilities/helpers, modular structure
type: feedback
---

Write elegant, readable, production-quality code. Always reuse existing utilities, hooks, and shared modules. Extract helpers/functions instead of inlining logic. Avoid ISLOBs (Incredibly Simple Little One-off Blocks). Follow modular/microservice-like structure — each function does one thing well.

**Why:** User is building a production app and values maintainability, clean architecture, and code reuse above all.

**How to apply:** Before writing new code, check existing modules in `lib/`, `lib/hooks/`, `components/`. Extract shared logic into utilities. Keep functions focused and composable. Code should be self-documenting.
