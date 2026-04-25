import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../server.js";

// ---------------------------------------------------------------------------
// Setup: in-process MCP client ↔ server via InMemoryTransport
// ---------------------------------------------------------------------------

let client: Client;
let clientTransport: InstanceType<typeof InMemoryTransport>;
let serverTransport: InstanceType<typeof InMemoryTransport>;

beforeAll(async () => {
  [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = createMcpServer({ bearerToken: null, agentId: "test" });
  await server.connect(serverTransport);

  client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await clientTransport.close();
  await serverTransport.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DUMMY_WALLET = "11111111111111111111111111111111";
const BAD_OPPORTUNITY_ID = 99999;
const FAKE_MINT_1 = "FakeMint11111111111111111111111111111111111";
const FAKE_MINT_2 = "FakeMint22222222222222222222222222222222222";

/** Call a tool and parse the JSON text content from the response. */
async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
  return {
    parsed: text ? JSON.parse(text) : null,
    isError: result.isError ?? false,
  };
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

describe("MCP Server — tool registration", () => {
  it("lists all 14 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(14);
  });

  it("every tool has a description", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description).toBeTruthy();
    }
  });

  it("has all expected tool names", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "build_deposit_tx",
      "build_withdraw_tx",
      "get_balance",
      "get_portfolio",
      "get_position_events",
      "get_position_history",
      "get_protocols",
      "get_wallet_balances",
      "get_withdraw_state",
      "get_yield_details",
      "get_yield_history",
      "search_yields",
      "submit_transaction",
      "swap",
      "track_wallet",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Discover Tools
// ---------------------------------------------------------------------------

describe("Discover tools", () => {
  it("search_yields — returns data array and meta", async () => {
    const { parsed, isError } = await callTool("search_yields", { limit: 3 });
    expect(isError).toBe(false);
    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("meta");
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data.length).toBeLessThanOrEqual(3);
  });

  it("search_yields — respects limit param", async () => {
    const { parsed } = await callTool("search_yields", { limit: 1 });
    expect(parsed.data.length).toBeLessThanOrEqual(1);
  });

  it("get_yield_details — returns error for non-existent ID", async () => {
    const { parsed, isError } = await callTool("get_yield_details", {
      opportunity_id: BAD_OPPORTUNITY_ID,
    });
    expect(isError).toBe(true);
    expect(parsed).toHaveProperty("error");
  });

  it("get_yield_history — returns error for non-existent ID", async () => {
    const { parsed, isError } = await callTool("get_yield_history", {
      opportunity_id: BAD_OPPORTUNITY_ID,
    });
    expect(isError).toBe(true);
    expect(parsed).toHaveProperty("error");
  });

  it("get_protocols — returns protocol list", async () => {
    const { parsed, isError } = await callTool("get_protocols");
    expect(isError).toBe(false);
    expect(parsed).toHaveProperty("data");
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data.length).toBeGreaterThan(0);
    expect(parsed.data[0]).toHaveProperty("slug");
    expect(parsed.data[0]).toHaveProperty("name");
  });
});

// ---------------------------------------------------------------------------
// Monitor Tools
// ---------------------------------------------------------------------------

describe("Monitor tools", () => {
  it("track_wallet — registers wallet and returns status", async () => {
    const { parsed, isError } = await callTool("track_wallet", {
      wallet_address: DUMMY_WALLET,
    });
    expect(isError).toBe(false);
    expect(parsed).toHaveProperty("wallet");
    expect(parsed).toHaveProperty("wallet_address");
  });

  it("get_portfolio — returns response structure", async () => {
    const { parsed, isError } = await callTool("get_portfolio", {
      wallet_address: DUMMY_WALLET,
    });
    expect(isError).toBe(false);
    // Should have wallet + either positions/summary or fetching status
    expect(parsed).toHaveProperty("wallet");
  });

  it("get_wallet_balances — returns token array", async () => {
    const { parsed, isError } = await callTool("get_wallet_balances", {
      wallet_address: DUMMY_WALLET,
    });
    expect(isError).toBe(false);
    expect(parsed).toHaveProperty("positions");
    expect(Array.isArray(parsed.positions)).toBe(true);
  });

  it("get_position_history — returns data array", async () => {
    const { parsed, isError } = await callTool("get_position_history", {
      wallet_address: DUMMY_WALLET,
    });
    expect(isError).toBe(false);
    expect(parsed).toHaveProperty("data");
    expect(Array.isArray(parsed.data)).toBe(true);
  });

  it("get_position_events — returns data array", async () => {
    const { parsed, isError } = await callTool("get_position_events", {
      wallet_address: DUMMY_WALLET,
    });
    expect(isError).toBe(false);
    expect(parsed).toHaveProperty("data");
    expect(Array.isArray(parsed.data)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Manage Tools
// ---------------------------------------------------------------------------

describe("Manage tools", () => {
  it("get_balance — returns error for non-existent opportunity", async () => {
    const { parsed, isError } = await callTool("get_balance", {
      opportunity_id: BAD_OPPORTUNITY_ID,
      wallet_address: DUMMY_WALLET,
    });
    expect(isError).toBe(true);
    expect(parsed).toHaveProperty("error");
  });

  it("get_withdraw_state — returns error for non-existent opportunity", async () => {
    const { parsed, isError } = await callTool("get_withdraw_state", {
      opportunity_id: BAD_OPPORTUNITY_ID,
      wallet_address: DUMMY_WALLET,
    });
    expect(isError).toBe(true);
    expect(parsed).toHaveProperty("error");
  });

  it("swap — handles invalid mints gracefully (quote_only)", async () => {
    const { parsed, isError } = await callTool("swap", {
      wallet_address: DUMMY_WALLET,
      input_mint: "FakeMint11111111111111111111111111111111111",
      output_mint: "FakeMint22222222222222222222222222222222222",
      amount: "1000000",
      quote_only: true,
    });
    expect(isError).toBe(true);
    expect(parsed).toHaveProperty("error");
  });

  it("build_deposit_tx — returns error for non-existent opportunity", async () => {
    const { parsed, isError } = await callTool("build_deposit_tx", {
      opportunity_id: BAD_OPPORTUNITY_ID,
      wallet_address: DUMMY_WALLET,
      amount: "100",
    });
    expect(isError).toBe(true);
    expect(parsed).toHaveProperty("error");
  });

  it("build_withdraw_tx — returns error for non-existent opportunity", async () => {
    const { parsed, isError } = await callTool("build_withdraw_tx", {
      opportunity_id: BAD_OPPORTUNITY_ID,
      wallet_address: DUMMY_WALLET,
      amount: "100",
    });
    expect(isError).toBe(true);
    expect(parsed).toHaveProperty("error");
  });

  it("swap — handles invalid params gracefully (build)", async () => {
    const { parsed, isError } = await callTool("swap", {
      wallet_address: DUMMY_WALLET,
      input_mint: "FakeMint11111111111111111111111111111111111",
      output_mint: "FakeMint22222222222222222222222222222222222",
      amount: "1000000",
    });
    expect(isError).toBe(true);
    expect(parsed).toHaveProperty("error");
  });

  it("submit_transaction — returns error for invalid transaction", async () => {
    const { parsed, isError } = await callTool("submit_transaction", {
      signed_transaction: "aW52YWxpZA==", // base64 "invalid"
    });
    expect(isError).toBe(true);
    expect(parsed).toHaveProperty("error");
  });
});
