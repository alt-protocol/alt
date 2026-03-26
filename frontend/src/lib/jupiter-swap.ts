import type { Address, Instruction } from "@solana/kit";
import { address, createSolanaRpc } from "@solana/kit";
import { fetchAddressLookupTable } from "@solana-program/address-lookup-table";
import type { Account } from "@solana/kit";
import type { AddressLookupTable } from "@solana-program/address-lookup-table";
import { HELIUS_RPC_URL } from "./constants";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Jupiter V6 quote/swap providers for klend-sdk leverage operations.
 *
 * The SDK expects two callbacks:
 *   SwapQuoteProvider<JupQuote> — fetches a price quote
 *   SwapIxsProvider<JupQuote>  — fetches swap instructions for a quote
 */

const JUP_API = "https://quote-api.jup.ag/v6";

export type JupQuote = {
  inAmount: string;
  outAmount: string;
  quoteResponse: any;
};

function getRpc(): any {
  return createSolanaRpc(HELIUS_RPC_URL);
}

import { convertJupiterApiInstruction as convertJupIx } from "./instruction-converter";

/**
 * SwapQuoteProvider — fetches a Jupiter quote for the given swap inputs.
 * Default 1% slippage. Use createJupiterQuoter() for custom slippage.
 */
export async function quoter(
  inputs: { inputAmountLamports: any; inputMint: Address; outputMint: Address },
  _klendAccounts?: Address[],
): Promise<{ priceAInB: any; quoteResponse: any }> {
  return createJupiterQuoter(100)(inputs);
}

/**
 * SwapIxsProvider — fetches swap instructions for a Jupiter quote.
 * Default 1% slippage. Use createJupiterSwapper() for custom slippage.
 */
export async function swapper(
  inputs: { inputAmountLamports: any; inputMint: Address; outputMint: Address },
  _klendAccounts?: Address[],
  quote?: { priceAInB: any; quoteResponse?: any },
): Promise<Array<{
  preActionIxs: Instruction[];
  swapIxs: Instruction[];
  lookupTables: Account<AddressLookupTable>[];
  quote: { priceAInB: any; quoteResponse?: any };
}>> {
  return createJupiterSwapper()(inputs, undefined, quote!);
}

/** Create a SwapQuoteProvider with custom slippage (bps). */
export function createJupiterQuoter(slippageBps = 100) {
  return async (inputs: { inputAmountLamports: any; inputMint: Address; outputMint: Address }): Promise<{ priceAInB: any; quoteResponse: any }> => {
    const { default: Decimal } = await import("decimal.js");

    const amount = inputs.inputAmountLamports.toDP
      ? inputs.inputAmountLamports.toDP(0).toString()
      : inputs.inputAmountLamports.toString();
    const params = new URLSearchParams({
      inputMint: inputs.inputMint as string,
      outputMint: inputs.outputMint as string,
      amount,
      slippageBps: String(slippageBps),
    });

    const res = await fetch(`${JUP_API}/quote?${params}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jupiter quote failed: ${res.status} ${text}`);
    }

    const quoteResponse = await res.json();
    const inAmt = new Decimal(quoteResponse.inAmount);
    const outAmt = new Decimal(quoteResponse.outAmount);

    return { priceAInB: outAmt.div(inAmt), quoteResponse };
  };
}

/** Create a SwapIxsProvider backed by Jupiter V6. */
export function createJupiterSwapper() {
  return async (
    inputs: { inputAmountLamports: any; inputMint: Address; outputMint: Address },
    _klendAccounts?: Address[],
    quote?: { priceAInB: any; quoteResponse?: any },
  ): Promise<Array<{
    preActionIxs: Instruction[];
    swapIxs: Instruction[];
    lookupTables: Account<AddressLookupTable>[];
    quote: { priceAInB: any; quoteResponse?: any };
  }>> => {
    if (!quote?.quoteResponse) throw new Error("Jupiter swapper requires a quote with quoteResponse");

    const res = await fetch(`${JUP_API}/swap-instructions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote.quoteResponse,
        userPublicKey: "11111111111111111111111111111111", // placeholder, SDK overrides
        wrapAndUnwrapSol: false,
        dynamicComputeUnitLimit: true,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Jupiter swap-instructions failed: ${res.status} ${text}`);
    }

    const data = await res.json();

    const preActionIxs: Instruction[] = (data.setupInstructions ?? []).map(convertJupIx);
    const swapIxs: Instruction[] = [convertJupIx(data.swapInstruction)];

    const lutAddresses: string[] = data.addressLookupTableAddresses ?? [];
    const rpc = getRpc();
    const lookupTables: Account<AddressLookupTable>[] = await Promise.all(
      lutAddresses.map((addr: string) => fetchAddressLookupTable(rpc, address(addr))),
    );

    return [{ preActionIxs, swapIxs, lookupTables, quote }];
  };
}
