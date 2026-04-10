"use client";

import { createPortal } from "react-dom";
import {
  useConnect,
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
        <span className="ml-auto text-[0.6rem] uppercase tracking-[0.05em] text-neon font-sans font-medium">
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

interface WalletModalProps {
  filteredWallets: readonly UiWallet[];
  onConnected: (account: UiWalletAccount) => void;
  onClose: () => void;
}

export default function WalletModal({ filteredWallets, onConnected, onClose }: WalletModalProps) {
  const detectedNames = new Set(filteredWallets.map((w) => w.name));
  const undetectedWallets = POPULAR_WALLETS.filter(
    (pw) => !detectedNames.has(pw.name)
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
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
            onClick={onClose}
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
                onConnected={onConnected}
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
  );
}
