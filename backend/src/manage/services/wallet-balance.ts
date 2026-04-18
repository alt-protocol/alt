/**
 * Wallet token balance service — fetches on-chain SPL/SOL balances.
 * Used by the /wallet-balance endpoint to proxy balance queries for the frontend.
 * Server-side caching (via cachedAsync at the route level) prevents RPC rate limits.
 */
import { getLegacyConnection } from "../../shared/rpc.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SOL_MINT = "So11111111111111111111111111111111111111112";

export async function fetchWalletBalance(wallet: string, mint: string): Promise<number> {
  const { PublicKey } = await import("@solana/web3.js");
  const connection = await getLegacyConnection();
  const walletPk = new PublicKey(wallet);

  if (mint === SOL_MINT) {
    const lamports = await connection.getBalance(walletPk);
    return lamports / 1e9;
  }

  const accounts = await connection.getParsedTokenAccountsByOwner(walletPk, {
    mint: new PublicKey(mint),
  });

  if (!accounts.value.length) return 0;

  let total = 0;
  for (const acc of accounts.value) {
    total += (acc.account.data as any).parsed?.info?.tokenAmount?.uiAmount ?? 0;
  }
  return total;
}
