import { generateText, type CoreMessage } from "ai";
import { getModel, type UserProviderConfig } from "./providers.js";
import { aiTools } from "./tools.js";
import { config } from "./config.js";

export interface PendingAction {
  action: string;
  params: Record<string, unknown>;
  summary: string;
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  pendingAction: PendingAction | null;
}

/** Run a full AI chat turn with read-only tools + request_action gateway. */
export async function chat(
  systemPrompt: string,
  messages: CoreMessage[],
  userConfig: UserProviderConfig,
): Promise<ChatResult> {
  const result = await generateText({
    model: getModel(userConfig),
    system: systemPrompt,
    tools: aiTools,
    messages,
    maxSteps: config.aiMaxSteps,
    maxTokens: config.aiMaxTokens,
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

  return {
    text: result.text || "(No response)",
    inputTokens: result.usage?.promptTokens ?? 0,
    outputTokens: result.usage?.completionTokens ?? 0,
    pendingAction,
  };
}
