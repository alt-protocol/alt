"use client";

import { useMemo } from "react";
import { useSelectedWalletAccount } from "@solana/react";
import {
  useWallets,
  getWalletAccountFeature,
} from "@wallet-standard/react-core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySignTransactionFeature = {
  signTransaction: (
    ...inputs: {
      transaction: Uint8Array;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      account: any;
      chain?: string;
    }[]
  ) => Promise<{ signedTransaction: Uint8Array }[]>;
};

/**
 * Maps @solana/react (Wallet Standard) wallet state to the legacy
 * @solana/wallet-adapter-react format that Jupiter widget expects
 * for passthroughWalletContextState.
 */
export function useJupiterWalletPassthrough() {
  const [selectedAccount] = useSelectedWalletAccount();
  const wallets = useWallets();

  return useMemo(() => {
    if (!selectedAccount) {
      return {
        publicKey: null,
        connected: false,
        connecting: false,
        signTransaction: undefined,
        signAllTransactions: undefined,
        wallet: null,
      };
    }

    // Find the UiWallet that owns this account (needed for name/icon)
    const wallet = wallets.find((w) =>
      w.accounts.some((a) => a.address === selectedAccount.address),
    );

    // Duck-typed PublicKey compatible with web3.js v1
    const publicKey = {
      toBase58: () => selectedAccount.address,
      toString: () => selectedAccount.address,
      equals: (other: unknown) => {
        if (!other || typeof other !== "object") return false;
        const o = other as Record<string, unknown>;
        if (typeof o.toBase58 === "function")
          return selectedAccount.address === (o.toBase58 as () => string)();
        return false;
      },
    };

    // Access the actual signTransaction feature via Wallet Standard
    const featureName = "solana:signTransaction";
    const hasSignTx = (selectedAccount.features as readonly string[]).includes(
      featureName,
    );

    let signFeature: AnySignTransactionFeature | undefined;
    if (hasSignTx) {
      try {
        signFeature = getWalletAccountFeature(
          selectedAccount,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          featureName as any,
        ) as AnySignTransactionFeature;
      } catch {
        // Feature not available
      }
    }

    const signTransaction = signFeature
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (tx: any) => {
          const isVersioned = tx.version !== undefined;

          const serialized: Uint8Array = isVersioned
            ? tx.serialize()
            : tx.serialize({
                requireAllSignatures: false,
                verifySignatures: false,
              });

          const [result] = await signFeature.signTransaction({
            transaction: new Uint8Array(serialized),
            account: selectedAccount,
            chain: "solana:mainnet",
          });

          // Deserialize using the widget's bundled web3.js class
          const TxClass = tx.constructor;
          if (isVersioned && TxClass.deserialize) {
            return TxClass.deserialize(result.signedTransaction);
          }
          if (TxClass.from) {
            return TxClass.from(result.signedTransaction);
          }
          throw new Error("Unable to deserialize signed transaction");
        }
      : undefined;

    const signAllTransactions = signTransaction
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async (txs: any[]) => Promise.all(txs.map((tx) => signTransaction(tx)))
      : undefined;

    return {
      publicKey,
      connected: true,
      connecting: false,
      signTransaction,
      signAllTransactions,
      wallet: {
        adapter: {
          name: wallet?.name ?? "Unknown",
          icon: wallet?.icon,
          publicKey,
        },
      },
    };
  }, [selectedAccount, wallets]);
}
