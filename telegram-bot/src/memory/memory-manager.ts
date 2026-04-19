import { eq, and, desc, or, isNull, gt, gte } from "drizzle-orm";
import { db } from "../db/connection.js";
import { userMemories, conversations } from "../db/schema.js";
import { config } from "../config.js";

export interface UserContext {
  memories: Array<{ fact: string; category: string }>;
  messages: Array<{ role: string; content: string; created_at: Date; tool_name: string | null }>;
}

/** Load user context: memories + recent conversation summaries. */
export async function loadUserContext(
  userId: number,
): Promise<UserContext> {
  const [memories, messages] = await Promise.all([
    loadMemories(userId),
    loadRecentMessages(userId),
  ]);

  return { memories, messages };
}

/** Layer 1: Long-term structured facts from user_memories. */
async function loadMemories(
  userId: number,
): Promise<Array<{ fact: string; category: string }>> {
  const now = new Date();
  return db
    .select({ fact: userMemories.fact, category: userMemories.category })
    .from(userMemories)
    .where(
      and(
        eq(userMemories.user_id, userId),
        eq(userMemories.is_active, true),
        or(isNull(userMemories.expires_at), gt(userMemories.expires_at, now)),
      ),
    )
    .orderBy(desc(userMemories.created_at))
    .limit(config.maxMemories);
}

/** Layer 2: Last N conversation summaries within time window. */
async function loadRecentMessages(
  userId: number,
): Promise<Array<{ role: string; content: string; created_at: Date; tool_name: string | null }>> {
  const cutoff = new Date(Date.now() - config.conversationWindowMs);
  const rows = await db
    .select({
      role: conversations.role,
      content: conversations.content,
      created_at: conversations.created_at,
      tool_name: conversations.tool_name,
    })
    .from(conversations)
    .where(and(
      eq(conversations.user_id, userId),
      gte(conversations.created_at, cutoff),
    ))
    .orderBy(desc(conversations.created_at))
    .limit(config.maxConversationMessages);

  return rows.reverse();
}
