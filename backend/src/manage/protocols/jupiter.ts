import type { Instruction } from "@solana/kit";
import type {
  ProtocolAdapter,
  BuildTxParams,
  BuildTxResultWithLookups,
  GetBalanceParams,
} from "./types.js";
import {
  convertLegacyInstruction,
  convertJupiterApiInstruction,
} from "../services/instruction-converter.js";
import { getLegacyConnection } from "../../shared/rpc.js";
import { jupiterHeaders } from "../../shared/http.js";
import { cachedAsync } from "../../shared/utils.js";
import { logger } from "../../shared/logger.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JUPITER_SWAP_V2 = "https://api.jup.ag/swap/v2";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** System program address used as taker for V2 /build — skips wallet balance validation.
 *  Flash loan txs don't have borrow tokens in the wallet at build time. */
const SWAP_BUILD_TAKER = "11111111111111111111111111111111";
const SWAP_TIMEOUT_MS = 10_000;

/** Known token decimals — populated lazily from on-chain when missing. */
const DECIMALS: Record<string, number> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6, // USDC
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6, // USDT
  So11111111111111111111111111111111111111112: 9, // SOL
  USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA: 6, // USDS
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 9, // mSOL
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: 9, // jitoSOL
};

// ---------------------------------------------------------------------------
// SDK / API singletons (lazy-loaded)
// ---------------------------------------------------------------------------

async function loadEarnSdk() {
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
    PublicKey: web3.PublicKey,
    BN: bnMod.default,
  };
}

let _borrowSdkCache: any = null;
async function loadBorrowSdk() {
  if (_borrowSdkCache) return _borrowSdkCache;
  const [borrow, flashloan, web3, bnMod] = await Promise.all([
    import("@jup-ag/lend/borrow"),
    import("@jup-ag/lend/flashloan"),
    import("@solana/web3.js"),
    import("bn.js"),
  ]);
  _borrowSdkCache = {
    getOperateIx: borrow.getOperateIx,
    getCurrentPosition: borrow.getCurrentPosition,
    MAX_REPAY_AMOUNT: borrow.MAX_REPAY_AMOUNT,
    MAX_WITHDRAW_AMOUNT: borrow.MAX_WITHDRAW_AMOUNT,
    getFlashBorrowIx: flashloan.getFlashBorrowIx,
    getFlashPaybackIx: flashloan.getFlashPaybackIx,
    ComputeBudgetProgram: web3.ComputeBudgetProgram,
    PublicKey: web3.PublicKey,
    BN: bnMod.default,
  };
  return _borrowSdkCache;
}


// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function getDecimals(mint: string): Promise<number> {
  if (DECIMALS[mint] != null) return DECIMALS[mint];
  try {
    const connection = await getLegacyConnection();
    const { PublicKey } = await import("@solana/web3.js");
    const info = await connection.getParsedAccountInfo(new PublicKey(mint));
    const decimals = (info?.value?.data as any)?.parsed?.info?.decimals ?? 6;
    DECIMALS[mint] = decimals;
    return decimals;
  } catch {
    return 6;
  }
}

function isEarnCategory(cat: string): boolean {
  return cat === "earn" || cat === "lending" || cat === "supply";
}

function parseMultiplyParams(extra: Record<string, unknown> | undefined) {
  if (!extra) throw Object.assign(new Error("Missing extra_data for multiply"), { statusCode: 400 });

  const vaultId = Number(extra.vault_id);
  const supplyMint = (extra.supply_token_mint ?? extra.collateral_mint) as string;
  const borrowMint = (extra.borrow_token_mint ?? extra.debt_mint) as string;

  if (!vaultId || !supplyMint || !borrowMint) {
    throw Object.assign(
      new Error("Missing required multiply params (vault_id, supply_token_mint, borrow_token_mint)"),
      { statusCode: 400 },
    );
  }

  return {
    vaultId,
    supplyMint,
    borrowMint,
    positionId: extra.position_id != null ? Number(extra.position_id) : undefined,
    leverage: extra.leverage != null ? Number(extra.leverage) : undefined,
    slippageBps: Number(extra.slippageBps ?? 100),
    isClosingPosition: extra.isClosingPosition === true,
  };
}

/** Compute budget instruction (1M CU). */
async function computeBudgetIx(): Promise<Instruction> {
  const sdk = await loadBorrowSdk();
  return convertLegacyInstruction(sdk.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }));
}


