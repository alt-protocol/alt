import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import { api } from "@/lib/api";
import type { UserPositionOut, PortfolioAnalytics } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { queryKeys } from "@/lib/queryKeys";

export interface ChartPoint {
  date: string;
  value: number | null;
  pnl: number | null;
}

const EMPTY_SUMMARY: PortfolioAnalytics["summary"] = {
  total_value_usd: 0,
  total_pnl_usd: 0,
  total_initial_deposit_usd: 0,
  roi_pct: 0,
  weighted_apy: 0,
  weighted_apy_realized: 0,
  projected_yield_yearly_usd: 0,
  position_count: 0,
};

const EMPTY_STABLECOIN: PortfolioAnalytics["stablecoin"] = {
  total_usd: 0,
  idle_usd: 0,
  allocated_usd: 0,
  allocation_pct: 0,
  apy_total: 0,
  apy_allocated: 0,
  idle_balances: [],
};

export function usePortfolioData() {
  const [selectedAccount] = useSelectedWalletAccount();
  const walletAddress = selectedAccount?.address ?? null;
  const [activeTab, setActiveTab] = useState<"positions" | "history">("positions");
  const [activeType, setActiveType] = useState("all");
  const [chartPeriod, setChartPeriod] = useState<"7d" | "30d" | "90d">("7d");
  const queryClient = useQueryClient();
  // Track wallet on mount, then invalidate status to pick up "fetching" state
  useEffect(() => {
    if (!walletAddress) return;
    api.trackWallet(walletAddress).then(() => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.wallet.status(walletAddress),
      });
    });
  }, [walletAddress, queryClient]);

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

  const analyticsQuery = useQuery({
    queryKey: queryKeys.wallet.analytics(walletAddress!),
    queryFn: () => api.getPortfolioAnalytics(walletAddress!),
    enabled: !!walletAddress,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const prevFetchStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const status = statusQuery.data?.fetch_status;
    if (prevFetchStatus.current !== "ready" && status === "ready") {
      positionsQuery.refetch();
      historyQuery.refetch();
      analyticsQuery.refetch();
    }
    prevFetchStatus.current = status;
  }, [statusQuery.data?.fetch_status]);

  const positions = (positionsQuery.data ?? []).filter((p) => !p.is_closed);

  const byType = useMemo(() => {
    const result: Record<string, UserPositionOut[]> = {};
    for (const p of positions) {
      if (!result[p.product_type]) result[p.product_type] = [];
      result[p.product_type].push(p);
    }
    return result;
  }, [positions]);

  const visiblePositions = activeType === "all" ? positions : (byType[activeType] ?? []);

  const summary = analyticsQuery.data?.summary ?? EMPTY_SUMMARY;
  const stableSummary = analyticsQuery.data?.stablecoin ?? EMPTY_STABLECOIN;
  const diversification = analyticsQuery.data?.diversification ?? null;

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
    analyticsQuery,
    positions,
    byType,
    visiblePositions,
    summary,
    stableSummary,
    diversification,
    chartData,
    showSyncing,
    shortAddr,
  };
}
