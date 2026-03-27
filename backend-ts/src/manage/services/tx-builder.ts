import { discoverService } from "../../discover/service.js";
import { getAdapter } from "../protocols/index.js";
import type { BuildTxParams } from "../protocols/types.js";
import {
  serializeResult,
  type SerializedBuildResult,
} from "./instruction-serializer.js";
import {
  guardWalletValid,
  guardOpportunityActive,
  guardAdapterExists,
  guardDepositLimit,
  guardStablecoinOnly,
  guardCategoryAllowed,
  guardProgramWhitelist,
} from "./guards.js";
import { logger } from "../../shared/logger.js";

export interface BuildRequest {
  opportunity_id: number;
  wallet_address: string;
  amount: string;
  extra_data?: Record<string, unknown>;
}

/**
 * Orchestrator: Discover lookup -> guards -> adapter -> serialize.
 *
 * 1. Fetch opportunity from Discover (cross-module read)
 * 2. Run pre-build guards
 * 3. Load protocol adapter
 * 4. Build unsigned instructions
 * 5. Serialize result for JSON transport
 */
export async function buildTransaction(
  request: BuildRequest,
  action: "deposit" | "withdraw",
): Promise<SerializedBuildResult> {
  const { opportunity_id, wallet_address, amount, extra_data } = request;

  // Pre-build guards
  guardWalletValid(wallet_address);
  guardDepositLimit(amount);

  // Cross-module read
  const opp = await discoverService.getOpportunityById(opportunity_id);
  guardOpportunityActive(opp, opportunity_id);
  guardAdapterExists(opp);
  guardStablecoinOnly(opp);
  guardCategoryAllowed(opp);

  // Load adapter
  const adapter = await getAdapter(opp.protocol!.slug);
  if (!adapter) {
    throw Object.assign(
      new Error(`Adapter for "${opp.protocol!.slug}" failed to load`),
      { statusCode: 500 },
    );
  }

  // Merge extra_data: opportunity's stored data + client overrides
  const mergedExtraData = {
    ...(opp.extra_data ?? {}),
    ...(extra_data ?? {}),
  };

  const params: BuildTxParams = {
    walletAddress: wallet_address,
    depositAddress: opp.deposit_address!,
    amount,
    category: opp.category,
    extraData: mergedExtraData,
  };

  logger.info(
    {
      action,
      opportunity_id,
      protocol: opp.protocol!.slug,
      category: opp.category,
      wallet: wallet_address.slice(0, 8) + "...",
    },
    "Building transaction",
  );

  // Build instructions
  const result =
    action === "deposit"
      ? await adapter.buildDepositTx(params)
      : await adapter.buildWithdrawTx(params);

  // Serialize for JSON transport
  const serialized = serializeResult(result);

  // Post-build guard: verify all programs are known
  guardProgramWhitelist(serialized.instructions);
  if (serialized.setupInstructionSets) {
    for (const set of serialized.setupInstructionSets) {
      guardProgramWhitelist(set);
    }
  }

  return serialized;
}