/** Extract ALT address strings from getOperateIx's resolved AddressLookupTableAccount[]. */
function extractOperateAlts(alts: any[]): string[] {
  return (alts ?? []).map((a: any) => a.key?.toBase58?.() ?? String(a.key ?? a));
}

// ---------------------------------------------------------------------------
// Swap helpers (Jupiter V2 API)
// ---------------------------------------------------------------------------

/** Compact swap via V2 /build — returns instructions with optimal ALT coverage. */
async function getMultiplySwap(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number,
  taker: string,
): Promise<{ outAmount: string; swapIxs: Instruction[]; altAddresses: string[] }> {
  const resp = await fetch(
    `${JUPITER_SWAP_V2}/build?${new URLSearchParams({
      inputMint, outputMint, amount, taker,
      slippageBps: String(slippageBps),
      maxAccounts: "30",
    })}`,
    { headers: jupiterHeaders(), signal: AbortSignal.timeout(SWAP_TIMEOUT_MS) },
  );
  const data = await resp.json() as any;

  if (data.error || !data.swapInstruction) {
    throw Object.assign(
      new Error(data.error ?? `Swap build failed (HTTP ${resp.status})`),
      { statusCode: 400 },
    );
  }

  const swapIxs: Instruction[] = [convertJupiterApiInstruction(data.swapInstruction)];
  if (data.cleanupInstruction) swapIxs.push(convertJupiterApiInstruction(data.cleanupInstruction));

  return {
    outAmount: String(data.outAmount),
    swapIxs,
    altAddresses: Object.keys(data.addressesByLookupTableAddress ?? {}),
  };
}

/** Lightweight price quote via V1 lite API (no balance check, no instructions). */
async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: string,
  slippageBps: number,
): Promise<{ outAmount: string }> {
  const resp = await fetch(
    `https://lite-api.jup.ag/swap/v1/quote?${new URLSearchParams({
      inputMint, outputMint, amount, slippageBps: String(slippageBps),
    })}`,
    { headers: jupiterHeaders(), signal: AbortSignal.timeout(SWAP_TIMEOUT_MS) },
  );
  const data = await resp.json() as any;

  if (data.error || !data.outAmount) {
    throw Object.assign(new Error(data.error ?? "No swap quote available"), { statusCode: 400 });
  }
  return { outAmount: String(data.outAmount) };
}

// ---------------------------------------------------------------------------
// Earn — Deposit / Withdraw / Balance
// ---------------------------------------------------------------------------

async function createEarnContext(walletAddress: string, extraData?: Record<string, unknown>) {
  const sdk = await loadEarnSdk();
  const mint = extraData?.mint as string | undefined;
  if (!mint) throw Object.assign(new Error("Missing mint in extra_data for Jupiter Earn"), { statusCode: 400 });

  const connection = await getLegacyConnection();
  return {
    ...sdk,
    connection,
    user: new sdk.PublicKey(walletAddress),
    asset: new sdk.PublicKey(mint),
    decimals: DECIMALS[mint] ?? 6,
  };
}

async function buildEarnDeposit(params: BuildTxParams): Promise<Instruction[]> {
  const ctx = await createEarnContext(params.walletAddress, params.extraData);
  const amount = new ctx.BN(Math.round(parseFloat(params.amount) * 10 ** ctx.decimals).toString());
  try {
    const { ixs } = await ctx.getDepositIxs({ amount, asset: ctx.asset, signer: ctx.user, connection: ctx.connection });
    return ixs.map(convertLegacyInstruction);
  } catch (err: unknown) {
    if (err instanceof Error && "statusCode" in err) throw err;
    logger.error({ err, mint: params.extraData?.mint }, "Jupiter Earn deposit SDK error");
    throw Object.assign(new Error("Jupiter Earn deposit failed. Please check the amount and try again."), { statusCode: 400 });
  }
}

