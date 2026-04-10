/**
 * MonitorService — public interface for cross-module reads.
 */
import { eq, and, gte, asc, desc, sql } from "drizzle-orm";
import { db } from "./db/connection.js";
import { trackedWallets, userPositions, userPositionEvents } from "./db/schema.js";
import { yieldOpportunities } from "../discover/db/schema.js";
import { discoverService } from "../discover/service.js";
import { numOrNull } from "../shared/utils.js";
import { logger } from "../shared/logger.js";
import { postJson } from "../shared/http.js";
import { getSymbolForMint, isStablecoinMint } from "../shared/constants.js";

export const monitorService = {
  async getWalletStatus(walletAddress: string) {
    const rows = await db
      .select()
      .from(trackedWallets)
      .where(eq(trackedWallets.wallet_address, walletAddress))
      .limit(1);
    if (rows.length === 0) return null;
    return {
      wallet_address: rows[0].wallet_address,
      fetch_status: rows[0].fetch_status,
      last_fetched_at: rows[0].last_fetched_at,
      is_active: rows[0].is_active,
    };
  },

  async getPortfolioPositions(
    walletAddress: string,
    protocol?: string,
    productType?: string,
  ) {
    try {
      const latestSub = db
        .select({
          protocol_slug: userPositions.protocol_slug,
          latest_at: sql<Date>`MAX(${userPositions.snapshot_at})`.as("latest_at"),
        })
        .from(userPositions)
        .where(eq(userPositions.wallet_address, walletAddress))
        .groupBy(userPositions.protocol_slug)
        .as("latest_sub");

      let query = db
        .select({
          pos: userPositions,
          live_apy: yieldOpportunities.apy_current,
          opp_lock_period: yieldOpportunities.lock_period_days,
        })
        .from(userPositions)
        .innerJoin(
          latestSub,
          and(
            eq(userPositions.protocol_slug, latestSub.protocol_slug),
            eq(userPositions.snapshot_at, latestSub.latest_at),
            eq(userPositions.wallet_address, walletAddress),
          ),
        )
        .leftJoin(
          yieldOpportunities,
          eq(userPositions.opportunity_id, yieldOpportunities.id),
        );

      const allConditions = [
        eq(userPositions.is_closed, false),
      ];
      if (protocol)
        allConditions.push(eq(userPositions.protocol_slug, protocol));
      if (productType)
        allConditions.push(eq(userPositions.product_type, productType));
      if (allConditions.length > 0) {
        query = query.where(and(...allConditions)) as typeof query;
      }

      const result = await query;

      // Enrich positions missing opportunity_id (stale rows from before link was established)
      const needsEnrichment = result.some((r) => r.pos.opportunity_id == null);
      if (needsEnrichment) {
        const oppMap = await discoverService.getOpportunityMap();
        for (const r of result) {
          if (r.pos.opportunity_id != null) continue;
          const entry = oppMap[r.pos.external_id] ?? null;
          if (entry) (r.pos as any).opportunity_id = entry.id;
        }
      }

      const positions = result.map((r) => {
        const p = {
          ...r.pos,
          apy: r.live_apy ?? r.pos.apy,
          lock_period_days: r.opp_lock_period ?? 0,
        };
        return {
          id: p.id,
          wallet_address: p.wallet_address,
          protocol_slug: p.protocol_slug,
          product_type: p.product_type,
          external_id: p.external_id,
          opportunity_id: p.opportunity_id,
          deposit_amount: numOrNull(p.deposit_amount),
          deposit_amount_usd: numOrNull(p.deposit_amount_usd),
          pnl_usd: numOrNull(p.pnl_usd),
          pnl_pct: numOrNull(p.pnl_pct),
          initial_deposit_usd: numOrNull(p.initial_deposit_usd),
          opened_at: p.opened_at,
          held_days: numOrNull(p.held_days),
          apy: numOrNull(p.apy),
          apy_realized: numOrNull(p.apy_realized),
          is_closed: p.is_closed,
          closed_at: p.closed_at,
          close_value_usd: numOrNull(p.close_value_usd),
          token_symbol: p.token_symbol,
          underlying_tokens: p.underlying_tokens ?? null,
          lock_period_days: p.lock_period_days ?? 0,
          extra_data: p.extra_data,
          snapshot_at: p.snapshot_at,
        };
      });

      const totalValue = positions.reduce(
        (s, p) => s + (p.deposit_amount_usd ?? 0),
        0,
      );
      const totalPnl = positions.reduce(
        (s, p) => s + (p.pnl_usd ?? 0),
        0,
      );

      return {
        wallet: walletAddress,
        positions,
        summary: {
          total_value_usd: totalValue,
          total_pnl_usd: totalPnl,
          position_count: positions.length,
        },
      };
    } catch (err) {
      logger.error({ err, wallet: walletAddress.slice(0, 8) }, "getPortfolioPositions failed");
      throw err;
    }
  },

  async getPositionHistory(
    walletAddress: string,
    period: "7d" | "30d" | "90d" = "7d",
    externalId?: string,
  ) {
    const days = { "7d": 7, "30d": 30, "90d": 90 }[period] ?? 7;
    const cutoff = new Date(Date.now() - days * 86_400_000);

    if (externalId) {
      const rows = await db
        .select()
        .from(userPositions)
        .where(
          and(
            eq(userPositions.wallet_address, walletAddress),
            gte(userPositions.snapshot_at, cutoff),
            eq(userPositions.external_id, externalId),
          ),
        )
        .orderBy(asc(userPositions.snapshot_at))
        .limit(500);

      return {
        data: rows.map((r) => ({
          snapshot_at: r.snapshot_at,
          deposit_amount_usd: numOrNull(r.deposit_amount_usd),
          pnl_usd: numOrNull(r.pnl_usd),
          pnl_pct: numOrNull(r.pnl_pct),
        })),
      };
    }

    const bucketInterval = { "7d": "4 hours", "30d": "8 hours", "90d": "12 hours" }[period] ?? "4 hours";

    const rows = await db.execute(sql`
      WITH per_snapshot AS (
        SELECT snapshot_at, SUM(deposit_amount_usd::numeric) as total_usd, SUM(pnl_usd::numeric) as total_pnl
        FROM monitor.user_positions
        WHERE wallet_address = ${walletAddress} AND snapshot_at >= ${cutoff}
        GROUP BY snapshot_at
      ),
      bucketed AS (
        SELECT date_bin(${sql.raw(`'${bucketInterval}'`)}, snapshot_at, ${cutoff}::timestamp) as bucket,
               total_usd, total_pnl, snapshot_at
        FROM per_snapshot
      )
      SELECT DISTINCT ON (bucket) bucket, total_usd as deposit_amount_usd, total_pnl as pnl_usd
      FROM bucketed ORDER BY bucket, snapshot_at DESC
    `);

    return {
      data: (rows.rows as Record<string, unknown>[]).map((r) => ({
        snapshot_at: r.bucket as Date,
        deposit_amount_usd: r.deposit_amount_usd ? Number(r.deposit_amount_usd) : 0,
        pnl_usd: r.pnl_usd ? Number(r.pnl_usd) : 0,
      })),
    };
  },

  async getPositionEvents(
    walletAddress: string,
    protocol?: string,
    productType?: string,
    limit = 50,
  ) {
    const conditions = [eq(userPositionEvents.wallet_address, walletAddress)];
    if (protocol) conditions.push(eq(userPositionEvents.protocol_slug, protocol));
    if (productType) conditions.push(eq(userPositionEvents.product_type, productType));

    const rows = await db
      .select()
      .from(userPositionEvents)
      .where(and(...conditions))
      .orderBy(desc(userPositionEvents.event_at))
      .limit(limit);

    return {
      data: rows.map((r) => ({
        id: r.id,
        protocol_slug: r.protocol_slug,
        product_type: r.product_type,
        external_id: r.external_id,
        event_type: r.event_type,
        amount: numOrNull(r.amount),
        amount_usd: numOrNull(r.amount_usd),
        tx_signature: r.tx_signature,
        event_at: r.event_at,
      })),
    };
  },

  async getWalletBalances(walletAddress: string) {
    const heliusApiKey = process.env.HELIUS_API_KEY;
    if (!heliusApiKey) throw new Error("Helius API key not configured");

    const url = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
    const programIds = [
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    ];

    let allAccounts: Record<string, unknown>[] = [];
    const results = await Promise.all(
      programIds.map((programId) =>
        postJson(url, {
          jsonrpc: "2.0",
          id: 1,
          method: "getTokenAccountsByOwner",
          params: [walletAddress, { programId }, { encoding: "jsonParsed" }],
        }) as Promise<Record<string, unknown>>,
      ),
    );

    for (const data of results) {
      const accounts = ((data.result as Record<string, unknown>)?.value as Record<string, unknown>[]) ?? [];
      allAccounts = allAccounts.concat(accounts);
    }

    const positions = [];
    for (const account of allAccounts) {
      const info = (((account.account as Record<string, unknown>)?.data as Record<string, unknown>)?.parsed as Record<string, unknown>)?.info as Record<string, unknown> | undefined;
      if (!info) continue;
      const mint = (info.mint as string) ?? "";
      const tokenAmount = (info.tokenAmount as Record<string, unknown>) ?? {};
      const uiAmount = Number(tokenAmount.uiAmount ?? 0);
      if (uiAmount > 0) {
        positions.push({
          mint,
          symbol: getSymbolForMint(mint),
          ui_amount: uiAmount,
          decimals: Number(tokenAmount.decimals ?? 0),
          is_stablecoin: isStablecoinMint(mint),
        });
      }
    }

    const totalStablecoinUsd = positions
      .filter((p) => p.is_stablecoin)
      .reduce((sum, p) => sum + p.ui_amount, 0);

    return { wallet: walletAddress, positions, total_stablecoin_usd: totalStablecoinUsd };
  },

  async trackWallet(walletAddress: string) {
    const existing = await db
      .select({ id: trackedWallets.id })
      .from(trackedWallets)
      .where(eq(trackedWallets.wallet_address, walletAddress))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(trackedWallets)
        .set({ is_active: true })
        .where(eq(trackedWallets.wallet_address, walletAddress));
    } else {
      await db
        .insert(trackedWallets)
        .values({ wallet_address: walletAddress });
    }
  },
};
