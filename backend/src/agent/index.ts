/**
 * Agent module — optimized endpoints for AI agents.
 *
 * These endpoints return exactly what an agent needs with sensible defaults,
 * self-documenting `next` fields, and no ambiguous options.
 */
import type { FastifyInstance } from "fastify";
import { agentRoutes } from "./routes.js";

export async function agentPlugin(app: FastifyInstance) {
  await app.register(agentRoutes);
}
