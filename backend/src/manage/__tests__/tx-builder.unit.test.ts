/**
 * Unit tests for src/manage/services/tx-builder.ts — the core tx pipeline.
 * Mock: discoverService, getAdapter, guards.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock discover service
const mockGetOpportunityById = vi.fn();
vi.mock("../../discover/service.js", () => ({
  discoverService: {
    getOpportunityById: (...args: any[]) => mockGetOpportunityById(...args),
  },
}));

// Mock adapter loader
const mockGetAdapter = vi.fn();
const mockHasAdapter = vi.fn().mockReturnValue(true);
vi.mock("../protocols/index.js", () => ({
  getAdapter: (...args: any[]) => mockGetAdapter(...args),
  hasAdapter: (...args: any[]) => mockHasAdapter(...args),
}));

import { buildTransaction } from "../services/tx-builder.js";
import { FIXTURES, TEST_WALLET } from "../../__tests__/fixtures/opportunities.js";
import { mockInstruction } from "../../__tests__/fixtures/instructions.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function createMockAdapter() {
  return {
    buildDepositTx: vi.fn().mockResolvedValue([mockInstruction()]),
    buildWithdrawTx: vi.fn().mockResolvedValue([mockInstruction()]),
    getBalance: vi.fn().mockResolvedValue(null),
  };
}

describe("tx-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MCP_MAX_DEPOSIT_USD;
    delete process.env.STABLECOIN_ONLY;
    delete process.env.BLOCKED_CATEGORIES;
  });

  it("full pipeline: lookup → guards → adapter → serialize → whitelist", async () => {
    const adapter = createMockAdapter();
    mockGetOpportunityById.mockResolvedValue(FIXTURES.jupiterEarnUSDC);
    mockGetAdapter.mockResolvedValue(adapter);

    const result = await buildTransaction(
      { opportunity_id: 1, wallet_address: TEST_WALLET, amount: "100" },
      "deposit",
    );

    // Verify cross-module read
    expect(mockGetOpportunityById).toHaveBeenCalledWith(1);
    // Verify adapter loaded for correct protocol
    expect(mockGetAdapter).toHaveBeenCalledWith("jupiter");
    // Verify adapter.buildDepositTx was called
    expect(adapter.buildDepositTx).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: TEST_WALLET,
        amount: "100",
        category: "earn",
      }),
    );
    // Result has serialized instructions
    expect(result.instructions).toHaveLength(1);
    expect(typeof result.instructions[0].programAddress).toBe("string");
    expect(typeof result.instructions[0].data).toBe("string"); // base64
  });

  it("calls withdraw adapter for action=withdraw", async () => {
    const adapter = createMockAdapter();
    mockGetOpportunityById.mockResolvedValue(FIXTURES.jupiterEarnUSDC);
    mockGetAdapter.mockResolvedValue(adapter);

    await buildTransaction(
      { opportunity_id: 1, wallet_address: TEST_WALLET, amount: "50" },
      "withdraw",
    );

    expect(adapter.buildWithdrawTx).toHaveBeenCalled();
    expect(adapter.buildDepositTx).not.toHaveBeenCalled();
  });

  it("merges opportunity extra_data with client extra_data (client wins)", async () => {
    const adapter = createMockAdapter();
    const opp = {
      ...FIXTURES.kaminoMultiplySOL,
      extra_data: { market_address: "original", leverage: 3 },
    };
    mockGetOpportunityById.mockResolvedValue(opp);
    mockGetAdapter.mockResolvedValue(adapter);

    await buildTransaction(
      {
        opportunity_id: 3,
        wallet_address: TEST_WALLET,
        amount: "10",
        extra_data: { leverage: 5, slippageBps: 100 },
      },
      "deposit",
    );

    const callArgs = adapter.buildDepositTx.mock.calls[0][0];
    expect(callArgs.extraData).toEqual({
      market_address: "original",
      leverage: 5, // client override
      slippageBps: 100, // client addition
    });
  });

  it("throws 404 when opportunity not found", async () => {
    mockGetOpportunityById.mockResolvedValue(null);

    await expect(
      buildTransaction(
        { opportunity_id: 999, wallet_address: TEST_WALLET, amount: "100" },
        "deposit",
      ),
    ).rejects.toThrow("not found");
  });

  it("throws when opportunity has no deposit address", async () => {
    mockGetOpportunityById.mockResolvedValue(FIXTURES.inactiveOpportunity);

    await expect(
      buildTransaction(
        { opportunity_id: 99, wallet_address: TEST_WALLET, amount: "100" },
        "deposit",
      ),
    ).rejects.toThrow("no deposit address");
  });

  it("throws when protocol has no adapter", async () => {
    mockGetOpportunityById.mockResolvedValue(FIXTURES.unknownProtocol);
    mockHasAdapter.mockReturnValueOnce(false);

    await expect(
      buildTransaction(
        { opportunity_id: 100, wallet_address: TEST_WALLET, amount: "100" },
        "deposit",
      ),
    ).rejects.toThrow(/No adapter/);
  });

  it("throws when adapter fails to load", async () => {
    mockGetOpportunityById.mockResolvedValue(FIXTURES.jupiterEarnUSDC);
    mockGetAdapter.mockResolvedValue(null);

    await expect(
      buildTransaction(
        { opportunity_id: 1, wallet_address: TEST_WALLET, amount: "100" },
        "deposit",
      ),
    ).rejects.toThrow(/failed to load/);
  });

  it("throws on invalid wallet address", async () => {
    await expect(
      buildTransaction(
        { opportunity_id: 1, wallet_address: "invalid!", amount: "100" },
        "deposit",
      ),
    ).rejects.toThrow("Invalid Solana wallet address");
  });

  it("throws when deposit limit exceeded", async () => {
    process.env.MCP_MAX_DEPOSIT_USD = "50";
    mockGetOpportunityById.mockResolvedValue(FIXTURES.jupiterEarnUSDC);

    await expect(
      buildTransaction(
        { opportunity_id: 1, wallet_address: TEST_WALLET, amount: "100" },
        "deposit",
      ),
    ).rejects.toThrow("exceeds maximum deposit limit");
  });

  it("throws when category is blocked", async () => {
    process.env.BLOCKED_CATEGORIES = "multiply";
    mockGetOpportunityById.mockResolvedValue(FIXTURES.kaminoMultiplySOL);
    mockGetAdapter.mockResolvedValue(createMockAdapter());

    await expect(
      buildTransaction(
        { opportunity_id: 3, wallet_address: TEST_WALLET, amount: "10" },
        "deposit",
      ),
    ).rejects.toThrow("blocked");
  });
});
