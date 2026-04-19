"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import type { YieldOpportunityDetail } from "@/lib/api";
import { api } from "@/lib/api";
import { deserializeBuildResponse } from "@/lib/instruction-deserializer";
import Link from "next/link";
import { fmtApy, fmtUsd, fmtPct, fmtNum, pnlColor } from "@/lib/format";
import { TOKEN_MINTS } from "@/lib/constants";
import { useTokenBalance } from "@/lib/hooks/useTokenBalance";
import { usePositionBalance } from "@/lib/hooks/usePositionBalance";
import { useTransaction } from "@/lib/hooks/useTransaction";
import { usePositionForOpportunity } from "@/lib/hooks/usePositionForOpportunity";
import { useInvalidateAfterTransaction } from "@/lib/hooks/useInvalidateAfterTransaction";
import { useOptimisticBalanceUpdate } from "@/lib/hooks/useOptimisticBalanceUpdate";
import type { TxOperation } from "@/lib/hooks/useOptimisticBalanceUpdate";
import { useSlippage } from "@/lib/hooks/useSlippage";
import DriftMaintenanceBanner from "./DriftMaintenanceBanner";
import type { LeverageEntry } from "@/lib/multiply-utils";
import { parseLeverageTable, interpolateApy, getMultiplyStatusLabel } from "@/lib/multiply-utils";
import WalletButton from "./WalletButton";

type Tab = "open" | "deposit" | "adjust" | "collateral" | "debt" | "withdraw" | "close";
type SubAction = "add" | "withdraw" | "borrow" | "repay";

interface Props {
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
}

function PositionInfo({
  position, positionLoading, closeNote,
}: {
  position: { deposit_amount?: number | null; pnl_usd?: number | null; pnl_pct?: number | null } | null;
  positionLoading: boolean;
  closeNote?: boolean;
}) {
  if (!position && !positionLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2">
        <p className="text-foreground-muted font-sans text-[0.75rem]">No active position</p>
        <p className="text-foreground-muted/60 font-sans text-[0.65rem]">Open a position first</p>
      </div>
    );
  }
  if (!position) return null;
  return (
    <>
      <div className="flex justify-between items-center mb-2">
        <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Net Value</span>
        <span className="font-sans text-[0.8rem] tabular-nums">
          {fmtUsd(position.deposit_amount)}
        </span>
      </div>
      {position.pnl_usd != null && (
        <div className="flex justify-between items-center mb-4">
          <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">PnL</span>
          <span className={`font-sans text-[0.8rem] tabular-nums ${pnlColor(position.pnl_usd)}`}>
            {fmtUsd(position.pnl_usd)} ({fmtPct(position.pnl_pct)})
          </span>
        </div>
      )}
      {closeNote && (
        <p className="text-foreground-muted font-sans text-[0.65rem] mb-4">
          This will repay all debt, unwind the position, and withdraw your collateral.
        </p>
      )}
    </>
  );
}

interface ConnectedProps {
  selectedAccount: UiWalletAccount;
  tab: Tab;
  amount: string;
  setAmount: (v: string) => void;
  leverage: number;
  setLeverage: (v: number) => void;
  editingSlippage: boolean;
  setEditingSlippage: (v: boolean) => void;
  subAction: SubAction;
  setSubAction: (v: SubAction) => void;
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
  leverageEntries: LeverageEntry[];
  minLev: number;
  maxLev: number;
}

