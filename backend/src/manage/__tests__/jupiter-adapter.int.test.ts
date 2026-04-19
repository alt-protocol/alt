import "dotenv/config";
import { describe, it, expect } from "vitest";
import { getTestWallet, JUICED_USDC_OPP_ID, JUICED_USDT_OPP_ID } from "../../__tests__/helpers.js";
import { discoverService } from "../../discover/service.js";
import { getAdapter } from "../protocols/index.js";
import { getJupiterMultiplyStats } from "../protocols/jupiter.js";
import type { BuildTxResultWithLookups } from "../protocols/types.js";

const wallet = getTestWallet();

describe("Jupiter adapter", () => {
  describe("multiply open", () => {
    it("builds open tx with instructions + ALTs + metadata", async () => {
      const opp = await discoverService.getOpportunityById(JUICED_USDC_OPP_ID);
      expect(opp).toBeTruthy();

      const adapter = await getAdapter("jupiter");
      const result = await adapter!.buildDepositTx({
        walletAddress: wallet.address,
        depositAddress: opp!.deposit_address!,
        amount: "0.1",
        category: "multiply",
        extraData: {
          ...(opp!.extra_data as Record<string, unknown>),
          leverage: 2,
          slippageBps: 200,
        },
      });

      // Should return BuildTxResultWithLookups
      expect(Array.isArray(result)).toBe(false);
      const r = result as BuildTxResultWithLookups;
      expect(r.instructions.length).toBeGreaterThanOrEqual(4); // CU + flash + swap + operate + flash
      expect(r.lookupTableAddresses.length).toBeGreaterThan(0);

      // Should include nftId in metadata
      expect(r.metadata).toBeDefined();
      expect(r.metadata!.nft_id).toBeTypeOf("number");
      expect(r.metadata!.vault_id).toBe(68);
    }, 30_000);

    it("builds JUICED/USDT open tx (different pair)", async () => {
      const opp = await discoverService.getOpportunityById(JUICED_USDT_OPP_ID);
      const adapter = await getAdapter("jupiter");
      const result = await adapter!.buildDepositTx({
        walletAddress: wallet.address,
        depositAddress: opp!.deposit_address!,
        amount: "0.1",
        category: "multiply",
        extraData: {
          ...(opp!.extra_data as Record<string, unknown>),
          leverage: 2,
          slippageBps: 200,
        },
      });

      const r = result as BuildTxResultWithLookups;
      expect(r.instructions.length).toBeGreaterThanOrEqual(4);
      expect(r.metadata?.nft_id).toBeTypeOf("number");
    }, 30_000);

    it("rejects leverage <= 1", async () => {
      const opp = await discoverService.getOpportunityById(JUICED_USDC_OPP_ID);
      const adapter = await getAdapter("jupiter");
      await expect(
        adapter!.buildDepositTx({
          walletAddress: wallet.address,
          depositAddress: opp!.deposit_address!,
          amount: "0.1",
          category: "multiply",
          extraData: { ...(opp!.extra_data as Record<string, unknown>), leverage: 1 },
        }),
      ).rejects.toThrow("Leverage must be > 1");
    }, 10_000);
  });

  describe("multiply close", () => {
    // Uses Jupiter Lend API which has strict rate limits — covered by E2E tests
    it("builds close tx via API client", async () => {
      const opp = await discoverService.getOpportunityById(JUICED_USDC_OPP_ID);
      const adapter = await getAdapter("jupiter");
      // Use a dummy position_id — the API will build instructions regardless
      // (they'll fail on-chain if position doesn't exist, but build should succeed)
      const result = await adapter!.buildWithdrawTx({
        walletAddress: wallet.address,
        depositAddress: opp!.deposit_address!,
        amount: "0",
        category: "multiply",
        extraData: {
          ...(opp!.extra_data as Record<string, unknown>),
          position_id: 1, // any valid number
          isClosingPosition: true,
        },
      });

      const r = result as BuildTxResultWithLookups;
      expect(r.instructions.length).toBeGreaterThanOrEqual(2); // CU + operate
    }, 15_000);

    it("rejects close without position_id", async () => {
      const opp = await discoverService.getOpportunityById(JUICED_USDC_OPP_ID);
      const adapter = await getAdapter("jupiter");
      await expect(
        adapter!.buildWithdrawTx({
          walletAddress: wallet.address,
          depositAddress: opp!.deposit_address!,
          amount: "0",
          category: "multiply",
          extraData: {
            ...(opp!.extra_data as Record<string, unknown>),
            isClosingPosition: true,
            // missing position_id
          },
        }),
      ).rejects.toThrow("Missing position_id");
    }, 10_000);
  });

  describe("multiply manage", () => {
    it.each(["add_collateral", "borrow_more"])(
      "builds deposit-side %s tx",
      async (action) => {
        const opp = await discoverService.getOpportunityById(JUICED_USDC_OPP_ID);
        const adapter = await getAdapter("jupiter");
        const result = await adapter!.buildDepositTx({
          walletAddress: wallet.address,
          depositAddress: opp!.deposit_address!,
          amount: "0.05",
          category: "multiply",
          extraData: { ...(opp!.extra_data as Record<string, unknown>), action, position_id: 1 },
        });
        const r = result as BuildTxResultWithLookups;
        expect(r.instructions.length).toBeGreaterThanOrEqual(2);
      },
      15_000,
    );

    it.each(["withdraw_collateral", "repay_debt"])(
      "builds withdraw-side %s tx",
      async (action) => {
        const opp = await discoverService.getOpportunityById(JUICED_USDC_OPP_ID);
        const adapter = await getAdapter("jupiter");
        const result = await adapter!.buildWithdrawTx({
          walletAddress: wallet.address,
          depositAddress: opp!.deposit_address!,
          amount: "0.05",
          category: "multiply",
          extraData: { ...(opp!.extra_data as Record<string, unknown>), action, position_id: 1 },
        });
        const r = result as BuildTxResultWithLookups;
        expect(r.instructions.length).toBeGreaterThanOrEqual(2);
      },
      15_000,
    );
  });

  describe("getBalance", () => {
    it("returns null for multiply without position_id", async () => {
      const adapter = await getAdapter("jupiter");
      const balance = await adapter!.getBalance!({
        walletAddress: wallet.address,
        depositAddress: "test",
        category: "multiply",
        extraData: { vault_id: 68, supply_token_mint: "test", borrow_token_mint: "test" },
      });
      expect(balance).toBeNull();
    }, 10_000);
  });
});

describe("getJupiterMultiplyStats", () => {
  it("returns null without position_id", async () => {
    const stats = await getJupiterMultiplyStats(wallet.address, {
      vault_id: 68,
      supply_token_mint: "7GxATsNMnaC88vdwd2t3mwrFuQwwGvmYPrUQ4D6FotXk",
      borrow_token_mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
    expect(stats).toBeNull();
  }, 10_000);
});
