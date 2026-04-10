"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { fmtUsd } from "@/lib/format";

interface PortfolioChartProps {
  data: { date: string; value: number | null }[];
}

export default function PortfolioChart({ data }: PortfolioChartProps) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--color-foreground-muted)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
          tick={{ fontSize: 10, fill: "var(--color-foreground-muted)" }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip
          contentStyle={{ background: "var(--color-surface-low)", border: "none", borderRadius: 2, fontSize: 12 }}
          labelStyle={{ color: "var(--color-foreground-muted)" }}
          formatter={(value) => [fmtUsd(value as number), "Value"]}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="var(--color-neon)"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, fill: "var(--color-neon)" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
