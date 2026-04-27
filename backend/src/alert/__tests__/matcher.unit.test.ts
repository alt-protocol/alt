import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AlertCondition } from "../services/detectors/types.js";

// Mock DB — vi.mock is hoisted, so use vi.fn() directly
vi.mock("../../shared/db.js", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

import { matchConditionsToUsers } from "../services/matcher.js";

function makeCondition(overrides: Partial<AlertCondition> = {}): AlertCondition {
  return {
    ruleSlug: "apy_drop",
    entityKey: "opp:42",
    title: "Test Alert",
    body: "Test body",
    metadata: {},
    detectedValue: 30,
    ...overrides,
  };
}

describe("matchConditionsToUsers", () => {
  it("returns empty array when no conditions", async () => {
    const result = await matchConditionsToUsers([]);
    expect(result).toEqual([]);
  });
});

describe("AlertCondition structure", () => {
  it("apy_drop condition has correct entity key format", () => {
    const condition = makeCondition({ ruleSlug: "apy_drop", entityKey: "opp:42" });
    expect(condition.entityKey.startsWith("opp:")).toBe(true);
    expect(parseInt(condition.entityKey.split(":")[1], 10)).toBe(42);
  });

  it("depeg condition uses token entity key", () => {
    const condition = makeCondition({ ruleSlug: "depeg", entityKey: "token:USDC" });
    expect(condition.entityKey.startsWith("token:")).toBe(true);
  });

  it("new_opportunity has APY as detectedValue", () => {
    const condition = makeCondition({ ruleSlug: "new_opportunity", detectedValue: 11.2 });
    expect(condition.detectedValue).toBe(11.2);
  });

  it("all conditions have required fields", () => {
    const condition = makeCondition();
    expect(condition.ruleSlug).toBeDefined();
    expect(condition.entityKey).toBeDefined();
    expect(condition.title).toBeDefined();
    expect(condition.body).toBeDefined();
    expect(typeof condition.detectedValue).toBe("number");
  });
});