function ConnectedMultiplyPanel({
  selectedAccount, tab, amount, setAmount, leverage, setLeverage,
  editingSlippage, setEditingSlippage, subAction, setSubAction, yield_, protocolSlug,
  leverageEntries, minLev, maxLev,
}: ConnectedProps) {
  const extra = yield_.extra_data;
  const signer = useWalletAccountTransactionSendingSigner(selectedAccount, "solana:mainnet");

  const invalidateAfterTx = useInvalidateAfterTransaction();
  const applyOptimistic = useOptimisticBalanceUpdate();
  const { slippageBps, setSlippage } = useSlippage();
  const collSymbol = (extra?.collateral_symbol as string) ?? yield_.tokens[0] ?? "SOL";
  const debtSymbol = (extra?.debt_symbol as string) ?? "USDC";
  const borrowApy = extra?.borrow_apy_current_pct as number | null;
  const supplyApy = extra?.collateral_yield_current_pct as number | null;
  const collMint = yield_.underlying_tokens?.find((t) => t.role === "collateral")?.mint ?? undefined;
  const debtMint = yield_.underlying_tokens?.find((t) => t.role === "debt")?.mint ?? undefined;
  const { data: balance } = useTokenBalance(selectedAccount.address, collMint);
  const { data: debtBalance } = useTokenBalance(selectedAccount.address, tab === "debt" ? debtMint : undefined);
  const { data: vaultBalance, isLoading: vaultBalanceLoading } = usePositionBalance(
    selectedAccount.address,
    tab !== "open" ? yield_.id : undefined,
  );
  const { position, isLoading: positionLoading } = usePositionForOpportunity(
    selectedAccount.address,
    yield_.id,
  );

  // On-chain position stats (leverage, LTV, deposits, borrows — real-time)
  const { data: onChainStats } = useQuery({
    queryKey: ["positionStats", selectedAccount.address, yield_.id],
    queryFn: () => api.getPositionStats({ opportunity_id: yield_.id, wallet_address: selectedAccount.address }),
    enabled: !!selectedAccount.address && tab !== "open",
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // On-chain balance is source of truth for position existence
  const hasActivePosition = (onChainStats?.balance ?? vaultBalance ?? 0) > 0;

  const { execute, status, error, txSignature, reset } = useTransaction(signer);

  // Reset transaction state when tab changes
  useEffect(() => { reset(); }, [tab, reset]);

  const projectedApy = useMemo(() => interpolateApy(leverageEntries, leverage), [leverageEntries, leverage]);
  const numAmount = parseFloat(amount) || 0;
  const needsAmount = tab === "open" || tab === "deposit" || tab === "collateral" || tab === "debt" || tab === "withdraw";
  const activeBalance = tab === "debt" ? debtBalance : balance;
  const showWalletControls = tab === "open" || tab === "deposit"
    || (tab === "collateral" && subAction === "add")
    || (tab === "debt" && subAction === "repay");
  // For withdraw tab: net position value is the available amount (not wallet balance)
  const withdrawNetValue = onChainStats?.balance ?? vaultBalance ?? 0;
  const overBalance = showWalletControls && activeBalance != null && numAmount > activeBalance;
  const isValid = tab === "close" || tab === "adjust"
    ? hasActivePosition
    : needsAmount && numAmount > 0 && !overBalance;
  const isBusy = status === "preparing" || status === "building" || status === "signing" || status === "confirming";

  const fillPct = maxLev > minLev ? ((leverage - minLev) / (maxLev - minLev)) * 100 : 0;
  // Use on-chain stats for real-time data, fall back to cached position
  const currentLeverage = onChainStats?.leverage ?? (position?.extra_data?.leverage as number | null);
  const curLtv = onChainStats?.ltv ?? (position?.extra_data?.ltv as number) ?? 0;
  const liqLtv = onChainStats?.liquidationLtv ?? (position?.extra_data?.liquidation_ltv as number) ?? 1;
  const totalDeposit = onChainStats?.totalDepositUsd ?? (position?.extra_data?.total_deposit_usd as number) ?? 0;
  const totalBorrow = onChainStats?.totalBorrowUsd ?? (position?.extra_data?.total_borrow_usd as number) ?? 0;
  const collPriceUsd = (yield_.extra_data?.collateral_price_usd as number) ?? 1;

  // Projected LTV based on entered amount
  const ltvPreview = useMemo(() => {
    if (numAmount <= 0 || (tab !== "collateral" && tab !== "debt")) return null;
    let nd = totalDeposit;
    let nb = totalBorrow;
    if (tab === "collateral") {
      const delta = numAmount * collPriceUsd;
      nd = subAction === "add" ? nd + delta : Math.max(0, nd - delta);
    } else {
      nb = subAction === "borrow" ? nb + numAmount : Math.max(0, nb - numAmount);
    }
    const projected = nd > 0.01 ? nb / nd : (nb > 0 ? 9.99 : 0);
    return {
      projected,
      increasing: projected > curLtv + 0.001,
      dangerous: projected > liqLtv,
      newDeposit: nd,
      newBorrow: nb,
    };
  }, [numAmount, tab, subAction, totalDeposit, totalBorrow, curLtv, liqLtv, collPriceUsd]);

  function handleAmountChange(value: string) {
    if (value === "" || /^\d*\.?\d*$/.test(value)) setAmount(value);
  }

  function getAction(): string | undefined {
    if (tab === "adjust") return "adjust";
    if (tab === "deposit") return undefined; // uses buildMultiplyOpen
    if (tab === "collateral") return subAction === "add" ? "add_collateral" : "withdraw_collateral";
    if (tab === "debt") return subAction === "borrow" ? "borrow_more" : "repay_debt";
    return undefined;
  }

  function isWithdrawAction(): boolean {
    return tab === "close"
      || tab === "withdraw"
      || (tab === "collateral" && subAction === "withdraw")
      || (tab === "debt" && subAction === "repay");
  }

  async function handleSubmit() {
    if (!yield_.deposit_address) return;
    reset();

    // Read position_id from stored position (for close/adjust/manage operations)
    const positionNftId = position?.extra_data?.nft_id as number | undefined;

    let txMetadata: Record<string, unknown> | undefined;

    const success = await execute(async () => {
      const action = getAction();
      const params = {
        opportunity_id: yield_.id,
        wallet_address: selectedAccount.address,
        amount: needsAmount ? amount : "0",
        extra_data: {
          leverage: tab === "deposit" ? (currentLeverage ?? leverage) : leverage,
          slippageBps,
          isClosingPosition: tab === "close",
          ...(action ? { action } : {}),
          ...(positionNftId != null ? { position_id: positionNftId } : {}),
        },
      };

      const response = isWithdrawAction()
        ? await api.buildWithdraw(params)
        : await api.buildDeposit(params);

      const result = deserializeBuildResponse(response);
      txMetadata = response.metadata;
      return result;
    });

    if (!success) return;

    const operation: TxOperation = tab === "close" ? "close"
      : isWithdrawAction() ? "withdraw"
      : "deposit";
    applyOptimistic({
      walletAddress: selectedAccount.address,
      mint: collMint,
      opportunityId: yield_.id,
      operation,
      amount: parseFloat(amount || "0"),
    });

    setAmount("");
    await invalidateAfterTx({
      walletAddress: selectedAccount.address,
      opportunityId: yield_.id,
      vaultAddress: yield_.deposit_address ?? undefined,
      mint: collMint,
      metadata: txMetadata, // nft_id from open tx, stored in position extra_data
    });
  }

  const statusLabel = getMultiplyStatusLabel(status);

  return (
    <>
      {/* Tabs with leverage slider: open, adjust */}
      {(tab === "open" || tab === "adjust") && (
        <>
          {/* Leverage slider */}
          <div className="mb-4">
            {tab === "adjust" && currentLeverage != null && (
              <div className="flex justify-between items-center mb-2">
                <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Current Leverage</span>
                <span className="font-sans text-[0.8rem] tabular-nums">{currentLeverage.toFixed(1)}x</span>
              </div>
            )}
            <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans block mb-3">{tab === "adjust" ? "Target Leverage" : "Leverage"}</span>
            <div className="relative">
              <input
                type="range"
                min={minLev}
                max={maxLev}
                step={0.1}
                value={leverage}
                onChange={(e) => setLeverage(parseFloat(e.target.value))}
                className="w-full h-2 rounded-sm appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10
                  [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
                  [&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:border-0"
                style={{
                  background: `linear-gradient(to right, var(--color-neon) 0%, var(--color-neon) ${fillPct}%, rgba(255,255,255,0.12) ${fillPct}%, rgba(255,255,255,0.12) 100%)`,
                }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-foreground-muted text-[0.65rem] font-sans">{minLev}x</span>
              <span className="text-foreground text-[0.75rem] font-sans font-medium tabular-nums">{leverage.toFixed(1)}x</span>
              <span className="text-foreground-muted text-[0.65rem] font-sans">{maxLev}x</span>
            </div>
          </div>

          {/* Projected APY + Borrow APY */}
          <div className="flex justify-between items-center mb-2">
            <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Projected APY</span>
            <span className="font-sans text-[0.8rem] text-neon tabular-nums">{projectedApy != null ? fmtApy(projectedApy) : "—"}</span>
          </div>
          {supplyApy != null && (
            <div className="flex justify-between items-center mb-2">
              <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Supply APY</span>
              <span className="font-sans text-[0.8rem] tabular-nums">{fmtApy(supplyApy)}</span>
            </div>
          )}
          {borrowApy != null && (
            <div className="flex justify-between items-center mb-4">
              <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Borrow APY</span>
              <span className="font-sans text-[0.8rem] text-foreground-muted tabular-nums">{fmtApy(borrowApy)}</span>
            </div>
          )}
          {tab === "open" && balance != null && (
            <div className="flex justify-between items-center mb-4">
              <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Available</span>
              <span className="font-sans text-[0.8rem] tabular-nums">
                {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {collSymbol}
              </span>
            </div>
          )}
          {tab === "adjust" && hasActivePosition && (
            <div className="flex justify-between items-center mb-4">
              <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Net Value</span>
              <span className="font-sans text-[0.8rem] tabular-nums">{fmtUsd(vaultBalance)}</span>
            </div>
          )}
          {tab === "open" && (() => {
            const mint = yield_.underlying_tokens?.[0]?.mint
              ?? TOKEN_MINTS[collSymbol as keyof typeof TOKEN_MINTS]
              ?? null;
            return (
              <div className="flex justify-end mb-2 -mt-2">
                <Link
                  href={mint ? `/swap?outputMint=${mint}` : "/swap"}
                  className="text-neon text-[0.65rem] font-sans hover:opacity-80"
                >
                  Get {collSymbol} &rarr;
                </Link>
              </div>
            );
          })()}
        </>
      )}

      {/* Withdraw tab — partial deleverage */}
      {tab === "withdraw" && (
        <PositionInfo
          position={hasActivePosition ? { deposit_amount: vaultBalance, pnl_usd: position?.pnl_usd, pnl_pct: position?.pnl_pct } : null}
          positionLoading={vaultBalanceLoading}
        />
      )}

      {/* Close tab — full unwind */}
      {tab === "close" && (
        <PositionInfo
          position={hasActivePosition ? { deposit_amount: vaultBalance, pnl_usd: position?.pnl_usd, pnl_pct: position?.pnl_pct } : null}
          positionLoading={vaultBalanceLoading}
          closeNote
        />
      )}

      {/* Deposit tab — show position value */}
      {tab === "deposit" && hasActivePosition && (
        <>
          <div className="flex justify-between items-center mb-2">
            <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Net Value</span>
            <span className="font-sans text-[0.8rem] tabular-nums">{fmtUsd(vaultBalance)}</span>
          </div>
          <div className="flex justify-between items-center mb-2">
            <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Current Leverage</span>
            <span className="font-sans text-[0.8rem] tabular-nums">{currentLeverage?.toFixed(1)}x</span>
          </div>
          {balance != null && (
            <div className="flex justify-between items-center mb-4">
              <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Available</span>
              <span className="font-sans text-[0.8rem] tabular-nums">{balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {collSymbol}</span>
            </div>
          )}
        </>
      )}

      {/* Collateral/Debt tabs — LTV stats + sub-action toggle */}
      {(tab === "collateral" || tab === "debt") && hasActivePosition && (
        <>
          <div className="flex justify-between items-center mb-2">
            <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Current LTV</span>
            <span className="font-sans text-[0.8rem] tabular-nums">{fmtPct(curLtv * 100)}</span>
          </div>
          <div className="flex justify-between items-center mb-2">
            <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Liquidation LTV</span>
            <span className="font-sans text-[0.8rem] tabular-nums text-foreground-muted">{fmtPct(liqLtv * 100)}</span>
          </div>
          <div className="flex justify-between items-center mb-4">
            <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">
              {tab === "collateral" ? `${collSymbol} Collateral` : `${debtSymbol} Debt`}
            </span>
            <span className="font-sans text-[0.8rem] tabular-nums">
              {fmtUsd(tab === "collateral" ? totalDeposit : totalBorrow)}
            </span>
          </div>

          {/* Sub-action toggle */}
          <div className="flex gap-[1px] mb-4">
            {tab === "collateral"
              ? (["add", "withdraw"] as const).map((a) => (
                  <button key={a} onClick={() => { setSubAction(a); setAmount(""); }}
                    className={`flex-1 py-1.5 text-[0.65rem] font-sans uppercase tracking-[0.05em] rounded-sm transition-colors ${subAction === a ? "bg-surface-high text-foreground" : "text-foreground-muted hover:text-foreground"}`}>
                    {a === "add" ? "Add Collateral" : "Withdraw"}
                  </button>
                ))
              : (["borrow", "repay"] as const).map((a) => (
                  <button key={a} onClick={() => { setSubAction(a); setAmount(""); }}
                    className={`flex-1 py-1.5 text-[0.65rem] font-sans uppercase tracking-[0.05em] rounded-sm transition-colors ${subAction === a ? "bg-surface-high text-foreground" : "text-foreground-muted hover:text-foreground"}`}>
                    {a === "borrow" ? "Borrow More" : "Repay Debt"}
                  </button>
                ))
            }
          </div>
        </>
      )}

      {/* Amount input for tabs that need it */}
      {needsAmount && (
        <div className="bg-surface-high rounded-sm px-4 py-3 mb-2 focus-within:shadow-[0_2px_0_0_var(--color-neon)] transition-shadow">
          <div className="flex items-center justify-between mb-1">
            <span className="text-foreground-muted text-[0.65rem] font-sans uppercase tracking-[0.05em]">
              {tab === "debt" ? debtSymbol : collSymbol}
            </span>
            {(showWalletControls || tab === "withdraw") && (
              <div className="flex gap-2">
                <button onClick={() => {
                  const max = tab === "withdraw" ? withdrawNetValue / collPriceUsd : activeBalance;
                  if (max != null && max > 0) setAmount((max / 2).toFixed(6));
                }} className="text-neon text-[0.65rem] font-sans uppercase tracking-[0.05em] hover:opacity-80">Half</button>
                <button onClick={() => {
                  const max = tab === "withdraw" ? withdrawNetValue / collPriceUsd : activeBalance;
                  if (max != null && max > 0) setAmount(max.toFixed(6));
                }} className="text-neon text-[0.65rem] font-sans uppercase tracking-[0.05em] hover:opacity-80">Max</button>
              </div>
            )}
          </div>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            className="w-full bg-transparent text-foreground font-display text-xl tracking-[-0.02em] outline-none placeholder:text-foreground-muted/40"
          />
        </div>
      )}

      {needsAmount && activeBalance != null && showWalletControls && (
        <div className="flex justify-between items-center mb-2">
          <span className="text-foreground-muted text-[0.6rem] font-sans uppercase tracking-[0.05em]">Wallet Balance</span>
          <span className="font-sans text-[0.8rem] tabular-nums">{fmtNum(activeBalance, 6)} {tab === "debt" ? debtSymbol : collSymbol}</span>
        </div>
      )}

      {numAmount > 0 && activeBalance != null && numAmount > activeBalance && showWalletControls && (
        <p className="text-red-400 text-[0.65rem] font-sans mb-2">Insufficient {tab === "debt" ? debtSymbol : collSymbol} balance</p>
      )}

      {/* Withdraw tab — show net position value as available */}
      {tab === "withdraw" && withdrawNetValue > 0 && (
        <div className="flex justify-between items-center mb-2">
          <span className="text-foreground-muted text-[0.6rem] font-sans uppercase tracking-[0.05em]">Available to Withdraw</span>
          <span className="font-sans text-[0.8rem] tabular-nums">{fmtUsd(withdrawNetValue)}</span>
        </div>
      )}
      {tab === "withdraw" && numAmount > 0 && numAmount * collPriceUsd > withdrawNetValue * 1.05 && (
        <p className="text-red-400 text-[0.65rem] font-sans mb-2">Amount exceeds net position value</p>
      )}

      {/* LTV change preview for collateral/debt tabs */}
      {ltvPreview && (tab === "collateral" || tab === "debt") && (
        <div className="mb-2 space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-foreground-muted text-[0.6rem] font-sans uppercase tracking-[0.05em]">LTV</span>
            <span className="font-sans text-[0.75rem] tabular-nums">
              {fmtPct(curLtv * 100)}{" "}
              <span className="text-foreground-muted">&rarr;</span>{" "}
              <span className={ltvPreview.dangerous ? "text-red-400" : ltvPreview.increasing ? "text-yellow-400" : "text-green-400"}>
                {fmtPct(ltvPreview.projected * 100)}
              </span>
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-foreground-muted text-[0.6rem] font-sans uppercase tracking-[0.05em]">
              {tab === "collateral" ? `${collSymbol} Collateral` : `${debtSymbol} Debt`}
            </span>
            <span className="font-sans text-[0.75rem] tabular-nums">
              {fmtUsd(tab === "collateral" ? totalDeposit : totalBorrow)}{" "}
              <span className="text-foreground-muted">&rarr;</span>{" "}
              {fmtUsd(tab === "collateral" ? ltvPreview.newDeposit : ltvPreview.newBorrow)}
            </span>
          </div>
          {ltvPreview.dangerous && (
            <p className="text-red-400 text-[0.65rem] font-sans">Exceeds liquidation threshold — position may be liquidated</p>
          )}
        </div>
      )}

      {/* Action button */}
      <button
        onClick={handleSubmit}
        disabled={!isValid || isBusy || protocolSlug === "drift"}
        className="bg-neon text-on-neon rounded-sm px-6 py-3 text-sm font-semibold font-sans w-full mt-3 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isBusy ? statusLabel
          : tab === "open" ? `Open ${leverage.toFixed(1)}x ${collSymbol}/${debtSymbol}`
          : tab === "deposit" ? `Deposit ${collSymbol}`
          : tab === "adjust" ? `Adjust to ${leverage.toFixed(1)}x`
          : tab === "collateral" ? (subAction === "add" ? `Add ${collSymbol}` : `Withdraw ${collSymbol}`)
          : tab === "debt" ? (subAction === "borrow" ? `Borrow ${debtSymbol}` : `Repay ${debtSymbol}`)
          : tab === "withdraw" ? `Withdraw ${collSymbol}`
          : "Close Position"}
      </button>

      {status === "success" && txSignature && (
        <div className="mt-3 text-center">
          <p className="text-neon text-[0.75rem] font-sans mb-1">Transaction confirmed</p>
          <a href={`https://solscan.io/tx/${txSignature}`} target="_blank" rel="noopener noreferrer" className="text-foreground-muted text-[0.65rem] font-sans hover:text-foreground underline">View on Solscan</a>
        </div>
      )}

      {status === "error" && error && (
        <p className="mt-3 text-red-400 text-[0.7rem] font-sans text-center">{error}</p>
      )}

      {/* Slippage Tolerance */}
      <div className="mt-4 pt-3 border-t border-outline-ghost">
        <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans block mb-2">Slippage Tolerance</span>
        <div className="flex gap-1">
          {[{ label: "0.5%", bps: 50 }, { label: "1%", bps: 100 }, { label: "2%", bps: 200 }].map((p) => (
            <button
              key={p.bps}
              onClick={() => { setSlippage(p.bps); setEditingSlippage(false); }}
              className={`rounded-sm px-3 py-1 text-[0.65rem] font-sans transition-colors ${
                slippageBps === p.bps && !editingSlippage
                  ? "bg-neon text-on-neon"
                  : "bg-surface-high text-foreground-muted hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setEditingSlippage(!editingSlippage)}
            className={`rounded-sm px-3 py-1 text-[0.65rem] font-sans transition-colors flex items-center gap-1 ${
              editingSlippage || ![50, 100, 200].includes(slippageBps)
                ? "bg-neon text-on-neon"
                : "bg-surface-high text-foreground-muted hover:text-foreground"
            }`}
          >
            {editingSlippage ? "Custom" : ![50, 100, 200].includes(slippageBps) ? `${(slippageBps / 100).toFixed(1)}%` : "Custom"}
          </button>
        </div>
        {editingSlippage && (
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            placeholder={(slippageBps / 100).toFixed(2)}
            defaultValue={(slippageBps / 100).toFixed(2)}
            onBlur={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val) && val > 0) setSlippage(Math.round(val * 100));
              setEditingSlippage(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditingSlippage(false);
            }}
            className="mt-2 w-full bg-surface-high rounded-sm px-3 py-1.5 text-[0.65rem] font-sans text-foreground outline-none focus:shadow-[0_1px_0_0_var(--color-neon)]"
          />
        )}
        {slippageBps < 10 && (
          <p className="text-yellow-400 text-[0.6rem] font-sans mt-1.5">Low — transaction may fail</p>
        )}
        {slippageBps > 300 && (
          <p className="text-yellow-400 text-[0.6rem] font-sans mt-1.5">High — may result in unfavorable execution</p>
        )}
      </div>
    </>
  );
}

export default function MultiplyPanel({ yield_, protocolSlug }: Props) {
  const extra = yield_.extra_data;
  const leverageEntries = useMemo(() => parseLeverageTable(extra), [extra]);
  const minLev = leverageEntries.length > 0 ? leverageEntries[0].value : 1.1;
  const maxLev = leverageEntries.length > 0 ? leverageEntries[leverageEntries.length - 1].value : 10;
  const defaultLev = leverageEntries.length > 0
    ? leverageEntries[Math.floor(leverageEntries.length / 2)].value
    : 3;

  const [tab, setTab] = useState<Tab>("open");
  const [amount, setAmount] = useState("");
  const [leverage, setLeverage] = useState(defaultLev);
  const [editingSlippage, setEditingSlippage] = useState(false);
  const [subAction, setSubAction] = useState<SubAction>("add");
  const [selectedAccount] = useSelectedWalletAccount();

  const tabs: Tab[] = ["open", "deposit", "adjust", "collateral", "debt", "withdraw", "close"];

  return (
    <div className="flex-[1] bg-surface-low px-6 py-5 flex flex-col">
      {/* Tab switcher */}
      <div className="flex gap-[1px] mb-5">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setAmount(""); }}
            className={`flex-1 py-2 text-[0.7rem] font-sans uppercase tracking-[0.05em] rounded-sm transition-colors ${
              tab === t ? "bg-neon text-on-neon" : "bg-surface-high text-foreground-muted hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {protocolSlug === "drift" && <DriftMaintenanceBanner />}

      {!selectedAccount ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-foreground-muted font-sans text-[0.75rem]">Connect your wallet to {tab}</p>
          <WalletButton variant="cta" />
        </div>
      ) : (
        <ConnectedMultiplyPanel
          selectedAccount={selectedAccount}
          tab={tab}
          amount={amount}
          setAmount={setAmount}
          leverage={leverage}
          setLeverage={setLeverage}
          editingSlippage={editingSlippage}
          setEditingSlippage={setEditingSlippage}
          subAction={subAction}
          setSubAction={setSubAction}
          yield_={yield_}
          protocolSlug={protocolSlug}
          leverageEntries={leverageEntries}
          minLev={minLev}
          maxLev={maxLev}
        />
      )}
    </div>
  );
}
