/**
 * Fetch live yield data from the Kamino Finance API.
 *
 * Three data sources:
 *   - Earn Vaults: /kvaults/vaults + per-vault /metrics
 *   - Lending Reserves: /v2/kamino-market (primary) + reserves/metrics
 *   - Multiply Markets: all markets + reserve metrics + reserve history
 *
 * Port of backend/app/services/kamino_fetcher.py
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getOrNull } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { db } from "../db/connection.js";
import {
  safeFloat,
  classifyToken,
  classifyMultiplyPair,
  upsertOpportunity,
  batchSnapshotAvg,
  deactivateStale,
  getProtocol,
} from "./utils.js";

const KAMINO_API = "https://api.kamino.finance";
const KAMINO_APP = "https://app.kamino.finance";
const MIN_TVL_USD = 100_000;

async function kGet(path: string): Promise<unknown | null> {
  return getOrNull(`${KAMINO_API}${path}`, { logLabel: "Kamino API" });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildMintMap(): Promise<Record<string, string>> {
  const prices = await kGet("/oracles/prices");
  if (!Array.isArray(prices)) return {};
  const map: Record<string, string> = {};
  for (const p of prices) {
    if (p.mint && p.name) map[p.mint] = p.name;
  }
  return map;
}

function parseMaxLeverage(description: string): number | null {
  const m = /(\d+)x/.exec(description);
  return m ? parseInt(m[1], 10) : null;
}

function maxLeverageFromLtv(ltv: number | null): number | null {
  if (ltv === null || ltv <= 0 || ltv >= 1) return null;
  return Math.round((1.0 / (1.0 - ltv)) * 10) / 10;
}

function linreg(x: number[], y: number[]): [number, number] {
  const n = x.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
    sxy += x[i] * y[i];
    sxx += x[i] * x[i];
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return [0, 0];
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return [slope, intercept];
}

function deriveCollateralYield(
  collHistory: unknown[],
  debtHistory: unknown[],
  lastN: number,
): number | null {
  let usable = Math.min(collHistory.length, debtHistory.length);
  if (usable < lastN) {
    if (usable < 48) return null;
    lastN = usable;
  }

  const ch = collHistory.slice(-lastN) as Record<string, unknown>[];
  const dh = debtHistory.slice(-lastN) as Record<string, unknown>[];
  const ratios: number[] = [];

  for (let i = 0; i < Math.min(ch.length, dh.length); i++) {
    try {
      const cm = ch[i].metrics as Record<string, unknown>;
      const dm = dh[i].metrics as Record<string, unknown>;
      const cp = Number(cm.assetPriceUSD);
      const dp = Number(dm.assetPriceUSD);
      if (dp > 0 && Number.isFinite(cp)) ratios.push(cp / dp);
    } catch {
      continue;
    }
  }

  if (ratios.length < 48) return null;

  const hours = Array.from({ length: ratios.length }, (_, i) => i);
  const [slope] = linreg(hours, ratios);
  const avgRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  if (avgRatio <= 0) return null;

  return (slope * 8760) / avgRatio;
}

function getCollateralYield(
  collSymbol: string,
  collHistory: unknown[],
  debtHistory: unknown[],
  collReserve: Record<string, unknown>,
  lastN: number,
): [number | null, string] {
  const tokenType = classifyToken(collSymbol);

  if (tokenType === "yield_bearing_stable") {
    return [deriveCollateralYield(collHistory, debtHistory, 720), "price_ratio"];
  }
  if (tokenType === "stable") {
    const avg = avgFromHistory(collHistory, "supplyInterestAPY", lastN);
    return [avg ?? safeFloat(collReserve.supplyApy), "supply_apy"];
  }
  if (tokenType === "lst") {
    const result = deriveCollateralYield(collHistory, debtHistory, 720);
    return result !== null ? [result, "staking_apy"] : [null, "unavailable"];
  }
  return [null, "unavailable"];
}

function getCollateralYieldCurrent(
  collSymbol: string,
  collHistory: unknown[],
  debtHistory: unknown[],
  collReserve: Record<string, unknown>,
): number | null {
  const tokenType = classifyToken(collSymbol);

  if (tokenType === "stable") {
    return safeFloat(collReserve.supplyApy);
  }
  if (tokenType === "yield_bearing_stable") {
    return deriveCollateralYield(collHistory, debtHistory, 720);
  }
  if (tokenType === "lst") {
    return deriveCollateralYield(collHistory, debtHistory, 720);
  }
  return null;
}

function computeNetApy(
  collYield: number | null,
  borrowApy: number | null,
  leverage: number,
): number | null {
  if (collYield === null || borrowApy === null) return null;
  return collYield * leverage - borrowApy * (leverage - 1);
}

function avgFromHistory(
  history: unknown[],
  field: string,
  lastN: number,
): number | null {
  if (history.length === 0) return null;
  const entries = history.slice(-lastN) as Record<string, unknown>[];
  const values: number[] = [];
  for (const h of entries) {
    const metrics = h.metrics as Record<string, unknown> | undefined;
    const v = metrics?.[field];
    if (v !== null && v !== undefined) values.push(Number(v));
  }
  return values.length > 0
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

async function fetchReserveHistory(
  marketPk: string,
  reservePk: string,
  start: string,
  end: string,
): Promise<unknown[]> {
  const data = await kGet(
    `/kamino-market/${marketPk}/reserves/${reservePk}/metrics/history?start=${start}&end=${end}`,
  );
  if (data && typeof data === "object" && "history" in (data as Record<string, unknown>)) {
    return (data as Record<string, unknown>).history as unknown[];
  }
  return [];
}

function toPct(v: number | null): number | null {
  return v !== null ? v * 100 : null;
}

// ---------------------------------------------------------------------------
// Earn Vaults
// ---------------------------------------------------------------------------

async function fetchEarnVaults(
  mintMap: Record<string, string>,
  protocol: { id: number; name: string },
  database: NodePgDatabase,
  now: Date,
): Promise<number> {
  const vaultsRaw = await kGet("/kvaults/vaults");
  if (!Array.isArray(vaultsRaw)) {
    logger.error("Unexpected /kvaults/vaults response");
    return 0;
  }

  const activeVaults = vaultsRaw.filter(
    (v: Record<string, unknown>) =>
      parseInt(
        String(
          (v.state as Record<string, unknown>)?.sharesIssued ?? "0",
        ),
        10,
      ) > 0,
  );
  logger.info(
    { total: vaultsRaw.length, active: activeVaults.length },
    "Kamino earn vaults",
  );

  // Fetch metrics in parallel (batches of 20)
  const BATCH_SIZE = 20;
  const vaultMetrics: Record<string, Record<string, unknown>> = {};

  for (let i = 0; i < activeVaults.length; i += BATCH_SIZE) {
    const batch = activeVaults.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (v: Record<string, unknown>) => {
        const pubkey = v.address as string;
        const metrics = await kGet(`/kvaults/vaults/${pubkey}/metrics`);
        return { pubkey, metrics };
      }),
    );
    for (const { pubkey, metrics } of results) {
      if (metrics && typeof metrics === "object") {
        vaultMetrics[pubkey] = metrics as Record<string, unknown>;
      }
    }
  }

  logger.info(
    { fetched: Object.keys(vaultMetrics).length, total: activeVaults.length },
    "Fetched vault metrics",
  );

  let count = 0;
  for (const vault of activeVaults) {
    try {
      const pubkey = (vault as Record<string, unknown>).address as string;
      const metrics = vaultMetrics[pubkey];
      if (!metrics) continue;

      const tvl =
        (safeFloat(metrics.tokensInvestedUsd) ?? 0) +
        (safeFloat(metrics.tokensAvailableUsd) ?? 0);
      if (tvl < MIN_TVL_USD) continue;

      const state = (vault as Record<string, unknown>).state as Record<
        string,
        unknown
      >;
      const tokenMint = (state?.tokenMint as string) ?? "";
      const symbol = mintMap[tokenMint] ?? tokenMint.slice(0, 8);
      const name = `Kamino Earn — ${symbol} (${pubkey.slice(0, 6)})`;

      let apyCurrent = safeFloat(metrics.apy);
      let apy7d = safeFloat(metrics.apy7d);
      let apy30d = safeFloat(metrics.apy30d);

      if (apyCurrent !== null) apyCurrent *= 100;
      if (apy7d !== null) apy7d *= 100;
      if (apy30d !== null) apy30d *= 100;

      const tokensAvailableUsd = safeFloat(metrics.tokensAvailableUsd);

      await upsertOpportunity(database, {
        protocolId: protocol.id,
        protocolName: protocol.name,
        externalId: pubkey,
        name,
        category: "vault",
        tokens: [symbol],
        apyCurrent,
        apy7dAvg: apy7d,
        apy30dAvg: apy30d,
        tvlUsd: tvl,
        depositAddress: pubkey,
        riskTier: "low",
        extra: {
          token_mint: tokenMint,
          shares_mint: state?.sharesMint ?? null,
          protocol_url: `${KAMINO_APP}/lending/earn/${pubkey}`,
          source: "kamino_api",
          type: "earn_vault",
        },
        now,
        source: "kamino_api",
        liquidityAvailableUsd:
          tokensAvailableUsd !== null
            ? Math.round(tokensAvailableUsd * 100) / 100
            : null,
      });
      count++;
    } catch (err) {
      const pubkey = (vault as Record<string, unknown>).address;
      logger.warn({ err, pubkey }, "Kamino earn vault: skipping item");
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Lending Reserves
// ---------------------------------------------------------------------------

async function fetchLendingReserves(
  mintMap: Record<string, string>,
  protocol: { id: number; name: string },
  database: NodePgDatabase,
  now: Date,
): Promise<number> {
  const marketsRaw = await kGet("/v2/kamino-market");
  if (!Array.isArray(marketsRaw)) {
    logger.error("Unexpected /v2/kamino-market response");
    return 0;
  }

  const primaryMarkets = marketsRaw.filter(
    (m: Record<string, unknown>) => m.isPrimary,
  );
  logger.info({ count: primaryMarkets.length }, "Kamino lending primary markets");

  const avgMap = await batchSnapshotAvg(database, protocol.id, "lending");
  const endStr = now.toISOString().slice(0, 10);
  const start30d = new Date(now.getTime() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  let count = 0;
  for (const market of primaryMarkets) {
    const marketPubkey = (market as Record<string, unknown>)
      .lendingMarket as string;
    const marketName =
      ((market as Record<string, unknown>).name as string) ??
      marketPubkey.slice(0, 8);

    const reserves = await kGet(
      `/kamino-market/${marketPubkey}/reserves/metrics`,
    );
    if (!Array.isArray(reserves)) continue;

    // Cache reserve history per market (same pattern as multiply flow)
    const reserveHistories: Record<string, unknown[]> = {};

    for (const reserve of reserves) {
      try {
        const r = reserve as Record<string, unknown>;
        const symbol = (r.liquidityToken as string) ?? "";
        const tokenMint = (r.liquidityTokenMint as string) ?? "";
        const tvl = safeFloat(r.totalSupplyUsd) ?? 0;
        if (tvl < MIN_TVL_USD) continue;

        let supplyApy = safeFloat(r.supplyApy);
        let borrowApy = safeFloat(r.borrowApy);
        if (supplyApy !== null) supplyApy *= 100;
        if (borrowApy !== null) borrowApy *= 100;

        const reservePubkey = (r.reserve as string) ?? "";
        const externalId = `klend-${marketPubkey.slice(0, 8)}-${reservePubkey.slice(0, 8)}`;
        const avgs = avgMap[externalId] ?? {};

        // Fallback: fetch 30d supply APY from Kamino reserve history
        let apy30d = avgs["30d"] ?? null;
        if (apy30d === null) {
          if (!reserveHistories[reservePubkey]) {
            reserveHistories[reservePubkey] = await fetchReserveHistory(
              marketPubkey, reservePubkey, start30d, endStr,
            );
          }
          const avg = avgFromHistory(reserveHistories[reservePubkey], "supplyInterestAPY", 720);
          if (avg !== null) apy30d = avg * 100;
        }

        await upsertOpportunity(database, {
          protocolId: protocol.id,
          protocolName: protocol.name,
          externalId,
          name: `Kamino Lend — ${symbol} (${marketName})`,
          category: "lending",
          tokens: [symbol],
          apyCurrent: supplyApy,
          apy7dAvg: avgs["7d"] ?? null,
          apy30dAvg: apy30d,
          tvlUsd: tvl,
          depositAddress: reservePubkey,
          riskTier: "low",
          extra: {
            token_mint: tokenMint,
            reserve: reservePubkey,
            protocol_url: `${KAMINO_APP}/lending/reserve/${reservePubkey}/${marketPubkey}`,
            supply_apy_raw: r.supplyApy,
            borrow_apy_raw: r.borrowApy,
            borrow_apy_pct: borrowApy,
            max_ltv: r.maxLtv,
            total_supply: r.totalSupply,
            total_borrow: r.totalBorrow,
            total_supply_usd: r.totalSupplyUsd,
            total_borrow_usd: r.totalBorrowUsd,
            market: marketPubkey,
            market_name: marketName,
            source: "kamino_api",
            type: "lending",
          },
          now,
          source: "kamino_api",
          liquidityAvailableUsd: null,
        });
        count++;
      } catch (err) {
        const r = reserve as Record<string, unknown>;
        logger.warn({ err, reserve: r.reserve }, "Kamino lending: skipping reserve");
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Multiply Markets
// ---------------------------------------------------------------------------

interface ReserveMeta {
  reserve: string;
  liquidityToken: string;
  liquidityTokenMint: string;
  maxLtv: unknown;
  supplyApy: unknown;
  borrowApy: unknown;
  totalSupplyUsd: unknown;
  totalBorrowUsd: unknown;
  totalSupply: unknown;
  totalBorrow: unknown;
  [key: string]: unknown;
}

function enumerateCollateralDebtPairs(
  reserves: ReserveMeta[],
  isPrimary: boolean,
): [ReserveMeta, ReserveMeta][] {
  const collCandidates = reserves.filter(
    (r) => (safeFloat(r.maxLtv) ?? 0) > 0,
  );
  if (collCandidates.length === 0) return [];

  const pairs: [ReserveMeta, ReserveMeta][] = [];
  for (const coll of collCandidates) {
    for (const debt of reserves) {
      if (debt.reserve === coll.reserve) continue;
      const debtBorrow = safeFloat(debt.totalBorrowUsd) ?? 0;
      const debtSupply = safeFloat(debt.totalSupplyUsd) ?? 0;
      if (debtBorrow <= 0 && debtSupply <= 0) continue;

      if (isPrimary) {
        const tag = classifyMultiplyPair(
          coll.liquidityToken,
          debt.liquidityToken,
        );
        if (tag !== "stable_loop" && tag !== "rwa_loop") continue;
      }

      pairs.push([coll, debt]);
    }
  }
  return pairs;
}

async function fetchMultiplyMarkets(
  protocol: { id: number; name: string },
  database: NodePgDatabase,
  now: Date,
): Promise<[number, Set<string>]> {
  const marketsRaw = await kGet("/v2/kamino-market");
  if (!Array.isArray(marketsRaw)) {
    logger.error("Unexpected /v2/kamino-market response");
    return [0, new Set()];
  }

  const multiplyMarkets = marketsRaw.filter(
    (m: Record<string, unknown>) => m.name,
  );
  logger.info(
    { count: multiplyMarkets.length },
    "Kamino multiply markets (incl primary)",
  );

  const endStr = now.toISOString().slice(0, 10);
  const start30d = new Date(now.getTime() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  let count = 0;
  const upsertedIds = new Set<string>();

  for (const market of multiplyMarkets) {
    const m = market as Record<string, unknown>;
    const marketPubkey = m.lendingMarket as string;
    const marketName = (m.name as string) ?? marketPubkey.slice(0, 8);
    const marketDescription = (m.description as string) ?? "";
    const isPrimary = Boolean(m.isPrimary);

    const reserves = await kGet(
      `/kamino-market/${marketPubkey}/reserves/metrics`,
    );
    if (!Array.isArray(reserves)) continue;
    const typedReserves = reserves as ReserveMeta[];

    const marketTvl = typedReserves.reduce(
      (sum, r) => sum + (safeFloat(r.totalSupplyUsd) ?? 0),
      0,
    );
    if (marketTvl < MIN_TVL_USD) continue;

    const pairs = enumerateCollateralDebtPairs(typedReserves, isPrimary);
    if (pairs.length === 0) continue;

    // Cache reserve history per market
    const reserveHistories: Record<string, unknown[]> = {};
    async function getHistory(reservePk: string): Promise<unknown[]> {
      if (!reserveHistories[reservePk]) {
        reserveHistories[reservePk] = await fetchReserveHistory(
          marketPubkey,
          reservePk,
          start30d,
          endStr,
        );
      }
      return reserveHistories[reservePk];
    }

    const maxLeverageFromDesc = parseMaxLeverage(marketDescription);

    for (const [collReserve, debtReserve] of pairs) {
      try {
        const collSymbol = collReserve.liquidityToken;
        const debtSymbol = debtReserve.liquidityToken;
        const collPk = collReserve.reserve;
        const debtPk = debtReserve.reserve;

        const collLtvVal = safeFloat(collReserve.maxLtv);
        let maxLeverage: number | null;
        if (maxLeverageFromDesc && pairs.length === 1) {
          maxLeverage = maxLeverageFromDesc;
        } else {
          maxLeverage = maxLeverageFromLtv(collLtvVal);
        }

        const borrowApyCurrent = safeFloat(debtReserve.borrowApy);

        const collHistory = await getHistory(collPk);
        const debtHistory = await getHistory(debtPk);

        const borrowAvg7d = avgFromHistory(debtHistory, "borrowInterestAPY", 168);
        const borrowAvg30d = avgFromHistory(
          debtHistory,
          "borrowInterestAPY",
          720,
        );

        const [collYield7d, apySource] = getCollateralYield(
          collSymbol,
          collHistory,
          debtHistory,
          collReserve as unknown as Record<string, unknown>,
          168,
        );
        const [collYield30d] = getCollateralYield(
          collSymbol,
          collHistory,
          debtHistory,
          collReserve as unknown as Record<string, unknown>,
          720,
        );
        const collYieldCurrent = getCollateralYieldCurrent(
          collSymbol,
          collHistory,
          debtHistory,
          collReserve as unknown as Record<string, unknown>,
        );

        const effectiveLeverage = maxLeverage ?? 3;
        const netApyCurrent = computeNetApy(
          collYieldCurrent,
          borrowApyCurrent,
          effectiveLeverage,
        );
        const netApy7d = computeNetApy(
          collYield7d,
          borrowAvg7d,
          effectiveLeverage,
        );
        const netApy30d = computeNetApy(
          collYield30d,
          borrowAvg30d,
          effectiveLeverage,
        );

        const netApyCurrentPct = toPct(netApyCurrent);
        const netApy7dPct = toPct(netApy7d);
        const netApy30dPct = toPct(netApy30d);

        // Build leverage table
        const leverageTable: Record<
          string,
          Record<string, number | null>
        > = {};
        const levSteps = [2, 3, 5, 8, 10];
        if (effectiveLeverage && !levSteps.includes(effectiveLeverage)) {
          levSteps.push(effectiveLeverage);
          levSteps.sort((a, b) => a - b);
        }
        for (const lev of levSteps) {
          if (maxLeverage && lev > maxLeverage + 0.1) continue;
          leverageTable[`${lev}x`] = {
            net_apy_current_pct: toPct(
              computeNetApy(collYieldCurrent, borrowApyCurrent, lev),
            ),
            net_apy_7d_pct: toPct(
              computeNetApy(collYield7d, borrowAvg7d, lev),
            ),
            net_apy_30d_pct: toPct(
              computeNetApy(collYield30d, borrowAvg30d, lev),
            ),
          };
        }

        // Rich data from reserve history
        const latestCollMetrics =
          collHistory.length > 0
            ? ((collHistory[collHistory.length - 1] as Record<string, unknown>)
                .metrics as Record<string, unknown>) ?? {}
            : {};
        const latestDebtMetrics =
          debtHistory.length > 0
            ? ((debtHistory[debtHistory.length - 1] as Record<string, unknown>)
                .metrics as Record<string, unknown>) ?? {}
            : {};

        const collTotalSupplyTokens = safeFloat(
          latestCollMetrics.totalSupply,
        );
        const collPrice = safeFloat(latestCollMetrics.assetPriceUSD);
        const collateralSuppliedUsd =
          collTotalSupplyTokens !== null && collPrice !== null
            ? collTotalSupplyTokens * collPrice
            : safeFloat(collReserve.totalSupplyUsd) ?? 0;

        const debtTotalSupply =
          safeFloat(latestDebtMetrics.totalSupply) ??
          safeFloat(debtReserve.totalSupply) ??
          0;
        const debtTotalBorrow =
          safeFloat(latestDebtMetrics.totalBorrows) ??
          safeFloat(debtReserve.totalBorrow) ??
          0;
        const debtDecimals = Number(latestDebtMetrics.decimals ?? 6);
        const debtBorrowLimitRaw =
          safeFloat(latestDebtMetrics.reserveBorrowLimit) ?? 0;
        const debtBorrowLimit =
          debtBorrowLimitRaw > 0
            ? debtBorrowLimitRaw / 10 ** debtDecimals
            : Infinity;
        const debtPrice =
          safeFloat(latestDebtMetrics.assetPriceUSD) ?? 1.0;

        const supplyAvailable = debtTotalSupply - debtTotalBorrow;
        const borrowLimitRemaining = debtBorrowLimit - debtTotalBorrow;
        const liqAvailableTokens = Math.max(
          0,
          Math.min(supplyAvailable, borrowLimitRemaining),
        );
        const liqAvailableUsd = liqAvailableTokens * debtPrice;

        const collDepositLimitRaw =
          safeFloat(latestCollMetrics.reserveDepositLimit) ?? 0;
        const collDecimals = Number(latestCollMetrics.decimals ?? 6);
        const collDepositLimit =
          collDepositLimitRaw > 0
            ? collDepositLimitRaw / 10 ** collDecimals
            : null;

        const utilization =
          debtTotalSupply > 0
            ? (debtTotalBorrow / debtTotalSupply) * 100
            : 0;

        const collLtvHistory =
          latestCollMetrics.loanToValue ?? collLtvVal;
        const collLiqThreshold =
          latestCollMetrics.liquidationThreshold ?? null;
        const borrowCurve = latestDebtMetrics.borrowCurve ?? null;

        const vaultTag = classifyMultiplyPair(collSymbol, debtSymbol);
        const externalId = `kmul-${marketPubkey.slice(0, 8)}-${collPk.slice(0, 6)}-${debtPk.slice(0, 6)}`;
        const name = `Kamino Multiply — ${collSymbol}/${debtSymbol} (${marketName})`;

        const extra: Record<string, unknown> = {
          protocol_url: "https://kamino.com/multiply",
          market: marketPubkey,
          market_name: marketName,
          market_description: marketDescription,
          market_lookup_table: (m as Record<string, unknown>).lookupTable ?? "",
          market_is_curated: (m as Record<string, unknown>).isCurated ?? false,
          max_leverage: maxLeverage,
          vault_tag: vaultTag,
          apy_source: apySource,
          collateral_symbol: collSymbol,
          collateral_mint: collReserve.liquidityTokenMint,
          collateral_reserve: collPk,
          collateral_reserve_supply_usd: collateralSuppliedUsd,
          collateral_supply_tokens: collTotalSupplyTokens,
          collateral_price_usd: collPrice,
          collateral_deposit_limit: collDepositLimit,
          debt_available_usd: liqAvailableUsd,
          debt_available_tokens: liqAvailableTokens,
          debt_borrow_limit:
            debtBorrowLimit !== Infinity ? debtBorrowLimit : null,
          debt_borrow_limit_remaining:
            debtBorrowLimit !== Infinity ? borrowLimitRemaining : null,
          debt_price_usd: debtPrice,
          collateral_ltv: collLtvHistory,
          collateral_liquidation_threshold: collLiqThreshold,
          collateral_yield_current_pct: toPct(collYieldCurrent),
          collateral_yield_7d_pct: toPct(collYield7d),
          collateral_yield_30d_pct: toPct(collYield30d),
          debt_symbol: debtSymbol,
          debt_mint: debtReserve.liquidityTokenMint,
          debt_reserve: debtPk,
          debt_supply_usd: debtTotalSupply * debtPrice,
          debt_borrow_usd: debtTotalBorrow * debtPrice,
          borrow_apy_current_pct: toPct(borrowApyCurrent),
          borrow_apy_7d_pct: toPct(borrowAvg7d),
          borrow_apy_30d_pct: toPct(borrowAvg30d),
          utilization_pct: Math.round(utilization * 100) / 100,
          borrow_curve: borrowCurve,
          net_apy_current_pct: netApyCurrentPct,
          net_apy_7d_pct: netApy7dPct,
          net_apy_30d_pct: netApy30dPct,
          leverage_used: effectiveLeverage,
          leverage_table: leverageTable,
          all_reserves: typedReserves.map((r) => ({
            symbol: r.liquidityToken,
            mint: r.liquidityTokenMint,
            reserve: r.reserve,
            max_ltv: r.maxLtv,
            supply_apy: r.supplyApy,
            borrow_apy: r.borrowApy,
            total_supply_usd: r.totalSupplyUsd,
            total_borrow_usd: r.totalBorrowUsd,
          })),
          source: "kamino_api",
          type: "multiply",
        };

        const opp = await upsertOpportunity(database, {
          protocolId: protocol.id,
          protocolName: protocol.name,
          externalId,
          name,
          category: "multiply",
          tokens: [collSymbol, debtSymbol],
          apyCurrent: netApyCurrentPct,
          apy7dAvg: netApy7dPct,
          apy30dAvg: netApy30dPct,
          tvlUsd: marketTvl,
          depositAddress: collPk,
          riskTier: (maxLeverage ?? 0) >= 8 ? "high" : "medium",
          extra,
          now,
          source: "kamino_api",
          liquidityAvailableUsd: liqAvailableUsd,
        });

        upsertedIds.add(externalId);
        count++;

        logger.debug(
          {
            name,
            leverage: effectiveLeverage,
            apySource,
            borrowPct: borrowApyCurrent !== null ? (borrowApyCurrent * 100).toFixed(2) : "N/A",
            collYield7dPct: collYield7d !== null ? (collYield7d * 100).toFixed(2) : "N/A",
            netApy7dPct: netApy7dPct !== null ? netApy7dPct.toFixed(2) : "N/A",
          },
          "Multiply pair upserted",
        );
      } catch (err) {
        logger.warn({ err, coll: collReserve.liquidityToken, debt: debtReserve.liquidityToken }, "Kamino multiply: skipping pair");
      }
    }
  }

  return [count, upsertedIds];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function fetchKaminoYields(): Promise<number> {
  logger.info("Starting Kamino yield fetch");
  const now = new Date();

  const protocol = await getProtocol(db, "kamino");
  if (!protocol) {
    logger.error("Protocol 'kamino' not found in DB — run seed first");
    return 0;
  }

  try {
    const mintMap = await buildMintMap();
    logger.info({ count: Object.keys(mintMap).length }, "Loaded token symbols from oracle");

    return await db.transaction(async (tx) => {
      const earnCount = await fetchEarnVaults(mintMap, protocol, tx, now);
      const lendCount = await fetchLendingReserves(mintMap, protocol, tx, now);
      const [mulCount, mulIds] = await fetchMultiplyMarkets(
        protocol,
        tx,
        now,
      );

      // Deactivate stale multiply entries
      await deactivateStale(tx, "kmul-%", mulIds);

      const total = earnCount + lendCount + mulCount;
      logger.info(
        { earnCount, lendCount, mulCount },
        "Kamino fetch complete",
      );
      return total;
    });
  } catch (err) {
    logger.error({ err }, "Kamino fetch failed");
    throw err;
  }
}
