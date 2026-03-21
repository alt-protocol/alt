"use client";

import { useQuery } from "@tanstack/react-query";
import { createSolanaRpc, address } from "@solana/kit";
import { HELIUS_RPC_URL, TOKEN_MINTS } from "../constants";

const rpc = createSolanaRpc(HELIUS_RPC_URL);

const TOKEN_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  USDT: 6,
  mSOL: 9,
  jitoSOL: 9,
  USDS: 6,
};

function getMintForSymbol(symbol: string): string | undefined {
  return TOKEN_MINTS[symbol as keyof typeof TOKEN_MINTS];
}

async function fetchBalance(walletAddress: string, tokenSymbol: string): Promise<number> {
  const mint = getMintForSymbol(tokenSymbol);

  if (tokenSymbol === "SOL") {
    const result = await rpc.getBalance(address(walletAddress)).send();
    const decimals = TOKEN_DECIMALS.SOL ?? 9;
    return Number(result.value) / 10 ** decimals;
  }

  if (!mint) return 0;

  const result = await rpc
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
    const parsed = acc.account.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } };
    total += parsed?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
  }
  return total;
}

export function useTokenBalance(walletAddress: string | undefined, tokenSymbol: string) {
  return useQuery({
    queryKey: ["tokenBalance", walletAddress, tokenSymbol],
    queryFn: () => fetchBalance(walletAddress!, tokenSymbol),
    enabled: !!walletAddress && !!tokenSymbol,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
