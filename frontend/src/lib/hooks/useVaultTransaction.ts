"use client";

import { useState, useCallback } from "react";
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  fetchAddressesForLookupTables,
  signAndSendTransactionMessageWithSigners,
  createSolanaRpc,
  getBase58Decoder,
  signature,
  address,
} from "@solana/kit";
import type { Instruction } from "@solana/kit";
import type { TransactionSendingSigner } from "@solana/signers";
import type { BuildTxResult } from "../protocols/types";
import { isBuildTxResultWithLookups } from "../protocols/types";
import { HELIUS_RPC_URL } from "../constants";

export type TxStatus = "idle" | "building" | "signing" | "confirming" | "success" | "error";

interface UseVaultTransactionReturn {
  execute: (buildIxs: () => Promise<BuildTxResult>) => Promise<boolean>;
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
    async (buildIxs: () => Promise<BuildTxResult>) => {
      if (!signer) {
        setError("Wallet not connected");
        setStatus("error");
        return false;
      }

      try {
        setStatus("building");
        setError(null);
        setTxSignature(null);

        const result = await buildIxs();

        let instructions: Instruction[];
        let lookupTableAddresses: string[] = [];

        if (isBuildTxResultWithLookups(result)) {
          instructions = result.instructions;
          lookupTableAddresses = result.lookupTableAddresses;
        } else {
          instructions = result;
        }

        const rpc = createSolanaRpc(HELIUS_RPC_URL);
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

        setStatus("signing");

        let message = pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(signer, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
          (m) => appendTransactionMessageInstructions(instructions, m),
        );

        // Compress with address lookup tables if provided (e.g. Multiply)
        if (lookupTableAddresses.length > 0) {
          const altAddresses = lookupTableAddresses.map((a) => address(a));
          const lookups = await fetchAddressesForLookupTables(altAddresses, rpc);
          message = compressTransactionMessageUsingAddressLookupTables(message, lookups) as typeof message;
        }

        const signatureBytes = await signAndSendTransactionMessageWithSigners(message);

        setStatus("confirming");

        const sig = getBase58Decoder().decode(signatureBytes);
        setTxSignature(sig);

        // Confirm the transaction landed
        await rpc
          .getSignatureStatuses([signature(sig)])
          .send();

        setStatus("success");
        return true;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Transaction failed";
        if (msg.includes("User rejected") || msg.includes("user reject")) {
          setError("Transaction rejected by wallet");
        } else if (msg.includes("Simulation") || msg.includes("simulation") || msg.includes("SimulationError")) {
          setError("Transaction simulation failed — check amount and balance");
        } else {
          setError(msg);
        }
        setStatus("error");
        return false;
      }
    },
    [signer],
  );

  return { execute, status, error, txSignature, reset };
}
