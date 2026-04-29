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

  it("uses agent-optimized endpoints", () => {
    expect(content).toContain("/api/agent/yields");
    expect(content).toContain("/api/agent/deposit-link");
    expect(content).toContain("/api/agent/withdraw-link");
    expect(content).toContain("/api/agent/portfolio");
  });

  it("documents the sign_url flow", () => {
    expect(content).toContain("sign_url");
    expect(content).toContain("connect their wallet");
  });

  it("includes non-custodial description", () => {
    expect(content).toContain("Non-custodial");
    expect(content).toContain("unsigned");
  });

  it("mentions the next field", () => {
    expect(content).toContain("next");
  });
});
