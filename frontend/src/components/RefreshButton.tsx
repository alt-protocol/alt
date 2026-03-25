"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  queryKeys: readonly (readonly unknown[])[];
  className?: string;
}

export default function RefreshButton({ queryKeys, className = "" }: Props) {
  const queryClient = useQueryClient();
  const [spinning, setSpinning] = useState(false);

  function handleRefresh() {
    setSpinning(true);
    for (const key of queryKeys) {
      queryClient.invalidateQueries({ queryKey: key as unknown[] });
    }
    setTimeout(() => setSpinning(false), 1000);
  }

  return (
    <button
      onClick={handleRefresh}
      disabled={spinning}
      className={`text-foreground-muted hover:text-foreground transition-colors disabled:opacity-40 ${className}`}
      title="Refresh data"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        className={`w-4 h-4 ${spinning ? "animate-spin" : ""}`}
      >
        <path d="M8 3a5 5 0 0 0-4.546 2.914.5.5 0 0 1-.908-.418A6 6 0 1 1 2 8a.5.5 0 0 1 1 0 5 5 0 1 0 5-5z" />
        <path d="M8 1a.5.5 0 0 1 .5.5V4a.5.5 0 0 1-.854.354l-1.25-1.25A.5.5 0 0 1 6.75 2.25l1.25 1.25V1.5A.5.5 0 0 1 8 1z" />
      </svg>
    </button>
  );
}
