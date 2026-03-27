import type { FastifyInstance } from "fastify";
import { logger } from "../shared/logger.js";
import { portfolioRoutes } from "./routes/portfolio.js";
import { startScheduler, stopScheduler } from "./scheduler.js";

export async function monitorPlugin(app: FastifyInstance) {
  // Register routes
  await app.register(portfolioRoutes);

  // Start scheduler after server is ready
  app.addHook("onReady", async () => {
    startScheduler();
  });

  // Stop scheduler on close
  app.addHook("onClose", async () => {
    stopScheduler();
  });
}
