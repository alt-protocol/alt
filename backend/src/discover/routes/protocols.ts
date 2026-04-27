import type { FastifyInstance } from "fastify";
import { discoverService } from "../service.js";

export async function protocolsRoutes(app: FastifyInstance) {
  app.get("/protocols", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async () => {
      return discoverService.getProtocols();
    },
  });
}
