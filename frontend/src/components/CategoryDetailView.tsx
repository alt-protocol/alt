"use client";

import { lazy, Suspense, useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSelectedWalletAccount } from "@solana/react";
import type { YieldOpportunityDetail } from "@/lib/api";
import { fmtCategory, fmtPegAdherence, fmtDeviation, fmtVolatility, fmtTvl, fmtUsd, fmtPct, fmtApy, pnlColor, pegColor } from "@/lib/format";
import { queryKeys } from "@/lib/queryKeys";
import { getCategoryDef } from "@/lib/categories";
import { usePositionForOpportunity } from "@/lib/hooks/usePositionForOpportunity";

import type { CategoryDefinition } from "@/lib/categories/registry";
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

interface ActionPanelProps {
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
}

/** Module-level cache: one lazy component per category slug, created once. */
const panelCache = new Map<string, React.LazyExoticComponent<ComponentType<ActionPanelProps>>>();

function getCustomPanel(def: CategoryDefinition | undefined): React.LazyExoticComponent<ComponentType<ActionPanelProps>> | null {
  if (def?.actionPanelType !== "custom" || !def.actionPanelComponent) return null;
  let panel = panelCache.get(def.slug);
  if (!panel) {
    const loader = def.actionPanelComponent;
    panel = lazy(() => loader());
    panelCache.set(def.slug, panel);
  }
  return panel;
}

type PageTab = "overview" | "position";

interface Props {
  yield_: YieldOpportunityDetail;
  id: string;
}

