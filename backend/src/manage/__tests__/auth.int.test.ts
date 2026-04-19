/**
 * Integration tests for API key auth on Manage routes.
 * Seeds a real API key in the DB and tests auth enforcement.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { getTestApp, closeTestApp } from "../../__tests__/helpers.js";
import type { FastifyInstance } from "fastify";
import { db } from "../../shared/db.js";
import { apiKeys } from "../db/schema.js";

let app: FastifyInstance;
const TEST_API_KEY = "test-integration-key-12345";
const TEST_KEY_HASH = createHash("sha256").update(TEST_API_KEY).digest("hex");

beforeAll(async () => {
  // Disable the auth bypass
  delete process.env.MANAGE_AUTH_DISABLED;

  app = await getTestApp();

  // Seed an API key (idempotent — skip if already exists)
  await db
    .insert(apiKeys)
    .values({
      key_hash: TEST_KEY_HASH,
      name: "integration-test-key",
      is_active: true,
      rate_limit: 100,
    })
    .onConflictDoNothing();
});

afterAll(async () => {
  await closeTestApp();
});

describe("API key auth", () => {
  it("returns 401 without Authorization header on protected endpoints", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/manage/tx/submit",
      payload: { signed_transaction: "abc" },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toHaveProperty("error", "Missing API key");
  });

  it("returns 401 with invalid API key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/manage/tx/submit",
      headers: { authorization: "Bearer wrong-key" },
      payload: { signed_transaction: "abc" },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toHaveProperty("error", "Invalid API key");
  });

  it("accepts valid API key (may fail downstream but not 401)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/manage/tx/submit",
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { signed_transaction: "abc" },
    });
    // Should not be 401 — auth passed. May be 400/500 due to invalid tx payload.
    expect(res.statusCode).not.toBe(401);
  });
});
