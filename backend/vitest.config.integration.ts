import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 15_000,
    include: ["src/**/__tests__/**/*.int.test.ts"],
    retry: 0,
    sequence: { concurrent: false },
    setupFiles: ["src/__tests__/setup.integration.ts"],
    globalSetup: ["src/__tests__/global-setup.ts"],
  },
});
