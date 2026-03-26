import { useQuery } from "@tanstack/react-query";
import { address } from "@solana/kit";
import { getRpc } from "@/lib/rpc";
import { queryKeys } from "@/lib/queryKeys";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fetch the user's token balance in a Kamino vault directly from RPC. */
async function fetchVaultBalance(walletAddress: string, vaultAddress: string): Promise<number> {
  const sdk = await import("@kamino-finance/klend-sdk");
  const vault = new sdk.KaminoVault(getRpc() as any, address(vaultAddress) as any);

  const [exchangeRate, userShares] = await Promise.all([
    vault.getExchangeRate(),
    vault.getUserShares(address(walletAddress) as any),
  ]);

  if (userShares.totalShares.isZero()) return 0;
  return userShares.totalShares.mul(exchangeRate).toNumber();
}

/**
 * Query a user's token balance in a Kamino vault directly from Solana RPC.
 * Returns the balance in underlying tokens (not shares).
 */
export function useVaultBalance(
  walletAddress: string | undefined,
  vaultAddress: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.vault.balance(walletAddress!, vaultAddress!),
    queryFn: () => fetchVaultBalance(walletAddress!, vaultAddress!),
    enabled: !!walletAddress && !!vaultAddress,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
