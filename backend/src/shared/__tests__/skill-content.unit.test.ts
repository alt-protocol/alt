/**
 * Unit tests for src/shared/skill-content.ts — skill.md content generation.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../constants.js", () => ({
  APP_URL: "https://api.akashi.so",
  FRONTEND_URL: "https://app.akashi.so",
}));

const { getSkillContent } = await import("../skill-content.js");

describe("getSkillContent", () => {
  const content = getSkillContent();

  it("returns a non-empty string", () => {
    expect(typeof content).toBe("string");
    expect(content.length).toBeGreaterThan(100);
  });

  it("includes the APP_URL", () => {
    expect(content).toContain("https://api.akashi.so");
  });

  it("includes the Discover module section", () => {
    expect(content).toContain("/api/discover/yields");
    expect(content).toContain("/api/discover/protocols");
  });

  it("includes the Monitor module section", () => {
    expect(content).toContain("/api/monitor/portfolio");
    expect(content).toContain("analytics");
  });

  it("includes the Manage module section", () => {
    expect(content).toContain("/api/manage/tx/build-deposit");
    expect(content).toContain("/api/manage/tx/submit");
  });

  it("documents the format=assembled parameter", () => {
    expect(content).toContain("format=assembled");
    expect(content).toContain("assembled");
  });

  it("documents all signing methods", () => {
    expect(content).toContain("sign.web");
    expect(content).toContain("sign.deeplink");
    expect(content).toContain("sign.qr");
    expect(content).toContain("sign.action_api");
  });

  it("includes registration endpoint", () => {
    expect(content).toContain("/api/auth/register");
    expect(content).toContain("ak_");
  });

  it("includes non-custodial warning", () => {
    expect(content).toContain("non-custodial");
    expect(content).toContain("unsigned");
  });

  it("includes MCP server reference", () => {
    expect(content).toContain("/api/mcp");
  });

  it("uses /tx/ prefix for balance routes", () => {
    expect(content).toContain("/api/manage/tx/balance");
    expect(content).toContain("/api/manage/tx/wallet-balance");
    expect(content).toContain("/api/manage/tx/withdraw-state");
    expect(content).not.toContain("POST /api/manage/balance\n");
  });

  it("uses snake_case for swap query params", () => {
    expect(content).toContain("input_mint");
    expect(content).toContain("output_mint");
    expect(content).toContain("slippage_bps");
    expect(content).not.toContain("inputMint");
  });
});
