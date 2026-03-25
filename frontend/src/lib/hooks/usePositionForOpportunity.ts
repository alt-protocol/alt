import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";

export function usePositionForOpportunity(
  walletAddress: string | undefined,
  opportunityId: number,
) {
  // Fire-and-forget wallet tracking (same pattern as usePortfolioData)
  useEffect(() => {
    if (walletAddress) api.trackWallet(walletAddress);
  }, [walletAddress]);

  const positionsQuery = useQuery({
    queryKey: queryKeys.positions.list(walletAddress!),
    queryFn: () => api.getPositions(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const position =
    positionsQuery.data?.find(
      (p) => p.opportunity_id === opportunityId && !p.is_closed,
    ) ?? null;

  return { position, isLoading: positionsQuery.isLoading };
}
