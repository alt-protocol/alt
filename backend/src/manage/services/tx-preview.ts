import { getLegacyConnection } from "../../shared/rpc.js";
import type { SerializableInstruction } from "../../shared/types.js";
import { logger } from "../../shared/logger.js";
import { buildRawTransaction } from "./tx-assembler.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
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
 * Uses the shared assembleTransaction() to build a v0 transaction,
 * then calls simulateTransaction via legacy RPC.
 */
export async function simulateTransaction(
  instructions: SerializableInstruction[],
  walletAddress: string,
  lookupTableAddresses?: string[],
): Promise<SimulationPreview> {
  try {
    // Build the raw unsigned transaction (no serialize→deserialize roundtrip)
    const raw = await buildRawTransaction(
      instructions,
      walletAddress,
      lookupTableAddresses,
    );
    const tx = raw.tx;

    // Simulate (unsigned — RPC supports sigVerify: false)
    const connection = await getLegacyConnection();
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
