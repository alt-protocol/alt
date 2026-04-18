import type { Instruction } from "@solana/kit";

export interface BuildTxParams {
  walletAddress: string;
  depositAddress: string;
  amount: string;
  category: string;
  extraData?: Record<string, unknown>;
}

/** Extended result that includes address lookup tables (needed for Multiply). */
export interface BuildTxResultWithLookups {
  instructions: Instruction[];
  lookupTableAddresses: string[];
  /** Protocol-specific metadata returned alongside the tx (e.g. Jupiter nftId). */
  metadata?: Record<string, unknown>;
}

/** Extended result with setup transactions (needed for Kamino Multiply user LUT creation). */
export interface BuildTxResultWithSetup {
  instructions: Instruction[];
  lookupTableAddresses: string[];
  /** Each element is a set of instructions for a separate setup tx (e.g. user LUT creation). */
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

export interface GetBalanceParams {
  walletAddress: string;
  depositAddress: string;
  category: string;
  extraData?: Record<string, unknown>;
}

/** Withdrawal state for protocols with multi-step withdrawals (e.g. Drift vault redeem period). */
export interface WithdrawState {
  /** "none" = no pending request, "pending" = waiting for redeem period, "redeemable" = ready to complete. */
  status: "none" | "pending" | "redeemable";
  /** Human-readable message for the user. */
  message?: string;
  /** Token-denominated amount locked in pending withdrawal. */
  requestedAmount?: number;
}

export interface ProtocolAdapter {
  buildDepositTx(params: BuildTxParams): Promise<BuildTxResult>;
  buildWithdrawTx(params: BuildTxParams): Promise<BuildTxResult>;
  /** Optional: protocol-specific balance fetching (e.g. Kamino vault shares -> USD). */
  getBalance?(params: GetBalanceParams): Promise<number | null>;
  /** Optional: query multi-step withdrawal state (e.g. Drift vault redeem period). */
  getWithdrawState?(params: GetBalanceParams): Promise<WithdrawState>;
}
