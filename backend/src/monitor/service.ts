/**
 * MonitorService — public interface for cross-module reads.
 */
import { eq, and, gte, asc, desc, sql } from "drizzle-orm";
import { db } from "./db/connection.js";
import { trackedWallets, userPositions, userPositionEvents } from "./db/schema.js";
import { yieldOpportunities } from "../discover/db/schema.js";
import { discoverService } from "../discover/service.js";
import { manageService } from "../manage/service.js";
import { numOrNull } from "../shared/utils.js";
import { logger } from "../shared/logger.js";
import { postJson } from "../shared/http.js";
import { getSymbolForMint, isStablecoinMint, STABLECOIN_SYMBOLS } from "../shared/constants.js";
import { buildPositionDict, storePositionRows } from "./services/utils.js";

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
    assetClass?: string,
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

      // Filter by asset_class when requested (e.g., "stablecoin" hides volatile positions)
      const filtered = assetClass
        ? positions.filter((p) => {
            const tokens = p.underlying_tokens as { type?: string }[] | null;
            if (!tokens || tokens.length === 0) return true;
            return tokens.some((t) =>
              t.type === "stablecoin" || t.type === "yield_bearing_stable",
            );
          })
        : positions;

      const totalValue = filtered.reduce(
        (s, p) => s + (p.deposit_amount_usd ?? 0),
        0,
      );
      const totalPnl = filtered.reduce(
        (s, p) => s + (p.pnl_usd ?? 0),
        0,
      );

      return {
        wallet: walletAddress,
        positions: filtered,
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

  /**
   * Sync a single position after a transaction.
   * Fetches balance via the Manage adapter (1 RPC call), then copies the
   * latest protocol snapshot with the updated position.
   */
  async syncPosition(
    walletAddress: string,
    opportunityId: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const opp = await discoverService.getOpportunityById(opportunityId);
    if (!opp || !opp.protocol?.slug || !opp.deposit_address) {
      logger.warn({ opportunityId }, "syncPosition: opportunity not found");
      return;
    }

    const balance = await manageService.getBalance(opportunityId, walletAddress, metadata);
    const now = new Date();
    const protocolSlug = opp.protocol.slug;

    // Get the latest snapshot for this protocol
    const latestSnap = await db.execute(sql`
      SELECT MAX(snapshot_at) as latest_at
      FROM monitor.user_positions
      WHERE wallet_address = ${walletAddress}
        AND protocol_slug = ${protocolSlug}
    `);
    const rawLatest = latestSnap.rows[0]?.latest_at;
    const latestAt = rawLatest ? new Date(rawLatest as string) : null;

    // Load existing positions from the latest snapshot (if any)
    let existingRows: typeof userPositions.$inferSelect[] = [];
    if (latestAt) {
      existingRows = await db
        .select()
        .from(userPositions)
        .where(
          and(
            eq(userPositions.wallet_address, walletAddress),
            eq(userPositions.protocol_slug, protocolSlug),
            eq(userPositions.snapshot_at, latestAt),
          ),
        );
    }

    // For stablecoins, 1:1 USD. TODO: fetch real price from opportunity
    // extra_data or a price oracle when non-stablecoin products are added.
    const tokenPrice = 1;
    const depositUsd = balance != null ? balance * tokenPrice : null;

    // Build new snapshot: copy existing positions, update the changed one
    const externalId = opp.deposit_address;
    let found = false;

    const newPositions = existingRows.map((row) => {
      const isTarget =
        row.opportunity_id === opportunityId ||
        row.external_id === externalId;

      if (isTarget) {
        found = true;
        return buildPositionDict({
          wallet_address: row.wallet_address,
          protocol_slug: row.protocol_slug,
          product_type: row.product_type,
          external_id: row.external_id,
          snapshot_at: now,
          opportunity_id: row.opportunity_id,
          deposit_amount: balance,
          deposit_amount_usd: depositUsd,
          pnl_usd: numOrNull(row.pnl_usd),
          pnl_pct: numOrNull(row.pnl_pct),
          initial_deposit_usd: numOrNull(row.initial_deposit_usd),
          opened_at: row.opened_at,
          held_days: numOrNull(row.held_days),
          apy: numOrNull(row.apy),
          is_closed: balance === 0 || balance === null,
          token_symbol: row.token_symbol,
          extra_data: { ...(row.extra_data as Record<string, unknown>) ?? {}, ...metadata },
          underlying_tokens: row.underlying_tokens as any,
        });
      }

      // Copy unchanged position to new snapshot
      return buildPositionDict({
        wallet_address: row.wallet_address,
        protocol_slug: row.protocol_slug,
        product_type: row.product_type,
        external_id: row.external_id,
        snapshot_at: now,
        opportunity_id: row.opportunity_id,
        deposit_amount: numOrNull(row.deposit_amount),
        deposit_amount_usd: numOrNull(row.deposit_amount_usd),
        pnl_usd: numOrNull(row.pnl_usd),
        pnl_pct: numOrNull(row.pnl_pct),
        initial_deposit_usd: numOrNull(row.initial_deposit_usd),
        opened_at: row.opened_at,
        held_days: numOrNull(row.held_days),
        apy: numOrNull(row.apy),
        is_closed: row.is_closed ?? false,
        token_symbol: row.token_symbol,
        extra_data: (row.extra_data as Record<string, unknown>) ?? {},
        underlying_tokens: row.underlying_tokens as any,
      });
    });

    // If position is new (not in latest snapshot), add it
    if (!found && balance != null && balance > 0) {
      newPositions.push(
        buildPositionDict({
          wallet_address: walletAddress,
          protocol_slug: protocolSlug,
          product_type: opp.category,
          external_id: externalId,
          snapshot_at: now,
          opportunity_id: opportunityId,
          deposit_amount: balance,
          deposit_amount_usd: depositUsd,
          apy: opp.apy_current,
          token_symbol: opp.tokens?.[0] ?? null,
          extra_data: metadata,
        }),
      );
    }

    if (newPositions.length > 0) {
      await storePositionRows(db as any, newPositions, now);
    }

    // Mark wallet status as ready so frontend stops polling
    await db
      .update(trackedWallets)
      .set({ fetch_status: "ready", last_fetched_at: now })
      .where(eq(trackedWallets.wallet_address, walletAddress));

    logger.info(
      { wallet: walletAddress.slice(0, 8), opportunityId, balance },
      "syncPosition complete",
    );
  },

  async getPortfolioAnalytics(walletAddress: string) {
    const [portfolio, balances] = await Promise.all([
      this.getPortfolioPositions(walletAddress),
      this.getWalletBalances(walletAddress),
    ]);

    const positions = portfolio.positions;

    // ---- Summary ----
    const totalValue = positions.reduce((s, p) => s + (p.deposit_amount_usd ?? 0), 0);
    const totalPnlUsd = positions.reduce((s, p) => s + (p.pnl_usd ?? 0), 0);
    const totalInitialDeposit = positions.reduce((s, p) => s + (p.initial_deposit_usd ?? 0), 0);
    const roiPct = totalInitialDeposit > 0 ? (totalPnlUsd / totalInitialDeposit) * 100 : 0;
    const weightedApy = totalValue > 0
      ? positions.reduce((s, p) => s + (p.apy ?? 0) * (p.deposit_amount_usd ?? 0), 0) / totalValue
      : 0;
    const weightedApyRealized = totalValue > 0
      ? positions.reduce((s, p) => s + (p.apy_realized ?? 0) * (p.deposit_amount_usd ?? 0), 0) / totalValue
      : 0;
    const projectedYieldYearly = positions.reduce(
      (s, p) => s + (p.deposit_amount_usd ?? 0) * ((p.apy ?? 0) / 100), 0,
    );

    // ---- Stablecoin allocation ----
    const idleBalances = (balances.positions ?? [])
      .filter((p) => p.is_stablecoin && p.ui_amount > 0)
      .sort((a, b) => b.ui_amount - a.ui_amount);

    const idle = idleBalances.reduce((s, p) => s + p.ui_amount, 0);

    const stablePositions = positions.filter(
      (p) => p.token_symbol && STABLECOIN_SYMBOLS.has(p.token_symbol),
    );
    const allocated = stablePositions.reduce((s, p) => s + (p.deposit_amount_usd ?? 0), 0);
    const stableTotal = idle + allocated;
    const allocationPct = stableTotal > 0 ? (allocated / stableTotal) * 100 : 0;
    const apyAllocated = allocated > 0
      ? stablePositions.reduce((s, p) => s + (p.apy ?? 0) * (p.deposit_amount_usd ?? 0), 0) / allocated
      : 0;
    const apyTotal = stableTotal > 0 ? (apyAllocated * allocated) / stableTotal : 0;

    // ---- Diversification ----
    const buildDistribution = (
      keyFn: (p: (typeof positions)[0]) => string,
      maxItems?: number,
    ) => {
      const groups: Record<string, number> = {};
      for (const p of positions) {
        const key = keyFn(p);
        groups[key] = (groups[key] ?? 0) + (p.deposit_amount_usd ?? 0);
      }
      let items = Object.entries(groups)
        .map(([label, value_usd]) => ({
          label,
          value_usd,
          pct: totalValue > 0 ? (value_usd / totalValue) * 100 : 0,
        }))
        .sort((a, b) => b.value_usd - a.value_usd);

      if (maxItems && items.length > maxItems) {
        const top = items.slice(0, maxItems);
        const rest = items.slice(maxItems);
        const otherValue = rest.reduce((s, i) => s + i.value_usd, 0);
        top.push({
          label: "Other",
          value_usd: otherValue,
          pct: totalValue > 0 ? (otherValue / totalValue) * 100 : 0,
        });
        items = top;
      }
      return items;
    };

    const PRODUCT_TYPE_LABELS: Record<string, string> = {
      earn_vault: "Earn Vault",
      earn: "Earn",
      lending: "Lend",
      multiply: "Multiply",
      lp: "LP",
      insurance: "Insurance",
      insurance_fund: "Insurance Fund",
    };

    const byProtocol = buildDistribution(
      (p) => p.protocol_slug.charAt(0).toUpperCase() + p.protocol_slug.slice(1),
    );
    const byCategory = buildDistribution(
      (p) => PRODUCT_TYPE_LABELS[p.product_type] ?? p.product_type,
    );
    const byToken = buildDistribution(
      (p) => p.token_symbol ?? "Unknown",
      5,
    );

    return {
      summary: {
        total_value_usd: totalValue,
        total_pnl_usd: totalPnlUsd,
        total_initial_deposit_usd: totalInitialDeposit,
        roi_pct: roiPct,
        weighted_apy: weightedApy,
        weighted_apy_realized: weightedApyRealized,
        projected_yield_yearly_usd: projectedYieldYearly,
        position_count: positions.length,
      },
      stablecoin: {
        total_usd: stableTotal,
        idle_usd: idle,
        allocated_usd: allocated,
        allocation_pct: allocationPct,
        apy_total: apyTotal,
        apy_allocated: apyAllocated,
        idle_balances: idleBalances.map((b) => ({
          mint: b.mint,
          symbol: b.symbol,
          ui_amount: b.ui_amount,
        })),
      },
      diversification: {
        by_protocol: byProtocol,
        by_category: byCategory,
        by_token: byToken,
      },
    };
  },
};
