import QRCode from "qrcode";
import { APP_URL, FRONTEND_URL } from "../../shared/constants.js";

export interface SignOptions {
  /** Frontend /sign page URL (browser signing with wallet extension) */
  web: string;
  /** solana-action: deeplink (triggers Phantom/Solflare on mobile) */
  deeplink: string;
  /** QR code as data URL (base64 PNG — user scans with mobile wallet) */
  qr: string;
  /** Raw Solana Actions API URL (blink-compatible) */
  action_api: string;
}

/**
 * Build a Solana Actions API URL for a deposit/withdraw action.
 */
function buildActionUrl(
  action: "deposit" | "withdraw",
  opportunityId: number,
  amount: string,
  walletAddress: string,
  extraData?: Record<string, unknown>,
): string {
  const url = new URL(`${APP_URL}/api/manage/actions/${action}`);
  url.searchParams.set("opportunity_id", String(opportunityId));
  url.searchParams.set("amount", amount);
  url.searchParams.set("wallet", walletAddress);

  if (extraData) {
    if (extraData.leverage != null) url.searchParams.set("leverage", String(extraData.leverage));
    if (extraData.slippageBps != null) url.searchParams.set("slippageBps", String(extraData.slippageBps));
    if (extraData.action && extraData.action !== "open" && extraData.action !== "close")
      url.searchParams.set("action", String(extraData.action));
    if (extraData.position_id) url.searchParams.set("position_id", String(extraData.position_id));
    if (extraData.deposit_token) url.searchParams.set("deposit_token", String(extraData.deposit_token));
    if (extraData.isClosingPosition) url.searchParams.set("isClosingPosition", "true");
  }

  return url.toString();
}

/**
 * Generate all signing format options for a deposit/withdraw transaction.
 * Used by MCP tools, REST endpoints (format=assembled), and telegram bot.
 */
export async function generateSignOptions(
  action: "deposit" | "withdraw",
  opportunityId: number,
  amount: string,
  walletAddress: string,
  extraData?: Record<string, unknown>,
): Promise<SignOptions> {
  const actionApiUrl = buildActionUrl(action, opportunityId, amount, walletAddress, extraData);
  const deeplinkUrl = `solana-action:${actionApiUrl}`;
  const qr = await QRCode.toDataURL(deeplinkUrl, { width: 256, margin: 1 });

  return {
    web: `${FRONTEND_URL}/sign?action=${encodeURIComponent(actionApiUrl)}`,
    deeplink: deeplinkUrl,
    qr,
    action_api: actionApiUrl,
  };
}
