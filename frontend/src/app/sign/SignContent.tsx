"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useSelectedWalletAccount } from "@solana/react";
import { getWalletAccountFeature } from "@wallet-standard/react-core";
import { api } from "@/lib/api";
import WalletButton from "@/components/WalletButton";

interface ActionMetadata {
  icon: string;
  title: string;
  description: string;
  label: string;
}

type Status = "idle" | "loading" | "preparing" | "signing" | "submitted" | "error";

type SignAndSendFeature = {
  signAndSendTransaction: (
    ...inputs: {
      transaction: Uint8Array;
      account: ReturnType<typeof useSelectedWalletAccount>[0];
      chain: string;
    }[]
  ) => Promise<readonly { signature: Uint8Array }[]>;
};

const SETUP_TX_WARMUP_MS = 2000;

export default function SignContent() {
  const searchParams = useSearchParams();
  // Reconstruct action URL if it was truncated during copy-paste.
  // When %26 gets decoded to & before pasting, the browser parses
  // amount/leverage/etc. as sign-page params instead of action URL params.
  const rawAction = searchParams.get("action");
  const actionUrl = (() => {
    if (!rawAction) return null;
    const actionParams = [
      "amount", "leverage", "slippageBps", "wallet",
      "isClosingPosition", "position_id", "deposit_token",
    ];
    const extra = new URLSearchParams();
    for (const key of actionParams) {
      const val = searchParams.get(key);
      if (val && !rawAction.includes(`${key}=`)) {
        extra.set(key, val);
      }
    }
    if (extra.toString()) {
      return rawAction + (rawAction.includes("?") ? "&" : "?") + extra.toString();
    }
    return rawAction;
  })();

  const [selectedAccount] = useSelectedWalletAccount();

  const [metadata, setMetadata] = useState<ActionMetadata | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  useEffect(() => {
    if (!actionUrl) return;
    setStatus("loading");
    fetch(actionUrl, { headers: { Accept: "application/json" } })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || `Failed to load action (${res.status})`);
        return data as ActionMetadata;
      })
      .then((data) => {
        setMetadata(data);
        setStatus("idle");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load action");
        setStatus("error");
      });
  }, [actionUrl]);

  const handleSign = useCallback(async () => {
    if (!actionUrl || !selectedAccount) return;

    setStatus("signing");
    setError(null);
    setStatusDetail(null);

    try {
      const walletAddress = selectedAccount.address;

      // Check wallet supports signAndSendTransaction
      const featureName = "solana:signAndSendTransaction";
      const hasFeature = (selectedAccount.features as readonly string[]).includes(featureName);
      if (!hasFeature) {
        throw new Error("Your wallet does not support signAndSendTransaction. Try Phantom or Solflare.");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const feature = getWalletAccountFeature(selectedAccount, featureName as any) as SignAndSendFeature;

      // POST to action endpoint — gets unsigned base64 transaction
      const res = await fetch(actionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: walletAddress }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || `Transaction build failed (${res.status})`);
      }

      const txBase64: string | undefined = data.transaction;
      if (!txBase64) throw new Error("No transaction returned");

      // Sign setup transactions first (e.g., LUT creation for multiply)
      const setupTxs: string[] | undefined = data.setup_transactions;
      if (setupTxs?.length) {
        setStatus("preparing");
        for (let i = 0; i < setupTxs.length; i++) {
          setStatusDetail(`Step ${i + 1} of ${setupTxs.length + 1}`);
          const setupBytes = Uint8Array.from(atob(setupTxs[i]), (c) => c.charCodeAt(0));
          await feature.signAndSendTransaction({
            transaction: new Uint8Array(setupBytes),
            account: selectedAccount,
            chain: "solana:mainnet",
          });
          await new Promise((resolve) => setTimeout(resolve, SETUP_TX_WARMUP_MS));
        }
        setStatus("signing");
        setStatusDetail(`Step ${setupTxs.length + 1} of ${setupTxs.length + 1}`);
      }

      // Decode base64 to bytes and sign main transaction
      const txBytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));

      const [result] = await feature.signAndSendTransaction({
        transaction: new Uint8Array(txBytes),
        account: selectedAccount,
        chain: "solana:mainnet",
      });

      // Convert signature bytes to base58 string
      const { getBase58Decoder } = await import("@solana/kit");
      const sigStr = getBase58Decoder().decode(result.signature);
      setSignature(sigStr);
      setStatus("submitted");
      setStatusDetail(null);

      // Sync position to portfolio so it reflects immediately
      try {
        const url = new URL(actionUrl, window.location.origin);
        const oppId = url.searchParams.get("opportunity_id");
        if (oppId && selectedAccount) {
          api.syncPosition(selectedAccount.address, parseInt(oppId, 10)).catch(() => {});
        }
      } catch { /* non-critical */ }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Signing failed";
      setError(msg.includes("User rejected") ? "Transaction rejected by user" : msg);
      setStatus("error");
      setStatusDetail(null);
    }
  }, [actionUrl, selectedAccount]);

  if (!actionUrl) {
    return (
      <div className="max-w-md w-full bg-surface-low rounded-sm p-8 text-center">
        <h1 className="font-headline text-xl mb-2">Missing Action</h1>
        <p className="text-foreground-muted text-sm">
          No action URL provided. Add <code className="text-neon">?action=...</code> to the URL.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md w-full bg-surface-low rounded-sm p-6">
      <div className="text-center mb-6">
        <span className="font-brand text-neon text-sm tracking-[0.02em]">AKASHI</span>
      </div>

      {status === "loading" && !metadata && (
        <div className="text-center py-8">
          <p className="text-foreground-muted text-sm">Loading action...</p>
        </div>
      )}

      {metadata && (
        <div className="space-y-4">
          {metadata.icon && (
            <div className="flex justify-center">
              <img
                src={metadata.icon}
                alt=""
                className="w-12 h-12 rounded-sm"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          )}
          <h1 className="font-headline text-lg text-center">{metadata.title}</h1>
          <p className="text-foreground-muted text-sm text-center">
            {metadata.description}
          </p>

          {!selectedAccount && (
            <div className="pt-2">
              <WalletButton variant="cta" />
            </div>
          )}

          {selectedAccount && status !== "submitted" && (
            <button
              onClick={handleSign}
              disabled={status === "signing" || status === "preparing"}
              className="w-full py-3 bg-neon text-surface font-sans text-sm font-semibold rounded-sm hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {status === "preparing"
                ? `Preparing${statusDetail ? ` (${statusDetail})` : ""}...`
                : status === "signing"
                  ? `Waiting for wallet${statusDetail ? ` (${statusDetail})` : ""}...`
                  : metadata.label || "Sign Transaction"}
            </button>
          )}

          {status === "submitted" && signature && (
            <div className="space-y-3 pt-2">
              <div className="bg-green-900/20 text-green-400 text-sm p-3 rounded-sm text-center">
                Transaction submitted
              </div>
              <a
                href={`https://solscan.io/tx/${signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-neon text-sm underline underline-offset-4"
              >
                View on Solscan
              </a>
            </div>
          )}

          {error && status === "error" && (
            <div className="space-y-2">
              <div className="bg-red-900/20 text-red-400 text-sm p-3 rounded-sm">
                {error}
              </div>
              <button
                onClick={() => {
                  setError(null);
                  setStatus("idle");
                }}
                className="w-full py-2 text-foreground-muted text-sm hover:text-foreground transition-colors"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
