#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_URL = process.env.AKASHI_API_URL ?? "http://localhost:8001";
const API_KEY = process.env.AKASHI_API_KEY ?? "";

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function apiGet(path: string): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${path} — ${body}`);
  }
  return res.json();
}

async function apiPost(path: string, body: unknown, auth = false): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth && API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${path} — ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: "akashi", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

// --- Discover tools ---

server.tool(
  "list_opportunities",
  "List Solana yield opportunities (stablecoin vaults, lending, earn). Returns APY, TVL, protocol, and category for each.",
  {
    category: z.string().optional().describe("Filter by category: lending, vault, earn, multiply, insurance_fund"),
    sort: z.enum(["apy_desc", "apy_asc", "tvl_desc", "tvl_asc"]).optional().describe("Sort order (default: apy_desc)"),
    stablecoins_only: z.boolean().optional().describe("Only show stablecoin opportunities"),
    limit: z.number().int().min(1).max(100).optional().describe("Max results (default: 20)"),
  },
  async ({ category, sort, stablecoins_only, limit }) => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (sort) params.set("sort", sort);
    if (stablecoins_only) params.set("stablecoins_only", "true");
    params.set("limit", String(limit ?? 20));

    const qs = params.toString();
    const data = await apiGet(`/api/discover/yields${qs ? `?${qs}` : ""}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "get_opportunity_details",
  "Get detailed information about a specific yield opportunity including APY history, deposit address, and protocol details.",
  {
    id: z.number().int().positive().describe("Opportunity ID"),
  },
  async ({ id }) => {
    const data = await apiGet(`/api/discover/yields/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// --- Monitor tools ---

server.tool(
  "get_wallet_balance",
  "Get SPL token balances for a Solana wallet address.",
  {
    wallet_address: z.string().describe("Solana wallet address"),
  },
  async ({ wallet_address }) => {
    const data = await apiGet(`/api/monitor/portfolio/${wallet_address}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "get_positions",
  "Get tracked DeFi positions for a wallet — deposit amounts, PnL, APY, and protocol details.",
  {
    wallet_address: z.string().describe("Solana wallet address"),
    protocol: z.string().optional().describe("Filter by protocol slug (kamino, drift, jupiter)"),
  },
  async ({ wallet_address, protocol }) => {
    const params = new URLSearchParams();
    if (protocol) params.set("protocol", protocol);
    const qs = params.toString();

    // Trigger position tracking (fire-and-forget)
    apiPost(`/api/monitor/portfolio/${wallet_address}/track`, {}).catch(() => {});

    const data = await apiGet(`/api/monitor/portfolio/${wallet_address}/positions${qs ? `?${qs}` : ""}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// --- Manage tools ---

server.tool(
  "build_deposit",
  "Build an unsigned deposit transaction for a yield opportunity. Returns serialized instructions and a simulation preview. The transaction must be signed locally before submitting.",
  {
    opportunity_id: z.number().int().positive().describe("Yield opportunity ID"),
    wallet_address: z.string().describe("Depositor's Solana wallet address"),
    amount: z.string().describe("Deposit amount as a decimal string (e.g. '100.5')"),
  },
  async ({ opportunity_id, wallet_address, amount }) => {
    const data = await apiPost("/api/manage/tx/build-deposit", {
      opportunity_id,
      wallet_address,
      amount,
      simulate: true,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "build_withdraw",
  "Build an unsigned withdrawal transaction for a yield opportunity. Returns serialized instructions and a simulation preview. The transaction must be signed locally before submitting.",
  {
    opportunity_id: z.number().int().positive().describe("Yield opportunity ID"),
    wallet_address: z.string().describe("Depositor's Solana wallet address"),
    amount: z.string().describe("Withdrawal amount as a decimal string (e.g. '50.0')"),
  },
  async ({ opportunity_id, wallet_address, amount }) => {
    const data = await apiPost("/api/manage/tx/build-withdraw", {
      opportunity_id,
      wallet_address,
      amount,
      simulate: true,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

server.tool(
  "submit_transaction",
  "Submit a signed Solana transaction to the network via Helius RPC. Returns the transaction signature.",
  {
    signed_transaction: z.string().describe("Base64-encoded signed transaction bytes"),
  },
  async ({ signed_transaction }) => {
    const data = await apiPost("/api/manage/tx/submit", { signed_transaction }, true);
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Akashi MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
