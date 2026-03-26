import type { Instruction } from "@solana/kit";
import type { ProtocolAdapter, BuildTxParams, GetBalanceParams } from "./types";
import { HELIUS_RPC_URL } from "../constants";
import { convertLegacyInstruction as convertInstruction } from "../instruction-converter";

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

// ---------------------------------------------------------------------------
// SDK loading + cached legacy Connection
// ---------------------------------------------------------------------------

async function loadSdk() {
  const [earn, web3, bnMod] = await Promise.all([
    import("@jup-ag/lend/earn"),
    import("@solana/web3.js"),
    import("bn.js"),
  ]);
  return {
    getDepositIxs: earn.getDepositIxs,
    getWithdrawIxs: earn.getWithdrawIxs,
    getRedeemIxs: earn.getRedeemIxs,
    getUserLendingPositionByAsset: earn.getUserLendingPositionByAsset,
    Connection: web3.Connection,
    PublicKey: web3.PublicKey,
    BN: bnMod.default,
  };
}

/** Lazy singleton — Jupiter SDK is stateless so one Connection is safe to reuse. */
let _legacyConnection: any = null;
function getLegacyConnection(Connection: any) {
  if (!_legacyConnection) _legacyConnection = new Connection(HELIUS_RPC_URL);
  return _legacyConnection;
}

// ---------------------------------------------------------------------------
// Shared context (mirrors Drift's createDriftContext pattern)
// ---------------------------------------------------------------------------

function isEarnCategory(category: string): boolean {
  return category === "earn" || category === "lending" || category === "supply";
}

async function createEarnContext(walletOrSigner: string, extraData?: Record<string, unknown>) {
  const sdk = await loadSdk();

  const mint = extraData?.mint as string | undefined;
  if (!mint) throw new Error("Missing mint in extra_data for Jupiter Earn");

  const decimals = DECIMALS[mint] ?? 6;
  const connection = getLegacyConnection(sdk.Connection);
  const user = new sdk.PublicKey(walletOrSigner);
  const asset = new sdk.PublicKey(mint);

  return { ...sdk, connection, user, asset, mint, decimals };
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

async function buildEarnDeposit(params: BuildTxParams): Promise<Instruction[]> {
  const ctx = await createEarnContext(params.signer.address, params.extraData);

  const amount = new ctx.BN(
    Math.round(parseFloat(params.amount) * 10 ** ctx.decimals).toString(),
  );

  const { ixs } = await ctx.getDepositIxs({
    amount, asset: ctx.asset, signer: ctx.user, connection: ctx.connection as any,
  });
  return ixs.map(convertInstruction);
}

// ---------------------------------------------------------------------------
// Withdraw (share-based redemption to avoid on-chain rounding)
// ---------------------------------------------------------------------------

async function buildEarnWithdraw(params: BuildTxParams): Promise<Instruction[]> {
  const ctx = await createEarnContext(params.signer.address, params.extraData);

  const amountRaw = new ctx.BN(
    Math.round(parseFloat(params.amount) * 10 ** ctx.decimals).toString(),
  );

  // Use share-based redemption (getRedeemIxs) to avoid the on-chain
  // asset→shares rounding issue that causes "Not enough tokens" errors.
  // Falls back to asset-based withdrawal if position query fails.
  try {
    const position = await ctx.getUserLendingPositionByAsset({
      user: ctx.user, asset: ctx.asset, connection: ctx.connection as any,
    });

    if (position && !position.lendingTokenShares.isZero()) {
      const isFullWithdraw = !position.underlyingAssets.isZero()
        && amountRaw.muln(1000).gte(position.underlyingAssets.muln(999));

      const shares = isFullWithdraw
        ? position.lendingTokenShares
        : position.lendingTokenShares.mul(amountRaw).div(position.underlyingAssets);

      const { ixs } = await ctx.getRedeemIxs({
        shares, asset: ctx.asset, signer: ctx.user, connection: ctx.connection as any,
      });
      return ixs.map(convertInstruction);
    }
  } catch {
    // Position query failed — fall through to asset-based withdrawal
  }

  const { ixs } = await ctx.getWithdrawIxs({
    amount: amountRaw, asset: ctx.asset, signer: ctx.user, connection: ctx.connection as any,
  });
  return ixs.map(convertInstruction);
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

async function getEarnBalance(params: GetBalanceParams): Promise<number | null> {
  try {
    const ctx = await createEarnContext(params.walletAddress, params.extraData);

    const position = await ctx.getUserLendingPositionByAsset({
      user: ctx.user, asset: ctx.asset, connection: ctx.connection as any,
    });

    if (!position || position.underlyingAssets.isZero()) return 0;
    return position.underlyingAssets.toNumber() / 10 ** ctx.decimals;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

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

  async getBalance(params) {
    if (isEarnCategory(params.category)) return getEarnBalance(params);
    return null;
  },
};
