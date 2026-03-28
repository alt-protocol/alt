/**
 * Fetch user positions from Drift Protocol and store snapshots.
 *
 * Port of backend/app/services/drift_position_fetcher.py
 *
 * Two position types:
 *   - Insurance Fund staking: IF stake events → proportional share
 *   - Strategy Vaults: daily snapshots → totalAccountValue vs netDeposits
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { getOrNull } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { safeFloat, parseTimestamp, cached } from "../../shared/utils.js";
import type { OpportunityMapEntry } from "../../shared/types.js";
import { discoverService } from "../../discover/service.js";
import { db } from "../db/connection.js";
import { trackedWallets } from "../db/schema.js";
import {
  buildPositionDict,
  computeHeldDays,
  storePositionRows,
  storeEventsBatch,
  loadOpportunityMap,
  type PositionDict,
  type EventDict,
} from "./utils.js";

const DRIFT_API = "https://data.api.drift.trade";

async function dGet(path: string): Promise<unknown | null> {
  return getOrNull(`${DRIFT_API}${path}`, { logLabel: "Drift API" });
}

// ---------------------------------------------------------------------------
// IF pool APYs (cached 5 min)
// The /stats/insuranceFund API only returns { marketIndex, symbol, apy }
// per entry — no share price or vault balance fields.
// ---------------------------------------------------------------------------

let _ifApyCache: { at: number; data: Record<number, number> } | null = null;

async function getIfPoolApys(): Promise<Record<number, number>> {
  const now = Date.now();
  if (_ifApyCache && now - _ifApyCache.at < 300_000) return _ifApyCache.data;

  const data = await dGet("/stats/insuranceFund");
  const result: Record<number, number> = {};
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const entries =
      ((data as Record<string, unknown>).data as Record<string, unknown>)
        ?.marketSharePriceData ??
      (data as Record<string, unknown>).marketSharePriceData;
    if (Array.isArray(entries)) {
      for (const e of entries as Record<string, unknown>[]) {
        const idx = e.marketIndex;
        const apy = safeFloat(e.apy);
        if (idx !== undefined && apy !== null) result[Number(idx)] = apy;
      }
    }
  }
  _ifApyCache = { at: now, data: result };
  return result;
}

// ---------------------------------------------------------------------------
// IF events
// ---------------------------------------------------------------------------

async function fetchIfEvents(wallet: string): Promise<Record<string, unknown>[]> {
  const raw = await dGet(`/authority/${wallet}/insuranceFundStake`);
  let events: Record<string, unknown>[] = [];

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    events = ((raw as Record<string, unknown>).records as Record<string, unknown>[]) ?? [];
  } else if (Array.isArray(raw)) {
    events = raw as Record<string, unknown>[];
  }

  if (events.length > 0) return events;

  // Fallback: search month by month (up to 6 months back)
  const now = new Date();
  const allEvents: Record<string, unknown>[] = [];
  for (let monthsBack = 0; monthsBack < 7; monthsBack++) {
    let year = now.getFullYear();
    let month = now.getMonth() + 1 - monthsBack;
    while (month <= 0) {
      month += 12;
      year--;
    }
    const raw2 = await dGet(
      `/authority/${wallet}/insuranceFundStake/${year}/${month}`,
    );
    let monthly: Record<string, unknown>[] = [];
    if (raw2 && typeof raw2 === "object" && !Array.isArray(raw2)) {
      monthly = ((raw2 as Record<string, unknown>).records as Record<string, unknown>[]) ?? [];
    } else if (Array.isArray(raw2)) {
      monthly = raw2 as Record<string, unknown>[];
    }
    if (monthly.length > 0) allEvents.push(...monthly);
  }
  return allEvents;
}

// ---------------------------------------------------------------------------
// IF positions
// ---------------------------------------------------------------------------

function ifEventToRecord(evt: Record<string, unknown>, wallet: string): EventDict {
  const action = ((evt.action as string) ?? "unknown").toLowerCase();
  const marketIndex = evt.marketIndex ?? 0;
  return {
    wallet_address: wallet,
    protocol_slug: "drift",
    product_type: "insurance_fund",
    external_id: `drift-if-${marketIndex}`,
    event_type: action,
    amount: safeFloat(evt.amount),
    amount_usd: safeFloat(evt.amount),
    tx_signature: (evt.txSig as string) ?? null,
    event_at: parseTimestamp(evt.ts) ?? new Date(),
    extra_data: {
      symbol: evt.symbol,
      market_index: marketIndex,
      if_shares_before: safeFloat(evt.ifSharesBefore),
      if_shares_after: safeFloat(evt.ifSharesAfter),
    },
  };
}

async function fetchIfPositions(
  wallet: string,
  now: Date,
  oppMap: Record<string, OpportunityMapEntry>,
): Promise<{ positions: PositionDict[]; events: EventDict[] }> {
  const events = await fetchIfEvents(wallet);
  if (events.length === 0) return { positions: [], events: [] };

  const ifApys = await getIfPoolApys();

  // Group by marketIndex
  const byMarket: Record<number, Record<string, unknown>[]> = {};
  for (const evt of events) {
    const idx = Number(evt.marketIndex ?? -1);
    if (idx < 0) continue;
    if (!byMarket[idx]) byMarket[idx] = [];
    byMarket[idx].push(evt);
  }

  const positions: PositionDict[] = [];
  const positionEvents: EventDict[] = [];

  for (const [marketIndex, marketEvents] of Object.entries(byMarket)) {
    const idx = Number(marketIndex);
    marketEvents.sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));
    const latest = marketEvents[marketEvents.length - 1];

    const sharesAfter = safeFloat(latest.ifSharesAfter) ?? 0;
    if (sharesAfter < 0.001) {
      // Closed — record events only
      for (const evt of marketEvents)
        positionEvents.push(ifEventToRecord(evt, wallet));
      continue;
    }

    const symbol =
      (latest.symbol as string) ?? `MARKET-${idx}`;
    const externalId = `drift-if-${idx}`;
    const entry = oppMap[externalId];

    // Compute current deposit value using opportunity TVL (updated every
    // 15 min from on-chain data) and event-level total shares.
    // The Drift /stats/insuranceFund API only returns { marketIndex, symbol, apy }
    // — no share price or vault balance — so we derive value from the Discover
    // module's TVL combined with the most recent event's total shares.
    const totalSharesEv = safeFloat(latest.totalIfSharesAfter);
    const tvlUsd = entry?.tvl_usd ?? null;
    let depositAmountUsd: number | null = null;

    if (tvlUsd && tvlUsd > 0 && totalSharesEv && totalSharesEv > 0) {
      // TVL is current (from on-chain); totalShares from last event is approximate
      depositAmountUsd = (sharesAfter / totalSharesEv) * tvlUsd;
    }

    // Fallback: event-level vault amount (raw token units → USD)
    if (depositAmountUsd === null) {
      const vaultAmountRaw = safeFloat(latest.insuranceVaultAmountBefore);
      if (totalSharesEv && totalSharesEv > 0 && vaultAmountRaw) {
        // insuranceVaultAmountBefore is in raw token units (6 decimals for stablecoins)
        const STABLECOIN_DECIMALS = 6;
        const vaultAmountUsd = vaultAmountRaw / 10 ** STABLECOIN_DECIMALS;
        depositAmountUsd = (sharesAfter / totalSharesEv) * vaultAmountUsd;
        logger.debug(
          { wallet: wallet.slice(0, 8), market: idx, vaultAmountRaw, vaultAmountUsd, deposit: depositAmountUsd },
          "Drift IF: using normalized event fallback for deposit value",
        );
      }
    }

    if (depositAmountUsd === null) {
      logger.info(
        { wallet: wallet.slice(0, 8), market: idx, shares: sharesAfter },
        "Drift IF: could not compute current value — no TVL or event data",
      );
    }

    let totalStaked = 0;
    let totalUnstaked = 0;
    let openedAt: Date | null = null;

    for (const evt of marketEvents) {
      const action = ((evt.action as string) ?? "").toLowerCase();
      const amount = safeFloat(evt.amount) ?? 0;
      if (action === "stake") {
        totalStaked += amount;
        if (openedAt === null) openedAt = parseTimestamp(evt.ts);
      } else if (action === "unstake" || action === "unstakerequest") {
        totalUnstaked += amount;
      }
    }

    const netStaked = totalStaked - totalUnstaked;
    const initialDepositUsd = netStaked > 0 ? netStaked : totalStaked;
    const pnlUsd =
      depositAmountUsd !== null && initialDepositUsd > 0
        ? depositAmountUsd - initialDepositUsd
        : null;
    const pnlPct =
      pnlUsd !== null && initialDepositUsd > 0
        ? (pnlUsd / initialDepositUsd) * 100
        : null;

    let apy: number | null = ifApys[idx] ?? null;
    if (apy === null && entry) apy = entry.apy_current;

    positions.push(
      buildPositionDict({
        wallet_address: wallet,
        protocol_slug: "drift",
        product_type: "insurance_fund",
        external_id: externalId,
        snapshot_at: now,
        opportunity_id: entry?.id ?? null,
        deposit_amount: sharesAfter,
        deposit_amount_usd: depositAmountUsd,
        pnl_usd: pnlUsd,
        pnl_pct: pnlPct,
        initial_deposit_usd: initialDepositUsd > 0 ? initialDepositUsd : null,
        opened_at: openedAt,
        held_days: computeHeldDays(openedAt, now),
        apy,
        token_symbol: symbol,
        extra_data: {
          if_shares: sharesAfter,
          market_index: idx,
          symbol,
          total_staked: totalStaked,
          total_unstaked: totalUnstaked,
        },
      }),
    );

    for (const evt of marketEvents)
      positionEvents.push(ifEventToRecord(evt, wallet));
  }

  return { positions, events: positionEvents };
}

// ---------------------------------------------------------------------------
// Strategy vault positions
// ---------------------------------------------------------------------------

async function fetchVaultPositions(
  wallet: string,
  now: Date,
  oppMap: Record<string, OpportunityMapEntry>,
): Promise<PositionDict[]> {
  const STALE_DAYS = 7;
  const byVault: Record<string, Record<string, unknown>[]> = {};
  const seenKeys = new Set<string>();

  for (const days of [1, 100]) {
    const raw = await dGet(
      `/authority/${wallet}/snapshots/vaults?days=${days}`,
    );
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;

    const accounts =
      ((raw as Record<string, unknown>).accounts as Record<
        string,
        unknown
      >[]) ?? [];
    for (const account of accounts) {
      const snapshots =
        (account.snapshots as Record<string, unknown>[]) ?? [];
      for (const snap of snapshots) {
        const vault = snap.vault as string;
        if (!vault) continue;
        const key = `${vault}:${snap.ts}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        if (!byVault[vault]) byVault[vault] = [];
        byVault[vault].push(snap);
      }
    }
  }

  if (Object.keys(byVault).length === 0) return [];

  const positions: PositionDict[] = [];

  for (const [vaultPubkey, snapshots] of Object.entries(byVault)) {
    snapshots.sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));
    const latest = snapshots[snapshots.length - 1];

    const latestTs = parseTimestamp(latest.ts);
    if (
      latestTs &&
      (now.getTime() - latestTs.getTime()) / 1000 > STALE_DAYS * 86400
    ) {
      continue;
    }

    const totalValue = safeFloat(latest.totalAccountValue) ?? 0;
    if (totalValue <= 0) continue;

    const netDeposits = safeFloat(latest.netDeposits) ?? 0;
    const marketIndex = latest.marketIndex;
    const pnlUsd = totalValue - netDeposits;
    const pnlPct = netDeposits > 0 ? (pnlUsd / netDeposits) * 100 : null;

    logger.debug(
      { wallet: wallet.slice(0, 8), vault: vaultPubkey.slice(0, 8), totalValue, netDeposits, pnlUsd, snapshotCount: snapshots.length },
      "Drift vault position computed",
    );

    const externalId = `drift-vault-${vaultPubkey}`;
    const entry =
      oppMap[vaultPubkey] ?? oppMap[externalId] ?? null;
    let tokenSymbol = entry?.first_token ?? null;
    if (!tokenSymbol && marketIndex !== undefined) {
      tokenSymbol = `MARKET-${marketIndex}`;
    }

    const openedAt = parseTimestamp(snapshots[0].ts);

    positions.push(
      buildPositionDict({
        wallet_address: wallet,
        protocol_slug: "drift",
        product_type: "earn_vault",
        external_id: externalId,
        snapshot_at: now,
        opportunity_id: entry?.id ?? null,
        deposit_amount: totalValue,
        deposit_amount_usd: totalValue,
        pnl_usd: pnlUsd,
        pnl_pct: pnlPct,
        initial_deposit_usd: netDeposits > 0 ? netDeposits : null,
        opened_at: openedAt,
        held_days: computeHeldDays(openedAt, now),
        apy: entry?.apy_current ?? null,
        token_symbol: tokenSymbol,
        extra_data: {
          vault_pubkey: vaultPubkey,
          market_index: marketIndex,
          net_deposits: netDeposits,
          total_account_value: totalValue,
          total_account_base_value: safeFloat(latest.totalAccountBaseValue),
        },
      }),
    );
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchWalletPositions(
  walletAddress: string,
): Promise<{
  wallet: string;
  positions: PositionDict[];
  events: EventDict[];
  summary: { total_value_usd: number; total_pnl_usd: number; position_count: number };
}> {
  const now = new Date();
  const oppMap = await loadOpportunityMap(discoverService);

  const { positions: ifPositions, events: ifEvents } =
    await fetchIfPositions(walletAddress, now, oppMap);
  const vaultPositions = await fetchVaultPositions(
    walletAddress,
    now,
    oppMap,
  );

  const allPositions = [...ifPositions, ...vaultPositions];
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
    events: ifEvents,
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

  logger.info({ count: wallets.length }, "Snapshotting Drift positions");
  const now = snapshotAt ?? new Date();
  let totalSnapshots = 0;
  const oppMap = await loadOpportunityMap(discoverService);
  await getIfPoolApys(); // prime cache

  for (const wallet of wallets) {
    try {
      const { positions: ifPositions, events: ifEvents } =
        await fetchIfPositions(wallet.wallet_address, now, oppMap);
      const vaultPositions = await fetchVaultPositions(
        wallet.wallet_address,
        now,
        oppMap,
      );

      const allPositions = [...ifPositions, ...vaultPositions];
      totalSnapshots += await storePositionRows(database, allPositions, now);
      await storeEventsBatch(database, ifEvents);

      await database
        .update(trackedWallets)
        .set({ last_fetched_at: now })
        .where(eq(trackedWallets.id, wallet.id));

      logger.info(
        {
          wallet: wallet.wallet_address.slice(0, 8),
          count: allPositions.length,
        },
        "Drift wallet snapshotted",
      );
    } catch (err) {
      logger.error(
        { err, wallet: wallet.wallet_address.slice(0, 8) },
        "Failed to snapshot Drift wallet",
      );
    }
  }

  logger.info({ totalSnapshots }, "Drift position snapshot complete");
  return totalSnapshots;
}
