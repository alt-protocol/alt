"use client";

import { useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { YieldOpportunityDetail } from "@/lib/api";
import { fmtCategory, fmtVaultTag } from "@/lib/format";
import { queryKeys } from "@/lib/queryKeys";
import { hasAdapter } from "@/lib/protocols";
import { getCategoryDef } from "@/lib/categories";
import { getMultiplyExtra } from "@/lib/categories/extra-data";
import { ProtocolChip } from "@/components/ProtocolChip";
import { DetailRow } from "@/components/DetailRow";
import StatsGrid from "@/components/StatsGrid";
import RefreshButton from "@/components/RefreshButton";
import ApyHistorySection from "@/components/ApyHistorySection";
import ProtocolFallbackPanel from "@/components/ProtocolFallbackPanel";

const DepositWithdrawPanel = dynamic(
  () => import("@/components/DepositWithdrawPanel"),
  { ssr: false },
);

interface Props {
  yield_: YieldOpportunityDetail;
  id: string;
}

export default function CategoryDetailView({ yield_: y, id }: Props) {
  const categoryDef = getCategoryDef(y.category);
  const stats = categoryDef?.statsGrid(y) ?? [];
  const detailFields = categoryDef?.detailFields(y) ?? [];
  const title = categoryDef?.titleFormatter?.(y) ?? y.name;

  /* Multiply-specific: vault tag badge */
  const vaultTag = y.category === "multiply"
    ? getMultiplyExtra(y.extra_data, y.tokens).vault_tag
    : null;

  /* Resolve action panel */
  const CustomPanel = useMemo(() => {
    if (categoryDef?.actionPanelType === "custom" && categoryDef.actionPanelComponent) {
      return dynamic(() => categoryDef.actionPanelComponent!(), { ssr: false });
    }
    return null;
  }, [categoryDef]);

  const hasPanel = y.protocol?.slug && hasAdapter(y.protocol.slug) && y.deposit_address;

  return (
    <>
      <Link
        href="/dashboard"
        className="text-foreground-muted font-sans text-[0.75rem] uppercase tracking-[0.05em] hover:text-foreground transition-colors inline-block mb-6"
      >
        &larr; Discover
      </Link>

      {/* Title row */}
      <div className="flex items-center gap-3 mb-6">
        <h1 className="font-display text-2xl tracking-[-0.02em]">{title}</h1>
        {vaultTag && (
          <span className="bg-surface-high text-foreground-muted rounded-sm px-2.5 py-0.5 text-[0.65rem] font-sans uppercase tracking-[0.05em]">
            {fmtVaultTag(vaultTag)}
          </span>
        )}
        {y.protocol_name && <ProtocolChip slug={y.protocol_name} />}
        {!vaultTag && (
          <span className="bg-surface-high text-foreground-muted rounded-sm px-2.5 py-0.5 text-[0.65rem] font-sans uppercase tracking-[0.05em]">
            {fmtCategory(y.category)}
          </span>
        )}
        <RefreshButton queryKeys={[queryKeys.yields.detail(id)]} className="ml-auto" />
      </div>

      {/* Stats grid */}
      {stats.length > 0 && (
        <StatsGrid
          stats={stats}
          columns={`grid-cols-${Math.min(stats.length, 4)}`}
          className="mb-[1.5rem]"
        />
      )}

      {/* Two-column: details + action panel */}
      <div className="flex gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[1.5rem]">
        <div className="flex-[2] bg-surface-low px-6 py-5">
          <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-4">
            {y.category === "multiply" ? "Looping Overview" : "Details"}
          </p>
          <div className="divide-y divide-outline-ghost">
            {detailFields.map((f) => (
              <DetailRow key={f.label} label={f.label} value={f.value} />
            ))}
          </div>
        </div>

        {/* Action panel */}
        {hasPanel ? (
          categoryDef?.actionPanelType === "custom" && CustomPanel ? (
            <CustomPanel yield_={y} protocolSlug={y.protocol!.slug} />
          ) : (
            <DepositWithdrawPanel yield_={y} protocolSlug={y.protocol!.slug} />
          )
        ) : (
          <ProtocolFallbackPanel
            apy={y.apy_current}
            protocolUrl={y.protocol_url ?? y.protocol?.website_url ?? null}
            protocolName={y.protocol_name}
          />
        )}
      </div>

      <ApyHistorySection id={id} initialSnapshots={y.recent_snapshots} />
    </>
  );
}
