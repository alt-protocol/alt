/**
 * Fetch live yield data from the Drift Data API.
 *
 * Two data sources:
 *   - Insurance Fund staking: /stats/insuranceFund
 *   - Earn Vaults: /stats/vaults + app.drift.trade/api/vaults for APY
 *
 * Port of backend/app/services/drift_fetcher.py
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { address, getProgramDerivedAddress } from "@solana/addresses";
import { getOrNull, postJson } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { db } from "../db/connection.js";
import { yieldOpportunities } from "../db/schema.js";
import {
  safeFloat,
  upsertOpportunity,
  snapshotAvg,
  deactivateStale,
  getProtocol,
} from "./utils.js";

const DRIFT_API = "https://data.api.drift.trade";
const DRIFT_APP_API = "https://app.drift.trade";
const DRIFT_BASE = "https://app.drift.trade";
const MIN_VAULT_TVL_USD = 10_000;
const DRIFT_PROGRAM = "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH";
const IF_UNSTAKING_PERIOD_DAYS = 13;

const STABLE_SYMBOLS = new Set([
  "USDC", "USDT", "PYUSD", "USDe", "USDS", "DAI", "USDY",
]);

function dGet(path: string): Promise<unknown | null> {
  return getOrNull(`${DRIFT_API}${path}`, { logLabel: "Drift API" });
}

// ---------------------------------------------------------------------------
// PDA derivation
// ---------------------------------------------------------------------------

async function ifVaultPda(marketIndex: number): Promise<string> {
  const seeds = [
    new TextEncoder().encode("insurance_fund_vault"),
    new Uint8Array(new Uint16Array([marketIndex]).buffer),
  ];
  const programAddress = address(DRIFT_PROGRAM);
  const [pda] = await getProgramDerivedAddress({
    programAddress,
    seeds,
  });
  return pda;
}

// ---------------------------------------------------------------------------
// On-chain vault balances
// ---------------------------------------------------------------------------

async function fetchVaultTokenBalances(
  vaultMap: Record<number, string>,
): Promise<Record<number, number>> {
  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl || Object.keys(vaultMap).length === 0) return {};

  const pubkeys = Object.values(vaultMap);
  const idxByPubkey: Record<string, number> = {};
  for (const [idx, pk] of Object.entries(vaultMap)) {
    idxByPubkey[pk] = Number(idx);
  }

  try {
    const data = (await postJson(rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "getMultipleAccounts",
      params: [pubkeys, { encoding: "jsonParsed" }],
    })) as Record<string, unknown>;

    const result = data.result as Record<string, unknown>;
    const accounts = (result?.value ?? []) as (Record<string, unknown> | null)[];
    const balances: Record<number, number> = {};

    for (let i = 0; i < pubkeys.length; i++) {
      const acct = accounts[i];
      if (!acct) continue;
      try {
        const parsed = (
          (acct.data as Record<string, unknown>).parsed as Record<
            string,
            unknown
          >
        ).info as Record<string, unknown>;
        const tokenAmount = parsed.tokenAmount as Record<string, unknown>;
        const balance = Number(tokenAmount.uiAmount);
        if (Number.isFinite(balance)) {
          balances[idxByPubkey[pubkeys[i]]] = balance;
        }
      } catch {
        continue;
      }
    }

    logger.info({ count: Object.keys(balances).length }, "Helius RPC: fetched IF vault balances");
    return balances;
  } catch (err) {
    logger.warn({ err }, "Helius RPC getMultipleAccounts failed");
    return {};
  }
}

// ---------------------------------------------------------------------------
// Vault APYs from app.drift.trade
// ---------------------------------------------------------------------------

async function fetchVaultApys(): Promise<
  Record<string, Record<string, unknown>>
> {
  try {
    const raw = await getOrNull(`${DRIFT_APP_API}/api/vaults`, {
      timeout: 30_000,
      logLabel: "Drift App API",
    });
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};

    const result: Record<string, Record<string, unknown>> = {};
    for (const [pubkey, info] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      if (!info || typeof info !== "object") continue;
      const i = info as Record<string, unknown>;
      const apys = (i.apys as Record<string, unknown>) ?? {};
      result[pubkey] = {
        apy_7d: safeFloat(apys["7d"]),
        apy_30d: safeFloat(apys["30d"]),
        apy_90d: safeFloat(apys["90d"]),
        apy_180d: safeFloat(apys["180d"]),
        apy_365d: safeFloat(apys["365d"]),
        max_drawdown_pct: safeFloat(i.maxDrawdownPct),
        num_snapshots: i.numOfVaultSnapshots,
      };
    }
    logger.info({ count: Object.keys(result).length }, "Drift app API: fetched vault APYs");
    return result;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Insurance Fund
// ---------------------------------------------------------------------------

async function fetchInsuranceFund(
  protocol: { id: number; name: string },
  database: NodePgDatabase,
  now: Date,
): Promise<[number, Record<number, string>]> {
  const raw = await dGet("/stats/insuranceFund");
  let data: unknown[];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const inner = (raw as Record<string, unknown>).data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      data =
        ((inner as Record<string, unknown>).marketSharePriceData as unknown[]) ??
        (inner as unknown[]);
    } else {
      data = inner as unknown[];
    }
  } else {
    data = raw as unknown[];
  }

  if (!Array.isArray(data)) {
    logger.error("Unexpected /stats/insuranceFund response");
    return [0, {}];
  }

  const marketIndexMap: Record<number, string> = {};
  const stableVaults: Record<number, string> = {};

  for (const entry of data) {
    const e = entry as Record<string, unknown>;
    const idx = e.marketIndex;
    const symbol = (e.symbol as string) ?? "";
    if (idx !== undefined && symbol) {
      marketIndexMap[Number(idx)] = symbol;
    }
    if (STABLE_SYMBOLS.has(symbol) && idx !== undefined) {
      stableVaults[Number(idx)] = await ifVaultPda(Number(idx));
    }
  }

  const vaultBalances = await fetchVaultTokenBalances(stableVaults);

  let count = 0;
  const upsertedIds = new Set<string>();
  for (const entry of data) {
    const e = entry as Record<string, unknown>;
    const idx = e.marketIndex;
    const symbol = (e.symbol as string) ?? "";
    const apy = safeFloat(e.apy);

    if (!STABLE_SYMBOLS.has(symbol) || apy === null || idx === undefined)
      continue;

    const depositAddress = stableVaults[Number(idx)] ?? null;
    const tvlUsd = vaultBalances[Number(idx)] ?? null;

    const externalId = `drift-if-${idx}`;
    upsertedIds.add(externalId);
    const opp = await upsertOpportunity(database, {
      protocolId: protocol.id,
      protocolName: protocol.name,
      externalId,
      name: `Drift Insurance Fund — ${symbol}`,
      category: "insurance_fund",
      tokens: symbol ? [symbol] : [],
      apyCurrent: apy,
      tvlUsd,
      depositAddress,
      riskTier: "low",
      extra: {
        market_index: idx,
        source: "drift_api",
        type: "insurance_fund",
        vault_balance_tokens: tvlUsd,
        deposit_address: depositAddress,
        unstaking_period_days: IF_UNSTAKING_PERIOD_DAYS,
        protocol_url: `${DRIFT_BASE}/vaults/insurance-fund-vaults`,
      },
      now,
      source: "drift_api",
      lockPeriodDays: IF_UNSTAKING_PERIOD_DAYS,
      isAutomated: true,
    });

    // Compute 7d/30d averages from stored snapshots
    const avg7d = await snapshotAvg(database, opp.id, 7);
    const avg30d = await snapshotAvg(database, opp.id, 30);
    if (avg7d !== null || avg30d !== null) {
      await database
        .update(yieldOpportunities)
        .set({
          apy_7d_avg: avg7d?.toString() ?? null,
          apy_30d_avg: avg30d?.toString() ?? null,
        })
        .where(eq(yieldOpportunities.id, opp.id));
    }

    count++;
  }

  // Deactivate stale insurance fund entries
  await deactivateStale(database, "drift-if-%", upsertedIds);

  logger.info({ count }, "Drift insurance fund: stablecoin entries");
  return [count, marketIndexMap];
}

// ---------------------------------------------------------------------------
// Earn Vaults
// ---------------------------------------------------------------------------

async function fetchVaults(
  marketIndexMap: Record<number, string>,
  protocol: { id: number; name: string },
  database: NodePgDatabase,
  now: Date,
): Promise<[number, Set<string>]> {
  const raw = await dGet("/stats/vaults");
  let data: unknown[];
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    data =
      ((raw as Record<string, unknown>).vaults as unknown[]) ??
      ((raw as Record<string, unknown>).data as unknown[]) ??
      [];
  } else {
    data = raw as unknown[];
  }

  if (!Array.isArray(data)) {
    logger.error("Unexpected /stats/vaults response");
    return [0, new Set()];
  }

  const vaultApys = await fetchVaultApys();

  let count = 0;
  const upsertedIds = new Set<string>();

  for (const vault of data) {
    const v = vault as Record<string, unknown>;
    const netDeposits = safeFloat(v.netDeposits);
    if (netDeposits === null || netDeposits <= 0) continue;

    const pubkey = (v.pubkey as string) ?? "";
    if (!pubkey) continue;

    const spotMarketIndex = Number(v.spotMarketIndex ?? 0);
    if (spotMarketIndex !== 0) continue; // USDC only

    const tvlUsd = netDeposits;
    if (tvlUsd < MIN_VAULT_TVL_USD) continue;

    const externalId = `drift-vault-${pubkey}`;
    const name = `Drift Vault — USDC (${pubkey.slice(0, 6)})`;

    const apyInfo = vaultApys[pubkey] ?? {};
    let apy7d = safeFloat(apyInfo.apy_7d);
    let apy30d = safeFloat(apyInfo.apy_30d);
    const apy90d = safeFloat(apyInfo.apy_90d);
    const apyCurrent = apy90d; // Use 90d as current (most stable)

    const minDepositRaw = safeFloat(v.minDepositAmount);
    const maxTokens = safeFloat(v.maxTokens);
    const vaultLiqUsd =
      maxTokens && maxTokens > 0 ? maxTokens - netDeposits : null;

    const opp = await upsertOpportunity(database, {
      protocolId: protocol.id,
      protocolName: protocol.name,
      externalId,
      name,
      category: "vault",
      tokens: ["USDC"],
      apyCurrent,
      tvlUsd,
      depositAddress: pubkey,
      riskTier: "low",
      extra: {
        market_index: spotMarketIndex,
        net_deposits_tokens: netDeposits,
        max_tokens: maxTokens,
        profit_share: v.profitShare,
        management_fee: v.managementFee,
        hurdle_rate: v.hurdleRate,
        permissioned: v.permissioned,
        total_deposits: safeFloat(v.totalDeposits),
        total_withdraws: safeFloat(v.totalWithdraws),
        source: "drift_api",
        type: "vault",
        apy_7d: apy7d,
        apy_30d: apy30d,
        apy_90d: apy90d,
        apy_180d: safeFloat(apyInfo.apy_180d),
        apy_365d: safeFloat(apyInfo.apy_365d),
        max_drawdown_pct: safeFloat(apyInfo.max_drawdown_pct),
        num_snapshots: apyInfo.num_snapshots,
        protocol_url: `${DRIFT_BASE}/vaults/strategy-vaults/${pubkey}`,
      },
      now,
      source: "drift_api",
      apy7dAvg: apy7d,
      apy30dAvg: apy30d,
      minDeposit: minDepositRaw,
      liquidityAvailableUsd:
        vaultLiqUsd !== null
          ? Math.round(vaultLiqUsd * 100) / 100
          : null,
      isAutomated: true,
    });

    // Fall back to snapshot averages if API didn't provide
    if (apy7d === null || apy30d === null) {
      const updates: Record<string, unknown> = {};
      if (apy7d === null) {
        const avg = await snapshotAvg(database, opp.id, 7);
        if (avg !== null) updates.apy_7d_avg = avg.toString();
      }
      if (apy30d === null) {
        const avg = await snapshotAvg(database, opp.id, 30);
        if (avg !== null) updates.apy_30d_avg = avg.toString();
      }
      if (Object.keys(updates).length > 0) {
        await database
          .update(yieldOpportunities)
          .set(updates)
          .where(eq(yieldOpportunities.id, opp.id));
      }
    }

    upsertedIds.add(externalId);
    count++;
  }

  // Deactivate stale vault entries
  await deactivateStale(database, "drift-vault-%", upsertedIds);

  logger.info({ count }, "Drift vaults");
  return [count, upsertedIds];
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function fetchDriftYields(): Promise<number> {
  logger.info("Starting Drift yield fetch");
  const now = new Date();

  const protocol = await getProtocol(db, "drift");
  if (!protocol) {
    logger.error("Protocol 'drift' not found in DB — run seed first");
    return 0;
  }

  try {
    return await db.transaction(async (tx) => {
      const [ifCount, marketIndexMap] = await fetchInsuranceFund(
        protocol,
        tx,
        now,
      );
      const [vaultCount] = await fetchVaults(
        marketIndexMap,
        protocol,
        tx,
        now,
      );

      const total = ifCount + vaultCount;
      logger.info({ ifCount, vaultCount }, "Drift fetch complete");
      return total;
    });
  } catch (err) {
    logger.error({ err }, "Drift fetch failed");
    throw err;
  }
}
