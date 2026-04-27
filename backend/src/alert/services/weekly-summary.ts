import { eq, and, sql } from "drizzle-orm";
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

export interface WeeklySummaryUser {
  userId: number;
  chatId: bigint;
  walletAddress: string;
}

export interface PositionSummary {
  name: string;
  protocol: string | null;
  depositUsd: number;
  apy: number;
  pnlUsd: number;
  pnlPct: number;
}

export interface WeeklySummaryData {
  user: WeeklySummaryUser;
  positions: PositionSummary[];
  totalValueUsd: number;
  weightedApy: number;
  projectedAnnualYield: number;
  idleTokens: string[];
}

/** Get users eligible for weekly summary (Monday delivery). */
export async function getWeeklySummaryUsers(): Promise<WeeklySummaryUser[]> {
  const users = await db
    .select({
      id: tgUsers.id,
      chat_id: tgUsers.chat_id,
      wallet_address: tgUsers.wallet_address,
    })
    .from(tgUsers)
    .innerJoin(tgPrefs, eq(tgPrefs.user_id, tgUsers.id))
    .where(
      and(
        eq(tgPrefs.alerts_enabled, true),
        eq(tgPrefs.weekly_summary_enabled, true),
      ),
    );

  return users
    .filter((u) => u.wallet_address !== null)
    .map((u) => ({
      userId: u.id,
      chatId: u.chat_id,
      walletAddress: u.wallet_address!,
    }));
}

/** Build structured summary data for a user's portfolio. */
export async function buildWeeklySummary(
  walletAddress: string,
): Promise<Omit<WeeklySummaryData, "user">> {
  // Get latest open positions
  const positions = await db
    .select({
      opportunity_id: userPositions.opportunity_id,
      deposit_amount_usd: userPositions.deposit_amount_usd,
      apy: userPositions.apy,
      pnl_usd: userPositions.pnl_usd,
      pnl_pct: userPositions.pnl_pct,
      protocol_slug: userPositions.protocol_slug,
      token_symbol: userPositions.token_symbol,
    })
    .from(userPositions)
    .where(
      and(
        eq(userPositions.wallet_address, walletAddress),
        eq(userPositions.is_closed, false),
      ),
    );

  // Get opportunity names
  const oppIds = positions
    .map((p) => p.opportunity_id)
    .filter((id): id is number => id !== null);

  const opps =
    oppIds.length > 0
      ? await db
          .select({ id: yieldOpportunities.id, name: yieldOpportunities.name })
          .from(yieldOpportunities)
          .where(sql`${yieldOpportunities.id} = ANY(${oppIds})`)
      : [];
  const oppMap = new Map(opps.map((o) => [o.id, o.name]));

  const summaries: PositionSummary[] = positions.map((p) => ({
    name: oppMap.get(p.opportunity_id ?? 0) ?? `${p.protocol_slug} ${p.token_symbol ?? ""}`,
    protocol: p.protocol_slug,
    depositUsd: Number(p.deposit_amount_usd) || 0,
    apy: Number(p.apy) || 0,
    pnlUsd: Number(p.pnl_usd) || 0,
    pnlPct: Number(p.pnl_pct) || 0,
  }));

  const totalValueUsd = summaries.reduce((sum, p) => sum + p.depositUsd, 0);
  const weightedApy =
    totalValueUsd > 0
      ? summaries.reduce((sum, p) => sum + p.apy * p.depositUsd, 0) / totalValueUsd
      : 0;
  const projectedAnnualYield = totalValueUsd * (weightedApy / 100);

  return {
    positions: summaries,
    totalValueUsd,
    weightedApy,
    projectedAnnualYield,
    idleTokens: [], // Could be enriched from monitor idle balances API
  };
}

/** Format the template portion of the weekly summary. */
export function formatWeeklySummaryTemplate(data: Omit<WeeklySummaryData, "user">): string {
  const lines: string[] = ["Weekly Portfolio Report", ""];

  lines.push(`Value: $${data.totalValueUsd.toFixed(2)}`);
  lines.push(`Overall APY: ${data.weightedApy.toFixed(1)}%`);
  lines.push(`Projected annual yield: $${data.projectedAnnualYield.toFixed(0)}`);
  lines.push("");

  if (data.positions.length > 0) {
    lines.push("Positions:");
    for (let i = 0; i < data.positions.length; i++) {
      const p = data.positions[i];
      const pnlSign = p.pnlUsd >= 0 ? "+" : "";
      lines.push(
        `${i + 1}. ${p.name}: $${p.depositUsd.toFixed(0)} at ${p.apy.toFixed(1)}% (${pnlSign}$${p.pnlUsd.toFixed(2)})`,
      );
    }
  } else {
    lines.push("No active positions.");
  }

  return lines.join("\n");
}
