"use client";

import { useState, useMemo } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import { useQueryClient } from "@tanstack/react-query";
import type { YieldOpportunityDetail } from "@/lib/api";
import { getAdapter } from "@/lib/protocols";
import { fmtApy, fmtUsd, fmtPct, pnlColor } from "@/lib/format";
import { useTokenBalance } from "@/lib/hooks/useTokenBalance";
import { useMultiplyTransaction } from "@/lib/hooks/useMultiplyTransaction";
import { usePositionForOpportunity } from "@/lib/hooks/usePositionForOpportunity";
import WalletButton from "./WalletButton";

type Tab = "open" | "withdraw" | "close";

interface Props {
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
}

interface LeverageEntry {
  key: string;
  value: number;
  netApy: number | null;
}

function parseLeverageTable(extra: Record<string, unknown> | null): LeverageEntry[] {
  const table = extra?.leverage_table as Record<string, any> | undefined;
  if (!table) return [];
  return Object.entries(table)
    .map(([key, data]) => ({
      key,
      value: parseFloat(key),
      netApy: typeof data === "object" && data?.net_apy_current_pct != null
        ? Number(data.net_apy_current_pct)
        : typeof data === "number" ? data : null,
    }))
    .sort((a, b) => a.value - b.value);
}

export default function MultiplyPanel({ yield_, protocolSlug }: Props) {
  const extra = yield_.extra_data;
  const leverageEntries = useMemo(() => parseLeverageTable(extra), [extra]);
  const defaultLev = leverageEntries.length > 0
    ? leverageEntries[Math.floor(leverageEntries.length / 2)].value
    : 3;

  const [tab, setTab] = useState<Tab>("open");
  const [amount, setAmount] = useState("");
  const [leverage, setLeverage] = useState(defaultLev);
  const [selectedAccount] = useSelectedWalletAccount();

  const signer = selectedAccount
    ? useWalletAccountTransactionSendingSigner(selectedAccount, "solana:mainnet")
    : null;

  const queryClient = useQueryClient();
  const collSymbol = (extra?.collateral_symbol as string) ?? yield_.tokens[0] ?? "SOL";
  const debtSymbol = (extra?.debt_symbol as string) ?? "USDC";
  const borrowApy = extra?.borrow_apy_current_pct as number | null;
  const { data: balance } = useTokenBalance(selectedAccount?.address, collSymbol);
  const { position, isLoading: positionLoading } = usePositionForOpportunity(
    selectedAccount?.address,
    yield_.id,
  );

  const { execute, status, error, txSignature, reset } = useMultiplyTransaction(signer);

  const projectedApy = leverageEntries.find((e) => e.value === leverage)?.netApy ?? null;
  const numAmount = parseFloat(amount) || 0;
  const effectiveBalance = tab === "open" ? (balance ?? null) : (position?.deposit_amount ?? null);
  const isValid = tab === "close"
    ? !!position
    : numAmount > 0 && (effectiveBalance == null || numAmount <= effectiveBalance);
  const isBusy = status === "preparing" || status === "building" || status === "signing" || status === "confirming";

  function handleAmountChange(value: string) {
    if (value === "" || /^\d*\.?\d*$/.test(value)) setAmount(value);
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

    await execute(async () => {
      const extraData = {
        ...extra,
        leverage,
        isClosingPosition: tab === "close",
      };

      const params = {
        signer: signer!,
        depositAddress: yield_.deposit_address!,
        amount: tab === "close" ? "0" : amount,
        category: yield_.category,
        extraData,
      };

      return tab === "open"
        ? adapter.buildDepositTx(params)
        : adapter.buildWithdrawTx(params);
    });

    setAmount("");
    queryClient.invalidateQueries({ queryKey: ["positions", selectedAccount?.address] });
  }

  const statusLabel =
    status === "preparing" ? "Setting up lookup tables..."
    : status === "building" ? "Building transaction..."
    : status === "signing" ? "Approve in wallet..."
    : status === "confirming" ? "Confirming..."
    : null;

  const hasPosition = !!position && !positionLoading;
  const tabs: Tab[] = ["open", "withdraw", "close"];

  return (
    <div className="flex-[1] bg-surface-low px-6 py-5 flex flex-col">
      {/* Tab switcher */}
      <div className="flex gap-[1px] mb-5">
        {tabs.map((t) => (
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
          {/* OPEN tab */}
          {tab === "open" && (
            <>
              {/* Leverage selector */}
              {leverageEntries.length > 0 && (
                <div className="mb-4">
                  <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans block mb-2">
                    Leverage
                  </span>
                  <div className="flex gap-[1px]">
                    {leverageEntries.map((entry) => (
                      <button
                        key={entry.key}
                        onClick={() => setLeverage(entry.value)}
                        className={`flex-1 py-1.5 text-[0.7rem] font-sans rounded-sm transition-colors ${
                          leverage === entry.value
                            ? "bg-neon text-on-neon"
                            : "bg-surface-high text-foreground-muted hover:text-foreground"
                        }`}
                      >
                        {entry.key}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Projected APY + Borrow APY */}
              <div className="flex justify-between items-center mb-2">
                <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">
                  Projected APY
                </span>
                <span className="font-sans text-[0.8rem] text-neon tabular-nums">
                  {projectedApy != null ? fmtApy(projectedApy) : "—"}
                </span>
              </div>
              {borrowApy != null && (
                <div className="flex justify-between items-center mb-4">
                  <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">
                    Borrow APY
                  </span>
                  <span className="font-sans text-[0.8rem] text-foreground-muted tabular-nums">
                    {fmtApy(borrowApy)}
                  </span>
                </div>
              )}

              {/* Balance */}
              {balance != null && (
                <div className="flex justify-between items-center mb-4">
                  <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">
                    Available
                  </span>
                  <span className="font-sans text-[0.8rem] tabular-nums">
                    {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {collSymbol}
                  </span>
                </div>
              )}
            </>
          )}

          {/* WITHDRAW tab */}
          {tab === "withdraw" && (
            <>
              {hasPosition && (
                <>
                  <div className="flex justify-between items-center mb-2">
                    <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Deposited</span>
                    <span className="font-sans text-[0.8rem] tabular-nums">
                      {position.deposit_amount?.toLocaleString(undefined, { maximumFractionDigits: 6 })} {collSymbol}
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
                </>
              )}
              {!hasPosition && !positionLoading && (
                <div className="flex-1 flex flex-col items-center justify-center gap-2">
                  <p className="text-foreground-muted font-sans text-[0.75rem]">No active position</p>
                  <p className="text-foreground-muted/60 font-sans text-[0.65rem]">Open a position first</p>
                </div>
              )}
            </>
          )}

          {/* CLOSE tab */}
          {tab === "close" && (
            <>
              {hasPosition && (
                <>
                  <div className="flex justify-between items-center mb-2">
                    <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Deposited</span>
                    <span className="font-sans text-[0.8rem] tabular-nums">
                      {position.deposit_amount?.toLocaleString(undefined, { maximumFractionDigits: 6 })} {collSymbol}
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
                  <p className="text-foreground-muted font-sans text-[0.65rem] mb-4">
                    This will repay all debt, unwind the position, and withdraw your collateral.
                  </p>
                </>
              )}
              {!hasPosition && !positionLoading && (
                <div className="flex-1 flex flex-col items-center justify-center gap-2">
                  <p className="text-foreground-muted font-sans text-[0.75rem]">No active position</p>
                  <p className="text-foreground-muted/60 font-sans text-[0.65rem]">Open a position first</p>
                </div>
              )}
            </>
          )}

          {/* Amount input (open + withdraw only) */}
          {tab !== "close" && (
            <div className="bg-surface-high rounded-sm px-4 py-3 mb-2 focus-within:shadow-[0_2px_0_0_var(--neon-primary)] transition-shadow">
              <div className="flex items-center justify-between mb-1">
                <span className="text-foreground-muted text-[0.65rem] font-sans uppercase tracking-[0.05em]">
                  {collSymbol}
                </span>
                <div className="flex gap-2">
                  <button onClick={handleHalf} className="text-neon text-[0.65rem] font-sans uppercase tracking-[0.05em] hover:opacity-80">Half</button>
                  <button onClick={handleMax} className="text-neon text-[0.65rem] font-sans uppercase tracking-[0.05em] hover:opacity-80">Max</button>
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
          )}

          {/* Validation */}
          {tab === "open" && numAmount > 0 && balance != null && numAmount > balance && (
            <p className="text-red-400 text-[0.65rem] font-sans mb-2">
              Insufficient {collSymbol} balance
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
              : tab === "open"
                ? `Open ${leverage}x ${collSymbol}/${debtSymbol}`
                : tab === "withdraw"
                  ? `Withdraw ${collSymbol}`
                  : "Close Position"}
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
            <p className="mt-3 text-red-400 text-[0.7rem] font-sans text-center">{error}</p>
          )}

          <p className="text-foreground-muted text-[0.6rem] font-sans mt-4 text-center">
            Non-custodial · Your keys only
          </p>
        </>
      )}
    </div>
  );
}
