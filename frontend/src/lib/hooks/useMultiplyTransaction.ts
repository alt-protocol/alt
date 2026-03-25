"use client";

import { useState, useCallback } from "react";
import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  signAndSendTransactionMessageWithSigners,
  createSolanaRpc,
  getBase58Decoder,
  signature,
  address,
} from "@solana/kit";
import { fetchAllAddressLookupTable } from "@solana-program/address-lookup-table";
import type { Instruction } from "@solana/kit";
import type { TransactionSendingSigner } from "@solana/signers";
import type { BuildTxResult } from "../protocols/types";
import { isBuildTxResultWithSetup, isBuildTxResultWithLookups } from "../protocols/types";
import { HELIUS_RPC_URL } from "../constants";

export type MultiplyTxStatus =
  | "idle"
  | "preparing"
  | "building"
  | "signing"
  | "confirming"
  | "success"
  | "error";

interface UseMultiplyTransactionReturn {
  execute: (buildIxs: () => Promise<BuildTxResult>) => Promise<void>;
  status: MultiplyTxStatus;
  error: string | null;
  txSignature: string | null;
  reset: () => void;
}

const LUT_WARMUP_MS = 2000;

/**
 * Transaction hook for Kamino Multiply operations.
 *
 * Extends the useVaultTransaction pattern with a "preparing" phase
 * that handles setup transactions (user LUT creation/extension)
 * before building and sending the main multiply transaction.
 */
export function useMultiplyTransaction(
  signer: TransactionSendingSigner | null,
): UseMultiplyTransactionReturn {
  const [status, setStatus] = useState<MultiplyTxStatus>("idle");
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
        return;
      }

      try {
        setStatus("building");
        setError(null);
        setTxSignature(null);

        const result = await buildIxs();

        let instructions: Instruction[];
        let lookupTableAddresses: string[] = [];
        let setupInstructionSets: Instruction[][] = [];

        if (isBuildTxResultWithSetup(result)) {
          instructions = result.instructions;
          lookupTableAddresses = result.lookupTableAddresses;
          setupInstructionSets = result.setupInstructionSets ?? [];
        } else if (isBuildTxResultWithLookups(result)) {
          instructions = result.instructions;
          lookupTableAddresses = result.lookupTableAddresses;
        } else {
          instructions = result;
        }

        const rpc = createSolanaRpc(HELIUS_RPC_URL);

        // Phase 1: Send setup transactions (user LUT creation/extension)
        if (setupInstructionSets.length > 0) {
          setStatus("preparing");

          for (const setupIxs of setupInstructionSets) {
            const { value: setupBlockhash } = await rpc
              .getLatestBlockhash({ commitment: "finalized" })
              .send();

            const setupTx = pipe(
              createTransactionMessage({ version: 0 }),
              (tx) => setTransactionMessageFeePayerSigner(signer, tx),
              (tx) => setTransactionMessageLifetimeUsingBlockhash(setupBlockhash, tx),
              (tx) => appendTransactionMessageInstructions(setupIxs, tx),
            );

            const setupSigBytes = await signAndSendTransactionMessageWithSigners(setupTx);
            const setupSig = getBase58Decoder().decode(setupSigBytes);

            // Wait for confirmation + LUT warmup
            await rpc.getSignatureStatuses([signature(setupSig)]).send();
            await new Promise((resolve) => setTimeout(resolve, LUT_WARMUP_MS));
          }
        }

        // Phase 2: Build and send main transaction
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

        setStatus("signing");

        let message = pipe(
          createTransactionMessage({ version: 0 }),
          (m) => setTransactionMessageFeePayerSigner(signer, m),
          (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
          (m) => appendTransactionMessageInstructions(instructions, m),
        );

        // Compress with address lookup tables
        if (lookupTableAddresses.length > 0) {
          const altAddresses = lookupTableAddresses.map((a) => address(a));
          const lutAccounts = await fetchAllAddressLookupTable(rpc, altAddresses);

          // Build lutsByAddress map for compression
          const lutsByAddress: Record<string, readonly string[]> = {};
          for (const acc of lutAccounts) {
            lutsByAddress[acc.address as string] = acc.data.addresses as unknown as string[];
          }

          message = compressTransactionMessageUsingAddressLookupTables(
            message,
            lutsByAddress as any,
          ) as typeof message;
        }

        const signatureBytes = await signAndSendTransactionMessageWithSigners(message);

        setStatus("confirming");

        const sig = getBase58Decoder().decode(signatureBytes);
        setTxSignature(sig);

        await rpc.getSignatureStatuses([signature(sig)]).send();

        setStatus("success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Transaction failed";
        if (msg.includes("User rejected") || msg.includes("user reject")) {
          setError("Transaction rejected by wallet");
        } else if (msg.includes("Simulation") || msg.includes("simulation") || msg.includes("SimulationError")) {
          setError("Transaction simulation failed — check amount and balance");
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
