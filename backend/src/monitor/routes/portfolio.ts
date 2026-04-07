/**
 * Portfolio routes — port of backend/app/routers/portfolio.py
 */
import type { FastifyInstance } from "fastify";
import { sql, eq, and, gte, desc, asc } from "drizzle-orm";
import { db } from "../db/connection.js";
import { trackedWallets, userPositions, userPositionEvents } from "../db/schema.js";
import { NotFoundError } from "../../shared/error-handler.js";
import { postJson } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { getSymbolForMint, isStablecoinMint } from "../../shared/constants.js";
import { validateWallet, storePositionRows, storeEventsBatch } from "../services/utils.js";
import { fetchWalletPositions as fetchKaminoPositions } from "../services/kamino-position-fetcher.js";
import { fetchWalletPositions as fetchDriftPositions } from "../services/drift-position-fetcher.js";
import { fetchWalletPositions as fetchJupiterPositions } from "../services/jupiter-position-fetcher.js";
import { discoverService } from "../../discover/service.js";
import {
  PositionsQuery,
  PositionHistoryQuery,
  EventsQuery,
} from "./schemas.js";

function numOrNull(val: string | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function formatPosition(p: typeof userPositions.$inferSelect) {
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
    extra_data: p.extra_data,
    snapshot_at: p.snapshot_at,
  };
}

// ---------------------------------------------------------------------------
// Latest positions helper (subquery: max snapshot_at per protocol)
// ---------------------------------------------------------------------------

