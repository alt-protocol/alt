interface StatItem {
  label: string;
  value: string;
  sub?: string;
  colorClass?: string;
  tooltip?: string;
  onClick?: () => void;
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
        <div
          key={stat.label}
          className={`bg-surface-low px-5 py-4 ${stat.onClick ? "cursor-pointer hover:bg-surface-high transition-colors" : ""}`}
          onClick={stat.onClick}
        >
          <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">
            {stat.label}
            {stat.tooltip && (
              <span className="relative group/tip ml-1 inline-block cursor-help">
                <span className="text-foreground-muted/50">?</span>
                <span className="invisible group-hover/tip:visible opacity-0 group-hover/tip:opacity-100 transition-opacity absolute left-0 top-full mt-1 z-[100] pointer-events-none bg-[#1a1a1a] border border-outline-ghost rounded-sm px-3 py-2 shadow-lg min-w-[180px] normal-case tracking-normal font-normal text-[0.65rem] text-foreground-muted leading-relaxed whitespace-normal">
                  {stat.tooltip}
                </span>
              </span>
            )}
          </p>
          <p className={`font-display ${textSize} tracking-[-0.02em] tabular-nums ${stat.colorClass ?? ""}`}>
            {stat.value}
            {stat.sub && <span className="text-foreground-muted text-[0.75rem] font-sans ml-1">{stat.sub}</span>}
          </p>
          {stat.onClick && (
            <p className="text-[0.6rem] text-foreground-muted font-sans mt-0.5 uppercase tracking-[0.05em]">View &rarr;</p>
          )}
        </div>
      ))}
    </div>
  );
}
