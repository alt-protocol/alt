"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, YieldOpportunity } from "@/lib/api";

function fmt(n: number | null | undefined, decimals = 2) {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function fmtTvl(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

const SORT_OPTIONS = [
  { value: "apy_desc", label: "APY ↓" },
  { value: "apy_asc", label: "APY ↑" },
  { value: "tvl_desc", label: "TVL ↓" },
  { value: "tvl_asc", label: "TVL ↑" },
];

const CATEGORIES = ["", "lending", "vault", "lp", "stable", "perp"];

export default function Dashboard() {
  const [sort, setSort] = useState("apy_desc");
  const [category, setCategory] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["yields", sort, category],
    queryFn: () =>
      api.getYields({
        sort,
        category: category || undefined,
      }),
  });

  const yields: YieldOpportunity[] = data?.data ?? [];

  return (
    <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white">
      <header className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-4 flex items-center justify-between">
        <a href="/" className="text-xl font-bold">Alt</a>
        <nav className="flex gap-4 text-sm text-zinc-500">
          <a href="/dashboard" className="text-black dark:text-white font-medium">Dashboard</a>
          <a href="/portfolio" className="hover:text-black dark:hover:text-white transition-colors">Portfolio</a>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Yield Opportunities</h1>
            {data?.meta?.last_updated && (
              <p className="text-xs text-zinc-400 mt-1">
                Updated {new Date(data.meta.last_updated).toLocaleTimeString()}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <select
              aria-label="Filter by category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-zinc-900"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c || "All categories"}</option>
              ))}
            </select>
            <select
              aria-label="Sort order"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="border border-zinc-300 dark:border-zinc-700 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-zinc-900"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {isLoading && (
          <div className="text-center py-24 text-zinc-400">Loading yields...</div>
        )}

        {isError && (
          <div className="text-center py-24 text-red-500">
            Failed to load yields — is the backend running?
            <pre className="mt-2 text-xs text-zinc-400">{error instanceof Error ? error.message : "Unknown error"}</pre>
          </div>
        )}

        {!isLoading && !isError && yields.length === 0 && (
          <div className="text-center py-24 text-zinc-400">
            No yield data yet. The backend is fetching from DeFiLlama on startup.
          </div>
        )}

        {yields.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900 text-zinc-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Category</th>
                  <th className="text-left px-4 py-3">Tokens</th>
                  <th className="text-right px-4 py-3">APY (live)</th>
                  <th className="text-right px-4 py-3">7d Avg</th>
                  <th className="text-right px-4 py-3">30d Avg</th>
                  <th className="text-right px-4 py-3">TVL</th>
                  <th className="text-left px-4 py-3">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {yields.map((y) => (
                  <tr
                    key={y.id}
                    className="hover:bg-zinc-50 dark:hover:bg-zinc-900/60 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium truncate max-w-xs">{y.name}</td>
                    <td className="px-4 py-3">
                      <span className="inline-block px-2 py-0.5 rounded text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                        {y.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {y.tokens.slice(0, 3).join(", ")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-green-600 dark:text-green-400">
                      {fmt(y.apy_current)}%
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">
                      {fmt(y.apy_7d_avg)}%
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-zinc-500">
                      {fmt(y.apy_30d_avg)}%
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{fmtTvl(y.tvl_usd)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${
                          y.risk_tier === "low"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : y.risk_tier === "high"
                            ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                            : "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                        }`}
                      >
                        {y.risk_tier ?? "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 text-xs text-zinc-400 border-t border-zinc-100 dark:border-zinc-800">
              {yields.length} opportunities · Data from DeFiLlama
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
