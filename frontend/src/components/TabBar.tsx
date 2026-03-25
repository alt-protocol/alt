interface TabBarProps {
  tabs: { key: string; label: string }[];
  activeKey: string;
  onChange: (key: string) => void;
  className?: string;
}

export default function TabBar({ tabs, activeKey, onChange, className = "" }: TabBarProps) {
  return (
    <div className={`flex gap-[1px] bg-outline-ghost rounded-sm overflow-hidden ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`flex-1 py-2.5 text-[0.75rem] uppercase tracking-[0.05em] font-sans transition-colors ${
            activeKey === tab.key
              ? "bg-surface-high text-foreground"
              : "bg-surface-low text-foreground-muted hover:text-foreground"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
