import { config } from "./config.js";

/** Generate a frontend /sign URL that the user opens to sign a transaction. */
export function generateSignUrl(
  action: "deposit" | "withdraw",
  opportunityId: number,
  amount: string,
  walletAddress: string,
  extraParams?: Record<string, string>,
): string {
  const apiBase = config.apiUrl.replace(/\/$/, "");
  const actionUrl = new URL(`${apiBase}/api/manage/actions/${action}`);
  actionUrl.searchParams.set("opportunity_id", String(opportunityId));
  actionUrl.searchParams.set("amount", amount);
  actionUrl.searchParams.set("wallet", walletAddress);
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      actionUrl.searchParams.set(k, v);
    }
  }
  const frontendBase = config.frontendUrl.replace(/\/$/, "");
  return `${frontendBase}/sign?action=${encodeURIComponent(actionUrl.toString())}`;
}

/** Extract multiply-specific fields from params as string key-value pairs for URL query. */
export function buildExtraParams(
  params: Record<string, unknown>,
): Record<string, string> | undefined {
  const extra: Record<string, string> = {};
  if (params.leverage != null) extra.leverage = String(params.leverage);
  if (params.slippage_bps != null) extra.slippageBps = String(params.slippage_bps);
  if (params.is_closing_position) extra.isClosingPosition = "true";
  if (params.action && params.action !== "open" && params.action !== "close")
    extra.action = String(params.action);
  if (params.position_id) extra.position_id = String(params.position_id);
  if (params.deposit_token) extra.deposit_token = String(params.deposit_token);
  return Object.keys(extra).length > 0 ? extra : undefined;
}
