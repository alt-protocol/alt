import type { Instruction } from "@solana/kit";
import type { TransactionSendingSigner } from "@solana/signers";

export interface BuildTxParams {
  signer: TransactionSendingSigner;
  depositAddress: string;
  amount: string;
  category: string;
  extraData?: Record<string, unknown>;
}

export interface ProtocolAdapter {
  buildDepositTx(params: BuildTxParams): Promise<Instruction[]>;
  buildWithdrawTx(params: BuildTxParams): Promise<Instruction[]>;
}
