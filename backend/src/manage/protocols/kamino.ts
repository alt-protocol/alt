import type { Instruction } from "@solana/kit";
import { address, none } from "@solana/kit";
import type {
  ProtocolAdapter,
  BuildTxParams,
  BuildTxResult,
  BuildTxResultWithLookups,
  BuildTxResultWithSetup,
  GetBalanceParams,
  PriceImpactParams,
  PriceImpactEstimate,
} from "./types.js";
import { getRpc } from "../../shared/rpc.js";
import { logger } from "../../shared/logger.js";
import { cachedAsync } from "../../shared/utils.js";
import { resolveDecimals } from "../services/decimals.js";
import { getJupiterLiteQuote } from "../../shared/jupiter-quote.js";
import {
  createJupiterMultiplyQuoter,
  createJupiterMultiplySwapper,
  createImpactCapture,
} from "../services/jupiter-multiply-swap.js";
import {
  selectBestRoute,
  assembleMultiplyLuts,
} from "../services/multiply-luts.js";
import { guardPriceImpact } from "../services/guards.js";

// klend-sdk bundles its own @solana/kit@2.x while we use 6.x.
// The types are structurally identical at runtime (same JSON-RPC), so we
// cast through `any` at the SDK boundary to satisfy TypeScript.
/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadSdk() {
  const [sdk, decimalMod] = await Promise.all([
    import("@kamino-finance/klend-sdk"),
    import("decimal.js"),
  ]);
  // decimal.js ESM default export is the Decimal constructor itself
  const Decimal = decimalMod.default as unknown as typeof import("decimal.js").default;
  return {
    KaminoVault: sdk.KaminoVault,
    KaminoMarket: sdk.KaminoMarket,
    KaminoAction: sdk.KaminoAction,
    VanillaObligation: sdk.VanillaObligation,
    LendingObligation: sdk.LendingObligation,
    MultiplyObligation: sdk.MultiplyObligation,
    ObligationTypeTag: sdk.ObligationTypeTag,
    PROGRAM_ID: sdk.PROGRAM_ID,
    DEFAULT_RECENT_SLOT_DURATION_MS: sdk.DEFAULT_RECENT_SLOT_DURATION_MS,
    getDepositWithLeverageIxs: sdk.getDepositWithLeverageIxs,
    getWithdrawWithLeverageIxs: sdk.getWithdrawWithLeverageIxs,
    getAdjustLeverageIxs: sdk.getAdjustLeverageIxs,
    getUserLutAddressAndSetupIxs: sdk.getUserLutAddressAndSetupIxs,
    getScopeRefreshIxForObligationAndReserves:
      sdk.getScopeRefreshIxForObligationAndReserves,
    getComputeBudgetAndPriorityFeeIxs: sdk.getComputeBudgetAndPriorityFeeIxs,
    BN: (await import("bn.js")).default,
    Decimal,
  };
}

async function loadScope() {
  const { Scope } = await import("@kamino-finance/scope-sdk");
  return { Scope };
}

function addr(s: string): any {
  return address(s);
}

const MARKET_CACHE_TTL = 120_000; // 2 minutes — market config changes rarely

/** Load KaminoMarket with deduplication + caching. Shared by all multiply operations. */
async function loadMarketCached(marketAddress: string): Promise<any> {
  const sdk = await loadSdk();
  return cachedAsync(
    `kamino-market:${marketAddress}`,
    MARKET_CACHE_TTL,
    () =>
      sdk.KaminoMarket.load(
        getRpc() as any,
        addr(marketAddress),
        sdk.DEFAULT_RECENT_SLOT_DURATION_MS,
      ),
  );
}

/**
 * Wrap a wallet address as a TransactionSigner-like object for the klend SDK.
 * The SDK accesses `user.address` internally to derive ATAs and build
 * instruction accounts. A plain Address string has `.address === undefined`,
 * which breaks deposit/withdraw instruction building. Since the backend never
 * signs transactions (non-custodial), only the `.address` property is needed.
 */
function walletSigner(walletAddress: string): any {
  return { address: addr(walletAddress) };
}

// ---------------------------------------------------------------------------
// Vault helpers
// ---------------------------------------------------------------------------

