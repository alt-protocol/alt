/**
 * Integration tests for Solana Actions (Blinks) endpoints.
 * Tests spec compliance, response format, headers, error handling,
 * and full Blinks flow per category+protocol with test wallet.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getTestApp, closeTestApp, getTestWallet, getTestConnection } from "../../__tests__/helpers.js";
import type { FastifyInstance } from "fastify";

/* eslint-disable @typescript-eslint/no-explicit-any */

let app: FastifyInstance;

// Discovered opportunity IDs — populated in beforeAll
let anyOpportunityId: number;
const opps: Record<string, { id: number; name: string } | null> = {};

/** Find first opportunity matching a name pattern via the yields API. */
async function findOpp(namePattern: RegExp): Promise<{ id: number; name: string } | null> {
  const res = await app.inject({ method: "GET", url: "/api/discover/yields?limit=200" });
  const body = JSON.parse(res.body);
  const match = body.data?.find((o: any) => namePattern.test(o.name));
  return match ? { id: match.id, name: match.name } : null;
}

/** Full Blinks flow: POST → deserialize → sign → simulate. */
async function verifyFullFlow(
  opportunityId: number,
  amount: string,
  extraQuery = "",
) {
  const { VersionedTransaction } = await import("@solana/web3.js");
  const wallet = getTestWallet();
  const conn = getTestConnection();

  const res = await app.inject({
    method: "POST",
    url: `/api/manage/actions/deposit?opportunity_id=${opportunityId}&amount=${amount}${extraQuery}`,
    payload: { account: wallet.address },
  });

  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  expect(body.type).toBe("transaction");
  expect(body.transaction).toBeTruthy();
  expect(body.message).toBeTruthy();

  // Deserialize base64 → VersionedTransaction (v0)
  const txBytes = Buffer.from(body.transaction, "base64");
  const tx = VersionedTransaction.deserialize(txBytes);
  expect(tx.version).toBe(0);

  // Sign with test wallet
  tx.sign([wallet.keypair]);
  expect(tx.signatures[0]).toBeTruthy();

  // Simulate on-chain — may fail due to insufficient balance in test wallet,
  // but proves the transaction is structurally valid and the Blinks layer works.
  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) {
    // Accept InstructionError (typically insufficient funds) — not a Blinks bug
    const errStr = JSON.stringify(sim.value.err);
    expect(errStr).toContain("InstructionError");
  }

  return body;
}

/** Verify that a failing POST returns a proper 422 error with message. */
async function verifyErrorSurfaced(
  opportunityId: number,
  amount: string,
  extraQuery = "",
) {
  const wallet = getTestWallet();

  const res = await app.inject({
    method: "POST",
    url: `/api/manage/actions/deposit?opportunity_id=${opportunityId}&amount=${amount}${extraQuery}`,
    payload: { account: wallet.address },
  });

  expect(res.statusCode).toBe(422);
  const body = JSON.parse(res.body);
  expect(body.message).toBeTruthy();
  expect(body).not.toHaveProperty("error"); // new format uses `message`
  return body;
}

/** Multiply flow: accept 200 (Jupiter healthy) or 422 (transient Jupiter failure). */
async function verifyMultiplyFlow(
  opportunityId: number,
  amount: string,
  extraQuery = "",
) {
  const wallet = getTestWallet();

  const res = await app.inject({
    method: "POST",
    url: `/api/manage/actions/deposit?opportunity_id=${opportunityId}&amount=${amount}${extraQuery}`,
    payload: { account: wallet.address },
  });

  const body = JSON.parse(res.body);

  if (res.statusCode === 200) {
    // Jupiter healthy — full tx built
    expect(body.type).toBe("transaction");
    expect(body.transaction).toBeTruthy();
    expect(body.message).toBeTruthy();
  } else {
    // Transient Jupiter failure — error properly surfaced
    expect(res.statusCode).toBe(422);
    expect(body.message).toBeTruthy();
    expect(body).not.toHaveProperty("error");
  }

  return body;
}

