/**
 * DeFi Llama pool data service.
 * Provides 30-day average APY as a bootstrap fallback when local snapshots
 * haven't accumulated enough history (< 15 days).
 */
import { getOrNull } from "../../shared/http.js";
import { cachedAsync } from "../../shared/utils.js";
import { logger } from "../../shared/logger.js";

interface DefiLlamaPool {
  pool: string;
  project: string;
  chain: string;
  symbol: string;
  apyMean30d: number | null;
  poolMeta: string | null;
}

const POOLS_URL = "https://yields.llama.fi/pools";
const CACHE_KEY = "defillama-solana-index";
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes
const SYMBOL_ALIASES: Record<string, string> = { SOL: "WSOL" };

async function fetchSolanaPoolIndex(): Promise<Map<string, DefiLlamaPool>> {
  return cachedAsync(CACHE_KEY, CACHE_TTL_MS, async () => {
    const raw = await getOrNull(POOLS_URL, {
      timeout: 60_000,
      logLabel: "DeFi Llama",
    });

    const resp = raw as { status?: string; data?: unknown[] } | null;
    if (!resp || resp.status !== "success" || !Array.isArray(resp.data)) {
      logger.warn("DeFi Llama: unexpected response or fetch failed");
      return new Map<string, DefiLlamaPool>();
    }

    const index = new Map<string, DefiLlamaPool>();
    for (const p of resp.data) {
      const pool = p as DefiLlamaPool;
      if (pool.chain !== "Solana") continue;

      const sym = pool.symbol.toUpperCase();
      // Primary key: "project:SYMBOL"
      const primaryKey = `${pool.project}:${sym}`;
      if (!index.has(primaryKey)) {
        index.set(primaryKey, pool);
      }
      // Secondary key with poolMeta: "project:SYMBOL:poolMeta"
      if (pool.poolMeta) {
        index.set(`${pool.project}:${sym}:${pool.poolMeta}`, pool);
      }
    }

    logger.info({ poolCount: index.size }, "DeFi Llama: Solana pool index built");
    return index;
  });
}

/**
 * Get 30-day average APY from DeFi Llama for a given protocol pool.
 * Returns null if the pool is not found or DeFi Llama is unavailable.
 */
export async function getDefiLlama30dAvg(
  project: string,
  symbol: string,
  poolMeta?: string,
): Promise<number | null> {
  const index = await fetchSolanaPoolIndex();
  const sym = symbol.toUpperCase();

  // Try with poolMeta first (more specific), then without
  let pool =
    (poolMeta ? index.get(`${project}:${sym}:${poolMeta}`) : undefined) ??
    index.get(`${project}:${sym}`);

  // Retry with alias (e.g., SOL → WSOL on DeFi Llama)
  const alias = SYMBOL_ALIASES[sym];
  if (!pool && alias) {
    pool =
      (poolMeta ? index.get(`${project}:${alias}:${poolMeta}`) : undefined) ??
      index.get(`${project}:${alias}`);
  }

  if (!pool || pool.apyMean30d === null || pool.apyMean30d === undefined) {
    return null;
  }

  return pool.apyMean30d;
}
