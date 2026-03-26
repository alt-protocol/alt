"use client";

import { useState, useCallback } from "react";
import {
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

        const rpc = createSolanaRpc(HELIUS_RPC_URL);

        /* Phase 1: Setup transactions (e.g. user LUT creation) */
        if (setupInstructionSets.length > 0) {
          setStatus("preparing");

          for (const setupIxs of setupInstructionSets) {
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
        const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

        setStatus("signing");

        let message = buildTransactionMessage(signer, latestBlockhash, instructions);

        if (lookupTableAddresses.length > 0) {
          const altAddresses = lookupTableAddresses.map((a) => address(a));
          const lutAccounts = await fetchAllAddressLookupTable(rpc, altAddresses);

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
