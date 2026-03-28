/**
 * Shared utilities for position fetchers.
 * Port of position-specific functions from backend/app/services/utils.py
 */
import { eq, and, sql, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { userPositions, userPositionEvents } from "../db/schema.js";
import { logger } from "../../shared/logger.js";
import { safeFloat } from "../../shared/utils.js";
import type { DiscoverService, OpportunityMapEntry } from "../../shared/types.js";

export { safeFloat };

// ---------------------------------------------------------------------------
// Position math
// ---------------------------------------------------------------------------

export function computeRealizedApy(
  pnlUsd: number | null,
  initialDepositUsd: number | null,
  heldDays: number | null,
): number | null {
  if (
    pnlUsd === null ||
    !initialDepositUsd ||
    heldDays === null ||
    heldDays < 1
  )
    return null;
  return Math.round((pnlUsd / initialDepositUsd) * (365.0 / heldDays) * 100 * 10000) / 10000;
}

export function computeHeldDays(
  openedAt: Date | null | undefined,
  now?: Date,
): number | null {
  if (!openedAt) return null;
  const end = now ?? new Date();
  return Math.round(((end.getTime() - openedAt.getTime()) / 86_400_000) * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Build position dict (port of build_position_dict)
// ---------------------------------------------------------------------------

export interface PositionParams {
  wallet_address: string;
  protocol_slug: string;
  product_type: string;
  external_id: string;
  snapshot_at: Date;
  opportunity_id?: number | null;
  deposit_amount?: number | null;
  deposit_amount_usd?: number | null;
  pnl_usd?: number | null;
  pnl_pct?: number | null;
  initial_deposit_usd?: number | null;
  opened_at?: Date | null;
  held_days?: number | null;
  apy?: number | null;
  is_closed?: boolean;
  closed_at?: Date | null;
  close_value_usd?: number | null;
  token_symbol?: string | null;
  extra_data?: Record<string, unknown> | null;
}

export interface PositionDict extends Record<string, unknown> {
  wallet_address: string;
  protocol_slug: string;
  product_type: string;
  external_id: string;
  snapshot_at: Date;
  opportunity_id: number | null;
  deposit_amount: number | null;
  deposit_amount_usd: number | null;
  pnl_usd: number | null;
  pnl_pct: number | null;
  initial_deposit_usd: number | null;
  opened_at: Date | null;
  held_days: number | null;
  apy: number | null;
  apy_realized: number | null;
  is_closed: boolean;
  closed_at: Date | null;
  close_value_usd: number | null;
  token_symbol: string | null;
  extra_data: Record<string, unknown>;
}

function r2(v: number | null | undefined): number | null {
  return v != null ? Math.round(v * 100) / 100 : null;
}

function r4(v: number | null | undefined): number | null {
  return v != null ? Math.round(v * 10000) / 10000 : null;
}

export function buildPositionDict(p: PositionParams): PositionDict {
  const pnlUsd = r2(p.pnl_usd);
  const initialDeposit = r2(p.initial_deposit_usd);
  const heldDays = p.held_days ?? null;

  return {
    wallet_address: p.wallet_address,
    protocol_slug: p.protocol_slug,
    product_type: p.product_type,
    external_id: p.external_id,
    opportunity_id: p.opportunity_id ?? null,
    deposit_amount: p.deposit_amount ?? null,
    deposit_amount_usd: r2(p.deposit_amount_usd),
    pnl_usd: pnlUsd,
    pnl_pct: r4(p.pnl_pct),
    initial_deposit_usd: initialDeposit,
    opened_at: p.opened_at ?? null,
    held_days: heldDays,
    apy: r4(p.apy),
    apy_realized: computeRealizedApy(pnlUsd, initialDeposit, heldDays),
    is_closed: p.is_closed ?? false,
    closed_at: p.closed_at ?? null,
    close_value_usd: r2(p.close_value_usd),
    token_symbol: p.token_symbol ?? null,
    extra_data: p.extra_data ?? {},
    snapshot_at: p.snapshot_at,
  };
}

// ---------------------------------------------------------------------------
// Store position rows (port of store_position_rows)
// ---------------------------------------------------------------------------

export async function storePositionRows(
  db: NodePgDatabase,
  positions: PositionDict[],
  snapshotAt: Date,
): Promise<number> {
  let count = 0;
  for (const pos of positions) {
    await db.insert(userPositions).values({
      wallet_address: pos.wallet_address,
      protocol_slug: pos.protocol_slug,
      product_type: pos.product_type,
      external_id: pos.external_id,
      opportunity_id: pos.opportunity_id,
      deposit_amount: pos.deposit_amount?.toString() ?? null,
      deposit_amount_usd: pos.deposit_amount_usd?.toString() ?? null,
      pnl_usd: pos.pnl_usd?.toString() ?? null,
      pnl_pct: pos.pnl_pct?.toString() ?? null,
      initial_deposit_usd: pos.initial_deposit_usd?.toString() ?? null,
      opened_at: pos.opened_at,
      held_days: pos.held_days?.toString() ?? null,
      apy: pos.apy?.toString() ?? null,
      apy_realized: pos.apy_realized?.toString() ?? null,
      is_closed: pos.is_closed,
      closed_at: pos.closed_at,
      close_value_usd: pos.close_value_usd?.toString() ?? null,
      token_symbol: pos.token_symbol,
      extra_data: pos.extra_data,
      snapshot_at: snapshotAt,
    });
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Store events batch (port of store_events_batch) — dedup by tx_signature
// ---------------------------------------------------------------------------

export interface EventDict {
  wallet_address: string;
  protocol_slug: string;
  product_type: string;
  external_id: string;
  event_type: string;
  amount?: number | null;
  amount_usd?: number | null;
  tx_signature?: string | null;
  event_at: Date;
  extra_data?: Record<string, unknown> | null;
}

export async function storeEventsBatch(
  db: NodePgDatabase,
  events: EventDict[],
): Promise<number> {
  if (events.length === 0) return 0;

  // Batch-load existing tx_signatures to dedup
  const sigs = events
    .map((e) => e.tx_signature)
    .filter((s): s is string => !!s);
  const existingSigs = new Set<string>();

  if (sigs.length > 0) {
    for (let i = 0; i < sigs.length; i += 500) {
      const chunk = sigs.slice(i, i + 500);
      const rows = await db
        .select({ tx_signature: userPositionEvents.tx_signature })
        .from(userPositionEvents)
        .where(inArray(userPositionEvents.tx_signature, chunk));
      for (const r of rows) {
        if (r.tx_signature) existingSigs.add(r.tx_signature);
      }
    }
  }

  let count = 0;
  for (const evt of events) {
    if (evt.tx_signature && existingSigs.has(evt.tx_signature)) continue;
    await db.insert(userPositionEvents).values({
      wallet_address: evt.wallet_address,
      protocol_slug: evt.protocol_slug,
      product_type: evt.product_type,
      external_id: evt.external_id,
      event_type: evt.event_type,
      amount: evt.amount?.toString() ?? null,
      amount_usd: evt.amount_usd?.toString() ?? null,
      tx_signature: evt.tx_signature ?? null,
      event_at: evt.event_at,
      extra_data: evt.extra_data ?? null,
    });
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Batch earliest snapshots (port of batch_earliest_snapshots)
// ---------------------------------------------------------------------------

export async function batchEarliestSnapshots(
  db: NodePgDatabase,
  walletAddress: string,
): Promise<Record<string, Date>> {
  const rows = await db.execute(sql`
    SELECT external_id, MIN(snapshot_at) as min_snap
    FROM monitor.user_positions
    WHERE wallet_address = ${walletAddress}
    GROUP BY external_id
  `);

  const result: Record<string, Date> = {};
  for (const row of rows.rows) {
    const extId = row.external_id as string;
    const minSnap = row.min_snap as Date | null;
    if (minSnap) result[extId] = minSnap;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Load opportunity map via DiscoverService (cross-module read)
// ---------------------------------------------------------------------------

export async function loadOpportunityMap(
  discoverService: DiscoverService,
): Promise<Record<string, OpportunityMapEntry>> {
  return discoverService.getOpportunityMap();
}

// ---------------------------------------------------------------------------
// Wallet validation
// ---------------------------------------------------------------------------

const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function validateWallet(address: string): void {
  if (!BASE58_REGEX.test(address)) {
    const err = new Error("Invalid Solana wallet address") as Error & {
      statusCode: number;
    };
    err.statusCode = 400;
    throw err;
  }
}
