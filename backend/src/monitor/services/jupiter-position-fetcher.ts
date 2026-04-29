/**
 * Fetch user positions from Jupiter Lend API and store snapshots.
 *
 * Port of backend/app/services/jupiter_position_fetcher.py
 *
 * Position types:
 *   - Earn: share balances + underlying amounts + PnL from earnings API
 *   - Multiply: vault positions via Jupiter Portfolio REST API
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import { userPositions } from "../db/schema.js";
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
const JUPITER_PORTFOLIO_API = "https://api.jup.ag/portfolio/v1";
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
  const jlTokenMap: Record<string, string> = {};
  for (const pos of positionsData as Record<string, unknown>[]) {
    const tokenObj = pos.token as Record<string, unknown> | undefined;
    const assetAddress = (tokenObj?.assetAddress as string) ?? "";
    if (!assetAddress) continue;
    const shares = safeFloat(pos.shares);
    if (!shares || shares <= 0) continue;
    positionsByAsset[assetAddress] = pos;
    positionIds.push(assetAddress);
    const jlMint = (tokenObj?.address as string) ?? "";
    if (jlMint) jlTokenMap[assetAddress] = jlMint;
  }

  // Reverse map: vault token (jl) address → asset address
  const jlToAsset: Record<string, string> = {};
  for (const [assetAddr, jlAddr] of Object.entries(jlTokenMap)) {
    jlToAsset[jlAddr] = assetAddr;
  }

  // Earnings API expects vault token (jl) addresses, not asset addresses
  const jlPositionIds = positionIds
    .map((assetAddr) => jlTokenMap[assetAddr])
    .filter(Boolean);

  // Fetch earnings
  const earningsMap: Record<string, number> = {};
  if (jlPositionIds.length > 0) {
    try {
      const earningsData = await getWithRetry(
        `${JUPITER_LEND_API}/earn/earnings?user=${wallet}&positions=${jlPositionIds.join(",")}`,
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
          const jlAddr = (e.address as string) ?? "";
          const assetAddr = jlToAsset[jlAddr] ?? jlAddr;
          const rawEarnings = safeFloat(e.earnings);
          if (assetAddr && rawEarnings !== null) {
            // earnings is in lamports — convert to USD
            const info = tokenMap[assetAddr];
            const dec = Number(info?.decimals ?? 6);
            const px = safeFloat(info?.price) ?? 1;
            earningsMap[assetAddr] = (rawEarnings / 10 ** dec) * px;
          }
        }
      } else if (earningsData && typeof earningsData === "object") {
        for (const [jlAddr, val] of Object.entries(
          earningsData as Record<string, unknown>,
        )) {
          const assetAddr = jlToAsset[jlAddr] ?? jlAddr;
          const rawEarnings =
            typeof val !== "object"
              ? safeFloat(val)
              : safeFloat(
                  (val as Record<string, unknown>).usd ??
                    (val as Record<string, unknown>).earnings,
                );
          if (rawEarnings !== null) {
            const info = tokenMap[assetAddr];
            const dec = Number(info?.decimals ?? 6);
            const px = safeFloat(info?.price) ?? 1;
            earningsMap[assetAddr] = (rawEarnings / 10 ** dec) * px;
          }
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

  const [earliestMap, earliestDeposits] = await Promise.all([
    batchEarliestSnapshots(database, wallet),
    batchEarliestDeposits(database, wallet),
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

    let pnlUsd: number | null = earningsMap[assetAddress] ?? null;

    // Earnings API returns lifetime cumulative earnings (includes withdrawn positions).
    // If earnings exceed current position value, they're from a larger prior position
    // and can't represent this position's PnL — discard and fall back to snapshots.
    if (pnlUsd !== null && depositAmountUsd && pnlUsd > depositAmountUsd) {
      logger.debug(
        { wallet: wallet.slice(0, 8), asset: assetAddress.slice(0, 8), earnings: pnlUsd, current: depositAmountUsd },
        "Jupiter: earnings exceed position value (cumulative lifetime) — using snapshot fallback",
      );
      pnlUsd = null;
    }

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
      // Use jlToken mint (not underlying asset) — the jlToken ATA was created on
      // first deposit and has far fewer transactions than e.g. a USDC ATA.
      const mintForTs = jlTokenMap[assetAddress] ?? assetAddress;
      openedAt = await firstDepositTs(wallet, mintForTs, heliusUrl);
    }
    if (!openedAt) openedAt = earliestMap[assetAddress] ?? null;

    results.push(
      buildPositionDict({
        wallet_address: wallet,
        protocol_slug: "jupiter",
        product_type: "lending",
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
// Multiply positions via Portfolio API
// ---------------------------------------------------------------------------

const BORROW_LINK_RE = /\/borrow\/(\d+)\/nfts\/(\d+)/;

interface PortfolioPosition {
  type: string;
  fetcherId: string;
  value: number;
  netApy: number;
  tags?: string[];
  data: {
    suppliedAssets: { data: { address: string; amount: number; price: number; yields?: { apr: number; apy: number }[] }; value: number }[];
    borrowedAssets: { data: { address: string; amount: number; price: number }; value: number }[];
    suppliedValue: number;
    borrowedValue: number;
    value: number;
    healthRatio: number;
    ref: string;
    sourceRefs: { name: string; address: string }[];
    link: string;
  };
}

async function fetchMultiplyPositions(
  wallet: string,
  now: Date,
  oppMap: Record<string, OpportunityMapEntry>,
  headers: Record<string, string>,
  earliestDeposits: Record<string, { snapshot_at: Date; deposit_amount_usd: number }>,
  heliusUrl: string,
): Promise<PositionDict[]> {
  let portfolioData: unknown;
  try {
    portfolioData = await getWithRetry(
      `${JUPITER_PORTFOLIO_API}/positions/${wallet}`,
      { headers },
    );
  } catch (err) {
    logger.warn({ err, wallet: wallet.slice(0, 8) }, "Jupiter Portfolio API failed — skipping multiply");
    return [];
  }

  const responseObj = portfolioData as Record<string, unknown>;
  const elements = responseObj?.elements;
  if (!Array.isArray(elements)) return [];

  const borrowPositions = (elements as PortfolioPosition[]).filter(
    (p) => p.fetcherId === "jupiter-exchange-borrow",
  );
  if (borrowPositions.length === 0) return [];

  const results: PositionDict[] = [];

  for (const pos of borrowPositions) {
    try {
      const linkMatch = pos.data.link?.match(BORROW_LINK_RE);
      if (!linkMatch) {
        logger.warn({ link: pos.data.link, wallet: wallet.slice(0, 8) }, "Jupiter multiply: cannot parse vault/nft from link");
        continue;
      }
      const vaultId = Number(linkMatch[1]);
      const nftId = Number(linkMatch[2]);
      const externalId = `juplend-mult-${vaultId}-${nftId}`;

      const suppliedValue = pos.data.suppliedValue ?? 0;
      const borrowedValue = pos.data.borrowedValue ?? 0;
      const netValue = pos.data.value ?? suppliedValue - borrowedValue;

      if (netValue < 0.01) continue;

      const leverage = suppliedValue > 0 ? suppliedValue / Math.max(0.01, netValue) : 1;
      const ltv = suppliedValue > 0 ? borrowedValue / suppliedValue : 0;
      const healthFactor = pos.data.healthRatio ?? 0;

      // Map to discover opportunity
      const vaultAddress = pos.data.sourceRefs?.find((r) => r.name === "Vault")?.address ?? "";
      const entry =
        oppMap[`juplend-mult-${vaultId}`] ??
        (vaultAddress ? oppMap[vaultAddress] : null) ??
        null;

      const apy = pos.netApy != null ? pos.netApy * 100 : (entry?.apy_current ?? null);

      // Token info from portfolio response
      const supplyAsset = pos.data.suppliedAssets?.[0];
      const borrowAsset = pos.data.borrowedAssets?.[0];
      const supplyMint = supplyAsset?.data.address ?? "";
      const borrowMint = borrowAsset?.data.address ?? "";
      const nftMint = pos.data.sourceRefs?.find((r) => r.name === "NFT Mint")?.address ?? "";

      // Token symbol from opportunity extra_data
      const extra = entry?.extra_data ?? {};
      const supplySymbol = (entry?.first_token as string) ?? "";
      const borrowSymbol = typeof extra.borrow_token_symbol === "string" ? extra.borrow_token_symbol : "";
      const tokenSymbol = supplySymbol;

      // PnL: snapshot-based
      let pnlUsd: number | null = null;
      let pnlPct: number | null = null;
      let initialDepositUsd: number | null = null;
      const earliest = earliestDeposits[externalId];
      if (earliest && earliest.deposit_amount_usd > 0) {
        pnlUsd = netValue - earliest.deposit_amount_usd;
        initialDepositUsd = earliest.deposit_amount_usd;
        if (initialDepositUsd > 0) {
          pnlPct = (pnlUsd / initialDepositUsd) * 100;
        }
      }

      let openedAt: Date | null = null;
      if (heliusUrl && nftMint) {
        openedAt = await firstDepositTs(wallet, nftMint, heliusUrl);
      }
      if (!openedAt) openedAt = earliest?.snapshot_at ?? null;

      // Underlying tokens
      const underlyingTokens: UnderlyingToken[] = [];
      if (supplyMint) {
        const sym = supplySymbol || classifyToken(supplyMint);
        underlyingTokens.push({
          symbol: sym,
          mint: supplyMint,
          role: "collateral",
          type: classifyToken(sym) === "stable" ? "stablecoin" : classifyToken(sym),
        } as UnderlyingToken);
      }
      if (borrowMint && borrowedValue > 0) {
        const sym = borrowSymbol || classifyToken(borrowMint);
        underlyingTokens.push({
          symbol: sym,
          mint: borrowMint,
          role: "debt",
          type: classifyToken(sym) === "stable" ? "stablecoin" : classifyToken(sym),
        } as UnderlyingToken);
      }

      results.push(
        buildPositionDict({
          wallet_address: wallet,
          protocol_slug: "jupiter",
          product_type: "multiply",
          external_id: externalId,
          snapshot_at: now,
          opportunity_id: entry?.id ?? null,
          deposit_amount: supplyAsset?.data.amount ?? 0,
          deposit_amount_usd: netValue,
          pnl_usd: pnlUsd,
          pnl_pct: pnlPct,
          initial_deposit_usd: initialDepositUsd,
          opened_at: openedAt,
          held_days: computeHeldDays(openedAt, now),
          apy,
          token_symbol: tokenSymbol,
          underlying_tokens: underlyingTokens.length > 0 ? underlyingTokens : null,
          extra_data: {
            vault_id: vaultId,
            nft_id: nftId,
            leverage: Math.round(leverage * 100) / 100,
            ltv: Math.round(ltv * 10000) / 10000,
            health_factor: Math.round(healthFactor * 10000) / 10000,
            total_deposit_usd: Math.round(suppliedValue * 100) / 100,
            total_borrow_usd: Math.round(borrowedValue * 100) / 100,
            supply_token_mint: supplyMint,
            borrow_token_mint: borrowMint,
            nft_mint: nftMint,
            vault_address: vaultAddress,
            tags: pos.tags ?? [],
            source: "portfolio_api",
          },
        }),
      );
    } catch (err) {
      logger.warn({ err, wallet: wallet.slice(0, 8) }, "Jupiter multiply: failed to process position");
    }
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
  const earliestDeposits = await batchEarliestDeposits(database, walletAddress);

  const [earnPositions, multiplyPositions] = await Promise.all([
    fetchEarnPositions(walletAddress, database, now, heliusUrl, oppMap, headers),
    fetchMultiplyPositions(walletAddress, now, oppMap, headers, earliestDeposits, heliusUrl),
  ]);

  const allPositions = [...earnPositions, ...multiplyPositions];

  const totalValue = allPositions.reduce(
    (s, p) => s + (p.deposit_amount_usd ?? 0),
    0,
  );
  const totalPnl = allPositions.reduce(
    (s, p) => s + (p.pnl_usd ?? 0),
    0,
  );

  return {
    wallet: walletAddress,
    positions: allPositions,
    summary: {
      total_value_usd: totalValue,
      total_pnl_usd: totalPnl,
      position_count: allPositions.length,
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
      const earliestDeposits = await batchEarliestDeposits(database, wallet.wallet_address);
      const [earnPositions, multiplyPositions] = await Promise.all([
        fetchEarnPositions(wallet.wallet_address, database, now, heliusUrl, oppMap, headers),
        fetchMultiplyPositions(wallet.wallet_address, now, oppMap, headers, earliestDeposits, heliusUrl),
      ]);
      const allPositions = [...earnPositions, ...multiplyPositions];

      // Detect closed positions: DB says open but not in fresh fetch
      const freshExternalIds = new Set(allPositions.map((p) => p.external_id));
      const dbOpenJupiter = await database
        .select({ id: userPositions.id, external_id: userPositions.external_id, product_type: userPositions.product_type })
        .from(userPositions)
        .where(
          and(
            eq(userPositions.wallet_address, wallet.wallet_address),
            eq(userPositions.protocol_slug, "jupiter"),
            eq(userPositions.is_closed, false),
          ),
        );

      const closedPositions: typeof earnPositions = [];
      for (const dbPos of dbOpenJupiter) {
        if (!freshExternalIds.has(dbPos.external_id)) {
          closedPositions.push(
            buildPositionDict({
              wallet_address: wallet.wallet_address,
              protocol_slug: "jupiter",
              product_type: dbPos.product_type,
              external_id: dbPos.external_id,
              snapshot_at: now,
              deposit_amount: 0,
              deposit_amount_usd: 0,
              is_closed: true,
              closed_at: now,
              close_value_usd: 0,
            }),
          );
        }
      }
      if (closedPositions.length > 0) {
        logger.info(
          { wallet: wallet.wallet_address.slice(0, 8), closed: closedPositions.length },
          "Detected closed Jupiter positions",
        );
      }

      totalSnapshots += await storePositionRows(
        database,
        [...allPositions, ...closedPositions],
        now,
      );

      await database
        .update(trackedWallets)
        .set({ last_fetched_at: now })
        .where(eq(trackedWallets.id, wallet.id));

      logger.info(
        {
          wallet: wallet.wallet_address.slice(0, 8),
          earn: earnPositions.length,
          multiply: multiplyPositions.length,
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
