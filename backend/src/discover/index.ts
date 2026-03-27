import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db } from "./db/connection.js";
import { protocols } from "./db/schema.js";
import { logger } from "../shared/logger.js";
import { yieldsRoutes } from "./routes/yields.js";
import { protocolsRoutes } from "./routes/protocols.js";
import { startScheduler, stopScheduler } from "./scheduler.js";

// ---------------------------------------------------------------------------
// Seed protocols (idempotent)
// ---------------------------------------------------------------------------

const SEED_PROTOCOLS = [
  {
    slug: "kamino",
    name: "Kamino",
    description:
      "Automated liquidity management and lending vaults on Solana.",
    website_url: "https://kamino.finance",
    audit_status: "audited",
    auditors: ["OtterSec", "Halborn"],
    integration: "full",
  },
  {
    slug: "drift",
    name: "Drift Protocol",
    description:
      "Decentralized perpetuals exchange with earn vaults on Solana.",
    website_url: "https://drift.trade",
    audit_status: "audited",
    auditors: ["OtterSec"],
    integration: "full",
  },
  {
    slug: "exponent",
    name: "Exponent Finance",
    description:
      "Fixed-yield tokenization protocol on Solana (Pendle-equivalent).",
    website_url: "https://exponent.finance",
    audit_status: "audited",
    auditors: [],
    integration: "full",
  },
  {
    slug: "solstice",
    name: "Solstice",
    description:
      "Delta-neutral yield strategies on Solana (USX/eUSX).",
    website_url: "https://solstice.finance",
    audit_status: "unaudited",
    auditors: [],
    integration: "data_only",
  },
  {
    slug: "jupiter",
    name: "Jupiter",
    description:
      "Leading DEX aggregator on Solana with Earn (lending) and LP pools.",
    website_url: "https://jup.ag",
    audit_status: "audited",
    auditors: ["OtterSec"],
    integration: "full",
  },
];

async function seedProtocols() {
  let added = 0;
  for (const p of SEED_PROTOCOLS) {
    const existing = await db
      .select({ id: protocols.id })
      .from(protocols)
      .where(eq(protocols.slug, p.slug))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(protocols).values(p);
      added++;
      logger.info({ protocol: p.name }, "Seeded protocol");
    }
  }
  if (added > 0) {
    logger.info({ count: added }, "Seeded protocols");
  } else {
    logger.info("All protocols already present — skipping seed");
  }
}

// ---------------------------------------------------------------------------
// Fastify plugin
// ---------------------------------------------------------------------------

export async function discoverPlugin(app: FastifyInstance) {
  // Seed protocols before routes/scheduler
  await seedProtocols();

  // Register routes
  await app.register(yieldsRoutes);
  await app.register(protocolsRoutes);

  // Start scheduler after server is ready
  app.addHook("onReady", async () => {
    startScheduler();
  });

  // Stop scheduler on close
  app.addHook("onClose", async () => {
    stopScheduler();
  });
}
