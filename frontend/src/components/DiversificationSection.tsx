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

function DistributionCard({ title, items }: { title: string; items: DistributionItem[] }) {
  const concentrated = items.find((i) => i.pct >= CONCENTRATION_THRESHOLD);

  return (
    <div className="bg-surface-low px-5 py-4">
      <h3 className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-3">
        {title}
      </h3>
      <div className="space-y-2.5">
        {items.map((item, i) => (
          <div key={item.label}>
            <div className="flex justify-between text-[0.75rem] font-sans mb-1">
              <span className="text-foreground">{item.label}</span>
              <span className="text-foreground-muted tabular-nums">
                {item.pct.toFixed(1)}% · {fmtUsd(item.value_usd)}
              </span>
            </div>
            <div className="h-1.5 bg-surface rounded-sm overflow-hidden">
              <div
                className="h-full rounded-sm"
                style={{
                  width: `${Math.max(item.pct, 1)}%`,
                  backgroundColor: COLORS[i % COLORS.length],
                }}
              />
            </div>
          </div>
        ))}
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
