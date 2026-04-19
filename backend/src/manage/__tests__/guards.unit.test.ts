import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  guardWalletValid,
  guardOpportunityActive,
  guardAdapterExists,
  guardCategoryAllowed,
  guardProgramWhitelist,
} from "../services/guards.js";
import type { OpportunityDetail } from "../../shared/types.js";

function makeOpp(overrides: Partial<OpportunityDetail> = {}): OpportunityDetail {
  return {
    id: 1,
    name: "Test",
    category: "earn",
    tokens: ["USDC"],
    apy_current: 5,
    tvl_usd: 1000000,
    deposit_address: "So11111111111111111111111111111111111111112",
    protocol: { slug: "jupiter", name: "Jupiter", id: 1 },
    is_active: true,
    ...overrides,
  } as OpportunityDetail;
}

describe("guardWalletValid", () => {
  it("accepts valid Solana address", () => {
    expect(() => guardWalletValid("L5pTcaF2fSbe1FwEtkN2KYsf6ayh5utPZbuegRi98RK")).not.toThrow();
  });

  it("rejects empty string", () => {
    expect(() => guardWalletValid("")).toThrow("Invalid Solana wallet");
  });

  it("rejects address with invalid characters", () => {
    expect(() => guardWalletValid("0OIl_invalid_chars")).toThrow();
  });

  it("rejects too-short address", () => {
    expect(() => guardWalletValid("abc")).toThrow();
  });
});

describe("guardOpportunityActive", () => {
  it("passes for active opportunity with deposit address", () => {
    expect(() => guardOpportunityActive(makeOpp(), 1)).not.toThrow();
  });

  it("throws for null opportunity", () => {
    expect(() => guardOpportunityActive(null, 999)).toThrow("not found");
  });

  it("throws for opportunity without deposit address", () => {
    expect(() =>
      guardOpportunityActive(makeOpp({ deposit_address: null }), 1),
    ).toThrow("no deposit address");
  });
});

describe("guardAdapterExists", () => {
  it("passes for known protocol", () => {
    expect(() => guardAdapterExists(makeOpp({ protocol: { slug: "jupiter", name: "Jupiter", id: 1 } }))).not.toThrow();
    expect(() => guardAdapterExists(makeOpp({ protocol: { slug: "kamino", name: "Kamino", id: 2 } }))).not.toThrow();
    expect(() => guardAdapterExists(makeOpp({ protocol: { slug: "drift", name: "Drift", id: 3 } }))).not.toThrow();
  });

  it("throws for unknown protocol", () => {
    expect(() =>
      guardAdapterExists(makeOpp({ protocol: { slug: "unknown", name: "Unknown", id: 99 } })),
    ).toThrow("No adapter");
  });

  it("throws for missing protocol", () => {
    expect(() =>
      guardAdapterExists(makeOpp({ protocol: null })),
    ).toThrow();
  });
});

describe("guardCategoryAllowed", () => {
  const originalEnv = process.env.BLOCKED_CATEGORIES;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BLOCKED_CATEGORIES = originalEnv;
    } else {
      delete process.env.BLOCKED_CATEGORIES;
    }
  });

  it("allows all categories when no blocklist", () => {
    delete process.env.BLOCKED_CATEGORIES;
    expect(() => guardCategoryAllowed(makeOpp({ category: "multiply" }))).not.toThrow();
    expect(() => guardCategoryAllowed(makeOpp({ category: "earn" }))).not.toThrow();
  });

  it("blocks categories in BLOCKED_CATEGORIES", () => {
    process.env.BLOCKED_CATEGORIES = "multiply";
    expect(() => guardCategoryAllowed(makeOpp({ category: "multiply" }))).toThrow("blocked");
    expect(() => guardCategoryAllowed(makeOpp({ category: "earn" }))).not.toThrow();
  });
});

describe("guardProgramWhitelist", () => {
  it("passes for known programs", () => {
    const instructions = [
      { programAddress: "ComputeBudget111111111111111111111111111111", accounts: [], data: "" },
      { programAddress: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", accounts: [], data: "" },
      { programAddress: "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi", accounts: [], data: "" },
      { programAddress: "jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS", accounts: [], data: "" },
    ];
    expect(() => guardProgramWhitelist(instructions)).not.toThrow();
  });

  it("throws for unknown program", () => {
    const instructions = [
      { programAddress: "UNKNOWN_PROGRAM_ADDRESS_NOT_WHITELISTED11111", accounts: [], data: "" },
    ];
    expect(() => guardProgramWhitelist(instructions)).toThrow("Unknown program");
  });

  it("passes for empty instructions", () => {
    expect(() => guardProgramWhitelist([])).not.toThrow();
  });
});
