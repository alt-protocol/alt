/**
 * Fetch user positions from Kamino Finance API and store snapshots.
 *
 * Port of backend/app/services/kamino_position_fetcher.py
 *
 * Three position types:
 *   - Earn Vaults: shares, PnL from dedicated API
 *   - Lending Obligations: Modified Dietz PnL from tx history
 *   - Multiply Obligations: Modified Dietz PnL + leverage data
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq, and } from "drizzle-orm";
import { userPositions } from "../db/schema.js";
import { getOrNull } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { safeFloat, parseTimestamp, cached, cachedAsync } from "../../shared/utils.js";
import { KNOWN_TOKEN_MINTS, classifyToken } from "../../shared/constants.js";
import type { OpportunityMapEntry, UnderlyingToken } from "../../shared/types.js";
import { discoverService } from "../../discover/service.js";
import { db } from "../db/connection.js";
import { trackedWallets } from "../db/schema.js";
import {
  buildPositionDict,
  computeHeldDays,
  storePositionRows,
  storeEventsBatch,
  loadOpportunityMap,
  batchEarliestSnapshots,
  type PositionDict,
  type EventDict,
} from "./utils.js";

const KAMINO_API = "https://api.kamino.finance";

async function kGet(path: string): Promise<unknown | null> {
  return getOrNull(`${KAMINO_API}${path}`, { logLabel: "Kamino API" });
}

// ---------------------------------------------------------------------------
// Shared data (cached)
// ---------------------------------------------------------------------------

async function getAllMarkets(): Promise<Record<string, unknown>[]> {
  return cachedAsync("kamino_all_markets", 600_000, async () => {
    const data = await kGet("/v2/kamino-market");
    if (!Array.isArray(data)) return [];
    return (data as Record<string, unknown>[]).filter(
      (m) => m.lendingMarket,
    );
  });
}

async function buildReserveMap(
  marketPk: string,
): Promise<Record<string, Record<string, unknown>>> {
  return cachedAsync(`kamino_reserve_map:${marketPk}`, 180_000, async () => {
    const reserves = await kGet(`/kamino-market/${marketPk}/reserves/metrics`);
    if (!Array.isArray(reserves)) return {};
    const result: Record<string, Record<string, unknown>> = {};
    for (const r of reserves as Record<string, unknown>[]) {
      const pk = r.reserve as string;
      if (!pk) continue;
      result[pk] = {
        symbol: (r.liquidityToken as string) ?? "",
        mint: (r.liquidityTokenMint as string) ?? "",
        supply_apy: safeFloat(r.supplyInterestAPY ?? r.supplyApy),
        borrow_apy: safeFloat(r.borrowInterestAPY ?? r.borrowApy),
      };
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Obligation tx history & Modified Dietz PnL
// ---------------------------------------------------------------------------

const TX_TYPE_MAP: Record<string, string> = {
  deposit: "deposit",
  create: "deposit",
  withdraw: "withdraw",
  borrow: "borrow",
  repay: "repay",
  depositandborrow: "deposit",
  withdrawandrepay: "withdraw",
  leverageanddeposit: "leverage",
  deleverageandwithdraw: "deleverage",
};

async function fetchObligationTransactions(
  marketPk: string,
  wallet: string,
): Promise<Record<string, Record<string, unknown>[]>> {
  const raw = await kGet(
    `/v2/kamino-market/${marketPk}/users/${wallet}/transactions`,
  );
  if (!raw) return {};

  const byObligation: Record<string, Record<string, unknown>[]> = {};

  if (typeof raw === "object" && !Array.isArray(raw)) {
    for (const [addr, txs] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      if (Array.isArray(txs) && txs.length > 0) {
        byObligation[addr] = txs as Record<string, unknown>[];
      }
    }
  } else if (Array.isArray(raw)) {
    for (const tx of raw as Record<string, unknown>[]) {
      const addr = (tx.obligationAddress as string) ?? "";
      if (!addr) continue;
      if (!byObligation[addr]) byObligation[addr] = [];
      byObligation[addr].push(tx);
    }
  }

  // Sort each obligation's txs ascending
  for (const txs of Object.values(byObligation)) {
    txs.sort((a, b) =>
      String(a.createdOn ?? "").localeCompare(String(b.createdOn ?? "")),
    );
  }
  return byObligation;
}

function findLifecycleStart(
  txs: Record<string, unknown>[],
): Record<string, unknown>[] {
  let resetIdx: number | null = null;
  let running = 0;
  let seenDeposit = false;

  for (let i = 0; i < txs.length; i++) {
    const displayName = (
      (txs[i].transactionDisplayName as string) ?? ""
    ).toLowerCase();
    const usdVal = safeFloat(txs[i].liquidityUsdValue) ?? 0;
    const category = TX_TYPE_MAP[displayName];

    if (category === "deposit") {
      running += usdVal;
      if (usdVal > 0) seenDeposit = true;
    } else if (category === "withdraw") {
      running -= usdVal;
    }

    if (seenDeposit && running < 0.01 && i < txs.length - 1) {
      resetIdx = i + 1;
      running = 0;
      seenDeposit = false;
    }
  }

  return resetIdx !== null ? txs.slice(resetIdx) : txs;
}

interface CashFlows {
  sumDeposit: number;
  sumWithdraw: number;
  sumBorrow: number;
  sumRepay: number;
  cashFlows: [Date, number][];
  tokenSymbol: string | null;
  openedAt: Date | null;
}

function accumulateCashFlows(
  txs: Record<string, unknown>[],
): CashFlows {
  let sumDeposit = 0,
    sumWithdraw = 0,
    sumBorrow = 0,
    sumRepay = 0;
  const cashFlows: [Date, number][] = [];
  let tokenSymbol: string | null = null;
  let openedAt: Date | null = null;

  for (const tx of txs) {
    const displayName = (
      (tx.transactionDisplayName as string) ?? ""
    ).toLowerCase();
    const usdVal = safeFloat(tx.liquidityUsdValue) ?? 0;
    const txTime = parseTimestamp(tx.createdOn);
    const category = TX_TYPE_MAP[displayName];

    if (category === "deposit") {
      sumDeposit += usdVal;
      if (txTime && usdVal > 0) cashFlows.push([txTime, usdVal]);
    } else if (category === "withdraw") {
      sumWithdraw += usdVal;
      if (txTime && usdVal > 0) cashFlows.push([txTime, -usdVal]);
    } else if (category === "borrow") {
      sumBorrow += usdVal;
      if (txTime && usdVal > 0) cashFlows.push([txTime, -usdVal]);
    } else if (category === "repay") {
      sumRepay += usdVal;
      if (txTime && usdVal > 0) cashFlows.push([txTime, usdVal]);
    }

    if (category === "deposit" && openedAt === null && txTime) {
      openedAt = txTime;
    }
    if (tokenSymbol === null && tx.liquidityToken) {
      tokenSymbol = tx.liquidityToken as string;
    }
  }

  return {
    sumDeposit,
    sumWithdraw,
    sumBorrow,
    sumRepay,
    cashFlows,
    tokenSymbol,
    openedAt,
  };
}

interface DietzResult {
  initialDepositUsd: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  openedAt: Date | null;
  heldDays: number | null;
  tokenSymbol: string | null;
  isClosed: boolean;
  closedAt: Date | null;
  closeValueUsd: number | null;
}

function computeModifiedDietz(
  cf: CashFlows,
  currentNetValue: number,
  now: Date,
): DietzResult {
  const netEquity =
    cf.sumDeposit - cf.sumWithdraw - cf.sumBorrow + cf.sumRepay;
  const initialDepositUsd = netEquity > 0 ? netEquity : cf.sumDeposit;
  const isClosed = currentNetValue < 0.01;

  let closedAt: Date | null = null;
  let closeValueUsd: number | null = null;
  if (isClosed) {
    closeValueUsd = cf.sumWithdraw + cf.sumRepay - cf.sumBorrow;
    // Derive close date from last cash flow entry
    if (cf.cashFlows.length > 0) {
      closedAt = cf.cashFlows[cf.cashFlows.length - 1][0];
    }
  }

  const endTime = isClosed && closedAt ? closedAt : now;
  const heldDays = computeHeldDays(cf.openedAt, endTime);
  const T = heldDays;

  let pnlUsd: number | null = null;
  let pnlPct: number | null = null;

  if (T && T > 0 && cf.cashFlows.length > 0 && cf.openedAt) {
    const totalNetCf = cf.cashFlows.reduce((s, [, c]) => s + c, 0);
    let weightedCapital = 0;

    for (const [cfTime, cfAmount] of cf.cashFlows) {
      const daysFromStart =
        (cfTime.getTime() - cf.openedAt.getTime()) / 86_400_000;
      const wi = Math.max(0, Math.min(1, (T - daysFromStart) / T));
      weightedCapital += cfAmount * wi;
    }

    const vEnd = isClosed ? 0 : currentNetValue;
    pnlUsd = vEnd - totalNetCf;

    if (weightedCapital > 0) {
      pnlPct = (pnlUsd / weightedCapital) * 100;
    }
  }

  return {
    initialDepositUsd:
      initialDepositUsd ? Math.round(initialDepositUsd * 100) / 100 : null,
    pnlUsd: pnlUsd !== null ? Math.round(pnlUsd * 100) / 100 : null,
    pnlPct:
      pnlPct !== null ? Math.round(pnlPct * 10000) / 10000 : null,
    openedAt: cf.openedAt,
    heldDays,
    tokenSymbol: cf.tokenSymbol,
    isClosed,
    closedAt: isClosed ? closedAt : null,
    closeValueUsd:
      isClosed && closeValueUsd !== null
        ? Math.round(closeValueUsd * 100) / 100
        : null,
  };
}

function computeObligationPnl(
  txs: Record<string, unknown>[],
  currentNetValue: number,
  now: Date,
): DietzResult {
  const filtered = findLifecycleStart(txs);
  const cf = accumulateCashFlows(filtered);
  const result = computeModifiedDietz(cf, currentNetValue, now);

  // Refine closed_at from tx timestamp if Dietz only had cash flow dates
  if (result.isClosed && !result.closedAt) {
    for (let i = filtered.length - 1; i >= 0; i--) {
      const t = parseTimestamp(filtered[i].createdOn);
      if (t) {
        result.closedAt = t;
        break;
      }
    }
  }

  return result;
}

function obligationTxsToEvents(
  txs: Record<string, unknown>[],
  wallet: string,
  obligationAddress: string,
  productType: string,
): EventDict[] {
  return txs.map((tx) => {
    const displayName = (
      (tx.transactionDisplayName as string) ?? "unknown"
    ).toLowerCase();
    const eventAt = parseTimestamp(tx.createdOn) ?? new Date();

    return {
      wallet_address: wallet,
      protocol_slug: "kamino",
      product_type: productType,
      external_id: obligationAddress,
      event_type: displayName,
      amount: safeFloat(tx.liquidityAmount),
      amount_usd: safeFloat(tx.liquidityUsdValue),
      tx_signature: (tx.transactionSignature as string) ?? null,
      event_at: eventAt,
      extra_data: {
        token_symbol: tx.liquidityToken,
        token_mint: tx.liquidityTokenMint,
        obligation_type: tx.obligationType,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Earn vault positions
// ---------------------------------------------------------------------------

async function fetchEarnPositions(
  wallet: string,
  now: Date,
  oppMap: Record<string, OpportunityMapEntry>,
): Promise<PositionDict[]> {
  const txsRaw = await kGet(`/kvaults/users/${wallet}/transactions`);
  if (!Array.isArray(txsRaw) || txsRaw.length === 0) return [];

  // Discover vaults via tx history (newest-first)
  const vaultTokenInfo: Record<string, Record<string, unknown>> = {};
  const firstDepositTs: Record<string, Date> = {};
  const firstSeenTs: Record<string, Date> = {};

  for (const tx of txsRaw as Record<string, unknown>[]) {
    const vault = (tx.kvault as string) ?? "";
    if (!vault) continue;

    if (!vaultTokenInfo[vault]) {
      const mint = (tx.tokenMint as string) ?? "";
      vaultTokenInfo[vault] = {
        token_mint: mint,
        token_symbol:
          (tx.tokenSymbol as string) ?? KNOWN_TOKEN_MINTS[mint] ?? null,
        share_price: safeFloat(tx.sharePrice),
        token_price: safeFloat(tx.tokenPrice),
      };
    }

    const ts = parseTimestamp(tx.createdOn);
    if (ts) {
      if (!firstSeenTs[vault] || ts < firstSeenTs[vault])
        firstSeenTs[vault] = ts;
      if (
        ((tx.instruction as string) ?? "").toLowerCase().includes("deposit")
      ) {
        if (!firstDepositTs[vault] || ts < firstDepositTs[vault])
          firstDepositTs[vault] = ts;
      }
    }
  }

  const results: PositionDict[] = [];

  for (const [vaultAddress, tokenInfo] of Object.entries(vaultTokenInfo)) {
    // Fetch shares
    const posData = await kGet(
      `/kvaults/users/${wallet}/positions/${vaultAddress}`,
    );
    if (!posData || typeof posData !== "object") continue;
    const pd = posData as Record<string, unknown>;
    const totalShares = safeFloat(pd.totalShares);
    if (!totalShares || totalShares <= 0) continue;

    const stakedShares = safeFloat(pd.stakedShares);
    const unstakedShares = safeFloat(pd.unstakedShares);

    // Fetch metrics for USD value
    const startTs = Math.floor((now.getTime() - 86_400_000) / 1000);
    const endTs = Math.floor(now.getTime() / 1000);
    const metricsData = await kGet(
      `/kvaults/users/${wallet}/vaults/${vaultAddress}/metrics/history?start=${startTs}&end=${endTs}`,
    );

    let depositAmountUsd: number | null = null;
    let depositAmount: number | null = null;

    if (Array.isArray(metricsData) && metricsData.length > 0) {
      const last = metricsData[metricsData.length - 1] as Record<
        string,
        unknown
      >;
      depositAmountUsd = safeFloat(last.totalValueUsd ?? last.totalValue);
      depositAmount = safeFloat(last.tokenAmount);
    }

    if (depositAmountUsd === null) {
      const sharePrice = safeFloat(tokenInfo.share_price);
      const tokenPrice = safeFloat(tokenInfo.token_price);
      if (sharePrice && tokenPrice && totalShares) {
        depositAmount = totalShares * sharePrice;
        depositAmountUsd = depositAmount * tokenPrice;
      }
    }

    // Fetch PnL
    const pnlData = await kGet(
      `/kvaults/${vaultAddress}/users/${wallet}/pnl`,
    );
    let pnlUsd: number | null = null;
    let pnlPct: number | null = null;
    let costBasisUsd: number | null = null;

    if (pnlData && typeof pnlData === "object") {
      const p = pnlData as Record<string, unknown>;
      const totalPnl = p.totalPnl as Record<string, unknown> | undefined;
      pnlUsd = totalPnl
        ? safeFloat(totalPnl.usd)
        : safeFloat(p.pnlUsd);
      const totalCostBasis = p.totalCostBasis as
        | Record<string, unknown>
        | undefined;
      costBasisUsd = totalCostBasis
        ? safeFloat(totalCostBasis.usd)
        : safeFloat(p.costBasisUsd);
      if (costBasisUsd && costBasisUsd > 0 && pnlUsd !== null) {
        pnlPct = (pnlUsd / costBasisUsd) * 100;
      }
    }

    if (pnlUsd === null) {
      logger.info(
        { wallet: wallet.slice(0, 8), vault: vaultAddress.slice(0, 8), hasResponse: !!pnlData },
        "Kamino earn vault: PnL null after parsing",
      );
    }

    const entry = oppMap[vaultAddress];
    const openedAt =
      firstDepositTs[vaultAddress] ?? firstSeenTs[vaultAddress] ?? null;

    results.push(
      buildPositionDict({
        wallet_address: wallet,
        protocol_slug: "kamino",
        product_type: "earn_vault",
        external_id: vaultAddress,
        snapshot_at: now,
        opportunity_id: entry?.id ?? null,
        deposit_amount: depositAmount,
        deposit_amount_usd: depositAmountUsd,
        pnl_usd: pnlUsd,
        pnl_pct: pnlPct,
        initial_deposit_usd: costBasisUsd,
        opened_at: openedAt,
        held_days: computeHeldDays(openedAt, now),
        apy: entry?.apy_current ?? null,
        token_symbol: (tokenInfo.token_symbol as string) ?? null,
        underlying_tokens: tokenInfo.token_symbol ? [{
          symbol: tokenInfo.token_symbol as string,
          mint: (tokenInfo.token_mint as string) ?? null,
          role: "underlying",
          type: classifyToken(tokenInfo.token_symbol as string) === "stable" ? "stablecoin" : classifyToken(tokenInfo.token_symbol as string),
        } as UnderlyingToken] : null,
        extra_data: {
          shares: totalShares,
          staked_shares: stakedShares,
          unstaked_shares: unstakedShares,
          cost_basis_usd: costBasisUsd,
          token_mint: tokenInfo.token_mint,
          token_symbol: tokenInfo.token_symbol,
        },
      }),
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Obligation positions (lending + multiply)
// ---------------------------------------------------------------------------

function resolveForwardApy(
  productType: string,
  marketPk: string,
  collateralReserves: string[],
  borrowReserves: string[],
  leverage: number | null,
  reserveMap: Record<string, Record<string, unknown>>,
  oppMap: Record<string, OpportunityMapEntry>,
): number | null {
  let forwardApy: number | null = null;

  if (
    productType === "multiply" &&
    collateralReserves.length > 0 &&
    borrowReserves.length > 0
  ) {
    const mulExtId = `kmul-${marketPk.slice(0, 8)}-${collateralReserves[0].slice(0, 6)}-${borrowReserves[0].slice(0, 6)}`;
    forwardApy = oppMap[mulExtId]?.apy_current ?? null;
  }
  if (forwardApy === null && collateralReserves.length > 0) {
    forwardApy = oppMap[collateralReserves[0]]?.apy_current ?? null;
  }
  if (
    forwardApy === null &&
    collateralReserves.length > 0 &&
    productType === "lending"
  ) {
    const supplyApy = safeFloat(
      reserveMap[collateralReserves[0]]?.supply_apy,
    );
    if (supplyApy !== null) forwardApy = supplyApy * 100;
  }
  if (
    forwardApy === null &&
    productType === "multiply" &&
    collateralReserves.length > 0 &&
    borrowReserves.length > 0 &&
    leverage &&
    leverage > 1
  ) {
    const collSupply = safeFloat(
      reserveMap[collateralReserves[0]]?.supply_apy,
    );
    const debtBorrow = safeFloat(
      reserveMap[borrowReserves[0]]?.borrow_apy,
    );
    if (collSupply !== null && debtBorrow !== null) {
      forwardApy =
        (collSupply * leverage - debtBorrow * (leverage - 1)) * 100;
    }
  }

  return forwardApy;
}

async function fetchObligationPositions(
  wallet: string,
  now: Date,
  allMarkets: Record<string, unknown>[] | null,
  oppMap: Record<string, OpportunityMapEntry>,
): Promise<{ positions: PositionDict[]; events: EventDict[] }> {
  if (!allMarkets) allMarkets = await getAllMarkets();
  const results: PositionDict[] = [];
  const allObligationEvents: EventDict[] = [];
  const earliestSnapshots = await batchEarliestSnapshots(db, wallet);

  const ZERO_PK = "11111111111111111111111111111111";

  for (const marketInfo of allMarkets) {
    const marketPk = marketInfo.lendingMarket as string;
    const marketName =
      (marketInfo.marketName as string) ??
      (marketInfo.name as string) ??
      "";

    const obligationsRaw = await kGet(
      `/kamino-market/${marketPk}/users/${wallet}/obligations`,
    );
    if (!Array.isArray(obligationsRaw) || obligationsRaw.length === 0)
      continue;

    const reserveMap = await buildReserveMap(marketPk);
    const obligationTxs = await fetchObligationTransactions(
      marketPk,
      wallet,
    );

    for (const obligation of obligationsRaw as Record<string, unknown>[]) {
      const obligationAddress =
        (obligation.obligationAddress as string) ?? "";

      const stats =
        (obligation.refreshedStats as Record<string, unknown>) ?? {};
      const netValue = safeFloat(stats.netAccountValue);
      const leverage = safeFloat(stats.leverage);
      const ltv = safeFloat(stats.loanToValue);
      const totalDeposit = safeFloat(stats.userTotalDeposit);
      const totalBorrow = safeFloat(stats.userTotalBorrow);
      const liqLtv = safeFloat(stats.liquidationLtv);
      const healthFactor =
        ltv && liqLtv && ltv > 0 ? liqLtv / ltv : null;

      const humanTag = (
        (obligation.humanTag as string) ?? ""
      ).toLowerCase();
      const productType =
        humanTag === "multiply" ? "multiply" : "lending";

      // Extract collateral/debt reserves
      const stateDeposits =
        ((obligation.state as Record<string, unknown>)
          ?.deposits as Record<string, unknown>[]) ?? [];
      const stateBorrows =
        ((obligation.state as Record<string, unknown>)
          ?.borrows as Record<string, unknown>[]) ?? [];

      const collateralReserves = stateDeposits
        .filter(
          (d) =>
            d.depositReserve &&
            d.depositReserve !== ZERO_PK &&
            parseInt(String(d.depositedAmount ?? "0"), 10) > 0,
        )
        .map((d) => d.depositReserve as string);

      const borrowReserves = stateBorrows
        .filter(
          (b) =>
            b.borrowReserve &&
            b.borrowReserve !== ZERO_PK &&
            (b.borrowedAmountSf ?? "0") !== "0",
        )
        .map((b) => b.borrowReserve as string);

      const collateralInfo = collateralReserves.map((r) => ({
        reserve: r,
        symbol: (reserveMap[r]?.symbol as string) ?? "",
        mint: (reserveMap[r]?.mint as string) ?? "",
      }));
      const debtInfo = borrowReserves.map((r) => ({
        reserve: r,
        symbol: (reserveMap[r]?.symbol as string) ?? "",
        mint: (reserveMap[r]?.mint as string) ?? "",
      }));

      let opportunityId: number | null = null;
      if (
        productType === "multiply" &&
        collateralReserves.length > 0 &&
        borrowReserves.length > 0
      ) {
        const mulExtId = `kmul-${marketPk.slice(0, 8)}-${collateralReserves[0].slice(0, 6)}-${borrowReserves[0].slice(0, 6)}`;
        opportunityId = oppMap[mulExtId]?.id ?? null;
      }
      if (
        opportunityId === null &&
        productType === "lending" &&
        collateralReserves.length > 0
      ) {
        const lendExtId = `klend-${marketPk.slice(0, 8)}-${collateralReserves[0].slice(0, 8)}`;
        opportunityId = oppMap[lendExtId]?.id ?? null;
      }
      if (opportunityId === null && collateralReserves.length > 0) {
        opportunityId = oppMap[collateralReserves[0]]?.id ?? null;
      }

      // PnL from tx history
      const txsForObligation =
        obligationTxs[obligationAddress] ?? [];
      const currentNet = netValue ?? 0;

      let pnlData: DietzResult | null = null;
      if (txsForObligation.length > 0) {
        pnlData = computeObligationPnl(
          txsForObligation,
          currentNet,
          now,
        );
        allObligationEvents.push(
          ...obligationTxsToEvents(
            txsForObligation,
            wallet,
            obligationAddress,
            productType,
          ),
        );
      } else {
        logger.info(
          { wallet: wallet.slice(0, 8), obligation: obligationAddress.slice(0, 8), productType },
          "No tx history for obligation — PnL will be null",
        );
      }

      let pnlUsd = pnlData?.pnlUsd ?? null;
      let pnlPct = pnlData?.pnlPct ?? null;
      let initialDepositUsd = pnlData?.initialDepositUsd ?? null;
      let openedAt: Date | null = pnlData?.openedAt ?? earliestSnapshots[obligationAddress] ?? null;
      let heldDays = pnlData?.heldDays ?? computeHeldDays(openedAt, now);
      const isClosed = pnlData?.isClosed ?? false;
      const closedAt = pnlData?.closedAt ?? null;
      const closeValueUsd = pnlData?.closeValueUsd ?? null;
      let tokenSymbol = pnlData?.tokenSymbol ?? null;

      // Detect recycled obligations
      const currentCollateralSym =
        collateralInfo.length > 0 ? collateralInfo[0].symbol : null;
      const txTokenSym = pnlData?.tokenSymbol ?? null;
      const isRecycled =
        !isClosed &&
        productType !== "multiply" &&
        currentCollateralSym &&
        txTokenSym &&
        currentCollateralSym !== txTokenSym;

      if (isRecycled) {
        logger.info(
          {
            obligation: obligationAddress.slice(0, 16),
            txToken: txTokenSym,
            current: currentCollateralSym,
          },
          "Recycled obligation — resetting PnL",
        );
        pnlUsd = 0;
        pnlPct = 0;
        initialDepositUsd = netValue;
        openedAt = null;
        heldDays = null;
      }

      const apy = resolveForwardApy(
        productType,
        marketPk,
        collateralReserves,
        borrowReserves,
        leverage,
        reserveMap,
        oppMap,
      );

      if (currentCollateralSym) tokenSymbol = currentCollateralSym;
      else if (!tokenSymbol && collateralInfo.length > 0)
        tokenSymbol = collateralInfo[0].symbol;

      // Skip no-value positions unless closed
      if ((!netValue || netValue <= 0) && !isClosed) continue;

      results.push(
        buildPositionDict({
          wallet_address: wallet,
          protocol_slug: "kamino",
          product_type: productType,
          external_id: obligationAddress,
          snapshot_at: now,
          opportunity_id: opportunityId,
          deposit_amount: productType === "multiply" ? netValue : totalDeposit,
          deposit_amount_usd: !isClosed ? netValue : 0,
          pnl_usd: pnlUsd,
          pnl_pct: pnlPct,
          initial_deposit_usd: initialDepositUsd,
          opened_at: openedAt,
          held_days: heldDays,
          apy,
          is_closed: isClosed,
          closed_at: closedAt,
          close_value_usd: closeValueUsd,
          token_symbol: tokenSymbol,
          underlying_tokens: productType === "multiply" && collateralInfo.length > 0 && debtInfo.length > 0
            ? [
                { symbol: collateralInfo[0].symbol, mint: collateralInfo[0].mint ?? null, role: "collateral", type: classifyToken(collateralInfo[0].symbol) === "stable" ? "stablecoin" : classifyToken(collateralInfo[0].symbol) } as UnderlyingToken,
                { symbol: debtInfo[0].symbol, mint: debtInfo[0].mint ?? null, role: "debt", type: classifyToken(debtInfo[0].symbol) === "stable" ? "stablecoin" : classifyToken(debtInfo[0].symbol) } as UnderlyingToken,
              ]
            : collateralInfo.length > 0
              ? [{ symbol: collateralInfo[0].symbol, mint: collateralInfo[0].mint ?? null, role: "underlying", type: classifyToken(collateralInfo[0].symbol) === "stable" ? "stablecoin" : classifyToken(collateralInfo[0].symbol) } as UnderlyingToken]
              : null,
          extra_data: {
            obligation_address: obligationAddress,
            human_tag: obligation.humanTag,
            obligation_tag: obligation.obligationTag,
            market: marketPk,
            market_name: marketName,
            collateral: collateralInfo,
            debt: debtInfo,
            total_deposit_usd: totalDeposit,
            total_borrow_usd: totalBorrow,
            net_value_usd: netValue,
            leverage,
            ltv,
            liquidation_ltv: liqLtv,
            health_factor: healthFactor,
            borrow_limit: safeFloat(stats.borrowLimit),
            borrow_utilization: safeFloat(stats.borrowUtilization),
            forward_apy:
              apy !== null ? Math.round(apy * 10000) / 10000 : null,
          },
        }),
      );
    }
  }

  return { positions: results, events: allObligationEvents };
}

// ---------------------------------------------------------------------------
// Earn vault events
// ---------------------------------------------------------------------------

async function fetchVaultEvents(wallet: string): Promise<EventDict[]> {
  const txsRaw = await kGet(`/kvaults/users/${wallet}/transactions`);
  if (!Array.isArray(txsRaw)) return [];

  return (txsRaw as Record<string, unknown>[]).map((tx) => ({
    wallet_address: wallet,
    protocol_slug: "kamino",
    product_type: "earn_vault",
    external_id: (tx.kvault as string) ?? "",
    event_type: ((tx.instruction as string) ?? "unknown").toLowerCase(),
    amount: safeFloat(tx.tokenAmount),
    amount_usd: safeFloat(tx.usdValue),
    tx_signature: (tx.transaction as string) ?? null,
    event_at: parseTimestamp(tx.createdOn) ?? new Date(),
    extra_data: {
      token_mint: tx.tokenMint,
      token_symbol: tx.tokenSymbol,
      shares: safeFloat(tx.numberOfShares),
      token_price: safeFloat(tx.tokenPrice),
      sol_price: safeFloat(tx.solPrice),
      share_price: safeFloat(tx.sharePrice),
    },
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function fetchWalletPositions(
  walletAddress: string,
): Promise<{
  wallet: string;
  positions: PositionDict[];
  summary: { total_value_usd: number; total_pnl_usd: number; position_count: number };
}> {
  const now = new Date();
  const oppMap = await loadOpportunityMap(discoverService);

  const earnPositions = await fetchEarnPositions(walletAddress, now, oppMap);
  const { positions: obligationPositions } =
    await fetchObligationPositions(walletAddress, now, null, oppMap);

  const allPositions = [...earnPositions, ...obligationPositions];
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

  if (wallets.length === 0) {
    logger.info("No tracked wallets for Kamino snapshot");
    return 0;
  }

  logger.info(
    { count: wallets.length },
    "Snapshotting Kamino positions",
  );
  const now = snapshotAt ?? new Date();
  let totalSnapshots = 0;
  const oppMap = await loadOpportunityMap(discoverService);
  const allMarkets = await getAllMarkets();

  for (const wallet of wallets) {
    try {
      const earnPositions = await fetchEarnPositions(
        wallet.wallet_address,
        now,
        oppMap,
      );
      const { positions: obligationPositions, events: obligationEvents } =
        await fetchObligationPositions(
          wallet.wallet_address,
          now,
          allMarkets,
          oppMap,
        );

      // Detect closed positions: DB says open but not in fresh fetch
      // Covers all Kamino types: earn vaults, lending, and multiply
      const freshExternalIds = new Set(
        [...earnPositions, ...obligationPositions].map((p) => p.external_id),
      );
      const dbOpenKamino = await database
        .select({ id: userPositions.id, external_id: userPositions.external_id, product_type: userPositions.product_type })
        .from(userPositions)
        .where(
          and(
            eq(userPositions.wallet_address, wallet.wallet_address),
            eq(userPositions.protocol_slug, "kamino"),
            eq(userPositions.is_closed, false),
          ),
        );

      const closedPositions: PositionDict[] = [];
      for (const dbPos of dbOpenKamino) {
        if (!freshExternalIds.has(dbPos.external_id)) {
          closedPositions.push(
            buildPositionDict({
              wallet_address: wallet.wallet_address,
              protocol_slug: "kamino",
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
          "Detected closed Kamino positions",
        );
      }

      const allPositions = [...earnPositions, ...obligationPositions, ...closedPositions];
      totalSnapshots += await storePositionRows(
        database,
        allPositions,
        now,
      );

      // Store events
      const vaultEvents = await fetchVaultEvents(wallet.wallet_address);
      await storeEventsBatch(database, [
        ...vaultEvents,
        ...obligationEvents,
      ]);

      await database
        .update(trackedWallets)
        .set({ last_fetched_at: now })
        .where(eq(trackedWallets.id, wallet.id));

      logger.info(
        {
          wallet: wallet.wallet_address.slice(0, 8),
          count: allPositions.length,
        },
        "Kamino wallet snapshotted",
      );
    } catch (err) {
      logger.error(
        { err, wallet: wallet.wallet_address.slice(0, 8) },
        "Failed to snapshot Kamino wallet",
      );
    }
  }

  logger.info({ totalSnapshots }, "Kamino position snapshot complete");
  return totalSnapshots;
}
