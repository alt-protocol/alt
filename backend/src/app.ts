import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { sql } from "drizzle-orm";
import { db } from "./shared/db.js";
import { errorHandler } from "./shared/error-handler.js";
import { discoverPlugin } from "./discover/index.js";
import { managePlugin } from "./manage/index.js";
import { monitorPlugin } from "./monitor/index.js";
import { mcpPlugin } from "./mcp/plugin.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    requestTimeout: 30_000,
    keepAliveTimeout: 10_000,
    bodyLimit: 102_400, // 100KB — sufficient for all API payloads
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  // Security headers
  await app.register(helmet, { contentSecurityPolicy: false });

  // CORS — validate against whitelist (Actions endpoints override with * per Solana spec)
  const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim());
  await app.register(cors, {
    origin: origins,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id", "X-Agent-Id"],
    exposedHeaders: ["Mcp-Session-Id"],
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // Health endpoint (lightweight — hit by Railway healthcheck probe)
  app.get("/api/health", async () => {
    try {
      await db.execute(sql`SELECT 1`);
      return { status: "ok" };
    } catch {
      return { status: "degraded", detail: "database unavailable" };
    }
  });

  // Deep health check — rate-limited to prevent RPC amplification attacks
  app.get(
    "/api/health/ready",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async () => {
      const checks: Record<string, string> = {};
      let dbMetrics: { db_size_mb: number; tables: Record<string, number> } | undefined;

      try {
        await db.execute(sql`SELECT 1`);
        checks.database = "ok";

        // DB size + approximate row counts (cheap via pg_class stats)
        const [sizeResult, rowCounts] = await Promise.all([
          db.execute(sql`SELECT pg_database_size(current_database()) as size`),
          db.execute(sql`
            SELECT relname as table_name, reltuples::bigint as approx_rows
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('discover', 'monitor', 'manage')
              AND c.relkind = 'r'
            ORDER BY reltuples DESC
          `),
        ]);

        dbMetrics = {
          db_size_mb: Math.round(Number(sizeResult.rows[0].size) / 1024 / 1024),
          tables: Object.fromEntries(
            rowCounts.rows.map((r: any) => [r.table_name, Number(r.approx_rows)]),
          ),
        };
      } catch {
        checks.database = "failed";
      }

      try {
        const resp = await fetch(process.env.HELIUS_RPC_URL!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
          signal: AbortSignal.timeout(3000),
        });
        checks.helius_rpc = resp.ok ? "ok" : "failed";
      } catch {
        checks.helius_rpc = "failed";
      }

      const allOk = Object.values(checks).every((v) => v === "ok");
      return { status: allOk ? "ok" : "degraded", checks, ...(dbMetrics && { db: dbMetrics }) };
    },
  );

  // Request ID response header
  app.addHook("onSend", (_request, reply, _payload, done) => {
    void reply.header("x-request-id", _request.id);
    done();
  });

  // Discover module
  await app.register(discoverPlugin, { prefix: "/api/discover" });

  // Manage module
  await app.register(managePlugin, { prefix: "/api/manage" });

  // Monitor module
  await app.register(monitorPlugin, { prefix: "/api/monitor" });

  // MCP endpoint for AI agents (Streamable HTTP)
  await app.register(mcpPlugin, { prefix: "/api/mcp" });

  // Solana Actions spec: actions.json maps URL patterns to action endpoints
  app.get("/actions.json", async (_request, reply) => {
    void reply.header("Access-Control-Allow-Origin", "*");
    return {
      rules: [
        { pathPattern: "/api/manage/actions/deposit**", apiPath: "/api/manage/actions/deposit**" },
        { pathPattern: "/api/manage/actions/withdraw**", apiPath: "/api/manage/actions/withdraw**" },
      ],
    };
  });

  return app;
}