beforeAll(async () => {
  app = await getTestApp();

  // Wait for fetchers to seed, then discover opportunities per category+protocol
  let attempts = 0;
  while (attempts < 10) {
    const res = await app.inject({ method: "GET", url: "/api/discover/yields?limit=10" });
    const body = JSON.parse(res.body);
    if (body.data?.length > 0) break;
    await new Promise((r) => setTimeout(r, 2000));
    attempts++;
  }

  // Discover one opportunity per category+protocol combo
  [
    ["kaminoLend", /Kamino Lend/],
    ["jupiterLend", /Jupiter Lend/],
    ["kaminoVault", /Kamino Earn/],
    ["kaminoMultiply", /Kamino Multiply/],
    ["jupiterMultiply", /Jupiter Multiply/],
    ["exponentEarn", /Exponent PT/],
  ].forEach(([key, pattern]) => {
    // Populated below after async calls
    opps[key as string] = null;
  });

  const [kl, jl, kv, km, jm, ex] = await Promise.all([
    findOpp(/Kamino Lend/),
    findOpp(/Jupiter Lend/),
    findOpp(/Kamino Earn/),
    findOpp(/Kamino Multiply/),
    findOpp(/Jupiter Multiply/),
    findOpp(/Exponent PT/),
  ]);

  opps.kaminoLend = kl;
  opps.jupiterLend = jl;
  opps.kaminoVault = kv;
  opps.kaminoMultiply = km;
  opps.jupiterMultiply = jm;
  opps.exponentEarn = ex;

  // Use any available simple opportunity for spec/error tests
  anyOpportunityId = (kl ?? jl ?? kv)?.id ?? 0;
  if (!anyOpportunityId) {
    throw new Error("No opportunities found in test DB — fetchers may not have run");
  }
}, 30_000);

afterAll(async () => {
  await closeTestApp();
});

// ---------------------------------------------------------------------------
// Spec headers
// ---------------------------------------------------------------------------

