/** HTTP client for backend API calls with timeout and error handling. */

import { config } from "./config.js";

const API = config.apiUrl;

export async function apiGet(path: string, timeoutMs: number = config.apiTimeoutMs): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `API ${res.status}: ${text.slice(0, 200)}` };
  }
  return res.json();
}

export async function apiPost(
  path: string,
  body: unknown,
  timeoutMs: number = config.apiTimeoutMs,
): Promise<unknown> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `API ${res.status}: ${text.slice(0, 200)}` };
  }
  return res.json();
}
