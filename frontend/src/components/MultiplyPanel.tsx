"use client";

import { useState, useMemo, useEffect } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import { useWalletAccountTransactionSendingSigner } from "@solana/react";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useQueryClient } from "@tanstack/react-query";
import type { YieldOpportunityDetail } from "@/lib/api";
import { api } from "@/lib/api";
import { deserializeBuildResponse } from "@/lib/instruction-deserializer";
import { fmtApy, fmtUsd, fmtPct, pnlColor } from "@/lib/format";
import { useTokenBalance } from "@/lib/hooks/useTokenBalance";
import { useTransaction } from "@/lib/hooks/useTransaction";
import { usePositionForOpportunity } from "@/lib/hooks/usePositionForOpportunity";
import { useSlippage } from "@/lib/hooks/useSlippage";
import type { LeverageEntry } from "@/lib/multiply-utils";
import { parseLeverageTable, interpolateApy, getMultiplyStatusLabel } from "@/lib/multiply-utils";
import WalletButton from "./WalletButton";

type Tab = "open" | "withdraw" | "close";

interface Props {
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
}

function PositionInfo({
  position, positionLoading, collSymbol, closeNote,
}: {
  position: { deposit_amount?: number | null; pnl_usd?: number | null; pnl_pct?: number | null } | null;
  positionLoading: boolean;
  collSymbol: string;
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
  yield_: YieldOpportunityDetail;
  protocolSlug: string;
  leverageEntries: LeverageEntry[];
  minLev: number;
  maxLev: number;
}

function ConnectedMultiplyPanel({
  selectedAccount, tab, amount, setAmount, leverage, setLeverage,
  editingSlippage, setEditingSlippage, yield_, protocolSlug,
  leverageEntries, minLev, maxLev,
}: ConnectedProps) {
  const extra = yield_.extra_data;
  const signer = useWalletAccountTransactionSendingSigner(selectedAccount, "solana:mainnet");

  const queryClient = useQueryClient();
  const { slippageBps, setSlippage } = useSlippage();
  const collSymbol = (extra?.collateral_symbol as string) ?? yield_.tokens[0] ?? "SOL";
  const debtSymbol = (extra?.debt_symbol as string) ?? "USDC";
  const borrowApy = extra?.borrow_apy_current_pct as number | null;
  const { data: balance } = useTokenBalance(selectedAccount.address, collSymbol);
  const { position, isLoading: positionLoading } = usePositionForOpportunity(
    selectedAccount.address,
    yield_.id,
  );

  const { execute, status, error, txSignature, reset } = useTransaction(signer);

  // Reset transaction state when tab changes
  useEffect(() => { reset(); }, [tab, reset]);

  const projectedApy = useMemo(() => interpolateApy(leverageEntries, leverage), [leverageEntries, leverage]);
  const numAmount = parseFloat(amount) || 0;
  const effectiveBalance = tab === "open" ? (balance ?? null) : (position?.deposit_amount ?? null);
  const isValid = tab === "close"
    ? !!position
    : numAmount > 0 && (effectiveBalance == null || numAmount <= effectiveBalance);
  const isBusy = status === "preparing" || status === "building" || status === "signing" || status === "confirming";

  const fillPct = maxLev > minLev ? ((leverage - minLev) / (maxLev - minLev)) * 100 : 0;

  function handleAmountChange(value: string) {
    if (value === "" || /^\d*\.?\d*$/.test(value)) setAmount(value);
  }

  async function handleSubmit() {
    if (!yield_.deposit_address) return;
    reset();

    await execute(async () => {
      const params = {
        opportunity_id: yield_.id,
        wallet_address: selectedAccount.address,
        amount: tab === "close" ? "0" : amount,
        extra_data: { leverage, slippageBps, isClosingPosition: tab === "close" },
      };

      const response = tab === "open"
        ? await api.buildDeposit(params)
        : await api.buildWithdraw(params);

      return deserializeBuildResponse(response);
    });

    setAmount("");
    queryClient.invalidateQueries({ queryKey: ["positions", selectedAccount.address] });
  }

  const statusLabel = getMultiplyStatusLabel(status);

  return (
    <>
      {/* OPEN tab */}
      {tab === "open" && (
        <>
          {/* Leverage slider */}
          <div className="mb-4">
            <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans block mb-3">Leverage</span>
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
                  background: `linear-gradient(to right, var(--neon-primary) 0%, var(--neon-primary) ${fillPct}%, rgba(255,255,255,0.12) ${fillPct}%, rgba(255,255,255,0.12) 100%)`,
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
          {borrowApy != null && (
            <div className="flex justify-between items-center mb-4">
              <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Borrow APY</span>
              <span className="font-sans text-[0.8rem] text-foreground-muted tabular-nums">{fmtApy(borrowApy)}</span>
            </div>
          )}
          {balance != null && (
            <div className="flex justify-between items-center mb-4">
              <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Available</span>
              <span className="font-sans text-[0.8rem] tabular-nums">
                {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {collSymbol}
              </span>
            </div>
          )}
        </>
      )}

      {(tab === "withdraw" || tab === "close") && (
        <PositionInfo position={position} positionLoading={positionLoading} collSymbol={collSymbol} closeNote={tab === "close"} />
      )}

      {/* Amount input (open + withdraw only) */}
      {tab !== "close" && (
        <div className="bg-surface-high rounded-sm px-4 py-3 mb-2 focus-within:shadow-[0_2px_0_0_var(--neon-primary)] transition-shadow">
          <div className="flex items-center justify-between mb-1">
            <span className="text-foreground-muted text-[0.65rem] font-sans uppercase tracking-[0.05em]">{collSymbol}</span>
            <div className="flex gap-2">
              <button onClick={() => { if (effectiveBalance != null) setAmount((effectiveBalance / 2).toString()); }} className="text-neon text-[0.65rem] font-sans uppercase tracking-[0.05em] hover:opacity-80">Half</button>
              <button onClick={() => { if (effectiveBalance != null) setAmount(effectiveBalance.toString()); }} className="text-neon text-[0.65rem] font-sans uppercase tracking-[0.05em] hover:opacity-80">Max</button>
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

      {tab === "open" && numAmount > 0 && balance != null && numAmount > balance && (
        <p className="text-red-400 text-[0.65rem] font-sans mb-2">Insufficient {collSymbol} balance</p>
      )}

      {/* Action button */}
      <button
        onClick={handleSubmit}
        disabled={!isValid || isBusy}
        className="bg-neon text-on-neon rounded-sm px-6 py-3 text-sm font-semibold font-sans w-full mt-3 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {isBusy ? statusLabel : tab === "open" ? `Open ${leverage.toFixed(1)}x ${collSymbol}/${debtSymbol}` : tab === "withdraw" ? `Withdraw ${collSymbol}` : "Close Position"}
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
            className="mt-2 w-full bg-surface-high rounded-sm px-3 py-1.5 text-[0.65rem] font-sans text-foreground outline-none focus:shadow-[0_1px_0_0_var(--neon-primary)]"
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
  const [selectedAccount] = useSelectedWalletAccount();

  const tabs: Tab[] = ["open", "withdraw", "close"];

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
