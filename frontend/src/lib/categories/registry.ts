import type { ComponentType } from "react";
import type { YieldOpportunityDetail } from "@/lib/api";

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
  value: string;
}

export interface ActionPanelProps {
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
}

export interface ChartReferenceLine {
  value: number;
  label: string;
  color: string;
}

export interface CategoryDefinition {
  slug: string;
  displayName: string;
  sidebarLabel: string;

  /* Detail page */
  statsGrid: (y: YieldOpportunityDetail) => StatItem[];
  detailFields: (y: YieldOpportunityDetail) => DetailFieldDef[];
  titleFormatter?: (y: YieldOpportunityDetail) => string;
  /** Label for the detail section (defaults to "Details") */
  detailSectionLabel?: string;
  /** Badge shown instead of category badge in title row (e.g. vault tag for multiply) */
  titleBadge?: (y: YieldOpportunityDetail) => string | null;

  /* Action panel */
  actionPanelType: "deposit-withdraw" | "custom";
  actionPanelComponent?: () => Promise<{ default: ComponentType<ActionPanelProps> }>;

  /* Transaction lifecycle */
  transactionType: "simple" | "multi-step";

  /** Optional strategy description shown on detail page */
  strategyDescription?: (y: YieldOpportunityDetail) => string | null;

  /** Optional reference lines for the APY chart (e.g. borrow APY for multiply) */
  chartReferenceLines?: (y: YieldOpportunityDetail) => ChartReferenceLine[];
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
