"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useClickOutside } from "@/lib/hooks/useClickOutside";

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  value: string;
  options: DropdownOption[];
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function Dropdown({ value, options, onChange, placeholder = "Select" }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? placeholder;

  const filtered = search
    ? options.filter(
        (o) => o.value !== "" && o.label.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  const closeDropdown = useCallback(() => { setOpen(false); setSearch(""); }, []);
  useClickOutside(ref, open, closeDropdown);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  return (
    <div className="relative flex-1" ref={ref}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (!next) setSearch("");
        }}
        className="w-full flex items-center justify-between gap-2 bg-surface text-foreground rounded-sm px-3 py-2 text-[0.8rem] font-sans outline-none hover:bg-surface-high transition-colors cursor-pointer text-left"
      >
        <span className={value ? "text-foreground" : "text-foreground-muted"}>{selectedLabel}</span>
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

      {/* Dropdown menu */}
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 bg-surface rounded-sm z-50"
          style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.5)" }}
        >
          <div className="px-3 py-2">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-surface text-foreground text-[0.8rem] font-sans outline-none border-b-2 border-transparent focus:border-neon pb-1 placeholder:text-foreground-muted"
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { onChange(opt.value); setOpen(false); setSearch(""); }}
                className={`w-full flex items-center justify-between px-3 py-2.5 text-[0.8rem] font-sans text-left transition-colors hover:bg-surface-high ${
                  opt.value === value ? "text-foreground" : "text-foreground-muted"
                }`}
              >
                <span>{opt.label}</span>
                {opt.value === value && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-neon shrink-0">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-2.5 text-[0.8rem] font-sans text-foreground-muted">
                No results
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
