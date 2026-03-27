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
      await db.execute(sql`SELECT 1`);
      return { status: "ok" };
    } catch {
      return { status: "degraded", detail: "database unavailable" };
    }
  });

  // Discover module
  await app.register(discoverPlugin, { prefix: "/api/discover" });

  // Manage module
  await app.register(managePlugin, { prefix: "/api/manage" });

  // Monitor module
  await app.register(monitorPlugin, { prefix: "/api/monitor" });

  return app;
}
