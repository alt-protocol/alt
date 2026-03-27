import { getRpc } from "../../shared/rpc.js";
import type { SerializableInstruction } from "../../shared/types.js";
import { logger } from "../../shared/logger.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SimulationPreview {
  success: boolean;
  computeUnits: number | null;
  fee: number | null;
  error: string | null;
  logs?: string[];
}

/**
 * Simulate a transaction to preview compute units, fees, and potential errors.
 *
 * Builds a v0 transaction message from the serialized instructions,
 * then calls simulateTransaction via the shared RPC.
 */
export async function simulateTransaction(
  instructions: SerializableInstruction[],
  walletAddress: string,
  lookupTableAddresses?: string[],
): Promise<SimulationPreview> {
  try {
    const web3 = await import("@solana/web3.js");
    const rpc = getRpc();

    // Get recent blockhash
    const { value: blockhash } = await (rpc as any)
      .getLatestBlockhash()
      .send();

    // Convert serialized instructions back to legacy TransactionInstruction
    const legacyIxs = instructions.map((ix) => {
      return new web3.TransactionInstruction({
        programId: new web3.PublicKey(ix.programAddress),
        keys: ix.accounts.map((acc) => ({
          pubkey: new web3.PublicKey(acc.address),
          isSigner: acc.role >= 2,
          isWritable: acc.role === 1 || acc.role === 3,
        })),
        data: Buffer.from(ix.data, "base64"),
      });
    });

    // Build v0 message
    const payer = new web3.PublicKey(walletAddress);

    let addressLookupTableAccounts: any[] = [];
    if (lookupTableAddresses?.length) {
      const connection = new web3.Connection(process.env.HELIUS_RPC_URL!);
      const lutPromises = lookupTableAddresses.map(async (addr: string) => {
        const info = await connection.getAddressLookupTable(
          new web3.PublicKey(addr),
        );
        return info.value;
      });
      const results = await Promise.all(lutPromises);
      addressLookupTableAccounts = results.filter(
        (v: any) => v !== null,
      );
    }

    const messageV0 = new web3.TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash.blockhash,
      instructions: legacyIxs,
    }).compileToV0Message(addressLookupTableAccounts);

    const tx = new web3.VersionedTransaction(messageV0);

    // Simulate (unsigned — RPC supports sigVerify: false)
    const connection = new web3.Connection(process.env.HELIUS_RPC_URL!);
    const simResult = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });

    return {
      success: simResult.value.err === null,
      computeUnits: simResult.value.unitsConsumed ?? null,
      fee: null, // Fee estimation requires commitment level
      error: simResult.value.err
        ? JSON.stringify(simResult.value.err)
        : null,
      logs: simResult.value.logs ?? undefined,
    };
  } catch (err: any) {
    logger.warn({ err }, "Simulation failed");
    return {
      success: false,
      computeUnits: null,
      fee: null,
      error: err.message ?? "Simulation failed",
    };
  }
}
