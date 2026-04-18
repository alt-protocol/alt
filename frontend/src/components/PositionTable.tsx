"use client";

import { memo } from "react";
import { useRouter } from "next/navigation";
import type { UserPositionOut } from "@/lib/api";
import { fmtUsd, fmtPnlUsd, fmtApy, fmtPct, fmtDays, fmtProductType, truncateId, pnlColor } from "@/lib/format";
import { ProtocolChip } from "@/components/ProtocolChip";
import { getCategoryDef } from "@/lib/categories";
import DriftMaintenanceBanner from "./DriftMaintenanceBanner";

function TokenWithType({ p, color = "text-foreground-muted" }: { p: UserPositionOut; color?: string }) {
  const typeLabel = p.underlying_tokens?.[0]?.type?.replace(/_/g, " ");
  return (
    <span className={color}>
      {p.token_symbol ?? "\u2014"}
      {typeLabel && <span className="ml-1 text-[0.55rem] text-foreground-muted/50 uppercase">{typeLabel}</span>}
    </span>
  );
}

function getWithdrawStatus(p: UserPositionOut): string | null {
  return (p.extra_data as Record<string, unknown> | null)?.withdraw_status as string | null ?? null;
}

function NetValue({ position }: { position: UserPositionOut }) {
  const ws = getWithdrawStatus(position);
  return (
    <span>
      {fmtUsd(position.deposit_amount_usd)}
      {ws && (
        <span className={`ml-1.5 text-[0.55rem] uppercase tracking-[0.05em] ${ws === "redeemable" ? "text-neon" : "text-foreground-muted"}`}>
          {ws === "redeemable" ? "Ready" : "Frozen"}
        </span>
      )}
    </span>
  );
}

export interface ColumnDef {
  header: string;
  title?: string;
  align: "left" | "right";
  render: (position: UserPositionOut) => React.ReactNode;
}

export interface PositionCardField {
  label: string;
  value: string;
  colorClass?: string;
}

function fmtNetValue(p: UserPositionOut): string {
  const ws = getWithdrawStatus(p);
  const val = fmtUsd(p.deposit_amount_usd);
  if (!ws) return val;
  return `${val} (${ws === "redeemable" ? "Ready" : "Frozen"})`;
}

function projYieldVal(p: UserPositionOut): number | null {
  const v = (p.deposit_amount_usd ?? 0) * ((p.apy ?? 0) / 100);
  return v || null;
}

