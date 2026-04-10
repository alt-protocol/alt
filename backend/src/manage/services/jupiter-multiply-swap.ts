/**
 * Jupiter swap provider for klend-sdk multiply/leverage operations.
 *
 * Replaces KSwap as the swap routing provider for Kamino multiply.
 * Uses Jupiter V2 Swap API (api.jup.ag/swap/v2) — same API already used
 * by the standalone swap service (jupiter-swap.ts).
 *
 * The klend-sdk expects two callbacks:
 *   - SwapQuoteProvider: (inputs) => { priceAInB: Decimal, quoteResponse }
 *   - SwapIxsProvider:   (inputs) => Array<{ preActionIxs, swapIxs, lookupTables, quote }>
 *
 * SDK passes: { inputMint, outputMint, inputAmountLamports: Decimal }
 */
import type { Instruction } from "@solana/kit";
import { getWithRetry, jupiterHeaders } from "../../shared/http.js";
import { logger } from "../../shared/logger.js";
import { convertJupiterApiInstruction } from "./instruction-converter.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadDecimal(): Promise<any> {
  const mod = await import("decimal.js");
  return mod.default as any;
}

const JUPITER_SWAP_API = "https://api.jup.ag/swap/v2";

function buildQueryString(
  inputs: any,
  executor: string,
  slippageBps: number,
  extra?: Record<string, string>,
): string {
  return new URLSearchParams({
    inputMint: String(inputs.inputMint),
    outputMint: String(inputs.outputMint),
    amount: inputs.inputAmountLamports.toDP(0).toString(),
    taker: executor,
    slippageBps: String(slippageBps),
    maxAccounts: "15", // keep swap compact — multiply txs already use many accounts
    ...extra,
  }).toString();
}

/**
 * Build a SwapQuoteProvider — fetches Jupiter quote and computes price ratio.
 *
 * Called by klend-sdk to determine the exchange rate for leverage calculation.
 */
export function createJupiterMultiplyQuoter(
  executor: string,
  slippageBps: number,
  inputMintReserve: any,
  outputMintReserve: any,
): (inputs: any) => Promise<any> {
  return async (inputs: any): Promise<any> => {
    const Decimal = await loadDecimal();

    const qs = buildQueryString(inputs, executor, slippageBps);
    const url = `${JUPITER_SWAP_API}/order?${qs}`;
    const data = (await getWithRetry(url, { headers: jupiterHeaders() })) as any;

    const outAmount = String(data.outAmount ?? "0");
    if (outAmount === "0") {
      throw new Error("Jupiter quote returned zero output — no liquidity for this pair");
    }

    const inFactor = inputMintReserve.getMintFactor();
    const outFactor = outputMintReserve.getMintFactor();
    const inAmt = new Decimal(inputs.inputAmountLamports.toDP(0).toString()).div(inFactor);
    const outAmt = new Decimal(outAmount).div(outFactor);
    const priceAInB = outAmt.div(inAmt);

    return { priceAInB, quoteResponse: data };
  };
}

/**
 * Build a SwapIxsProvider — fetches Jupiter swap instructions.
 *
 * Called by klend-sdk to get the actual swap instructions embedded in the
 * flash loan transaction. Returns a single-element array (Jupiter picks
 * the best route internally).
 */
export function createJupiterMultiplySwapper(
  executor: string,
  slippageBps: number,
  inputMintReserve: any,
  outputMintReserve: any,
): (inputs: any) => Promise<any[]> {
  return async (inputs: any): Promise<any[]> => {
    const Decimal = await loadDecimal();

    const qs = buildQueryString(inputs, executor, slippageBps, {
      wrapAndUnwrapSol: "false", // flash loan handles token flows
    });
    const url = `${JUPITER_SWAP_API}/build?${qs}`;
    const data = (await getWithRetry(url, { headers: jupiterHeaders() })) as any;

    // Convert instructions — skip computeBudget (SDK adds its own)
    const setupIxs: Instruction[] = (data.setupInstructions ?? []).map(
      convertJupiterApiInstruction,
    );
    const swapIxs: Instruction[] = [
      ...(data.swapInstruction
        ? [convertJupiterApiInstruction(data.swapInstruction)]
        : []),
      ...(data.cleanupInstruction
        ? [convertJupiterApiInstruction(data.cleanupInstruction)]
        : []),
    ];

    if (swapIxs.length === 0) {
      throw new Error("Jupiter returned no swap instructions — try increasing slippage");
    }

    // Extract lookup table addresses
    const altMap: Record<string, string[]> =
      data.addressesByLookupTableAddress ?? {};
    const lookupTables = Object.keys(altMap);

    // Compute price ratio for the quote
    const inFactor = inputMintReserve.getMintFactor();
    const outFactor = outputMintReserve.getMintFactor();
    const inStr = inputs.inputAmountLamports.toDP(0).toString();
    const outStr = String(data.outAmount ?? inStr);
    const priceAInB = new Decimal(outStr)
      .div(outFactor)
      .div(new Decimal(inStr).div(inFactor));

    logger.info(
      {
        inputMint: String(inputs.inputMint).slice(0, 8),
        outputMint: String(inputs.outputMint).slice(0, 8),
        swapIxCount: swapIxs.length,
        setupIxCount: setupIxs.length,
        lutCount: lookupTables.length,
      },
      "Jupiter multiply swap instructions built",
    );

    return [
      {
        preActionIxs: setupIxs,
        swapIxs,
        lookupTables,
        quote: { priceAInB, quoteResponse: data },
      },
    ];
  };
}
