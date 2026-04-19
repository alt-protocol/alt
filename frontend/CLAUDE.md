# Frontend CLAUDE.md

## Commands
```
npm run dev    # :3000
npm run build  # PostToolUse hook validates after edits
```

## Architecture
- Route group `(app)` in `src/app/(app)/` — shared layout with nav/wallet
- Landing page at `src/app/page.tsx` (outside group)
- Category registry in `src/lib/categories/` — drives filters, sidebar, detail pages. One definition file per category.
- State: TanStack Query only. No global store.

## Key Modules (check before creating new code)
- `lib/format.ts` — all formatters (`fmtNum`, `fmtApy`, `fmtTvl`, `fmtUsd`, `fmtPct`, `fmtDays`, `fmtDate`, etc.). Return em-dash for null.
- `lib/api.ts` — all API calls + response types (`YieldOpportunity`, `UserPositionOut`, etc.). Add endpoints here, never inline fetch.
- `lib/categories/` — category registry + definitions. Never add category conditionals in components.
- `lib/hooks/` — reusable hooks (`useTransaction`, `useOptimisticBalanceUpdate`, `useInvalidateAfterTransaction`, `useYieldFilters`, `useTokenBalance`, `usePortfolioData`, etc.). Check before writing new state logic.
- `lib/rpc.ts` — shared Solana RPC singleton (`getRpc()`, `getRpcSubscriptions()`). Never create new RPC instances.
- `lib/transaction-utils.ts` — `buildTransactionMessage`, `mapTxError`
- `lib/instruction-converter.ts` — `convertLegacyInstruction`, `convertJupiterApiInstruction`
- `components/` — shared UI (`CategoryDetailView`, `StatsGrid`, `TabBar`, `PeriodSelector`, `PositionTable`, etc.). Check before creating new components.

## Rules

### Do
- TanStack Query for all data fetching (never `useEffect`)
- `@/` path alias for all imports (never relative beyond `./`)
- `import type { ... }` when importing only types
- Tailwind only (no inline styles, CSS modules, styled-components)
- CSS variables for colors (`var(--surface-low)`, `var(--neon-primary)`)
- Dynamic import with `{ ssr: false }` for chart components and wallet-dependent panels
- Mobile responsive: tables need `lg:hidden` card view + `hidden lg:block` table view
- Use typed extractors from `lib/categories/extra-data.ts` for `extra_data` fields
- Pages max 300 lines, components max 250 lines — extract hooks when larger
- Table styling: `text-[0.8rem] font-sans`, header `text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface`
- Use `pnlColor(n)` from format.ts for PnL styling

### Don't
- `rounded-lg`, `rounded-xl`, `rounded-full` on containers — only `rounded-sm` or `rounded-none`
- 1px borders for separation — use surface color shifts per DESIGN.md
- Legacy `@solana/wallet-adapter-*` or `@solana/web3.js` v1
- Category-specific `if` checks in components — use registry
- Inline `extra_data` casts — use typed extractors
- Local `fmtX` functions — import from format.ts
- `useEffect` for data fetching
