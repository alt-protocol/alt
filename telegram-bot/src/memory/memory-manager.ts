import { eq, and, desc, or, isNull, gt } from "drizzle-orm";
import { db } from "../db/connection.js";
import { userMemories, conversations } from "../db/schema.js";
import { config } from "../config.js";
import { apiGet } from "../api-client.js";

export interface UserContext {
  memories: Array<{ fact: string; category: string }>;
  messages: Array<{ role: string; content: string }>;
  portfolio: unknown | null;
  balances: unknown | null;
}

/** Load all 3 layers of user context for system prompt composition. */
export async function loadUserContext(
  userId: number,
  walletAddress: string | null,
): Promise<UserContext> {
  const [memories, messages, portfolio, balances] = await Promise.all([
    loadMemories(userId),
    loadRecentMessages(userId),
    walletAddress ? fetchPortfolio(walletAddress) : null,
    walletAddress ? fetchBalances(walletAddress) : null,
  ]);

  return { memories, messages, portfolio, balances };
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

/** Layer 2: Last N conversation messages (sliding window). */
async function loadRecentMessages(
  userId: number,
): Promise<Array<{ role: string; content: string }>> {
  const rows = await db
    .select({ role: conversations.role, content: conversations.content })
    .from(conversations)
    .where(eq(conversations.user_id, userId))
    .orderBy(desc(conversations.created_at))
    .limit(config.maxConversationMessages);

  return rows.reverse();
}

/** Layer 3: Live portfolio positions from backend API. */
async function fetchPortfolio(walletAddress: string): Promise<unknown | null> {
  try {
    return await apiGet(
      `/api/monitor/portfolio/${walletAddress}/positions`,
      config.portfolioTimeoutMs,
    );
  } catch (err) {
    console.warn("Failed to fetch portfolio:", err);
    return null;
  }
}

/** Layer 3: Live wallet balances from backend API. */
async function fetchBalances(walletAddress: string): Promise<unknown | null> {
  try {
    return await apiGet(
      `/api/monitor/portfolio/${walletAddress}`,
      config.portfolioTimeoutMs,
    );
  } catch (err) {
    console.warn("Failed to fetch balances:", err);
    return null;
  }
}
