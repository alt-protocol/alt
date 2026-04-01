import type { OpportunityDetail } from "../../shared/types.js";
import type { SerializableInstruction } from "../../shared/types.js";
import { STABLECOIN_SYMBOLS } from "../../shared/constants.js";
import { hasAdapter } from "../protocols/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

class GuardError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "GuardError";
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Pre-build guards
// ---------------------------------------------------------------------------

/** Validate wallet address is a valid base58 Solana address. */
export function guardWalletValid(walletAddress: string): void {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
    throw new GuardError("Invalid Solana wallet address");
  }
}

/** Ensure the opportunity exists, is active, and has a deposit address. */
export function guardOpportunityActive(
  opp: OpportunityDetail | null,
  opportunityId: number,
): asserts opp is OpportunityDetail {
  if (!opp) {
    throw new GuardError(`Opportunity ${opportunityId} not found`, 404);
  }
  if (!opp.deposit_address) {
    throw new GuardError(
      `Opportunity ${opportunityId} has no deposit address`,
    );
  }
}

/** Ensure the opportunity's protocol has an adapter. */
export function guardAdapterExists(opp: OpportunityDetail): void {
  if (!opp.protocol?.slug) {
    throw new GuardError("Opportunity has no protocol");
  }
  if (!hasAdapter(opp.protocol.slug)) {
    throw new GuardError(
      `No adapter for protocol "${opp.protocol.slug}". Supported: kamino, drift, jupiter`,
    );
  }
}

/** Optional deposit limit check (env: MCP_MAX_DEPOSIT_USD). */
export function guardDepositLimit(amount: string): void {
  const maxStr = process.env.MCP_MAX_DEPOSIT_USD;
  if (!maxStr) return;

  const max = Number(maxStr);
  const val = Number(amount);
  if (Number.isFinite(max) && Number.isFinite(val) && val > max) {
    throw new GuardError(
      `Amount $${val} exceeds maximum deposit limit of $${max}`,
    );
  }
}

/**
 * Stablecoin-only guard. When STABLECOIN_ONLY === "true" (default: disabled),
 * at least one token in the opportunity must be a stablecoin.
 */
export function guardStablecoinOnly(opp: OpportunityDetail): void {
  if (process.env.STABLECOIN_ONLY !== "true") return;

  const hasStable = opp.tokens.some((t) => STABLECOIN_SYMBOLS.has(t));
  if (!hasStable) {
    throw new GuardError(
      `Opportunity "${opp.name}" has no stablecoin tokens (${opp.tokens.join(", ")}). ` +
        `Only stablecoin opportunities are allowed. Set STABLECOIN_ONLY=false to override.`,
    );
  }
}

/**
 * Category blocklist. Rejects categories listed in BLOCKED_CATEGORIES env var.
 * Default: none blocked. Set BLOCKED_CATEGORIES="multiply" to block leveraged positions.
 */
export function guardCategoryAllowed(opp: OpportunityDetail): void {
  const blockedStr = process.env.BLOCKED_CATEGORIES ?? "";
  if (!blockedStr) return;

  const blocked = new Set(blockedStr.split(",").map((s) => s.trim()));
  if (blocked.has(opp.category)) {
    throw new GuardError(
      `Category "${opp.category}" is blocked. Blocked categories: ${blockedStr}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Post-build guards
// ---------------------------------------------------------------------------

/** Known Solana infrastructure program addresses. */
const KNOWN_PROGRAMS = new Set([
  "11111111111111111111111111111111", // System Program
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // Token Program
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", // Token 2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // ATA
  "ComputeBudget111111111111111111111111111111", // Compute Budget
  "AddressLookupTab1e1111111111111111111111111", // ALT Program
  // Kamino
  "KLend2g3cP87ber8LQur7Kx1dYKMnLgNq3Jb5zMhJxp", // klend (old)
  "KLend2g3cP87ber8LQur7Kx1dYKMnLgNq3Jb5zMhJxo", // klend (variant)
  "kvauTFR8qm1dhniz6pYuBZkuene3Hfrs1VQhVRgCNrr", // Kamino vault (legacy)
  "KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd", // Kamino vault (kvaults v2)
  "FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr", // Kamino Farms
  "ScopeZXynqGXfzUmn4NLqyPRjpXthANEexhVGo5i2ux", // Scope oracle
  // Drift
  "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH", // Drift V2
  "vAuLTsyrvSfZRuRB3XgvkPwNGgYSs9YRYymVebLKoxR", // Drift Vaults
  // Jupiter
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter V6
  "jupaEfBGhvYvpGo99zScFXCAW4yJpQjTFY9o1hiYLEM", // Jupiter Lend Router
  "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9", // Jupiter Lend Protocol
  // KSwap / DEX routing
  "KSwapzXNkf3JBhUeRjn9xbA3W2Y3LUoNhKSfb1Bvmi", // KSwap
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP", // Orca
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc", // Orca Whirlpool
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLAMM
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", // Meteora DLMM
]);

/**
 * Verify all programAddress values in serialized instructions are known.
 * Prevents a compromised SDK from injecting calls to unknown programs.
 */
export function guardProgramWhitelist(
  instructions: SerializableInstruction[],
): void {
  for (const ix of instructions) {
    if (!KNOWN_PROGRAMS.has(ix.programAddress)) {
      throw new GuardError(
        `Unknown program ${ix.programAddress} in built instructions. This may indicate a compromised SDK.`,
      );
    }
  }
}