async function latestPositions(
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
      .select({ pos: userPositions })
      .from(userPositions)
      .innerJoin(
        latestSub,
        and(
          eq(userPositions.protocol_slug, latestSub.protocol_slug),
          eq(userPositions.snapshot_at, latestSub.latest_at),
          eq(userPositions.wallet_address, walletAddress),
        ),
      );

    const allConditions = [];
    if (protocol)
      allConditions.push(eq(userPositions.protocol_slug, protocol));
    if (productType)
      allConditions.push(eq(userPositions.product_type, productType));
    if (allConditions.length > 0) {
      query = query.where(and(...allConditions)) as typeof query;
    }

    const result = await query;
    return result.map((r) => r.pos);
  } catch (err) {
    logger.error({ err, wallet: walletAddress.slice(0, 8) }, "latestPositions query failed");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Background fetch (fire-and-forget)
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 5 * 60 * 1000; // 5 min — defense against hung protocol APIs
const inFlightWallets = new Set<string>();

async function backgroundFetchAndStore(walletAddress: string) {
  if (inFlightWallets.has(walletAddress)) {
    logger.debug({ wallet: walletAddress.slice(0, 8) }, "Background fetch already in flight — skipping");
    return;
  }
  inFlightWallets.add(walletAddress);
  try {
    // Mark as fetching
    await db
      .update(trackedWallets)
      .set({ fetch_status: "fetching" })
      .where(eq(trackedWallets.wallet_address, walletAddress));

    const now = new Date();

    // Fetch all 3 protocols in parallel, with a hard timeout
    const [kaminoResult, driftResult, jupiterResult] =
      await Promise.race([
        Promise.allSettled([
          fetchKaminoPositions(walletAddress),
          fetchDriftPositions(walletAddress),
          fetchJupiterPositions(walletAddress, db),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Background fetch timeout (5min)")), FETCH_TIMEOUT_MS),
        ),
      ]);

    const allPositions = [
      ...(kaminoResult.status === "fulfilled"
        ? kaminoResult.value.positions
        : []),
      ...(driftResult.status === "fulfilled"
        ? driftResult.value.positions
        : []),
      ...(jupiterResult.status === "fulfilled"
        ? jupiterResult.value.positions
        : []),
    ];

    // Also collect events from Drift IF
    const driftEvents =
      driftResult.status === "fulfilled"
        ? driftResult.value.events
        : [];

    if (allPositions.length === 0) {
      logger.warn(
        { wallet: walletAddress.slice(0, 8) },
        "All fetches failed — keeping old snapshot",
      );
      await db
        .update(trackedWallets)
        .set({ fetch_status: "ready" })
        .where(eq(trackedWallets.wallet_address, walletAddress));
      return;
    }

    await storePositionRows(db, allPositions, now);
    if (driftEvents.length > 0) {
      await storeEventsBatch(db, driftEvents);
    }

    await db
      .update(trackedWallets)
      .set({ last_fetched_at: now, fetch_status: "ready" })
      .where(eq(trackedWallets.wallet_address, walletAddress));

    logger.info(
      { wallet: walletAddress.slice(0, 8), count: allPositions.length },
      "Background fetch complete",
    );
  } catch (err) {
    logger.error(
      { err, wallet: walletAddress.slice(0, 8) },
      "Background fetch failed",
    );
    try {
      await db
        .update(trackedWallets)
        .set({ fetch_status: "error" })
        .where(eq(trackedWallets.wallet_address, walletAddress));
    } catch {
      // ignore
    }
  } finally {
    inFlightWallets.delete(walletAddress);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export async function portfolioRoutes(app: FastifyInstance) {
  // -----------------------------------------------------------------------
  // GET /portfolio/:wallet — SPL token balances
  // -----------------------------------------------------------------------
  app.get<{ Params: { wallet: string } }>("/portfolio/:wallet", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    handler: async (request) => {
      const { wallet } = request.params;
      validateWallet(wallet);

      const heliusApiKey = process.env.HELIUS_API_KEY;
      if (!heliusApiKey) {
        const err = new Error("Helius API key not configured") as Error & { statusCode: number };
        err.statusCode = 503;
        throw err;
      }

      const url = `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;

      // Fetch from both Token Program and Token-2022 in parallel
      const programIds = [
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",   // Token Program
        "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",   // Token-2022
      ];

      let allAccounts: Record<string, unknown>[] = [];
      try {
        const results = await Promise.all(
          programIds.map((programId) =>
            postJson(url, {
              jsonrpc: "2.0",
              id: 1,
              method: "getTokenAccountsByOwner",
              params: [wallet, { programId }, { encoding: "jsonParsed" }],
            }) as Promise<Record<string, unknown>>
          ),
        );

        for (const data of results) {
          if (data.error) {
            const e = new Error(
              ((data.error as Record<string, unknown>).message as string) ?? "RPC error",
            ) as Error & { statusCode: number };
            e.statusCode = 502;
            throw e;
          }
          const accounts =
            ((data.result as Record<string, unknown>)?.value as Record<string, unknown>[]) ?? [];
          allAccounts = allAccounts.concat(accounts);
        }
      } catch (err) {
        if ((err as Error & { statusCode?: number }).statusCode) throw err;
        const e = new Error(`Helius RPC error`) as Error & { statusCode: number };
        e.statusCode = 502;
        throw e;
      }

      const positions = [];
      for (const account of allAccounts) {
        const info =
          (
            (
              (account.account as Record<string, unknown>)
                ?.data as Record<string, unknown>
            )?.parsed as Record<string, unknown>
          )?.info as Record<string, unknown> | undefined;
        if (!info) continue;

        const mint = (info.mint as string) ?? "";
        const tokenAmount =
          (info.tokenAmount as Record<string, unknown>) ?? {};
        const amount = (tokenAmount.amount as string) ?? "0";
        const decimals = Number(tokenAmount.decimals ?? 0);
        const uiAmount = Number(tokenAmount.uiAmount ?? 0);

        if (uiAmount > 0) {
          positions.push({
            mint,
            symbol: getSymbolForMint(mint),
            amount: Number(amount),
            decimals,
            ui_amount: uiAmount,
            is_stablecoin: isStablecoinMint(mint),
          });
        }
      }

      const totalStablecoinUsd = positions
        .filter((p) => p.is_stablecoin)
        .reduce((sum, p) => sum + p.ui_amount, 0);

      return { wallet, positions, total_value_usd: totalStablecoinUsd };
    },
  });

  // -----------------------------------------------------------------------
  // POST /portfolio/:wallet/track — register wallet, background fetch
  // -----------------------------------------------------------------------
  app.post<{ Params: { wallet: string } }>("/portfolio/:wallet/track", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
    handler: async (request) => {
      const { wallet } = request.params;
      validateWallet(wallet);

      // Upsert TrackedWallet
      const existing = await db
        .select()
        .from(trackedWallets)
        .where(eq(trackedWallets.wallet_address, wallet))
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(trackedWallets)
          .set({ is_active: true })
          .where(eq(trackedWallets.wallet_address, wallet));
      } else {
        await db
          .insert(trackedWallets)
          .values({ wallet_address: wallet });
      }

      // Check for cached positions
      const hasPositions = await db
        .select({ id: userPositions.id })
        .from(userPositions)
        .where(eq(userPositions.wallet_address, wallet))
        .limit(1);

      if (hasPositions.length > 0) {
        const positions = await latestPositions(wallet);
        const positionDicts = positions.map(formatPosition);
        const totalValue = positions.reduce(
          (s, p) => s + (numOrNull(p.deposit_amount_usd) ?? 0),
          0,
        );
        const totalPnl = positions.reduce(
          (s, p) => s + (numOrNull(p.pnl_usd) ?? 0),
          0,
        );

        // Update status and kick off background refresh
        await db
          .update(trackedWallets)
          .set({ fetch_status: "fetching" })
          .where(eq(trackedWallets.wallet_address, wallet));

        // Fire-and-forget background fetch
        void backgroundFetchAndStore(wallet);

        return {
          wallet,
          positions: positionDicts,
          summary: {
            total_value_usd: totalValue,
            total_pnl_usd: totalPnl,
            position_count: positionDicts.length,
          },
          fetch_status: "fetching",
        };
      }

      // No prior data — start background fetch
      await db
        .update(trackedWallets)
        .set({ fetch_status: "fetching" })
        .where(eq(trackedWallets.wallet_address, wallet));

      void backgroundFetchAndStore(wallet);

      return {
        wallet,
        positions: [],
        summary: {
          total_value_usd: 0,
          total_pnl_usd: 0,
          position_count: 0,
        },
        fetch_status: "fetching",
      };
    },
  });

  // -----------------------------------------------------------------------
  // GET /portfolio/:wallet/status
  // -----------------------------------------------------------------------
  app.get<{ Params: { wallet: string } }>("/portfolio/:wallet/status", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (request) => {
      const { wallet } = request.params;
      validateWallet(wallet);

      const rows = await db
        .select()
        .from(trackedWallets)
        .where(eq(trackedWallets.wallet_address, wallet))
        .limit(1);

      if (rows.length === 0) throw new NotFoundError("Wallet not tracked");

      return {
        wallet_address: rows[0].wallet_address,
        fetch_status: rows[0].fetch_status,
        last_fetched_at: rows[0].last_fetched_at,
      };
    },
  });

  // -----------------------------------------------------------------------
  // GET /portfolio/:wallet/positions
  // -----------------------------------------------------------------------
  app.get<{ Params: { wallet: string } }>("/portfolio/:wallet/positions", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (request) => {
      const { wallet } = request.params;
      validateWallet(wallet);
      const q = PositionsQuery.parse(request.query);

      try {
        const positions = await latestPositions(
          wallet,
          q.protocol,
          q.product_type,
        );

        // Enrich positions missing opportunity_id (stale rows from before link was established)
        const needsEnrichment = positions.some((p) => p.opportunity_id == null);
        if (needsEnrichment) {
          const oppMap = await discoverService.getOpportunityMap();
          for (const p of positions) {
            if (p.opportunity_id != null) continue;
            const entry = oppMap[p.external_id] ?? null;
            if (entry) (p as any).opportunity_id = entry.id;
          }
        }

        return positions.map(formatPosition);
      } catch (err) {
        logger.error({ err, wallet: wallet.slice(0, 8) }, "Positions query failed");
        throw err;
      }
    },
  });

  // -----------------------------------------------------------------------
  // GET /portfolio/:wallet/positions/history
  // -----------------------------------------------------------------------
  app.get<{ Params: { wallet: string } }>(
    "/portfolio/:wallet/positions/history",
    {
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      handler: async (request) => {
        const { wallet } = request.params;
        validateWallet(wallet);
        const q = PositionHistoryQuery.parse(request.query);

        try {
          const days = { "7d": 7, "30d": 30, "90d": 90 }[q.period] ?? 7;
          const cutoff = new Date(Date.now() - days * 86_400_000);

          // Per-position history
          if (q.external_id) {
            const rows = await db
              .select()
              .from(userPositions)
              .where(
                and(
                  eq(userPositions.wallet_address, wallet),
                  gte(userPositions.snapshot_at, cutoff),
                  eq(userPositions.external_id, q.external_id),
                ),
              )
              .orderBy(asc(userPositions.snapshot_at))
              .offset(q.offset)
              .limit(q.limit);

            return rows.map((r) => ({
              snapshot_at: r.snapshot_at,
              deposit_amount_usd: numOrNull(r.deposit_amount_usd),
              pnl_usd: numOrNull(r.pnl_usd),
              pnl_pct: numOrNull(r.pnl_pct),
            }));
          }

          // Aggregate history with time bucketing
          const bucketInterval = {
            "7d": "4 hours",
            "30d": "8 hours",
            "90d": "12 hours",
          }[q.period] ?? "4 hours";

          const rows = await db.execute(sql`
            WITH per_snapshot AS (
              SELECT
                snapshot_at,
                SUM(deposit_amount_usd::numeric) as total_usd,
                SUM(pnl_usd::numeric) as total_pnl
              FROM monitor.user_positions
              WHERE wallet_address = ${wallet}
                AND snapshot_at >= ${cutoff}
              GROUP BY snapshot_at
            ),
            bucketed AS (
              SELECT
                date_bin(${sql.raw(`'${bucketInterval}'`)}, snapshot_at, ${cutoff}::timestamp) as bucket,
                total_usd,
                total_pnl,
                snapshot_at
              FROM per_snapshot
            )
            SELECT DISTINCT ON (bucket)
              bucket,
              total_usd as deposit_amount_usd,
              total_pnl as pnl_usd
            FROM bucketed
            ORDER BY bucket, snapshot_at DESC
          `);

          return rows.rows.map((r: Record<string, unknown>) => ({
            snapshot_at: r.bucket as Date,
            deposit_amount_usd: r.deposit_amount_usd
              ? Number(r.deposit_amount_usd)
              : 0,
            pnl_usd: r.pnl_usd ? Number(r.pnl_usd) : 0,
            pnl_pct: null,
          }));
        } catch (err) {
          logger.error({ err, wallet: wallet.slice(0, 8) }, "Position history query failed");
          throw err;
        }
      },
    },
  );

  // -----------------------------------------------------------------------
  // GET /portfolio/:wallet/events
  // -----------------------------------------------------------------------
  app.get<{ Params: { wallet: string } }>("/portfolio/:wallet/events", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async (request) => {
      const { wallet } = request.params;
      validateWallet(wallet);
      const q = EventsQuery.parse(request.query);

      const conditions = [
        eq(userPositionEvents.wallet_address, wallet),
      ];
      if (q.protocol)
        conditions.push(eq(userPositionEvents.protocol_slug, q.protocol));
      if (q.product_type)
        conditions.push(
          eq(userPositionEvents.product_type, q.product_type),
        );

      const rows = await db
        .select()
        .from(userPositionEvents)
        .where(and(...conditions))
        .orderBy(desc(userPositionEvents.event_at))
        .limit(q.limit);

      return rows.map((r) => ({
        id: r.id,
        wallet_address: r.wallet_address,
        protocol_slug: r.protocol_slug,
        product_type: r.product_type,
        external_id: r.external_id,
        event_type: r.event_type,
        amount: numOrNull(r.amount),
        amount_usd: numOrNull(r.amount_usd),
        tx_signature: r.tx_signature,
        event_at: r.event_at,
        extra_data: r.extra_data,
      }));
    },
  });
}
