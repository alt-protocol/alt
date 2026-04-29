"use client";

import { useState, useRef, useEffect } from "react";

interface ColumnToggleProps<K extends string> {
  visibleColumns: readonly K[];
  allColumns: readonly K[];
  requiredColumns: readonly K[];
  labels: Record<K, string>;
  toggleColumn: (key: K) => void;
  resetColumns: () => void;
}

export default function ColumnToggle<K extends string>({ visibleColumns, allColumns, requiredColumns, labels, toggleColumn, resetColumns }: ColumnToggleProps<K>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[0.7rem] font-sans text-foreground-muted hover:text-foreground transition-colors bg-surface hover:bg-surface-high"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="opacity-60">
          <rect x="1" y="2" width="4" height="2" rx="0.5" fill="currentColor" />
          <rect x="1" y="6" width="4" height="2" rx="0.5" fill="currentColor" />
          <rect x="1" y="10" width="4" height="2" rx="0.5" fill="currentColor" />
          <rect x="7" y="2" width="6" height="2" rx="0.5" fill="currentColor" />
          <rect x="7" y="6" width="6" height="2" rx="0.5" fill="currentColor" />
          <rect x="7" y="10" width="6" height="2" rx="0.5" fill="currentColor" />
        </svg>
        Columns
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-surface-low rounded-sm shadow-lg min-w-[160px] py-1">
          {allColumns.map((key) => {
            const isRequired = requiredColumns.includes(key);
            const isChecked = visibleColumns.includes(key);
            return (
              <label
                key={key}
                className={`flex items-center gap-2 px-3 py-1.5 text-[0.7rem] font-sans cursor-pointer hover:bg-surface-high transition-colors ${
                  isRequired ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isRequired}
                  onChange={() => toggleColumn(key)}
                  className="accent-neon w-3 h-3"
                />
                <span className="text-foreground-muted">{labels[key]}</span>
              </label>
            );
          })}
          <div className="border-t border-surface-high mt-1 pt-1 px-3 pb-1">
            <button
              onClick={resetColumns}
              className="text-[0.65rem] text-foreground-muted hover:text-foreground transition-colors font-sans"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
