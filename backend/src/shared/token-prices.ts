/**
 * Batch-fetch USD prices for token mints from Jupiter Price API v3.
 * Reusable by any fetcher that receives raw token amounts and needs USD conversion.
 */
import { getOrNull, jupiterHeaders } from "./http.js";

const JUPITER_PRICE_API = "https://api.jup.ag/price/v3";

/**
 * Fetch USD prices for the given mints in a single batched call.
 * Returns Map<mint, usdPrice>. Mints without prices are omitted.
 * Returns empty map on API failure (logged by getOrNull).
 */
export async function getTokenPricesUsd(
  mints: string[],
): Promise<Map<string, number>> {
  const priceMap = new Map<string, number>();
  if (mints.length === 0) return priceMap;

  const unique = [...new Set(mints)];
  const url = `${JUPITER_PRICE_API}?ids=${unique.join(",")}`;
  const raw = await getOrNull(url, {
    headers: jupiterHeaders(),
    logLabel: "Jupiter Price",
  });

  if (!raw || typeof raw !== "object") return priceMap;

  for (const mint of unique) {
    const entry = (raw as Record<string, { usdPrice?: number | string }>)[mint];
    const p = Number(entry?.usdPrice);
    if (Number.isFinite(p) && p > 0) priceMap.set(mint, p);
  }

  return priceMap;
}
