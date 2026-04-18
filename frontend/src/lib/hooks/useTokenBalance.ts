"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Fetch on-chain token balance for a wallet by mint address.
 * Proxied through the backend (server-side 15s cache) to avoid
 * frontend RPC rate limits and protect the Helius API key.
 */
export function useTokenBalance(
  walletAddress: string | undefined,
  mint: string | undefined,
) {
  return useQuery({
    queryKey: ["tokenBalance", walletAddress, mint],
    queryFn: () =>
      api.getWalletBalance({ wallet_address: walletAddress!, mint: mint! })
        .then((r) => r.balance),
    enabled: !!walletAddress && !!mint,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
