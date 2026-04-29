"use client";

import { useState, useRef, useCallback } from "react";
import { useClickOutside } from "@/lib/hooks/useClickOutside";

interface Action {
  value: string;
  label: string;
}

interface ActionDropdownProps {
  actions: Action[];
  selected: string;
  onChange: (value: string) => void;
}

export default function ActionDropdown({ actions, selected, onChange }: ActionDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selectedLabel = actions.find((a) => a.value === selected)?.label ?? selected;

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  // Single action — static label, no dropdown
  if (actions.length <= 1) {
    return (
      <span className="text-[0.8rem] font-sans font-medium text-foreground">
        {selectedLabel}
      </span>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between gap-2 bg-surface-high rounded-sm px-3 py-2 text-[0.8rem] font-sans font-medium text-foreground hover:border-foreground-muted transition-colors cursor-pointer border border-outline-ghost min-w-[160px]"
      >
        {selectedLabel}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-foreground-muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 bg-surface rounded-sm z-50 min-w-[180px]"
          style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}
        >
          {actions.map((a) => (
            <button
              key={a.value}
              type="button"
              onClick={() => { onChange(a.value); setOpen(false); }}
              className={`w-full text-left px-3 py-2.5 text-[0.8rem] font-sans transition-colors hover:bg-surface-high ${
                a.value === selected ? "text-neon" : "text-foreground-muted"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
