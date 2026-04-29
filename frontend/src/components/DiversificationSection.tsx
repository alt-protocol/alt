"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { fmtUsd } from "@/lib/format";
import type { PortfolioAnalytics, DistributionItem } from "@/lib/api";

const COLORS = [
  "#d9f99d", // neon
  "#c0c1ff", // purple
  "#67e8f9", // cyan
  "#fbbf24", // amber
  "#f87171", // red
  "#a78bfa", // violet
  "#34d399", // emerald
  "#fb923c", // orange
];

const CONCENTRATION_THRESHOLD = 80;

interface Props {
  data: PortfolioAnalytics["diversification"];
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; pct: number; value_usd: number } }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1a1a1a] border border-outline-ghost rounded-sm px-3 py-2 shadow-lg">
      <div className="text-[0.7rem] text-foreground font-sans">{d.label}</div>
      <div className="text-[0.65rem] text-foreground-muted font-sans tabular-nums">{d.pct.toFixed(1)}% · {fmtUsd(d.value_usd)}</div>
    </div>
  );
}

function DistributionCard({ title, items }: { title: string; items: DistributionItem[] }) {
  const concentrated = items.find((i) => i.pct >= CONCENTRATION_THRESHOLD);
  const chartData = items.map((item) => ({
    ...item,
    name: item.label,
  }));

  return (
    <div className="bg-surface-low px-5 py-4">
      <h3 className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-3">
        {title}
      </h3>
      <div className="flex items-center gap-4">
        <div className="w-[100px] h-[100px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value_usd"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={28}
                outerRadius={46}
                strokeWidth={0}
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-1 min-w-0">
          {items.slice(0, 5).map((item, i) => (
            <div key={item.label} className="flex items-center gap-2 text-[0.7rem] font-sans">
              <span className="w-2 h-2 rounded-none shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="text-foreground truncate">{item.label}</span>
              <span className="text-foreground-muted tabular-nums ml-auto shrink-0">{item.pct.toFixed(1)}%</span>
            </div>
          ))}
          {items.length > 5 && (
            <div className="text-[0.6rem] text-foreground-muted font-sans">+{items.length - 5} more</div>
          )}
        </div>
      </div>
      {concentrated && (
        <p className="text-yellow-400 text-[0.6rem] font-sans mt-2.5 uppercase tracking-[0.05em]">
          High concentration in {concentrated.label}
        </p>
      )}
    </div>
  );
}

export default function DiversificationSection({ data }: Props) {
  const hasData =
    data.by_protocol.length > 0 ||
    data.by_category.length > 0 ||
    data.by_token.length > 0;

  if (!hasData) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-[1px] bg-outline-ghost rounded-sm overflow-hidden mb-[2.25rem]">
      <DistributionCard title="By Protocol" items={data.by_protocol} />
      <DistributionCard title="By Category" items={data.by_category} />
      <DistributionCard title="By Token" items={data.by_token} />
    </div>
  );
}
