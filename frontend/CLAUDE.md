# Frontend CLAUDE.md

## Commands
```bash
npm install
npm run dev    # http://localhost:3000
npm run build  # production build (PostToolUse hook runs this after edits)
```

Requires `.env.local` with `NEXT_PUBLIC_HELIUS_RPC_URL`. `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000`.

## Architecture

### Routing
Uses `(app)` route group layout in `src/app/(app)/` for dashboard, portfolio, and yield detail pages. Landing page at `src/app/page.tsx` outside the group.

### Protocol Adapters (`src/lib/protocols/`)
- `types.ts` — `ProtocolAdapter` interface: `buildDepositTx` and `buildWithdrawTx` return `Instruction[]` (or with lookup table addresses)
- `kamino.ts`, `drift.ts`, `jupiter.ts` — protocol-specific implementations
- `index.ts` — registry mapping protocol slugs to adapters

### Transaction Flow
1. Adapter builds instructions from `BuildTxParams` (signer, depositAddress, amount, category, extraData)
2. `DepositWithdrawPanel` assembles transaction, signs via wallet, submits to Helius RPC
3. Backend is never involved in signing

### Wallet
Uses `@solana/kit` + `@solana/react` (Wallet Standard) — NOT legacy `@solana/wallet-adapter-*`. Providers in `SolanaProviders.tsx`.

### State Management
TanStack Query for all server state. No global store (Redux, Zustand, etc.).

### Design System
All UI must follow `DESIGN.md`. See root `CLAUDE.md` for key constraints summary.

## Code Style

- New pages go in `src/app/(app)/` route group (shared layout with nav/wallet)
- New protocol adapters: implement `ProtocolAdapter` from `types.ts`, add to registry in `index.ts`
- API calls: add functions to `lib/api.ts`, consume via TanStack Query hooks in components
- Never use `useEffect` for data fetching — always TanStack Query (`useQuery`/`useMutation`)
- Never use legacy `@solana/wallet-adapter-*` or `@solana/web3.js` v1 — use `@solana/kit` + `@solana/react`
- Never use `rounded-lg`, `rounded-xl`, `rounded-full` on containers — only `rounded-sm` or `rounded-none`
- Never add 1px borders for section separation — use surface color shifts per DESIGN.md
- Tailwind only — no inline styles, no CSS modules, no styled-components

## Shared Modules Reference

Always check these before creating new functions — most common utilities already exist.

### Utilities (`src/lib/`)
- `format.ts` — all formatting: `fmtNum`, `fmtApy`, `fmtTvl`, `fmtUsd`, `fmtPct`, `fmtDays`, `fmtDate`, `fmtDateShort`, `fmtCategory`, `fmtProductType`, `truncateId`, `pnlColor`
- `instruction-converter.ts` — `convertLegacyInstruction`, `convertJupiterApiInstruction` for building transactions from protocol SDKs
- `api.ts` — `api.getYields()`, `api.getPositions()`, etc. Add new endpoints here, never inline fetch calls. Types (`YieldOpportunity`, `UserPositionOut`, etc.) also live here.
- `constants.ts` — `API_URL`, `HELIUS_RPC_URL`, `TOKEN_MINTS`
- `jupiter-swap.ts` — Jupiter swap integration (V6 API quoter/swapper for klend-sdk)
- `kswap.ts` — KSwap swap provider for Kamino Multiply: `createKswapQuoter`, `createKswapSwapper`, `getTokenPrice`, `getKswapSdkInstance`. Routes through multiple DEXes, optimizes for tx size.
- `multiply-luts.ts` — LUT (Address Lookup Table) management for Multiply txs: `fetchCdnLuts`, `resolveMissingLuts`, `selectBestRoute`, `assembleMultiplyLuts`. Handles CDN LUTs, user LUTs, and missing account resolution via Kamino API.

