"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

interface PortfolioChartProps {
  data: { date: string; value: number | null }[];
}

export default function PortfolioChart({ data }: PortfolioChartProps) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 20, bottom: 8, left: 0 }}>
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
  );
}
