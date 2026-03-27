"use client";

import { useQuery } from "@tanstack/react-query";
import type { WithdrawState } from "@/lib/tx-types";
import { api } from "@/lib/api";

/**
 * Protocol-agnostic withdrawal state hook. Calls backend Manage API to check
 * multi-step withdrawal state (e.g. Drift vault redeem period).
 */
export function useWithdrawState(
  walletAddress: string | undefined,
  protocolSlug: string | undefined,
  depositAddress: string | undefined,
  category: string | undefined,
  extraData?: Record<string, unknown>,
  opportunityId?: number,
) {
  return useQuery<WithdrawState | null>({
    queryKey: ["withdrawState", walletAddress, protocolSlug, depositAddress],
    queryFn: async () => {
      if (!opportunityId) return null;
      return api.getWithdrawState({
        opportunity_id: opportunityId,
        wallet_address: walletAddress!,
      });
    },
    enabled: !!walletAddress && !!protocolSlug && !!depositAddress && !!category && !!opportunityId,
    staleTime: 30_000,
  });
}
