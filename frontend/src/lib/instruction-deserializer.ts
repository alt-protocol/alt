import type { Instruction } from "@solana/kit";
import { address } from "@solana/kit";
import type { BuildTxResult } from "./tx-types";

/** JSON-safe instruction format received from the Manage API. */
export interface SerializableInstruction {
  programAddress: string;
  accounts: Array<{ address: string; role: number }>;
  data: string; // base64
}

/** Deserialize a single API instruction to @solana/kit Instruction. */
export function deserializeInstruction(ix: SerializableInstruction): Instruction {
  return {
    programAddress: address(ix.programAddress),
    accounts: ix.accounts.map((a) => ({
      address: address(a.address),
      role: a.role,
    })),
    data: new Uint8Array(Buffer.from(ix.data, "base64")),
  } as unknown as Instruction;
}

/** Deserialize an array of API instructions. */
export function deserializeInstructions(
  ixs: SerializableInstruction[],
): Instruction[] {
  return ixs.map(deserializeInstruction);
}

/** API response shape from POST /api/manage/tx/build-deposit or build-withdraw. */
export interface BuildTxApiResponse {
  instructions: SerializableInstruction[];
  lookupTableAddresses?: string[];
  setupInstructionSets?: SerializableInstruction[][];
}

/** Convert a full API build response to a BuildTxResult for useTransaction. */
export function deserializeBuildResponse(response: BuildTxApiResponse): BuildTxResult {
  const instructions = deserializeInstructions(response.instructions);

  if (response.setupInstructionSets?.length) {
    return {
      instructions,
      lookupTableAddresses: response.lookupTableAddresses ?? [],
      setupInstructionSets: response.setupInstructionSets.map(deserializeInstructions),
    };
  }

  if (response.lookupTableAddresses?.length) {
    return {
      instructions,
      lookupTableAddresses: response.lookupTableAddresses,
    };
  }

  return instructions;
}
