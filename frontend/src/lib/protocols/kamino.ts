import type { Instruction } from "@solana/kit";
import { address, none } from "@solana/kit";
import type { ProtocolAdapter, BuildTxParams, BuildTxResult, BuildTxResultWithLookups } from "./types";
import { getRpc } from "../rpc";
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

function addr(s: string): any {
  return address(s);
}

// ---------------------------------------------------------------------------
// Vault helpers
// ---------------------------------------------------------------------------

/** Load a KaminoVault with fresh on-chain state and reserves. */
async function loadVault(depositAddress: string) {
  const { KaminoVault, Decimal } = await loadSdk();
  const vault = new KaminoVault(getRpc() as any, addr(depositAddress));
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

/** Sentinel address used by the SDK when a field is unset. */
const NULL_ADDRESS = "11111111111111111111111111111111";

async function buildVaultWithdraw(params: BuildTxParams): Promise<BuildTxResult> {
  const { vault, Decimal } = await loadVault(params.depositAddress);
  const vaultState = await vault.getState();

  const shareAmount = await tokenAmountToShares(
    vault,
    addr(params.signer.address),
    new Decimal(params.amount),
  );

  const bundle = await vault.withdrawIxs(params.signer as any, shareAmount);
  const instructions = [
    ...bundle.unstakeFromFarmIfNeededIxs,
    ...bundle.withdrawIxs,
    ...bundle.postWithdrawIxs,
  ] as unknown as Instruction[];

  // Vault withdraw has 22+ accounts per reserve — needs ALT compression
  const vaultLut = vaultState.vaultLookupTable as string;
  if (vaultLut && vaultLut !== NULL_ADDRESS) {
    return { instructions, lookupTableAddresses: [vaultLut] };
  }

  return instructions;
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

  const market = await KaminoMarket.load(getRpc() as any, addr(marketAddress), 400);
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

/** Load market, reserves, and Jupiter swap routing for a multiply operation. */
async function prepareMultiply(params: BuildTxParams, slippageBps: number) {
  const sdk = await loadSdk();
  const { KaminoMarket, DEFAULT_RECENT_SLOT_DURATION_MS, Decimal, getComputeBudgetAndPriorityFeeIxs } = sdk;

  const { marketAddress, collMint, debtMint, marketLut } = parseMultiplyParams(params.extraData);
  const rpc = getRpc() as any;
  const collTokenMint = addr(collMint);
  const debtTokenMint = addr(debtMint);

  const market = await KaminoMarket.load(rpc, addr(marketAddress), DEFAULT_RECENT_SLOT_DURATION_MS);
  if (!market) throw new Error("Failed to load Kamino market");

  const collReserve = market.getReserveByMint(collTokenMint);
  const debtReserve = market.getReserveByMint(debtTokenMint);
  if (!collReserve || !debtReserve) throw new Error("Failed to load reserves");

  // KSwap quoter/swapper — required for klend-sdk flash loan compatibility
  const kswapSdk = await getKswapSdkInstance();
  const quoter = await createKswapQuoter(kswapSdk, params.signer.address as any, slippageBps, debtReserve, collReserve);
  const swapper = await createKswapSwapper(kswapSdk, params.signer.address as any, slippageBps, debtReserve, collReserve);

  const currentSlot = await rpc.getSlot().send();
  const computeIxs = getComputeBudgetAndPriorityFeeIxs(1_400_000, new Decimal(500000));

  return {
    sdk, rpc, market, collReserve, debtReserve,
    collTokenMint, debtTokenMint, collMint, debtMint, marketLut,
    quoter, swapper, currentSlot, computeIxs, Decimal,
  };
}

/** Select best route and assemble LUTs into final result. */
async function finalizeMultiplyResult(
  routes: any,
  opts: { userLut: any; collMint: string; debtMint: string; marketLut?: string; isMultiply: boolean },
): Promise<BuildTxResultWithLookups> {
  const bestRoute = selectBestRoute(routes);
  const ixCount = bestRoute.ixs?.length ?? 0;

  if (ixCount <= 2) {
    throw new Error("Swap routing failed — insufficient liquidity for this pair. Try a different market or increase slippage.");
  }

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
  };
}

// ---------------------------------------------------------------------------
// Multiply — Open (deposit with leverage)
// ---------------------------------------------------------------------------

async function buildMultiplyOpen(params: BuildTxParams): Promise<BuildTxResultWithLookups> {
  const userSlippage = (params.extraData?.slippageBps as number) ?? 30;
  const ctx = await prepareMultiply(params, userSlippage);
  const {
    sdk, rpc, market, collReserve, debtReserve,
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
  const [userLut] = await getUserLutAddressAndSetupIxs(
    market, params.signer as any, none(), true, multiplyMints, [],
  );

  // Price: fetch both USD prices via Jupiter and compute debt-to-coll ratio
  const priceRes = await fetch(`https://lite-api.jup.ag/price/v3?ids=${debtMint},${collMint}`);
  if (!priceRes.ok) throw new Error(`Jupiter price fetch failed: ${priceRes.status}`);
  const priceData = await priceRes.json();
  const debtPriceUsd = Number(priceData?.[debtMint]?.usdPrice || 0);
  const collPriceUsd = Number(priceData?.[collMint]?.usdPrice || 0);

  if (!debtPriceUsd || !collPriceUsd) {
    throw new Error(`Price unavailable — debt: $${debtPriceUsd}, coll: $${collPriceUsd}`);
  }
  const priceDebtToColl = new Decimal(debtPriceUsd / collPriceUsd);

  // Validate inputs before SDK call
  if (priceDebtToColl.isZero() || priceDebtToColl.isNaN()) {
    throw new Error("Invalid price ratio — cannot calculate leverage");
  }

  const routes = await getDepositWithLeverageIxs({
    owner: params.signer as any,
    kaminoMarket: market,
    debtTokenMint, collTokenMint,
    depositAmount: new Decimal(params.amount),
    priceDebtToColl,
    slippagePct: new Decimal(userSlippage / 100),
    obligation, referrer: none(), currentSlot,
    targetLeverage: new Decimal(leverage),
    selectedTokenMint: collTokenMint,
    obligationTypeTagOverride: ObligationTypeTag.Multiply,
    scopeRefreshIx, budgetAndPriorityFeeIxs: computeIxs,
    quoteBufferBps: new Decimal(100),
    quoter, swapper, useV2Ixs: true,
  });

  return finalizeMultiplyResult(routes, {
    userLut, collMint, debtMint, marketLut, isMultiply: true,
  });
}

// ---------------------------------------------------------------------------
// Multiply — Withdraw / Close (repay with collateral)
// ---------------------------------------------------------------------------

async function buildMultiplyClose(params: BuildTxParams): Promise<BuildTxResultWithLookups> {
  const userSlippage = (params.extraData?.slippageBps as number) ?? 50;
  const ctx = await prepareMultiply(params, userSlippage);
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

  // User LUT (setup handled separately by useMultiplySetup)
  const [userLut] = await getUserLutAddressAndSetupIxs(
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
    userLut, collMint, debtMint, marketLut, isMultiply: false,
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

  async getBalance({ walletAddress, depositAddress, category }) {
    if (!isVaultCategory(category)) return null;
    const sdk = await import("@kamino-finance/klend-sdk");
    const { getRpc } = await import("@/lib/rpc");
    const { address } = await import("@solana/kit");
    const vault = new sdk.KaminoVault(getRpc() as any, address(depositAddress) as any);
    const [exchangeRate, userShares] = await Promise.all([
      vault.getExchangeRate(),
      vault.getUserShares(address(walletAddress) as any),
    ]);
    if (userShares.totalShares.isZero()) return 0;
    return userShares.totalShares.mul(exchangeRate).toNumber();
  },
};