/** Load a KaminoVault with fresh on-chain state and reserves. */
async function loadVault(depositAddress: string) {
  const { KaminoVault, Decimal } = await loadSdk();
  const vault = new KaminoVault(getRpc() as any, addr(depositAddress));
  try {
    await vault.reloadState();
    await vault.reloadVaultReserves();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw Object.assign(
      new Error(
        `Failed to load vault ${depositAddress.slice(0, 8)}: ${msg}`,
      ),
      { statusCode: 400 },
    );
  }
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

async function buildVaultDeposit(
  params: BuildTxParams,
): Promise<Instruction[]> {
  try {
    const { vault, Decimal } = await loadVault(params.depositAddress);
    const bundle = await vault.depositIxs(
      walletSigner(params.walletAddress),
      new Decimal(params.amount),
    );
    return [
      ...bundle.depositIxs,
      ...bundle.stakeInFarmIfNeededIxs,
    ] as unknown as Instruction[];
  } catch (err: unknown) {
    if (err instanceof Error && "statusCode" in err) throw err;
    logger.error({ err, vault: params.depositAddress }, "Kamino vault deposit SDK error");
    throw Object.assign(
      new Error(
        "Kamino vault deposit failed. Please check the amount and try again.",
      ),
      { statusCode: 400 },
    );
  }
}

/** Sentinel address used by the SDK when a field is unset. */
const NULL_ADDRESS = "11111111111111111111111111111111";

async function buildVaultWithdraw(
  params: BuildTxParams,
): Promise<BuildTxResult> {
  try {
    const { vault, Decimal } = await loadVault(params.depositAddress);
    const vaultState = await vault.getState();

    const shareAmount = await tokenAmountToShares(
      vault,
      addr(params.walletAddress),
      new Decimal(params.amount),
    );

    const bundle = await vault.withdrawIxs(
      walletSigner(params.walletAddress),
      shareAmount,
    );
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
  } catch (err: unknown) {
    if (err instanceof Error && "statusCode" in err) throw err;
    logger.error({ err, vault: params.depositAddress }, "Kamino vault withdraw SDK error");
    throw Object.assign(
      new Error(
        "Kamino vault withdraw failed. The position may not exist or the amount may exceed your balance.",
      ),
      { statusCode: 400 },
    );
  }
}

/** Parse and validate lending params from extraData, load market. */
async function prepareLending(params: BuildTxParams) {
  const {
    KaminoMarket,
    KaminoAction,
    VanillaObligation,
    PROGRAM_ID,
    BN,
  } = await loadSdk();

  const marketAddress = params.extraData?.market as string | undefined;
  if (!marketAddress)
    throw Object.assign(new Error("Missing market address in extra_data"), {
      statusCode: 400,
    });

  const tokenMint = params.extraData?.token_mint as string | undefined;
  if (!tokenMint)
    throw Object.assign(new Error("Missing token_mint in extra_data"), {
      statusCode: 400,
    });

  const decimals = await resolveDecimals(params.extraData);
  const amountBase = new BN(
    Math.floor(parseFloat(params.amount) * 10 ** decimals),
  );

  const market = await KaminoMarket.load(
    getRpc() as any,
    addr(marketAddress),
    400,
  );
  if (!market)
    throw Object.assign(new Error("Failed to load Kamino market"), {
      statusCode: 502,
    });

  return {
    market,
    amountBase,
    tokenMint,
    KaminoAction,
    VanillaObligation,
    PROGRAM_ID,
  };
}

/** Flatten a KaminoAction result into ordered instructions. */
function flattenLendingIxs(action: any): Instruction[] {
  const raw = [
    ...action.computeBudgetIxs,
    ...action.setupIxs,
    ...action.lendingIxs,
    ...action.cleanupIxs,
  ];
  // Ensure every instruction has an accounts array — compute budget ixs
  // from the SDK may omit it (they have no account inputs).
  return raw.map((ix: any) => ({
    ...ix,
    accounts: ix.accounts ?? [],
  })) as unknown as Instruction[];
}

async function buildLendingDeposit(
  params: BuildTxParams,
): Promise<Instruction[]> {
  try {
    const {
      market,
      amountBase,
      tokenMint,
      KaminoAction,
      VanillaObligation,
      PROGRAM_ID,
    } = await prepareLending(params);

    const action = await KaminoAction.buildDepositTxns(
      market,
      amountBase,
      addr(tokenMint),
      walletSigner(params.walletAddress),
      new VanillaObligation(PROGRAM_ID),
      true,
      undefined,
    );

    return flattenLendingIxs(action);
  } catch (err: unknown) {
    if (err instanceof Error && "statusCode" in err) throw err;
    logger.error({ err }, "Kamino lending deposit SDK error");
    throw Object.assign(
      new Error(
        "Kamino lending deposit failed. Please check the amount and try again.",
      ),
      { statusCode: 400 },
    );
  }
}

async function buildLendingWithdraw(
  params: BuildTxParams,
): Promise<Instruction[]> {
  try {
    const {
      market,
      amountBase,
      tokenMint,
      KaminoAction,
      VanillaObligation,
      PROGRAM_ID,
    } = await prepareLending(params);

    const action = await KaminoAction.buildWithdrawTxns(
      market,
      amountBase,
      addr(tokenMint),
      walletSigner(params.walletAddress),
      new VanillaObligation(PROGRAM_ID),
      true,
      undefined,
    );

    return flattenLendingIxs(action);
  } catch (err: unknown) {
    if (err instanceof Error && "statusCode" in err) throw err;
    logger.error({ err }, "Kamino lending withdraw SDK error");
    throw Object.assign(
      new Error(
        "Kamino lending withdraw failed. The position may not exist or the amount may exceed your balance.",
      ),
      { statusCode: 400 },
    );
  }
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

/** Load market, reserves, and KSwap swap routing for a multiply operation. */
async function prepareMultiply(params: BuildTxParams, slippageBps: number) {
  const sdk = await loadSdk();
  const {
    KaminoMarket,
    DEFAULT_RECENT_SLOT_DURATION_MS,
    Decimal,
    getComputeBudgetAndPriorityFeeIxs,
  } = sdk;

  const { marketAddress, collMint, debtMint, marketLut } =
    parseMultiplyParams(params.extraData);
  const rpc = getRpc() as any;
  const collTokenMint = addr(collMint);
  const debtTokenMint = addr(debtMint);

  const market = await loadMarketCached(marketAddress);
  if (!market)
    throw Object.assign(new Error("Failed to load Kamino market"), {
      statusCode: 502,
    });

  const collReserve = market.getReserveByMint(collTokenMint);
  const debtReserve = market.getReserveByMint(debtTokenMint);
  if (!collReserve || !debtReserve) throw new Error("Failed to load reserves");

  // Jupiter quoter/swapper for klend-sdk flash loan swap routing
  const impactCapture = createImpactCapture();
  const quoter = createJupiterMultiplyQuoter(
    params.walletAddress,
    slippageBps,
    debtReserve,
    collReserve,
    impactCapture,
  );
  const swapper = createJupiterMultiplySwapper(
    params.walletAddress,
    slippageBps,
    debtReserve,
    collReserve,
    impactCapture,
  );

  const currentSlot = await rpc.getSlot().send();
  const computeIxs = getComputeBudgetAndPriorityFeeIxs(
    1_400_000,
    new Decimal(500000),
  );

  return {
    sdk,
    rpc,
    market,
    collReserve,
    debtReserve,
    collTokenMint,
    debtTokenMint,
    collMint,
    debtMint,
    marketLut,
    quoter,
    swapper,
    currentSlot,
    computeIxs,
    Decimal,
    impactCapture,
  };
}

/** Select best route and assemble LUTs into final result. */
async function finalizeMultiplyResult(
  routes: any,
  opts: {
    userLut: any;
    collMint: string;
    debtMint: string;
    marketLut?: string;
    isMultiply: boolean;
    setupInstructionSets?: Instruction[][];
    metadata?: Record<string, unknown>;
  },
): Promise<BuildTxResultWithLookups | BuildTxResultWithSetup> {
  const bestRoute = selectBestRoute(routes);
  const ixCount = bestRoute.ixs?.length ?? 0;

  if (ixCount <= 2) {
    throw new Error(
      "Swap routing failed — insufficient liquidity for this pair. Try a different market or increase slippage.",
    );
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

  const result: BuildTxResultWithLookups = {
    instructions: bestRoute.ixs as unknown as Instruction[],
    lookupTableAddresses,
    metadata: opts.metadata,
  };

  // Include setup instructions if LUT creation is needed
  if (opts.setupInstructionSets && opts.setupInstructionSets.length > 0) {
    return {
      ...result,
      setupInstructionSets: opts.setupInstructionSets,
    } as BuildTxResultWithSetup;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Multiply — Open (deposit with leverage)
// ---------------------------------------------------------------------------

async function buildMultiplyOpen(
  params: BuildTxParams,
): Promise<BuildTxResultWithLookups | BuildTxResultWithSetup> {
  try {
    const userSlippage = (params.extraData?.slippageBps as number) ?? 30;
    const ctx = await prepareMultiply(params, userSlippage);
    const {
      sdk,
      rpc,
      market,
      collTokenMint,
      debtTokenMint,
      collMint,
      debtMint,
      marketLut,
      quoter,
      swapper,
      currentSlot,
      computeIxs,
      Decimal,
    } = ctx;
    const {
      MultiplyObligation,
      ObligationTypeTag,
      PROGRAM_ID,
      getDepositWithLeverageIxs,
      getUserLutAddressAndSetupIxs,
      getScopeRefreshIxForObligationAndReserves,
    } = sdk;

    const leverage = params.extraData!.leverage as number;
    if (!leverage) {
      throw Object.assign(new Error("Missing leverage for multiply open"), {
        statusCode: 400,
      });
    }

    // Check borrow capacity before building (uses on-chain data from loaded market)
    const maxBorrow = ctx.debtReserve.getMaxBorrowAmountWithCollReserve(
      market,
      ctx.collReserve,
    );
    if (maxBorrow.lessThanOrEqualTo(0)) {
      const debtSymbol =
        (params.extraData?.debt_symbol as string) ?? "debt token";
      throw Object.assign(
        new Error(
          `No ${debtSymbol} available to borrow on this market`,
        ),
        { statusCode: 400 },
      );
    }

    // Scope oracle refresh
    const { Scope } = await loadScope();
    const scope = new Scope("mainnet-beta", rpc);
    const scopeConfig = {
      scope,
      scopeConfigurations: await scope.getAllConfigurations(),
    };

    // Load existing obligation (null for first open)
    const obligationAddress = await new MultiplyObligation(
      collTokenMint,
      debtTokenMint,
      PROGRAM_ID,
    ).toPda(market.getAddress(), params.walletAddress as any);
    let obligation: any = null;
    try {
      obligation = await market.getObligationByAddress(obligationAddress);
    } catch {
      /* first open — no obligation yet */
    }

    const scopeRefreshIx = obligation
      ? await getScopeRefreshIxForObligationAndReserves(
          market,
          ctx.collReserve,
          ctx.debtReserve,
          obligation,
          scopeConfig,
        )
      : [];

    // User LUT + setup txs
    const multiplyMints = [{ coll: collTokenMint, debt: debtTokenMint }];
    const [userLut, setupTxsIxs] = await getUserLutAddressAndSetupIxs(
      market,
      walletSigner(params.walletAddress),
      none(),
      true,
      multiplyMints,
      [],
    );

    // Use on-chain oracle prices from loaded reserves (no extra HTTP call)
    const debtPrice = ctx.debtReserve.getOracleMarketPrice();
    const collPrice = ctx.collReserve.getOracleMarketPrice();
    if (!debtPrice || !collPrice || collPrice.isZero()) {
      throw Object.assign(
        new Error("Oracle price unavailable for debt or collateral reserve"),
        { statusCode: 400 },
      );
    }
    const priceDebtToColl = debtPrice.div(collPrice);

    logger.info(
      {
        wallet: params.walletAddress.slice(0, 8),
        leverage,
        slippage: userSlippage,
        collMint: collMint.slice(0, 8),
        debtMint: debtMint.slice(0, 8),
      },
      "Building multiply open",
    );

    const routes = await getDepositWithLeverageIxs({
      owner: walletSigner(params.walletAddress),
      kaminoMarket: market,
      debtTokenMint,
      collTokenMint,
      depositAmount: new Decimal(params.amount),
      priceDebtToColl,
      slippagePct: new Decimal(userSlippage / 100),
      obligation,
      referrer: none(),
      currentSlot,
      targetLeverage: new Decimal(leverage),
      selectedTokenMint:
        params.extraData?.deposit_token === "debt" ? debtTokenMint : collTokenMint,
      obligationTypeTagOverride: ObligationTypeTag.Multiply,
      scopeRefreshIx,
      budgetAndPriorityFeeIxs: computeIxs,
      quoteBufferBps: new Decimal(100),
      quoter,
      swapper,
      useV2Ixs: true,
    });

    // Price impact guard: compare swap execution price to oracle price
    let priceImpactMeta: Record<string, unknown> | undefined;
    if (ctx.impactCapture.executionPrice !== null) {
      const oraclePrice = priceDebtToColl.toNumber();
      const deviationPct =
        (Math.abs(ctx.impactCapture.executionPrice - oraclePrice) /
          oraclePrice) *
        100;
      logger.info(
        {
          executionPrice: ctx.impactCapture.executionPrice,
          oraclePrice,
          deviationPct: deviationPct.toFixed(4),
        },
        "Multiply open: swap vs oracle price comparison",
      );
      const impact = guardPriceImpact(deviationPct);
      priceImpactMeta = {
        priceImpactPct: deviationPct,
        ...(impact.warning ? { priceImpactWarning: true } : {}),
      };
    }

    // Filter to non-empty setup instruction sets
    const nonEmptySetups = (setupTxsIxs as any[][])
      .filter((ixs: any[]) => ixs.length > 0)
      .map((ixs: any[]) => ixs as unknown as Instruction[]);

    return finalizeMultiplyResult(routes, {
      userLut,
      collMint,
      debtMint,
      marketLut,
      isMultiply: true,
      setupInstructionSets:
        nonEmptySetups.length > 0 ? nonEmptySetups : undefined,
      metadata: priceImpactMeta,
    });
  } catch (err: unknown) {
    if (err instanceof Error && "statusCode" in err) throw err;
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error(
      { err, wallet: params.walletAddress.slice(0, 8) },
      `Multiply open failed: ${msg}`,
    );
    throw Object.assign(new Error(`Multiply open failed: ${msg}`), {
      statusCode: 502,
    });
  }
}

// ---------------------------------------------------------------------------
// Multiply — Withdraw / Close (proportional deleverage via flash loan)
// ---------------------------------------------------------------------------

async function buildMultiplyWithdraw(
  params: BuildTxParams,
): Promise<BuildTxResultWithLookups | BuildTxResultWithSetup> {
  try {
    const userSlippage = (params.extraData?.slippageBps as number) ?? 50;
    const ctx = await prepareMultiply(params, userSlippage);
    const {
      sdk,
      market,
      collTokenMint,
      debtTokenMint,
      collMint,
      debtMint,
      marketLut,
      quoter,
      swapper,
      currentSlot,
      computeIxs,
      Decimal,
    } = ctx;
    const {
      MultiplyObligation,
      PROGRAM_ID,
      getWithdrawWithLeverageIxs,
      getUserLutAddressAndSetupIxs,
    } = sdk;

    const isClosingPosition = params.extraData!.isClosingPosition === true;

    // Load obligation
    const multiplyOblType = new MultiplyObligation(
      collTokenMint,
      debtTokenMint,
      PROGRAM_ID,
    );
    const obligation = await market.getObligationByWallet(
      params.walletAddress as any,
      multiplyOblType,
    );
    if (!obligation) {
      throw Object.assign(
        new Error("No active multiply position found"),
        { statusCode: 400 },
      );
    }

    // Current deposited/borrowed amounts from obligation
    const collReserve = ctx.collReserve;
    const debtReserve = ctx.debtReserve;
    const collDeposit = obligation.getDepositByReserve(collReserve.address);
    const debtBorrow = obligation.getBorrowByReserve(debtReserve.address);
    // SDK expects human-readable token amounts, not lamports.
    // obligation.amount is in lamports — divide by mintFactor to convert.
    const deposited = (collDeposit?.amount ?? new Decimal(0)).div(collReserve.getMintFactor());
    const borrowed = (debtBorrow?.amount ?? new Decimal(0)).div(debtReserve.getMintFactor());

    // withdrawAmount: full deposit for close, user-specified for partial
    const withdrawAmount = isClosingPosition
      ? deposited
      : new Decimal(params.amount);

    // Oracle price ratio
    const debtPrice = debtReserve.getOracleMarketPrice();
    const collPrice = collReserve.getOracleMarketPrice();
    const priceCollToDebt = collPrice.div(debtPrice);

    // User LUT
    const multiplyMints = [{ coll: collTokenMint, debt: debtTokenMint }];
    const [userLut, setupTxsIxs] = await getUserLutAddressAndSetupIxs(
      market,
      walletSigner(params.walletAddress),
      none(),
      true,
      multiplyMints,
      [],
    );

    logger.info(
      {
        wallet: params.walletAddress.slice(0, 8),
        withdrawAmount: withdrawAmount.toString(),
        isClosingPosition,
      },
      "Building multiply withdraw",
    );

    const routes = await getWithdrawWithLeverageIxs({
      owner: walletSigner(params.walletAddress),
      kaminoMarket: market,
      debtTokenMint,
      collTokenMint,
      obligation,
      deposited,
      borrowed,
      referrer: none(),
      currentSlot,
      withdrawAmount,
      priceCollToDebt,
      slippagePct: new Decimal(userSlippage / 100),
      isClosingPosition,
      selectedTokenMint: collTokenMint,
      budgetAndPriorityFeeIxs: computeIxs,
      scopeRefreshIx: [],
      quoteBufferBps: new Decimal(userSlippage),
      quoter,
      swapper,
      useV2Ixs: true,
      userSolBalanceLamports: 0,
    });

    // Price impact guard: compare swap execution price to oracle price
    // For withdraw, the swap direction is collateral → debt, so compare to priceCollToDebt
    let priceImpactMeta: Record<string, unknown> | undefined;
    if (ctx.impactCapture.executionPrice !== null) {
      const oraclePrice = priceCollToDebt.toNumber();
      const deviationPct =
        (Math.abs(ctx.impactCapture.executionPrice - oraclePrice) /
          oraclePrice) *
        100;
      logger.info(
        {
          executionPrice: ctx.impactCapture.executionPrice,
          oraclePrice,
          deviationPct: deviationPct.toFixed(4),
        },
        "Multiply withdraw: swap vs oracle price comparison",
      );
      const impact = guardPriceImpact(deviationPct);
      priceImpactMeta = {
        priceImpactPct: deviationPct,
        ...(impact.warning ? { priceImpactWarning: true } : {}),
      };
    }

    const nonEmptySetups = (setupTxsIxs as any[][])
      .filter((ixs: any[]) => ixs.length > 0)
      .map((ixs: any[]) => ixs as unknown as Instruction[]);

    return finalizeMultiplyResult(routes, {
      userLut,
      collMint,
      debtMint,
      marketLut,
      isMultiply: false,
      setupInstructionSets:
        nonEmptySetups.length > 0 ? nonEmptySetups : undefined,
      metadata: priceImpactMeta,
    });
  } catch (err: unknown) {
    if (err instanceof Error && "statusCode" in err) throw err;
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error(
      { err, wallet: params.walletAddress.slice(0, 8) },
      `Multiply withdraw failed: ${msg}`,
    );
    throw Object.assign(new Error(`Multiply withdraw failed: ${msg}`), {
      statusCode: 502,
    });
  }
}

// ---------------------------------------------------------------------------
// Multiply — Adjust leverage (increase or decrease)
// ---------------------------------------------------------------------------

async function buildMultiplyAdjust(
  params: BuildTxParams,
): Promise<BuildTxResultWithLookups | BuildTxResultWithSetup> {
  try {
    const userSlippage = (params.extraData?.slippageBps as number) ?? 50;
    const ctx = await prepareMultiply(params, userSlippage);
    const {
      sdk,
      market,
      collTokenMint,
      debtTokenMint,
      collMint,
      debtMint,
      marketLut,
      quoter,
      swapper,
      currentSlot,
      computeIxs,
      Decimal,
    } = ctx;
    const {
      MultiplyObligation,
      PROGRAM_ID,
      getAdjustLeverageIxs,
      getUserLutAddressAndSetupIxs,
    } = sdk;

    const targetLeverage = params.extraData!.leverage as number;
    if (!targetLeverage) {
      throw Object.assign(new Error("Missing target leverage"), {
        statusCode: 400,
      });
    }

    // Load obligation (required — must have existing position)
    const multiplyOblType = new MultiplyObligation(
      collTokenMint,
      debtTokenMint,
      PROGRAM_ID,
    );
    const obligation = await market.getObligationByWallet(
      params.walletAddress as any,
      multiplyOblType,
    );
    if (!obligation) {
      throw Object.assign(
        new Error("No active multiply position to adjust"),
        { statusCode: 400 },
      );
    }

    // Get current deposit/borrow amounts from obligation
    const collReserve = ctx.collReserve;
    const debtReserve = ctx.debtReserve;
    const collDeposit = obligation.getDepositByReserve(collReserve.address);
    const debtBorrow = obligation.getBorrowByReserve(debtReserve.address);
    // SDK expects human-readable token amounts, not lamports.
    const depositedLamports = (collDeposit?.amount ?? new Decimal(0)).div(collReserve.getMintFactor());
    const borrowedLamports = (debtBorrow?.amount ?? new Decimal(0)).div(debtReserve.getMintFactor());

    // Oracle prices for both directions
    const debtPrice = debtReserve.getOracleMarketPrice();
    const collPrice = collReserve.getOracleMarketPrice();
    const priceDebtToColl = debtPrice.div(collPrice);
    const priceCollToDebt = collPrice.div(debtPrice);

    // User LUT
    const multiplyMints = [{ coll: collTokenMint, debt: debtTokenMint }];
    const [userLut, setupTxsIxs] = await getUserLutAddressAndSetupIxs(
      market,
      walletSigner(params.walletAddress),
      none(),
      true,
      multiplyMints,
      [],
    );

    logger.info(
      {
        wallet: params.walletAddress.slice(0, 8),
        currentLeverage: Number(obligation.refreshedStats.leverage).toFixed(2),
        targetLeverage,
      },
      "Adjusting multiply leverage",
    );

    const routes = await getAdjustLeverageIxs({
      owner: walletSigner(params.walletAddress),
      kaminoMarket: market,
      debtTokenMint,
      collTokenMint,
      obligation,
      depositedLamports,
      borrowedLamports,
      referrer: none(),
      currentSlot,
      targetLeverage: new Decimal(targetLeverage),
      priceCollToDebt,
      priceDebtToColl,
      slippagePct: new Decimal(userSlippage / 100),
      budgetAndPriorityFeeIxs: computeIxs,
      scopeRefreshIx: [],
      quoteBufferBps: new Decimal(100),
      quoter,
      swapper,
      useV2Ixs: true,
      userSolBalanceLamports: 0,
    });

    // Price impact guard: compare swap execution price to oracle price
    let priceImpactMeta: Record<string, unknown> | undefined;
    if (ctx.impactCapture.executionPrice !== null) {
      // Adjust direction depends on leverage change — quoter uses debt→coll direction
      const oraclePrice = priceDebtToColl.toNumber();
      const deviationPct =
        (Math.abs(ctx.impactCapture.executionPrice - oraclePrice) /
          oraclePrice) *
        100;
      logger.info(
        {
          executionPrice: ctx.impactCapture.executionPrice,
          oraclePrice,
          deviationPct: deviationPct.toFixed(4),
        },
        "Multiply adjust: swap vs oracle price comparison",
      );
      const impact = guardPriceImpact(deviationPct);
      priceImpactMeta = {
        priceImpactPct: deviationPct,
        ...(impact.warning ? { priceImpactWarning: true } : {}),
      };
    }

    const nonEmptySetups = (setupTxsIxs as any[][])
      .filter((ixs: any[]) => ixs.length > 0)
      .map((ixs: any[]) => ixs as unknown as Instruction[]);

    return finalizeMultiplyResult(routes, {
      userLut,
      collMint,
      debtMint,
      marketLut,
      isMultiply: true,
      setupInstructionSets:
        nonEmptySetups.length > 0 ? nonEmptySetups : undefined,
      metadata: priceImpactMeta,
    });
  } catch (err: unknown) {
    if (err instanceof Error && "statusCode" in err) throw err;
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error(
      { err, wallet: params.walletAddress.slice(0, 8) },
      `Multiply adjust failed: ${msg}`,
    );
    throw Object.assign(new Error(`Multiply adjust failed: ${msg}`), {
      statusCode: 502,
    });
  }
}

// ---------------------------------------------------------------------------
// Multiply — Manage collateral & debt (simple lending ops on obligation)
// ---------------------------------------------------------------------------

type ManageAction =
  | "add_collateral"
  | "withdraw_collateral"
  | "borrow_more"
  | "repay_debt";

async function buildMultiplyManage(
  params: BuildTxParams,
): Promise<BuildTxResult> {
  try {
    const sdk = await loadSdk();
    const { KaminoMarket, KaminoAction, MultiplyObligation, PROGRAM_ID, DEFAULT_RECENT_SLOT_DURATION_MS } = sdk;

    const { marketAddress, collMint, debtMint } = parseMultiplyParams(params.extraData);
    const rpc = getRpc() as any;
    const action = params.extraData!.action as ManageAction;

    const market = await loadMarketCached(marketAddress);
    if (!market)
      throw Object.assign(new Error("Failed to load Kamino market"), { statusCode: 502 });

    // Load existing obligation
    const oblType = new MultiplyObligation(addr(collMint), addr(debtMint), PROGRAM_ID);
    const obligation = await market.getObligationByWallet(
      params.walletAddress as any,
      oblType,
    );
    if (!obligation)
      throw Object.assign(new Error("No active multiply position"), { statusCode: 400 });

    // Determine mint, decimals, and SDK method based on action
    const isCollateral = action === "add_collateral" || action === "withdraw_collateral";
    const mintStr = isCollateral ? collMint : debtMint;
    const mint = addr(mintStr);
    const reserve = market.getReserveByMint(mint);
    const decimals = reserve?.stats?.decimals ?? 6;

    // Convert human-readable amount to lamports (KaminoAction expects smallest unit)
    const amountLamports = Math.round(
      parseFloat(params.amount) * 10 ** decimals,
    ).toString();

    const buildFn =
      action === "add_collateral" ? KaminoAction.buildDepositTxns
        : action === "withdraw_collateral" ? KaminoAction.buildWithdrawTxns
          : action === "borrow_more" ? KaminoAction.buildBorrowTxns
            : KaminoAction.buildRepayTxns;

    const axn = await (buildFn as any)(
      market,
      amountLamports,
      mint,
      walletSigner(params.walletAddress),
      obligation,
      true, // useV2Ixs
      undefined, // scopeRefreshConfig
      1_000_000, // computeBudget
    );

    // Combine setup + lending instructions
    const allIxs = [
      ...axn.setupIxs,
      ...axn.lendingIxs,
      ...axn.cleanupIxs,
    ] as unknown as Instruction[];

    logger.info(
      { action, wallet: params.walletAddress.slice(0, 8), ixCount: allIxs.length },
      "Multiply manage built",
    );

    return allIxs;
  } catch (err: unknown) {
    if (err instanceof Error && "statusCode" in err) throw err;
    const msg = err instanceof Error ? err.message : "Unknown error";
    logger.error(
      { err, wallet: params.walletAddress.slice(0, 8) },
      `Multiply manage failed: ${msg}`,
    );
    throw Object.assign(new Error(`Multiply manage failed: ${msg}`), {
      statusCode: 502,
    });
  }
}

// ---------------------------------------------------------------------------
// Multiply position stats (on-chain)
// ---------------------------------------------------------------------------

export interface MultiplyPositionStats {
  balance: number;
  leverage: number;
  ltv: number;
  liquidationLtv: number;
  totalDepositUsd: number;
  totalBorrowUsd: number;
  borrowLimit: number;
  healthFactor: number;
}

export async function getMultiplyStats(
  walletAddress: string,
  extraData: Record<string, unknown>,
): Promise<MultiplyPositionStats | null> {
  try {
    const { KaminoMarket, MultiplyObligation, PROGRAM_ID, DEFAULT_RECENT_SLOT_DURATION_MS } =
      await loadSdk();

    const marketAddress = extraData.market as string | undefined;
    const collMint =
      (extraData.collateral_mint as string | undefined) ??
      (extraData.collateral as any)?.[0]?.mint;
    const debtMint =
      (extraData.debt_mint as string | undefined) ??
      (extraData.debt as any)?.[0]?.mint;
    if (!marketAddress || !collMint || !debtMint) return null;

    const market = await loadMarketCached(marketAddress);
    if (!market) return null;

    const oblType = new MultiplyObligation(addr(collMint), addr(debtMint), PROGRAM_ID);
    const obligation = await market.getObligationByWallet(
      walletAddress as any,
      oblType,
    );
    if (!obligation) return null;

    const stats = obligation.refreshedStats;
    return {
      balance: Number(stats.netAccountValue ?? 0),
      leverage: Number(stats.leverage ?? 0),
      ltv: Number(stats.loanToValue ?? 0),
      liquidationLtv: Number(stats.liquidationLtv ?? 0),
      totalDepositUsd: Number(stats.userTotalDeposit ?? 0),
      totalBorrowUsd: Number(stats.userTotalBorrow ?? 0),
      borrowLimit: Number(stats.borrowLimit ?? 0),
      healthFactor: Number(stats.liquidationLtv) > 0
        ? Number(stats.liquidationLtv) / Math.max(0.001, Number(stats.loanToValue))
        : 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Balance
// ---------------------------------------------------------------------------

async function getVaultBalance(
  params: GetBalanceParams,
): Promise<number | null> {
  try {
    const sdk = await import("@kamino-finance/klend-sdk");
    const vault = new sdk.KaminoVault(
      getRpc() as any,
      addr(params.depositAddress) as any,
    );
    const [exchangeRate, userShares] = await Promise.all([
      vault.getExchangeRate(),
      vault.getUserShares(addr(params.walletAddress) as any),
    ]);
    if (userShares.totalShares.isZero()) return 0;
    return userShares.totalShares.mul(exchangeRate).toNumber();
  } catch {
    return null;
  }
}

async function getLendingBalance(
  params: GetBalanceParams,
): Promise<number | null> {
  try {
    const { KaminoMarket, VanillaObligation, PROGRAM_ID } = await loadSdk();

    const marketAddress = params.extraData?.market as string | undefined;
    const tokenMint = params.extraData?.token_mint as string | undefined;
    if (!marketAddress || !tokenMint) return null;

    const market = await KaminoMarket.load(
      getRpc() as any,
      addr(marketAddress),
      400,
    );
    if (!market) return null;

    const obligation = await market.getObligationByWallet(
      addr(params.walletAddress) as any,
      new VanillaObligation(PROGRAM_ID),
    );
    if (!obligation) return 0;

    const deposit = obligation.getDepositByMint(addr(tokenMint) as any);
    if (!deposit) return 0;

    const decimals = await resolveDecimals(params.extraData);

    return deposit.amount.div(10 ** decimals).toNumber();
  } catch {
    return null;
  }
}

async function getMultiplyBalance(
  params: GetBalanceParams,
): Promise<number | null> {
  try {
    const { KaminoMarket, MultiplyObligation, PROGRAM_ID, DEFAULT_RECENT_SLOT_DURATION_MS } =
      await loadSdk();

    const marketAddress = params.extraData?.market as string | undefined;
    // Support both discover format (collateral_mint) and monitor format (collateral[0].mint)
    const collMint =
      (params.extraData?.collateral_mint as string | undefined) ??
      (params.extraData?.collateral as any)?.[0]?.mint;
    const debtMint =
      (params.extraData?.debt_mint as string | undefined) ??
      (params.extraData?.debt as any)?.[0]?.mint;
    if (!marketAddress || !collMint || !debtMint) return null;

    const market = await loadMarketCached(marketAddress);
    if (!market) return null;

    const oblType = new MultiplyObligation(
      addr(collMint),
      addr(debtMint),
      PROGRAM_ID,
    );
    const obligation = await market.getObligationByWallet(
      addr(params.walletAddress) as any,
      oblType,
    );
    if (!obligation) return 0;

    const netValue = Number(obligation.refreshedStats.netAccountValue ?? 0);
    return netValue < 0.01 ? 0 : netValue;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Price impact estimation (pre-flight, no tx building)
// ---------------------------------------------------------------------------

async function getMultiplyPriceImpact(
  params: PriceImpactParams,
): Promise<PriceImpactEstimate | null> {
  try {
    const extra = params.extraData ?? {};
    const marketAddress = extra.market as string | undefined;
    const collMint = extra.collateral_mint as string | undefined;
    const debtMint = extra.debt_mint as string | undefined;
    if (!marketAddress || !collMint || !debtMint) return null;

    const market = await loadMarketCached(marketAddress);
    if (!market) return null;

    const collReserve = market.getReserveByMint(addr(collMint));
    const debtReserve = market.getReserveByMint(addr(debtMint));
    if (!collReserve || !debtReserve) return null;

    // Oracle prices
    const debtPrice = debtReserve.getOracleMarketPrice();
    const collPrice = collReserve.getOracleMarketPrice();
    if (!debtPrice || !collPrice || collPrice.isZero() || debtPrice.isZero()) return null;

    // Estimate swap amount based on direction
    const leverage = (extra.leverage as number) ?? 2;
    const amount = parseFloat(params.amount);
    if (!amount || amount <= 0) return null;

    let inputMint: string;
    let outputMint: string;
    let swapAmountLamports: number;
    let oraclePrice: number;

    if (params.direction === "deposit") {
      // Open: swap debt → collateral, amount ≈ deposit * (leverage - 1) in debt terms
      inputMint = debtMint;
      outputMint = collMint;
      const debtDecimals = debtReserve.stats.decimals;
      const oracleRatio = collPrice.div(debtPrice).toNumber(); // coll per debt
      swapAmountLamports = Math.round(amount * (leverage - 1) / oracleRatio * 10 ** debtDecimals);
      oraclePrice = debtPrice.div(collPrice).toNumber(); // debt→coll direction
    } else {
      // Withdraw: deleverage by swapping collateral → debt
      // At leverage L, withdrawing W equity requires swapping ~W*(L-1) collateral to repay debt
      inputMint = collMint;
      outputMint = debtMint;
      const collDecimals = collReserve.stats.decimals;
      swapAmountLamports = Math.round(amount * (leverage - 1) * 10 ** collDecimals);
      oraclePrice = collPrice.div(debtPrice).toNumber(); // coll→debt direction
    }

    if (swapAmountLamports <= 0) {
      logger.debug({ amount, leverage, direction: params.direction }, "Swap amount too small for impact estimate");
      return null;
    }

    const slippageBps = (extra.slippageBps as number) ?? 50;
    const quote = await getJupiterLiteQuote(inputMint, outputMint, String(swapAmountLamports), slippageBps);

    // Compute execution price and compare to oracle
    const inDecimals = params.direction === "deposit"
      ? debtReserve.stats.decimals
      : collReserve.stats.decimals;
    const outDecimals = params.direction === "deposit"
      ? collReserve.stats.decimals
      : debtReserve.stats.decimals;

    const inputAmountTokens = swapAmountLamports / 10 ** inDecimals;
    if (inputAmountTokens === 0) return null;
    const outputActualTokens = Number(quote.outAmount) / 10 ** outDecimals;
    const outputExpectedTokens = inputAmountTokens * oraclePrice;

    const executionPrice = outputActualTokens / inputAmountTokens;
    const deviationPct = (Math.abs(executionPrice - oraclePrice) / oraclePrice) * 100;

    const collSymbol = (extra.collateral_symbol as string) ?? "COLL";
    const debtSymbol = (extra.debt_symbol as string) ?? "DEBT";

    return {
      priceImpactPct: deviationPct,
      inputAmount: inputAmountTokens,
      inputSymbol: params.direction === "deposit" ? debtSymbol : collSymbol,
      outputExpected: outputExpectedTokens,
      outputActual: outputActualTokens,
      outputSymbol: params.direction === "deposit" ? collSymbol : debtSymbol,
    };
  } catch (err) {
    logger.warn({ err }, "Price impact estimation failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

export const kaminoAdapter: ProtocolAdapter = {
  async buildDepositTx(params) {
    if (params.category === "multiply") {
      const action = params.extraData?.action as string | undefined;
      if (action === "adjust") return buildMultiplyAdjust(params);
      if (action === "add_collateral" || action === "borrow_more")
        return buildMultiplyManage(params);
      return buildMultiplyOpen(params);
    }
    if (isVaultCategory(params.category)) return buildVaultDeposit(params);
    return buildLendingDeposit(params);
  },

  async buildWithdrawTx(params) {
    if (params.category === "multiply") {
      const action = params.extraData?.action as string | undefined;
      if (action === "withdraw_collateral" || action === "repay_debt")
        return buildMultiplyManage(params);
      return buildMultiplyWithdraw(params);
    }
    if (isVaultCategory(params.category)) return buildVaultWithdraw(params);
    return buildLendingWithdraw(params);
  },

  async getBalance({ walletAddress, depositAddress, category, extraData }) {
    if (isVaultCategory(category))
      return getVaultBalance({ walletAddress, depositAddress, category, extraData });
    if (category === "lending")
      return getLendingBalance({ walletAddress, depositAddress, category, extraData });
    if (category === "multiply")
      return getMultiplyBalance({ walletAddress, depositAddress, category, extraData });
    return null;
  },

  async getPriceImpact(params) {
    if (params.category !== "multiply") return null;
    return getMultiplyPriceImpact(params);
  },
};
