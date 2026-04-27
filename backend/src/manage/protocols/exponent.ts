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
  GetBalanceParams,
} from "./types.js";
import { convertLegacyInstruction as convertIx } from "../services/instruction-converter.js";
import { getLegacyConnection } from "../../shared/rpc.js";
import { resolveDecimals } from "../services/decimals.js";
import { postJson } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Cached SDK — loaded once on first call, reused after
// ---------------------------------------------------------------------------

let _sdk: { Market: any; LOCAL_ENV: any; web3: any } | undefined;

async function loadSdk() {
  if (!_sdk) {
    const [sdk, web3] = await Promise.all([
      import("@exponent-labs/exponent-sdk"),
      import("@solana/web3.js"),
    ]);
    _sdk = { Market: sdk.Market, LOCAL_ENV: sdk.LOCAL_ENV, web3 };
  }
  return _sdk;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load a legacy Market by its market address (from legacyMarketAddresses). */
async function loadMarket(extraData?: Record<string, unknown>) {
  const { Market, LOCAL_ENV, web3 } = await loadSdk();
  const connection = await getLegacyConnection();
  const addr = (extraData?.market_address ?? extraData?.market_vault) as string;
  if (!addr) throw new Error("No market_address or market_vault in extra_data");
  return Market.load(LOCAL_ENV, connection, new web3.PublicKey(addr));
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
  const market = await loadMarket(params.extraData);
  const owner = new web3.PublicKey(params.walletAddress);
  const decimals = await resolveDecimals(params.extraData);
  const baseAmount = BigInt(Math.floor(Number(params.amount) * 10 ** decimals));

  // Legacy Market: specify desired PT output + max base input (with 2% slippage)
  const ptPrice = market.currentPtPriceInAsset ?? 1;
  const ptOut = BigInt(Math.floor(Number(baseAmount) / ptPrice));
  const maxBaseIn = BigInt(Math.floor(Number(baseAmount) * 1.02));

  const result = await market.ixWrapperBuyPt({ owner, ptOut, maxBaseIn });
  const instructions = convertIxResult(result);
  const alt = market.addressLookupTable.toBase58();

  return { instructions, lookupTableAddresses: [alt] };
}

async function buildPtWithdraw(params: BuildTxParams): Promise<BuildTxResult> {
  const { web3 } = await loadSdk();
  const market = await loadMarket(params.extraData);
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
  const market = await loadMarket(params.extraData);
  const depositor = new web3.PublicKey(params.walletAddress);
  const decimals = await resolveDecimals(params.extraData);
  const amountBase = BigInt(Math.floor(Number(params.amount) * 10 ** decimals));

  const result = await market.ixProvideLiquidityNoPriceImpact({
    depositor,
    amountBase,
    minLpOut: 0n,
  });

  const instructions = convertIxResult(result);
  const alt = market.addressLookupTable.toBase58();

  return { instructions, lookupTableAddresses: [alt] };
}

async function buildLpWithdraw(params: BuildTxParams): Promise<BuildTxResult> {
  const { web3 } = await loadSdk();
  const market = await loadMarket(params.extraData);
  const owner = new web3.PublicKey(params.walletAddress);
  const decimals = await resolveDecimals(params.extraData);
  const amountLp = BigInt(Math.floor(Number(params.amount) * 10 ** decimals));

  const result = await market.ixWithdrawLiquidityToBase({
    owner,
    amountLp,
    minBaseOut: 0n,
  });

  const instructions = convertIxResult(result);
  const alt = market.addressLookupTable.toBase58();

  return { instructions, lookupTableAddresses: [alt] };
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

/** Query wallet's token account balance for a given mint via RPC. */
async function getTokenBalance(wallet: string, mint: string): Promise<number | null> {
  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl) return null;

  try {
    const resp = (await postJson(rpcUrl, {
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [
        wallet,
        { mint },
        { encoding: "jsonParsed" },
      ],
    })) as Record<string, unknown>;

    const result = resp?.result as Record<string, unknown> | undefined;
    const accounts = (result?.value ?? []) as Record<string, unknown>[];
    if (accounts.length === 0) return null;

    let total = 0;
    for (const acct of accounts) {
      const data = acct.account as Record<string, unknown>;
      const parsed = (data?.data as Record<string, unknown>)?.parsed as Record<string, unknown>;
      const info = parsed?.info as Record<string, unknown>;
      const tokenAmount = info?.tokenAmount as Record<string, unknown>;
      total += Number(tokenAmount?.uiAmount ?? 0);
    }
    return total > 0 ? total : null;
  } catch (err) {
    logger.warn({ err, wallet: wallet.slice(0, 8), mint: mint.slice(0, 8) }, "Exponent getTokenBalance failed");
    return null;
  }
}

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

  async getBalance(params: GetBalanceParams): Promise<number | null> {
    const type = params.extraData?.type as string;
    const mint = type === "exponent_lp"
      ? (params.extraData?.mint_lp as string | undefined)
      : (params.extraData?.mint_pt as string | undefined);
    if (!mint) return null;
    return getTokenBalance(params.walletAddress, mint);
  },
};
