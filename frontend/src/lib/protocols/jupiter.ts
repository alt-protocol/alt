import type { Instruction } from "@solana/kit";
import type { ProtocolAdapter, BuildTxParams } from "./types";
import { HELIUS_RPC_URL } from "../constants";

// Jupiter Lend SDK uses legacy @solana/web3.js v1.x internally.
// We dynamically import it along with its dependencies to avoid bundling
// at compile time — only loaded when a user initiates a transaction.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** Known token decimals for Jupiter Earn assets. */
const DECIMALS: Record<string, number> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6, // USDC
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6, // USDT
  So11111111111111111111111111111111111111112: 9,     // SOL
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: 6,   // USDS
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 9,   // mSOL
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: 9,  // jitoSOL
};

async function loadSdk() {
  const [earn, web3, bnMod] = await Promise.all([
    import("@jup-ag/lend/earn"),
    import("@solana/web3.js"),
    import("bn.js"),
  ]);
  return {
    getDepositIxs: earn.getDepositIxs,
    getWithdrawIxs: earn.getWithdrawIxs,
    Connection: web3.Connection,
    PublicKey: web3.PublicKey,
    BN: bnMod.default,
  };
}

/**
 * Convert a legacy TransactionInstruction to @solana/kit Instruction.
 * Legacy shape: { keys: [{pubkey, isSigner, isWritable}], programId, data }
 * Kit shape:    { accounts: [{address, role}], programAddress, data }
 */
function convertInstruction(ix: any): Instruction {
  const accounts = ix.keys.map((key: any) => ({
    address: key.pubkey.toBase58(),
    role:
      key.isSigner && key.isWritable
        ? 3 // AccountRole.WRITABLE_SIGNER
        : key.isSigner
          ? 2 // AccountRole.READONLY_SIGNER
          : key.isWritable
            ? 1 // AccountRole.WRITABLE
            : 0, // AccountRole.READONLY
  }));
  return {
    programAddress: ix.programId.toBase58(),
    accounts,
    data: ix.data,
  } as unknown as Instruction;
}

function isEarnCategory(category: string): boolean {
  return (
    category === "earn" ||
    category === "lending" ||
    category === "supply"
  );
}

async function buildEarnDeposit(params: BuildTxParams): Promise<Instruction[]> {
  const { getDepositIxs, Connection, PublicKey, BN } = await loadSdk();

  const mint = params.extraData?.mint as string | undefined;
  if (!mint) throw new Error("Missing mint in extra_data for Jupiter Earn deposit");

  const decimals = DECIMALS[mint] ?? 6;
  const amount = new BN(
    Math.round(parseFloat(params.amount) * 10 ** decimals).toString(),
  );

  const connection = new Connection(HELIUS_RPC_URL);
  const signer = new PublicKey(params.signer.address);
  const asset = new PublicKey(mint);

  const { ixs } = await getDepositIxs({ amount, asset, signer, connection });
  return ixs.map(convertInstruction);
}

async function buildEarnWithdraw(params: BuildTxParams): Promise<Instruction[]> {
  const { getWithdrawIxs, Connection, PublicKey, BN } = await loadSdk();

  const mint = params.extraData?.mint as string | undefined;
  if (!mint) throw new Error("Missing mint in extra_data for Jupiter Earn withdraw");

  const decimals = DECIMALS[mint] ?? 6;
  const amount = new BN(
    Math.round(parseFloat(params.amount) * 10 ** decimals).toString(),
  );

  const connection = new Connection(HELIUS_RPC_URL);
  const signer = new PublicKey(params.signer.address);
  const asset = new PublicKey(mint);

  const { ixs } = await getWithdrawIxs({ amount, asset, signer, connection });
  return ixs.map(convertInstruction);
}

export const jupiterAdapter: ProtocolAdapter = {
  async buildDepositTx(params) {
    if (!isEarnCategory(params.category)) {
      throw new Error(
        `Jupiter adapter only supports Earn (lending/supply). Got category "${params.category}". Multiply is not yet supported.`,
      );
    }
    return buildEarnDeposit(params);
  },

  async buildWithdrawTx(params) {
    if (!isEarnCategory(params.category)) {
      throw new Error(
        `Jupiter adapter only supports Earn (lending/supply). Got category "${params.category}". Multiply is not yet supported.`,
      );
    }
    return buildEarnWithdraw(params);
  },
};
