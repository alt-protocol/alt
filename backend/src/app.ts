import Fastify from "fastify";
import cors from "@fastify/cors";
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

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);

  // CORS
  const origins = (process.env.CORS_ORIGINS ?? "http://localhost:3000").split(",");
  await app.register(cors, {
    origin: origins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // Health endpoint
  app.get("/api/health", async () => {
    try {
      const sizeResult = await db.execute(
        sql`SELECT pg_database_size(current_database()) as size`,
      );
      const dbSizeMb = Math.round(
        Number(sizeResult.rows[0].size) / 1024 / 1024,
      );
      return { status: "ok", db_size_mb: dbSizeMb };
    } catch {
      return { status: "degraded", detail: "database unavailable" };
    }
  });

  // Deep health check — verifies external dependencies
  app.get("/api/health/ready", async () => {
    const checks: Record<string, string> = {};

    try {
      await db.execute(sql`SELECT 1`);
      checks.database = "ok";
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
    return { status: allOk ? "ok" : "degraded", checks };
  });

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

  return app;
}
