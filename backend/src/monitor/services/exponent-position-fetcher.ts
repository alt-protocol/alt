/**
 * Fetch Exponent PT token positions for tracked wallets.
 *
 * Uses RPC getTokenAccountsByOwner to check PT mint balances.
 * No SDK dependency — lightweight RPC + our opportunity map.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import { db } from "../db/connection.js";
import { userPositions, trackedWallets } from "../db/schema.js";
import { postJson } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { safeFloat } from "../../shared/utils.js";
import { classifyToken } from "../../shared/constants.js";
import { discoverService } from "../../discover/service.js";
import type { UnderlyingToken } from "../../shared/types.js";
import {
  buildPositionDict,
  computeHeldDays,
  storePositionRows,
  loadOpportunityMap,
  batchEarliestDeposits,
  type PositionDict,
} from "./utils.js";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

// ---------------------------------------------------------------------------
// RPC helpers
// ---------------------------------------------------------------------------

async function getTokenAccountsByMint(
  wallet: string,
  mint: string,
): Promise<{ amount: number; decimals: number } | null> {
  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl) return null;

  try {
    const resp = (await postJson(rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [
        wallet,
        { mint },
        { encoding: "jsonParsed" },
      ],
    })) as Record<string, unknown>;

    const result = resp?.result as Record<string, unknown> | undefined;
    const accounts = (result?.value ?? []) as Record<string, unknown>[];
    if (accounts.length === 0) return null;

    let total = 0;
    let decimals = 6;
    for (const acct of accounts) {
      const data = acct.account as Record<string, unknown>;
      const parsed = (data?.data as Record<string, unknown>)?.parsed as Record<string, unknown>;
      const info = parsed?.info as Record<string, unknown>;
      const tokenAmount = info?.tokenAmount as Record<string, unknown>;
      total += Number(tokenAmount?.uiAmount ?? 0);
      decimals = Number(tokenAmount?.decimals ?? 6);
    }
    return total > 0 ? { amount: total, decimals } : null;
  } catch (err) {
    logger.warn({ err, wallet: wallet.slice(0, 8), mint: mint.slice(0, 8) }, "Exponent RPC getTokenAccountsByMint failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Position fetching
// ---------------------------------------------------------------------------

async function fetchPtPositions(
  wallet: string,
  now: Date,
  oppMap: Record<string, { id: number; apy: number | null; extra: Record<string, unknown> }>,
  earliestDeposits: Record<string, { snapshot_at: Date; deposit_amount_usd: number }>,
): Promise<PositionDict[]> {
  const positions: PositionDict[] = [];

  // Find all exponent PT opportunities and check if wallet holds PT tokens
  for (const [key, opp] of Object.entries(oppMap)) {
    if (!key.startsWith("exponent-pt-")) continue;

    const ptMint = opp.extra?.mint_pt as string | undefined;
    if (!ptMint) continue;

    const balance = await getTokenAccountsByMint(wallet, ptMint);
    if (!balance || balance.amount <= 0) continue;

    const symbol = (opp.extra?.token_symbol as string) ?? "UNKNOWN";
    const ptPrice = safeFloat(opp.extra?.pt_price) ?? 1.0;
    const usdValue = balance.amount * ptPrice;

    const earliest = earliestDeposits[key];
    const openedAt = earliest?.snapshot_at ?? now;
    const heldDays = computeHeldDays(openedAt, now);
    const initialUsd = earliest?.deposit_amount_usd ?? usdValue;
    const pnlUsd = usdValue - initialUsd;

    const mintBase = opp.extra?.mint_base as string | undefined;
    const ct = classifyToken(symbol);
    const tokenType: UnderlyingToken["type"] = ct === "stable" ? "stablecoin" : (ct as UnderlyingToken["type"]);

    positions.push(
      buildPositionDict({
        wallet_address: wallet,
        protocol_slug: "exponent",
        product_type: "earn",
        external_id: key,
        snapshot_at: now,
        opportunity_id: opp.id,
        deposit_amount: balance.amount,
        deposit_amount_usd: usdValue,
        pnl_usd: pnlUsd,
        pnl_pct: initialUsd > 0 ? (pnlUsd / initialUsd) * 100 : null,
        initial_deposit_usd: initialUsd,
        opened_at: openedAt,
        held_days: heldDays,
        apy: safeFloat(opp.apy),
        token_symbol: symbol,
        extra_data: {
          mint_pt: ptMint,
          vault_address: opp.extra?.market_vault,
          type: "exponent_pt",
          pt_price: ptPrice,
          expiration_ts: opp.extra?.expiration_ts ?? null,
          decimals: opp.extra?.decimals ?? null,
        },
        underlying_tokens: [{
          symbol,
          mint: mintBase ?? null,
          role: "underlying",
          type: tokenType,
        }],
      }),
    );
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function snapshotAllWallets(
  database: NodePgDatabase,
  snapshotAt?: Date,
): Promise<number> {
  const wallets = await database
    .select()
    .from(trackedWallets)
    .where(eq(trackedWallets.is_active, true));

  if (wallets.length === 0) return 0;

  logger.info({ count: wallets.length }, "Snapshotting Exponent positions");
  const now = snapshotAt ?? new Date();
  let totalSnapshots = 0;

  // Build opportunity map: external_id → { id, apy, extra }
  const rawOppMap = await loadOpportunityMap(discoverService);
  const oppMap: Record<string, { id: number; apy: number | null; extra: Record<string, unknown> }> = {};
  for (const [key, entry] of Object.entries(rawOppMap)) {
    if (key.startsWith("exponent-")) {
      oppMap[key] = {
        id: entry.id,
        apy: entry.apy_current ?? null,
        extra: (entry.extra_data as Record<string, unknown>) ?? {},
      };
    }
  }

  if (Object.keys(oppMap).length === 0) {
    logger.debug("No Exponent opportunities in DB — skipping position snapshot");
    return 0;
  }

  for (const wallet of wallets) {
    try {
      const earliestDeposits = await batchEarliestDeposits(database, wallet.wallet_address);
      const ptPositions = await fetchPtPositions(
        wallet.wallet_address,
        now,
        oppMap,
        earliestDeposits,
      );

      // Detect closed positions — skip if fresh fetch returned 0 but DB has open
      // positions (likely RPC failure, not mass withdrawal)
      const freshIds = new Set(ptPositions.map((p) => p.external_id));
      const dbOpen = await database
        .select({ id: userPositions.id, external_id: userPositions.external_id })
        .from(userPositions)
        .where(
          and(
            eq(userPositions.wallet_address, wallet.wallet_address),
            eq(userPositions.protocol_slug, "exponent"),
            eq(userPositions.is_closed, false),
          ),
        );

      const closedPositions: PositionDict[] = [];
      if (ptPositions.length === 0 && dbOpen.length > 0) {
        logger.warn(
          { wallet: wallet.wallet_address.slice(0, 8), dbOpen: dbOpen.length },
          "Exponent: 0 fresh positions but DB has open ones — skipping close detection (possible RPC issue)",
        );
      } else {
        for (const row of dbOpen) {
          if (row.external_id && !freshIds.has(row.external_id)) {
            closedPositions.push(
              buildPositionDict({
                wallet_address: wallet.wallet_address,
                protocol_slug: "exponent",
                product_type: "earn",
                external_id: row.external_id,
                snapshot_at: now,
                is_closed: true,
                closed_at: now,
                deposit_amount_usd: 0,
              }),
            );
          }
        }
      }

      const allPositions = [...ptPositions, ...closedPositions];
      const stored = await storePositionRows(database, allPositions, now);
      totalSnapshots += stored;

      logger.info(
        { wallet: wallet.wallet_address.slice(0, 8), count: stored },
        "Exponent wallet snapshotted",
      );
    } catch (err) {
      logger.warn(
        { err, wallet: wallet.wallet_address.slice(0, 8) },
        "Exponent position fetch failed for wallet",
      );
    }
  }

  logger.info({ totalSnapshots }, "Exponent position snapshot complete");
  return totalSnapshots;
}

// ---------------------------------------------------------------------------
// Public API — on-demand fetch for a single wallet (used by portfolio routes)
// ---------------------------------------------------------------------------

export async function fetchWalletPositions(
  walletAddress: string,
): Promise<{
  wallet: string;
  positions: PositionDict[];
  summary: { total_value_usd: number; total_pnl_usd: number; position_count: number };
}> {
  const now = new Date();

  const rawOppMap = await loadOpportunityMap(discoverService);
  const oppMap: Record<string, { id: number; apy: number | null; extra: Record<string, unknown> }> = {};
  for (const [key, entry] of Object.entries(rawOppMap)) {
    if (key.startsWith("exponent-")) {
      oppMap[key] = {
        id: entry.id,
        apy: entry.apy_current ?? null,
        extra: (entry.extra_data as Record<string, unknown>) ?? {},
      };
    }
  }

  const empty = { wallet: walletAddress, positions: [] as PositionDict[], summary: { total_value_usd: 0, total_pnl_usd: 0, position_count: 0 } };
  if (Object.keys(oppMap).length === 0) return empty;

  const earliestDeposits = await batchEarliestDeposits(db, walletAddress);
  const positions = await fetchPtPositions(walletAddress, now, oppMap, earliestDeposits);

  const summary = {
    total_value_usd: positions.reduce((s, p) => s + (Number(p.deposit_amount_usd) || 0), 0),
    total_pnl_usd: positions.reduce((s, p) => s + (Number(p.pnl_usd) || 0), 0),
    position_count: positions.length,
  };

  return { wallet: walletAddress, positions, summary };
}
