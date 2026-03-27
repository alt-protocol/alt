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
  opportunityId: number | undefined,
) {
  return useQuery<WithdrawState | null>({
    queryKey: ["withdrawState", walletAddress, opportunityId],
    queryFn: async () => {
      return api.getWithdrawState({
        opportunity_id: opportunityId!,
        wallet_address: walletAddress!,
      });
    },
    enabled: !!walletAddress && !!opportunityId,
    staleTime: 30_000,
  });
}
