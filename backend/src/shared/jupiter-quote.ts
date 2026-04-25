/**
 * Shared Jupiter lite-api quote helper.
 *
 * Used by both Kamino and Jupiter adapters for price impact estimation,
 * and by Jupiter adapter for lightweight price quotes.
 *
 * Uses V1 lite API (no balance check, no instructions) with 5s cache.
 */
import { getWithRetry, jupiterHeaders } from "./http.js";
import { cachedAsync } from "./utils.js";

const JUPITER_LITE_API = "https://lite-api.jup.ag/swap/v1";
const QUOTE_TIMEOUT_MS = 10_000;

export interface LiteQuote {
  outAmount: string;
  priceImpactPct: number;
}

/**
 * Fetch a lightweight Jupiter swap quote (cached 5s).
 *
 * @throws on API error or zero output (no liquidity)
 */
export async function getJupiterLiteQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number,
): Promise<LiteQuote> {
  const url = `${JUPITER_LITE_API}/quote?${new URLSearchParams({
    inputMint,
    outputMint,
    amount,
    slippageBps: String(slippageBps),
  })}`;

  const cacheKey = `jup:lite:${inputMint}:${outputMint}:${amount}:${slippageBps}`;
  const data = (await cachedAsync(cacheKey, 5_000, () =>
    getWithRetry(url, { timeout: QUOTE_TIMEOUT_MS, headers: jupiterHeaders() }),
  )) as Record<string, unknown>;

  if (data.error || !data.outAmount) {
    throw Object.assign(
      new Error((data.error as string) ?? "No swap quote available"),
      { statusCode: 400 },
    );
  }

  return {
    outAmount: String(data.outAmount),
    priceImpactPct: Math.abs(Number(data.priceImpactPct ?? 0)),
  };
}
