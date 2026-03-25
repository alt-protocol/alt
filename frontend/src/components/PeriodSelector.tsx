export type Period = "7d" | "30d" | "90d";

interface PeriodSelectorProps {
  value: Period;
  onChange: (p: Period) => void;
  variant?: "surface" | "neon";
}

const PERIODS: Period[] = ["7d", "30d", "90d"];

export default function PeriodSelector({ value, onChange, variant = "surface" }: PeriodSelectorProps) {
  return (
    <div className="flex items-center gap-1">
      {PERIODS.map((p) => {
        const isActive = value === p;
        const activeClass = variant === "neon"
          ? "bg-neon text-on-neon"
          : "bg-surface-high text-foreground";
        return (
          <button
            key={p}
            onClick={() => onChange(p)}
            className={`rounded-sm px-3 py-1 text-[0.7rem] uppercase tracking-[0.05em] font-sans transition-colors ${
              isActive ? activeClass : "text-foreground-muted hover:text-foreground"
            }`}
          >
            {p.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
