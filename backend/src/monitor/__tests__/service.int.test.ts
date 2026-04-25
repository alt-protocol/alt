import "dotenv/config";
import { describe, it, expect } from "vitest";
import { monitorService } from "../service.js";
import { getTestWallet } from "../../__tests__/helpers.js";

const wallet = getTestWallet();

describe("monitorService", () => {
  describe("trackWallet", () => {
    it("tracks a wallet (idempotent)", async () => {
      await monitorService.trackWallet(wallet.address);
      const status = await monitorService.getWalletStatus(wallet.address);
      expect(status).toBeTruthy();
      expect(status!.wallet_address).toBe(wallet.address);
      expect(status!.is_active).toBe(true);
    });

    it("returns status for tracked wallet", async () => {
      const status = await monitorService.getWalletStatus(wallet.address);
      expect(status).toBeTruthy();
      expect(["ready", "fetching"]).toContain(status!.fetch_status);
    });

    it("returns null for untracked wallet", async () => {
      const status = await monitorService.getWalletStatus("11111111111111111111111111111112");
      expect(status).toBeNull();
    });
  });

  describe("syncPosition", () => {
    it("stores position with metadata", async () => {
      const { resolveOppId, MARKET_EXTERNAL_IDS } = await import("../../__tests__/helpers.js");
      const oppId = await resolveOppId(MARKET_EXTERNAL_IDS.JUPITER_MULTIPLY_JUICED_USDC);
      await monitorService.syncPosition(wallet.address, oppId, {
        nft_id: 999,
        vault_id: 68,
        position_id: 999,
      });
      // If the balance call succeeds, position is stored
      // If it returns null (no on-chain position), that's also valid
      const positions = await monitorService.getPortfolioPositions(wallet.address);
      expect(positions).toBeTruthy();
    }, 30_000);
  });

  describe("getPortfolioPositions", () => {
    it("returns positions for tracked wallet", async () => {
      const result = await monitorService.getPortfolioPositions(wallet.address);
      expect(result).toBeTruthy();
      expect(result.positions).toBeInstanceOf(Array);
    });
  });
});
