export function safeFloat(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export function numOrNull(val: string | null | undefined): number | null {
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

const _pending = new Map<string, Promise<unknown>>();

export async function cachedAsync<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.at < ttlMs) return entry.value as T;

  // Request deduplication: concurrent callers share the same promise
  let pending = _pending.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = fn()
      .then((result) => {
        _pending.delete(key);
        if (result !== null && result !== undefined) {
          _cache.set(key, { at: Date.now(), value: result });
        }
        return result;
      })
      .catch((err) => {
        _pending.delete(key);
        throw err;
      });
    _pending.set(key, pending);
  }
  return pending;
}
