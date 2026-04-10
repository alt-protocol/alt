"use client";

import { useQuery } from "@tanstack/react-query";
import { address } from "@solana/kit";
import { getRpc } from "@/lib/rpc";

const SOL_MINT = "So11111111111111111111111111111111111111112";

async function fetchBalance(walletAddress: string, mint: string): Promise<number> {
  if (mint === SOL_MINT) {
    const result = await getRpc().getBalance(address(walletAddress)).send();
    return Number(result.value) / 1e9;
  }

  const result = await getRpc()
    .getTokenAccountsByOwner(
      address(walletAddress),
      { mint: address(mint) },
      { encoding: "jsonParsed" },
    )
    .send();

  const accounts = result.value;
  if (!accounts.length) return 0;

  let total = 0;
  for (const acc of accounts) {
    const parsed = acc.account.data as {
      parsed?: { info?: { tokenAmount?: { uiAmount?: number } } };
    };
    total += parsed?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
  }
  return total;
}

/**
 * Fetch on-chain token balance for a wallet by mint address.
 * Pass the SPL token mint directly — no symbol lookup needed.
 */
export function useTokenBalance(
  walletAddress: string | undefined,
  mint: string | undefined,
) {
  return useQuery({
    queryKey: ["tokenBalance", walletAddress, mint],
    queryFn: () => fetchBalance(walletAddress!, mint!),
    enabled: !!walletAddress && !!mint,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
