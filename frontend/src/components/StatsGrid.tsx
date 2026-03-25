interface StatItem {
  label: string;
  value: string;
  sub?: string;
  colorClass?: string;
}

interface StatsGridProps {
  stats: StatItem[];
  columns?: string;
  size?: "default" | "lg";
  className?: string;
}

export default function StatsGrid({ stats, columns, size = "default", className = "" }: StatsGridProps) {
  const textSize = size === "lg" ? "text-2xl" : "text-xl";
  const gridCols = columns ?? `grid-cols-2 sm:grid-cols-${Math.min(stats.length, 3)} lg:grid-cols-${stats.length}`;

  return (
    <div className={`grid ${gridCols} gap-[1px] bg-outline-ghost rounded-sm overflow-hidden ${className}`}>
      {stats.map((stat) => (
        <div key={stat.label} className="bg-surface-low px-5 py-4">
          <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">{stat.label}</p>
          <p className={`font-display ${textSize} tracking-[-0.02em] tabular-nums ${stat.colorClass ?? ""}`}>
            {stat.value}
            {stat.sub && <span className="text-foreground-muted text-[0.75rem] font-sans ml-1">{stat.sub}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}
