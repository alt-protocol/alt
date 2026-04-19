/**
 * Load testing script for Akashi backend.
 *
 * Usage: npm run test:perf
 * Requires: backend running on localhost:8001
 *
 * Tests API endpoints under load and reports p99 latency + throughput.
 * Exits with non-zero if any endpoint fails its p99 budget.
 */
import autocannon from "autocannon";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8001";

interface Scenario {
  name: string;
  url: string;
  method?: "GET" | "POST";
  body?: string;
  connections: number;
  duration: number;
  p99Budget: number; // ms
  rpsBudget: number; // requests per second
}

const TEST_WALLET = "11111111111111111111111111111112";

const scenarios: Scenario[] = [
  // --- Discover (read-heavy, most traffic) ---
  {
    name: "Discover — GET /yields (paginated list)",
    url: `${BASE_URL}/api/discover/yields?limit=20`,
    connections: 100,
    duration: 30,
    p99Budget: 200,
    rpsBudget: 500,
  },
  {
    name: "Discover — GET /yields/:id (single item)",
    url: `${BASE_URL}/api/discover/yields/1`,
    connections: 50,
    duration: 15,
    p99Budget: 100,
    rpsBudget: 500,
  },
  {
    name: "Discover — GET /protocols",
    url: `${BASE_URL}/api/discover/protocols`,
    connections: 50,
    duration: 15,
    p99Budget: 100,
    rpsBudget: 1000,
  },
  // --- Manage (compute-heavy, lower volume) ---
  {
    name: "Manage — POST /tx/build-deposit (tx building)",
    url: `${BASE_URL}/api/manage/tx/build-deposit`,
    method: "POST",
    body: JSON.stringify({
      opportunity_id: 1,
      wallet_address: TEST_WALLET,
      amount: "1",
    }),
    connections: 10,
    duration: 15,
    p99Budget: 3000, // tx building involves SDK calls
    rpsBudget: 10,
  },
  {
    name: "Manage — POST /wallet-balance (balance lookup)",
    url: `${BASE_URL}/api/manage/wallet-balance`,
    method: "POST",
    body: JSON.stringify({
      wallet_address: TEST_WALLET,
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    }),
    connections: 20,
    duration: 15,
    p99Budget: 2000,
    rpsBudget: 20,
  },
  // --- Monitor (DB-heavy joins) ---
  {
    name: "Monitor — POST /portfolio/:wallet/track",
    url: `${BASE_URL}/api/monitor/portfolio/${TEST_WALLET}/track`,
    method: "POST",
    connections: 20,
    duration: 15,
    p99Budget: 1000,
    rpsBudget: 50,
  },
  {
    name: "Monitor — GET /portfolio/:wallet/status",
    url: `${BASE_URL}/api/monitor/portfolio/${TEST_WALLET}/status`,
    connections: 50,
    duration: 15,
    p99Budget: 200,
    rpsBudget: 300,
  },
  // --- Health check baseline ---
  {
    name: "Health — GET /api/health (baseline)",
    url: `${BASE_URL}/api/health`,
    connections: 50,
    duration: 10,
    p99Budget: 50,
    rpsBudget: 2000,
  },
];

async function runScenario(scenario: Scenario): Promise<boolean> {
  console.log(`\n--- ${scenario.name} ---`);
  console.log(
    `  ${scenario.connections} connections, ${scenario.duration}s, ` +
      `p99 budget: ${scenario.p99Budget}ms, RPS budget: ${scenario.rpsBudget}`,
  );

  const result = await autocannon({
    url: scenario.url,
    method: scenario.method ?? "GET",
    body: scenario.body,
    connections: scenario.connections,
    duration: scenario.duration,
    headers: {
      "Content-Type": "application/json",
    },
  });

  const p99 = result.latency.p99;
  const rps = result.requests.average;
  const errors = result.errors;
  const timeouts = result.timeouts;

  const p99Pass = p99 <= scenario.p99Budget;
  const rpsPass = rps >= scenario.rpsBudget;

  console.log(`  Results:`);
  console.log(`    p50:     ${result.latency.p50}ms`);
  console.log(`    p99:     ${p99}ms ${p99Pass ? "PASS" : "FAIL"} (budget: ${scenario.p99Budget}ms)`);
  console.log(`    avg RPS: ${rps} ${rpsPass ? "PASS" : "FAIL"} (budget: ${scenario.rpsBudget})`);
  console.log(`    total:   ${result.requests.total} requests`);
  console.log(`    errors:  ${errors}, timeouts: ${timeouts}`);

  if (!p99Pass) console.log(`  ** p99 EXCEEDED: ${p99}ms > ${scenario.p99Budget}ms`);
  if (!rpsPass) console.log(`  ** RPS BELOW TARGET: ${rps} < ${scenario.rpsBudget}`);

  return p99Pass; // Only fail on p99 budget breach
}

async function main() {
  console.log(`Load testing ${BASE_URL}`);
  console.log(`Scenarios: ${scenarios.length}`);

  // Verify server is up
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (!res.ok) throw new Error(`Health check returned ${res.status}`);
    console.log("Health check: OK");
  } catch (err) {
    console.error(`Server not reachable at ${BASE_URL}. Start it with: npm run dev`);
    process.exit(1);
  }

  let allPass = true;
  for (const scenario of scenarios) {
    const pass = await runScenario(scenario);
    if (!pass) allPass = false;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(allPass ? "ALL SCENARIOS PASSED" : "SOME SCENARIOS FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("Load test error:", err);
  process.exit(1);
});
