import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB connection before importing detectors
vi.mock("../../shared/db.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    innerJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
  },
}));

import { db } from "../../shared/db.js";
import { detectApyChanges } from "../services/detectors/apy.js";
import { detectDepegEvents } from "../services/detectors/depeg.js";
import { detectNewOpportunities } from "../services/detectors/new-opportunity.js";

describe("APY detector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects APY drop when current < 30d avg", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 1, name: "Kamino Earn USDC", apy_current: "3.2", apy_30d_avg: "5.1", protocol_name: "Kamino" },
        ]),
      }),
    });
    (db as any).select = mockSelect;

    const conditions = await detectApyChanges();

    expect(conditions).toHaveLength(1);
    expect(conditions[0].ruleSlug).toBe("apy_drop");
    expect(conditions[0].entityKey).toBe("opp:1");
    expect(conditions[0].detectedValue).toBeCloseTo(37.25, 0);
    expect(conditions[0].title).toContain("APY Drop");
  });

  it("detects APY spike when current > 30d avg", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 2, name: "Jupiter JUICED/USDC", apy_current: "12.6", apy_30d_avg: "8.8", protocol_name: "Jupiter" },
        ]),
      }),
    });
    (db as any).select = mockSelect;

    const conditions = await detectApyChanges();

    expect(conditions).toHaveLength(1);
    expect(conditions[0].ruleSlug).toBe("apy_spike");
    expect(conditions[0].detectedValue).toBeCloseTo(43.18, 0);
  });

  it("skips opportunities with no 30d avg", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 3, name: "New Opp", apy_current: "5.0", apy_30d_avg: null, protocol_name: "Test" },
        ]),
      }),
    });
    (db as any).select = mockSelect;

    const conditions = await detectApyChanges();
    expect(conditions).toHaveLength(0);
  });

  it("skips opportunities with zero 30d avg", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: 4, name: "Zero Avg", apy_current: "5.0", apy_30d_avg: "0", protocol_name: "Test" },
        ]),
      }),
    });
    (db as any).select = mockSelect;

    const conditions = await detectApyChanges();
    expect(conditions).toHaveLength(0);
  });
});

describe("Depeg detector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects depeg for fixed-peg stablecoins", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue([
        { symbol: "USDC", price_current: "0.994", peg_target: "1.0", peg_type: "fixed" },
      ]),
    });
    (db as any).select = mockSelect;

    const conditions = await detectDepegEvents();

    expect(conditions).toHaveLength(1);
    expect(conditions[0].ruleSlug).toBe("depeg");
    expect(conditions[0].entityKey).toBe("token:USDC");
    expect(conditions[0].detectedValue).toBeCloseTo(60, 0);
  });

  it("skips yield-bearing stablecoins", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue([
        { symbol: "JUICED", price_current: "1.05", peg_target: "1.0", peg_type: "yield_bearing" },
      ]),
    });
    (db as any).select = mockSelect;

    const conditions = await detectDepegEvents();
    expect(conditions).toHaveLength(0);
  });

  it("skips tiny deviations under 10 bps", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue([
        { symbol: "USDC", price_current: "0.9999", peg_target: "1.0", peg_type: "fixed" },
      ]),
    });
    (db as any).select = mockSelect;

    const conditions = await detectDepegEvents();
    expect(conditions).toHaveLength(0);
  });
});

describe("New opportunity detector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects new opportunities created recently", async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          {
            id: 99, name: "Drift Earn USDT", apy_current: "11.2",
            tvl_usd: "5000000", protocol_name: "Drift",
            category: "earn", tokens: ["USDT"],
            created_at: new Date(),
          },
        ]),
      }),
    });
    (db as any).select = mockSelect;

    const conditions = await detectNewOpportunities();

    expect(conditions).toHaveLength(1);
    expect(conditions[0].ruleSlug).toBe("new_opportunity");
    expect(conditions[0].detectedValue).toBeCloseTo(11.2);
  });
});
