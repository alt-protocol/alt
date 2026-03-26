import { fmtApy } from "@/lib/format";

interface Props {
  apy: number | null;
  protocolUrl: string | null;
  protocolName: string | null;
}

export default function ProtocolFallbackPanel({ apy, protocolUrl, protocolName }: Props) {
  return (
    <div className="flex-[1] bg-surface-low px-6 py-5 flex flex-col justify-between">
      <div>
        <p className="uppercase text-[0.6rem] tracking-[0.05em] text-foreground-muted font-sans mb-2">Current APY</p>
        <p className="font-display text-3xl tracking-[-0.02em] text-neon">{fmtApy(apy)}</p>
      </div>
      <div>
        <a
          href={protocolUrl ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-neon text-on-neon rounded-sm px-6 py-3 text-sm font-semibold font-sans w-full block text-center mt-4 hover:opacity-90 transition-opacity"
        >
          Open in {protocolName ?? "Protocol"} ↗
        </a>
        <p className="text-foreground-muted text-[0.65rem] font-sans mt-2 text-center">
          Non-custodial. Your keys, your funds.
        </p>
      </div>
    </div>
  );
}
