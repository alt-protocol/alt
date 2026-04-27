/**
 * Unit tests for src/manage/services/sign-options.ts — shared sign options generation.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../shared/constants.js", () => ({
  APP_URL: "https://api.akashi.so",
  FRONTEND_URL: "https://app.akashi.so",
}));

const { generateSignOptions } = await import("../services/sign-options.js");

describe("generateSignOptions", () => {
  it("returns all 4 sign formats", async () => {
    const result = await generateSignOptions("deposit", 1, "100", "11111111111111111111111111111111");

    expect(result).toHaveProperty("web");
    expect(result).toHaveProperty("deeplink");
    expect(result).toHaveProperty("qr");
    expect(result).toHaveProperty("action_api");
  });

  it("web URL points to frontend /sign page", async () => {
    const result = await generateSignOptions("deposit", 1, "100", "11111111111111111111111111111111");
    expect(result.web).toContain("https://app.akashi.so/sign?action=");
  });

  it("deeplink uses solana-action: scheme", async () => {
    const result = await generateSignOptions("deposit", 1, "100", "11111111111111111111111111111111");
    expect(result.deeplink).toMatch(/^solana-action:https:\/\//);
  });

  it("qr is a data URL PNG", async () => {
    const result = await generateSignOptions("deposit", 1, "100", "11111111111111111111111111111111");
    expect(result.qr).toMatch(/^data:image\/png;base64,/);
  });

  it("action_api URL contains correct params", async () => {
    const result = await generateSignOptions("deposit", 42, "50.5", "WalletAddr123456789012345678901234");

    const url = new URL(result.action_api);
    expect(url.pathname).toBe("/api/manage/actions/deposit");
    expect(url.searchParams.get("opportunity_id")).toBe("42");
    expect(url.searchParams.get("amount")).toBe("50.5");
    expect(url.searchParams.get("wallet")).toBe("WalletAddr123456789012345678901234");
  });

  it("includes extra_data params in action URL", async () => {
    const result = await generateSignOptions(
      "deposit", 1, "100", "11111111111111111111111111111111",
      { leverage: 2.5, slippageBps: 200 },
    );

    const url = new URL(result.action_api);
    expect(url.searchParams.get("leverage")).toBe("2.5");
    expect(url.searchParams.get("slippageBps")).toBe("200");
  });

  it("withdraw action produces withdraw URL path", async () => {
    const result = await generateSignOptions("withdraw", 1, "100", "11111111111111111111111111111111");

    const url = new URL(result.action_api);
    expect(url.pathname).toBe("/api/manage/actions/withdraw");
  });
});
