import type { ComponentType } from "react";
import type { YieldOpportunityDetail, UserPositionOut } from "@/lib/api";
import type { ColumnDef, PositionCardField } from "@/components/PositionTable";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface StatItem {
  label: string;
  value: string;
  sub?: string;
  colorClass?: string;
}

export interface DetailFieldDef {
  label: string;
  value: React.ReactNode;
}

export interface ActionPanelProps {
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
}

export interface CategoryDefinition {
  slug: string;
  displayName: string;
  sidebarLabel: string;

  /* Detail page */
  statsGrid: (y: YieldOpportunityDetail) => StatItem[];
  detailFields: (y: YieldOpportunityDetail) => DetailFieldDef[];
  titleFormatter?: (y: YieldOpportunityDetail) => string;

  /* Action panel */
  actionPanelType: "deposit-withdraw" | "custom";
  actionPanelComponent?: () => Promise<{ default: ComponentType<ActionPanelProps> }>;

  /* Transaction lifecycle */
  transactionType: "simple" | "multi-step";

  /* Position table (portfolio) */
  positionColumns: (detailsAction: ColumnDef) => ColumnDef[];
  positionCardFields: (p: UserPositionOut) => PositionCardField[];
}

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

const registry = new Map<string, CategoryDefinition>();

export function registerCategory(def: CategoryDefinition): void {
  registry.set(def.slug, def);
}

export function getCategoryDef(slug: string): CategoryDefinition | undefined {
  return registry.get(slug);
}

export function getAllCategories(): CategoryDefinition[] {
  return Array.from(registry.values());
}

export function getCategorySlugs(): string[] {
  return Array.from(registry.keys());
}

/* ------------------------------------------------------------------ */
/* Default "all" definition for portfolio overview                     */
/* ------------------------------------------------------------------ */

import { fmtUsd, fmtApy, fmtProductType, pnlColor } from "@/lib/format";
import { ProtocolChip } from "@/components/ProtocolChip";
import { ApyCell } from "@/components/PositionTable";

/** Columns/cards for the "all" overview tab — not a real category. */
export function getAllOverviewColumns(detailsAction: ColumnDef): ColumnDef[] {
  return [
    { header: "Protocol", align: "left", render: (p) => ProtocolChip({ slug: p.protocol_slug }) },
    { header: "Type", align: "left", render: (p) => <span className="text-foreground-muted">{fmtProductType(p.product_type)}</span> },
    { header: "Token", align: "left", render: (p) => <span className="text-foreground">{p.token_symbol ?? "\u2014"}</span> },
    { header: "Net Value", align: "right", render: (p) => fmtUsd(p.deposit_amount_usd) },
    { header: "PnL", align: "right", render: (p) => <span className={pnlColor(p.pnl_usd)}>{fmtUsd(p.pnl_usd)}</span> },
    { header: "APY", align: "right", render: (p) => <ApyCell position={p} /> },
    detailsAction,
  ];
}

export function getAllOverviewCardFields(p: UserPositionOut): PositionCardField[] {
  const forwardApy = (p.extra_data as Record<string, unknown> | null)?.forward_apy as number | null | undefined;
  const apyStr = forwardApy != null && p.apy !== forwardApy
    ? `${fmtApy(p.apy)} (${fmtApy(forwardApy)} mkt)`
    : fmtApy(p.apy);
  return [
    { label: "Net Value", value: fmtUsd(p.deposit_amount_usd) },
    { label: "PnL", value: fmtUsd(p.pnl_usd), colorClass: pnlColor(p.pnl_usd) },
    { label: "APY", value: apyStr, colorClass: "text-neon" },
  ];
}