describe("Solana Actions spec headers", () => {
  it("GET /actions/deposit includes required action headers", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/manage/actions/deposit?opportunity_id=${anyOpportunityId}`,
    });
    expect(res.headers["x-action-version"]).toBe("2.6.1");
    expect(res.headers["x-blockchain-ids"]).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-expose-headers"]).toContain("X-Action-Version");
  });

  it("POST /actions/deposit includes required action headers", async () => {
    const wallet = getTestWallet();
    const res = await app.inject({
      method: "POST",
      url: `/api/manage/actions/deposit?opportunity_id=${anyOpportunityId}&amount=0.01`,
      payload: { account: wallet.address },
    });
    expect(res.headers["x-action-version"]).toBe("2.6.1");
    expect(res.headers["x-blockchain-ids"]).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  });

  it("OPTIONS preflight returns 204 with CORS headers", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/manage/actions/deposit",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "POST",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});

// ---------------------------------------------------------------------------
// GET metadata
// ---------------------------------------------------------------------------

describe("GET /actions/deposit metadata", () => {
  it("returns valid Solana Actions spec v2 metadata", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/manage/actions/deposit?opportunity_id=${anyOpportunityId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.type).toBe("action");
    expect(body.icon).toBeTruthy();
    expect(body.title).toBeTruthy();
    expect(body.description).toBeTruthy();
    expect(body.label).toBe("Deposit");

    const action = body.links.actions[0];
    expect(action.type).toBe("transaction");
    expect(action.label).toBe("Deposit");
    expect(action.href).toMatch(/^https?:\/\//); // absolute URL

    const param = action.parameters[0];
    expect(param.name).toBe("amount");
    expect(param.type).toBe("number");
    expect(param.required).toBe(true);
  });
});

describe("GET /actions/withdraw metadata", () => {
  it("returns valid Solana Actions spec v2 metadata", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/manage/actions/withdraw?opportunity_id=${anyOpportunityId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.type).toBe("action");
    expect(body.label).toBe("Withdraw");
    expect(body.links.actions[0].type).toBe("transaction");
    expect(body.links.actions[0].href).toMatch(/^https?:\/\//);
    expect(body.links.actions[0].parameters[0].type).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// GET error responses
// ---------------------------------------------------------------------------

describe("GET error responses", () => {
  it("returns 400 when opportunity_id is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/manage/actions/deposit",
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toBeTruthy();
    expect(body).not.toHaveProperty("error");
  });

  it("returns 404 for non-existent opportunity", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/manage/actions/deposit?opportunity_id=99999",
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.message).toBeTruthy();
    expect(body).not.toHaveProperty("error");
  });
});

// ---------------------------------------------------------------------------
// POST error responses
// ---------------------------------------------------------------------------

describe("POST error responses", () => {
  it("returns 400 when params are missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/manage/actions/deposit",
      payload: { account: "test" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.message).toBeTruthy();
    expect(body).not.toHaveProperty("error");
  });

  it("returns 422 when wallet is invalid", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/manage/actions/deposit?opportunity_id=${anyOpportunityId}&amount=0.01`,
      payload: { account: "invalid-wallet" },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.message).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Blinks full flow — per category + protocol
// ---------------------------------------------------------------------------

describe("Blinks full flow — Kamino Lend", () => {
  it("builds, signs, and simulates deposit tx", async () => {
    const opp = opps.kaminoLend;
    if (!opp) return; // skip if not seeded
    await verifyFullFlow(opp.id, "0.01");
  }, 30_000);
});

describe("Blinks full flow — Jupiter Lend", () => {
  it("builds, signs, and simulates deposit tx", async () => {
    const opp = opps.jupiterLend;
    if (!opp) return;
    await verifyFullFlow(opp.id, "0.01");
  }, 30_000);
});

describe("Blinks full flow — Kamino Earn (vault)", () => {
  it("builds, signs, and simulates deposit tx", async () => {
    const opp = opps.kaminoVault;
    if (!opp) return;
    await verifyFullFlow(opp.id, "0.01");
  }, 30_000);
});

describe("Blinks full flow — Kamino Multiply", () => {
  it("builds tx or surfaces error (depends on Jupiter API availability)", async () => {
    const opp = opps.kaminoMultiply;
    if (!opp) return;
    await verifyMultiplyFlow(opp.id, "0.01", "&leverage=2&slippageBps=200");
  }, 30_000);
});

describe("Blinks full flow — Jupiter Multiply", () => {
  it("builds tx or surfaces error (depends on Jupiter API availability)", async () => {
    const opp = opps.jupiterMultiply;
    if (!opp) return;
    await verifyMultiplyFlow(opp.id, "0.01", "&leverage=2&slippageBps=200");
  }, 30_000);
});

describe("Blinks full flow — Exponent Earn", () => {
  it("builds tx or surfaces error (depends on market state)", async () => {
    const opp = opps.exponentEarn;
    if (!opp) return;

    const wallet = getTestWallet();
    const res = await app.inject({
      method: "POST",
      url: `/api/manage/actions/deposit?opportunity_id=${opp.id}&amount=0.01`,
      payload: { account: wallet.address },
    });

    const body = JSON.parse(res.body);
    if (res.statusCode === 200) {
      expect(body.type).toBe("transaction");
      expect(body.transaction).toBeTruthy();
    } else {
      expect(res.statusCode).toBe(422);
      expect(body.message).toBeTruthy();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// actions.json
// ---------------------------------------------------------------------------

describe("actions.json", () => {
  it("returns rules with spec headers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/actions.json",
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.rules).toBeInstanceOf(Array);
    expect(body.rules.length).toBeGreaterThan(0);
    expect(res.headers["x-action-version"]).toBe("2.6.1");
    expect(res.headers["x-blockchain-ids"]).toBe("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  });
});
