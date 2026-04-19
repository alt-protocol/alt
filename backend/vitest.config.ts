import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 5_000,
    include: ["src/**/__tests__/**/*.unit.test.ts"],
    sequence: { concurrent: false },
    setupFiles: ["src/__tests__/setup.unit.ts"],
  },
});
