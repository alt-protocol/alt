/**
 * Global setup for unit tests.
 * Mocks all external dependencies so unit tests never touch
 * real databases, RPC nodes, or external APIs.
 */
import { vi } from "vitest";
import { createMockLegacyConnection, createMockRpc } from "./mocks/rpc.mock.js";

// Mock the database module — prevents connecting to Postgres
vi.mock("../shared/db.js", () => {
  const chainable: Record<string, unknown> = {};
  const terminal = vi.fn().mockResolvedValue([]);

  // Drizzle query builder chain: db.select().from().where()...
  const chain = () =>
    new Proxy(chainable, {
      get(_target, prop) {
        if (prop === "then") return undefined; // not a thenable until execute
        if (prop === "execute") return terminal;
        return vi.fn().mockReturnValue(chain());
      },
    });

  return {
    db: chain(),
    pool: { end: vi.fn() },
  };
});

// Mock RPC module — prevents connecting to Solana
vi.mock("../shared/rpc.js", () => ({
  getRpc: vi.fn().mockReturnValue(createMockRpc()),
  getRpcSubscriptions: vi.fn().mockReturnValue({}),
  getLegacyConnection: vi.fn().mockResolvedValue(createMockLegacyConnection()),
}));

// Mock logger to suppress output during tests
vi.mock("../shared/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));
