import type { Instruction } from "@solana/kit";
import { address, none } from "@solana/kit";
import type {
  ProtocolAdapter,
  BuildTxParams,
  BuildTxResult,
  BuildTxResultWithLookups,
  BuildTxResultWithSetup,
  GetBalanceParams,
} from "./types.js";
import { getRpc } from "../../shared/rpc.js";
import { logger } from "../../shared/logger.js";
import {
  getKswapSdkInstance,
  createKswapQuoter,
  createKswapSwapper,
} from "../services/kswap.js";
import {
  selectBestRoute,
  assembleMultiplyLuts,
} from "../services/multiply-luts.js";

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
    getRepayWithCollIxs: sdk.getRepayWithCollIxs,
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

  const decimals =
    params.extraData?.decimals != null
      ? Number(params.extraData.decimals)
      : 6;
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

  const market = await KaminoMarket.load(
    rpc,
    addr(marketAddress),
    DEFAULT_RECENT_SLOT_DURATION_MS,
  );
  if (!market)
    throw Object.assign(new Error("Failed to load Kamino market"), {
      statusCode: 502,
    });

  const collReserve = market.getReserveByMint(collTokenMint);
  const debtReserve = market.getReserveByMint(debtTokenMint);
  if (!collReserve || !debtReserve) throw new Error("Failed to load reserves");

  // KSwap quoter/swapper — required for klend-sdk flash loan compatibility
  const kswapSdk = await getKswapSdkInstance();
  const quoter = await createKswapQuoter(
    kswapSdk,
    params.walletAddress as any,
    slippageBps,
    debtReserve,
    collReserve,
  );
  const swapper = await createKswapSwapper(
    kswapSdk,
    params.walletAddress as any,
    slippageBps,
    debtReserve,
    collReserve,
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
  if (!leverage) throw new Error("Missing leverage for multiply open");

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
    addr(params.walletAddress) as any,
    none(),
    true,
    multiplyMints,
    [],
  );

  // Price: fetch both USD prices via Jupiter and compute debt-to-coll ratio
  const priceRes = await fetch(
    `https://lite-api.jup.ag/price/v3?ids=${debtMint},${collMint}`,
  );
  if (!priceRes.ok)
    throw new Error(`Jupiter price fetch failed: ${priceRes.status}`);
  const priceData = await priceRes.json();
  const debtPriceUsd = Number(priceData?.[debtMint]?.usdPrice || 0);
  const collPriceUsd = Number(priceData?.[collMint]?.usdPrice || 0);

  if (!debtPriceUsd || !collPriceUsd) {
    throw new Error(
      `Price unavailable — debt: $${debtPriceUsd}, coll: $${collPriceUsd}`,
    );
  }
  const priceDebtToColl = new Decimal(debtPriceUsd / collPriceUsd);

  // Validate inputs before SDK call
  if (priceDebtToColl.isZero() || priceDebtToColl.isNaN()) {
    throw new Error("Invalid price ratio — cannot calculate leverage");
  }

  const routes = await getDepositWithLeverageIxs({
    owner: addr(params.walletAddress) as any,
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
    selectedTokenMint: collTokenMint,
    obligationTypeTagOverride: ObligationTypeTag.Multiply,
    scopeRefreshIx,
    budgetAndPriorityFeeIxs: computeIxs,
    quoteBufferBps: new Decimal(100),
    quoter,
    swapper,
    useV2Ixs: true,
  });

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
    setupInstructionSets: nonEmptySetups.length > 0 ? nonEmptySetups : undefined,
  });
}

// ---------------------------------------------------------------------------
// Multiply — Withdraw / Close (repay with collateral)
// ---------------------------------------------------------------------------

async function buildMultiplyClose(
  params: BuildTxParams,
): Promise<BuildTxResultWithLookups> {
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
    VanillaObligation,
    PROGRAM_ID,
    getRepayWithCollIxs,
    getUserLutAddressAndSetupIxs,
  } = sdk;

  const isClosingPosition = params.extraData!.isClosingPosition === true;

  // Load obligation (required for withdraw/close)
  const obligation = await market.getObligationByWallet(
    params.walletAddress as any,
    new VanillaObligation(PROGRAM_ID),
  );
  if (!obligation) throw new Error("No active multiply position found");

  // User LUT (setup handled separately)
  const [userLut] = await getUserLutAddressAndSetupIxs(
    market,
    addr(params.walletAddress) as any,
    none(),
    false,
  );

  const repayAmount = isClosingPosition
    ? new Decimal(0)
    : new Decimal(params.amount);

  const routes = await getRepayWithCollIxs({
    kaminoMarket: market,
    debtTokenMint,
    collTokenMint,
    owner: addr(params.walletAddress) as any,
    obligation,
    referrer: none(),
    currentSlot,
    repayAmount,
    isClosingPosition,
    budgetAndPriorityFeeIxs: computeIxs,
    scopeRefreshIx: [],
    useV2Ixs: true,
    quoter,
    swapper,
  });

  return finalizeMultiplyResult(routes, {
    userLut,
    collMint,
    debtMint,
    marketLut,
    isMultiply: false,
  });
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

    const decimals =
      params.extraData?.decimals != null
        ? Number(params.extraData.decimals)
        : 6;

    return deposit.amount.div(10 ** decimals).toNumber();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Adapter export
// ---------------------------------------------------------------------------

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

  async getBalance({ walletAddress, depositAddress, category, extraData }) {
    if (isVaultCategory(category))
      return getVaultBalance({ walletAddress, depositAddress, category, extraData });
    if (category === "lending")
      return getLendingBalance({ walletAddress, depositAddress, category, extraData });
    return null;
  },
};
