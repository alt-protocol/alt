import { generateText, type CoreMessage } from "ai";
import { getModel, type UserProviderConfig } from "./providers.js";
import { aiTools } from "./tools.js";
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
