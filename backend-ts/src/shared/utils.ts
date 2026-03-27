export function safeFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export function parseTimestamp(ts: unknown): Date | null {
  if (ts === null || ts === undefined) return null;
  try {
    if (typeof ts === "number") {
      return new Date(ts > 1e12 ? ts : ts * 1000);
    }
    const str = String(ts).replace("Z", "+00:00");
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

const _cache = new Map<string, { at: number; value: unknown }>();

export function cached<T>(key: string, ttlMs: number, fn: () => T): T {
  const entry = _cache.get(key);
  const now = Date.now();
  if (entry && now - entry.at < ttlMs) return entry.value as T;
  const result = fn();
  if (result !== null && result !== undefined) {
    _cache.set(key, { at: now, value: result });
  }
  return result;
}

export async function cachedAsync<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const entry = _cache.get(key);
  const now = Date.now();
  if (entry && now - entry.at < ttlMs) return entry.value as T;
  const result = await fn();
  if (result !== null && result !== undefined) {
    _cache.set(key, { at: now, value: result });
  }
  return result;
}
