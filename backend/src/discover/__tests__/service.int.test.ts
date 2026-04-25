import "dotenv/config";
import { describe, it, expect } from "vitest";
import { discoverService } from "../service.js";

describe("discoverService", () => {
  describe("searchYields", () => {
    it("returns paginated results", async () => {
      const result = await discoverService.searchYields({ limit: 5, offset: 0 });
      expect(result.data.length).toBeLessThanOrEqual(5);
      expect(result.meta.total).toBeGreaterThan(0);
    });

    it("filters by category", async () => {
      const result = await discoverService.searchYields({ category: "multiply", limit: 10 });
      for (const opp of result.data) {
        expect(opp.category).toBe("multiply");
      }
    });

    it("filters by asset_class", async () => {
      const result = await discoverService.searchYields({ asset_class: "stablecoin", limit: 10 });
      expect(result.data.length).toBeGreaterThan(0);
    });

    it("sorts by APY descending", async () => {
      const result = await discoverService.searchYields({ sort: "apy_desc", limit: 5 });
      for (let i = 1; i < result.data.length; i++) {
        expect(result.data[i - 1].apy_current).toBeGreaterThanOrEqual(result.data[i].apy_current ?? 0);
      }
    });

    it("respects pagination offset", async () => {
      const page1 = await discoverService.searchYields({ limit: 2, offset: 0 });
      const page2 = await discoverService.searchYields({ limit: 2, offset: 2 });
      if (page1.data.length >= 2 && page2.data.length >= 1) {
        expect(page1.data[0].id).not.toBe(page2.data[0].id);
      }
    });
  });

  describe("getOpportunityById", () => {
    it("returns opportunity with protocol and extra_data", async () => {
      const { resolveOppId, MARKET_EXTERNAL_IDS } = await import("../../__tests__/helpers.js");
      const oppId = await resolveOppId(MARKET_EXTERNAL_IDS.JUPITER_MULTIPLY_JUICED_USDC);
      const opp = await discoverService.getOpportunityById(oppId);
      expect(opp).toBeTruthy();
      expect(opp!.protocol?.slug).toBe("jupiter");
      expect(opp!.category).toBe("multiply");
      expect(opp!.extra_data).toBeTruthy();
      expect((opp!.extra_data as Record<string, unknown>).vault_id).toBe(68);
    });

    it("returns null for non-existent ID", async () => {
      const opp = await discoverService.getOpportunityById(999999);
      expect(opp).toBeNull();
    });
  });

  describe("getProtocols", () => {
    it("returns seeded protocols", async () => {
      const result = await discoverService.getProtocols();
      expect(result.data.length).toBeGreaterThanOrEqual(3);
      const slugs = result.data.map((p: { slug: string }) => p.slug);
      expect(slugs).toContain("kamino");
      expect(slugs).toContain("jupiter");
      expect(slugs).toContain("drift");
    });
  });
});
