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

export type BuildTxResult = Instruction[] | BuildTxResultWithLookups;

export function isBuildTxResultWithLookups(r: BuildTxResult): r is BuildTxResultWithLookups {
  return !Array.isArray(r) && "lookupTableAddresses" in r;
}

export interface ProtocolAdapter {
  buildDepositTx(params: BuildTxParams): Promise<BuildTxResult>;
  buildWithdrawTx(params: BuildTxParams): Promise<BuildTxResult>;
}
