import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "../db/connection.js";
import { yieldOpportunities } from "../../discover/db/schema.js";
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
// Formatters
// ---------------------------------------------------------------------------

function formatUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

/** Format daily portfolio snapshot (positions + APY changes + risks). */
export function formatDailyTemplate(data: PortfolioSummary): string {
  const lines: string[] = [
    "Daily Portfolio Update",
    "",
    `${formatUsd(data.totalValueUsd)} | APY ${data.weightedApy.toFixed(1)}% | ~${formatUsd(data.projectedAnnualYield)}/yr`,
  ];

  if (data.positions.length > 0) {
    lines.push("", "Positions:");
    for (let i = 0; i < data.positions.length; i++) {
      const p = data.positions[i];
      let line = `${i + 1}. ${p.name}: ${formatUsd(p.depositUsd)} at ${p.apy.toFixed(1)}%`;
      if (p.apy30dAvg !== null && p.apy30dAvg > 0) {
        const arrow = p.apy > p.apy30dAvg * 1.05 ? " ↑" : p.apy < p.apy30dAvg * 0.95 ? " ↓" : "";
        line += ` (30d avg ${p.apy30dAvg.toFixed(1)}%)${arrow}`;
      }
      lines.push(line);
    }
  } else {
    lines.push("", "No active positions.");
  }

  if (data.riskFlags.length > 0) {
    lines.push("", "Risks:");
    for (const flag of data.riskFlags) {
      lines.push(`- ${flag}`);
    }
  } else {
    lines.push("", "No liquidation risks.");
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
