"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Protocol-agnostic balance hook. Calls backend Manage API to fetch
 * protocol-specific vault/position balance.
 */
export function usePositionBalance(
  walletAddress: string | undefined,
  opportunityId: number | undefined,
) {
  return useQuery({
    queryKey: ["positionBalance", walletAddress, opportunityId],
    queryFn: async () => {
      const { balance } = await api.getBalance({
        opportunity_id: opportunityId!,
        wallet_address: walletAddress!,
      });
      return balance;
    },
    enabled: !!walletAddress && !!opportunityId,
    staleTime: 30_000,
  });
}
