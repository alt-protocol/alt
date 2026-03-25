import { fmtUsd, fmtDate, truncateId } from "@/lib/format";
import { ProtocolChip } from "@/components/ProtocolChip";
import type { UserPositionEventOut } from "@/lib/api";

interface EventsTableProps {
  events: UserPositionEventOut[];
}

export default function EventsTable({ events }: EventsTableProps) {
  if (events.length === 0) {
    return (
      <div className="bg-surface-low rounded-sm px-6 py-12 text-center">
        <p className="uppercase text-[0.65rem] tracking-[0.05em] text-foreground-muted font-sans mb-1">No transactions</p>
        <p className="font-display text-lg tracking-[-0.02em]">No transaction history found</p>
      </div>
    );
  }

  return (
    <div className="bg-surface-low rounded-sm overflow-hidden">
      {/* Mobile cards */}
      <div className="lg:hidden space-y-2 p-3">
        {events.map((e) => (
          <div key={e.id} className="bg-surface rounded-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="bg-surface-high text-foreground rounded-sm px-2 py-0.5 text-[0.6rem] uppercase tracking-[0.05em]">
                {e.event_type}
              </span>
              <span className="text-[0.7rem] text-foreground-muted font-sans">{fmtDate(e.event_at)}</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between items-baseline">
                <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Protocol</span>
                <ProtocolChip slug={e.protocol_slug} />
              </div>
              <div className="flex justify-between items-baseline">
                <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Amount</span>
                <span className="text-[0.8rem] font-sans tabular-nums">{e.amount != null ? e.amount.toFixed(4) : "—"}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Value (USD)</span>
                <span className="text-[0.8rem] font-sans tabular-nums">{fmtUsd(e.amount_usd)}</span>
              </div>
              {e.tx_signature && (
                <div className="flex justify-between items-baseline">
                  <span className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans">Tx</span>
                  <a
                    href={`https://solscan.io/tx/${e.tx_signature}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neon text-[0.7rem] hover:underline"
                  >
                    {truncateId(e.tx_signature, 8)}
                  </a>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      {/* Desktop table */}
      <div className="hidden lg:block">
        <table className="w-full text-[0.8rem] font-sans">
          <thead>
            <tr className="text-foreground-muted uppercase text-[0.6rem] tracking-[0.05em] bg-surface">
              <th className="text-left px-5 py-2.5 font-medium">Date</th>
              <th className="text-left px-5 py-2.5 font-medium">Protocol</th>
              <th className="text-left px-5 py-2.5 font-medium">Type</th>
              <th className="text-right px-5 py-2.5 font-medium">Amount</th>
              <th className="text-right px-5 py-2.5 font-medium">Value (USD)</th>
              <th className="text-right px-5 py-2.5 font-medium">Tx</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="hover:bg-surface-high transition-colors tabular-nums">
                <td className="px-5 py-3 text-foreground-muted">{fmtDate(e.event_at)}</td>
                <td className="px-5 py-3">
                  <ProtocolChip slug={e.protocol_slug} />
                </td>
                <td className="px-5 py-3">
                  <span className="bg-surface-high text-foreground rounded-sm px-2 py-0.5 text-[0.65rem] uppercase tracking-[0.05em]">
                    {e.event_type}
                  </span>
                </td>
                <td className="px-5 py-3 text-right text-foreground">
                  {e.amount != null ? e.amount.toFixed(4) : "—"}
                </td>
                <td className="px-5 py-3 text-right text-foreground">{fmtUsd(e.amount_usd)}</td>
                <td className="px-5 py-3 text-right">
                  {e.tx_signature ? (
                    <a
                      href={`https://solscan.io/tx/${e.tx_signature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neon text-[0.7rem] hover:underline"
                    >
                      {truncateId(e.tx_signature, 8)}
                    </a>
                  ) : (
                    <span className="text-foreground-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
