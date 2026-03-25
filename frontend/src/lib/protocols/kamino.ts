import type { Instruction } from "@solana/kit";
import { address, createSolanaRpc, none } from "@solana/kit";
import type { ProtocolAdapter, BuildTxParams, BuildTxResultWithSetup } from "./types";
import { HELIUS_RPC_URL } from "../constants";
import { getKswapSdkInstance, createKswapQuoter, createKswapSwapper } from "../kswap";
import { selectBestRoute, assembleMultiplyLuts } from "../multiply-luts";

// klend-sdk bundles its own @solana/kit@2.x while we use 6.x.
// The types are structurally identical at runtime (same JSON-RPC), so we
// cast through `any` at the SDK boundary to satisfy TypeScript.
//
// klend-sdk also has Node.js-only dependencies, so we use dynamic import()
// to avoid bundling it at compile time — it's only loaded when a user
// actually initiates a transaction.
/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadSdk() {
  const [sdk, decimalMod] = await Promise.all([
    import("@kamino-finance/klend-sdk"),
    import("decimal.js"),
  ]);
  return {
    KaminoVault: sdk.KaminoVault,
    KaminoMarket: sdk.KaminoMarket,
    KaminoAction: sdk.KaminoAction,
    VanillaObligation: sdk.VanillaObligation,
    MultiplyObligation: sdk.MultiplyObligation,
    ObligationTypeTag: sdk.ObligationTypeTag,
    PROGRAM_ID: sdk.PROGRAM_ID,
    DEFAULT_RECENT_SLOT_DURATION_MS: sdk.DEFAULT_RECENT_SLOT_DURATION_MS,
    getDepositWithLeverageIxs: sdk.getDepositWithLeverageIxs,
    getRepayWithCollIxs: sdk.getRepayWithCollIxs,
    getUserLutAddressAndSetupIxs: sdk.getUserLutAddressAndSetupIxs,
    getScopeRefreshIxForObligationAndReserves: sdk.getScopeRefreshIxForObligationAndReserves,
    getComputeBudgetAndPriorityFeeIxs: sdk.getComputeBudgetAndPriorityFeeIxs,
    BN: (await import("bn.js")).default,
    Decimal: decimalMod.default,
  };
}

async function loadScope() {
  const { Scope } = await import("@kamino-finance/scope-sdk");
  return { Scope };
}

function getRpc(): any {
  return createSolanaRpc(HELIUS_RPC_URL);
}

function addr(s: string): any {
  return address(s);
}

// ---------------------------------------------------------------------------
// Vault helpers
// ---------------------------------------------------------------------------

/** Load a KaminoVault with fresh on-chain state and reserves. */
async function loadVault(depositAddress: string) {
  const { KaminoVault, Decimal } = await loadSdk();
  const vault = new KaminoVault(getRpc(), addr(depositAddress));
  await vault.reloadState();
  await vault.reloadVaultReserves();
  return { vault, Decimal };
}

/**
 * Convert a human-readable token amount to vault share units.
 * Uses the vault exchange rate (tokens-per-share) for conversion,
 * and caps at the user's total shares to avoid dust/rounding overflows.
 */
async function tokenAmountToShares(
  vault: any,
  userAddress: any,
  tokenAmount: any,
): Promise<any> {
  const [exchangeRate, userShares] = await Promise.all([
    vault.getExchangeRate(),
    vault.getUserShares(userAddress),
  ]);

  if (userShares.totalShares.isZero()) {
    throw new Error("No vault shares to withdraw");
  }

  const shareAmount = tokenAmount.div(exchangeRate);

  // Cap at total shares to avoid dust/rounding overflows on Max
  return shareAmount.greaterThan(userShares.totalShares)
    ? userShares.totalShares
    : shareAmount;
}

