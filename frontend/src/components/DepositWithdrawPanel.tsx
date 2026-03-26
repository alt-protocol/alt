"use client";

import { useState } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import type { YieldOpportunityDetail } from "@/lib/api";
import { api } from "@/lib/api";
import { getAdapter } from "@/lib/protocols";
import { fmtNum, fmtUsd, fmtPct, pnlColor } from "@/lib/format";
import { useTokenBalance } from "@/lib/hooks/useTokenBalance";
import { usePositionBalance } from "@/lib/hooks/usePositionBalance";
import { useTransaction } from "@/lib/hooks/useTransaction";
import { usePositionForOpportunity } from "@/lib/hooks/usePositionForOpportunity";
import { useInvalidateAfterTransaction } from "@/lib/hooks/useInvalidateAfterTransaction";
import WalletButton from "./WalletButton";

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
    tab === "withdraw" ? protocolSlug : undefined,
    tab === "withdraw" ? yield_.deposit_address ?? undefined : undefined,
    tab === "withdraw" ? yield_.category : undefined,
    yield_.extra_data ?? undefined,
  );
  const { position } = usePositionForOpportunity(
    selectedAccount.address,
    yield_.id,
  );

  const { execute, status, error, txSignature, reset } = useTransaction(signer);

  const effectiveBalance = tab === "deposit" ? (balance ?? null) : (vaultBalance ?? null);
  const numAmount = parseFloat(amount) || 0;
  const meetsMinimum = tab === "withdraw" || !yield_.min_deposit || numAmount >= yield_.min_deposit;
  const isValid = numAmount > 0 && (effectiveBalance == null || numAmount <= effectiveBalance) && meetsMinimum;
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
    if (!yield_.deposit_address) return;

    const adapter = await getAdapter(protocolSlug);
    if (!adapter) return;

    reset();

    const success = await execute(async () => {
      const params = {
        signer: signer!,
        depositAddress: yield_.deposit_address!,
        amount,
        category: yield_.category,
        extraData: yield_.extra_data ?? undefined,
      };

      if (tab === "deposit") {
        return adapter.buildDepositTx(params);
      }
      return adapter.buildWithdrawTx(params);
    });

    if (!success) return;

    setAmount("");
    invalidateAfterTx({
      walletAddress: selectedAccount.address,
      tokenSymbol: primaryToken,
      opportunityId: yield_.id,
      vaultAddress: yield_.deposit_address ?? undefined,
      txType: tab,
      txAmount: numAmount,
    });
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

      {tab === "withdraw" && vaultBalance != null && vaultBalance > 0 && (
        <>
          <BalanceRow
            label="Deposited"
            className={position?.pnl_usd != null ? "mb-2" : "mb-4"}
            value={<>{fmtNum(vaultBalance, 6)} {primaryToken}</>}
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

      {tab === "withdraw" && (vaultBalance == null || vaultBalance <= 0) && !vaultBalanceLoading && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <p className="text-foreground-muted font-sans text-[0.75rem]">
            No active position
          </p>
          <p className="text-foreground-muted/60 font-sans text-[0.65rem]">
            Deposit first to withdraw later
          </p>
        </div>
      )}

      {/* Amount input + actions (hidden when withdraw has no balance) */}
      {(tab === "deposit" || (vaultBalance != null && vaultBalance > 0)) && (
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

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={!isValid || isBusy}
            className="bg-neon text-on-neon rounded-sm px-6 py-3 text-sm font-semibold font-sans w-full mt-3 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isBusy
              ? statusLabel
              : `${tab === "deposit" ? "Deposit" : "Withdraw"} ${primaryToken}`}
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

      {!selectedAccount ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-foreground-muted font-sans text-[0.75rem]">
            Connect your wallet to {tab}
          </p>
          <WalletButton variant="cta" />
        </div>
      ) : (
        <ConnectedDepositWithdrawPanel
          key={tab}
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
