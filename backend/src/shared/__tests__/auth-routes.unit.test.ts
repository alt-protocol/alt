/**
 * Unit tests for src/shared/auth-routes.ts — agent self-registration endpoint.
 * Mocks the database to test registration logic without Postgres.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// Mock db module
const mockValues = vi.fn().mockResolvedValue([]);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

vi.mock("../db.js", () => ({
  db: { insert: mockInsert },
  pool: { end: vi.fn() },
}));

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

// Suppress constants.ts production warning
vi.mock("../constants.js", () => ({
  APP_URL: "http://localhost:8001",
  FRONTEND_URL: "http://localhost:3000",
}));

const { authRoutes } = await import("../auth-routes.js");

/* eslint-disable @typescript-eslint/no-explicit-any */

// Minimal Fastify mock for route registration
function createMockApp() {
  const routes: Record<string, { opts: any; handler: any }> = {};
  return {
    post: vi.fn((path: string, opts: any, handler?: any) => {
      if (typeof opts === "function") {
        routes[path] = { opts: {}, handler: opts };
      } else {
        routes[path] = { opts, handler };
      }
    }),
    routes,
  };
}

function createMockReply() {
  const reply: Record<string, any> = {};
  reply.status = vi.fn().mockReturnValue(reply);
  reply.send = vi.fn().mockReturnValue(reply);
  return reply;
}

describe("authRoutes — POST /register", () => {
  let app: ReturnType<typeof createMockApp>;
  let handler: (request: any, reply: any) => Promise<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = createMockApp();
    await authRoutes(app as any);
    handler = app.routes["/register"].handler;
  });

  it("registers the /register route", () => {
    expect(app.post).toHaveBeenCalledWith("/register", expect.any(Object), expect.any(Function));
  });

  it("returns 201 with ak_-prefixed API key", async () => {
    const reply = createMockReply();
    await handler({ body: { name: "test-agent" } }, reply);

    expect(reply.status).toHaveBeenCalledWith(201);
    const sent = reply.send.mock.calls[0][0];
    expect(sent.api_key).toMatch(/^ak_[a-f0-9]{64}$/);
    expect(sent.name).toBe("test-agent");
  });

  it("returns key of exactly 67 characters (ak_ + 64 hex)", async () => {
    const reply = createMockReply();
    await handler({ body: { name: "test" } }, reply);

    const sent = reply.send.mock.calls[0][0];
    expect(sent.api_key.length).toBe(67);
  });

  it("inserts SHA-256 hash of the returned key into DB", async () => {
    const reply = createMockReply();
    await handler({ body: { name: "hash-test" } }, reply);

    const sent = reply.send.mock.calls[0][0];
    const expectedHash = createHash("sha256").update(sent.api_key).digest("hex");

    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ key_hash: expectedHash, name: "hash-test" }),
    );
  });

  it("produces different keys on consecutive calls", async () => {
    const reply1 = createMockReply();
    const reply2 = createMockReply();
    await handler({ body: { name: "a" } }, reply1);
    await handler({ body: { name: "b" } }, reply2);

    const key1 = reply1.send.mock.calls[0][0].api_key;
    const key2 = reply2.send.mock.calls[0][0].api_key;
    expect(key1).not.toBe(key2);
  });

  it("throws on empty name", async () => {
    const reply = createMockReply();
    await expect(handler({ body: { name: "" } }, reply)).rejects.toThrow();
  });

  it("throws on missing name", async () => {
    const reply = createMockReply();
    await expect(handler({ body: {} }, reply)).rejects.toThrow();
  });

  it("throws on name exceeding 100 characters", async () => {
    const reply = createMockReply();
    await expect(handler({ body: { name: "a".repeat(101) } }, reply)).rejects.toThrow();
  });
});
