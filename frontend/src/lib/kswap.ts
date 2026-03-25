import type { Address, Instruction } from "@solana/kit";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { HELIUS_RPC_URL } from "./constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * KSwap swap provider utilities for klend-sdk multiply/leverage operations.
 *
 * The SDK expects two callbacks:
 *   SwapQuoteProvider<RouteOutput> — fetches a price quote
 *   SwapIxsProvider<RouteOutput>  — fetches swap instructions for a quote
 *
 * These use @kamino-finance/kswap-sdk which routes through multiple DEXes
 * and selects routes by smallest transaction size (critical for 1232-byte limit).
 */

const KSWAP_API_URL = "https://api.kamino.finance/kswap";
const ALLOWED_ROUTERS = ["metis", "titan", "dflow", "openOcean", "jupiterLite"];

let _kswapSdk: any = null;

async function loadModules() {
  const [kswapMod, decimalMod, bnMod] = await Promise.all([
    import("@kamino-finance/kswap-sdk"),
    import("decimal.js"),
    import("bn.js"),
  ]);
  return {
    KswapSdk: kswapMod.KswapSdk,
    RouterContext: kswapMod.RouterContext,
    Decimal: decimalMod.default,
    BN: bnMod.default,
  };
}

/**
 * Get or create a singleton KswapSdk instance.
 */
export async function getKswapSdkInstance(): Promise<any> {
  if (_kswapSdk) return _kswapSdk;
  const { KswapSdk } = await loadModules();
  const rpc = createSolanaRpc(HELIUS_RPC_URL);
  const wsUrl = HELIUS_RPC_URL.replace("https://", "wss://");
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  _kswapSdk = new KswapSdk(KSWAP_API_URL, rpc as any, rpcSubscriptions as any);
  return _kswapSdk;
}

/**
 * Get debt-to-collateral price via KSwap price API.
 */
export async function getTokenPrice(
  inputMint: Address,
  outputMint: Address,
): Promise<number> {
  const kswapSdk = await getKswapSdkInstance();
  const params = {
    ids: inputMint.toString(),
    vsToken: outputMint.toString(),
  };
  const res = await kswapSdk.getJupiterPriceWithFallback(params);
  return Number(res?.data?.[inputMint.toString()]?.price || 0);
}

/**
 * Build a SwapQuoteProvider for klend-sdk leverage operations.
 * Selects the best route by price (outAmount / inAmount).
 */
export async function createKswapQuoter(
  kswapSdk: any,
  executor: Address,
  slippageBps: number,
  inputMintReserve: any,
  outputMintReserve: any,
): Promise<any> {
  const { RouterContext, Decimal, BN } = await loadModules();

  return async (inputs: any): Promise<any> => {
    const inMintInfo = {
      tokenProgramId: inputMintReserve.getLiquidityTokenProgram(),
      decimals: inputMintReserve.stats.decimals,
    };
    const outMintInfo = {
      tokenProgramId: outputMintReserve.getLiquidityTokenProgram(),
      decimals: outputMintReserve.stats.decimals,
    };
    const routerContext = new RouterContext(inMintInfo, outMintInfo);

    const routeParams = {
      executor,
      tokenIn: inputs.inputMint,
      tokenOut: inputs.outputMint,
      amount: new BN(inputs.inputAmountLamports.toDP(0).toString()),
      maxSlippageBps: slippageBps,
      wrapAndUnwrapSol: false,
      swapType: "exactIn",
      routerTypes: ALLOWED_ROUTERS,
      includeRfq: false,
      includeLimoLogs: false,
      withSimulation: true,
      filterFailedSimulations: false,
      timeoutMs: 30000,
      atLeastOneNoMoreThanTimeoutMS: 10000,
      preferredMaxAccounts: 10,
    };

    const routeOutputs = await kswapSdk.getAllRoutes(routeParams, routerContext);
    if (routeOutputs.routes.length === 0) {
      throw new Error("No swap routes found. Try increasing slippage.");
    }

    const bestRoute = routeOutputs.routes.reduce((best: any, current: any) => {
      const inBest = new Decimal(best.amountsExactIn.amountIn.toString()).div(inputMintReserve.getMintFactor());
      const outBest = new Decimal(best.amountsExactIn.amountOutGuaranteed.toString()).div(outputMintReserve.getMintFactor());
      const priceBest = outBest.div(inBest);
      const inCur = new Decimal(current.amountsExactIn.amountIn.toString()).div(inputMintReserve.getMintFactor());
      const outCur = new Decimal(current.amountsExactIn.amountOutGuaranteed.toString()).div(outputMintReserve.getMintFactor());
      const priceCur = outCur.div(inCur);
      return priceBest.greaterThan(priceCur) ? best : current;
    });

    const inAmt = new Decimal(bestRoute.amountsExactIn.amountIn.toString()).div(inputMintReserve.getMintFactor());
    const outAmt = new Decimal(bestRoute.amountsExactIn.amountOutGuaranteed.toString()).div(outputMintReserve.getMintFactor());

    return { priceAInB: outAmt.div(inAmt), quoteResponse: bestRoute };
  };
}

/**
 * Build a SwapIxsProvider for klend-sdk leverage operations.
 * Returns all routes so the SDK can pick the one with smallest tx size.
 */
export async function createKswapSwapper(
  kswapSdk: any,
  executor: Address,
  slippageBps: number,
  inputMintReserve: any,
  outputMintReserve: any,
): Promise<any> {
  const { RouterContext, Decimal, BN } = await loadModules();

  return async (inputs: any): Promise<Array<{
    preActionIxs: Instruction[];
    swapIxs: Instruction[];
    lookupTables: any[];
    quote: any;
  }>> => {
    const inMintInfo = {
      tokenProgramId: inputMintReserve.getLiquidityTokenProgram(),
      decimals: inputMintReserve.stats.decimals,
    };
    const outMintInfo = {
      tokenProgramId: outputMintReserve.getLiquidityTokenProgram(),
      decimals: outputMintReserve.stats.decimals,
    };
    const routerContext = new RouterContext(inMintInfo, outMintInfo);

    const routeParams = {
      executor,
      tokenIn: inputs.inputMint,
      tokenOut: inputs.outputMint,
      amount: new BN(inputs.inputAmountLamports.toString()),
      maxSlippageBps: slippageBps,
      wrapAndUnwrapSol: false,
      swapType: "exactIn",
      routerTypes: ALLOWED_ROUTERS,
      includeRfq: false,
      includeLimoLogs: false,
      withSimulation: true,
      filterFailedSimulations: false,
      timeoutMs: 30000,
      atLeastOneNoMoreThanTimeoutMS: 10000,
      preferredMaxAccounts: 10,
    };

    const routeOutputs = await kswapSdk.getAllRoutes(routeParams, routerContext);
    if (routeOutputs.routes.length === 0) {
      throw new Error("No swap routes found in swapper.");
    }

    return routeOutputs.routes.map((route: any) => {
      const inAmt = new Decimal(route.amountsExactIn.amountIn.toString()).div(
        route.inputTokenDecimals || inputMintReserve.getMintFactor(),
      );
      const outAmt = new Decimal(route.amountsExactIn.amountOutGuaranteed.toString()).div(
        route.outputTokenDecimals || outputMintReserve.getMintFactor(),
      );

      return {
        preActionIxs: [] as Instruction[],
        swapIxs: route.instructions?.swapIxs || [],
        lookupTables: route.lookupTableAccounts || [],
        quote: {
          priceAInB: outAmt.div(inAmt),
          quoteResponse: route,
          simulationResult: route.simulationResult,
          routerType: route.routerType,
        },
      };
    });
  };
}