export default function CategoryDetailView({ yield_: y, id }: Props) {
  const categoryDef = getCategoryDef(y.category);
  const stats = categoryDef?.statsGrid(y) ?? [];
  const detailFields = categoryDef?.detailFields(y) ?? [];
  const title = categoryDef?.titleFormatter?.(y) ?? y.name;
  const titleBadge = categoryDef?.titleBadge?.(y) ?? null;

  // eslint-disable-next-line react-hooks/static-components -- stable: getCustomPanel returns a module-level cached lazy component per category slug
  const CustomPanel = getCustomPanel(categoryDef);
  const hasPanel = y.protocol?.slug && y.deposit_address;

  // Position detection — uses fast cached DB data (no RPC calls)
  const [selectedAccount] = useSelectedWalletAccount();
  const walletAddress = selectedAccount?.address;
  const { position } = usePositionForOpportunity(walletAddress, y.id);
  const hasPosition = position != null && !position.is_closed;

  // Tab state — default to "My Position" if user has a position
  const [pageTab, setPageTab] = useState<PageTab>(hasPosition ? "position" : "overview");

  // Action panel — rendered in both tabs
  const actionPanel = hasPanel ? (
    CustomPanel ? (
      <Suspense fallback={null}>
        {/* eslint-disable-next-line react-hooks/static-components -- stable: module-level cached lazy component per category slug */}
        <CustomPanel yield_={y} protocolSlug={y.protocol!.slug} />
      </Suspense>
    ) : (
      <DepositWithdrawPanel yield_={y} protocolSlug={y.protocol!.slug} />
    )
  ) : (
    <ProtocolFallbackPanel
      apy={y.apy_current}
      protocolUrl={y.protocol_url ?? y.protocol?.website_url ?? null}
      protocolName={y.protocol_name}
    />
  );

  return (
    <>
      <Link
        href="/discover"
        className="text-foreground-muted font-sans text-[0.75rem] uppercase tracking-[0.05em] hover:text-foreground transition-colors inline-block mb-6"
      >
        &larr; Discover
      </Link>

      {/* Title */}
      <div className="flex items-center gap-3 mb-4">
        <h1 className="font-display text-2xl tracking-[-0.02em]">{title}</h1>
        {titleBadge && (
          <span className="bg-surface-high text-foreground-muted rounded-sm px-2.5 py-0.5 text-[0.65rem] font-sans uppercase tracking-[0.05em]">
            {titleBadge}
          </span>
        )}
        {y.protocol_name && <ProtocolChip slug={y.protocol_name} />}
        {!titleBadge && (
          <span className="bg-surface-high text-foreground-muted rounded-sm px-2.5 py-0.5 text-[0.65rem] font-sans uppercase tracking-[0.05em]">
            {fmtCategory(y.category)}
          </span>
        )}
        <RefreshButton queryKeys={[queryKeys.yields.detail(id)]} className="ml-auto" />
      </div>

      {/* Page tabs — only show if user has an active position */}
      {walletAddress && hasPosition && (
        <div className="flex gap-6 mb-6 border-b border-outline-ghost">
          {(["overview", "position"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setPageTab(t)}
              className={`pb-2 text-[0.8rem] font-sans transition-colors ${
                pageTab === t
                  ? "text-foreground border-b-2 border-neon"
                  : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {t === "overview" ? "Overview" : "My Position"}
            </button>
          ))}
        </div>
      )}

      {/* ── OVERVIEW TAB ── */}
      {(pageTab === "overview" || !walletAddress) && (
        <>
          {stats.length > 0 && (
            <StatsGrid
              stats={stats}
              columns={`grid-cols-${Math.min(stats.length, 4)}`}
              className="mb-[1.5rem]"
            />
          )}

          <div className="flex gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[1.5rem]">
            <div className="flex-[2] bg-surface-low px-6 py-5">
              <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-4">
                {categoryDef?.detailSectionLabel ?? "Details"}
              </p>
              <div className="divide-y divide-outline-ghost">
                {detailFields.map((f) => (
                  <DetailRow key={f.label} label={f.label} value={f.value} />
                ))}
              </div>
            </div>
            {actionPanel}
          </div>

          {categoryDef?.strategyDescription?.(y) && (
            <div className="bg-surface-low rounded-sm px-6 py-5 mb-[1.5rem]">
              <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-2">Strategy</p>
              <p className="font-sans text-[0.8rem] text-foreground-muted leading-relaxed">
                {categoryDef.strategyDescription(y)}
              </p>
            </div>
          )}

          {y.peg_stability && (
            <div className="bg-surface-low rounded-sm px-6 py-5 mb-[1.5rem]">
              <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-4">
                Peg Stability {"\u2014"} {y.peg_stability.symbol}
                {y.peg_stability.peg_type === "yield_bearing" && (
                  <span className="ml-2 text-[0.55rem] normal-case tracking-normal text-foreground-muted">(yield-bearing)</span>
                )}
              </p>
              {y.peg_stability.snapshot_count_7d < 2 ? (
                <p className="font-sans text-[0.8rem] text-foreground-muted">Price tracking started recently. Stats will appear shortly.</p>
              ) : (
                <div className="divide-y divide-outline-ghost">
                  <DetailRow label="Current Price" value={y.peg_stability.price_current != null ? `$${y.peg_stability.price_current.toFixed(4)}` : "\u2014"} />
                  {y.peg_stability.peg_type === "fixed" && y.peg_stability.peg_target != null && (
                    <DetailRow label="Peg Target" value={`$${y.peg_stability.peg_target.toFixed(2)}`} />
                  )}
                  {y.peg_stability.peg_type === "fixed" && (
                    <DetailRow
                      label="7D Peg Adherence"
                      value={<span className={pegColor(y.peg_stability.peg_adherence_7d)}>{fmtPegAdherence(y.peg_stability.peg_adherence_7d)}</span>}
                    />
                  )}
                  {y.peg_stability.peg_type === "fixed" && (
                    <DetailRow label="7D Max Deviation" value={fmtDeviation(y.peg_stability.max_deviation_7d)} />
                  )}
                  {y.peg_stability.peg_type === "yield_bearing" && (
                    <DetailRow label="7D Volatility" value={fmtVolatility(y.peg_stability.volatility_7d)} />
                  )}
                  {y.peg_stability.min_price_7d != null && y.peg_stability.max_price_7d != null && (
                    <DetailRow label="7D Price Range" value={`$${y.peg_stability.min_price_7d.toFixed(4)} \u2013 $${y.peg_stability.max_price_7d.toFixed(4)}`} />
                  )}
                  {y.peg_stability.snapshot_count_30d >= 2 && y.peg_stability.peg_type === "fixed" && (
                    <DetailRow
                      label="30D Peg Adherence"
                      value={<span className={pegColor(y.peg_stability.peg_adherence_30d)}>{fmtPegAdherence(y.peg_stability.peg_adherence_30d)}</span>}
                    />
                  )}
                  {y.peg_stability.snapshot_count_30d >= 2 && y.peg_stability.peg_type === "yield_bearing" && (
                    <DetailRow label="30D Volatility" value={fmtVolatility(y.peg_stability.volatility_30d)} />
                  )}
                  {y.peg_stability.liquidity_usd != null && (
                    <DetailRow label="DEX Liquidity" value={fmtTvl(y.peg_stability.liquidity_usd)} />
                  )}
                </div>
              )}
            </div>
          )}

          <ApyHistorySection id={id} initialSnapshots={y.recent_snapshots} referenceLines={categoryDef?.chartReferenceLines?.(y)} />
        </>
      )}

      {/* ── MY POSITION TAB ── */}
      {pageTab === "position" && walletAddress && (
        <div className="flex gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[1.5rem]">
          <div className="flex-[2] bg-surface-low px-6 py-5">
            {!hasPosition ? (
              <div className="flex flex-col items-center justify-center py-12">
                <p className="text-foreground-muted font-sans text-[0.8rem] mb-2">No active position</p>
                <p className="text-foreground-muted/60 font-sans text-[0.7rem]">Open a position to see your stats here</p>
              </div>
            ) : (() => {
              // Use cached DB data (instant) — on-chain stats upgrade inside MultiplyPanel
              const ex = position?.extra_data as Record<string, unknown> | undefined;
              const lev = (ex?.leverage as number) ?? null;
              const ltv = (ex?.ltv as number) ?? null;
              const dep = (ex?.total_deposit_usd as number) ?? null;
              const bor = (ex?.total_borrow_usd as number) ?? null;
              const liqLtv = (ex?.liquidation_ltv as number) ?? null;
              const hf = (ex?.health_factor as number) ?? null;
              return (
                <>
                  <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-4">Position Overview</p>
                  <div className="divide-y divide-outline-ghost text-[0.8rem] font-sans">
                    <DetailRow label="Net Value" value={fmtUsd(position?.deposit_amount_usd)} />
                    <DetailRow label="PnL" value={<span className={pnlColor(position?.pnl_usd ?? 0)}>{fmtUsd(position?.pnl_usd)} ({fmtPct(position?.pnl_pct)})</span>} />
                    {lev != null && <DetailRow label="Leverage" value={`${lev.toFixed(2)}x`} />}
                    <DetailRow label="Current APY" value={<span className="text-neon">{fmtApy(position?.apy)}</span>} />
                    {dep != null && <DetailRow label={`${y.tokens[0] ?? "Coll"} Supplied`} value={fmtUsd(dep)} />}
                    {bor != null && <DetailRow label={`${y.tokens[1] ?? "Debt"} Borrowed`} value={fmtUsd(bor)} />}
                    {ltv != null && <DetailRow label="Position LTV" value={fmtPct(ltv * 100)} />}
                    {liqLtv != null && <DetailRow label="Liquidation LTV" value={fmtPct(liqLtv * 100)} />}
                    {hf != null && <DetailRow label="Health Factor" value={hf.toFixed(2)} />}
                    {position?.held_days != null && <DetailRow label="Days Held" value={`${Math.round(position.held_days)}d`} />}
                  </div>
                </>
              );
            })()}
          </div>
          {actionPanel}
        </div>
      )}
    </>
  );
}