async function buildVaultDeposit(params: BuildTxParams): Promise<Instruction[]> {
  const { vault, Decimal } = await loadVault(params.depositAddress);
  const bundle = await vault.depositIxs(
    params.signer as any,
    new Decimal(params.amount),
  );
  return [
    ...bundle.depositIxs,
    ...bundle.stakeInFarmIfNeededIxs,
  ] as unknown as Instruction[];
}

async function buildVaultWithdraw(params: BuildTxParams): Promise<Instruction[]> {
  const { vault, Decimal } = await loadVault(params.depositAddress);

  const shareAmount = await tokenAmountToShares(
    vault,
    addr(params.signer.address),
    new Decimal(params.amount),
  );

  const bundle = await vault.withdrawIxs(params.signer as any, shareAmount);
  return [
    ...bundle.unstakeFromFarmIfNeededIxs,
    ...bundle.withdrawIxs,
    ...bundle.postWithdrawIxs,
  ] as unknown as Instruction[];
}

/** Parse and validate lending params from extraData, load market. */
async function prepareLending(params: BuildTxParams) {
  const { KaminoMarket, KaminoAction, VanillaObligation, PROGRAM_ID, BN } = await loadSdk();

  const marketAddress = params.extraData?.market as string | undefined;
  if (!marketAddress) throw new Error("Missing market address in extra_data");

  const tokenMint = params.extraData?.token_mint as string | undefined;
  if (!tokenMint) throw new Error("Missing token_mint in extra_data");

  const decimals = params.extraData?.decimals != null ? Number(params.extraData.decimals) : 6;
  const amountBase = new BN(Math.floor(parseFloat(params.amount) * 10 ** decimals));

  const market = await KaminoMarket.load(getRpc(), addr(marketAddress), 400);
  if (!market) throw new Error("Failed to load Kamino market");

  return { market, amountBase, tokenMint, KaminoAction, VanillaObligation, PROGRAM_ID };
}

/** Flatten a KaminoAction result into ordered instructions. */
function flattenLendingIxs(action: any): Instruction[] {
  return [
    ...action.computeBudgetIxs,
    ...action.setupIxs,
    ...action.lendingIxs,
    ...action.cleanupIxs,
  ] as unknown as Instruction[];
}

async function buildLendingDeposit(params: BuildTxParams): Promise<Instruction[]> {
  const { market, amountBase, tokenMint, KaminoAction, VanillaObligation, PROGRAM_ID } =
    await prepareLending(params);

  const action = await KaminoAction.buildDepositTxns(
    market, amountBase, addr(tokenMint),
    params.signer as any, new VanillaObligation(PROGRAM_ID),
    true, undefined,
  );

  return flattenLendingIxs(action);
}

async function buildLendingWithdraw(params: BuildTxParams): Promise<Instruction[]> {
  const { market, amountBase, tokenMint, KaminoAction, VanillaObligation, PROGRAM_ID } =
    await prepareLending(params);

  const action = await KaminoAction.buildWithdrawTxns(
    market, amountBase, addr(tokenMint),
    params.signer as any, new VanillaObligation(PROGRAM_ID),
    true, undefined,
  );

  return flattenLendingIxs(action);
}

function isVaultCategory(category: string): boolean {
  return category === "vault" || category === "earn_vault";
}

// ---------------------------------------------------------------------------
// Multiply helpers
// ---------------------------------------------------------------------------

/** Parse and validate multiply extraData fields. */
function parseMultiplyParams(extra: Record<string, unknown> | undefined) {
  if (!extra) throw new Error("Missing extra_data for multiply");

  const marketAddress = extra.market as string;
  const collMint = extra.collateral_mint as string;
  const debtMint = extra.debt_mint as string;
  const marketLut = extra.market_lookup_table as string | undefined;

  if (!marketAddress || !collMint || !debtMint) {
    throw new Error("Missing required multiply params (market, mints)");
  }

  return { marketAddress, collMint, debtMint, marketLut };
}

