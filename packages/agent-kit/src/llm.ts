/**
 * Pluggable LLM Provider
 *
 * Abstracts LLM calls so the orchestrator can use Anthropic Claude (default)
 * or any OpenAI-compatible API (OpenRouter, local models, etc.).
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMChatOptions {
  model?: string;
  maxTokens?: number;
  system?: string;
}

export interface LLMChatResult {
  text: string;
}

export interface LLMProvider {
  chat(messages: ChatMessage[], options?: LLMChatOptions): Promise<LLMChatResult>;
}

// ── Anthropic Provider ────────────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  }

  async chat(messages: ChatMessage[], options?: LLMChatOptions): Promise<LLMChatResult> {
    // Dynamic import to avoid requiring @anthropic-ai/sdk when using OpenRouter
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey });

    // Separate system messages from user/assistant messages
    const systemContent = options?.system
      ?? messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const response = await client.messages.create({
      model: options?.model ?? "claude-sonnet-4-6",
      max_tokens: options?.maxTokens ?? 2048,
      ...(systemContent ? { system: systemContent } : {}),
      messages: chatMessages,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    return { text };
  }
}

// ── OpenRouter Provider ───────────────────────────────────────────────────────

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

export class OpenRouterProvider implements LLMProvider {
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel?: string) {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel ?? "nousresearch/hermes-3-llama-3.1-405b";
  }

  async chat(messages: ChatMessage[], options?: LLMChatOptions): Promise<LLMChatResult> {
    const model = options?.model ?? this.defaultModel;

    // Build OpenAI-compatible messages array
    const apiMessages: Array<{ role: string; content: string }> = [];
    if (options?.system) {
      apiMessages.push({ role: "system", content: options.system });
    }
    for (const msg of messages) {
      apiMessages.push({ role: msg.role, content: msg.content });
    }

    const response = await fetch(OPENROUTER_BASE_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://cal-agentkit.dev",
        "X-Title": "Cal-AgentKit",
      },
      body: JSON.stringify({
        model,
        max_tokens: options?.maxTokens ?? 2048,
        messages: apiMessages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "unknown error");
      throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data.choices?.[0]?.message?.content ?? "";
    return { text };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface LLMProviderConfig {
  provider: "anthropic" | "openrouter";
  apiKey?: string;
  model?: string;
}

/**
 * Create an LLM provider from a config object.
 * Defaults to Anthropic if no config is provided.
 */
export function createLLMProvider(config?: LLMProviderConfig): LLMProvider {
  if (!config || config.provider === "anthropic") {
    return new AnthropicProvider(config?.apiKey);
  }
  if (config.provider === "openrouter") {
    if (!config.apiKey) {
      throw new Error("OpenRouter requires an API key");
    }
    return new OpenRouterProvider(config.apiKey, config.model);
  }
  throw new Error(`Unknown LLM provider: ${config.provider}`);
}
