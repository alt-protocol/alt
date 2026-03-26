import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
} from "@solana/kit";
import type { Instruction } from "@solana/kit";
import type { TransactionSendingSigner } from "@solana/signers";

/**
 * Build a v0 transaction message with signer, blockhash, and instructions.
 * Shared by useTransaction hook.
 */
export function buildTransactionMessage(
  signer: TransactionSendingSigner,
  blockhash: Parameters<typeof setTransactionMessageLifetimeUsingBlockhash>[0],
  instructions: Instruction[],
) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}

/** Status label for any transaction status (unified hook). */
export function getTxStatusLabel(status: string): string | null {
  switch (status) {
    case "preparing": return "Setting up...";
    case "building": return "Building transaction...";
    case "signing": return "Approve in wallet...";
    case "confirming": return "Confirming...";
    default: return null;
  }
}

/**
 * Map a caught transaction error to a user-friendly message.
 */
export function mapTxError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Transaction failed";
  if (msg.includes("User rejected") || msg.includes("user reject")) {
    return "Transaction rejected by wallet";
  }
  if (msg.includes("Simulation") || msg.includes("simulation") || msg.includes("SimulationError")) {
    return "Transaction simulation failed — check amount and balance";
  }
  return msg;
}
