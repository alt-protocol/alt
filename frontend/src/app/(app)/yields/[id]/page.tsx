"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { fmtApy, fmtTvl, fmtDateShort, fmtCategory } from "@/lib/format";
import { queryKeys } from "@/lib/queryKeys";
import RefreshButton from "@/components/RefreshButton";

const ApyChart = dynamic(() => import("@/components/ApyChart"), { ssr: false });
import { ProtocolChip } from "@/components/ProtocolChip";
import { hasAdapter } from "@/lib/protocols";
import StatsGrid from "@/components/StatsGrid";
import PeriodSelector from "@/components/PeriodSelector";
const DepositWithdrawPanel = dynamic(
  () => import("@/components/DepositWithdrawPanel"),
  { ssr: false }
);
const MultiplyPanel = dynamic(
  () => import("@/components/MultiplyPanel"),
  { ssr: false }
);

function truncate(s: string, len = 20): string {
  if (s.length <= len) return s;
  return s.slice(0, 8) + "\u2026" + s.slice(-8);
}

import type { Period } from "@/components/PeriodSelector";

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-2">
      <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">{label}</span>
      <span className="font-sans text-[0.8rem] text-foreground">{value}</span>
    </div>
  );
}

export default function YieldDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [period, setPeriod] = useState<Period>("7d");

  const detailQuery = useQuery({
    queryKey: queryKeys.yields.detail(id),
    queryFn: () => api.getYieldDetail(Number(id)),
    enabled: !!id,
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.yields.history(id, period),
    queryFn: () => api.getYieldHistory(Number(id), period),
    enabled: !!id,
    initialData: period === "7d" && detailQuery.data?.recent_snapshots?.length
      ? { data: detailQuery.data.recent_snapshots }
      : undefined,
  });

  const y = detailQuery.data;
  const historyPoints = historyQuery.data?.data ?? [];

  const chartData = historyPoints.map((pt) => ({
    date: fmtDateShort(pt.snapshot_at),
    apy: pt.apy != null ? parseFloat(pt.apy.toFixed(2)) : null,
  }));

  return (
    <main className="max-w-[1200px] mx-auto px-[3.5rem] py-[2.25rem]">
      {/* Breadcrumb */}
      <Link
        href="/dashboard"
        className="text-foreground-muted font-sans text-[0.75rem] uppercase tracking-[0.05em] hover:text-foreground transition-colors inline-block mb-6"
      >
        ← Discover
      </Link>

      {/* Loading state */}
      {detailQuery.isLoading && (
        <div className="space-y-4">
          <div className="h-8 w-64 bg-surface-high rounded-sm animate-pulse" />
          <div className="grid grid-cols-4 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-surface-low px-5 py-4 h-20 animate-pulse" />
            ))}
          </div>
          <div className="h-[200px] bg-surface-low rounded-sm animate-pulse" />
        </div>
      )}

      {/* Error / not found */}
      {detailQuery.isError && (
        <div className="text-center py-24">
          <p className="text-foreground-muted font-sans text-sm">Opportunity not found.</p>
          <Link href="/dashboard" className="mt-3 inline-block text-neon font-sans text-[0.8rem] uppercase tracking-[0.05em] hover:underline">
            Back to Discover
          </Link>
        </div>
      )}

      {y && (
        <>
          {/* Title row */}
          <div className="flex items-center gap-3 mb-6">
            <h1 className="font-display text-2xl tracking-[-0.02em]">{y.name}</h1>
            {y.protocol_name && <ProtocolChip slug={y.protocol_name} />}
            <span className="bg-surface-high text-foreground-muted rounded-sm px-2.5 py-0.5 text-[0.65rem] font-sans uppercase tracking-[0.05em]">
              {fmtCategory(y.category)}
            </span>
            <RefreshButton
              queryKeys={[
                queryKeys.yields.detail(id),
                queryKeys.yields.history(id, period),
              ]}
              className="ml-auto"
            />
          </div>

          {/* Stats strip */}
          <StatsGrid
            stats={[
              { label: "APY Now", value: fmtApy(y.apy_current) },
              { label: "7D Avg", value: fmtApy(y.apy_7d_avg) },
              { label: "30D Avg", value: fmtApy(y.apy_30d_avg) },
              { label: "TVL", value: fmtTvl(y.tvl_usd) },
            ]}
            columns="grid-cols-4"
            className="mb-[1.5rem]"
          />

          {/* Two-column layout */}
          <div className="flex gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[1.5rem]">
            {/* Details card */}
            <div className="flex-[2] bg-surface-low px-6 py-5">
              <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-4">Details</p>
              <div className="divide-y divide-outline-ghost">
                {y.tokens.length > 0 && (
                  <DetailRow label="Tokens" value={y.tokens.join(", ")} />
                )}
                {y.min_deposit != null && (
                  <DetailRow label="Min Deposit" value={fmtTvl(y.min_deposit)} />
                )}
                {y.lock_period_days > 0 && (
                  <DetailRow label="Lock Period" value={`${y.lock_period_days}d`} />
                )}

                {/* Multiply-specific */}
                {y.category === "multiply" && (
                  <>
                    {y.max_leverage != null && (
                      <DetailRow label="Max Leverage" value={`${y.max_leverage}x`} />
                    )}
                    {y.liquidity_available_usd != null && (
                      <DetailRow label="Liquidity Available" value={fmtTvl(y.liquidity_available_usd)} />
                    )}
                    <DetailRow label="Automated" value={y.is_automated ? "Yes" : "No"} />
                    {y.depeg != null && (
                      <DetailRow label="Depeg" value={`${y.depeg}%`} />
                    )}
                  </>
                )}

                {/* Lending-specific */}
                {y.category === "lending" && (
                  <>
                    {y.utilization_pct != null && (
                      <DetailRow label="Utilization" value={`${y.utilization_pct.toFixed(1)}%`} />
                    )}
                    {y.deposit_address && (
                      <DetailRow
                        label="Deposit Address"
                        value={
                          <span className="font-mono text-[0.75rem]">{truncate(y.deposit_address)}</span>
                        }
                      />
                    )}
                  </>
                )}

                {/* Vault / earn_vault */}
                {(y.category === "vault" || y.category === "earn_vault") && y.is_automated != null && (
                  <DetailRow label="Automated" value={y.is_automated ? "Yes" : "No"} />
                )}
              </div>
            </div>

            {/* Action card */}
            {y.category === "multiply" && y.protocol?.slug && hasAdapter(y.protocol.slug) && y.deposit_address ? (
              <MultiplyPanel yield_={y} protocolSlug={y.protocol.slug} />
            ) : y.category !== "multiply" && y.protocol?.slug && hasAdapter(y.protocol.slug) && y.deposit_address ? (
              <DepositWithdrawPanel yield_={y} protocolSlug={y.protocol.slug} />
            ) : (
              <div className="flex-[1] bg-surface-low px-6 py-5 flex flex-col justify-between">
                <div>
                  <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-2">Current APY</p>
                  <p className="font-display text-3xl tracking-[-0.02em] text-neon">{fmtApy(y.apy_current)}</p>
                </div>
                <div>
                  <a
                    href={y.protocol_url ?? y.protocol?.website_url ?? "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-neon text-on-neon rounded-sm px-6 py-3 text-sm font-semibold font-sans w-full block text-center mt-4 hover:opacity-90 transition-opacity"
                  >
                    Open in {y.protocol_name ?? "Protocol"} ↗
                  </a>
                  <p className="text-foreground-muted text-[0.65rem] font-sans mt-2 text-center">
                    Non-custodial. Your keys, your funds.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* APY History Chart */}
          <div className="bg-surface-low rounded-sm px-6 py-5">
            <div className="flex items-center justify-between mb-4">
              <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">APY History</p>
              <PeriodSelector value={period} onChange={setPeriod} variant="neon" />
            </div>

            {historyQuery.isLoading && (
              <div className="h-[200px] bg-surface animate-pulse rounded-sm" />
            )}

            {!historyQuery.isLoading && chartData.length === 0 && (
              <div className="h-[200px] flex items-center justify-center">
                <p className="text-foreground-muted font-sans text-sm">No history data</p>
              </div>
            )}

            {!historyQuery.isLoading && chartData.length > 0 && (
              <ApyChart data={chartData} />
            )}
          </div>
        </>
      )}
    </main>
  );
}
