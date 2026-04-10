import { getRpc } from "../../shared/rpc.js";
import { getLegacyConnection } from "../../shared/rpc.js";
import type { SerializableInstruction } from "../../shared/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface RawTransaction {
  /** Unsigned VersionedTransaction object (for simulation / direct use). */
  tx: any; // VersionedTransaction
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface AssembledTransaction {
  /** Base64-encoded unsigned VersionedTransaction (v0). */
  transaction: string;
  /** The blockhash used — needed for confirmation polling. */
  blockhash: string;
  /** Block height after which the transaction expires. */
  lastValidBlockHeight: number;
}

/**
 * Build an unsigned VersionedTransaction (v0) from serialized instructions.
 * Returns the raw tx object — use this when you need the tx for simulation.
 */
export async function buildRawTransaction(
  instructions: SerializableInstruction[],
  walletAddress: string,
  lookupTableAddresses?: string[],
): Promise<RawTransaction> {
  const web3 = await import("@solana/web3.js");
  const rpc = getRpc();

  // 1. Fetch latest blockhash
  const { value: blockhashInfo } = await (rpc as any)
    .getLatestBlockhash()
    .send();

  // 2. Convert serialized instructions to legacy TransactionInstruction
  const legacyIxs = instructions.map((ix) => {
    return new web3.TransactionInstruction({
      programId: new web3.PublicKey(ix.programAddress),
      keys: ix.accounts.map((acc) => ({
        pubkey: new web3.PublicKey(acc.address),
        isSigner: acc.role >= 2,
        isWritable: acc.role === 1 || acc.role === 3,
      })),
      data: Buffer.from(ix.data, "base64"),
    });
  });

  // 3. Load address lookup tables if provided
  const connection = await getLegacyConnection();
  let addressLookupTableAccounts: any[] = [];
  if (lookupTableAddresses?.length) {
    const lutPromises = lookupTableAddresses.map(async (addr: string) => {
      const info = await connection.getAddressLookupTable(
        new web3.PublicKey(addr),
      );
      return info.value;
    });
    const results = await Promise.all(lutPromises);
    addressLookupTableAccounts = results.filter((v: any) => v !== null);
  }

  // 4. Compile v0 message and create transaction
  const payer = new web3.PublicKey(walletAddress);
  const messageV0 = new web3.TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhashInfo.blockhash,
    instructions: legacyIxs,
  }).compileToV0Message(addressLookupTableAccounts);

  const tx = new web3.VersionedTransaction(messageV0);

  return {
    tx,
    blockhash: blockhashInfo.blockhash,
    lastValidBlockHeight: Number(blockhashInfo.lastValidBlockHeight),
  };
}

/**
 * Assemble and serialize a fully-built unsigned VersionedTransaction (v0).
 * Returns base64 — ready to sign without Solana libraries on the client side.
 */
export async function assembleTransaction(
  instructions: SerializableInstruction[],
  walletAddress: string,
  lookupTableAddresses?: string[],
): Promise<AssembledTransaction> {
  const raw = await buildRawTransaction(
    instructions,
    walletAddress,
    lookupTableAddresses,
  );
  const serialized = Buffer.from(raw.tx.serialize()).toString("base64");

  return {
    transaction: serialized,
    blockhash: raw.blockhash,
    lastValidBlockHeight: raw.lastValidBlockHeight,
  };
}