function getCardFields(position: UserPositionOut, type: string): PositionCardField[] {
  const py = projYieldVal(position);
  switch (type) {
    case "lending":
      return [
        { label: "Net Value", value: fmtNetValue(position) },
        { label: "APY Current", value: fmtApy(position.apy), colorClass: pnlColor(position.apy) },
        { label: "APY Realized", value: fmtApy(position.apy_realized), colorClass: pnlColor(position.apy_realized) },
        { label: "Proj. Yield/yr", value: fmtUsd(py) },
        { label: "Interest Earned", value: fmtPnlUsd(position.pnl_usd), colorClass: pnlColor(position.pnl_usd) },
        { label: "Days Held", value: fmtDays(position.held_days) },
      ];
    case "multiply":
      return [
        { label: "Net Value", value: fmtNetValue(position) },
        { label: "APY Current", value: fmtApy(position.apy), colorClass: pnlColor(position.apy) },
        { label: "APY Realized", value: fmtApy(position.apy_realized), colorClass: pnlColor(position.apy_realized) },
        { label: "Proj. Yield/yr", value: fmtUsd(py) },
        { label: "PnL ($)", value: fmtPnlUsd(position.pnl_usd), colorClass: pnlColor(position.pnl_usd) },
        { label: "PnL (%)", value: fmtPct(position.pnl_pct), colorClass: pnlColor(position.pnl_pct) },
        { label: "Days Held", value: fmtDays(position.held_days) },
      ];
    case "earn_vault":
    case "earn":
      return [
        { label: "Net Value", value: fmtNetValue(position) },
        { label: "APY Current", value: fmtApy(position.apy), colorClass: pnlColor(position.apy) },
        { label: "APY Realized", value: fmtApy(position.apy_realized), colorClass: pnlColor(position.apy_realized) },
        { label: "Proj. Yield/yr", value: fmtUsd(py) },
        { label: "Interest Earned", value: fmtPnlUsd(position.pnl_usd), colorClass: pnlColor(position.pnl_usd) },
        { label: "Days Held", value: fmtDays(position.held_days) },
      ];
    case "insurance_fund":
      return [
        { label: "Net Value", value: fmtNetValue(position) },
        { label: "APY Current", value: fmtApy(position.apy), colorClass: pnlColor(position.apy) },
        { label: "APY Realized", value: fmtApy(position.apy_realized), colorClass: pnlColor(position.apy_realized) },
        { label: "Proj. Yield/yr", value: fmtUsd(py) },
        { label: "PnL", value: fmtPnlUsd(position.pnl_usd), colorClass: pnlColor(position.pnl_usd) },
        { label: "Days Held", value: fmtDays(position.held_days) },
      ];
    default: // "all"
      return [
        { label: "Net Value", value: fmtNetValue(position) },
        { label: "PnL", value: fmtPnlUsd(position.pnl_usd), colorClass: pnlColor(position.pnl_usd) },
        { label: "APY Current", value: fmtApy(position.apy), colorClass: pnlColor(position.apy) },
        { label: "APY Realized", value: fmtApy(position.apy_realized), colorClass: pnlColor(position.apy_realized) },
        { label: "Proj. Yield/yr", value: fmtUsd(py) },
      ];
  }
}

