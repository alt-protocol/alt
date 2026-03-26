"use client";

import { useRouter } from "next/navigation";
import type { UserPositionOut } from "@/lib/api";
import { fmtApy, fmtProductType } from "@/lib/format";
import { ProtocolChip } from "@/components/ProtocolChip";
import { getCategoryDef, getAllOverviewColumns, getAllOverviewCardFields } from "@/lib/categories";

export interface ColumnDef {
  header: string;
  align: "left" | "right";
  render: (position: UserPositionOut) => React.ReactNode;
}

export function ApyCell({ position }: { position: UserPositionOut }) {
  const forwardApy = (position.extra_data as Record<string, unknown> | null)?.forward_apy as number | null | undefined;
  const showBoth = forwardApy != null && position.apy !== forwardApy;
  return (
    <>
      <span className="text-neon">{fmtApy(position.apy)}</span>
      {showBoth && (
        <div className="text-xs text-foreground-muted mt-0.5">
          {fmtApy(forwardApy)} mkt
        </div>
      )}
    </>
  );
}

export interface PositionCardField {
  label: string;
  value: string;
  colorClass?: string;
}

function PositionCard({ position, showProtocol, fields, onClick }: { position: UserPositionOut; showProtocol: boolean; fields: PositionCardField[]; onClick?: () => void }) {
  return (
    <div className={`bg-surface-low rounded-sm p-4 space-y-3${onClick ? " cursor-pointer" : ""}`} onClick={onClick}>
      <div className="flex items-center justify-between">
        <span className="font-display text-sm tracking-[-0.02em]">{position.token_symbol ?? "\u2014"}</span>
        {showProtocol && <ProtocolChip slug={position.protocol_slug} />}
      </div>
      {showProtocol && (
        <span className="inline-block bg-surface-high text-foreground-muted rounded-sm px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.05em]">
          {fmtProductType(position.product_type)}
        </span>
      )}
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

/** Shared "Details" action column — passed to every category definition. */
const detailsAction: ColumnDef = {
  header: "",
  align: "right",
  render: (p) => p.opportunity_id ? (
    <button onClick={(e) => { e.stopPropagation(); }} className="border border-secondary text-secondary-text text-[0.7rem] rounded-sm px-4 py-1.5 hover:bg-secondary hover:text-foreground transition-colors" data-navigate={`/yields/${p.opportunity_id}`}>Details</button>
  ) : null,
};

export function getColumnsForType(type: string): ColumnDef[] {
  if (type === "all") return getAllOverviewColumns(detailsAction);
  const def = getCategoryDef(type);
  if (def) return def.positionColumns(detailsAction);
  return getAllOverviewColumns(detailsAction);
}

function getCardFields(position: UserPositionOut, type: string): PositionCardField[] {
  if (type === "all") return getAllOverviewCardFields(position);
  const def = getCategoryDef(type);
  if (def) return def.positionCardFields(position);
  return getAllOverviewCardFields(position);
}

interface PositionTableProps {
  columns: ColumnDef[];
  positions: UserPositionOut[];
  activeType: string;
}

export default function PositionTable({ columns, positions, activeType }: PositionTableProps) {
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