async function buildEarnWithdraw(params: BuildTxParams): Promise<Instruction[]> {
  const ctx = await createEarnContext(params.walletAddress, params.extraData);
  const amountRaw = new ctx.BN(Math.round(parseFloat(params.amount) * 10 ** ctx.decimals).toString());
  try {
    // Try share-based redemption (avoids on-chain rounding)
    try {
      const position = await ctx.getUserLendingPositionByAsset({ user: ctx.user, asset: ctx.asset, connection: ctx.connection });
      if (position && !position.lendingTokenShares.isZero()) {
        const isFullWithdraw = !position.underlyingAssets.isZero() && amountRaw.muln(1000).gte(position.underlyingAssets.muln(999));
        const shares = isFullWithdraw
          ? position.lendingTokenShares
          : position.lendingTokenShares.mul(amountRaw).div(position.underlyingAssets);
        const { ixs } = await ctx.getRedeemIxs({ shares, asset: ctx.asset, signer: ctx.user, connection: ctx.connection });
        return ixs.map(convertLegacyInstruction);
      }
    } catch { /* fall through to asset-based */ }

    const { ixs } = await ctx.getWithdrawIxs({ amount: amountRaw, asset: ctx.asset, signer: ctx.user, connection: ctx.connection });
    return ixs.map(convertLegacyInstruction);
  } catch (err: unknown) {
    if (err instanceof Error && "statusCode" in err) throw err;
    logger.error({ err, mint: params.extraData?.mint }, "Jupiter Earn withdraw SDK error");
    throw Object.assign(new Error("Jupiter Earn withdrawal failed. Please check the amount and try again."), { statusCode: 400 });
  }
}

