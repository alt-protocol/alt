/**
 * Integration tests for Discover module routes.
 * Uses real Postgres, seeds test data, tests via app.inject().
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getTestApp, closeTestApp, inject } from "../../__tests__/helpers.js";
import type { FastifyInstance } from "fastify";
import { db } from "../db/connection.js";
import { protocols, yieldOpportunities } from "../db/schema.js";

let app: FastifyInstance;
let protocolId: number;
let oppId: number;

beforeAll(async () => {
  app = await getTestApp();

  // Seed a protocol (idempotent)
  const existingProto = await db
    .select()
    .from(protocols)
    .where(eq(protocols.slug, "test-protocol"))
    .limit(1);

  if (existingProto.length > 0) {
    protocolId = existingProto[0].id;
  } else {
    const [proto] = await db
      .insert(protocols)
      .values({
        slug: "test-protocol",
        name: "Test Protocol",
        description: "For integration testing",
        integration: "full",
      })
      .returning();
    protocolId = proto.id;
  }

  // Seed opportunities (idempotent via onConflictDoNothing on external_id)
  await db
    .insert(yieldOpportunities)
    .values([
      {
        protocol_id: protocolId,
        external_id: "test-earn-usdc",
        name: "Test Earn USDC",
        category: "earn",
        tokens: ["USDC"],
        apy_current: "8.5000",
        tvl_usd: "50000000.00",
        deposit_address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        risk_tier: "low",
        protocol_name: "Test Protocol",
        is_active: true,
      },
      {
        protocol_id: protocolId,
        external_id: "test-multiply-sol",
        name: "Test Multiply SOL/USDC",
        category: "multiply",
        tokens: ["SOL", "USDC"],
        apy_current: "25.0000",
        tvl_usd: "30000000.00",
        deposit_address: "So11111111111111111111111111111111111111112",
        risk_tier: "high",
        protocol_name: "Test Protocol",
        is_active: true,
      },
      {
        protocol_id: protocolId,
        external_id: "test-inactive",
        name: "Inactive Opportunity",
        category: "earn",
        tokens: ["USDT"],
        apy_current: null,
        tvl_usd: null,
        is_active: false,
      },
    ])
    .onConflictDoNothing();

  // Get the seeded opportunity ID for detail tests
  const [opp] = await db
    .select()
    .from(yieldOpportunities)
    .where(eq(yieldOpportunities.external_id, "test-earn-usdc"))
    .limit(1);
  oppId = opp.id;
});

afterAll(async () => {
  await closeTestApp();
});

describe("GET /api/discover/yields", () => {
  it("returns paginated list of active opportunities", async () => {
    const res = await inject(app, "GET", "/api/discover/yields?limit=10");
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.meta).toHaveProperty("total");
    expect(res.body.meta).toHaveProperty("limit", 10);
    expect(res.body.meta).toHaveProperty("offset", 0);
  });

  it("filters by category", async () => {
    const res = await inject(app, "GET", "/api/discover/yields?category=earn");
    expect(res.status).toBe(200);
    for (const item of res.body.data) {
      expect(item.category).toBe("earn");
    }
  });

  it("excludes inactive opportunities", async () => {
    const res = await inject(app, "GET", "/api/discover/yields?limit=500");
    expect(res.status).toBe(200);
    for (const item of res.body.data) {
      expect(item.is_active).toBe(true);
    }
  });

  it("sorts by APY descending by default", async () => {
    const res = await inject(app, "GET", "/api/discover/yields");
    expect(res.status).toBe(200);
    const apys = res.body.data
      .map((d: any) => d.apy_current)
      .filter((a: any) => a !== null);
    for (let i = 1; i < apys.length; i++) {
      expect(apys[i]).toBeLessThanOrEqual(apys[i - 1]);
    }
  });

  it("respects pagination offset", async () => {
    const all = await inject(app, "GET", "/api/discover/yields?limit=100");
    const page2 = await inject(app, "GET", "/api/discover/yields?limit=1&offset=1");
    expect(page2.status).toBe(200);
    if (all.body.data.length > 1) {
      expect(page2.body.data[0].id).toBe(all.body.data[1].id);
    }
  });
});

describe("GET /api/discover/yields/:id", () => {
  it("returns opportunity detail with protocol", async () => {
    const res = await inject(app, "GET", `/api/discover/yields/${oppId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(oppId);
    expect(res.body.name).toBe("Test Earn USDC");
    expect(res.body.protocol).toBeTruthy();
    expect(res.body.protocol.slug).toBe("test-protocol");
    expect(res.body).toHaveProperty("recent_snapshots");
  });

  it("returns 404 for non-existent opportunity", async () => {
    const res = await inject(app, "GET", "/api/discover/yields/999999");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

describe("GET /api/discover/protocols", () => {
  it("returns list of protocols", async () => {
    const res = await inject(app, "GET", "/api/discover/protocols");
    expect(res.status).toBe(200);
    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});
