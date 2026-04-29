"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { fmtUsd, fmtTvl } from "@/lib/format";
import type { ChartPoint } from "@/lib/hooks/usePortfolioData";

interface PortfolioChartProps {
  data: ChartPoint[];
  dataKey?: string;
  label?: string;
  formatValue?: (v: number) => string;
}

export default function PortfolioChart({ data, dataKey = "value", label = "Value", formatValue = fmtUsd }: PortfolioChartProps) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "var(--color-foreground-muted)" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(v: number) => fmtTvl(v)}
          tick={{ fontSize: 10, fill: "var(--color-foreground-muted)" }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <Tooltip
          contentStyle={{ background: "var(--color-surface-low)", border: "none", borderRadius: 2, fontSize: 12 }}
          labelStyle={{ color: "var(--color-foreground-muted)" }}
          formatter={(value) => [formatValue(value as number), label]}
        />
        <Line
          type="monotone"
          dataKey={dataKey}
          stroke="var(--color-neon)"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, fill: "var(--color-neon)" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
