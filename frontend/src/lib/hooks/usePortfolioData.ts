import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import { api } from "@/lib/api";
import type { UserPositionOut } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { queryKeys } from "@/lib/queryKeys";

export interface ChartPoint {
  date: string;
  value: number | null;
  pnl: number | null;
}

export function usePortfolioData() {
  const [selectedAccount] = useSelectedWalletAccount();
  const walletAddress = selectedAccount?.address ?? null;
  const [activeTab, setActiveTab] = useState<"positions" | "history">("positions");
  const [activeType, setActiveType] = useState("all");
  const [chartPeriod, setChartPeriod] = useState<"7d" | "30d" | "90d">("7d");
  // Fire-and-forget track on mount
  useEffect(() => {
    if (walletAddress) api.trackWallet(walletAddress);
  }, [walletAddress]);

  const statusQuery = useQuery({
    queryKey: queryKeys.wallet.status(walletAddress!),
    queryFn: () => api.getWalletStatus(walletAddress!),
    enabled: !!walletAddress,
    refetchInterval: (query) => {
      return query.state.data?.fetch_status === "fetching" ? 2000 : false;
    },
  });

  const positionsQuery = useQuery({
    queryKey: queryKeys.positions.list(walletAddress!),
    queryFn: () => api.getPositions(walletAddress!),
    enabled: !!walletAddress,
    refetchInterval: 60_000,
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.positions.history(walletAddress!, chartPeriod),
    queryFn: () => api.getPositionHistory(walletAddress!, chartPeriod),
    enabled: !!walletAddress,
  });

  const eventsQuery = useQuery({
    queryKey: queryKeys.positions.events(walletAddress!),
    queryFn: () => api.getPositionEvents(walletAddress!),
    enabled: !!walletAddress && activeTab === "history",
  });

  const prevFetchStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = statusQuery.data?.fetch_status;
    if (prevFetchStatus.current !== "ready" && status === "ready") {
      positionsQuery.refetch();
      historyQuery.refetch();
    }
    prevFetchStatus.current = status;
  }, [statusQuery.data?.fetch_status]);

  const positions = positionsQuery.data ?? [];

  const byType = useMemo(() => {
    const result: Record<string, UserPositionOut[]> = {};
    for (const p of positions) {
      if (!result[p.product_type]) result[p.product_type] = [];
      result[p.product_type].push(p);
    }
    return result;
  }, [positions]);

  const visiblePositions = activeType === "all" ? positions : (byType[activeType] ?? []);

  const summary = useMemo(() => {
    const totalValue = positions.reduce((sum, p) => sum + (p.deposit_amount_usd ?? 0), 0);
    const totalPnlUsd = positions.reduce((sum, p) => sum + (p.pnl_usd ?? 0), 0);
    const totalInitialDeposit = positions.reduce((sum, p) => sum + (p.initial_deposit_usd ?? 0), 0);
    const roi = totalInitialDeposit > 0 ? (totalPnlUsd / totalInitialDeposit) * 100 : 0;
    const weightedApy = totalValue > 0
      ? positions.reduce((sum, p) => sum + (p.apy ?? 0) * (p.deposit_amount_usd ?? 0), 0) / totalValue
      : 0;
    const weightedApyRealized = totalValue > 0
      ? positions.reduce((sum, p) => sum + (p.apy_realized ?? 0) * (p.deposit_amount_usd ?? 0), 0) / totalValue
      : 0;
    return { totalValue, totalPnlUsd, roi, weightedApy, weightedApyRealized, count: positions.length };
  }, [positions]);

  const chartData: ChartPoint[] = useMemo(() => {
    if (!historyQuery.data) return [];
    return historyQuery.data.map((pt) => ({
      date: fmtDate(pt.snapshot_at).split(" · ")[0],
      value: pt.deposit_amount_usd,
      pnl: pt.pnl_usd,
    }));
  }, [historyQuery.data]);

  const showSyncing = positionsQuery.isSuccess && positions.length === 0 && statusQuery.data?.fetch_status === "fetching";

  const shortAddr = walletAddress
    ? `${walletAddress.slice(0, 8)}...${walletAddress.slice(-4)}`
    : "";

  return {
    walletAddress,
    activeTab,
    setActiveTab,
    activeType,
    setActiveType,
    chartPeriod,
    setChartPeriod,
    positionsQuery,
    historyQuery,
    eventsQuery,
    positions,
    byType,
    visiblePositions,
    summary,
    chartData,
    showSyncing,
    shortAddr,
  };
}
