import { logger } from "./logger.js";

const DEFAULT_TIMEOUT = 30_000;
const MAX_RETRIES = 3;
const MAX_429_RETRIES = 2;

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Jupiter API key header — shared by all Jupiter callers. */
export function jupiterHeaders(): Record<string, string> {
  const key = process.env.JUPITER_API_KEY ?? "";
  return key ? { "x-api-key": key } : {};
}

export async function getWithRetry(
  url: string,
  options?: { timeout?: number; headers?: Record<string, string> },
): Promise<unknown> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  let rateLimitRetries = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES + MAX_429_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: options?.headers,
      });
      clearTimeout(timer);

      if (resp.status === 429 && rateLimitRetries < MAX_429_RETRIES) {
        rateLimitRetries++;
        const retryAfter = Number(resp.headers.get("Retry-After") || 2);
        const delay = Math.min(retryAfter * 1000, 5000);
        logger.warn({ url: url.split("?")[0], attempt, delay }, "Rate limited (429), retrying");
        await wait(delay);
        continue;
      }

      if (resp.status >= 500 && attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
        await wait(delay);
        continue;
      }

      if (!resp.ok) {
        let body = "";
        try { body = await resp.text(); } catch {}
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`);
      }
      return await resp.json();
    } catch (err) {
      clearTimeout(timer);
      if (attempt >= MAX_RETRIES + rateLimitRetries) throw err;
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
  options?: { timeout?: number; headers?: Record<string, string> },
): Promise<unknown> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const payload = JSON.stringify(body);
  let rateLimitRetries = 0;

  for (let attempt = 1; attempt <= MAX_RETRIES + MAX_429_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...options?.headers },
        body: payload,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.status === 429 && rateLimitRetries < MAX_429_RETRIES) {
        rateLimitRetries++;
        const retryAfter = Number(resp.headers.get("Retry-After") || 2);
        const delay = Math.min(retryAfter * 1000, 5000);
        logger.warn({ url: url.split("?")[0], attempt, delay }, "POST rate limited (429), retrying");
        await wait(delay);
        continue;
      }

      if (resp.status >= 500 && attempt < MAX_RETRIES) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
        await wait(delay);
        continue;
      }

      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      return await resp.json();
    } catch (err) {
      clearTimeout(timer);
      if (attempt >= MAX_RETRIES + rateLimitRetries) throw err;
      const delay = Math.min(1000 * 2 ** (attempt - 1), 10_000);
      await wait(delay);
    }
  }
  throw new Error("unreachable");
}
