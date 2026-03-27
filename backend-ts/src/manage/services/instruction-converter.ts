import type { Address, Instruction } from "@solana/kit";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Convert a legacy @solana/web3.js TransactionInstruction to @solana/kit Instruction.
 * Used by drift.ts and jupiter.ts where SDK returns legacy PublicKey objects.
 *
 * Legacy shape: { keys: [{pubkey, isSigner, isWritable}], programId, data }
 * Kit shape:    { accounts: [{address, role}], programAddress, data }
 *
 * AccountRole: 0=readonly, 1=writable, 2=readonly+signer, 3=writable+signer
 */
export function convertLegacyInstruction(ix: any): Instruction {
  return {
    programAddress: ix.programId.toBase58(),
    accounts: ix.keys.map((k: any) => ({
      address: k.pubkey.toBase58(),
      role: k.isWritable ? (k.isSigner ? 3 : 1) : k.isSigner ? 2 : 0,
    })),
    data: new Uint8Array(ix.data),
  } as unknown as Instruction;
}

/**
 * Convert a Jupiter API instruction JSON to @solana/kit Instruction.
 * Jupiter returns: { programId, accounts: [{pubkey, isSigner, isWritable}], data (base64) }
 * Addresses are already strings, data is base64-encoded.
 */
export function convertJupiterApiInstruction(ix: any): Instruction {
  const accounts = ix.accounts.map((acc: any) => ({
    address: acc.pubkey as Address,
    role:
      acc.isSigner && acc.isWritable
        ? 3 // WRITABLE_SIGNER
        : acc.isSigner
          ? 2 // READONLY_SIGNER
          : acc.isWritable
            ? 1 // WRITABLE
            : 0, // READONLY
  }));

  return {
    programAddress: ix.programId as Address,
    accounts,
    data: Buffer.from(ix.data, "base64"),
  } as unknown as Instruction;
}
