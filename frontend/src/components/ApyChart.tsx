"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { ChartReferenceLine } from "@/lib/categories/registry";

interface ApyChartProps {
  data: { date: string; apy: number | null }[];
  referenceLines?: ChartReferenceLine[];
}

export default function ApyChart({ data, referenceLines }: ApyChartProps) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 4, right: referenceLines?.length ? 50 : 8, left: 0, bottom: 0 }}>
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
          contentStyle={{ background: "var(--surface-low)", border: "none", borderRadius: 2, fontSize: 11 }}
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
        {referenceLines?.map((rl) => (
          <ReferenceLine
            key={rl.label}
            y={rl.value}
            stroke={rl.color}
            strokeDasharray="4 4"
            strokeWidth={1}
            label={{ value: `${rl.label} ${rl.value.toFixed(1)}%`, position: "right", fill: rl.color, fontSize: 9 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
