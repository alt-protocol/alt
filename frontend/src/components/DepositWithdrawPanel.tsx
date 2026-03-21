"use client";

import { useState } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import type { YieldOpportunityDetail } from "@/lib/api";
import { getAdapter } from "@/lib/protocols";
import { useTokenBalance } from "@/lib/hooks/useTokenBalance";
import { useVaultTransaction } from "@/lib/hooks/useVaultTransaction";
import WalletButton from "./WalletButton";

type Tab = "deposit" | "withdraw";

interface Props {
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
}

export default function DepositWithdrawPanel({ yield_, protocolSlug }: Props) {
  const [tab, setTab] = useState<Tab>("deposit");
  const [amount, setAmount] = useState("");
  const [selectedAccount] = useSelectedWalletAccount();

  const signer = selectedAccount
    ? useWalletAccountTransactionSendingSigner(selectedAccount, "solana:mainnet")
    : null;

  const primaryToken = yield_.tokens[0] ?? "USDC";
  const { data: balance } = useTokenBalance(selectedAccount?.address, primaryToken);

  const { execute, status, error, txSignature, reset } = useVaultTransaction(signer);

  const numAmount = parseFloat(amount) || 0;
  const isValid = numAmount > 0 && (balance == null || numAmount <= balance);
  const isBusy = status === "building" || status === "signing" || status === "confirming";

  function handleAmountChange(value: string) {
    if (value === "" || /^\d*\.?\d*$/.test(value)) {
      setAmount(value);
    }
  }

  function handleHalf() {
    if (balance != null) setAmount((balance / 2).toString());
  }

  function handleMax() {
    if (balance != null) setAmount(balance.toString());
  }

  async function handleSubmit() {
    if (!yield_.deposit_address) return;

    const adapter = await getAdapter(protocolSlug);
    if (!adapter) return;

    reset();

    await execute(async () => {
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

    setAmount("");
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
    <div className="flex-[1] bg-surface-low px-6 py-5 flex flex-col">
      {/* Tab switcher */}
      <div className="flex gap-[1px] mb-5">
        {(["deposit", "withdraw"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); reset(); setAmount(""); }}
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
        <>
          {/* Position display */}
          {balance != null && (
            <div className="flex justify-between items-center mb-4">
              <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">
                Available
              </span>
              <span className="font-sans text-[0.8rem] tabular-nums">
                {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {primaryToken}
              </span>
            </div>
          )}

          {/* Amount input */}
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
          {numAmount > 0 && balance != null && numAmount > balance && (
            <p className="text-red-400 text-[0.65rem] font-sans mb-2">
              Insufficient {primaryToken} balance
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

          <p className="text-foreground-muted text-[0.6rem] font-sans mt-4 text-center">
            Non-custodial · Your keys only
          </p>
        </>
      )}
    </div>
  );
}
