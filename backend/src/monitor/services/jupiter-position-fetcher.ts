/**
 * Fetch user positions from Jupiter Lend API and store snapshots.
 *
 * Port of backend/app/services/jupiter_position_fetcher.py
 *
 * Position types:
 *   - Earn: share balances + underlying amounts + PnL from earnings API
 *   - Multiply: stub (REST API not yet available)
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { address, getAddressEncoder, getProgramDerivedAddress } from "@solana/addresses";
import { getWithRetry, getOrNull, postJson } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { safeFloat, parseTimestamp, cachedAsync } from "../../shared/utils.js";
import { classifyToken } from "../../shared/constants.js";
import type { OpportunityMapEntry, UnderlyingToken } from "../../shared/types.js";
import { discoverService } from "../../discover/service.js";
import { db } from "../db/connection.js";
import { trackedWallets } from "../db/schema.js";
import {
  buildPositionDict,
  computeHeldDays,
  storePositionRows,
  batchEarliestSnapshots,
  batchEarliestDeposits,
  loadOpportunityMap,
  type PositionDict,
} from "./utils.js";

const JUPITER_LEND_API = "https://api.jup.ag/lend/v1";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bXo";

function buildHeaders(): Record<string, string> {
  const key = process.env.JUPITER_API_KEY ?? "";
  return key ? { "x-api-key": key } : {};
}

// ---------------------------------------------------------------------------
// ATA derivation + first deposit timestamp
// ---------------------------------------------------------------------------

const addressEncoder = getAddressEncoder();

async function getAta(wallet: string, mint: string): Promise<string> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(ATA_PROGRAM),
    seeds: [
      addressEncoder.encode(address(wallet)),
      addressEncoder.encode(address(TOKEN_PROGRAM)),
      addressEncoder.encode(address(mint)),
    ],
  });
  return pda;
}

// Cache for first deposit timestamps (keyed by wallet+mint, 1 hour TTL)
const _firstDepositCache = new Map<string, { at: number; value: number | null }>();

async function firstDepositTs(
  wallet: string,
  mint: string,
  heliusUrl: string,
): Promise<Date | null> {
  const cacheKey = `jup_opened_${wallet.slice(0, 8)}_${mint.slice(0, 8)}`;
  const now = Date.now();
  const cached = _firstDepositCache.get(cacheKey);
  if (cached && now - cached.at < 3_600_000) {
    return cached.value
      ? new Date(cached.value * 1000)
      : null;
  }

  let oldestBlockTime: number | null = null;
  try {
    const ata = await getAta(wallet, mint);
    let before: string | undefined;

    while (true) {
      const params: Record<string, unknown> = {
        limit: 1000,
        commitment: "confirmed",
      };
      if (before) params.before = before;

      const resp = (await postJson(heliusUrl, {
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [ata, params],
      })) as Record<string, unknown>;

      const sigs =
        ((resp.result as Record<string, unknown>[]) ?? []) as Record<
          string,
          unknown
        >[];
      if (sigs.length === 0) break;

      oldestBlockTime = Number(sigs[sigs.length - 1].blockTime ?? 0);
      if (sigs.length < 1000) break;
      before = sigs[sigs.length - 1].signature as string;
    }
  } catch (err) {
    logger.warn({ err, wallet: wallet.slice(0, 8) }, "Helius getSignaturesForAddress failed");
  }

  _firstDepositCache.set(cacheKey, { at: now, value: oldestBlockTime });
  return oldestBlockTime
    ? new Date(oldestBlockTime * 1000)
    : null;
}

// ---------------------------------------------------------------------------
// Earn token metadata (cached 3 min)
// ---------------------------------------------------------------------------

async function getEarnTokens(
  headers: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  return cachedAsync("jup_earn_tokens", 180_000, async () => {
    const data = await getOrNull(`${JUPITER_LEND_API}/earn/tokens`, {
      logLabel: "Jupiter Lend API",
      headers,
    });
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  });
}

// ---------------------------------------------------------------------------
// Earn positions
// ---------------------------------------------------------------------------

async function fetchEarnPositions(
  wallet: string,
  database: NodePgDatabase,
  now: Date,
  heliusUrl: string,
  oppMap: Record<string, OpportunityMapEntry>,
  headers: Record<string, string>,
): Promise<PositionDict[]> {
  const tokensList = await getEarnTokens(headers);
  const tokenMap: Record<string, Record<string, unknown>> = {};
  for (const token of tokensList) {
    const assetAddress = (token.assetAddress as string) ?? "";
    if (!assetAddress) continue;
    const asset = (token.asset as Record<string, unknown>) ?? {};
    tokenMap[assetAddress] = {
      symbol: (asset.uiSymbol as string) ?? (asset.symbol as string) ?? "",
      decimals: Number(asset.decimals ?? 6),
      price: safeFloat(asset.price),
      total_rate_bps: safeFloat(token.totalRate),
    };
  }

  // Fetch positions with retry
  let positionsData: unknown;
  try {
    positionsData = await getWithRetry(
      `${JUPITER_LEND_API}/earn/positions?users=${wallet}`,
      { headers },
    );
  } catch {
    logger.warn({ wallet: wallet.slice(0, 8) }, "Jupiter /earn/positions failed");
    return [];
  }

  if (!Array.isArray(positionsData) || positionsData.length === 0) return [];

  const positionIds: string[] = [];
  const positionsByAsset: Record<string, Record<string, unknown>> = {};
  for (const pos of positionsData as Record<string, unknown>[]) {
    const assetAddress =
      ((pos.token as Record<string, unknown>)?.assetAddress as string) ??
      "";
    if (!assetAddress) continue;
    const shares = safeFloat(pos.shares);
    if (!shares || shares <= 0) continue;
    positionsByAsset[assetAddress] = pos;
    positionIds.push(assetAddress);
  }

  // Fetch earnings
  const earningsMap: Record<string, number> = {};
  if (positionIds.length > 0) {
    try {
      const earningsData = await getWithRetry(
        `${JUPITER_LEND_API}/earn/earnings?user=${wallet}&positions=${positionIds.join(",")}`,
        { headers },
      );
      logger.debug(
        {
          type: Array.isArray(earningsData) ? "array" : typeof earningsData,
          length: Array.isArray(earningsData) ? earningsData.length : undefined,
          keys: earningsData && typeof earningsData === "object" && !Array.isArray(earningsData)
            ? Object.keys(earningsData as Record<string, unknown>).slice(0, 5)
            : undefined,
        },
        "Jupiter earnings response shape",
      );
      if (Array.isArray(earningsData)) {
        for (const e of earningsData as Record<string, unknown>[]) {
          const addr =
            (e.address as string) ?? (e.assetAddress as string) ?? "";
          const raw = e.earningsUsd ?? e.earnings;
          const val = safeFloat(raw);
          if (addr && val !== null) earningsMap[addr] = val;
        }
      } else if (earningsData && typeof earningsData === "object") {
        for (const [addr, val] of Object.entries(
          earningsData as Record<string, unknown>,
        )) {
          const parsed =
            typeof val !== "object"
              ? safeFloat(val)
              : safeFloat(
                  (val as Record<string, unknown>).usd ??
                    (val as Record<string, unknown>).earnings,
                );
          if (parsed !== null) earningsMap[addr] = parsed;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isAuth = msg.includes("401") || msg.includes("403");
      logger.warn(
        { err: msg, wallet: wallet.slice(0, 8), positionCount: positionIds.length },
        isAuth
          ? "Jupiter /earn/earnings auth failed (check JUPITER_API_KEY) — PnL will be null"
          : "Jupiter /earn/earnings failed — PnL will be null",
      );
    }
  }

  if (positionIds.length > 0 && Object.keys(earningsMap).length === 0) {
    logger.info(
      { wallet: wallet.slice(0, 8), positionCount: positionIds.length },
      "Jupiter earnings: no matches found in response — all PnL will be null",
    );
  }

  const noEarnings = positionIds.length > 0 && Object.keys(earningsMap).length === 0;
  const [earliestMap, earliestDeposits] = await Promise.all([
    batchEarliestSnapshots(database, wallet),
    noEarnings
      ? batchEarliestDeposits(database, wallet)
      : Promise.resolve({} as Record<string, { snapshot_at: Date; deposit_amount_usd: number }>),
  ]);
  const results: PositionDict[] = [];

  for (const [assetAddress, pos] of Object.entries(positionsByAsset)) {
    const tokenInfo = tokenMap[assetAddress] ?? {};
    const decimals = Number(tokenInfo.decimals ?? 6);
    const price = safeFloat(tokenInfo.price);

    const underlyingRaw = safeFloat(pos.underlyingAssets);
    if (underlyingRaw === null || underlyingRaw <= 0) continue;
    const underlyingAmount = underlyingRaw / 10 ** decimals;

    const depositAmountUsd = price ? underlyingAmount * price : null;
    if (depositAmountUsd === null || depositAmountUsd < 0.01) continue;

    let pnlUsd = earningsMap[assetAddress] ?? null;

    // Fallback: approximate PnL from historical snapshots when earnings API fails.
    // This is current_value - earliest_value, so it underestimates PnL if the user
    // made additional deposits after the first snapshot (treats them as initial value).
    if (pnlUsd === null && depositAmountUsd) {
      const earliest = earliestDeposits[assetAddress];
      if (earliest && earliest.deposit_amount_usd > 0) {
        pnlUsd = depositAmountUsd - earliest.deposit_amount_usd;
        logger.debug(
          { wallet: wallet.slice(0, 8), asset: assetAddress.slice(0, 8), pnl: pnlUsd },
          "Jupiter: using snapshot-based PnL fallback",
        );
      }
    }

    let initialDepositUsd: number | null = null;
    let pnlPct: number | null = null;
    if (pnlUsd !== null && depositAmountUsd) {
      initialDepositUsd = depositAmountUsd - pnlUsd;
      if (initialDepositUsd > 0) {
        pnlPct = (pnlUsd / initialDepositUsd) * 100;
      }
    }

    // Lookup by deposit_address first, fall back to external_id pattern
    const entry =
      oppMap[assetAddress] ??
      oppMap[`juplend-earn-${assetAddress.slice(0, 8)}`] ??
      null;
    if (!entry) {
      logger.warn(
        { wallet: wallet.slice(0, 8), assetAddress: assetAddress.slice(0, 12), oppMapSize: Object.keys(oppMap).length },
        "Jupiter position: no opportunity match found",
      );
    }
    let apy = entry?.apy_current ?? null;
    if (apy === null) {
      const rateBps = safeFloat(tokenInfo.total_rate_bps);
      if (rateBps !== null) apy = rateBps / 100;
    }

    let openedAt: Date | null = null;
    if (heliusUrl) {
      openedAt = await firstDepositTs(wallet, assetAddress, heliusUrl);
    }
    if (!openedAt) openedAt = earliestMap[assetAddress] ?? null;

    results.push(
      buildPositionDict({
        wallet_address: wallet,
        protocol_slug: "jupiter",
        product_type: "earn",
        external_id: assetAddress,
        snapshot_at: now,
        opportunity_id: entry?.id ?? null,
        deposit_amount: underlyingAmount,
        deposit_amount_usd: depositAmountUsd,
        pnl_usd: pnlUsd,
        pnl_pct: pnlPct,
        initial_deposit_usd: initialDepositUsd,
        opened_at: openedAt,
        held_days: computeHeldDays(openedAt, now),
        apy,
        token_symbol: (tokenInfo.symbol as string) ?? "",
        underlying_tokens: tokenInfo.symbol ? [{ symbol: tokenInfo.symbol as string, mint: assetAddress, role: "underlying", type: classifyToken(tokenInfo.symbol as string) === "stable" ? "stablecoin" : classifyToken(tokenInfo.symbol as string) } as UnderlyingToken] : null,
        extra_data: {
          shares: safeFloat(pos.shares),
          underlying_amount: underlyingAmount,
          mint: assetAddress,
          source: "jupiter_api",
        },
      }),
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchWalletPositions(
  walletAddress: string,
  database: NodePgDatabase,
): Promise<{
  wallet: string;
  positions: PositionDict[];
  summary: { total_value_usd: number; total_pnl_usd: number; position_count: number };
}> {
  const now = new Date();
  const headers = buildHeaders();
  const heliusUrl = process.env.HELIUS_RPC_URL ?? "";
  const oppMap = await loadOpportunityMap(discoverService);

  const earnPositions = await fetchEarnPositions(
    walletAddress,
    database,
    now,
    heliusUrl,
    oppMap,
    headers,
  );

  const totalValue = earnPositions.reduce(
    (s, p) => s + (p.deposit_amount_usd ?? 0),
    0,
  );
  const totalPnl = earnPositions.reduce(
    (s, p) => s + (p.pnl_usd ?? 0),
    0,
  );

  return {
    wallet: walletAddress,
    positions: earnPositions,
    summary: {
      total_value_usd: totalValue,
      total_pnl_usd: totalPnl,
      position_count: earnPositions.length,
    },
  };
}

export async function snapshotAllWallets(
  database: NodePgDatabase,
  snapshotAt?: Date,
): Promise<number> {
  const wallets = await database
    .select()
    .from(trackedWallets)
    .where(eq(trackedWallets.is_active, true));

  if (wallets.length === 0) return 0;

  logger.info({ count: wallets.length }, "Jupiter position snapshot");
  const now = snapshotAt ?? new Date();
  let totalSnapshots = 0;
  const headers = buildHeaders();
  const heliusUrl = process.env.HELIUS_RPC_URL ?? "";
  const oppMap = await loadOpportunityMap(discoverService);

  for (const wallet of wallets) {
    try {
      const earnPositions = await fetchEarnPositions(
        wallet.wallet_address,
        database,
        now,
        heliusUrl,
        oppMap,
        headers,
      );

      totalSnapshots += await storePositionRows(
        database,
        earnPositions,
        now,
      );

      await database
        .update(trackedWallets)
        .set({ last_fetched_at: now })
        .where(eq(trackedWallets.id, wallet.id));

      logger.info(
        {
          wallet: wallet.wallet_address.slice(0, 8),
          count: earnPositions.length,
        },
        "Jupiter wallet snapshotted",
      );
    } catch (err) {
      logger.error(
        { err, wallet: wallet.wallet_address.slice(0, 8) },
        "Jupiter snapshot failed",
      );
    }
  }

  logger.info({ totalSnapshots }, "Jupiter position snapshot complete");
  return totalSnapshots;
}
