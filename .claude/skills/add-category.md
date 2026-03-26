---
name: add-category
description: Scaffold a new yield category integration (definition, registry, optional action panel, optional extra_data types)
user_invocable: true
---

# Add Category Integration

Scaffold a new yield category for Akashi. This registers a category definition so the UI auto-adapts (filter dropdowns, portfolio sidebar, detail pages, position tables).

**Ask the user for:** category slug, display name, sidebar label, and whether it needs a custom action panel or custom extra_data fields.

---

## Step 1: Category definition

Create `frontend/src/lib/categories/definitions/{slug}.tsx`:

```tsx
import type { CategoryDefinition } from "../registry";
import { fmtApy, fmtTvl, fmtUsd, fmtDays, pnlColor, truncateId } from "@/lib/format";
import { ApyCell } from "@/components/PositionTable";

export const {camelName}Category: CategoryDefinition = {
  slug: "{slug}",
  displayName: "{DisplayName}",
  sidebarLabel: "{SIDEBAR_LABEL}",

  statsGrid: (y) => [
    { label: "APY Now", value: fmtApy(y.apy_current) },
    { label: "7D Avg", value: fmtApy(y.apy_7d_avg) },
    { label: "30D Avg", value: fmtApy(y.apy_30d_avg) },
    { label: "TVL", value: fmtTvl(y.tvl_usd) },
  ],

  detailFields: (y) => {
    const fields = [];
    if (y.tokens.length > 0) fields.push({ label: "Tokens", value: y.tokens.join(", ") });
    if (y.min_deposit != null) fields.push({ label: "Min Deposit", value: fmtTvl(y.min_deposit) });
    if (y.lock_period_days > 0) fields.push({ label: "Lock Period", value: `${y.lock_period_days}d` });
    // TODO: add category-specific detail fields
    return fields;
  },

  actionPanelType: "deposit-withdraw", // or "custom" if custom panel needed
  // actionPanelComponent: () => import("@/components/{Name}Panel"),
  transactionType: "simple", // or "multi-step" if setup txs needed

  positionColumns: (detailsAction) => [
    { header: "Name", align: "left", render: (p) => <span className="text-foreground">{truncateId(p.external_id)}</span> },
    { header: "Token", align: "left", render: (p) => <span className="text-foreground-muted">{p.token_symbol ?? "\u2014"}</span> },
    { header: "Net Value", align: "right", render: (p) => fmtUsd(p.deposit_amount_usd) },
    { header: "APY", align: "right", render: (p) => <ApyCell position={p} /> },
    { header: "PnL", align: "right", render: (p) => <span className={pnlColor(p.pnl_usd)}>{fmtUsd(p.pnl_usd)}</span> },
    { header: "Days Held", align: "right", render: (p) => <span className="text-foreground-muted">{fmtDays(p.held_days)}</span> },
    detailsAction,
  ],

  positionCardFields: (p) => {
    const forwardApy = (p.extra_data as Record<string, unknown> | null)?.forward_apy as number | null | undefined;
    const apyStr = forwardApy != null && p.apy !== forwardApy
      ? `${fmtApy(p.apy)} (${fmtApy(forwardApy)} mkt)`
      : fmtApy(p.apy);
    return [
      { label: "Net Value", value: fmtUsd(p.deposit_amount_usd) },
      { label: "APY", value: apyStr, colorClass: "text-neon" },
      { label: "PnL", value: fmtUsd(p.pnl_usd), colorClass: pnlColor(p.pnl_usd) },
      { label: "Days Held", value: fmtDays(p.held_days) },
    ];
  },
};
```

**Key patterns:**
- File must be `.tsx` (contains JSX in column/card renderers)
- Import `ApyCell` from `@/components/PositionTable` for APY column
- `positionColumns` receives a `detailsAction` column — always include it last
- `statsGrid` and `detailFields` return arrays — conditionally add fields based on yield data
- For custom title formatting (e.g. multiply uses "COL/DEBT Multiply"), set `titleFormatter`

---

## Step 2: Register in category index

Edit `frontend/src/lib/categories/index.ts`:

```typescript
import { {camelName}Category } from "./definitions/{slug}";

registerCategory({camelName}Category);
```

---

## Step 3 (optional): Custom action panel

If `actionPanelType: "custom"`, create `frontend/src/components/{Name}Panel.tsx`:

```tsx
import type { YieldOpportunityDetail } from "@/lib/api";

interface Props {
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
}

export default function {Name}Panel({ yield_, protocolSlug }: Props) {
  // Category-specific action UI
  return (
    <div className="flex-[1] bg-surface-low px-6 py-5 flex flex-col">
      {/* ... */}
    </div>
  );
}
```

Then set in definition:
```typescript
actionPanelComponent: () => import("@/components/{Name}Panel"),
```

---

## Step 4 (optional): Typed extra_data

If the category has protocol-specific extra_data fields, add to `frontend/src/lib/categories/extra-data.ts`:

```typescript
export interface {Name}ExtraData {
  // typed fields with defaults
}

export function get{Name}Extra(raw: Record<string, unknown> | null | undefined): {Name}ExtraData {
  const r = raw ?? {};
  return {
    // extract with defaults
  };
}
```

---

## Step 5: Verify

1. **Frontend build:** `cd frontend && npm run build` → no errors
2. **Filter dropdown:** category appears in filter options
3. **Portfolio sidebar:** category appears with count
4. **Detail page:** renders correctly with stats, fields, and action panel

---

## Checklist

- [ ] `frontend/src/lib/categories/definitions/{slug}.tsx` — category definition
- [ ] `frontend/src/lib/categories/index.ts` — registered
- [ ] (optional) `frontend/src/components/{Name}Panel.tsx` — custom action panel
- [ ] (optional) `frontend/src/lib/categories/extra-data.ts` — typed extra_data
- [ ] Build passes
- [ ] UI auto-adapts (filters, sidebar, detail page, position table)
