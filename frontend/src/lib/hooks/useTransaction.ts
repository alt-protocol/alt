"use client";

import { useState, useCallback } from "react";
import {
  compressTransactionMessageUsingAddressLookupTables,
  signAndSendTransactionMessageWithSigners,
  fetchAddressesForLookupTables,
  getBase58Decoder,
  signature,
  address,
} from "@solana/kit";
import type { Instruction } from "@solana/kit";
import type { TransactionSendingSigner } from "@solana/signers";
import type { BuildTxResult } from "../tx-types";
import { isBuildTxResultWithSetup, isBuildTxResultWithLookups } from "../tx-types";
import { getRpc } from "../rpc";
import { buildTransactionMessage, mapTxError } from "../transaction-utils";

export type TxStatus =
  | "idle"
  | "preparing"
  | "building"
  | "signing"
  | "confirming"
  | "success"
  | "error";

interface UseTransactionReturn {
  execute: (buildIxs: () => Promise<BuildTxResult>) => Promise<boolean>;
  status: TxStatus;
  error: string | null;
  txSignature: string | null;
  reset: () => void;
}

const LUT_WARMUP_MS = 2000;

/**
 * Unified transaction hook for all categories.
 * Handles simple flows (building → signing → confirming) and
 * multi-step flows with setup transactions (preparing → building → signing → confirming).
 */
export function useTransaction(
  signer: TransactionSendingSigner | null,
): UseTransactionReturn {
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

        const rpc = getRpc();

        /* Phase 1: Setup transactions — skip empty arrays */
        const nonEmptySetups = setupInstructionSets.filter((ixs) => ixs.length > 0);
        if (nonEmptySetups.length > 0) {
          setStatus("preparing");

          for (const setupIxs of nonEmptySetups) {
            const { value: setupBlockhash } = await rpc
              .getLatestBlockhash({ commitment: "finalized" })
              .send();

            const setupTx = buildTransactionMessage(signer, setupBlockhash, setupIxs);
            const setupSigBytes = await signAndSendTransactionMessageWithSigners(setupTx);
            const setupSig = getBase58Decoder().decode(setupSigBytes);

            await rpc.getSignatureStatuses([signature(setupSig)]).send();
            await new Promise((resolve) => setTimeout(resolve, LUT_WARMUP_MS));
          }
        }

        /* Phase 2: Main transaction */
        setStatus("signing");

        // Fetch blockhash + ALT data in parallel (independent RPC calls → halves latency)
        const altAddresses = lookupTableAddresses.length > 0
          ? lookupTableAddresses.map((a) => address(a))
          : [];

        const [{ value: latestBlockhash }, lookups] = await Promise.all([
          rpc.getLatestBlockhash().send(),
          altAddresses.length > 0
            ? fetchAddressesForLookupTables(altAddresses, rpc)
            : Promise.resolve({} as Awaited<ReturnType<typeof fetchAddressesForLookupTables>>),
        ]);

        let message = buildTransactionMessage(signer, latestBlockhash, instructions);

        if (altAddresses.length > 0) {
          if (Object.keys(lookups).length === 0) {
            throw new Error("Failed to load address lookup tables. Please try again.");
          }
          message = compressTransactionMessageUsingAddressLookupTables(message, lookups) as typeof message;
        }

        const signatureBytes = await signAndSendTransactionMessageWithSigners(message);

        setStatus("confirming");

        const sig: string = getBase58Decoder().decode(signatureBytes);
        setTxSignature(sig);

        const statuses = await rpc.getSignatureStatuses([signature(sig)]).send();
        const txErr = statuses.value[0]?.err;
        if (txErr) {
          throw new Error(`Transaction failed on-chain: ${JSON.stringify(txErr)}`);
        }

        setStatus("success");
        return true;
      } catch (err) {
        setError(mapTxError(err));
        setStatus("error");
        return false;
      }
    },
    [signer],
  );

  return { execute, status, error, txSignature, reset };
}
