import type { FastifyInstance } from "fastify";
import { txRoutes } from "./routes/tx.js";
import { swapRoutes } from "./routes/swap.js";
import { actionsRoutes } from "./routes/actions.js";

export async function managePlugin(app: FastifyInstance) {
  // Auth is applied per-route (only /tx/submit requires API key).
  // Build, balance, and withdraw-state routes are public with rate limiting.
  await app.register(txRoutes);
  await app.register(swapRoutes);
  // Solana Actions (blinks) — wallet signing via solana-action: links
  await app.register(actionsRoutes);
}
