import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 30_000,
    include: ["src/**/__tests__/**/*.test.ts"],
    retry: 0, // no retries — E2E tests modify on-chain state, retries create orphaned positions
    sequence: { concurrent: false }, // run sequentially to avoid rate limits
  },
});