/** Load market, reserves, and KSwap routing for a multiply operation. */
async function prepareMultiply(params: BuildTxParams, slippageBps: number) {
  const sdk = await loadSdk();
  const { KaminoMarket, DEFAULT_RECENT_SLOT_DURATION_MS, Decimal, getComputeBudgetAndPriorityFeeIxs } = sdk;

  const { marketAddress, collMint, debtMint, marketLut } = parseMultiplyParams(params.extraData);
  const rpc = getRpc();
  const collTokenMint = addr(collMint);
  const debtTokenMint = addr(debtMint);

  const market = await KaminoMarket.load(rpc, addr(marketAddress), DEFAULT_RECENT_SLOT_DURATION_MS);
  if (!market) throw new Error("Failed to load Kamino market");

  const collReserve = market.getReserveByMint(collTokenMint);
  const debtReserve = market.getReserveByMint(debtTokenMint);
  if (!collReserve || !debtReserve) throw new Error("Failed to load reserves");

  const kswapSdk = await getKswapSdkInstance();
  const quoter = await createKswapQuoter(kswapSdk, params.signer.address as any, slippageBps, debtReserve, collReserve);
  const swapper = await createKswapSwapper(kswapSdk, params.signer.address as any, slippageBps, debtReserve, collReserve);

  const currentSlot = await rpc.getSlot().send();
  const computeIxs = getComputeBudgetAndPriorityFeeIxs(1_400_000, new Decimal(500000));

  return {
    sdk, rpc, market, collReserve, debtReserve, kswapSdk,
    collTokenMint, debtTokenMint, collMint, debtMint, marketLut,
    quoter, swapper, currentSlot, computeIxs, Decimal,
  };
}

