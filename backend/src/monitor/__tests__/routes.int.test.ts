/**
 * Integration tests for Monitor module routes.
 * Uses real Postgres, tests wallet tracking and position queries.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestApp, closeTestApp, inject } from "../../__tests__/helpers.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

// A valid Solana wallet address (system program) for testing
const TEST_WALLET = "11111111111111111111111111111112";

beforeAll(async () => {
  app = await getTestApp();
});

afterAll(async () => {
  await closeTestApp();
});

describe("POST /api/monitor/portfolio/:wallet/track", () => {
  it("creates wallet tracking entry and returns positions", async () => {
    const res = await inject(
      app,
      "POST",
      `/api/monitor/portfolio/${TEST_WALLET}/track`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("wallet", TEST_WALLET);
  });

  it("is idempotent (tracks same wallet twice)", async () => {
    const res1 = await inject(
      app,
      "POST",
      `/api/monitor/portfolio/${TEST_WALLET}/track`,
    );
    const res2 = await inject(
      app,
      "POST",
      `/api/monitor/portfolio/${TEST_WALLET}/track`,
    );
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});

describe("GET /api/monitor/portfolio/:wallet/status", () => {
  it("returns wallet status for tracked wallet", async () => {
    // Ensure wallet is tracked first
    await inject(app, "POST", `/api/monitor/portfolio/${TEST_WALLET}/track`);

    const res = await inject(
      app,
      "GET",
      `/api/monitor/portfolio/${TEST_WALLET}/status`,
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("wallet_address", TEST_WALLET);
    expect(res.body).toHaveProperty("fetch_status");
  });

  it("returns 404 for untracked wallet", async () => {
    // Use a valid base58 address that is not tracked
    const res = await inject(
      app,
      "GET",
      "/api/monitor/portfolio/7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV/status",
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/monitor/portfolio/:wallet/positions", () => {
  it("returns positions for tracked wallet", async () => {
    await inject(app, "POST", `/api/monitor/portfolio/${TEST_WALLET}/track`);

    const res = await inject(
      app,
      "GET",
      `/api/monitor/portfolio/${TEST_WALLET}/positions`,
    );
    expect(res.status).toBe(200);
    // Response is an array of positions (may be empty for test wallet)
    expect(res.body).toBeInstanceOf(Array);
  });
});
