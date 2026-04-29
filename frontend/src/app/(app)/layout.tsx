"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SolanaProviders from "@/components/SolanaProviders";
import WalletButton from "@/components/WalletButton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const navLinks = [
    { href: "/discover", label: "Discover" },
    { href: "/swap", label: "Swap" },
    { href: "/portfolio", label: "Portfolio" },
  ];

  return (
    <SolanaProviders>
      <div className="min-h-screen bg-surface text-foreground">
        <header className="bg-surface-low px-4 sm:px-8 lg:px-[3.5rem] py-3 flex items-center justify-between flex-wrap gap-y-2">
          <Link href="/discover" className="font-brand text-lg tracking-[0.02em] text-neon flex items-center gap-2">
            AKASHI
          </Link>
          <nav className="flex gap-4 sm:gap-8 text-[0.8rem] uppercase tracking-[0.05em] font-sans">
            {navLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={
                  pathname === href
                    ? "text-neon font-semibold underline underline-offset-8 decoration-2"
                    : "text-foreground-muted hover:text-foreground transition-colors"
                }
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <a
              href="https://t.me/akashi_beta_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 border border-neon text-neon text-[0.7rem] uppercase tracking-[0.05em] font-sans px-3 py-1.5 rounded-sm hover:bg-neon hover:text-on-neon transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>
              Copilot
            </a>
            <WalletButton variant="header" />
          </div>
        </header>
        {children}
      </div>
    </SolanaProviders>
  );
}
