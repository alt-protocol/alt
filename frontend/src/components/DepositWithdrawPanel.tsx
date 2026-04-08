"use client";

import { useState, useEffect } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import type { YieldOpportunityDetail } from "@/lib/api";
import { api } from "@/lib/api";
import { deserializeBuildResponse } from "@/lib/instruction-deserializer";
import { fmtNum, fmtUsd, fmtPct, pnlColor } from "@/lib/format";
import { useTokenBalance } from "@/lib/hooks/useTokenBalance";
import { usePositionBalance } from "@/lib/hooks/usePositionBalance";
import { useWithdrawState } from "@/lib/hooks/useWithdrawState";
import { useTransaction } from "@/lib/hooks/useTransaction";
import { usePositionForOpportunity } from "@/lib/hooks/usePositionForOpportunity";
import { useInvalidateAfterTransaction } from "@/lib/hooks/useInvalidateAfterTransaction";
import WalletButton from "./WalletButton";
import DriftMaintenanceBanner from "./DriftMaintenanceBanner";

type Tab = "deposit" | "withdraw";

function BalanceRow({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={`flex justify-between items-center ${className ?? "mb-4"}`}>
      <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">
        {label}
      </span>
      <span className="font-sans text-[0.8rem] tabular-nums">{value}</span>
    </div>
  );
}

interface Props {
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
}

interface ConnectedProps {
  selectedAccount: UiWalletAccount;
  tab: Tab;
  amount: string;
  setAmount: (v: string) => void;
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
}

