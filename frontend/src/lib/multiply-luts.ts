import type { Address, Instruction } from "@solana/kit";
import { address } from "@solana/kit";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * LUT (Address Lookup Table) management for Kamino Multiply transactions.
 *
 * Multiply txs exceed Solana's 1232-byte limit without LUT compression.
 * Three LUT sources must be assembled:
 *   1. User LUT — per-user, created via setup tx
 *   2. CDN LUTs — per collateral/debt pair from Kamino CDN
 *   3. Market LUT — the main lending market LUT
 *
 * Missing accounts are resolved via Kamino's LUT finder API.
 */

const CDN_ENDPOINT = "https://cdn.kamino.finance";
const LUT_FINDER_API = "https://api.kamino.finance/luts/find-minimal";

let _cdnResources: any = null;

/**
 * Fetch CDN resources (cached).
 */
async function getCdnResources(): Promise<any> {
  if (_cdnResources) return _cdnResources;
  const res = await fetch(`${CDN_ENDPOINT}/resources.json`);
  if (!res.ok) throw new Error(`CDN resources fetch failed: ${res.status}`);
  const data = await res.json();
  _cdnResources = data["mainnet-beta"];
  return _cdnResources;
}

/**
 * Fetch CDN-hosted LUT addresses for a collateral/debt pair.
 */
export async function fetchCdnLuts(
  collMint: string,
  debtMint: string,
  isMultiply: boolean,
): Promise<string[]> {
  const resources = await getCdnResources();
  if (isMultiply) {
    const collPairs = resources.multiplyLUTsPairs?.[collMint] || {};
    return collPairs[debtMint] || [];
  }
  const key = `${collMint}-${debtMint}`;
  return resources.repayWithCollLUTs?.[key] || [];
}

/**
 * Resolve any instruction accounts not covered by existing LUTs
 * via Kamino's LUT finder API.
 */
export async function resolveMissingLuts(
  instructions: Instruction[],
  existingLutAddresses: Set<string>,
): Promise<string[]> {
  const instructionAccounts = new Set<string>();
  for (const ix of instructions) {
    if (ix?.accounts) {
      for (const acc of ix.accounts as any[]) {
        if (acc?.address) instructionAccounts.add(acc.address as string);
      }
    }
  }

  const missing = Array.from(instructionAccounts).filter((a) => !existingLutAddresses.has(a));
  if (missing.length === 0) return [];

  const res = await fetch(LUT_FINDER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses: missing, verify: false }),
  });
  if (!res.ok) return [];

  const data = await res.json();
  return data.lutAddresses || [];
}

/**
 * Select the best route by smallest transaction size (not price).
 * This is critical for fitting multiply txs within Solana's 1232-byte limit.
 */
export function selectBestRoute(routes: any[]): any {
  if (routes.length === 0) throw new Error("No routes available");
  if (routes.length === 1) return routes[0];

  return routes.reduce((best: any, current: any) => {
    const bestSize = estimateIxsSize(best.ixs);
    const currentSize = estimateIxsSize(current.ixs);
    return bestSize <= currentSize ? best : current;
  });
}

function estimateIxsSize(ixs: Instruction[]): number {
  let total = 0;
  for (const ix of ixs) {
    if (!ix?.accounts || !ix?.data) continue;
    total += (ix.accounts as any[]).length * 32 + (ix.data as Uint8Array).byteLength + 1;
  }
  return total;
}

/**
 * Assemble all LUT addresses needed for a multiply transaction.
 *
 * Collects: user LUT + CDN LUTs + market LUT + route LUTs + resolved missing LUTs.
 * Returns string addresses for use with useTransaction hook.
 */
export async function assembleMultiplyLuts(params: {
  userLut: Address;
  collMint: string;
  debtMint: string;
  marketLut: string | undefined;
  routeLuts: any[];
  instructions: Instruction[];
  isMultiply: boolean;
}): Promise<string[]> {
  const { userLut, collMint, debtMint, marketLut, routeLuts, instructions, isMultiply } = params;

  // 1. Gather base LUT addresses
  const lutAddresses: string[] = [userLut as string];

  // 2. CDN LUTs
  const cdnLuts = await fetchCdnLuts(collMint, debtMint, isMultiply);
  lutAddresses.push(...cdnLuts);

  // 3. Market LUT
  if (marketLut) lutAddresses.push(marketLut);

  // 4. Route LUTs (extract address from Account<AddressLookupTable> objects)
  for (const lut of routeLuts) {
    if (typeof lut === "string") {
      lutAddresses.push(lut);
    } else if (lut?.address) {
      lutAddresses.push(lut.address as string);
    }
  }

  // 5. Resolve missing accounts
  const existingSet = new Set(lutAddresses);
  const additionalLuts = await resolveMissingLuts(instructions, existingSet);
  lutAddresses.push(...additionalLuts);

  // Deduplicate
  return [...new Set(lutAddresses)];
}
