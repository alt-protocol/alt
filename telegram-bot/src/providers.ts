import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { decrypt } from "./crypto.js";

export interface UserProviderConfig {
  api_provider: string | null;
  api_key: string | null; // encrypted in DB
  model_id: string | null;
  ollama_url: string | null;
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case "anthropic":
      return "claude-sonnet-4-20250514";
    case "openai":
      return "gpt-4o";
    case "google":
      return "gemini-2.0-flash";
    case "ollama":
      return "llama3.1:70b";
    default:
      return "claude-sonnet-4-20250514";
  }
}

/** Return an AI SDK model instance based on user's BYOK config. */
export function getModel(user: UserProviderConfig) {
  let apiKey: string;
  let usingPlatformKey = false;

  if (user.api_key) {
    // User has a BYOK key — decrypt it. If it fails, tell them (don't silently fall back).
    try {
      apiKey = decrypt(user.api_key);
    } catch {
      throw new Error(
        "Your saved API key could not be decrypted. Please set a new one with /settings apikey <key>.",
      );
    }
  } else {
    // No BYOK key — use platform key (only works with anthropic provider)
    apiKey = process.env.PLATFORM_ANTHROPIC_KEY ?? "";
    usingPlatformKey = true;
  }

  if (!apiKey) {
    throw new Error(
      "No API key available. Set your key with /settings apikey <key> or configure PLATFORM_ANTHROPIC_KEY.",
    );
  }

  const provider = user.api_provider ?? "anthropic";
  // Free tier: use Haiku (cheap) unless user explicitly set a model
  const modelId = user.model_id
    ? user.model_id
    : usingPlatformKey
      ? "claude-haiku-4-5-20251001"
      : getDefaultModel(provider);

  // Platform key only works with Anthropic — don't send it to OpenAI/Google
  if (usingPlatformKey && provider !== "anthropic" && provider !== "ollama") {
    throw new Error(
      `Platform key only works with Anthropic. Set your own ${provider} API key with /settings apikey <key>.`,
    );
  }

  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);

    case "openai":
      return createOpenAI({ apiKey })(modelId);

    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);

    case "ollama":
      return createOpenAI({
        baseURL: (user.ollama_url ?? "http://localhost:11434") + "/v1",
        apiKey: "ollama",
      })(modelId);

    case "openrouter":
      return createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
      })(modelId);

    default:
      return createAnthropic({ apiKey })(modelId);
  }
}
