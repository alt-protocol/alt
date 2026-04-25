import { getLegacyConnection } from "../../shared/rpc.js";
import { logger } from "../../shared/logger.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const cache: Record<string, number> = {};

/**
 * Resolve token decimals with layered fallback:
 * 1. extraData.decimals (fast path — stored at fetch time)
 * 2. On-chain mint account query (source of truth, cached)
 * 3. Default 6 (last resort, logged as warning)
 */
export async function resolveDecimals(
  extraData?: Record<string, unknown>,
  mint?: string | null,
): Promise<number> {
  if (extraData?.decimals != null) return Number(extraData.decimals);

  const mintAddr = mint
    ?? (extraData?.mint_base as string | undefined)
    ?? (extraData?.token_mint as string | undefined)
    ?? (extraData?.mint as string | undefined);

  if (!mintAddr) {
    logger.warn({ extraData: Object.keys(extraData ?? {}) }, "resolveDecimals: no mint, defaulting to 6");
    return 6;
  }

  if (cache[mintAddr] != null) return cache[mintAddr];

  try {
    const connection = await getLegacyConnection();
    const { PublicKey } = await import("@solana/web3.js");
    const info = await connection.getParsedAccountInfo(new PublicKey(mintAddr));
    const decimals = (info?.value?.data as any)?.parsed?.info?.decimals;
    if (decimals != null) {
      cache[mintAddr] = decimals;
      return decimals;
    }
  } catch (err) {
    logger.warn({ err, mint: mintAddr }, "resolveDecimals: on-chain lookup failed");
  }

  logger.warn({ mint: mintAddr }, "resolveDecimals: using default 6");
  return 6;
}
