/**
 * Exponent Finance protocol adapter — builds unsigned PT buy/sell
 * and LP deposit/withdraw instructions.
 *
 * SDK is lazily imported to avoid loading Anchor programs at startup.
 */
import type { Instruction } from "@solana/kit";
import type {
  ProtocolAdapter,
  BuildTxParams,
  BuildTxResult,
} from "./types.js";
import { convertLegacyInstruction as convertIx } from "../services/instruction-converter.js";
import { getLegacyConnection } from "../../shared/rpc.js";
import { resolveDecimals } from "../services/decimals.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Cached SDK — loaded once on first call, reused after
// ---------------------------------------------------------------------------

let _sdk: { MarketThree: any; LOCAL_ENV: any; web3: any } | undefined;

async function loadSdk() {
  if (!_sdk) {
    const [sdk, web3] = await Promise.all([
      import("@exponent-labs/exponent-sdk"),
      import("@solana/web3.js"),
    ]);
    _sdk = { MarketThree: sdk.MarketThree, LOCAL_ENV: sdk.LOCAL_ENV, web3 };
  }
  return _sdk;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load a single MarketThree by its vault address. */
async function loadMarket(marketVault: string) {
  const { MarketThree, LOCAL_ENV, web3 } = await loadSdk();
  const connection = await getLegacyConnection();
  const address = new web3.PublicKey(marketVault);
  return MarketThree.load(LOCAL_ENV, connection, address);
}

/** Convert SDK instruction results ({ixs, setupIxs}) to kit Instruction[]. */
function convertIxResult(result: any): Instruction[] {
  const ixs: Instruction[] = [];
  if (result.setupIxs) {
    for (const ix of result.setupIxs) ixs.push(convertIx(ix));
  }
  if (result.ixs) {
    for (const ix of result.ixs) ixs.push(convertIx(ix));
  }
  // Single instruction result (no .ixs wrapper)
  if (!result.ixs && !result.setupIxs && result.programId) {
    ixs.push(convertIx(result));
  }
  return ixs;
}

// ---------------------------------------------------------------------------
// PT — buy (deposit) and sell (withdraw)
// ---------------------------------------------------------------------------

async function buildPtDeposit(params: BuildTxParams): Promise<BuildTxResult> {
  const { web3 } = await loadSdk();
  const market = await loadMarket(params.extraData?.market_vault as string);
  const owner = new web3.PublicKey(params.walletAddress);
  const decimals = await resolveDecimals(params.extraData);
  const baseIn = BigInt(Math.floor(Number(params.amount) * 10 ** decimals));

  // Allow 2% slippage on PT out
  const ptPrice = market.state.ticks?.currentSpotPrice ?? 0;
  const estimatedPt = Number(baseIn) * (1 / Math.exp(-ptPrice));
  const minPtOut = BigInt(Math.floor(estimatedPt * 0.98));

  const result = await market.ixWrapperBuyPt({ owner, baseIn, minPtOut });
  const instructions = convertIxResult(result);
  const alt = market.addressLookupTable.toBase58();

  return { instructions, lookupTableAddresses: [alt] };
}

async function buildPtWithdraw(params: BuildTxParams): Promise<BuildTxResult> {
  const { web3 } = await loadSdk();
  const market = await loadMarket(params.extraData?.market_vault as string);
  const owner = new web3.PublicKey(params.walletAddress);
  const decimals = await resolveDecimals(params.extraData);
  const amount = BigInt(Math.floor(Number(params.amount) * 10 ** decimals));

  // Allow 2% slippage on base out
  const minBaseOut = BigInt(Math.floor(Number(amount) * 0.98));

  const result = await market.ixWrapperSellPt({ owner, amount, minBaseOut });
  const instructions = convertIxResult(result);
  const alt = market.addressLookupTable.toBase58();

  return { instructions, lookupTableAddresses: [alt] };
}

// ---------------------------------------------------------------------------
// LP — provide liquidity (deposit) and withdraw
// ---------------------------------------------------------------------------

async function buildLpDeposit(params: BuildTxParams): Promise<BuildTxResult> {
  const { web3 } = await loadSdk();
  const market = await loadMarket(params.extraData?.market_vault as string);
  const depositor = new web3.PublicKey(params.walletAddress);
  const decimals = await resolveDecimals(params.extraData);
  const amountBase = BigInt(Math.floor(Number(params.amount) * 10 ** decimals));

  // Full-range liquidity (0% to 100% APY tick range)
  const result = await market.ixWrapperProvideLiquidity({
    depositor,
    amountBase,
    minLpOut: 0n,
    lowerTickApy: 0,
    upperTickApy: 10000, // 100% APY in basis points
  });

  const instructions = convertIxResult(result);
  // Add signer keypairs if present (LP position account)
  const alt = market.addressLookupTable.toBase58();

  return { instructions, lookupTableAddresses: [alt] };
}

async function buildLpWithdraw(params: BuildTxParams): Promise<BuildTxResult> {
  const { web3 } = await loadSdk();
  const market = await loadMarket(params.extraData?.market_vault as string);
  const owner = new web3.PublicKey(params.walletAddress);
  const decimals = await resolveDecimals(params.extraData);
  const amountLp = BigInt(Math.floor(Number(params.amount) * 10 ** decimals));

  const lpPosition = params.extraData?.lp_position as string | undefined;
  if (!lpPosition) throw new Error("LP position address required for withdrawal");

  const result = await market.ixWithdrawLiquidityToBase({
    owner,
    amountLp,
    minBaseOut: 0n,
    lpPosition: new web3.PublicKey(lpPosition),
  });

  const instructions = convertIxResult(result);
  const alt = market.addressLookupTable.toBase58();

  return { instructions, lookupTableAddresses: [alt] };
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const exponentAdapter: ProtocolAdapter = {
  async buildDepositTx(params) {
    const type = params.extraData?.type as string;
    if (type === "exponent_lp") return buildLpDeposit(params);
    return buildPtDeposit(params);
  },

  async buildWithdrawTx(params) {
    const type = params.extraData?.type as string;
    if (type === "exponent_lp") return buildLpWithdraw(params);
    return buildPtWithdraw(params);
  },
};
