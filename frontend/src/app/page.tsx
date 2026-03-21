import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-[3.5rem] text-center bg-surface">
      <p className="uppercase text-[0.75rem] tracking-[0.05em] text-foreground-muted mb-5 font-sans">
        Non-custodial yield aggregation on Solana
      </p>
      <h1 className="leading-[1.05] tracking-[-0.02em] mb-2">
        <span className="font-brand text-[4rem] text-neon">AKASHI</span>
      </h1>
      <p className="text-foreground-muted font-sans text-[0.875rem] max-w-lg mb-10 leading-relaxed">
        High-fidelity liquidity management and automated yield strategies
        across Kamino, Drift, and Exponent. Your keys, your funds.
      </p>
      <div className="flex gap-3">
        <Link
          href="/dashboard"
          className="bg-neon text-on-neon rounded-sm px-8 py-3 text-[0.8rem] font-semibold hover:bg-neon-bright transition-colors"
        >
          Explore Yields
        </Link>
        <Link
          href="/portfolio"
          className="border border-outline-ghost text-foreground rounded-sm px-8 py-3 text-[0.8rem] font-sans hover:bg-surface-high transition-colors"
        >
          View Portfolio
        </Link>
      </div>
    </main>
  );
}