function PositionCard({ position, showProtocol, fields, onClick }: { position: UserPositionOut; showProtocol: boolean; fields: PositionCardField[]; onClick?: () => void }) {
  return (
    <div className={`bg-surface-low rounded-sm p-4 space-y-3${onClick ? " cursor-pointer" : ""}`} onClick={onClick}>
      <div className="flex items-center justify-between">
        <span className="font-display text-sm tracking-[-0.02em]">{position.token_symbol ?? "\u2014"}{position.underlying_tokens?.[0]?.type ? <span className="ml-1 text-[0.55rem] text-foreground-muted/50 font-sans uppercase">{position.underlying_tokens[0].type.replace(/_/g, " ")}</span> : null}</span>
        {showProtocol && <ProtocolChip slug={position.protocol_slug} />}
      </div>
      {position.lock_period_days > 0 && (
        <span className="inline-block bg-surface-high text-foreground-muted rounded-sm px-2 py-0.5 text-[0.55rem] uppercase tracking-[0.05em]">
          {position.lock_period_days}d lock
        </span>
      )}
      {showProtocol && (
        <span className="inline-block bg-surface-high text-foreground-muted rounded-sm px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.05em]">
          {fmtProductType(position.product_type)}
        </span>
      )}
      {position.protocol_slug === "drift" && <DriftMaintenanceBanner />}
      <div className="space-y-1.5">
        {fields.map((f) => (
          <div key={f.label} className="flex justify-between items-baseline">
            <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">{f.label}</span>
            <span className={`text-[0.8rem] font-sans tabular-nums ${f.colorClass ?? "text-foreground"}`}>{f.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function getColumnsForType(type: string): ColumnDef[] {
  const detailsAction: ColumnDef = {
    header: "",
    align: "right",
    render: (p) => p.opportunity_id ? (
      <button onClick={(e) => { e.stopPropagation(); }} className="border border-secondary text-secondary-text text-[0.7rem] rounded-sm px-4 py-1.5 hover:bg-secondary hover:text-foreground transition-colors" data-navigate={`/yields/${p.opportunity_id}`}>Details</button>
    ) : null,
  };

  const apyCurrent: ColumnDef = { header: "APY Current", title: "Current market APY from the protocol. For multiply, net of borrow costs.", align: "right", render: (p) => <span className={pnlColor(p.apy)}>{fmtApy(p.apy)}</span> };
  const apyRealized: ColumnDef = { header: "APY Realized", title: "Your actual annualized return based on PnL and time held.", align: "right", render: (p) => <span className={pnlColor(p.apy_realized)}>{fmtApy(p.apy_realized)}</span> };
  const projYield: ColumnDef = { header: "Proj. Yield/yr", title: "Estimated annual yield based on current APY", align: "right", render: (p) => { const v = (p.deposit_amount_usd ?? 0) * ((p.apy ?? 0) / 100); return <span className="text-foreground">{fmtUsd(v || null)}</span>; } };

  switch (type) {
    case "lending":
      return [
        { header: "Market", align: "left", render: (p) => <span className="text-foreground">{truncateId(p.external_id)}</span> },
        { header: "Token", align: "left", render: (p) => <TokenWithType p={p} /> },
        { header: "Net Value", align: "right", render: (p) => <NetValue position={p} /> },
        apyCurrent,
        apyRealized,
        projYield,
        { header: "Interest Earned", align: "right", render: (p) => <span className={pnlColor(p.pnl_usd)}>{fmtPnlUsd(p.pnl_usd)}</span> },
        { header: "Days Held", align: "right", render: (p) => <span className="text-foreground-muted">{fmtDays(p.held_days)}</span> },
        detailsAction,
      ];
    case "multiply":
      return [
        { header: "Strategy", align: "left", render: (p) => <span className="text-foreground">{truncateId(p.external_id)}</span> },
        { header: "Token", align: "left", render: (p) => <TokenWithType p={p} /> },
        { header: "Net Value", align: "right", render: (p) => <NetValue position={p} /> },
        apyCurrent,
        apyRealized,
        projYield,
        { header: "PnL ($)", align: "right", render: (p) => <span className={pnlColor(p.pnl_usd)}>{fmtPnlUsd(p.pnl_usd)}</span> },
        { header: "PnL (%)", align: "right", render: (p) => <span className={pnlColor(p.pnl_pct)}>{fmtPct(p.pnl_pct)}</span> },
        { header: "Days Held", align: "right", render: (p) => <span className="text-foreground-muted">{fmtDays(p.held_days)}</span> },
        detailsAction,
      ];
    case "earn_vault":
      return [
        { header: "Vault", align: "left", render: (p) => <span className="text-foreground">{truncateId(p.external_id)}</span> },
        { header: "Token", align: "left", render: (p) => <TokenWithType p={p} /> },
        { header: "Net Value", align: "right", render: (p) => <NetValue position={p} /> },
        apyCurrent,
        apyRealized,
        projYield,
        { header: "Interest Earned", align: "right", render: (p) => <span className={pnlColor(p.pnl_usd)}>{fmtPnlUsd(p.pnl_usd)}</span> },
        { header: "Days Held", align: "right", render: (p) => <span className="text-foreground-muted">{fmtDays(p.held_days)}</span> },
        detailsAction,
      ];
    case "insurance_fund":
      return [
        { header: "Fund", align: "left", render: (p) => <span className="text-foreground">{truncateId(p.external_id)}</span> },
        { header: "Token", align: "left", render: (p) => <TokenWithType p={p} /> },
        { header: "Net Value", align: "right", render: (p) => <NetValue position={p} /> },
        apyCurrent,
        apyRealized,
        projYield,
        { header: "PnL", align: "right", render: (p) => <span className={pnlColor(p.pnl_usd)}>{fmtPnlUsd(p.pnl_usd)}</span> },
        { header: "Lock", align: "right", render: (p) => <span className="text-foreground-muted">{p.lock_period_days > 0 ? `${p.lock_period_days}d` : "\u2014"}</span> },
        { header: "Days Held", align: "right", render: (p) => <span className="text-foreground-muted">{fmtDays(p.held_days)}</span> },
        detailsAction,
      ];
    case "earn":
      return [
        { header: "Vault", align: "left", render: (p) => <span className="text-foreground">{truncateId(p.external_id)}</span> },
        { header: "Token", align: "left", render: (p) => <TokenWithType p={p} /> },
        { header: "Net Value", align: "right", render: (p) => <NetValue position={p} /> },
        apyCurrent,
        apyRealized,
        projYield,
        { header: "Interest Earned", align: "right", render: (p) => <span className={pnlColor(p.pnl_usd)}>{fmtPnlUsd(p.pnl_usd)}</span> },
        { header: "Days Held", align: "right", render: (p) => <span className="text-foreground-muted">{fmtDays(p.held_days)}</span> },
        detailsAction,
      ];
    default: // "all"
      return [
        { header: "Protocol", align: "left", render: (p) => <ProtocolChip slug={p.protocol_slug} /> },
        { header: "Type", align: "left", render: (p) => <span className="text-foreground-muted">{fmtProductType(p.product_type)}</span> },
        { header: "Token", align: "left", render: (p) => <TokenWithType p={p} color="text-foreground" /> },
        { header: "Net Value", align: "right", render: (p) => <NetValue position={p} /> },
        { header: "PnL", align: "right", render: (p) => <span className={pnlColor(p.pnl_usd)}>{fmtPnlUsd(p.pnl_usd)}</span> },
        apyCurrent,
        apyRealized,
        projYield,
        { header: "Held", align: "right", render: (p) => <span className="text-foreground-muted">{fmtDays(p.held_days)}{p.lock_period_days > 0 ? ` (${p.lock_period_days}d lock)` : ""}</span> },
        detailsAction,
      ];
  }
}

interface PositionTableProps {
  columns: ColumnDef[];
  positions: UserPositionOut[];
  activeType: string;
}

function PositionTableInner({ columns, positions, activeType }: PositionTableProps) {
  const router = useRouter();
  const showProtocol = activeType === "all";

  if (positions.length === 0) {
    const def = getCategoryDef(activeType);
    const typeLabel = def?.sidebarLabel ?? activeType.toUpperCase();
    return (
      <div className="flex-1 bg-surface flex flex-col items-center justify-center py-16">
        <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">
          No {typeLabel} positions found
        </p>
        <p className="font-display text-lg tracking-[-0.02em] text-foreground-muted">
          Nothing to display
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-surface">
      {/* Mobile cards */}
      <div className="lg:hidden space-y-2 p-3">
        {positions.map((p) => (
          <PositionCard
            key={p.id}
            position={p}
            showProtocol={showProtocol}
            fields={getCardFields(p, activeType)}
            onClick={p.opportunity_id ? () => router.push(`/yields/${p.opportunity_id}`) : undefined}
          />
        ))}
      </div>
      {/* Desktop table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full text-[0.8rem] font-sans">
          <thead>
            <tr className="text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface">
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={`${col.align === "right" ? "text-right" : "text-left"} px-5 py-2.5 font-medium`}
                  title={col.title}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr
                key={p.id}
                className={`hover:bg-surface-high transition-colors tabular-nums${p.opportunity_id ? " cursor-pointer" : ""}`}
                onClick={p.opportunity_id ? () => router.push(`/yields/${p.opportunity_id}`) : undefined}
              >
                {columns.map((col, i) => (
                  <td
                    key={i}
                    className={`px-5 py-3 ${col.align === "right" ? "text-right" : ""}`}
                    onClick={(e) => {
                      const btn = (e.target as HTMLElement).closest("[data-navigate]");
                      if (btn) {
                        e.stopPropagation();
                        router.push(btn.getAttribute("data-navigate")!);
                      }
                    }}
                  >
                    {col.render(p)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default memo(PositionTableInner);
