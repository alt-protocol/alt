import type { Instruction } from "@solana/kit";
import type { TransactionSendingSigner } from "@solana/signers";

export interface BuildTxParams {
  signer: TransactionSendingSigner;
  depositAddress: string;
  amount: string;
  category: string;
  extraData?: Record<string, unknown>;
}

/** Extended result that includes address lookup tables (needed for Jupiter Multiply). */
export interface BuildTxResultWithLookups {
  instructions: Instruction[];
  lookupTableAddresses: string[];
}

/** Extended result with setup transactions (needed for Kamino Multiply user LUT creation). */
export interface BuildTxResultWithSetup {
  instructions: Instruction[];
  lookupTableAddresses: string[];
  /** Each element is a set of instructions for a separate setup tx (e.g. user LUT creation). */
  setupInstructionSets?: Instruction[][];
}

export type BuildTxResult = Instruction[] | BuildTxResultWithLookups | BuildTxResultWithSetup;

export function isBuildTxResultWithLookups(r: BuildTxResult): r is BuildTxResultWithLookups {
  return !Array.isArray(r) && "lookupTableAddresses" in r;
}

export function isBuildTxResultWithSetup(r: BuildTxResult): r is BuildTxResultWithSetup {
  return !Array.isArray(r) && "setupInstructionSets" in r;
}

export interface ProtocolAdapter {
  buildDepositTx(params: BuildTxParams): Promise<BuildTxResult>;
  buildWithdrawTx(params: BuildTxParams): Promise<BuildTxResult>;
}