### Hooks (`src/lib/hooks/`)
- `useClickOutside.ts` — `useClickOutside(ref, isActive, onClickOutside)`
- `useYieldFilters.ts` — `useYieldFilters(yields)` returns filter/sort state + filtered results
- `useTokenBalance.ts` — fetch SPL token balance for connected wallet
- `useVaultTransaction.ts` — deposit/withdraw transaction lifecycle (vault, lending)
- `useMultiplyTransaction.ts` — multiply transaction lifecycle with setup phase: `"idle" | "preparing" | "building" | "signing" | "confirming" | "success" | "error"`. Handles user LUT setup txs before main multiply tx.
- `usePositionForOpportunity.ts` — `usePositionForOpportunity(walletAddress, opportunityId)` returns user's active position for a specific yield opportunity (used by withdraw tab)
- `usePortfolioData.ts` — wallet tracking, position fetching, history, events, summary computations

### Components (`src/components/`)
- `PositionTable.tsx` — data-driven table via `ColumnDef[]`, use `getColumnsForType(type)`
- `FilterPanel.tsx` — reusable filter UI, takes hook state as props
- `ProtocolChip.tsx` — protocol badge with icon
- `Dropdown.tsx` — styled dropdown menu
- `StatsGrid.tsx` — data-driven stats grid with `StatItem[]`, supports `size` ("default"/"lg") and custom `columns`
- `PeriodSelector.tsx` — 7d/30d/90d toggle, `variant` "surface" (default) or "neon"
- `TabBar.tsx` — horizontal equal-width tab toggle with gap-[1px] bg-outline-ghost pattern
- `WalletModal.tsx` — wallet connection modal (detected + popular wallets list)
- `DepositWithdrawPanel.tsx` — vault/lending deposit/withdraw flow
- `MultiplyPanel.tsx` — Kamino Multiply open/withdraw/close with leverage selector, projected APY, KSwap routing. Uses `useMultiplyTransaction` hook.
- `EventsTable.tsx` — transaction history table with mobile card view + desktop table
- `PortfolioStates.tsx` — `LoadingSkeleton`, `NoWalletState`, `ErrorState`, `SyncingState` for portfolio page
- `ApyChart.tsx`, `PortfolioChart.tsx` — Recharts-based charts (dynamically imported)

## Coding Patterns

### Formatting
- Always import from `@/lib/format` — never define local `fmtX` functions
- Formatters return "—" (em-dash) for null/undefined — don't handle this in JSX

### Colors & Styling
- Always use CSS variables (`var(--surface-low)`, `var(--neon-primary)`, `var(--foreground-muted)`), never hardcoded hex in components/charts
- PnL styling: use `pnlColor(n)` from format.ts — returns Tailwind class

### Instructions & Transactions
- Use `convertLegacyInstruction` or `convertJupiterApiInstruction` from `lib/instruction-converter.ts`
- Click-outside: use `useClickOutside` hook, never write inline mousedown useEffect

### Data & Types
- Types live in `lib/api.ts` (e.g. `YieldOpportunity`, `UserPositionOut`), import from there
- Hook composition: extract complex state into `lib/hooks/` when a page component exceeds ~300 lines

### Component Size
- Pages ≤300 lines, components ≤250 lines — extract hooks/sub-components when larger
- Dynamic imports: use `next/dynamic` with `{ ssr: false }` for chart components (Recharts) and wallet-dependent panels

## Table/List Patterns

- For position tables: use `PositionTable` + `getColumnsForType()`, don't create inline tables
- Mobile: every table MUST have a `lg:hidden` card view + `hidden lg:block` table view
- Table styling: `text-[0.8rem] font-sans`, header: `text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface`

## File Organization

- Pages: `src/app/(app)/<route>/page.tsx` — keep page logic thin, delegate to hooks and components
- Components: `src/components/` — shared UI components
- Hooks: `src/lib/hooks/` — reusable state/behavior hooks
- Protocols: `src/lib/protocols/` — one file per protocol implementing `ProtocolAdapter`
- Utilities: `src/lib/` — `format.ts`, `api.ts`, `constants.ts`, `instruction-converter.ts`, `jupiter-swap.ts`

## Import Conventions

- Always use `@/` path alias (never relative beyond `./`)
- Group: React/Next → third-party → `@/lib` → `@/components`
- Type imports: use `import type { ... }` when importing only types
