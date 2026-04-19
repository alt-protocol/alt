/**
 * Vitest global setup for integration tests.
 * Runs drizzle-kit push to ensure test DB schema is up-to-date.
 */
import { execSync } from "node:child_process";

export default function globalSetup() {
  console.log("[global-setup] Pushing DB schema via drizzle-kit...");
  try {
    execSync("npx drizzle-kit push --force", {
      cwd: import.meta.dirname ? import.meta.dirname + "/../.." : process.cwd(),
      stdio: "pipe",
      env: { ...process.env },
    });
    console.log("[global-setup] Schema push complete.");
  } catch (err) {
    console.error("[global-setup] drizzle-kit push failed:", (err as Error).message);
    // Don't throw — schema might already be up-to-date, and integration tests
    // will fail with clearer errors if tables are actually missing.
  }
}
