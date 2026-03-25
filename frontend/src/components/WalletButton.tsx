"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useClickOutside } from "@/lib/hooks/useClickOutside";
import { useSelectedWalletAccount } from "@solana/react";
import {
  useWallets,
  useDisconnect,
  type UiWallet,
} from "@wallet-standard/react-core";
import type { UiWalletAccount } from "@wallet-standard/ui";
import WalletModal from "@/components/WalletModal";

interface WalletButtonProps {
  variant?: "header" | "cta";
}

function DisconnectRow({
  wallet,
  onDisconnected,
}: {
  wallet: UiWallet;
  onDisconnected: () => void;
}) {
  const [isDisconnecting, disconnect] = useDisconnect(wallet);

  async function handleClick() {
    try {
      await disconnect();
      onDisconnected();
    } catch {
      // ignore
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isDisconnecting}
      className="w-full text-left px-5 py-3 text-[0.8rem] font-sans text-red-400 hover:bg-surface-high transition-colors disabled:opacity-50"
    >
      {isDisconnecting ? "Disconnecting..." : "Disconnect"}
    </button>
  );
}

export default function WalletButton({ variant = "header" }: WalletButtonProps) {
  const [selectedAccount, setSelectedAccount, filteredWallets] =
    useSelectedWalletAccount();
  const allWallets = useWallets();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on ESC
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [open, handleKeyDown]);

  // Click-outside for connected dropdown
  const closeDropdown = useCallback(() => setOpen(false), []);
  const clickOutsideActive = useMemo(() => open && !!selectedAccount, [open, selectedAccount]);
  useClickOutside(dropdownRef, clickOutsideActive, closeDropdown);

  // Find the wallet that owns the selected account
  const connectedWallet = selectedAccount
    ? allWallets.find((w) =>
        w.accounts.some((a) => a.address === selectedAccount.address)
      )
    : undefined;

  const truncatedAddress = selectedAccount
    ? `${selectedAccount.address.slice(0, 4)}...${selectedAccount.address.slice(-4)}`
    : null;

  function handleConnected(account: UiWalletAccount) {
    setSelectedAccount(account);
    setOpen(false);
  }

  function handleDisconnected() {
    setSelectedAccount(undefined);
    setOpen(false);
  }

  const buttonClass =
    variant === "cta"
      ? "bg-neon text-on-neon rounded-sm px-6 py-2.5 text-[0.8rem] font-semibold font-sans hover:bg-neon-bright transition-colors"
      : "text-foreground text-[0.8rem] font-sans rounded-sm px-4 py-2 border border-outline-ghost hover:bg-surface-high transition-colors";

  // Connected state: small dropdown anchored to the button
  if (selectedAccount && connectedWallet) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button onClick={() => setOpen(!open)} className={buttonClass}>
          {truncatedAddress}
        </button>
        {open && (
          <div
            className="absolute right-0 top-full mt-2 w-[260px] bg-surface-low/95 backdrop-blur-[16px] rounded-sm overflow-hidden z-50"
            style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.4)" }}
          >
            <div className="px-5 py-3 bg-surface-high/40">
              <p className="text-[0.65rem] uppercase tracking-[0.05em] text-foreground-muted font-sans mb-1">
                Connected
              </p>
              <div className="flex items-center gap-3">
                {connectedWallet.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={connectedWallet.icon}
                    alt={connectedWallet.name}
                    width={24}
                    height={24}
                    className="rounded-sm"
                  />
                )}
                <p className="text-[0.8rem] font-sans text-foreground tabular-nums">
                  {truncatedAddress}
                </p>
              </div>
            </div>
            <DisconnectRow
              wallet={connectedWallet}
              onDisconnected={handleDisconnected}
            />
          </div>
        )}
      </div>
    );
  }

  // Disconnected state: modal
  return (
    <>
      <button onClick={() => setOpen(!open)} className={buttonClass}>
        Connect Wallet
      </button>
      {open && (
        <WalletModal
          filteredWallets={filteredWallets}
          onConnected={handleConnected}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
