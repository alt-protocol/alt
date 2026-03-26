"use client";

import { useQuery } from "@tanstack/react-query";
import { getAdapter } from "@/lib/protocols";

/**
 * Protocol-agnostic balance hook. Delegates to adapter.getBalance() if available.
 * Returns null if the adapter doesn't implement getBalance (caller should fallback
 * to backend position data).
 */
export function usePositionBalance(
  walletAddress: string | undefined,
  protocolSlug: string | undefined,
  depositAddress: string | undefined,
  category: string | undefined,
  extraData?: Record<string, unknown>,
) {
  return useQuery({
    queryKey: ["positionBalance", walletAddress, protocolSlug, depositAddress],
    queryFn: async () => {
      const adapter = await getAdapter(protocolSlug!);
      if (!adapter?.getBalance) return null;
      return adapter.getBalance({
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
