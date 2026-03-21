"use client";

import { useState, useCallback } from "react";
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signAndSendTransactionMessageWithSigners,
  createSolanaRpc,
  getBase58Decoder,
  signature,
} from "@solana/kit";
import type { Instruction } from "@solana/kit";
import type { TransactionSendingSigner } from "@solana/signers";
import { HELIUS_RPC_URL } from "../constants";

export type TxStatus = "idle" | "building" | "signing" | "confirming" | "success" | "error";

interface UseVaultTransactionReturn {
  execute: (buildIxs: () => Promise<Instruction[]>) => Promise<void>;
  status: TxStatus;
  error: string | null;
  txSignature: string | null;
  reset: () => void;
}

export function useVaultTransaction(
  signer: TransactionSendingSigner | null,
): UseVaultTransactionReturn {
  const [status, setStatus] = useState<TxStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setTxSignature(null);
  }, []);

  const execute = useCallback(
    async (buildIxs: () => Promise<Instruction[]>) => {
      if (!signer) {
        setError("Wallet not connected");
        setStatus("error");
        return;
      }

      try {
        setStatus("building");
        setError(null);
        setTxSignature(null);

        const instructions = await buildIxs();

        const rpc = createSolanaRpc(HELIUS_RPC_URL);
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

        setStatus("signing");

        const message = pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(signer, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
          (m) => appendTransactionMessageInstructions(instructions, m),
        );

        const signatureBytes = await signAndSendTransactionMessageWithSigners(message);

        setStatus("confirming");

        const sig = getBase58Decoder().decode(signatureBytes);
        setTxSignature(sig);

        // Confirm the transaction landed
        await rpc
          .getSignatureStatuses([signature(sig)])
          .send();

        setStatus("success");
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Transaction failed";
        if (msg.includes("User rejected") || msg.includes("rejected")) {
          setError("Transaction rejected by wallet");
        } else {
          setError(msg);
        }
        setStatus("error");
      }
    },
    [signer],
  );

  return { execute, status, error, txSignature, reset };
}
