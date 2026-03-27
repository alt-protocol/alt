import type { FastifyInstance } from "fastify";
import { txRoutes } from "./routes/tx.js";

export async function managePlugin(app: FastifyInstance) {
  // Auth is applied per-route (only /tx/submit requires API key).
  // Build, balance, and withdraw-state routes are public with rate limiting.
  await app.register(txRoutes);
}
