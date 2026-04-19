/**
 * Unit tests for src/shared/auth.ts — API key auth + rate limiting.
 * Mocks the database to test auth logic without Postgres.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

// Mock db module before importing auth
vi.mock("../db.js", () => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockWhere = vi.fn();
  const mockLimit = vi.fn();

  // Chain: db.select().from().where().limit()
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockLimit.mockResolvedValue([]);

  return {
    db: { select: mockSelect },
    pool: { end: vi.fn() },
    __mockLimit: mockLimit, // exposed for per-test configuration
  };
});

// Mock logger
vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

const { authHook, validateApiKey } = await import("../auth.js");
const { __mockLimit } = await import("../db.js") as any;

/* eslint-disable @typescript-eslint/no-explicit-any */

function createMockRequest(authHeader?: string) {
  return {
    headers: {
      authorization: authHeader,
    },
  } as any;
}

function createMockReply() {
  const reply: Record<string, unknown> = {};
  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply as any;
}

const TEST_API_KEY = "test-key-abc123";
const TEST_KEY_HASH = createHash("sha256").update(TEST_API_KEY).digest("hex");

function mockValidKey(rateLimit = 100) {
  __mockLimit.mockResolvedValueOnce([
    {
      id: 1,
      key_hash: TEST_KEY_HASH,
      name: "test-key",
      is_active: true,
      rate_limit: rateLimit,
      created_at: new Date(),
    },
  ]);
}

describe("authHook", () => {
  const origAuthDisabled = process.env.MANAGE_AUTH_DISABLED;
  const origNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MANAGE_AUTH_DISABLED;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    if (origAuthDisabled !== undefined) {
      process.env.MANAGE_AUTH_DISABLED = origAuthDisabled;
    } else {
      delete process.env.MANAGE_AUTH_DISABLED;
    }
    if (origNodeEnv !== undefined) {
      process.env.NODE_ENV = origNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  });

  it("returns 401 when Authorization header is missing", async () => {
    const reply = createMockReply();
    await authHook(createMockRequest(), reply);
    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Missing API key" });
  });

  it("returns 401 when Authorization is not Bearer format", async () => {
    const reply = createMockReply();
    await authHook(createMockRequest("Basic abc123"), reply);
    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Missing API key" });
  });

  it("returns 401 when key hash not found in database", async () => {
    const reply = createMockReply();
    __mockLimit.mockResolvedValueOnce([]); // no matching key
    await authHook(createMockRequest("Bearer invalid-key"), reply);
    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: "Invalid API key" });
  });

  it("passes through with valid API key", async () => {
    const reply = createMockReply();
    mockValidKey();
    await authHook(createMockRequest(`Bearer ${TEST_API_KEY}`), reply);
    expect(reply.status).not.toHaveBeenCalled();
  });

  it("sets request.apiKeyName on success", async () => {
    const reply = createMockReply();
    const request = createMockRequest(`Bearer ${TEST_API_KEY}`);
    mockValidKey();
    await authHook(request, reply);
    expect(request.apiKeyName).toBe("test-key");
  });

  describe("MANAGE_AUTH_DISABLED bypass", () => {
    it("bypasses auth in non-production when MANAGE_AUTH_DISABLED=true", async () => {
      process.env.MANAGE_AUTH_DISABLED = "true";
      process.env.NODE_ENV = "development";
      const reply = createMockReply();
      await authHook(createMockRequest(), reply);
      expect(reply.status).not.toHaveBeenCalled();
    });

    it("bypasses auth when NODE_ENV is unset and MANAGE_AUTH_DISABLED=true", async () => {
      process.env.MANAGE_AUTH_DISABLED = "true";
      delete process.env.NODE_ENV;
      const reply = createMockReply();
      await authHook(createMockRequest(), reply);
      expect(reply.status).not.toHaveBeenCalled();
    });

    it("does NOT bypass auth in production even with MANAGE_AUTH_DISABLED=true", async () => {
      process.env.MANAGE_AUTH_DISABLED = "true";
      process.env.NODE_ENV = "production";
      const reply = createMockReply();
      await authHook(createMockRequest(), reply);
      // Should still require auth in production
      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith({ error: "Missing API key" });
    });
  });

  describe("rate limiting via authHook", () => {
    it("returns 401 (Invalid API key) when rate limit exceeded", async () => {
      // validateApiKey returns null when rate limited,
      // authHook maps null → 401 "Invalid API key"
      const uniqueKey = `rate-limit-hook-${Date.now()}`;
      const uniqueHash = createHash("sha256").update(uniqueKey).digest("hex");
      const rateLimit = 2;

      const mockKey = () => {
        __mockLimit.mockResolvedValueOnce([
          {
            id: 3,
            key_hash: uniqueHash,
            name: "rate-hook-test",
            is_active: true,
            rate_limit: rateLimit,
            created_at: new Date(),
          },
        ]);
      };

      // First 2 requests pass
      for (let i = 0; i < rateLimit; i++) {
        const reply = createMockReply();
        mockKey();
        await authHook(createMockRequest(`Bearer ${uniqueKey}`), reply);
        expect(reply.status).not.toHaveBeenCalled();
      }

      // 3rd request exceeds rate limit → 401
      const reply = createMockReply();
      mockKey();
      await authHook(createMockRequest(`Bearer ${uniqueKey}`), reply);
      expect(reply.status).toHaveBeenCalledWith(401);
      expect(reply.send).toHaveBeenCalledWith({ error: "Invalid API key" });
    });
  });
});

describe("validateApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns result with name, keyHash, rateLimit for valid key", async () => {
    mockValidKey(50);
    const result = await validateApiKey(TEST_API_KEY);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("test-key");
    expect(result!.keyHash).toBe(TEST_KEY_HASH);
    expect(result!.rateLimit).toBe(50);
  });

  it("returns null for unknown key hash", async () => {
    __mockLimit.mockResolvedValueOnce([]); // no matching key
    const result = await validateApiKey("unknown-key");
    expect(result).toBeNull();
  });

  it("returns null when rate limit is exceeded", async () => {
    const uniqueKey = `validate-rate-${Date.now()}`;
    const rateLimit = 2;

    const mockKey = () => {
      const hash = createHash("sha256").update(uniqueKey).digest("hex");
      __mockLimit.mockResolvedValueOnce([
        {
          id: 4,
          key_hash: hash,
          name: "validate-rate-test",
          is_active: true,
          rate_limit: rateLimit,
          created_at: new Date(),
        },
      ]);
    };

    // First 2 calls succeed
    for (let i = 0; i < rateLimit; i++) {
      mockKey();
      const result = await validateApiKey(uniqueKey);
      expect(result).not.toBeNull();
    }

    // 3rd call exceeds limit → null
    mockKey();
    const result = await validateApiKey(uniqueKey);
    expect(result).toBeNull();
  });

  it("defaults rate_limit to 100 when null in DB", async () => {
    __mockLimit.mockResolvedValueOnce([
      {
        id: 5,
        key_hash: TEST_KEY_HASH,
        name: "no-limit-key",
        is_active: true,
        rate_limit: null,
        created_at: new Date(),
      },
    ]);
    const result = await validateApiKey(TEST_API_KEY);
    expect(result).not.toBeNull();
    expect(result!.rateLimit).toBe(100);
  });
});
