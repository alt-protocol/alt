import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/connection.js";
import { userMemories } from "../db/schema.js";
import { config } from "../config.js";

const factSchema = z.object({
  fact: z.string(),
  category: z.enum(["preference", "decision", "strategy", "context", "portfolio_note"]),
});

type ExtractedFact = z.infer<typeof factSchema>;

/** Extract new facts from a conversation turn using a cheap model (Haiku). */
export async function extractMemories(
  userMessage: string,
  assistantResponse: string,
  existingFacts: string[],
): Promise<ExtractedFact[]> {
  const apiKey = process.env.PLATFORM_ANTHROPIC_KEY;
  if (!apiKey) {
    console.warn("Memory extraction disabled: PLATFORM_ANTHROPIC_KEY not set");
    return [];
  }

  try {
    const model = createAnthropic({ apiKey })("claude-haiku-4-5-20251001");

    const result = await generateText({
      model,
      system: `You extract key facts from conversations that would be useful to remember in future conversations with this user. Focus on: preferences, decisions, plans, strategies, and context about their situation.

Output a JSON array: [{"fact": "...", "category": "preference|decision|strategy|context|portfolio_note"}]

Rules:
- Only extract genuinely NEW information not already known
- Check if any existing fact already captures this information, even if worded differently — skip semantic duplicates
- Be concise — each fact should be one clear sentence
- If nothing new worth remembering, output []
- Do not extract transient data (current APY numbers, balances, position details) — those change constantly
- Focus on user INTENT and PREFERENCES, not data they can look up

Already known facts:
${existingFacts.length > 0 ? existingFacts.map((m) => `- ${m}`).join("\n") : "(none yet)"}`,
      messages: [
        { role: "user", content: userMessage },
        { role: "assistant", content: assistantResponse },
      ],
      maxTokens: 300,
      abortSignal: AbortSignal.timeout(config.memoryExtractTimeoutMs),
    });

    // Parse JSON from response — try full parse first, then regex fallback
    let parsed: unknown[];
    try {
      parsed = JSON.parse(result.text);
    } catch {
      const match = result.text.match(/\[[\s\S]*\]/);
      if (!match) return [];
      parsed = JSON.parse(match[0]);
    }

    if (!Array.isArray(parsed)) return [];

    // Validate each fact with Zod
    return parsed
      .map((item) => factSchema.safeParse(item))
      .filter((r) => r.success)
      .map((r) => r.data);
  } catch (err) {
    console.error("Memory extraction failed:", err);
    return [];
  }
}

/** Save extracted facts to the database, skipping duplicates. */
export async function saveMemories(
  userId: number,
  newFacts: ExtractedFact[],
): Promise<void> {
  if (newFacts.length === 0) return;

  // Deduplicate against existing active facts
  const existing = await db
    .select({ fact: userMemories.fact })
    .from(userMemories)
    .where(and(eq(userMemories.user_id, userId), eq(userMemories.is_active, true)));

  const existingLower = new Set(existing.map((r) => r.fact.toLowerCase()));
  const unique = newFacts.filter((f) => !existingLower.has(f.fact.toLowerCase()));
  if (unique.length === 0) return;

  await db.insert(userMemories).values(
    unique.map(({ fact, category }) => ({
      user_id: userId,
      fact,
      category,
      source: "auto" as const,
      expires_at: category === "portfolio_note"
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
        : null,
    })),
  );

  // Enforce cap: deactivate oldest beyond 100
  const active = await db
    .select({ id: userMemories.id })
    .from(userMemories)
    .where(and(eq(userMemories.user_id, userId), eq(userMemories.is_active, true)))
    .orderBy(userMemories.created_at);

  if (active.length > 100) {
    const idsToDeactivate = active.slice(0, active.length - 100).map((r) => r.id);
    await db
      .update(userMemories)
      .set({ is_active: false })
      .where(inArray(userMemories.id, idsToDeactivate));
  }
}
