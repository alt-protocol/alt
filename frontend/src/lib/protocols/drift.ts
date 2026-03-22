import type { Instruction } from "@solana/kit";
import { address } from "@solana/kit";
import type { ProtocolAdapter, BuildTxParams } from "./types";
import { HELIUS_RPC_URL } from "../constants";

// Drift SDK uses legacy @solana/web3.js and bn.js internally.
// We dynamically import everything to avoid bundling at compile time.
/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadSdk() {
  const [driftSdk, web3, bnMod] = await Promise.all([
    import("@drift-labs/sdk"),
    import("@solana/web3.js"),
    import("bn.js"),
  ]);
  return { driftSdk, web3, BN: bnMod.default };
}

function createDriftClient(
  driftSdk: any,
  connection: any,
  signerPubkey: any,
) {
  const wallet = {
    publicKey: signerPubkey,
    signTransaction: async (t: any) => t,
    signAllTransactions: async (t: any) => t,
  };

  return new driftSdk.DriftClient({
    connection: connection as any,
    wallet: wallet as any,
    env: "mainnet-beta" as any,
  });
}

/**
 * Convert a legacy TransactionInstruction into @solana/kit's Instruction format.
 * Field mapping: programId → programAddress, keys → accounts, data stays Uint8Array.
 * AccountRole: 0=readonly, 1=writable, 2=readonly+signer, 3=writable+signer
 */
function convertIx(ix: any): Instruction {
  return {
    programAddress: address(ix.programId.toBase58()),
    accounts: ix.keys.map((k: any) => ({
      address: address(k.pubkey.toBase58()),
      role: k.isWritable ? (k.isSigner ? 3 : 1) : (k.isSigner ? 2 : 0),
    })),
    data: new Uint8Array(ix.data),
  };
}

function getDecimals(extraData?: Record<string, unknown>): number {
  if (extraData?.decimals != null) return Number(extraData.decimals);
  return 6; // Default to USDC (most common IF market)
}

async function buildInsuranceFundDeposit(
  params: BuildTxParams,
): Promise<Instruction[]> {
  const { driftSdk, web3, BN } = await loadSdk();

  const connection = new web3.Connection(HELIUS_RPC_URL);
  const signerPubkey = new web3.PublicKey(params.signer.address);
  const driftClient = createDriftClient(driftSdk, connection, signerPubkey);

  await driftClient.subscribe();

  try {
    const marketIndex =
      params.extraData?.market_index != null
        ? Number(params.extraData.market_index)
        : 0;

    const decimals = getDecimals(params.extraData);
    const amount = new BN(
      Math.floor(parseFloat(params.amount) * 10 ** decimals),
    );

    // Get the user's associated token account for this spot market
    const collateralAccount =
      await driftClient.getAssociatedTokenAccount(marketIndex);

    // Check if the IF stake account already exists on-chain.
    // If it does, we must NOT pass initializeStakeAccount: true,
    // because the init IX will fail with "account already in use".
    const ifStakeAccountPublicKey =
      driftSdk.getInsuranceFundStakeAccountPublicKey(
        driftClient.program.programId,
        signerPubkey,
        marketIndex,
      );
    const existingAccount =
      await connection.getAccountInfo(ifStakeAccountPublicKey);

    const ixs = await driftClient.getAddInsuranceFundStakeIxs({
      marketIndex,
      amount,
      collateralAccountPublicKey: collateralAccount,
      initializeStakeAccount: existingAccount === null,
    });

    return ixs.flat().map(convertIx);
  } finally {
    await driftClient.unsubscribe();
  }
}

async function buildInsuranceFundWithdraw(
  params: BuildTxParams,
): Promise<Instruction[]> {
  const { driftSdk, web3, BN } = await loadSdk();

  const connection = new web3.Connection(HELIUS_RPC_URL);
  const signerPubkey = new web3.PublicKey(params.signer.address);
  const driftClient = createDriftClient(driftSdk, connection, signerPubkey);

  await driftClient.subscribe();

  try {
    const marketIndex =
      params.extraData?.market_index != null
        ? Number(params.extraData.market_index)
        : 0;

    const decimals = getDecimals(params.extraData);
    const amount = new BN(
      Math.floor(parseFloat(params.amount) * 10 ** decimals),
    );

    // IF withdrawal is 2-step: request unstaking (13-day cooldown for USDC),
    // then execute removal. This adapter returns the "request" instruction.
    // Build the IX via the Anchor program directly since the SDK's
    // requestRemoveInsuranceFundStake() signs & sends internally.
    const spotMarketAccount = driftClient.getSpotMarketAccount(marketIndex);
    const ifStakeAccountPublicKey =
      driftSdk.getInsuranceFundStakeAccountPublicKey(
        driftClient.program.programId,
        signerPubkey,
        marketIndex,
      );
    const userStatsPublicKey = driftSdk.getUserStatsAccountPublicKey(
      driftClient.program.programId,
      signerPubkey,
    );

    const ix = await driftClient.program.instruction.requestRemoveInsuranceFundStake(
      marketIndex,
      amount,
      {
        accounts: {
          state: await driftClient.getStatePublicKey(),
          spotMarket: spotMarketAccount.pubkey,
          insuranceFundStake: ifStakeAccountPublicKey,
          userStats: userStatsPublicKey,
          authority: signerPubkey,
          insuranceFundVault: spotMarketAccount.insuranceFund.vault,
        },
      },
    );

    return [ix].map(convertIx);
  } finally {
    await driftClient.unsubscribe();
  }
}

export const driftAdapter: ProtocolAdapter = {
  async buildDepositTx(params) {
    if (params.category === "insurance_fund") {
      return buildInsuranceFundDeposit(params);
    }
    throw new Error(
      `Drift adapter does not yet support category "${params.category}"`,
    );
  },

  async buildWithdrawTx(params) {
    if (params.category === "insurance_fund") {
      return buildInsuranceFundWithdraw(params);
    }
    throw new Error(
      `Drift adapter does not yet support category "${params.category}"`,
    );
  },
};