function ConnectedDepositWithdrawPanel({ selectedAccount, tab, amount, setAmount, yield_, protocolSlug }: ConnectedProps) {
  const signer = useWalletAccountTransactionSendingSigner(selectedAccount, "solana:mainnet");

  const invalidateAfterTx = useInvalidateAfterTransaction();
  const primaryToken = yield_.tokens[0] ?? "USDC";
  const { data: balance } = useTokenBalance(selectedAccount.address, primaryToken);
  const { data: vaultBalance, isLoading: vaultBalanceLoading } = usePositionBalance(
    selectedAccount.address,
    tab === "withdraw" ? yield_.id : undefined,
  );
  const { position, isLoading: positionLoading } = usePositionForOpportunity(
    selectedAccount.address,
    yield_.id,
  );
  const { data: withdrawState } = useWithdrawState(
    selectedAccount.address,
    tab === "withdraw" ? yield_.id : undefined,
  );

  const { execute, status, error, txSignature, reset } = useTransaction(signer);
  const [isSettling, setIsSettling] = useState(false);

  // On-chain balance is the sole source of truth — no fallback to stale monitor data
  const withdrawBalance = vaultBalance ?? null;
  const withdrawLoading = vaultBalanceLoading;

  // Reset transaction state when tab changes
  useEffect(() => { reset(); }, [tab, reset]);

  const effectiveBalance = tab === "deposit" ? (balance ?? null) : (withdrawBalance != null && withdrawBalance > 0 ? withdrawBalance : null);
  const numAmount = parseFloat(amount) || 0;
  const meetsMinimum = tab === "withdraw" || !yield_.min_deposit || numAmount >= yield_.min_deposit;
  const isRedeemable = withdrawState?.status === "redeemable";
  const isPendingWithdraw = withdrawState?.status === "pending";
  const isValid = isRedeemable || (numAmount > 0 && (effectiveBalance == null || numAmount <= effectiveBalance) && meetsMinimum);
  const isBusy = status === "building" || status === "signing" || status === "confirming";

  function handleAmountChange(value: string) {
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value);
    }
  }

  function handleHalf() {
    if (effectiveBalance != null) setAmount((effectiveBalance / 2).toString());
  }

  function handleMax() {
    if (effectiveBalance != null) setAmount(effectiveBalance.toString());
  }

  async function handleSubmit() {
    if (!yield_.deposit_address || isSettling) return;

    reset();

    const effectiveAmount = (tab === "withdraw" && isRedeemable && withdrawState?.requestedAmount)
      ? withdrawState.requestedAmount.toString()
      : amount;

    const success = await execute(async () => {
      const params = {
        opportunity_id: yield_.id,
        wallet_address: selectedAccount.address,
        amount: effectiveAmount,
      };

      const response = tab === "deposit"
        ? await api.buildDeposit(params)
        : await api.buildWithdraw(params);

      return deserializeBuildResponse(response);
    });

    if (!success) return;

    setIsSettling(true);
    setAmount("");
    await invalidateAfterTx({
      walletAddress: selectedAccount.address,
      tokenSymbol: primaryToken,
      opportunityId: yield_.id,
      vaultAddress: yield_.deposit_address ?? undefined,
    });
    setIsSettling(false);
    api.trackWallet(selectedAccount.address);
  }

  const statusLabel =
    status === "building"
      ? "Building transaction..."
      : status === "signing"
        ? "Approve in wallet..."
        : status === "confirming"
          ? "Confirming..."
          : null;

  return (
    <>
      {/* Balance display */}
      {tab === "deposit" && balance != null && (
        <BalanceRow
          label="Available"
          value={<>{fmtNum(balance, 6)} {primaryToken}</>}
        />
      )}

      {tab === "withdraw" && withdrawLoading && (
        <div className="flex justify-between items-center mb-4 animate-pulse">
          <span className="h-3 w-16 bg-surface-high rounded-sm" />
          <span className="h-3 w-24 bg-surface-high rounded-sm" />
        </div>
      )}

      {tab === "withdraw" && !withdrawLoading && withdrawBalance != null && withdrawBalance > 0 && (
        <>
          <BalanceRow
            label="Deposited"
            className={position?.pnl_usd != null ? "mb-2" : "mb-4"}
            value={<>{fmtNum(withdrawBalance, 6)} {primaryToken}</>}
          />
          {position?.pnl_usd != null && (
            <BalanceRow
              label="PnL"
              value={
                <span className={pnlColor(position.pnl_usd)}>
                  {fmtUsd(position.pnl_usd)} ({fmtPct(position.pnl_pct)})
                </span>
              }
            />
          )}
        </>
      )}

      {tab === "withdraw" && !withdrawLoading && (withdrawBalance == null || withdrawBalance <= 0) && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <p className="text-foreground-muted font-sans text-[0.75rem]">
            No active position
          </p>
          <p className="text-foreground-muted/60 font-sans text-[0.65rem]">
            Deposit first to withdraw later
          </p>
        </div>
      )}

      {tab === "withdraw" && withdrawState?.requestedAmount != null && withdrawState.requestedAmount > 0 && (
        <BalanceRow
          label="Requested"
          className="mb-3"
          value={<>{fmtNum(withdrawState.requestedAmount, 6)} {primaryToken}</>}
        />
      )}

      {tab === "withdraw" && withdrawState?.message && (
        <div className={`rounded-sm px-3 py-2 mb-3 text-[0.7rem] font-sans ${
          isPendingWithdraw
            ? "bg-yellow-500/10 text-yellow-400"
            : "bg-neon/10 text-neon"
        }`}>
          {withdrawState.message}
        </div>
      )}

      {/* Amount input + actions (hidden when withdraw has no balance or redeemable) */}
      {(tab === "deposit" || (withdrawBalance != null && withdrawBalance > 0 && !isRedeemable && !isPendingWithdraw)) && (
        <>
          <div className="bg-surface-high rounded-sm px-4 py-3 mb-2 focus-within:shadow-[0_2px_0_0_var(--neon-primary)] transition-shadow">
            <div className="flex items-center justify-between mb-1">
              <span className="text-foreground-muted text-[0.65rem] font-sans uppercase tracking-[0.05em]">
                {primaryToken}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleHalf}
                  className="text-neon text-[0.65rem] font-sans uppercase tracking-[0.05em] hover:opacity-80"
                >
                  Half
                </button>
                <button
                  onClick={handleMax}
                  className="text-neon text-[0.65rem] font-sans uppercase tracking-[0.05em] hover:opacity-80"
                >
                  Max
                </button>
              </div>
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

          {/* Validation */}
          {numAmount > 0 && effectiveBalance != null && numAmount > effectiveBalance && (
            <p className="text-red-400 text-[0.65rem] font-sans mb-2">
              {tab === "deposit" ? `Insufficient ${primaryToken} balance` : "Exceeds deposited amount"}
            </p>
          )}
          {tab === "deposit" && numAmount > 0 && !meetsMinimum && (
            <p className="text-red-400 text-[0.65rem] font-sans mb-2">
              Minimum deposit: ${yield_.min_deposit}
            </p>
          )}
        </>
      )}

      {/* Submit button — shown for deposit, withdraw with balance, or redeemable state */}
      {(tab === "deposit" || (withdrawBalance != null && withdrawBalance > 0) || isRedeemable) && (
        <>
          <button
            onClick={handleSubmit}
            disabled={!isValid || isBusy || isPendingWithdraw || isSettling || protocolSlug === "drift"}
            className="bg-neon text-on-neon rounded-sm px-6 py-3 text-sm font-semibold font-sans w-full mt-3 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSettling
              ? "Updating balance..."
              : isBusy
              ? statusLabel
              : isPendingWithdraw
                ? "Withdrawal Pending"
                : tab === "deposit"
                  ? `Deposit ${primaryToken}`
                  : isRedeemable
                    ? `Complete Withdraw ${primaryToken}`
                    : withdrawState != null
                      ? `Request Withdraw ${primaryToken}`
                      : `Withdraw ${primaryToken}`}
          </button>

          {/* Status feedback */}
          {status === "success" && txSignature && (
            <div className="mt-3 text-center">
              <p className="text-neon text-[0.75rem] font-sans mb-1">Transaction confirmed</p>
              <a
                href={`https://solscan.io/tx/${txSignature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground-muted text-[0.65rem] font-sans hover:text-foreground underline"
              >
                View on Solscan
              </a>
            </div>
          )}

          {status === "error" && error && (
            <p className="mt-3 text-red-400 text-[0.7rem] font-sans text-center">
              {error}
            </p>
          )}
        </>
      )}

      <p className="text-foreground-muted text-[0.6rem] font-sans mt-4 text-center">
        Non-custodial · Your keys only
      </p>
    </>
  );
}

export default function DepositWithdrawPanel({ yield_, protocolSlug }: Props) {
  const [tab, setTab] = useState<Tab>("deposit");
  const [amount, setAmount] = useState("");
  const [selectedAccount] = useSelectedWalletAccount();

  return (
    <div className="flex-[1] bg-surface-low px-6 py-5 flex flex-col">
      {/* Tab switcher */}
      <div className="flex gap-[1px] mb-5">
        {(["deposit", "withdraw"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setAmount(""); }}
            className={`flex-1 py-2 text-[0.7rem] font-sans uppercase tracking-[0.05em] rounded-sm transition-colors ${
              tab === t
                ? "bg-neon text-on-neon"
                : "bg-surface-high text-foreground-muted hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {protocolSlug === "drift" && <DriftMaintenanceBanner />}

      {!selectedAccount ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-foreground-muted font-sans text-[0.75rem]">
            Connect your wallet to {tab}
          </p>
          <WalletButton variant="cta" />
        </div>
      ) : (
        <ConnectedDepositWithdrawPanel
          selectedAccount={selectedAccount}
          tab={tab}
          amount={amount}
          setAmount={setAmount}
          yield_={yield_}
          protocolSlug={protocolSlug}
        />
      )}
    </div>
  );
}
