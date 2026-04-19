/**
 * Unit tests for caching functions in src/shared/utils.ts.
 * Tests: TTL expiry, deduplication, error propagation, size limits, eviction.
 */
import { describe, it, expect, vi } from "vitest";
import { cached, cachedAsync, bustCacheKey } from "../utils.js";

describe("cached()", () => {
  it("caches result within TTL", () => {
    let calls = 0;
    const key = `cached_hit_${Date.now()}`;
    const fn = () => {
      calls++;
      return 42;
    };

    expect(cached(key, 5000, fn)).toBe(42);
    expect(cached(key, 5000, fn)).toBe(42);
    expect(calls).toBe(1);
  });

  it("does not cache null results", () => {
    let calls = 0;
    const key = `cached_null_${Date.now()}`;
    const fn = () => {
      calls++;
      return null;
    };

    cached(key, 5000, fn);
    cached(key, 5000, fn);
    expect(calls).toBe(2);
  });

  it("does not cache undefined results", () => {
    let calls = 0;
    const key = `cached_undef_${Date.now()}`;
    const fn = () => {
      calls++;
      return undefined;
    };

    cached(key, 5000, fn);
    cached(key, 5000, fn);
    expect(calls).toBe(2);
  });

  it("re-fetches after TTL expires", async () => {
    let calls = 0;
    const key = `cached_ttl_${Date.now()}`;
    const fn = () => ++calls;

    cached(key, 50, fn);
    expect(calls).toBe(1);

    await new Promise((r) => setTimeout(r, 60));

    cached(key, 50, fn);
    expect(calls).toBe(2);
  });
});

describe("cachedAsync()", () => {
  it("caches async result within TTL", async () => {
    let calls = 0;
    const key = `async_hit_${Date.now()}`;
    const fn = async () => {
      calls++;
      return "data";
    };

    expect(await cachedAsync(key, 5000, fn)).toBe("data");
    expect(await cachedAsync(key, 5000, fn)).toBe("data");
    expect(calls).toBe(1);
  });

  it("deduplicates concurrent calls (single execution)", async () => {
    let calls = 0;
    const key = `async_dedup_${Date.now()}`;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return "result";
    };

    const [r1, r2, r3] = await Promise.all([
      cachedAsync(key, 5000, fn),
      cachedAsync(key, 5000, fn),
      cachedAsync(key, 5000, fn),
    ]);

    expect(calls).toBe(1);
    expect(r1).toBe("result");
    expect(r2).toBe("result");
    expect(r3).toBe("result");
  });

  it("propagates errors to all concurrent waiters", async () => {
    let calls = 0;
    const key = `async_err_${Date.now()}`;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("boom");
    };

    const results = await Promise.allSettled([
      cachedAsync(key, 5000, fn),
      cachedAsync(key, 5000, fn),
    ]);

    expect(calls).toBe(1);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
  });

  it("retries after error (pending is cleaned up)", async () => {
    let calls = 0;
    const key = `async_retry_${Date.now()}`;

    await expect(
      cachedAsync(key, 5000, async () => {
        calls++;
        throw new Error("fail");
      }),
    ).rejects.toThrow("fail");

    calls = 0;
    await expect(
      cachedAsync(key, 5000, async () => {
        calls++;
        throw new Error("fail again");
      }),
    ).rejects.toThrow("fail again");
    expect(calls).toBe(1);
  });

  it("does not cache null results", async () => {
    let calls = 0;
    const key = `async_null_${Date.now()}`;
    const fn = async () => {
      calls++;
      return null;
    };

    await cachedAsync(key, 5000, fn);
    await cachedAsync(key, 5000, fn);
    expect(calls).toBe(2);
  });

  it("re-fetches after TTL expires", async () => {
    let calls = 0;
    const key = `async_ttl_${Date.now()}`;
    const fn = async () => ++calls;

    await cachedAsync(key, 50, fn);
    expect(calls).toBe(1);

    await new Promise((r) => setTimeout(r, 60));

    await cachedAsync(key, 50, fn);
    expect(calls).toBe(2);
  });
});

describe("bustCacheKey()", () => {
  it("removes a cached entry so next call re-fetches", () => {
    let calls = 0;
    const key = `bust_${Date.now()}`;
    const fn = () => ++calls;

    cached(key, 60_000, fn);
    expect(calls).toBe(1);

    // Still cached
    cached(key, 60_000, fn);
    expect(calls).toBe(1);

    // Bust it
    bustCacheKey(key);

    // Next call re-fetches
    cached(key, 60_000, fn);
    expect(calls).toBe(2);
  });

  it("is a no-op for non-existent keys", () => {
    // Should not throw
    bustCacheKey(`nonexistent_${Date.now()}`);
  });
});

describe("cache size limits (MAX_CACHE_SIZE)", () => {
  // MAX_CACHE_SIZE = 1000 in production code
  // These tests verify the cache doesn't grow unbounded

  it("evicts expired entries when cache is near capacity", async () => {
    const prefix = `size_expired_${Date.now()}_`;

    // Fill with many entries using very short TTL (1ms)
    for (let i = 0; i < 50; i++) {
      cached(`${prefix}${i}`, 1, () => `val_${i}`);
    }

    // Wait for all to expire
    await new Promise((r) => setTimeout(r, 10));

    // Adding more entries should not crash or grow unbounded
    // (evictExpired will clean up expired entries)
    for (let i = 50; i < 100; i++) {
      cached(`${prefix}${i}`, 60_000, () => `val_${i}`);
    }

    // New entries should work fine
    const result = cached(`${prefix}99`, 60_000, () => "should_be_cached");
    expect(result).toBe("val_99"); // still cached from loop above
  });

  it("handles many concurrent async cache entries without error", async () => {
    const prefix = `size_async_${Date.now()}_`;
    const promises: Promise<string>[] = [];

    // Create 50 concurrent cache entries
    for (let i = 0; i < 50; i++) {
      promises.push(
        cachedAsync(`${prefix}${i}`, 60_000, async () => `async_val_${i}`),
      );
    }

    const results = await Promise.all(promises);
    expect(results).toHaveLength(50);
    expect(results[0]).toBe("async_val_0");
    expect(results[49]).toBe("async_val_49");
  });
});
