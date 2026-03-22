"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ApyChartProps {
  data: { date: string; apy: number | null }[];
}

export default function ApyChart({ data }: ApyChartProps) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
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
  );
}
