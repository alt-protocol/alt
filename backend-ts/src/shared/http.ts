import { logger } from "./logger.js";

const DEFAULT_TIMEOUT = 30_000;
const MAX_RETRIES = 3;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getWithRetry(
  url: string,
  options?: { timeout?: number; headers?: Record<string, string> },
): Promise<unknown> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: options?.headers,
      });
      clearTimeout(timer);

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      return await resp.json();
    } catch (err) {
      clearTimeout(timer);
      if (attempt === MAX_RETRIES) throw err;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
      await wait(delay);
    }
  }
  throw new Error("unreachable");
}

export async function getOrNull(
  url: string,
  options?: { timeout?: number; headers?: Record<string, string>; logLabel?: string },
): Promise<unknown | null> {
  try {
    return await getWithRetry(url, options);
  } catch (err) {
    logger.warn({ err, url }, `${options?.logLabel ?? "API"} request failed after retries`);
    return null;
  }
}

export async function postJson(
  url: string,
  body: unknown,
  options?: { timeout?: number },
): Promise<unknown> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    return await resp.json();
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}
