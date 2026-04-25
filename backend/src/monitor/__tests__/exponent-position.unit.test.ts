/**
 * Unit tests for the Exponent monitor position fetcher.
 * Mocks RPC calls and DB to test position detection logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock HTTP (RPC calls)
const mockPostJson = vi.fn();
vi.mock("../../shared/http.js", () => ({
  postJson: (...args: any[]) => mockPostJson(...args),
}));

// Mock discover service
vi.mock("../../discover/service.js", () => ({
  discoverService: {
    getOpportunityMap: vi.fn().mockResolvedValue({}),
  },
}));

// Mock DB
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockExecute = vi.fn();

const mockDb = {
  select: () => {
    mockSelect();
    return { from: (t: any) => { mockFrom(); return { where: (w: any) => { mockWhere(); return []; } }; } };
  },
  execute: mockExecute,
} as any;

vi.mock("../db/connection.js", () => ({ db: {} }));

// Mock utils
vi.mock("./utils.js", () => ({
  buildPositionDict: vi.fn((p: any) => ({ ...p })),
  computeHeldDays: vi.fn(() => 5),
  storePositionRows: vi.fn().mockResolvedValue(0),
  loadOpportunityMap: vi.fn().mockResolvedValue({}),
  batchEarliestDeposits: vi.fn().mockResolvedValue({}),
  safeFloat: (v: unknown) => (v != null ? Number(v) : null),
}));

import { snapshotAllWallets } from "../services/exponent-position-fetcher.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

describe("exponent position fetcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 when no wallets tracked", async () => {
    const db = {
      select: () => ({ from: () => ({ where: () => [] }) }),
    } as any;
    const count = await snapshotAllWallets(db);
    expect(count).toBe(0);
  });

  it("returns 0 when no exponent opportunities exist", async () => {
    // loadOpportunityMap is already mocked to return {} at module level
    const db = {
      select: () => ({
        from: () => ({
          where: () => [{ wallet_address: "WALLET1", is_active: true }],
        }),
      }),
    } as any;

    const count = await snapshotAllWallets(db);
    expect(count).toBe(0);
  });
});
