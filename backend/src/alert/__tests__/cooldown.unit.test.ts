import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../shared/db.js", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([{ count: 0 }]),
  },
}));

import { db } from "../../shared/db.js";
import { canDeliver } from "../services/cooldown.js";

describe("canDeliver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows delivery when no recent deliveries exist", async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ count: 0 }]);
    (db as any).select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
      }),
    });

    const result = await canDeliver(1, 1, "opp:42", 24, 1);
    expect(result).toBe(true);
  });

  it("blocks delivery when max_deliveries reached", async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ count: 1 }]);
    (db as any).select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
      }),
    });

    const result = await canDeliver(1, 1, "opp:42", 24, 1);
    expect(result).toBe(false);
  });

  it("blocks when 2 deliveries exist and max is 2", async () => {
    const mockWhere = vi.fn().mockResolvedValue([{ count: 2 }]);
    (db as any).select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: mockWhere,
      }),
    });

    const result = await canDeliver(1, 3, "token:USDC", 4, 2);
    expect(result).toBe(false);
  });

  it("always allows when max_deliveries is 0 (position_liquidated)", async () => {
    // Should not even query the DB
    const result = await canDeliver(1, 7, "pos:wallet:opp", 0, 0);
    expect(result).toBe(true);
  });
});
