/**
 * Fetch yield data from Exponent Finance via their REST API.
 *
 * Pure HTTP — zero SDK dependencies. Matches Drift/Jupiter/Kamino pattern.
 * Stores ALL markets; asset_class column handles filtering.
 */
import { getOrNull } from "../../shared/http.js";
import { getSymbolForMint } from "../../shared/constants.js";
import { logger } from "../../shared/logger.js";
import { db } from "../db/connection.js";
import {
  safeFloat,
  upsertOpportunity,
  deactivateStale,
  getProtocol,
  tokenType,
  batchSnapshotAvg,
} from "./utils.js";

const EXPONENT_API = "https://api.exponent.finance/markets";
const MIN_TVL_USD = 1_000;

// ---------------------------------------------------------------------------
// Types (inline — matches API response shape)
// ---------------------------------------------------------------------------

interface ExponentMarket {
  vaultAddress: string;
  underlyingAsset: { mint: string; ticker: string; name: string; decimals: number };
  ptMint: string;
  ytMint: string;
  syMint: string;
  impliedApy: number;
  totalMarketSize: number;
  maturityDateUnixTs: number;
  marketStatus: string;
  categories: string[];
  platformName: string;
  tokenName: string;
  syExchangeRate: number;
  annualizedLpFeesPct: number;
  liquidity: number;
  legacyLiquidity: number;
  underlyingApy: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Derive asset_class from Exponent's categories field. */
function exponentAssetClass(m: ExponentMarket): string {
  if (m.categories?.includes("Stablecoins")) return "stablecoin";
  if (m.categories?.includes("SOL") || m.categories?.includes("Staking")) return "sol";
  if (m.tokenName?.toUpperCase().includes("BTC")) return "btc";
  return "other";
}

function fmtMaturity(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Main fetcher
// ---------------------------------------------------------------------------

export async function fetchExponentYields(): Promise<number> {
  const protocol = await getProtocol(db, "exponent");
  if (!protocol) {
    logger.warn("Exponent protocol not seeded");
    return 0;
  }

  const data = (await getOrNull(EXPONENT_API, {
    logLabel: "Exponent API",
  })) as ExponentMarket[] | null;

  if (!Array.isArray(data)) {
    logger.warn("Exponent API: unexpected response");
    return 0;
  }

  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const ptIds = new Set<string>();
  const lpIds = new Set<string>();
  let count = 0;

  const avgs = await batchSnapshotAvg(db, protocol.id, "earn");

  for (const m of data) {
    if (m.marketStatus !== "active") continue;
    if (m.maturityDateUnixTs <= nowSec) continue;
    if ((m.totalMarketSize ?? 0) < MIN_TVL_USD) continue;

    const symbol = getSymbolForMint(m.underlyingAsset.mint) ?? m.underlyingAsset.ticker;
    const monthYear = fmtMaturity(m.maturityDateUnixTs);
    const daysToMaturity = Math.ceil((m.maturityDateUnixTs - nowSec) / 86400);
    const assetClass = exponentAssetClass(m);

    const commonExtra = {
      market_vault: m.vaultAddress,
      market_address: (m as any).legacyMarketAddresses?.[0] ?? null,
      platform: m.platformName,
      mint_pt: m.ptMint,
      mint_yt: m.ytMint,
      mint_sy: m.syMint,
      mint_base: m.underlyingAsset.mint,
      decimals: m.underlyingAsset.decimals ?? 6,
      expiration_ts: m.maturityDateUnixTs,
      expiration_date: new Date(m.maturityDateUnixTs * 1000).toISOString(),
      pt_price: safeFloat((m as any).ptPriceInAsset) ?? 1.0,
      sy_exchange_rate: m.syExchangeRate,
      underlying_apy: m.underlyingApy,
      source: "exponent_api",
      protocol_url: "https://app.exponent.finance/income",
    };

    // --- PT opportunity ---
    const ptApy = safeFloat(m.impliedApy);
    const ptExtId = `exponent-pt-${m.vaultAddress}`;
    ptIds.add(ptExtId);
    const ptAvgs = avgs[ptExtId] ?? { "7d": null, "30d": null };
    await upsertOpportunity(db, {
      protocolId: protocol.id,
      protocolName: protocol.name,
      externalId: ptExtId,
      name: `Exponent PT — ${symbol} (${monthYear})`,
      category: "earn",
      tokens: [symbol],
      apyCurrent: ptApy !== null ? ptApy * 100 : null,
      apy7dAvg: ptAvgs["7d"],
      apy30dAvg: ptAvgs["30d"],
      tvlUsd: safeFloat(m.totalMarketSize),
      depositAddress: m.vaultAddress,
      riskTier: "low",
      extra: { ...commonExtra, type: "exponent_pt" },
      now,
      source: "exponent_api",
      lockPeriodDays: daysToMaturity,
      assetClass,
      underlyingTokens: [{
        symbol,
        mint: m.underlyingAsset.mint,
        role: "underlying",
        type: tokenType(symbol),
      }],
    });
    count++;

    // --- LP opportunity (only if pool has liquidity) ---
    const hasLiquidity = (m.liquidity ?? 0) > 0 || (m.legacyLiquidity ?? 0) > 0;
    if (hasLiquidity) {
      const lpApy = safeFloat(m.annualizedLpFeesPct);
      const lpExtId = `exponent-lp-${m.vaultAddress}`;
      lpIds.add(lpExtId);
      const lpAvgs = avgs[lpExtId] ?? { "7d": null, "30d": null };
      await upsertOpportunity(db, {
        protocolId: protocol.id,
        protocolName: protocol.name,
        externalId: lpExtId,
        name: `Exponent LP — ${symbol} (${monthYear})`,
        category: "earn",
        tokens: [symbol],
        apyCurrent: lpApy !== null && lpApy > 0 ? lpApy * 100 : null,
        apy7dAvg: lpAvgs["7d"],
        apy30dAvg: lpAvgs["30d"],
        tvlUsd: safeFloat(m.totalMarketSize),
        depositAddress: m.vaultAddress,
        riskTier: "medium",
        extra: { ...commonExtra, type: "exponent_lp" },
        now,
        source: "exponent_api",
        lockPeriodDays: daysToMaturity,
        assetClass,
        underlyingTokens: [{
          symbol,
          mint: m.underlyingAsset.mint,
          role: "underlying",
          type: tokenType(symbol),
        }],
      });
      count++;
    }
  }

  await deactivateStale(db, "exponent-pt-%", ptIds);
  await deactivateStale(db, "exponent-lp-%", lpIds);

  logger.info({ count }, "Exponent fetch complete");
  return count;
}
