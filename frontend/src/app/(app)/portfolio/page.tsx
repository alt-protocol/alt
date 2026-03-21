"use client";

import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useSelectedWalletAccount } from "@solana/react";
import { api, UserPositionOut, UserPositionEventOut } from "@/lib/api";
import { ProtocolChip } from "@/components/ProtocolChip";
import WalletButton from "@/components/WalletButton";

// Utility functions
function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function fmtApy(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(2)}%`;
}

function fmtDays(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}d`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function truncateId(id: string, len = 12): string {
  if (id.length <= len) return id;
  return id.slice(0, len) + "…";
}

function pnlColor(n: number | null | undefined): string {
  if (n == null) return "text-foreground-muted";
  if (n > 0) return "text-neon";
  if (n < 0) return "text-red-400";
  return "text-foreground-muted";
}

function ApyCell({ position }: { position: UserPositionOut }) {
  const forwardApy = (position.extra_data as Record<string, unknown> | null)?.forward_apy as number | null | undefined;
  const showBoth = forwardApy != null && position.apy !== forwardApy;
  return (
    <td className="px-5 py-3 text-right">
      <span className="text-neon">{fmtApy(position.apy)}</span>
      {showBoth && (
        <div className="text-xs text-foreground-muted mt-0.5">
          {fmtApy(forwardApy)} mkt
        </div>
      )}
    </td>
  );
}

function fmtProductType(t: string): string {
  const map: Record<string, string> = {
    earn_vault: "Earn Vault",
    lending: "Lend",
    multiply: "Multiply",
    lp: "LP",
    insurance: "Insurance",
  };
  return map[t] ?? t;
}

const SIDEBAR_TYPES = [
  { key: "all", label: "ALL" },
  { key: "lending", label: "LEND" },
  { key: "multiply", label: "MULTIPLY" },
  { key: "earn_vault", label: "VAULTS" },
  { key: "insurance", label: "INSURANCE FUNDS" },
];

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      {/* Stats skeleton */}
      <div className="grid grid-cols-3 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-surface-low px-5 py-4">
            <div className="bg-surface-high animate-pulse rounded-sm h-3 w-16 mb-2" />
            <div className="bg-surface-high animate-pulse rounded-sm h-7 w-28" />
          </div>
        ))}
      </div>
      {/* Chart skeleton */}
      <div className="bg-surface-low rounded-sm p-5">
        <div className="bg-surface-high animate-pulse rounded-sm h-[180px] w-full" />
      </div>
      {/* Table skeleton */}
      <div className="bg-surface-low rounded-sm overflow-hidden">
        <div className="bg-surface h-10" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-4 px-5 py-3">
            <div className="bg-surface-high animate-pulse rounded-sm h-4 flex-1" />
            <div className="bg-surface-high animate-pulse rounded-sm h-4 w-24" />
            <div className="bg-surface-high animate-pulse rounded-sm h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

function NoWalletState() {
  return (
    <div className="bg-surface-low rounded-sm px-6 py-12 text-center">
      <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">
        No wallet detected
      </p>
      <p className="font-display text-lg tracking-[-0.02em] mb-5">
        Connect to view your positions
      </p>
      <WalletButton variant="cta" />
    </div>
  );
}

function ErrorState() {
  return (
    <div className="bg-surface-low rounded-sm px-6 py-12 text-center">
      <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">
        Error loading positions
      </p>
      <p className="font-display text-lg tracking-[-0.02em]">
        Could not fetch portfolio data
      </p>
    </div>
  );
}

function SyncingState() {
  return (
    <div className="bg-surface-low rounded-sm px-6 py-12 text-center">
      <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans mb-1 animate-pulse">
        Syncing
      </p>
      <p className="font-display text-lg tracking-[-0.02em]">
        Fetching on-chain positions...
      </p>
      <p className="text-foreground-muted text-[0.75rem] font-sans mt-2">
        This may take a moment on first load
      </p>
    </div>
  );
}

interface StatsRowProps {
  totalValue: number;
  totalPnl: number;
  count: number;
}

function StatsRow({ totalValue, totalPnl, count }: StatsRowProps) {
  return (
    <div className="grid grid-cols-3 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[2.25rem]">
      <div className="bg-surface-low px-5 py-4">
        <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">Net Value</p>
        <p className="font-display text-2xl tracking-[-0.02em] tabular-nums">{fmtUsd(totalValue)}</p>
      </div>
      <div className="bg-surface-low px-5 py-4">
        <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">Total PnL</p>
        <p className={`font-display text-2xl tracking-[-0.02em] tabular-nums ${pnlColor(totalPnl)}`}>
          {fmtPct(totalPnl)}
        </p>
      </div>
      <div className="bg-surface-low px-5 py-4">
        <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">Positions</p>
        <p className="font-display text-2xl tracking-[-0.02em] tabular-nums">{count}</p>
      </div>
    </div>
  );
}

