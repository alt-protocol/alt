"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api } from "@/lib/api";
import { ProtocolChip } from "@/components/ProtocolChip";

function fmtApy(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

function fmtTvl(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

function fmtCategory(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function truncate(s: string, len = 20): string {
  if (s.length <= len) return s;
  return s.slice(0, 8) + "…" + s.slice(-8);
}

type Period = "7d" | "30d" | "90d";

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-low px-5 py-4">
      <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">{label}</p>
      <p className="font-display text-xl tracking-[-0.02em]">{value}</p>
    </div>
  );
}

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
    queryKey: ["yield", id],
    queryFn: () => api.getYieldDetail(Number(id)),
    enabled: !!id,
  });

  const historyQuery = useQuery({
    queryKey: ["yieldHistory", id, period],
    queryFn: () => api.getYieldHistory(Number(id), period),
    enabled: !!id,
    initialData: period === "7d" && detailQuery.data?.recent_snapshots?.length
      ? { data: detailQuery.data.recent_snapshots }
      : undefined,
  });

  const y = detailQuery.data;
  const historyPoints = historyQuery.data?.data ?? [];

  const chartData = historyPoints.map((pt) => ({
    date: fmtDate(pt.snapshot_at),
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
          </div>

          {/* Stats strip */}
          <div className="grid grid-cols-4 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[1.5rem]">
            <StatCell label="APY Now" value={fmtApy(y.apy_current)} />
            <StatCell label="7D Avg" value={fmtApy(y.apy_7d_avg)} />
            <StatCell label="30D Avg" value={fmtApy(y.apy_30d_avg)} />
            <StatCell label="TVL" value={fmtTvl(y.tvl_usd)} />
          </div>

          {/* Two-column layout */}
          <div className="flex gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[1.5rem]">
            {/* Details card */}
            <div className="flex-[2] bg-surface-low px-6 py-5">
              <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-4">Details</p>
              <div className="divide-y divide-outline-ghost">
                {y.tokens.length > 0 && (
                  <DetailRow label="Tokens" value={y.tokens.join(", ")} />
                )}
                {y.risk_tier && (
                  <DetailRow label="Risk Tier" value={y.risk_tier} />
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
          </div>

          {/* APY History Chart */}
          <div className="bg-surface-low rounded-sm px-6 py-5">
            <div className="flex items-center justify-between mb-4">
              <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">APY History</p>
              <div className="flex gap-1">
                {(["7d", "30d", "90d"] as Period[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPeriod(p)}
                    className={`text-[0.7rem] font-sans rounded-sm px-3 py-1 uppercase tracking-[0.04em] transition-colors ${
                      period === p
                        ? "bg-neon text-on-neon"
                        : "text-foreground-muted hover:text-foreground"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
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
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "var(--foreground-muted)", fontSize: 10, fontFamily: "var(--font-sans)" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fill: "var(--foreground-muted)", fontSize: 10, fontFamily: "var(--font-sans)" }}
                    tickLine={false}
                    axisLine={false}
                    width={42}
                  />
                  <Tooltip
                    formatter={(value) => [`${Number(value).toFixed(2)}%`, "APY"]}
                    contentStyle={{ background: "#1c1b1b", border: "none", borderRadius: 2, fontSize: 11 }}
                    labelStyle={{ color: "var(--foreground-muted)" }}
                    itemStyle={{ color: "var(--neon-primary)" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="apy"
                    stroke="var(--neon-primary)"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, fill: "var(--neon-primary)" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </main>
  );
}
