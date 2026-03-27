import type { Instruction } from "@solana/kit";
import type { SerializableInstruction } from "../../shared/types.js";
import {
  isBuildTxResultWithLookups,
  isBuildTxResultWithSetup,
} from "../protocols/types.js";
import type { BuildTxResult } from "../protocols/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Convert a @solana/kit Instruction to a JSON-safe SerializableInstruction. */
export function serializeInstruction(ix: Instruction): SerializableInstruction {
  return {
    programAddress: ix.programAddress as string,
    accounts: (ix.accounts as any[]).map((acc) => ({
      address: acc.address as string,
      role: acc.role as number,
    })),
    data: Buffer.from(ix.data as Uint8Array).toString("base64"),
  };
}

export interface SerializedBuildResult {
  instructions: SerializableInstruction[];
  lookupTableAddresses?: string[];
  setupInstructionSets?: SerializableInstruction[][];
}

/** Serialize any BuildTxResult variant to JSON-safe format. */
export function serializeResult(result: BuildTxResult): SerializedBuildResult {
  if (Array.isArray(result)) {
    return { instructions: result.map(serializeInstruction) };
  }

  const base: SerializedBuildResult = {
    instructions: result.instructions.map(serializeInstruction),
  };

  if (isBuildTxResultWithLookups(result) || isBuildTxResultWithSetup(result)) {
    base.lookupTableAddresses = result.lookupTableAddresses;
  }

  if (isBuildTxResultWithSetup(result) && result.setupInstructionSets) {
    base.setupInstructionSets = result.setupInstructionSets.map((set) =>
      set.map(serializeInstruction),
    );
  }

  return base;
}
