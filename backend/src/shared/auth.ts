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
 * Enabled by default. Set MANAGE_AUTH_DISABLED=true to skip (dev only — blocked in production).
 * Enforces per-key rate limiting using the `rate_limit` column.
 */

// In-memory per-key rate tracker: keyHash -> { count, windowStart }
const rateLimitTracker = new Map<
  string,
  { count: number; windowStart: number }
>();

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/**
 * Validate an API key string against the database.
 * Returns the API key record if valid, null otherwise.
 * Reusable across REST auth hook and MCP tool auth.
 */
export async function validateApiKey(
  bearerToken: string,
): Promise<{ name: string | null; keyHash: string; rateLimit: number } | null> {
  const keyHash = createHash("sha256").update(bearerToken).digest("hex");

  const rows = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.key_hash, keyHash), eq(apiKeys.is_active, true)))
    .limit(1);

  if (rows.length === 0) return null;

  const apiKey = rows[0];

  // Per-key rate limiting
  const keyRateLimit = apiKey.rate_limit ?? 100;
  const now = Date.now();
  const tracker = rateLimitTracker.get(keyHash);

  if (tracker && now - tracker.windowStart < RATE_LIMIT_WINDOW_MS) {
    tracker.count++;
    if (tracker.count > keyRateLimit) return null;
  } else {
    rateLimitTracker.set(keyHash, { count: 1, windowStart: now });

    // Evict stale entries to prevent unbounded memory growth
    const staleThreshold = now - 2 * RATE_LIMIT_WINDOW_MS;
    for (const [k, v] of rateLimitTracker) {
      if (v.windowStart < staleThreshold) rateLimitTracker.delete(k);
    }
  }

  return { name: apiKey.name, keyHash, rateLimit: keyRateLimit };
}

export async function authHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Auth bypass only works outside production
  if (process.env.MANAGE_AUTH_DISABLED === "true" && process.env.NODE_ENV !== "production") return;

  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    void reply.status(401).send({ error: "Missing API key" });
    return;
  }

  const key = authHeader.slice(7);
  const result = await validateApiKey(key);

  if (!result) {
    void reply.status(401).send({ error: "Invalid API key" });
    return;
  }

  (request as any).apiKeyName = result.name;
}
