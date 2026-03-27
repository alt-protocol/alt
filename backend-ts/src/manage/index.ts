import type { FastifyInstance } from "fastify";
import { authHook } from "../shared/auth.js";
import { txRoutes } from "./routes/tx.js";

export async function managePlugin(app: FastifyInstance) {
  // API key auth (all routes in this plugin)
  app.addHook("preHandler", authHook);

  // Register routes
  await app.register(txRoutes);
}
