"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useSelectedWalletAccount } from "@solana/react";
import {
  useWallets,
  useConnect,
  useDisconnect,
  type UiWallet,
} from "@wallet-standard/react-core";
import type { UiWalletAccount } from "@wallet-standard/ui";

const POPULAR_WALLETS = [
  {
    name: "Phantom",
    url: "https://phantom.app",
    icon: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSIjYWI5ZmY0Ii8+PHBhdGggZD0iTTE3LjkgOS40Yy0uMyAyLjgtMi41IDQuNy01IDQuN2gtMS4yYy0uMyAwLS41LjItLjUuNXYxLjdjMCAuMy0uMi41LS41LjVINi41Yy0uMyAwLS41LS4yLS41LS41VjkuNEMxMiA5LjQgMTQuNiA2IDE3LjkgNi4yYy4xIDAgLjEgMCAuMSAxIDAgLjgtLjEgMS41LS4xIDIuMloiIGZpbGw9IiNmZmYiLz48Y2lyY2xlIGN4PSIxMCIgY3k9IjExLjUiIHI9IjEiIGZpbGw9IiNhYjlmZjQiLz48Y2lyY2xlIGN4PSIxNCIgY3k9IjExLjUiIHI9IjEiIGZpbGw9IiNhYjlmZjQiLz48L3N2Zz4=",
  },
  {
    name: "Solflare",
    url: "https://solflare.com",
    icon: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSIjMWIxYjFiIi8+PHBhdGggZD0iTTEyIDRsNyAxMi02IDQtNy0xMiA2LTRaIiBmaWxsPSIjZmM4MjFhIi8+PC9zdmc+",
  },
  {
    name: "Backpack",
    url: "https://backpack.app",
    icon: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSIjZTMzZTNmIi8+PHBhdGggZD0iTTggOGg4djJIOHoiIGZpbGw9IiNmZmYiLz48cmVjdCB4PSI3IiB5PSIxMSIgd2lkdGg9IjEwIiBoZWlnaHQ9IjYiIHJ4PSIxIiBmaWxsPSIjZmZmIi8+PC9zdmc+",
  },
];

interface WalletButtonProps {
  variant?: "header" | "cta";
}

function WalletRow({
  wallet,
  onConnected,
}: {
  wallet: UiWallet;
  onConnected: (account: UiWalletAccount) => void;
}) {
  const [isConnecting, connect] = useConnect(wallet);

  async function handleClick() {
    try {
      const accounts = await connect();
      if (accounts[0]) {
        onConnected(accounts[0]);
      }
    } catch {
      // User rejected or wallet error — do nothing
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isConnecting}
      className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-surface-high transition-colors disabled:opacity-50"
    >
      {wallet.icon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={wallet.icon}
          alt={wallet.name}
          width={28}
          height={28}
          className="rounded-sm"
        />
      )}
      <span className="text-[0.8rem] font-sans text-foreground">
        {wallet.name}
      </span>
      {isConnecting ? (
        <span className="ml-auto text-[0.65rem] text-foreground-muted animate-pulse">
          Connecting...
        </span>
      ) : (
        <span className="ml-auto text-[0.6rem] uppercase tracking-[0.05em] text-neon-primary font-sans font-medium">
          Detected
        </span>
      )}
    </button>
  );
}

function UndetectedWalletRow({
  name,
  icon,
  url,
}: {
  name: string;
  icon: string;
  url: string;
}) {
  return (
    <button
      onClick={() => window.open(url, "_blank")}
      className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-surface-high transition-colors"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={icon}
        alt={name}
        width={28}
        height={28}
        className="rounded-sm opacity-50"
      />
      <span className="text-[0.8rem] font-sans text-foreground-muted">
        {name}
      </span>
      <span className="ml-auto text-[0.6rem] uppercase tracking-[0.05em] text-foreground-muted font-sans">
        Install →
      </span>
    </button>
  );
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
  useEffect(() => {
    if (!open || !selectedAccount) return;

    function handleMouseDown(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open, selectedAccount]);

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

  // Undetected popular wallets
  const detectedNames = new Set(filteredWallets.map((w) => w.name));
  const undetectedWallets = POPULAR_WALLETS.filter(
    (pw) => !detectedNames.has(pw.name)
  );

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

  // Disconnected state: centered modal via createPortal
  const modal = open
    ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-[380px] max-w-[calc(100vw-2rem)] bg-surface-low/95 backdrop-blur-[16px] rounded-sm overflow-hidden"
            style={{ boxShadow: "0 10px 40px rgba(0,0,0,0.4)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4">
              <h2 className="font-display text-base tracking-[-0.02em] text-foreground">
                Connect Wallet
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="text-foreground-muted hover:text-foreground transition-colors text-lg leading-none"
              >
                ✕
              </button>
            </div>

            {/* Detected wallets */}
            {filteredWallets.length > 0 && (
              <div>
                {filteredWallets.map((wallet) => (
                  <WalletRow
                    key={wallet.name}
                    wallet={wallet}
                    onConnected={handleConnected}
                  />
                ))}
              </div>
            )}

            {/* Undetected popular wallets */}
            {undetectedWallets.length > 0 && (
              <div>
                {filteredWallets.length > 0 && (
                  <div className="px-5 pt-3 pb-1">
                    <p className="text-[0.6rem] uppercase tracking-[0.05em] text-foreground-muted font-sans">
                      More Wallets
                    </p>
                  </div>
                )}
                {undetectedWallets.map((pw) => (
                  <UndetectedWalletRow
                    key={pw.name}
                    name={pw.name}
                    icon={pw.icon}
                    url={pw.url}
                  />
                ))}
              </div>
            )}

            {/* No wallets at all */}
            {filteredWallets.length === 0 && undetectedWallets.length === 0 && (
              <div className="px-5 py-6 text-center">
                <p className="text-[0.8rem] font-sans text-foreground-muted">
                  No Solana wallets found
                </p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <button onClick={() => setOpen(!open)} className={buttonClass}>
        Connect Wallet
      </button>
      {modal}
    </>
  );
}
