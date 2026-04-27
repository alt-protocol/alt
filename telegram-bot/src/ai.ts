import { generateText, type CoreMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { getModel, type UserProviderConfig } from "./providers.js";
import type { AiTools } from "./tools.js";
import type { SessionState } from "./handlers/session.js";
import { config } from "./config.js";

export interface PendingAction {
  action: string;
  params: Record<string, unknown>;
  summary: string;
}

export interface ToolCallSummary {
  toolName: string;
  resultPreview: string;
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  pendingAction: PendingAction | null;
  toolCalls: ToolCallSummary[];
}

/** Run a full AI chat turn with session-bound tools. */
export async function chat(
  systemPrompt: string,
  messages: CoreMessage[],
  userConfig: UserProviderConfig,
  tools: AiTools,
): Promise<ChatResult> {
  const result = await generateText({
    model: getModel(userConfig),
    system: systemPrompt,
    tools,
    messages,
    maxSteps: config.aiMaxSteps,
    maxTokens: config.aiMaxTokens,
    temperature: 0.7,
    abortSignal: AbortSignal.timeout(config.aiChatTimeoutMs),
  });

  // Detect pending mutations from any tool call (request_deposit, request_withdraw, request_swap, request_action)
  let pendingAction: PendingAction | null = null;
  for (const step of result.steps) {
    for (const tc of step.toolCalls) {
      const toolResult = step.toolResults.find(
        (tr) => tr.toolCallId === tc.toolCallId,
      );
      if (toolResult && typeof toolResult.result === "object" && toolResult.result !== null) {
        const r = toolResult.result as Record<string, unknown>;
        if (r.pending) {
          pendingAction = {
            action: r.action as string,
            params: r.params as Record<string, unknown>,
            summary: r.summary as string,
          };
        }
      }
    }
  }

  // Collect tool call summaries for conversation history
  const toolCalls: ToolCallSummary[] = [];
  for (const step of result.steps) {
    for (const tc of step.toolCalls) {
      const toolResult = step.toolResults.find((tr) => tr.toolCallId === tc.toolCallId);
      const resultStr = toolResult ? JSON.stringify(toolResult.result) : "";
      toolCalls.push({
        toolName: tc.toolName,
        resultPreview: resultStr.length > 200 ? resultStr.slice(0, 200) + "..." : resultStr,
      });
    }
  }

  // Log summary for debugging
  const toolNames = toolCalls.map((tc) => tc.toolName);
  console.log(
    `[chat] steps=${result.steps.length} tools=[${toolNames.join(",")}] in=${result.usage?.promptTokens ?? 0} out=${result.usage?.completionTokens ?? 0}`,
  );

  return {
    text: result.text || "(No response)",
    inputTokens: result.usage?.promptTokens ?? 0,
    outputTokens: result.usage?.completionTokens ?? 0,
    pendingAction,
    toolCalls,
  };
}

/** Cheap Haiku call to verify a pending transaction matches the user's intent. */
export async function verifyPendingAction(
  userMessage: string,
  pendingAction: PendingAction,
  session: SessionState,
): Promise<{ verified: boolean; warning?: string }> {
  const apiKey = process.env.PLATFORM_ANTHROPIC_KEY;
  if (!apiKey) return { verified: true };

  const oppId = pendingAction.params.opportunity_id as number | undefined;
  const verified = oppId ? session.opportunities.get(oppId) : null;

  try {
    const model = createAnthropic({ apiKey })("claude-haiku-4-5-20251001");
    const result = await generateText({
      model,
      system:
        "You verify DeFi transactions match user intent. " +
        'Reply ONLY with JSON: {"match": true} or {"match": false, "reason": "brief reason"}. ' +
        "Check: correct protocol/token pair, correct action type (deposit vs withdraw), reasonable amount.",
      messages: [{
        role: "user",
        content: [
          `User said: "${userMessage}"`,
          "",
          "Transaction:",
          `- Action: ${pendingAction.action}`,
          `- Opportunity: ${verified?.name ?? "unknown"} (${verified?.category ?? "unknown"})`,
          `- Amount: ${pendingAction.params.amount ?? "N/A"}`,
          `- Leverage: ${pendingAction.params.leverage ?? "none"}`,
          "",
          "Does this match what the user asked for?",
        ].join("\n"),
      }],
      maxTokens: 100,
      abortSignal: AbortSignal.timeout(5000),
    });

    const parsed = JSON.parse(result.text);
    if (parsed.match === false) {
      console.warn(`[reflection] Mismatch detected: ${parsed.reason}`);
      return { verified: false, warning: parsed.reason };
    }
    return { verified: true };
  } catch (err) {
    // Fail open — don't block transactions if reflection fails
    console.error("[reflection] Verification failed:", err);
    return { verified: true };
  }
}