interface ChartPoint {
  date: string;
  value: number | null;
  pnl: number | null;
}

interface ChartCardProps {
  chartData: ChartPoint[];
  period: "7d" | "30d" | "90d";
  onPeriod: (p: "7d" | "30d" | "90d") => void;
  isSuccess: boolean;
}

function ChartCard({ chartData, period, onPeriod, isSuccess }: ChartCardProps) {
  return (
    <div className="bg-surface-low rounded-sm mb-[2.25rem]">
      <div className="px-5 pt-4 pb-2 flex items-center justify-between">
        <h2 className="font-display text-sm uppercase tracking-[0.03em]">Net Value</h2>
        <div className="flex items-center gap-1">
          {(["7d", "30d", "90d"] as const).map((p) => (
            <button
              key={p}
              onClick={() => onPeriod(p)}
              className={`rounded-sm px-3 py-1 text-[0.7rem] uppercase tracking-[0.05em] font-sans transition-colors ${
                period === p ? "bg-surface-high text-foreground" : "text-foreground-muted hover:text-foreground"
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {isSuccess && chartData.length === 0 ? (
        <div className="h-[180px] flex items-center justify-center">
          <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans">No history data</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "#a1a1a1" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
              tick={{ fontSize: 10, fill: "#a1a1a1" }}
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={{ background: "#1c1b1b", border: "none", borderRadius: 2, fontSize: 12 }}
              labelStyle={{ color: "#a1a1a1" }}
              formatter={(value) => [fmtUsd(value as number), "Value"]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="#d9f99d"
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3, fill: "#d9f99d" }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

interface TypeSidebarProps {
  byType: Record<string, UserPositionOut[]>;
  totalCount: number;
  activeType: string;
  onSelect: (t: string) => void;
}

function TypeSidebar({ byType, totalCount, activeType, onSelect }: TypeSidebarProps) {
  return (
    <div className="w-[200px] shrink-0 bg-surface-low">
      {SIDEBAR_TYPES.map(({ key, label }) => {
        const count = key === "all" ? totalCount : (byType[key]?.length ?? 0);
        const isActive = activeType === key;
        return (
          <button
            key={key}
            onClick={() => onSelect(key)}
            className={`w-full flex justify-between items-center px-4 py-2.5 text-[0.75rem] font-sans uppercase tracking-[0.05em] transition-colors text-left ${
              isActive ? "text-neon bg-surface-high" : "text-foreground-muted hover:text-foreground"
            }`}
          >
            <span>{label}</span>
            {count > 0 ? (
              <span className="bg-secondary text-secondary-text rounded-sm px-1.5 py-0.5 text-[0.65rem]">{count}</span>
            ) : (
              <span className="text-foreground-muted text-[0.65rem]">0</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface PositionsPanelProps {
  positions: UserPositionOut[];
  activeType: string;
}

function PositionsPanel({ positions, activeType }: PositionsPanelProps) {
  if (positions.length === 0) {
    const typeLabel = SIDEBAR_TYPES.find((t) => t.key === activeType)?.label ?? activeType.toUpperCase();
    return (
      <div className="flex-1 bg-surface flex flex-col items-center justify-center py-16">
        <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">
          No {typeLabel} positions found
        </p>
        <p className="font-display text-lg tracking-[-0.02em] text-foreground-muted">
          Nothing to display
        </p>
      </div>
    );
  }

  if (activeType === "lending") {
    return (
      <div className="flex-1 bg-surface overflow-x-auto">
        <table className="w-full text-[0.8rem] font-sans">
          <thead>
            <tr className="text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface">
              <th className="text-left px-5 py-2.5 font-medium">Market</th>
              <th className="text-left px-5 py-2.5 font-medium">Token</th>
              <th className="text-right px-5 py-2.5 font-medium">Net Value</th>
              <th className="text-right px-5 py-2.5 font-medium">Supply APY</th>
              <th className="text-right px-5 py-2.5 font-medium">Interest Earned</th>
              <th className="text-right px-5 py-2.5 font-medium">Days Held</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.id} className="hover:bg-surface-high transition-colors tabular-nums">
                <td className="px-5 py-3 text-foreground">{truncateId(p.external_id)}</td>
                <td className="px-5 py-3 text-foreground-muted">{p.token_symbol ?? "—"}</td>
                <td className="px-5 py-3 text-right">{fmtUsd(p.deposit_amount_usd)}</td>
                <ApyCell position={p} />
                <td className={`px-5 py-3 text-right ${pnlColor(p.pnl_usd)}`}>{fmtUsd(p.pnl_usd)}</td>
                <td className="px-5 py-3 text-right text-foreground-muted">{fmtDays(p.held_days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (activeType === "multiply") {
    return (
      <div className="flex-1 bg-surface overflow-x-auto">
        <table className="w-full text-[0.8rem] font-sans">
          <thead>
            <tr className="text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface">
              <th className="text-left px-5 py-2.5 font-medium">Strategy</th>
              <th className="text-left px-5 py-2.5 font-medium">Token</th>
              <th className="text-right px-5 py-2.5 font-medium">Net Value</th>
              <th className="text-right px-5 py-2.5 font-medium">Net APY</th>
              <th className="text-right px-5 py-2.5 font-medium">PnL ($)</th>
              <th className="text-right px-5 py-2.5 font-medium">PnL (%)</th>
              <th className="text-right px-5 py-2.5 font-medium">Days Held</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.id} className="hover:bg-surface-high transition-colors tabular-nums">
                <td className="px-5 py-3 text-foreground">{truncateId(p.external_id)}</td>
                <td className="px-5 py-3 text-foreground-muted">{p.token_symbol ?? "—"}</td>
                <td className="px-5 py-3 text-right">{fmtUsd(p.deposit_amount_usd)}</td>
                <ApyCell position={p} />
                <td className={`px-5 py-3 text-right ${pnlColor(p.pnl_usd)}`}>{fmtUsd(p.pnl_usd)}</td>
                <td className={`px-5 py-3 text-right ${pnlColor(p.pnl_pct)}`}>{fmtPct(p.pnl_pct)}</td>
                <td className="px-5 py-3 text-right text-foreground-muted">{fmtDays(p.held_days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (activeType === "earn_vault") {
    return (
      <div className="flex-1 bg-surface overflow-x-auto">
        <table className="w-full text-[0.8rem] font-sans">
          <thead>
            <tr className="text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface">
              <th className="text-left px-5 py-2.5 font-medium">Vault</th>
              <th className="text-left px-5 py-2.5 font-medium">Token</th>
              <th className="text-right px-5 py-2.5 font-medium">Net Value</th>
              <th className="text-right px-5 py-2.5 font-medium">APY</th>
              <th className="text-right px-5 py-2.5 font-medium">Interest Earned</th>
              <th className="text-right px-5 py-2.5 font-medium">Days Held</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.id} className="hover:bg-surface-high transition-colors tabular-nums">
                <td className="px-5 py-3 text-foreground">{truncateId(p.external_id)}</td>
                <td className="px-5 py-3 text-foreground-muted">{p.token_symbol ?? "—"}</td>
                <td className="px-5 py-3 text-right">{fmtUsd(p.deposit_amount_usd)}</td>
                <ApyCell position={p} />
                <td className={`px-5 py-3 text-right ${pnlColor(p.pnl_usd)}`}>{fmtUsd(p.pnl_usd)}</td>
                <td className="px-5 py-3 text-right text-foreground-muted">{fmtDays(p.held_days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (activeType === "insurance") {
    return (
      <div className="flex-1 bg-surface overflow-x-auto">
        <table className="w-full text-[0.8rem] font-sans">
          <thead>
            <tr className="text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface">
              <th className="text-left px-5 py-2.5 font-medium">Fund</th>
              <th className="text-left px-5 py-2.5 font-medium">Token</th>
              <th className="text-right px-5 py-2.5 font-medium">Net Value</th>
              <th className="text-right px-5 py-2.5 font-medium">APY</th>
              <th className="text-right px-5 py-2.5 font-medium">PnL</th>
              <th className="text-right px-5 py-2.5 font-medium">Days Held</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.id} className="hover:bg-surface-high transition-colors tabular-nums">
                <td className="px-5 py-3 text-foreground">{truncateId(p.external_id)}</td>
                <td className="px-5 py-3 text-foreground-muted">{p.token_symbol ?? "—"}</td>
                <td className="px-5 py-3 text-right">{fmtUsd(p.deposit_amount_usd)}</td>
                <ApyCell position={p} />
                <td className={`px-5 py-3 text-right ${pnlColor(p.pnl_usd)}`}>{fmtUsd(p.pnl_usd)}</td>
                <td className="px-5 py-3 text-right text-foreground-muted">{fmtDays(p.held_days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Default: ALL view
  return (
    <div className="flex-1 bg-surface overflow-x-auto">
      <table className="w-full text-[0.8rem] font-sans">
        <thead>
          <tr className="text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface">
            <th className="text-left px-5 py-2.5 font-medium">Protocol</th>
            <th className="text-left px-5 py-2.5 font-medium">Type</th>
            <th className="text-left px-5 py-2.5 font-medium">Token</th>
            <th className="text-right px-5 py-2.5 font-medium">Net Value</th>
            <th className="text-right px-5 py-2.5 font-medium">PnL</th>
            <th className="text-right px-5 py-2.5 font-medium">APY</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.id} className="hover:bg-surface-high transition-colors tabular-nums">
              <td className="px-5 py-3">
                <ProtocolChip slug={p.protocol_slug} />
              </td>
              <td className="px-5 py-3 text-foreground-muted">{fmtProductType(p.product_type)}</td>
              <td className="px-5 py-3 text-foreground">{p.token_symbol ?? "—"}</td>
              <td className="px-5 py-3 text-right">{fmtUsd(p.deposit_amount_usd)}</td>
              <td className={`px-5 py-3 text-right ${pnlColor(p.pnl_usd)}`}>{fmtUsd(p.pnl_usd)}</td>
              <ApyCell position={p} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface EventsTableProps {
  events: UserPositionEventOut[];
}

function EventsTable({ events }: EventsTableProps) {
  if (events.length === 0) {
    return (
      <div className="bg-surface-low rounded-sm px-6 py-12 text-center">
        <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">No transactions</p>
        <p className="font-display text-lg tracking-[-0.02em]">No transaction history found</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-low rounded-sm overflow-hidden">
      <table className="w-full text-[0.8rem] font-sans">
        <thead>
          <tr className="text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface">
            <th className="text-left px-5 py-2.5 font-medium">Date</th>
            <th className="text-left px-5 py-2.5 font-medium">Protocol</th>
            <th className="text-left px-5 py-2.5 font-medium">Type</th>
            <th className="text-right px-5 py-2.5 font-medium">Amount</th>
            <th className="text-right px-5 py-2.5 font-medium">Value (USD)</th>
            <th className="text-right px-5 py-2.5 font-medium">Tx</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="hover:bg-surface-high transition-colors tabular-nums">
              <td className="px-5 py-3 text-foreground-muted">{fmtDate(e.event_at)}</td>
              <td className="px-5 py-3">
                <ProtocolChip slug={e.protocol_slug} />
              </td>
              <td className="px-5 py-3">
                <span className="bg-surface-high text-foreground rounded-sm px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.05em]">
                  {e.event_type}
                </span>
              </td>
              <td className="px-5 py-3 text-right text-foreground">
                {e.amount != null ? e.amount.toFixed(4) : "—"}
              </td>
              <td className="px-5 py-3 text-right text-foreground">{fmtUsd(e.amount_usd)}</td>
              <td className="px-5 py-3 text-right">
                {e.tx_signature ? (
                  <a
                    href={`https://solscan.io/tx/${e.tx_signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neon text-[0.7rem] hover:underline"
                  >
                    {truncateId(e.tx_signature, 8)}
                  </a>
                ) : (
                  <span className="text-foreground-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Portfolio() {
  const [selectedAccount] = useSelectedWalletAccount();
  const walletAddress = selectedAccount?.address ?? null;
  const [activeTab, setActiveTab] = useState<"positions" | "history">("positions");
  const [activeType, setActiveType] = useState("all");
  const [chartPeriod, setChartPeriod] = useState<"7d" | "30d" | "90d">("7d");
  const hasFetchedOnce = useRef(false);

  // Fire-and-forget track on mount
  useEffect(() => {
    if (walletAddress) api.trackWallet(walletAddress);
  }, [walletAddress]);

  const statusQuery = useQuery({
    queryKey: ["walletStatus", walletAddress],
    queryFn: () => api.getWalletStatus(walletAddress!),
    enabled: !!walletAddress,
    refetchInterval: (query) => {
      return query.state.data?.fetch_status === "fetching" ? 2000 : false;
    },
  });

  const positionsQuery = useQuery({
    queryKey: ["positions", walletAddress],
    queryFn: () => api.getPositions(walletAddress!),
    enabled: !!walletAddress,
    refetchInterval: 60_000,
  });

  const historyQuery = useQuery({
    queryKey: ["positionHistory", walletAddress, chartPeriod],
    queryFn: () => api.getPositionHistory(walletAddress!, chartPeriod),
    enabled: !!walletAddress,
  });

  const eventsQuery = useQuery({
    queryKey: ["positionEvents", walletAddress],
    queryFn: () => api.getPositionEvents(walletAddress!),
    enabled: !!walletAddress && activeTab === "history",
  });

  const prevFetchStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = statusQuery.data?.fetch_status;
    if (prevFetchStatus.current === "fetching" && status === "ready") {
      positionsQuery.refetch();
      historyQuery.refetch();
    }
    prevFetchStatus.current = status;
  }, [statusQuery.data?.fetch_status]);

  if (positionsQuery.isSuccess) hasFetchedOnce.current = true;

  const positions = positionsQuery.data ?? [];

  const byType = useMemo(() => {
    const result: Record<string, UserPositionOut[]> = {};
    for (const p of positions) {
      if (!result[p.product_type]) result[p.product_type] = [];
      result[p.product_type].push(p);
    }
    return result;
  }, [positions]);

  const visiblePositions = activeType === "all" ? positions : (byType[activeType] ?? []);

  const summary = useMemo(() => {
    const totalValue = positions.reduce((sum, p) => sum + (p.deposit_amount_usd ?? 0), 0);
    const totalPnlUsd = positions.reduce((sum, p) => sum + (p.pnl_usd ?? 0), 0);
    const totalPnlPct = totalValue > 0 ? (totalPnlUsd / totalValue) * 100 : 0;
    return { totalValue, totalPnl: totalPnlPct, count: positions.length };
  }, [positions]);

  const chartData: ChartPoint[] = useMemo(() => {
    if (!historyQuery.data) return [];
    return historyQuery.data.map((pt) => ({
      date: fmtDate(pt.snapshot_at).split(" · ")[0],
      value: pt.deposit_amount_usd,
      pnl: pt.pnl_usd,
    }));
  }, [historyQuery.data]);

  const showSyncing = positionsQuery.isSuccess && positions.length === 0 && !hasFetchedOnce.current;

  const shortAddr = walletAddress
    ? `${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`
    : "";

  return (
    <main className="max-w-[1200px] mx-auto px-[3.5rem] py-[2.25rem]">
      {!walletAddress && <NoWalletState />}

      {walletAddress && positionsQuery.isLoading && <LoadingSkeleton />}

      {walletAddress && positionsQuery.isError && <ErrorState />}

      {walletAddress && positionsQuery.isSuccess && (
        <>
          <div className="mb-[2.25rem]">
            <h1 className="font-display text-2xl tracking-[-0.02em]">Portfolio</h1>
            <p className="text-foreground-muted font-sans text-[0.8rem] mt-1">{shortAddr}</p>
          </div>

          <StatsRow
            totalValue={summary.totalValue}
            totalPnl={summary.totalPnl}
            count={summary.count}
          />

          <ChartCard
            chartData={chartData}
            period={chartPeriod}
            onPeriod={setChartPeriod}
            isSuccess={historyQuery.isSuccess}
          />

          {/* Tab bar */}
          <div className="flex gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[2.25rem]">
            {(["positions", "history"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 text-[0.75rem] uppercase tracking-[0.05em] font-sans transition-colors ${
                  activeTab === tab
                    ? "bg-surface-high text-foreground"
                    : "bg-surface-low text-foreground-muted hover:text-foreground"
                }`}
              >
                {tab === "positions" ? "Positions Overview" : "Transaction History"}
              </button>
            ))}
          </div>

          {showSyncing && <SyncingState />}

          {!showSyncing && activeTab === "positions" && (
            <div className="flex rounded-sm overflow-hidden">
              <TypeSidebar
                byType={byType}
                totalCount={positions.length}
                activeType={activeType}
                onSelect={setActiveType}
              />
              <PositionsPanel positions={visiblePositions} activeType={activeType} />
            </div>
          )}

          {activeTab === "history" && (
            eventsQuery.isLoading ? (
              <div className="bg-surface-low rounded-sm px-6 py-8 text-center">
                <div className="bg-surface-high animate-pulse rounded-sm h-4 w-48 mx-auto" />
              </div>
            ) : (
              <EventsTable events={eventsQuery.data ?? []} />
            )
          )}
        </>
      )}
    </main>
  );
}
