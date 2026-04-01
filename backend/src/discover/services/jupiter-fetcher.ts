/**
 * Fetch live yield data from Jupiter Lend API.
 *
 * Two data sources:
 *   - Earn tokens: GET /earn/tokens
 *   - Multiply vaults: GET /borrow/vaults
 *
 * Port of backend/app/services/jupiter_fetcher.py
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getWithRetry } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { getDefiLlama30dAvg } from "./defillama.js";
import { computeDepeg } from "../../shared/constants.js";
import { db } from "../db/connection.js";
import {
  safeFloat,
  classifyMultiplyPair,
  upsertOpportunity,
  batchSnapshotAvg,
  deactivateStale,
  getProtocol,
} from "./utils.js";

const JUPITER_LEND_API = "https://api.jup.ag/lend/v1";
const MIN_TVL_USD = 100_000;

function buildHeaders(): Record<string, string> {
  const key = process.env.JUPITER_API_KEY ?? "";
  return key ? { "x-api-key": key } : {};
}

// ---------------------------------------------------------------------------
// Earn Tokens
// ---------------------------------------------------------------------------

async function fetchEarnTokens(
  protocol: { id: number; name: string },
  database: NodePgDatabase,
  now: Date,
  headers: Record<string, string>,
): Promise<[number, Set<string>]> {
  let data: unknown;
  try {
    data = await getWithRetry(`${JUPITER_LEND_API}/earn/tokens`, { headers });
  } catch (err) {
    logger.warn({ err }, "Jupiter Lend API /earn/tokens failed after retries");
    return [0, new Set()];
  }

  if (!Array.isArray(data)) {
    logger.error("Unexpected /earn/tokens response");
    return [0, new Set()];
  }

  const avgs = await batchSnapshotAvg(database, protocol.id, "lending");

  let count = 0;
  const upsertedIds = new Set<string>();

  for (const token of data) {
    const t = token as Record<string, unknown>;
    const asset = (t.asset as Record<string, unknown>) ?? {};
    const assetAddress = (t.assetAddress as string) ?? "";
    if (!assetAddress) continue;

    const decimals = Number(asset.decimals ?? 6);
    const price = safeFloat(asset.price);
    const totalAssets = safeFloat(t.totalAssets);
    if (totalAssets === null || price === null) continue;

    const tvlUsd = (totalAssets / 10 ** decimals) * price;
    if (tvlUsd < MIN_TVL_USD) continue;

    const totalRateBps = safeFloat(t.totalRate);
    if (totalRateBps === null) continue;

    const apy = totalRateBps / 100;
    const symbol =
      (asset.uiSymbol as string) ?? (asset.symbol as string) ?? "";
    const externalId = `juplend-earn-${assetAddress.slice(0, 8)}`;

    const supplyRate = safeFloat(t.supplyRate);
    const rewardsRate = safeFloat(t.rewardsRate);
    const oppAvgs = avgs[externalId] ?? {};

    await upsertOpportunity(database, {
      protocolId: protocol.id,
      protocolName: protocol.name,
      externalId,
      name: `Jupiter Lend — ${symbol}`,
      category: "lending",
      tokens: symbol ? [symbol] : [],
      apyCurrent: apy,
      tvlUsd,
      depositAddress: assetAddress,
      riskTier: "low",
      extra: {
        source: "jupiter_api",
        mint: assetAddress,
        supply_rate_bps: supplyRate,
        rewards_rate_bps: rewardsRate,
        total_rate_bps: totalRateBps,
      },
      now,
      source: "jupiter_api",
      isAutomated: true,
      depeg: computeDepeg(symbol, price),
      apy7dAvg: oppAvgs["7d"] ?? null,
      apy30dAvg: oppAvgs["30d"] ?? await getDefiLlama30dAvg("jupiter-lend", symbol, "Earn"),
      liquidityAvailableUsd: null,
    });

    upsertedIds.add(externalId);
    count++;
  }

  // Deactivate stale earn entries
  await deactivateStale(database, "juplend-earn-%", upsertedIds);

  logger.info({ count }, "Jupiter earn entries");
  return [count, upsertedIds];
}

// ---------------------------------------------------------------------------
// Multiply Vaults
// ---------------------------------------------------------------------------

async function fetchMultiplyVaults(
  protocol: { id: number; name: string },
  database: NodePgDatabase,
  now: Date,
  headers: Record<string, string>,
): Promise<[number, Set<string>]> {
  let data: unknown;
  try {
    data = await getWithRetry(`${JUPITER_LEND_API}/borrow/vaults`, {
      headers,
    });
  } catch (err) {
    logger.warn(
      { err },
      "Jupiter Lend API /borrow/vaults failed after retries",
    );
    return [0, new Set()];
  }

  if (!Array.isArray(data)) {
    logger.error("Unexpected /borrow/vaults response");
    return [0, new Set()];
  }

  // strict: false — no Jupiter historical API; use whatever snapshots exist
  const avgs = await batchSnapshotAvg(database, protocol.id, "multiply", { strict: false });

  let count = 0;
  const upsertedIds = new Set<string>();

  for (const vault of data) {
    try {
      const v = vault as Record<string, unknown>;
      const metadata = (v.metadata as Record<string, unknown>) ?? {};
      const multiply = (metadata.multiply as Record<string, unknown>) ?? {};
      if (!multiply.enabled) continue;

      const vaultId = (v.id as string) ?? "";
      const vaultAddress = (v.address as string) ?? "";
      if (!vaultId || !vaultAddress) continue;

      const supplyToken =
        (v.supplyToken as Record<string, unknown>) ?? {};
      const borrowToken =
        (v.borrowToken as Record<string, unknown>) ?? {};

      const supplyDecimals = Number(supplyToken.decimals ?? 6);
      const supplyPrice = safeFloat(supplyToken.price);
      const totalSupply = safeFloat(v.totalSupply);
      if (totalSupply === null || supplyPrice === null) continue;

      const tvlUsd = (totalSupply / 10 ** supplyDecimals) * supplyPrice;
      if (tvlUsd < MIN_TVL_USD) continue;

      // Collateral APR (bps): supplyRate + stakingApr
      const supplyRate = safeFloat(v.supplyRate) ?? 0;
      const stakingApr = safeFloat(supplyToken.stakingApr) ?? 0;
      const collateralAprBps = supplyRate + stakingApr;

      // Borrow APR (bps)
      const borrowRate = safeFloat(v.borrowRate) ?? 0;

      // Max leverage
      const collateralFactor = safeFloat(v.collateralFactor) ?? 0;
      const reduceFactor = safeFloat(v.reduceFactor) ?? 0;
      const rawLev =
        collateralFactor < 1000
          ? 1 / (1 - collateralFactor / 1000)
          : 100;
      const maxLeverage =
        Math.floor(rawLev * (1 - reduceFactor / 10000) * 10) / 10;

      // Net multiply APR → APY
      const collateralAprPct = collateralAprBps / 100;
      const borrowAprPct = borrowRate / 100;
      const netAprPct =
        collateralAprPct * maxLeverage -
        borrowAprPct * (maxLeverage - 1);
      const apyCurrent = Math.max(netAprPct, 0);

      const collateralApy = collateralAprPct;
      const borrowCostApy = borrowAprPct;

      // Liquidity available
      const liquidityData =
        (v.liquidityBorrowData as Record<string, unknown>) ?? {};
      const borrowable = safeFloat(liquidityData.borrowable);
      const borrowDecimals = Number(borrowToken.decimals ?? 6);
      const borrowPrice = safeFloat(borrowToken.price);
      let liquidityUsd: number | null = null;
      if (borrowable !== null && borrowPrice !== null) {
        liquidityUsd = (borrowable / 10 ** borrowDecimals) * borrowPrice;
      }

      const supplySymbol =
        (supplyToken.uiSymbol as string) ??
        (supplyToken.symbol as string) ??
        "";
      const borrowSymbol =
        (borrowToken.uiSymbol as string) ??
        (borrowToken.symbol as string) ??
        "";

      const externalId = `juplend-mult-${vaultId}`;

      // Depeg for pegged vaults
      let multiplyDepeg: number | null = null;
      if (multiply.pegged) {
        multiplyDepeg = computeDepeg(supplySymbol, supplyPrice);
      }

      const vaultTag = classifyMultiplyPair(supplySymbol, borrowSymbol);
      const oppAvgs = avgs[externalId] ?? {};

      await upsertOpportunity(database, {
        protocolId: protocol.id,
        protocolName: protocol.name,
        externalId,
        name: `Jupiter Multiply — ${supplySymbol}/${borrowSymbol}`,
        category: "multiply",
        tokens: [supplySymbol, borrowSymbol],
        apyCurrent,
        tvlUsd,
        depositAddress: vaultAddress,
        riskTier: "medium",
        extra: {
          source: "jupiter_api",
          vault_id: vaultId,
          vault_tag: vaultTag,
          market: metadata.market ?? "",
          collateral_apy: collateralApy,
          borrow_cost: borrowCostApy,
          max_leverage: maxLeverage,
          max_apy: netAprPct,
          liquidity_available_usd: liquidityUsd,
          collateral_factor: collateralFactor,
          liquidation_threshold: safeFloat(v.liquidationThreshold),
          liquidation_penalty: safeFloat(v.liquidationPenalty),
          total_positions: v.totalPositions,
          pegged: multiply.pegged,
          staking_apr_bps: stakingApr,
          supply_token_mint: supplyToken.address ?? "",
          borrow_token_mint: borrowToken.address ?? "",
        },
        now,
        source: "jupiter_api",
        maxLeverage,
        liquidityAvailableUsd:
          liquidityUsd !== null
            ? Math.round(liquidityUsd * 100) / 100
            : null,
        isAutomated: true,
        depeg: multiplyDepeg,
        apy7dAvg: oppAvgs["7d"] ?? null,
        apy30dAvg: oppAvgs["30d"] ?? null,
      });

      upsertedIds.add(externalId);
      count++;
    } catch (err) {
      const v = vault as Record<string, unknown>;
      logger.warn({ err, vaultId: v.id }, "Jupiter multiply: skipping vault");
    }
  }

  // Deactivate stale multiply entries
  await deactivateStale(database, "juplend-mult-%", upsertedIds);

  logger.info({ count }, "Jupiter multiply entries");
  return [count, upsertedIds];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function fetchJupiterYields(): Promise<number> {
  logger.info("Starting Jupiter Lend yield fetch");
  const now = new Date();

  const protocol = await getProtocol(db, "jupiter");
  if (!protocol) {
    logger.error("Protocol 'jupiter' not found in DB — run seed first");
    return 0;
  }

  const headers = buildHeaders();

  try {
    return await db.transaction(async (tx) => {
      const [earnCount] = await fetchEarnTokens(
        protocol,
        tx,
        now,
        headers,
      );
      const [multCount] = await fetchMultiplyVaults(
        protocol,
        tx,
        now,
        headers,
      );

      const total = earnCount + multCount;
      logger.info({ earnCount, multCount }, "Jupiter fetch complete");
      return total;
    });
  } catch (err) {
    logger.error({ err }, "Jupiter fetch failed");
    throw err;
  }
}
