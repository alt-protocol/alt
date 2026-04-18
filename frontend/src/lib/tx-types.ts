import type { Instruction } from "@solana/kit";

/** Extended result that includes address lookup tables. */
export interface BuildTxResultWithLookups {
  instructions: Instruction[];
  lookupTableAddresses: string[];
  metadata?: Record<string, unknown>;
}

/** Extended result with setup transactions (e.g. Kamino Multiply user LUT creation). */
export interface BuildTxResultWithSetup {
  instructions: Instruction[];
  lookupTableAddresses: string[];
  /** Each element is a set of instructions for a separate setup tx. */
  setupInstructionSets?: Instruction[][];
}

export type BuildTxResult =
  | Instruction[]
  | BuildTxResultWithLookups
  | BuildTxResultWithSetup;

export function isBuildTxResultWithLookups(
  r: BuildTxResult,
): r is BuildTxResultWithLookups {
  return !Array.isArray(r) && "lookupTableAddresses" in r;
}

export function isBuildTxResultWithSetup(
  r: BuildTxResult,
): r is BuildTxResultWithSetup {
  return !Array.isArray(r) && "setupInstructionSets" in r;
}

/** Withdrawal state for protocols with multi-step withdrawals (e.g. Drift vault redeem period). */
export interface WithdrawState {
  status: "none" | "pending" | "redeemable";
  message?: string;
  requestedAmount?: number;
}
