import { randomBytes, createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "./db.js";
import { apiKeys } from "../manage/db/schema.js";

const RegisterBody = z.object({
  name: z.string().min(1, "name is required").max(100, "name must be 100 characters or less"),
});

export async function authRoutes(app: FastifyInstance) {
  // POST /register — self-service API key registration for agents
  app.post(
    "/register",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = RegisterBody.parse(request.body);

      const rawKey = randomBytes(32).toString("hex");
      const apiKey = `ak_${rawKey}`;
      const keyHash = createHash("sha256").update(apiKey).digest("hex");

      await db.insert(apiKeys).values({
        key_hash: keyHash,
        name: body.name,
        is_active: true,
        rate_limit: 100,
      });

      return reply.status(201).send({
        api_key: apiKey,
        name: body.name,
      });
    },
  );
}