/** Select best route and assemble LUTs into final result. */
async function finalizeMultiplyResult(
  routes: any,
  opts: { userLut: any; collMint: string; debtMint: string; marketLut?: string; isMultiply: boolean; setupTxsIxs: any[] },
): Promise<BuildTxResultWithSetup> {
  const bestRoute = selectBestRoute(routes);

  const lookupTableAddresses = await assembleMultiplyLuts({
    userLut: opts.userLut,
    collMint: opts.collMint,
    debtMint: opts.debtMint,
    marketLut: opts.marketLut,
    routeLuts: bestRoute.lookupTables || [],
    instructions: bestRoute.ixs,
    isMultiply: opts.isMultiply,
  });

  return {
    instructions: bestRoute.ixs as unknown as Instruction[],
    lookupTableAddresses,
    setupInstructionSets: opts.setupTxsIxs.length > 0
      ? opts.setupTxsIxs as unknown as Instruction[][]
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Multiply — Open (deposit with leverage)
// ---------------------------------------------------------------------------

async function buildMultiplyOpen(params: BuildTxParams): Promise<BuildTxResultWithSetup> {
  const ctx = await prepareMultiply(params, 30);
  const {
    sdk, rpc, market, collReserve, debtReserve, kswapSdk,
    collTokenMint, debtTokenMint, collMint, debtMint, marketLut,
    quoter, swapper, currentSlot, computeIxs, Decimal,
  } = ctx;
  const {
    MultiplyObligation, ObligationTypeTag, PROGRAM_ID,
    getDepositWithLeverageIxs, getUserLutAddressAndSetupIxs,
    getScopeRefreshIxForObligationAndReserves,
  } = sdk;

  const leverage = params.extraData!.leverage as number;
  if (!leverage) throw new Error("Missing leverage for multiply open");

  // Scope oracle refresh
  const { Scope } = await loadScope();
  const scope = new Scope("mainnet-beta", rpc);
  const scopeConfig = { scope, scopeConfigurations: await scope.getAllConfigurations() };

  // Load existing obligation (null for first open)
  const obligationAddress = await new MultiplyObligation(collTokenMint, debtTokenMint, PROGRAM_ID)
    .toPda(market.getAddress(), params.signer.address as any);
  let obligation: any = null;
  try {
    obligation = await market.getObligationByAddress(obligationAddress);
  } catch { /* first open — no obligation yet */ }

  const scopeRefreshIx = obligation
    ? await getScopeRefreshIxForObligationAndReserves(market, collReserve, debtReserve, obligation, scopeConfig)
    : [];

  // User LUT + setup txs
  const multiplyMints = [{ coll: collTokenMint, debt: debtTokenMint }];
  const [userLut, setupTxsIxs] = await getUserLutAddressAndSetupIxs(
    market, params.signer as any, none(), true, multiplyMints, [],
  );

  // Price for leverage calculation
  const priceDebtToColl = await kswapSdk.getJupiterPriceWithFallback({
    ids: debtMint, vsToken: collMint,
  }).then((res: any) => new Decimal(Number(res?.data?.[debtMint]?.price || 0)));

  const routes = await getDepositWithLeverageIxs({
    owner: params.signer as any,
    kaminoMarket: market,
    debtTokenMint, collTokenMint,
    depositAmount: new Decimal(params.amount),
    priceDebtToColl,
    slippagePct: new Decimal(30 / 100),
    obligation, referrer: none(), currentSlot,
    targetLeverage: new Decimal(leverage),
    selectedTokenMint: collTokenMint,
    obligationTypeTagOverride: ObligationTypeTag.Multiply,
    scopeRefreshIx, budgetAndPriorityFeeIxs: computeIxs,
    quoteBufferBps: new Decimal(1000),
    quoter, swapper, useV2Ixs: true,
  });

  return finalizeMultiplyResult(routes, {
    userLut, collMint, debtMint, marketLut, isMultiply: true, setupTxsIxs,
  });
}

// ---------------------------------------------------------------------------
// Multiply — Withdraw / Close (repay with collateral)
// ---------------------------------------------------------------------------

async function buildMultiplyClose(params: BuildTxParams): Promise<BuildTxResultWithSetup> {
  const ctx = await prepareMultiply(params, 50);
  const {
    sdk, market,
    collTokenMint, debtTokenMint, collMint, debtMint, marketLut,
    quoter, swapper, currentSlot, computeIxs, Decimal,
  } = ctx;
  const { VanillaObligation, PROGRAM_ID, getRepayWithCollIxs, getUserLutAddressAndSetupIxs } = sdk;

  const isClosingPosition = params.extraData!.isClosingPosition === true;

  // Load obligation (required for withdraw/close)
  const obligation = await market.getObligationByWallet(
    params.signer.address as any,
    new VanillaObligation(PROGRAM_ID),
  );
  if (!obligation) throw new Error("No active multiply position found");

  // User LUT + setup txs
  const [userLut, setupTxsIxs] = await getUserLutAddressAndSetupIxs(
    market, params.signer as any, none(), false,
  );

  const repayAmount = isClosingPosition
    ? new Decimal(0)
    : new Decimal(params.amount);

  const routes = await getRepayWithCollIxs({
    kaminoMarket: market,
    debtTokenMint, collTokenMint,
    owner: params.signer as any,
    obligation, referrer: none(), currentSlot,
    repayAmount, isClosingPosition,
    budgetAndPriorityFeeIxs: computeIxs,
    scopeRefreshIx: [], useV2Ixs: true,
    quoter, swapper,
  });

  return finalizeMultiplyResult(routes, {
    userLut, collMint, debtMint, marketLut, isMultiply: false, setupTxsIxs,
  });
}

export const kaminoAdapter: ProtocolAdapter = {
  async buildDepositTx(params) {
    if (params.category === "multiply") return buildMultiplyOpen(params);
    if (isVaultCategory(params.category)) return buildVaultDeposit(params);
    return buildLendingDeposit(params);
  },

  async buildWithdrawTx(params) {
    if (params.category === "multiply") return buildMultiplyClose(params);
    if (isVaultCategory(params.category)) return buildVaultWithdraw(params);
    return buildLendingWithdraw(params);
  },
};
