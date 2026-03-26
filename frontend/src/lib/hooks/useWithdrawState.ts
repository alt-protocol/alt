"use client";

import { useQuery } from "@tanstack/react-query";
import type { WithdrawState } from "@/lib/protocols/types";
import { getAdapter } from "@/lib/protocols";

/**
 * Protocol-agnostic withdrawal state hook. Delegates to adapter.getWithdrawState()
 * for protocols with multi-step withdrawals (e.g. Drift vault redeem period).
 * Returns null for protocols that don't implement getWithdrawState.
 */
export function useWithdrawState(
  walletAddress: string | undefined,
  protocolSlug: string | undefined,
  depositAddress: string | undefined,
  category: string | undefined,
  extraData?: Record<string, unknown>,
) {
  return useQuery<WithdrawState | null>({
    queryKey: ["withdrawState", walletAddress, protocolSlug, depositAddress],
    queryFn: async () => {
      const adapter = await getAdapter(protocolSlug!);
      if (!adapter?.getWithdrawState) return null;
      return adapter.getWithdrawState({
        walletAddress: walletAddress!,
        depositAddress: depositAddress!,
        category: category!,
        extraData,
      });
    },
    enabled: !!walletAddress && !!protocolSlug && !!depositAddress && !!category,
    staleTime: 30_000,
  });
}
