/**
 * Jupiter V2 Swap API client.
 *
 * - Quote: GET /swap/v2/order  (all routers, best pricing — we extract quote metadata)
 * - Build: GET /swap/v2/build  (Metis router, raw instructions — fits BuildTxResult pattern)
 */
import type { Instruction } from "@solana/kit";
import { getWithRetry, jupiterHeaders } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { convertJupiterApiInstruction } from "./instruction-converter.js";
import type { BuildTxResultWithLookups } from "../protocols/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const JUPITER_SWAP_API = "https://api.jup.ag/swap/v2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SwapParams {
  inputMint: string;
  outputMint: string;
  amount: string; // smallest units (lamports, etc.)
  slippageBps?: number;
  taker: string; // wallet address
}

export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  feeBps: number;
  priceImpactPct: number;
  router: string;
}

// ---------------------------------------------------------------------------
// Quote — uses /order for all-router pricing
// ---------------------------------------------------------------------------

export async function getSwapQuote(params: SwapParams): Promise<SwapQuote> {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    taker: params.taker,
    slippageBps: String(params.slippageBps ?? 50),
  }).toString();

  const url = `${JUPITER_SWAP_API}/order?${qs}`;
  const data = (await getWithRetry(url, { headers: jupiterHeaders() })) as any;

  return {
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    inAmount: params.amount,
    outAmount: String(data.outAmount ?? "0"),
    feeBps: Number(data.feeBps ?? 0),
    priceImpactPct: Number(data.priceImpactPct ?? 0),
    router: String(data.router ?? "unknown"),
  };
}

// ---------------------------------------------------------------------------
// Build — uses /build for raw instructions (fits existing pattern)
// ---------------------------------------------------------------------------

export async function buildSwapInstructions(
  params: SwapParams,
): Promise<BuildTxResultWithLookups> {
  const qs = new URLSearchParams({
    inputMint: params.inputMint,
    outputMint: params.outputMint,
    amount: params.amount,
    taker: params.taker,
    slippageBps: String(params.slippageBps ?? 50),
    wrapAndUnwrapSol: "true",
  }).toString();

  const url = `${JUPITER_SWAP_API}/build?${qs}`;
  const data = (await getWithRetry(url, { headers: jupiterHeaders() })) as any;

  // Collect all instruction groups
  const rawIxGroups: any[][] = [
    data.computeBudgetInstructions ?? [],
    data.setupInstructions ?? [],
    data.swapInstruction ? [data.swapInstruction] : [],
    data.cleanupInstruction ? [data.cleanupInstruction] : [],
    data.otherInstructions ?? [],
  ];

  const instructions: Instruction[] = rawIxGroups
    .flat()
    .map(convertJupiterApiInstruction);

  // Extract lookup table addresses
  const altMap: Record<string, string[]> =
    data.addressesByLookupTableAddress ?? {};
  const lookupTableAddresses = Object.keys(altMap);

  logger.info(
    {
      inputMint: params.inputMint.slice(0, 8),
      outputMint: params.outputMint.slice(0, 8),
      ixCount: instructions.length,
      altCount: lookupTableAddresses.length,
    },
    "Jupiter swap instructions built",
  );

  return { instructions, lookupTableAddresses };
}
