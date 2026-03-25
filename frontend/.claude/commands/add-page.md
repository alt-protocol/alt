# Add a New Page

Create a new page in the `(app)` route group. The user will provide the route name and purpose.

## Arguments
- `$ARGUMENTS` — route name and brief description (e.g. "analytics - protocol performance overview")

## Instructions

Create a new page at `src/app/(app)/<route>/page.tsx` following these patterns:

### File Structure
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { fmtUsd, fmtApy, fmtTvl } from "@/lib/format"; // pick relevant formatters
import StatsGrid from "@/components/StatsGrid";
// Add as needed:
// import PeriodSelector, { type Period } from "@/components/PeriodSelector";
// import TabBar from "@/components/TabBar";
// import dynamic from "next/dynamic";
// const SomeChart = dynamic(() => import("@/components/SomeChart"), { ssr: false });

export default function PageName() {
  // Data fetching — always useQuery, never useEffect
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["key"],
    queryFn: () => api.getSomething(),
  });

  return (
    <main className="max-w-[1200px] mx-auto px-4 sm:px-8 lg:px-[3.5rem] py-[2.25rem]">
      {/* Loading skeleton */}
      {isLoading && <LoadingSkeleton />}

      {/* Error state */}
      {isError && (
        <div className="text-center py-16">
          <p className="text-red-400 font-sans text-sm">Failed to load data</p>
          <pre className="mt-2 text-xs text-foreground-muted">
            {error instanceof Error ? error.message : "Unknown error"}
          </pre>
        </div>
      )}

      {/* Content */}
      {data && (
        <>
          <h1 className="font-display text-2xl tracking-[-0.02em] mb-[2.25rem]">Page Title</h1>

          <StatsGrid
            stats={[
              { label: "Metric", value: "..." },
            ]}
            className="mb-[2.25rem]"
          />

          {/* Main content area */}
        </>
      )}
    </main>
  );
}
```

### Loading Skeleton Pattern
```tsx
function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface-low px-5 py-4">
            <div className="bg-surface-high animate-pulse rounded-sm h-3 w-16 mb-2" />
            <div className="bg-surface-high animate-pulse rounded-sm h-7 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Key Rules
1. **Imports**: Use `@/` path alias. Group: React/Next → third-party → `@/lib` → `@/components`
2. **Data**: Always TanStack Query (`useQuery`), never `useEffect` for fetching. API functions in `@/lib/api.ts`.
3. **Formatting**: Import from `@/lib/format` — never define local formatters. Formatters return "—" for null.
4. **Styling**: Tailwind only. CSS variables for colors (`var(--surface-low)`, `var(--neon-primary)`). No `rounded-lg/xl/full` — only `rounded-sm` or `rounded-none`. No 1px borders.
5. **Shared components**: Use `StatsGrid` for metrics, `PeriodSelector` for time toggles, `TabBar` for tab navigation.
6. **Charts**: Dynamic import with `{ ssr: false }` for any Recharts components.
7. **Wallet pages**: Use `useSelectedWalletAccount` from `@solana/react` (NOT legacy adapter).
8. **Tables**: Every table MUST have `lg:hidden` card view + `hidden lg:block` table view. Use `PositionTable` + `getColumnsForType()` for position data.
9. **Component size**: Pages ≤300 lines. Extract hooks to `src/lib/hooks/` when exceeding.
10. **Deposit/withdraw panels**: Dynamic import `DepositWithdrawPanel` with `{ ssr: false }`.
