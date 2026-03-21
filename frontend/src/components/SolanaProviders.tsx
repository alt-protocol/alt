"use client";

import { SelectedWalletAccountContextProvider } from "@solana/react";
import type { UiWallet } from "@wallet-standard/react-core";

const STORAGE_KEY = "akashi:selectedWallet";

const stateSync = {
  getSelectedWallet(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  },
  storeSelectedWallet(accountKey: string) {
    localStorage.setItem(STORAGE_KEY, accountKey);
  },
  deleteSelectedWallet() {
    localStorage.removeItem(STORAGE_KEY);
  },
};

function filterWallets(wallet: UiWallet): boolean {
  return wallet.chains.some((c) => c === "solana:mainnet");
}

export default function SolanaProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SelectedWalletAccountContextProvider
      filterWallets={filterWallets}
      stateSync={stateSync}
    >
      {children}
    </SelectedWalletAccountContextProvider>
  );
}