async function getEarnBalance(params: GetBalanceParams): Promise<number | null> {
  try {
    const ctx = await createEarnContext(params.walletAddress, params.extraData);
    const position = await ctx.getUserLendingPositionByAsset({ user: ctx.user, asset: ctx.asset, connection: ctx.connection });
    if (!position || position.underlyingAssets.isZero()) return 0;
    return position.underlyingAssets.toNumber() / 10 ** ctx.decimals;
  } catch (err) {
    logger.error({ err, wallet: params.walletAddress.slice(0, 8) }, "Jupiter getEarnBalance failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Multiply — Open (flash loan + swap + operate)
// ---------------------------------------------------------------------------

async function buildMultiplyOpen(params: BuildTxParams): Promise<BuildTxResultWithLookups> {
  const mp = parseMultiplyParams(params.extraData);
  if (!mp.leverage || mp.leverage <= 1) {
    throw Object.assign(new Error("Leverage must be > 1 for multiply open"), { statusCode: 400 });
  }

  const [sdk, connection, supplyDecimals, borrowDecimals] = await Promise.all([
    loadBorrowSdk(),
    getLegacyConnection(),
    getDecimals(mp.supplyMint),
    getDecimals(mp.borrowMint),
  ]);
  const signer = new sdk.PublicKey(params.walletAddress);
  const debtMintPk = new sdk.PublicKey(mp.borrowMint);

  // Estimate borrow amount from leverage without a separate price quote call.
  // deposit * (leverage - 1) gives the debt portion in collateral terms.
  // Adjust by decimals ratio (e.g. 6-decimal supply / 6-decimal borrow = 1:1 for stables).
  const userDepositLamports = Math.round(parseFloat(params.amount) * 10 ** supplyDecimals);
  const decimalAdjust = 10 ** (supplyDecimals - borrowDecimals);
  const estimatedBorrow = Math.round(userDepositLamports * (mp.leverage - 1) / decimalAdjust);
  const borrowAmount = new sdk.BN(estimatedBorrow);

  logger.info(
    { wallet: params.walletAddress.slice(0, 8), vaultId: mp.vaultId, leverage: mp.leverage, borrowAmount: borrowAmount.toString() },
    "Building Jupiter multiply open",
  );

  // All external calls in one parallel batch: swap build + flash loan ixs
  const [swapResult, flashBorrowIx, flashPaybackIx] = await Promise.all([
    getMultiplySwap(mp.borrowMint, mp.supplyMint, borrowAmount.toString(), mp.slippageBps, params.walletAddress),
    sdk.getFlashBorrowIx({ connection, signer, asset: debtMintPk, amount: borrowAmount }),
    sdk.getFlashPaybackIx({ connection, signer, asset: debtMintPk, amount: borrowAmount }),
  ]);

  const supplyAmount = new sdk.BN(userDepositLamports).add(new sdk.BN(swapResult.outAmount));
  const { ixs: operateIxs, addressLookupTableAccounts, nftId } = await sdk.getOperateIx({
    vaultId: mp.vaultId, positionId: 0, colAmount: supplyAmount, debtAmount: borrowAmount, connection, signer,
  });

  const budgetIx = await computeBudgetIx();
  return {
    instructions: [
      budgetIx,
      convertLegacyInstruction(flashBorrowIx),
      ...swapResult.swapIxs,
      ...operateIxs.map(convertLegacyInstruction),
      convertLegacyInstruction(flashPaybackIx),
    ],
    lookupTableAddresses: [...new Set([...extractOperateAlts(addressLookupTableAccounts), ...swapResult.altAddresses])],
    metadata: nftId != null ? { nft_id: nftId, vault_id: mp.vaultId } : undefined,
  };
}

// ---------------------------------------------------------------------------
// Multiply — Close (direct SDK — no Jupiter Lend API dependency)
// ---------------------------------------------------------------------------

async function buildMultiplyClose(params: BuildTxParams): Promise<BuildTxResultWithLookups> {
  const mp = parseMultiplyParams(params.extraData);
  if (mp.positionId == null) throw Object.assign(new Error("Missing position_id for multiply close"), { statusCode: 400 });

  const [sdk, connection] = await Promise.all([loadBorrowSdk(), getLegacyConnection()]);
  const signer = new sdk.PublicKey(params.walletAddress);
  const isFullClose = mp.isClosingPosition || !params.amount || parseFloat(params.amount) === 0;

  let colAmount: any;
  let debtAmount: any;
  if (isFullClose) {
    colAmount = sdk.MAX_WITHDRAW_AMOUNT;
    debtAmount = sdk.MAX_REPAY_AMOUNT;
  } else {
    const supplyDecimals = await getDecimals(mp.supplyMint);
    colAmount = new sdk.BN(-Math.round(parseFloat(params.amount) * 10 ** supplyDecimals));
    debtAmount = new sdk.BN(0);
  }

  logger.info({ wallet: params.walletAddress.slice(0, 8), vaultId: mp.vaultId, positionId: mp.positionId, isFullClose }, "Building Jupiter multiply close");

  const { ixs: operateIxs, addressLookupTableAccounts } = await sdk.getOperateIx({
    vaultId: mp.vaultId, positionId: mp.positionId, colAmount, debtAmount, connection, signer,
  });

  const budgetIx = await computeBudgetIx();
  return {
    instructions: [budgetIx, ...operateIxs.map(convertLegacyInstruction)],
    lookupTableAddresses: extractOperateAlts(addressLookupTableAccounts),
  };
}

// ---------------------------------------------------------------------------
// Multiply — Adjust leverage
// ---------------------------------------------------------------------------

async function buildMultiplyAdjust(params: BuildTxParams): Promise<BuildTxResultWithLookups> {
  const mp = parseMultiplyParams(params.extraData);
  if (mp.positionId == null) throw Object.assign(new Error("Missing position_id for multiply adjust"), { statusCode: 400 });
  if (!mp.leverage || mp.leverage <= 1) throw Object.assign(new Error("Target leverage must be > 1"), { statusCode: 400 });

  const [sdk, connection, borrowDecimals] = await Promise.all([
    loadBorrowSdk(), getLegacyConnection(), getDecimals(mp.borrowMint),
  ]);
  const signer = new sdk.PublicKey(params.walletAddress);

  const position = await sdk.getCurrentPosition({ vaultId: mp.vaultId, positionId: mp.positionId, connection });
  if (position.colRaw.isZero()) throw Object.assign(new Error("No active position to adjust"), { statusCode: 400 });

  // Calculate delta via price ratio
  const testAmount = 10 ** borrowDecimals;
  const priceQuote = await getSwapQuote(mp.borrowMint, mp.supplyMint, String(testAmount), mp.slippageBps);
  const priceRatio = Number(priceQuote.outAmount) / testAmount;
  const debtInColTerms = position.debtRaw.toNumber() * priceRatio;
  const equity = position.colRaw.toNumber() - debtInColTerms;
  const deltaCol = equity * mp.leverage - position.colRaw.toNumber();
  const deltaDeb = Math.round(Math.abs(deltaCol) / priceRatio);

  logger.info({ wallet: params.walletAddress.slice(0, 8), vaultId: mp.vaultId, targetLeverage: mp.leverage, deltaCol: Math.round(deltaCol) }, "Building Jupiter multiply adjust");

  if (deltaCol > 0) {
    // Leverage UP: flash borrow debt → swap → operate → flash repay
    const debtMintPk = new sdk.PublicKey(mp.borrowMint);
    const additionalBorrow = new sdk.BN(deltaDeb);

    const [swapResult, flashBorrowIx, flashPaybackIx] = await Promise.all([
      getMultiplySwap(mp.borrowMint, mp.supplyMint, additionalBorrow.toString(), mp.slippageBps, params.walletAddress),
      sdk.getFlashBorrowIx({ connection, signer, asset: debtMintPk, amount: additionalBorrow }),
      sdk.getFlashPaybackIx({ connection, signer, asset: debtMintPk, amount: additionalBorrow }),
    ]);

    const { ixs: operateIxs, addressLookupTableAccounts } = await sdk.getOperateIx({
      vaultId: mp.vaultId, positionId: mp.positionId,
      colAmount: new sdk.BN(swapResult.outAmount), debtAmount: additionalBorrow,
      connection, signer,
    });

    const budgetIx = await computeBudgetIx();
    return {
      instructions: [
        budgetIx, convertLegacyInstruction(flashBorrowIx), ...swapResult.swapIxs,
        ...operateIxs.map(convertLegacyInstruction), convertLegacyInstruction(flashPaybackIx),
      ],
      lookupTableAddresses: [...new Set([...extractOperateAlts(addressLookupTableAccounts), ...swapResult.altAddresses])],
    };
  } else {
    // Leverage DOWN: simple operate (withdraw + repay, no flash loan, no API dependency)
    const { ixs: operateIxs, addressLookupTableAccounts } = await sdk.getOperateIx({
      vaultId: mp.vaultId, positionId: mp.positionId,
      colAmount: new sdk.BN(Math.round(deltaCol)), debtAmount: new sdk.BN(-deltaDeb),
      connection, signer,
    });
    const budgetIx = await computeBudgetIx();
    return {
      instructions: [budgetIx, ...operateIxs.map(convertLegacyInstruction)],
      lookupTableAddresses: extractOperateAlts(addressLookupTableAccounts),
    };
  }
}

// ---------------------------------------------------------------------------
// Multiply — Manage (add/withdraw collateral, borrow/repay debt)
// ---------------------------------------------------------------------------

type ManageAction = "add_collateral" | "withdraw_collateral" | "borrow_more" | "repay_debt";

async function buildMultiplyManage(params: BuildTxParams): Promise<BuildTxResultWithLookups> {
  const mp = parseMultiplyParams(params.extraData);
  const action = params.extraData?.action as ManageAction;
  if (mp.positionId == null) throw Object.assign(new Error("Missing position_id"), { statusCode: 400 });
  if (!action) throw Object.assign(new Error("Missing action"), { statusCode: 400 });

  const isCollateral = action === "add_collateral" || action === "withdraw_collateral";
  const decimals = await getDecimals(isCollateral ? mp.supplyMint : mp.borrowMint);
  const amountLamports = Math.round(parseFloat(params.amount) * 10 ** decimals);

  const colAmountStr = isCollateral ? String(action === "add_collateral" ? amountLamports : -amountLamports) : "0";
  const debtAmountStr = isCollateral ? "0" : String(action === "borrow_more" ? amountLamports : -amountLamports);

  logger.info({ wallet: params.walletAddress.slice(0, 8), vaultId: mp.vaultId, action, amount: amountLamports }, "Building Jupiter multiply manage");

  const [sdk, connection] = await Promise.all([loadBorrowSdk(), getLegacyConnection()]);
  const signer = new sdk.PublicKey(params.walletAddress);
  const ZERO = new sdk.BN(0);

  const colAmount = isCollateral
    ? new sdk.BN(action === "add_collateral" ? amountLamports : -amountLamports)
    : ZERO;
  const debtAmount = isCollateral
    ? ZERO
    : new sdk.BN(action === "borrow_more" ? amountLamports : -amountLamports);

  const { ixs: operateIxs, addressLookupTableAccounts } = await sdk.getOperateIx({
    vaultId: mp.vaultId, positionId: mp.positionId, colAmount, debtAmount, connection, signer,
  });

  const budgetIx = await computeBudgetIx();
  return {
    instructions: [budgetIx, ...operateIxs.map(convertLegacyInstruction)],
    lookupTableAddresses: extractOperateAlts(addressLookupTableAccounts),
  };
}

// ---------------------------------------------------------------------------
// Multiply — Balance + Stats
// ---------------------------------------------------------------------------

async function getMultiplyBalance(params: GetBalanceParams): Promise<number | null> {
  try {
    const mp = parseMultiplyParams(params.extraData);
    if (mp.positionId == null) return null;

    const [sdk, connection] = await Promise.all([loadBorrowSdk(), getLegacyConnection()]);
    const position = await sdk.getCurrentPosition({ vaultId: mp.vaultId, positionId: mp.positionId, connection });
    if (position.colRaw.isZero()) return 0;

    const supplyDecimals = await getDecimals(mp.supplyMint);
    return position.colRaw.sub(position.debtRaw).toNumber() / 10 ** supplyDecimals;
  } catch (err) {
    logger.error({ err, wallet: params.walletAddress.slice(0, 8) }, "Jupiter getMultiplyBalance failed");
    return null;
  }
}

export interface JupiterMultiplyStats {
  balance: number;
  leverage: number;
  ltv: number;
  liquidationLtv: number;
  totalDepositUsd: number;
  totalBorrowUsd: number;
  borrowLimit: number;
  healthFactor: number;
  positionId: number;
}

export async function getJupiterMultiplyStats(
  walletAddress: string,
  extraData: Record<string, unknown>,
): Promise<JupiterMultiplyStats | null> {
  try {
    const mp = parseMultiplyParams(extraData);
    if (mp.positionId == null) return null;

    const [sdk, connection, supplyDecimals, borrowDecimals] = await Promise.all([
      loadBorrowSdk(), getLegacyConnection(), getDecimals(mp.supplyMint), getDecimals(mp.borrowMint),
    ]);

    const position = await sdk.getCurrentPosition({ vaultId: mp.vaultId, positionId: mp.positionId, connection });
    if (position.colRaw.isZero()) return null;

    // Fetch prices in parallel (cached 60s)
    const [supplyPriceUsd, borrowPriceUsd] = await Promise.all([
      mp.supplyMint !== USDC_MINT
        ? cachedAsync(`jup_price_${mp.supplyMint}`, 60_000, async () => {
            const q = await getSwapQuote(mp.supplyMint, USDC_MINT, String(10 ** supplyDecimals), 50);
            return Number(q.outAmount) / 10 ** 6;
          })
        : 1,
      mp.borrowMint !== USDC_MINT
        ? cachedAsync(`jup_price_${mp.borrowMint}`, 60_000, async () => {
            const q = await getSwapQuote(mp.borrowMint, USDC_MINT, String(10 ** borrowDecimals), 50);
            return Number(q.outAmount) / 10 ** 6;
          })
        : 1,
    ]);

    const colTokens = position.colRaw.toNumber() / 10 ** supplyDecimals;
    const debtTokens = position.debtRaw.toNumber() / 10 ** borrowDecimals;
    const totalDepositUsd = colTokens * supplyPriceUsd;
    const totalBorrowUsd = debtTokens * borrowPriceUsd;
    const netValue = totalDepositUsd - totalBorrowUsd;

    const ltv = totalDepositUsd > 0 ? totalBorrowUsd / totalDepositUsd : 0;
    const leverage = totalDepositUsd > 0 ? totalDepositUsd / Math.max(0.01, netValue) : 1;

    // liquidation_threshold from Jupiter API is in per-mille (910 = 91%)
    const liquidationThreshold = Number(extraData.liquidation_threshold ?? 0);
    const liquidationLtv = liquidationThreshold > 0 ? liquidationThreshold / 1000 : 0.85;
    const healthFactor = ltv > 0 ? liquidationLtv / ltv : 0;

    return {
      balance: netValue, leverage, ltv, liquidationLtv,
      totalDepositUsd, totalBorrowUsd,
      borrowLimit: totalDepositUsd * liquidationLtv - totalBorrowUsd,
      healthFactor,
      positionId: mp.positionId,
    };
  } catch (err) {
    logger.error({ err, wallet: walletAddress.slice(0, 8) }, "Jupiter getMultiplyStats failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const jupiterAdapter: ProtocolAdapter = {
  async buildDepositTx(params) {
    if (params.category === "multiply") {
      const action = params.extraData?.action as string | undefined;
      if (action === "adjust") return buildMultiplyAdjust(params);
      if (action === "add_collateral" || action === "borrow_more") return buildMultiplyManage(params);
      return buildMultiplyOpen(params);
    }
    if (!isEarnCategory(params.category)) {
      throw Object.assign(new Error(`Jupiter adapter: unsupported category "${params.category}".`), { statusCode: 400 });
    }
    return buildEarnDeposit(params);
  },

  async buildWithdrawTx(params) {
    if (params.category === "multiply") {
      const action = params.extraData?.action as string | undefined;
      if (action === "withdraw_collateral" || action === "repay_debt") return buildMultiplyManage(params);
      return buildMultiplyClose(params);
    }
    if (!isEarnCategory(params.category)) {
      throw Object.assign(new Error(`Jupiter adapter: unsupported category "${params.category}".`), { statusCode: 400 });
    }
    return buildEarnWithdraw(params);
  },

  async getBalance(params) {
    if (isEarnCategory(params.category)) return getEarnBalance(params);
    if (params.category === "multiply") return getMultiplyBalance(params);
    return null;
  },
};
