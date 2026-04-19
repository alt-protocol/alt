import { vi } from "vitest";

/**
 * Create mock implementations for src/shared/http.ts functions.
 * Use with vi.mock("../../shared/http.js", () => createMockHttp())
 * or import and configure per-test via vi.mocked().
 */
export function createMockHttp() {
  return {
    getWithRetry: vi.fn().mockResolvedValue({}),
    getOrNull: vi.fn().mockResolvedValue(null),
    postJson: vi.fn().mockResolvedValue({}),
    jupiterHeaders: vi.fn().mockReturnValue({}),
  };
}
