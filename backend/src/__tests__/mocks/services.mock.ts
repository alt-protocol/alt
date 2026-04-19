import { vi } from "vitest";
import type { OpportunityDetail } from "../../shared/types.js";
import type { ProtocolAdapter, BuildTxResult } from "../../manage/protocols/types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Mock discoverService for cross-module reads in Manage/Monitor. */
export function createMockDiscoverService() {
  return {
    getOpportunityById: vi.fn().mockResolvedValue(null as OpportunityDetail | null),
    searchYields: vi.fn().mockResolvedValue({ data: [], meta: { total: 0, limit: 100, offset: 0 } }),
    getProtocols: vi.fn().mockResolvedValue({ data: [] }),
    getOpportunityMap: vi.fn().mockResolvedValue(new Map()),
  };
}

/** Mock protocol adapter (Jupiter, Kamino, Drift). */
export function createMockAdapter(overrides?: Partial<ProtocolAdapter>): ProtocolAdapter {
  const mockInstruction = {
    programAddress: "ComputeBudget111111111111111111111111111111" as any,
    accounts: [] as any[],
    data: new Uint8Array([1, 0, 0, 0]),
  };

  return {
    buildDepositTx: vi.fn().mockResolvedValue([mockInstruction] as BuildTxResult),
    buildWithdrawTx: vi.fn().mockResolvedValue([mockInstruction] as BuildTxResult),
    getBalance: vi.fn().mockResolvedValue(null),
    getWithdrawState: vi.fn().mockResolvedValue({ status: "none" as const }),
    ...overrides,
  };
}
