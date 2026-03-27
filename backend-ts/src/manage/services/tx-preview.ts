import { getRpc } from "../../shared/rpc.js";
import type { SerializableInstruction } from "../../shared/types.js";
import { logger } from "../../shared/logger.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111";
const SET_CU_PRICE_DISCRIMINATOR = 0x03;

export interface SimulationPreview {
  success: boolean;
  computeUnits: number | null;
  /** Estimated fee in lamports (base fee + priority fee). */
  fee: number | null;
  error: string | null;
  logs?: string[];
}

/**
 * Extract priority fee (microLamports per CU) from a setComputeUnitPrice
 * instruction in the built instructions. Returns 0 if not found.
 */
function extractPriorityFee(instructions: SerializableInstruction[]): number {
  for (const ix of instructions) {
    if (ix.programAddress !== COMPUTE_BUDGET_PROGRAM) continue;
    const data = Buffer.from(ix.data, "base64");
    if (data.length >= 9 && data[0] === SET_CU_PRICE_DISCRIMINATOR) {
      // 8-byte little-endian u64 microLamports
      return Number(data.readBigUInt64LE(1));
    }
  }
  return 0;
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
    const connection = new web3.Connection(process.env.HELIUS_RPC_URL!);

    let addressLookupTableAccounts: any[] = [];
    if (lookupTableAddresses?.length) {
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
    const simResult = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
    });

    const computeUnits = simResult.value.unitsConsumed ?? null;

    // Estimate fee: base fee (5000 lamports/sig) + priority fee from instructions
    let fee: number | null = null;
    if (computeUnits !== null) {
      const microLamports = extractPriorityFee(instructions);
      const priorityFee = Math.ceil(
        (computeUnits * microLamports) / 1_000_000,
      );
      fee = 5000 + priorityFee;
    }

    return {
      success: simResult.value.err === null,
      computeUnits,
      fee,
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
