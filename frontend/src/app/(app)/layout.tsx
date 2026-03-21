"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import WalletButton from "@/components/WalletButton";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const navLinks = [
    { href: "/dashboard", label: "Discover" },
    { href: "/portfolio", label: "Portfolio" },
  ];

  return (
    <div className="min-h-screen bg-surface text-foreground">
      <header className="bg-surface-low px-4 sm:px-8 lg:px-[3.5rem] py-3 flex items-center justify-between flex-wrap gap-y-2">
        <Link href="/dashboard" className="font-brand text-lg tracking-[0.02em] text-neon">
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
        <WalletButton variant="header" />
      </header>
      {children}
    </div>
  );
}
