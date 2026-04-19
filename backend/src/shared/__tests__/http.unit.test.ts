/**
 * Unit tests for src/shared/http.ts — HTTP retry/backoff logic.
 * Uses vi.stubGlobal to mock fetch, and dynamic imports to avoid
 * conflicts with the global setup.unit.ts mocks.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Override fetch globally for this test file
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : `Error ${status}`,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers({ "Content-Type": "application/json" }),
  };
}

function errorResponse(status: number, body = "", headers?: Record<string, string>) {
  return {
    ok: false,
    status,
    statusText: `Error ${status}`,
    json: () => Promise.reject(new Error("not json")),
    text: () => Promise.resolve(body),
    headers: new Headers(headers ?? {}),
  };
}

// Dynamically import to pick up the stubbed fetch
const { getWithRetry, getOrNull, postJson, jupiterHeaders } = await import("../http.js");

describe("http.ts", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getWithRetry", () => {
    it("returns JSON on successful response", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));
      const result = await getWithRetry("https://api.example.com/data");
      expect(result).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("passes custom headers", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await getWithRetry("https://api.example.com/data", {
        headers: { "X-Custom": "value" },
      });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          headers: { "X-Custom": "value" },
        }),
      );
    });

    it("retries on 429 using Retry-After header", async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(429, "", { "Retry-After": "0" }))
        .mockResolvedValueOnce(jsonResponse({ retried: true }));

      const result = await getWithRetry("https://api.example.com/data");
      expect(result).toEqual({ retried: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10_000);

    it("retries on 500 with exponential backoff", async () => {
      mockFetch
        .mockResolvedValueOnce(errorResponse(500))
        .mockResolvedValueOnce(jsonResponse({ recovered: true }));

      const result = await getWithRetry("https://api.example.com/data");
      expect(result).toEqual({ recovered: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    }, 10_000);

    it("throws on 4xx error after retries", async () => {
      // 4xx errors are retried through the catch block (same as network errors)
      mockFetch.mockResolvedValue(errorResponse(404, "Not found"));
      await expect(
        getWithRetry("https://api.example.com/data"),
      ).rejects.toThrow("HTTP 404");
    }, 30_000);

    it("throws after exhausting all retries on 500", async () => {
      mockFetch.mockResolvedValue(errorResponse(500));
      await expect(
        getWithRetry("https://api.example.com/data"),
      ).rejects.toThrow("HTTP 500");
    }, 30_000);

    it("throws on network error after retries", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      await expect(
        getWithRetry("https://api.example.com/data"),
      ).rejects.toThrow("Network error");
    }, 30_000);
  });

  describe("getOrNull", () => {
    it("returns data on success", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: 1 }));
      const result = await getOrNull("https://api.example.com/data");
      expect(result).toEqual({ data: 1 });
    });

    it("returns null on failure instead of throwing", async () => {
      mockFetch.mockResolvedValue(errorResponse(500));
      const result = await getOrNull("https://api.example.com/data");
      expect(result).toBeNull();
    }, 30_000);
  });

  describe("postJson", () => {
    it("sends POST with JSON content-type and body", async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ created: true }));
      const result = await postJson("https://api.example.com/data", {
        key: "value",
      });
      expect(result).toEqual({ created: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/data",
        expect.objectContaining({
          method: "POST",
          body: '{"key":"value"}',
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("throws on 4xx errors after retries", async () => {
      mockFetch.mockResolvedValue(errorResponse(400));
      await expect(
        postJson("https://api.example.com/data", {}),
      ).rejects.toThrow("HTTP 400");
    }, 30_000);
  });

  describe("jupiterHeaders", () => {
    const originalEnv = process.env.JUPITER_API_KEY;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.JUPITER_API_KEY = originalEnv;
      } else {
        delete process.env.JUPITER_API_KEY;
      }
    });

    it("returns empty object when no API key", () => {
      delete process.env.JUPITER_API_KEY;
      expect(jupiterHeaders()).toEqual({});
    });

    it("returns x-api-key header when API key is set", () => {
      process.env.JUPITER_API_KEY = "test-key-123";
      expect(jupiterHeaders()).toEqual({ "x-api-key": "test-key-123" });
    });
  });
});
