import type { Address, Instruction } from "@solana/kit";
import { getRpc, getRpcSubscriptions } from "../../shared/rpc.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * KSwap swap provider for klend-sdk multiply/leverage operations.
 *
 * The SDK expects SwapQuoteProvider and SwapIxsProvider callbacks.
 * KSwap routes through multiple DEXes and is compatible with klend-sdk's
 * flash loan flow (unlike Jupiter V6 which uses incompatible accounts).
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

/** Singleton KswapSdk instance using shared RPC. */
export async function getKswapSdkInstance(): Promise<any> {
  if (_kswapSdk) return _kswapSdk;
  const { KswapSdk } = await loadModules();
  _kswapSdk = new KswapSdk(
    KSWAP_API_URL,
    getRpc() as any,
    getRpcSubscriptions() as any,
  );
  return _kswapSdk;
}

/** Build route params shared by quoter and swapper. */
function buildRouteParams(
  executor: Address,
  inputs: any,
  slippageBps: number,
  BN: any,
  amountStr: string,
) {
  return {
    executor,
    tokenIn: inputs.inputMint,
    tokenOut: inputs.outputMint,
    amount: new BN(amountStr),
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
}

function buildRouterContext(
  RouterContext: any,
  inputReserve: any,
  outputReserve: any,
) {
  return new RouterContext(
    {
      tokenProgramId: inputReserve.getLiquidityTokenProgram(),
      decimals: inputReserve.stats.decimals,
    },
    {
      tokenProgramId: outputReserve.getLiquidityTokenProgram(),
      decimals: outputReserve.stats.decimals,
    },
  );
}

function routePrice(route: any, inFactor: any, outFactor: any, Decimal: any) {
  const inAmt = new Decimal(route.amountsExactIn.amountIn.toString()).div(
    inFactor,
  );
  const outAmt = new Decimal(
    route.amountsExactIn.amountOutGuaranteed.toString(),
  ).div(outFactor);
  return outAmt.div(inAmt);
}

/** Build a SwapQuoteProvider — selects best route by price. */
export async function createKswapQuoter(
  kswapSdk: any,
  executor: Address,
  slippageBps: number,
  inputMintReserve: any,
  outputMintReserve: any,
): Promise<any> {
  const { RouterContext, Decimal, BN } = await loadModules();

  return async (inputs: any): Promise<any> => {
    const ctx = buildRouterContext(
      RouterContext,
      inputMintReserve,
      outputMintReserve,
    );
    const params = buildRouteParams(
      executor,
      inputs,
      slippageBps,
      BN,
      inputs.inputAmountLamports.toDP(0).toString(),
    );

    const routeOutputs = await kswapSdk.getAllRoutes(params, ctx);
    if (routeOutputs.routes.length === 0)
      throw new Error("No swap routes found. Try increasing slippage.");

    const inFactor = inputMintReserve.getMintFactor();
    const outFactor = outputMintReserve.getMintFactor();

    const bestRoute = routeOutputs.routes.reduce((best: any, cur: any) =>
      routePrice(best, inFactor, outFactor, Decimal).greaterThan(
        routePrice(cur, inFactor, outFactor, Decimal),
      )
        ? best
        : cur,
    );

    return {
      priceAInB: routePrice(bestRoute, inFactor, outFactor, Decimal),
      quoteResponse: bestRoute,
    };
  };
}

/** Build a SwapIxsProvider — returns all routes for SDK to pick smallest tx. */
export async function createKswapSwapper(
  kswapSdk: any,
  executor: Address,
  slippageBps: number,
  inputMintReserve: any,
  outputMintReserve: any,
): Promise<any> {
  const { RouterContext, Decimal, BN } = await loadModules();

  return async (
    inputs: any,
  ): Promise<
    Array<{
      preActionIxs: Instruction[];
      swapIxs: Instruction[];
      lookupTables: any[];
      quote: any;
    }>
  > => {
    const ctx = buildRouterContext(
      RouterContext,
      inputMintReserve,
      outputMintReserve,
    );
    const params = buildRouteParams(
      executor,
      inputs,
      slippageBps,
      BN,
      inputs.inputAmountLamports.toDP(0).toString(),
    );

    const routeOutputs = await kswapSdk.getAllRoutes(params, ctx);
    if (routeOutputs.routes.length === 0)
      throw new Error("No swap routes found in swapper.");

    return routeOutputs.routes.map((route: any) => {
      const inFactor =
        route.inputTokenDecimals || inputMintReserve.getMintFactor();
      const outFactor =
        route.outputTokenDecimals || outputMintReserve.getMintFactor();

      return {
        preActionIxs: [] as Instruction[],
        swapIxs: route.instructions?.swapIxs || [],
        lookupTables: route.lookupTableAccounts || [],
        quote: {
          priceAInB: routePrice(route, inFactor, outFactor, Decimal),
          quoteResponse: route,
          simulationResult: route.simulationResult,
          routerType: route.routerType,
        },
      };
    });
  };
}
