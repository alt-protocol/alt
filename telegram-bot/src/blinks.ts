import QRCode from "qrcode";
import { config } from "./config.js";

export interface SignOptions {
  /** Frontend /sign page URL (for browser signing) */
  web: string;
  /** solana-action: deeplink (for Phantom/Solflare mobile) */
  deeplink: string;
  /** QR code as PNG buffer (encodes the deeplink) */
  qr: Buffer;
  /** Raw Solana Actions API URL */
  actionUrl: string;
}

/** Build the Solana Actions API URL for a deposit/withdraw action. */
function buildActionUrl(
  action: "deposit" | "withdraw",
  opportunityId: number,
  amount: string,
  walletAddress: string,
  extraParams?: Record<string, string>,
): string {
  const apiBase = config.apiUrl.replace(/\/$/, "");
  const url = new URL(`${apiBase}/api/manage/actions/${action}`);
  url.searchParams.set("opportunity_id", String(opportunityId));
  url.searchParams.set("amount", amount);
  url.searchParams.set("wallet", walletAddress);
  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

/** Generate all signing formats: web link, deeplink, and QR code. */
export async function generateSignOptions(
  action: "deposit" | "withdraw",
  opportunityId: number,
  amount: string,
  walletAddress: string,
  extraParams?: Record<string, string>,
): Promise<SignOptions> {
  const actionUrl = buildActionUrl(action, opportunityId, amount, walletAddress, extraParams);
  const frontendBase = config.frontendUrl.replace(/\/$/, "");
  const deeplink = `solana-action:${actionUrl}`;

  const qrBuffer = await QRCode.toBuffer(deeplink, { width: 256, margin: 1 });

  return {
    web: `${frontendBase}/sign?action=${encodeURIComponent(actionUrl)}`,
    deeplink,
    qr: qrBuffer,
    actionUrl,
  };
}

/** Legacy: generate web-only sign URL. */
export function generateSignUrl(
  action: "deposit" | "withdraw",
  opportunityId: number,
  amount: string,
  walletAddress: string,
  extraParams?: Record<string, string>,
): string {
  const actionUrl = buildActionUrl(action, opportunityId, amount, walletAddress, extraParams);
  const frontendBase = config.frontendUrl.replace(/\/$/, "");
  return `${frontendBase}/sign?action=${encodeURIComponent(actionUrl)}`;
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
