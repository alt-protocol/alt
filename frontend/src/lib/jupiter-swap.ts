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
 */
export async function quoter(
  inputs: { inputAmountLamports: any; inputMint: Address; outputMint: Address },
  _klendAccounts: Address[],
): Promise<{ priceAInB: any; quoteResponse: any }> {
  const { default: Decimal } = await import("decimal.js");

  const amount = inputs.inputAmountLamports.toString();
  const params = new URLSearchParams({
    inputMint: inputs.inputMint as string,
    outputMint: inputs.outputMint as string,
    amount,
    slippageBps: "100", // 1%
  });

  const res = await fetch(`${JUP_API}/quote?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter quote failed: ${res.status} ${text}`);
  }

  const quoteResponse = await res.json();
  const inAmt = new Decimal(quoteResponse.inAmount);
  const outAmt = new Decimal(quoteResponse.outAmount);
  const priceAInB = outAmt.div(inAmt);

  return { priceAInB, quoteResponse };
}

/**
 * SwapIxsProvider — fetches swap instructions for a Jupiter quote.
 * Returns an array (usually 1 element) of { preActionIxs, swapIxs, lookupTables, quote }.
 */
export async function swapper(
  inputs: { inputAmountLamports: any; inputMint: Address; outputMint: Address },
  _klendAccounts: Address[],
  quote: { priceAInB: any; quoteResponse: any },
): Promise<Array<{
  preActionIxs: Instruction[];
  swapIxs: Instruction[];
  lookupTables: Account<AddressLookupTable>[];
  quote: { priceAInB: any; quoteResponse: any };
}>> {
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

  // Fetch lookup table accounts
  const lutAddresses: string[] = data.addressLookupTableAddresses ?? [];
  const rpc = getRpc();
  const lookupTables: Account<AddressLookupTable>[] = await Promise.all(
    lutAddresses.map((addr: string) =>
      fetchAddressLookupTable(rpc, address(addr))
    ),
  );

  return [{ preActionIxs, swapIxs, lookupTables, quote }];
}
