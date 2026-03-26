"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import type { YieldHistoryPoint } from "@/lib/api";
import { fmtDateShort } from "@/lib/format";
import { queryKeys } from "@/lib/queryKeys";
import PeriodSelector from "@/components/PeriodSelector";
import type { Period } from "@/components/PeriodSelector";

const ApyChart = dynamic(() => import("@/components/ApyChart"), { ssr: false });

interface Props {
  id: string;
  initialSnapshots?: YieldHistoryPoint[];
}

export default function ApyHistorySection({ id, initialSnapshots }: Props) {
  const [period, setPeriod] = useState<Period>("7d");

  const historyQuery = useQuery({
    queryKey: queryKeys.yields.history(id, period),
    queryFn: () => api.getYieldHistory(Number(id), period),
    enabled: !!id,
    initialData: period === "7d" && initialSnapshots?.length
      ? { data: initialSnapshots }
      : undefined,
  });

  const historyPoints = historyQuery.data?.data ?? [];
  const chartData = historyPoints.map((pt) => ({
    date: fmtDateShort(pt.snapshot_at),
    apy: pt.apy != null ? parseFloat(pt.apy.toFixed(2)) : null,
  }));

  return (
    <div className="bg-surface-low rounded-sm px-6 py-5">
      <div className="flex items-center justify-between mb-4">
        <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">APY History</p>
        <PeriodSelector value={period} onChange={setPeriod} variant="neon" />
      </div>

      {historyQuery.isLoading && (
        <div className="h-[200px] bg-surface animate-pulse rounded-sm" />
      )}

      {!historyQuery.isLoading && chartData.length === 0 && (
        <div className="h-[200px] flex items-center justify-center">
          <p className="text-foreground-muted font-sans text-sm">No history data</p>
        </div>
      )}

      {!historyQuery.isLoading && chartData.length > 0 && (
        <ApyChart data={chartData} />
      )}
    </div>
  );
}
