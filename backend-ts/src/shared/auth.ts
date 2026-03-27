import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { eq, and } from "drizzle-orm";
import { db } from "./db.js";
import { apiKeys } from "../manage/db/schema.js";

/**
 * API key auth preHandler for Manage routes.
 * Reads `Authorization: Bearer <key>`, hashes with SHA-256,
 * and validates against the manage.api_keys table.
 *
 * Disabled when MANAGE_AUTH_REQUIRED !== "true" (default in dev).
 */
export async function authHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (process.env.MANAGE_AUTH_REQUIRED !== "true") return;

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    void reply.status(401).send({ error: "Missing API key" });
    return;
  }

  const key = authHeader.slice(7);
  const keyHash = createHash("sha256").update(key).digest("hex");

  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.key_hash, keyHash), eq(apiKeys.is_active, true)))
    .limit(1);

  if (rows.length === 0) {
    void reply.status(401).send({ error: "Invalid API key" });
    return;
  }

  (request as any).apiKeyName = rows[0].name;
}
