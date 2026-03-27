import type { FastifyInstance } from "fastify";
import { asc } from "drizzle-orm";
import { db } from "../db/connection.js";
import { protocols } from "../db/schema.js";

export async function protocolsRoutes(app: FastifyInstance) {
  app.get("/protocols", {
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    handler: async () => {
      const rows = await db
        .select()
        .from(protocols)
        .orderBy(asc(protocols.name));

      return {
        data: rows.map((p) => ({
          id: p.id,
          slug: p.slug,
          name: p.name,
          description: p.description,
          website_url: p.website_url,
          logo_url: p.logo_url,
          audit_status: p.audit_status,
          auditors: p.auditors,
          integration: p.integration,
        })),
      };
    },
  });
}
