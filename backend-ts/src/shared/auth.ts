import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { eq, and } from "drizzle-orm";
import { db } from "./db.js";
import { apiKeys } from "../manage/db/schema.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * API key auth preHandler for Manage routes.
 * Reads `Authorization: Bearer <key>`, hashes with SHA-256,
 * and validates against the manage.api_keys table.
 *
 * Enabled by default. Set MANAGE_AUTH_DISABLED=true to skip (dev only).
 * Enforces per-key rate limiting using the `rate_limit` column.
 */

// In-memory per-key rate tracker: keyHash -> { count, windowStart }
const rateLimitTracker = new Map<
  string,
  { count: number; windowStart: number }
>();

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

export async function authHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (process.env.MANAGE_AUTH_DISABLED === "true") return;

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

  const apiKey = rows[0];

  // Per-key rate limiting
  const keyRateLimit = apiKey.rate_limit ?? 100;
  const now = Date.now();
  const tracker = rateLimitTracker.get(keyHash);

  if (tracker && now - tracker.windowStart < RATE_LIMIT_WINDOW_MS) {
    tracker.count++;
    if (tracker.count > keyRateLimit) {
      void reply.status(429).send({
        error: `Rate limit exceeded (${keyRateLimit} requests per minute)`,
      });
      return;
    }
  } else {
    rateLimitTracker.set(keyHash, { count: 1, windowStart: now });
  }

  (request as any).apiKeyName = apiKey.name;
}
