"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Protocol-agnostic balance hook. Calls backend Manage API to fetch
 * protocol-specific vault/position balance.
 */
export function usePositionBalance(
  walletAddress: string | undefined,
  protocolSlug: string | undefined,
  depositAddress: string | undefined,
  category: string | undefined,
  extraData?: Record<string, unknown>,
  opportunityId?: number,
) {
  return useQuery({
    queryKey: ["positionBalance", walletAddress, protocolSlug, depositAddress],
    queryFn: async () => {
      if (!opportunityId) return null;
      const { balance } = await api.getBalance({
        opportunity_id: opportunityId,
        wallet_address: walletAddress!,
      });
      return balance;
    },
    enabled: !!walletAddress && !!protocolSlug && !!depositAddress && !!category && !!opportunityId,
    staleTime: 30_000,
  });
}
