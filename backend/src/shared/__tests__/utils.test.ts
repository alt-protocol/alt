import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeFloat, numOrNull, parseTimestamp, cached, cachedAsync } from "../utils.js";

describe("safeFloat", () => {
  it("returns number for valid numeric string", () => {
    expect(safeFloat("3.14")).toBe(3.14);
    expect(safeFloat("0")).toBe(0);
    expect(safeFloat("-1.5")).toBe(-1.5);
  });

  it("returns number for number input", () => {
    expect(safeFloat(42)).toBe(42);
    expect(safeFloat(0)).toBe(0);
  });

  it("returns null for non-finite values", () => {
    expect(safeFloat(NaN)).toBeNull();
    expect(safeFloat(Infinity)).toBeNull();
    expect(safeFloat("not a number")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(safeFloat(null)).toBeNull();
    expect(safeFloat(undefined)).toBeNull();
  });
});

describe("numOrNull", () => {
  it("converts valid string to number", () => {
    expect(numOrNull("100.5")).toBe(100.5);
    expect(numOrNull("0")).toBe(0);
  });

  it("returns null for null/undefined/empty", () => {
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull(undefined)).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(numOrNull("abc")).toBeNull();
  });
});

describe("parseTimestamp", () => {
  it("parses ISO string", () => {
    const d = parseTimestamp("2024-01-15T10:30:00Z");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2024);
  });

  it("parses unix timestamp (seconds)", () => {
    const d = parseTimestamp(1705312200); // Jan 15, 2024
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2024);
  });

  it("parses unix timestamp (milliseconds)", () => {
    const d = parseTimestamp(1705312200000);
    expect(d).toBeInstanceOf(Date);
  });

  it("returns null for invalid input", () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp("invalid")).toBeNull();
  });
});

describe("cached", () => {
  beforeEach(() => {
    // Clear internal cache between tests by calling with unique keys
  });

  it("returns cached value within TTL", () => {
    let calls = 0;
    const fn = () => { calls++; return 42; };
    const key = `test_cached_${Date.now()}`;
    expect(cached(key, 1000, fn)).toBe(42);
    expect(cached(key, 1000, fn)).toBe(42);
    expect(calls).toBe(1); // only called once
  });

  it("recomputes after TTL expires", async () => {
    let counter = 0;
    const fn = () => ++counter;
    const key = `test_cached_ttl_${Date.now()}`;
    expect(cached(key, 10, fn)).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(cached(key, 10, fn)).toBe(2);
  });
});

describe("cachedAsync", () => {
  it("returns cached value within TTL", async () => {
    let calls = 0;
    const fn = async () => { calls++; return "hello"; };
    const key = `test_async_${Date.now()}`;
    expect(await cachedAsync(key, 1000, fn)).toBe("hello");
    expect(await cachedAsync(key, 1000, fn)).toBe("hello");
    expect(calls).toBe(1);
  });

  it("deduplicates concurrent calls", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return "result";
    };
    const key = `test_dedup_${Date.now()}`;
    const [a, b] = await Promise.all([
      cachedAsync(key, 1000, fn),
      cachedAsync(key, 1000, fn),
    ]);
    expect(a).toBe("result");
    expect(b).toBe("result");
    expect(calls).toBe(1); // only one actual call
  });
});
