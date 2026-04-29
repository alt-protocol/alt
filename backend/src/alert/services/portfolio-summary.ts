import { eq, and, sql, inArray, gte, lt, desc } from "drizzle-orm";
import { db } from "../db/connection.js";
import { yieldOpportunities, yieldSnapshots, stablecoinPegStats } from "../../discover/db/schema.js";
import { userPositions } from "../../monitor/db/schema.js";
import { pgSchema, serial, integer, bigint, varchar, boolean } from "drizzle-orm/pg-core";

const tgSchema = pgSchema("telegram");
const tgUsers = tgSchema.table("users", {
  id: serial("id").primaryKey(),
  chat_id: bigint("chat_id", { mode: "bigint" }).notNull(),
  wallet_address: varchar("wallet_address", { length: 255 }),
});
const tgPrefs = tgSchema.table("user_preferences", {
  id: serial("id").primaryKey(),
  user_id: integer("user_id").notNull(),
  alerts_enabled: boolean("alerts_enabled").notNull(),
  weekly_summary_enabled: boolean("weekly_summary_enabled"),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SummaryUser {
  userId: number;
  chatId: bigint;
  walletAddress: string;
}

export interface PortfolioPosition {
  name: string;
  protocol: string | null;
  depositUsd: number;
  apy: number;
  apy30dAvg: number | null;
  pnlUsd: number;
  pnlPct: number;
  healthFactor: number | null;
}

export interface PortfolioSummary {
  positions: PortfolioPosition[];
  totalValueUsd: number;
  weightedApy: number;
  projectedAnnualYield: number;
  idleTokens: Array<{ symbol: string; amount: number }>;
  riskFlags: string[];
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** Get users eligible for portfolio summaries (alerts enabled + wallet linked). */
export async function getSummaryUsers(): Promise<SummaryUser[]> {
  const users = await db
    .select({
      id: tgUsers.id,
      chat_id: tgUsers.chat_id,
      wallet_address: tgUsers.wallet_address,
    })
    .from(tgUsers)
    .innerJoin(tgPrefs, eq(tgPrefs.user_id, tgUsers.id))
    .where(eq(tgPrefs.alerts_enabled, true));

  return users
    .filter((u) => u.wallet_address !== null)
    .map((u) => ({
      userId: u.id,
      chatId: u.chat_id,
      walletAddress: u.wallet_address!,
    }));
}

// ---------------------------------------------------------------------------
// Portfolio summary (shared by daily + weekly)
// ---------------------------------------------------------------------------

/** Build portfolio summary: deduplicated positions with APY 30d avg and risk flags. */
export async function buildPortfolioSummary(walletAddress: string): Promise<PortfolioSummary> {
  // Latest snapshot per position (external_id is the unique position identifier)
  const latestSub = db
    .select({
      external_id: userPositions.external_id,
      latest_at: sql<Date>`MAX(${userPositions.snapshot_at})`.as("latest_at"),
    })
    .from(userPositions)
    .where(
      and(
        eq(userPositions.wallet_address, walletAddress),
        eq(userPositions.is_closed, false),
      ),
    )
    .groupBy(userPositions.external_id)
    .as("latest_sub");

  const rows = await db
    .select({
      external_id: userPositions.external_id,
      opportunity_id: userPositions.opportunity_id,
      deposit_amount_usd: userPositions.deposit_amount_usd,
      apy: userPositions.apy,
      pnl_usd: userPositions.pnl_usd,
      pnl_pct: userPositions.pnl_pct,
      protocol_slug: userPositions.protocol_slug,
      token_symbol: userPositions.token_symbol,
      extra_data: userPositions.extra_data,
      // From yield_opportunities
      opp_name: yieldOpportunities.name,
      apy_30d_avg: yieldOpportunities.apy_30d_avg,
    })
    .from(userPositions)
    .innerJoin(
      latestSub,
      and(
        eq(userPositions.external_id, latestSub.external_id),
        eq(userPositions.snapshot_at, latestSub.latest_at),
        eq(userPositions.wallet_address, walletAddress),
      ),
    )
    .leftJoin(
      yieldOpportunities,
      eq(userPositions.opportunity_id, yieldOpportunities.id),
    );

  const riskFlags: string[] = [];

  const positions: PortfolioPosition[] = rows.map((r) => {
    const depositUsd = Number(r.deposit_amount_usd) || 0;
    const apy = Number(r.apy) || 0;
    const name = r.opp_name ?? `${r.protocol_slug} ${r.token_symbol ?? ""}`.trim();

    // Extract health factor from extra_data JSONB
    let healthFactor: number | null = null;
    if (r.extra_data && typeof r.extra_data === "object") {
      const ed = r.extra_data as Record<string, unknown>;
      if (typeof ed.health_factor === "number" && ed.health_factor > 0) {
        healthFactor = ed.health_factor;
        if (healthFactor < 1.5 && depositUsd > 10) {
          riskFlags.push(`${name}: health factor ${healthFactor.toFixed(2)} — approaching liquidation`);
        }
      }
    }

    return {
      name,
      protocol: r.protocol_slug,
      depositUsd,
      apy,
      apy30dAvg: r.apy_30d_avg ? Number(r.apy_30d_avg) : null,
      pnlUsd: Number(r.pnl_usd) || 0,
      pnlPct: Number(r.pnl_pct) || 0,
      healthFactor,
    };
  });

  // Sort by deposit value DESC, take top 10
  positions.sort((a, b) => b.depositUsd - a.depositUsd);
  const topPositions = positions.slice(0, 10);

  const totalValueUsd = positions.reduce((sum, p) => sum + p.depositUsd, 0);
  const weightedApy =
    totalValueUsd > 0
      ? positions.reduce((sum, p) => sum + p.apy * p.depositUsd, 0) / totalValueUsd
      : 0;
  const projectedAnnualYield = totalValueUsd * (weightedApy / 100);

  return {
    positions: topPositions,
    totalValueUsd,
    weightedApy,
    projectedAnnualYield,
    idleTokens: [], // Enriched by bot via separate RPC call if needed
    riskFlags,
  };
}

// ---------------------------------------------------------------------------
// Daily summary (change-focused)
// ---------------------------------------------------------------------------

const DAILY_THRESHOLDS = {
  aprChangePp: 0.5,
  healthFactor: 1.5,
  volatility1d: 0.5,
  tvlDropPct: 20,
  minPositionUsd: 10,
};

export interface DailyAprChange {
  name: string;
  currentApy: number;
  yesterdayApy: number;
  changePp: number;
  depositUsd: number;
}

export interface DailyRisk {
  name: string;
  type: "health_factor" | "volatility" | "tvl_drop";
  value: number;
  yesterdayValue: number | null;
  message: string;
}

export interface DailySummary {
  totalValueUsd: number;
  weightedApy: number;
  projectedAnnualYield: number;
  aprChanges: DailyAprChange[];
  risks: DailyRisk[];
}

/** Build daily summary: what changed today vs yesterday. */
export async function buildDailySummary(walletAddress: string): Promise<DailySummary> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  // 1. Latest positions grouped by opportunity_id
  const latestSub = db
    .select({
      opportunity_id: userPositions.opportunity_id,
      latest_at: sql<Date>`MAX(${userPositions.snapshot_at})`.as("latest_at"),
    })
    .from(userPositions)
    .where(
      and(
        eq(userPositions.wallet_address, walletAddress),
        eq(userPositions.is_closed, false),
      ),
    )
    .groupBy(userPositions.opportunity_id)
    .as("latest_sub");

  const rows = await db
    .select({
      opportunity_id: userPositions.opportunity_id,
      deposit_usd: sql<number>`SUM(${userPositions.deposit_amount_usd}::numeric)`.as("deposit_usd"),
      apy: sql<number>`AVG(${userPositions.apy}::numeric)`.as("apy"),
      min_health: sql<number>`MIN((${userPositions.extra_data}->>'health_factor')::numeric)`.as("min_health"),
      opp_name: yieldOpportunities.name,
      token_symbol: sql<string>`MIN(${userPositions.token_symbol})`.as("token_symbol"),
      protocol_slug: sql<string>`MIN(${userPositions.protocol_slug})`.as("protocol_slug"),
    })
    .from(userPositions)
    .innerJoin(
      latestSub,
      and(
        sql`${userPositions.opportunity_id} = ${latestSub.opportunity_id}`,
        eq(userPositions.snapshot_at, latestSub.latest_at),
        eq(userPositions.wallet_address, walletAddress),
      ),
    )
    .leftJoin(
      yieldOpportunities,
      eq(userPositions.opportunity_id, yieldOpportunities.id),
    )
    .groupBy(userPositions.opportunity_id, yieldOpportunities.name);

  // Filter tiny positions
  const positions = rows.filter((r) => Number(r.deposit_usd) >= DAILY_THRESHOLDS.minPositionUsd);

  // Totals
  const totalValueUsd = positions.reduce((s, r) => s + Number(r.deposit_usd), 0);
  const weightedApy = totalValueUsd > 0
    ? positions.reduce((s, r) => s + Number(r.apy) * Number(r.deposit_usd), 0) / totalValueUsd
    : 0;
  const projectedAnnualYield = totalValueUsd * (weightedApy / 100);

  // 2. Yesterday's APY per opportunity from yield_snapshots
  const oppIds = positions
    .map((r) => r.opportunity_id)
    .filter((id): id is number => id !== null);

  const yesterdayApys = oppIds.length > 0
    ? await db
        .select({
          opportunity_id: yieldSnapshots.opportunity_id,
          apy: yieldSnapshots.apy,
        })
        .from(yieldSnapshots)
        .where(
          and(
            inArray(yieldSnapshots.opportunity_id, oppIds),
            gte(yieldSnapshots.snapshot_at, twoDaysAgo),
            lt(yieldSnapshots.snapshot_at, yesterday),
          ),
        )
        .orderBy(desc(yieldSnapshots.snapshot_at))
    : [];

  // Deduplicate: first row per opportunity_id (most recent within window)
  const yesterdayApyMap = new Map<number, number>();
  for (const s of yesterdayApys) {
    if (!yesterdayApyMap.has(s.opportunity_id)) {
      yesterdayApyMap.set(s.opportunity_id, Number(s.apy) || 0);
    }
  }

  // 3. Yesterday's health factor from older position snapshots
  const yesterdayHealthMap = new Map<number, number>();
  if (oppIds.length > 0) {
    const oldSnapshots = await db
      .select({
        opportunity_id: userPositions.opportunity_id,
        health_factor: sql<number>`MIN((${userPositions.extra_data}->>'health_factor')::numeric)`.as("health_factor"),
      })
      .from(userPositions)
      .where(
        and(
          eq(userPositions.wallet_address, walletAddress),
          eq(userPositions.is_closed, false),
          inArray(userPositions.opportunity_id, oppIds),
          gte(userPositions.snapshot_at, twoDaysAgo),
          lt(userPositions.snapshot_at, yesterday),
        ),
      )
      .groupBy(userPositions.opportunity_id);

    for (const s of oldSnapshots) {
      if (s.opportunity_id && s.health_factor) {
        yesterdayHealthMap.set(s.opportunity_id, Number(s.health_factor));
      }
    }
  }

  // 4. Build APR changes (only significant ones)
  const aprChanges: DailyAprChange[] = [];
  for (const pos of positions) {
    if (!pos.opportunity_id) continue;
    const currentApy = Number(pos.apy);
    const yesterdayApy = yesterdayApyMap.get(pos.opportunity_id);
    if (yesterdayApy === undefined) continue;

    const changePp = currentApy - yesterdayApy;
    if (Math.abs(changePp) < DAILY_THRESHOLDS.aprChangePp) continue;

    aprChanges.push({
      name: pos.opp_name ?? `${pos.protocol_slug} ${pos.token_symbol ?? ""}`.trim(),
      currentApy,
      yesterdayApy,
      changePp,
      depositUsd: Number(pos.deposit_usd),
    });
  }
  aprChanges.sort((a, b) => Math.abs(b.changePp) - Math.abs(a.changePp));

  // 5. Build risks
  const risks: DailyRisk[] = [];

  // Health factor risks
  for (const pos of positions) {
    const hf = Number(pos.min_health);
    if (!hf || hf <= 0 || hf >= DAILY_THRESHOLDS.healthFactor) continue;

    const name = pos.opp_name ?? `${pos.protocol_slug} ${pos.token_symbol ?? ""}`.trim();
    const yesterdayHf = pos.opportunity_id ? yesterdayHealthMap.get(pos.opportunity_id) ?? null : null;
    const yesterdayStr = yesterdayHf ? ` (was ${yesterdayHf.toFixed(2)} yesterday)` : "";

    risks.push({
      name,
      type: "health_factor",
      value: hf,
      yesterdayValue: yesterdayHf,
      message: `${name}: health ${hf.toFixed(2)}${yesterdayStr}`,
    });
  }

  // Stablecoin volatility risks
  const tokenSymbols = [...new Set(positions.map((r) => r.token_symbol).filter(Boolean))] as string[];
  if (tokenSymbols.length > 0) {
    const volatileCoins = await db
      .select({
        symbol: stablecoinPegStats.symbol,
        volatility_1d: stablecoinPegStats.volatility_1d,
      })
      .from(stablecoinPegStats)
      .where(inArray(stablecoinPegStats.symbol, tokenSymbols));

    for (const coin of volatileCoins) {
      const vol = Number(coin.volatility_1d) || 0;
      if (vol < DAILY_THRESHOLDS.volatility1d) continue;

      risks.push({
        name: coin.symbol,
        type: "volatility",
        value: vol,
        yesterdayValue: null,
        message: `${coin.symbol}: 24h volatility ${vol.toFixed(2)}%`,
      });
    }
  }

  // TVL drop risks
  if (oppIds.length > 0) {
    // Current TVL
    const currentTvl = await db
      .select({
        opportunity_id: yieldSnapshots.opportunity_id,
        tvl_usd: yieldSnapshots.tvl_usd,
      })
      .from(yieldSnapshots)
      .where(
        and(
          inArray(yieldSnapshots.opportunity_id, oppIds),
          gte(yieldSnapshots.snapshot_at, yesterday),
        ),
      )
      .orderBy(desc(yieldSnapshots.snapshot_at));

    const currentTvlMap = new Map<number, number>();
    for (const s of currentTvl) {
      if (!currentTvlMap.has(s.opportunity_id)) {
        currentTvlMap.set(s.opportunity_id, Number(s.tvl_usd) || 0);
      }
    }

    // Yesterday's TVL
    const yesterdayTvl = await db
      .select({
        opportunity_id: yieldSnapshots.opportunity_id,
        tvl_usd: yieldSnapshots.tvl_usd,
      })
      .from(yieldSnapshots)
      .where(
        and(
          inArray(yieldSnapshots.opportunity_id, oppIds),
          gte(yieldSnapshots.snapshot_at, twoDaysAgo),
          lt(yieldSnapshots.snapshot_at, yesterday),
        ),
      )
      .orderBy(desc(yieldSnapshots.snapshot_at));

    const yesterdayTvlMap = new Map<number, number>();
    for (const s of yesterdayTvl) {
      if (!yesterdayTvlMap.has(s.opportunity_id)) {
        yesterdayTvlMap.set(s.opportunity_id, Number(s.tvl_usd) || 0);
      }
    }

    for (const pos of positions) {
      if (!pos.opportunity_id) continue;
      const curr = currentTvlMap.get(pos.opportunity_id);
      const prev = yesterdayTvlMap.get(pos.opportunity_id);
      if (!curr || !prev || prev === 0) continue;

      const dropPct = ((prev - curr) / prev) * 100;
      if (dropPct < DAILY_THRESHOLDS.tvlDropPct) continue;

      const name = pos.opp_name ?? `${pos.protocol_slug} ${pos.token_symbol ?? ""}`.trim();
      risks.push({
        name,
        type: "tvl_drop",
        value: dropPct,
        yesterdayValue: prev,
        message: `${name}: TVL dropped ${dropPct.toFixed(0)}% (${formatUsd(prev)} → ${formatUsd(curr)})`,
      });
    }
  }

  return { totalValueUsd, weightedApy, projectedAnnualYield, aprChanges, risks };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

/** Format daily summary: change-focused, not a position dump. */
export function formatDailyTemplate(data: DailySummary): string {
  const lines: string[] = [
    "Daily Portfolio Update",
    "",
    `Portfolio: ${formatUsd(data.totalValueUsd)}`,
    `APY: ${data.weightedApy.toFixed(1)}%`,
    `Projected yield: ~${formatUsd(data.projectedAnnualYield)}/yr`,
  ];

  if (data.aprChanges.length > 0) {
    lines.push("", "APR Changes:");
    for (const c of data.aprChanges) {
      const sign = c.changePp >= 0 ? "+" : "";
      lines.push(`${c.name}: ${c.currentApy.toFixed(1)}% (was ${c.yesterdayApy.toFixed(1)}% yesterday, ${sign}${c.changePp.toFixed(1)}%)`);
    }
  } else {
    lines.push("", "No significant APR changes.");
  }

  if (data.risks.length > 0) {
    lines.push("", "Risks:");
    for (const r of data.risks) {
      lines.push(`${r.message}`);
    }
  }

  return lines.join("\n");
}

/** Format weekly portfolio review (positions + PnL, for AI recommendation). */
export function formatWeeklyTemplate(data: PortfolioSummary): string {
  const lines: string[] = [
    "Weekly Portfolio Review",
    "",
    `${formatUsd(data.totalValueUsd)} | APY ${data.weightedApy.toFixed(1)}% | Projected: ${formatUsd(data.projectedAnnualYield)}/yr`,
  ];

  if (data.positions.length > 0) {
    lines.push("", "Positions:");
    for (let i = 0; i < data.positions.length; i++) {
      const p = data.positions[i];
      const pnlSign = p.pnlUsd >= 0 ? "+" : "";
      lines.push(
        `${i + 1}. ${p.name}: ${formatUsd(p.depositUsd)} at ${p.apy.toFixed(1)}% (${pnlSign}$${p.pnlUsd.toFixed(2)})`,
      );
    }
  } else {
    lines.push("", "No active positions.");
  }

  if (data.riskFlags.length > 0) {
    lines.push("", "Risks:");
    for (const flag of data.riskFlags) {
      lines.push(`- ${flag}`);
    }
  }

  return lines.join("\n");
}
