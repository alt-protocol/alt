/**
 * Agent behavior tests — validates tool selection and response patterns.
 *
 * Calls chat() directly (bypasses Telegram) with test prompts.
 * Requires PLATFORM_ANTHROPIC_KEY env var set.
 *
 * Run: npx tsx src/tests/agent-behavior.test.ts
 * Cost: ~$0.005 per full run (5 tests × Haiku)
 */
import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { chat } from "../ai.js";

const SOUL = readFileSync(join(process.cwd(), "SOUL.md"), "utf-8");

function makePrompt(wallet = "TestWallet123"): string {
  return `${SOUL}\n\n## About This User\nUser DB ID: 999\nWallet: ${wallet}\n\n## Context\n- Wallet: ${wallet}. Use this for portfolio/balance tools.\n- When using tools that require user_id, pass 999.\n`;
}

interface TestCase {
  name: string;
  message: string;
  expectTools?: string[];
  expectNoTools?: string[];
  expectNoToolCalls?: boolean;
  expectTextNotContains?: string[];
}

const tests: TestCase[] = [
  {
    name: "Greeting: no tools, no portfolio dump",
    message: "hey",
    expectNoToolCalls: true,
    expectTextNotContains: ["APY", "position", "portfolio"],
  },
  {
    name: "Portfolio overview: calls get_portfolio_analytics",
    message: "how's my portfolio doing?",
    expectTools: ["get_portfolio_analytics"],
    expectNoTools: ["get_portfolio"],
  },
  {
    name: "Position details: calls get_portfolio",
    message: "show me all my positions",
    expectTools: ["get_portfolio"],
  },
  {
    name: "Search yields: calls search_yields",
    message: "what are the best USDC yields right now?",
    expectTools: ["search_yields"],
  },
  {
    name: "Greeting after context: still no tools",
    message: "hi there!",
    expectNoToolCalls: true,
  },
];

async function runTests() {
  if (!process.env.PLATFORM_ANTHROPIC_KEY) {
    console.error("PLATFORM_ANTHROPIC_KEY required. Set it in .env");
    process.exit(1);
  }

  console.log(`Running ${tests.length} agent behavior tests...\n`);
  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    try {
      const result = await chat(
        makePrompt(),
        [{ role: "user", content: t.message }],
        { api_provider: "anthropic", api_key: null, model_id: null, ollama_url: null },
      );

      const toolNames = result.toolCalls.map((tc) => tc.toolName);
      const errors: string[] = [];

      if (t.expectTools) {
        for (const tool of t.expectTools) {
          if (!toolNames.includes(tool))
            errors.push(`Expected tool "${tool}" not called. Got: [${toolNames.join(", ") || "none"}]`);
        }
      }

      if (t.expectNoTools) {
        for (const tool of t.expectNoTools) {
          if (toolNames.includes(tool)) errors.push(`Forbidden tool "${tool}" was called`);
        }
      }

      if (t.expectNoToolCalls && toolNames.length > 0) {
        errors.push(`Expected no tool calls but got: [${toolNames.join(", ")}]`);
      }

      if (t.expectTextNotContains) {
        for (const s of t.expectTextNotContains) {
          if (result.text.toLowerCase().includes(s.toLowerCase()))
            errors.push(`Response contains forbidden word "${s}"`);
        }
      }

      if (errors.length === 0) {
        console.log(`  PASS  ${t.name}`);
        passed++;
      } else {
        console.log(`  FAIL  ${t.name}`);
        for (const e of errors) console.log(`    - ${e}`);
        console.log(`    Response: ${result.text.slice(0, 120)}...`);
        failed++;
      }
    } catch (err) {
      console.log(`  ERROR ${t.name} — ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${tests.length}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
