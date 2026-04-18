import { eq, asc, inArray } from "drizzle-orm";
import { db } from "../db/connection.js";
import { conversations } from "../db/schema.js";
import { config } from "../config.js";

/** Save user + assistant messages and enforce sliding window. */
export async function saveConversationTurn(
  userId: number,
  userMessage: string,
  assistantResponse: string,
): Promise<void> {
  await db.insert(conversations).values([
    { user_id: userId, role: "user", content: userMessage },
    { user_id: userId, role: "assistant", content: assistantResponse },
  ]);

  await enforceWindowLimit(userId);
}

/** Delete oldest messages to keep within limit. */
async function enforceWindowLimit(userId: number): Promise<void> {
  const all = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.user_id, userId))
    .orderBy(asc(conversations.created_at));

  if (all.length > config.maxConversationMessages) {
    const idsToDelete = all
      .slice(0, all.length - config.maxConversationMessages)
      .map((r) => r.id);
    await db.delete(conversations).where(inArray(conversations.id, idsToDelete));
  }
}
