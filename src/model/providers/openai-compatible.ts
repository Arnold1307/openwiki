import { ProviderRequestError, providerError } from "../errors.js";
import type {
  ModelMessage,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ModelToolCall,
  ProviderModel,
} from "../types.js";

export type OpenAICompatibleOptions = {
  apiKey?: string | (() => Promise<string>);
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  fetch?: typeof fetch;
  providerName?: string;
  reasoningEffort?: string;
  extraBody?: Record<string, unknown>;
};

export function createOpenAICompatibleModel(
  options: OpenAICompatibleOptions = {},
): ProviderModel {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const provider = options.providerName ?? "OpenAI-compatible provider";
  const endpoint = `${(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/u, "")}/chat/completions`;

  async function send(request: ModelRequest, stream: boolean): Promise<Response> {
    const payload: Record<string, unknown> = {
      model: request.modelId,
      messages: request.messages.map(toApiMessage),
      stream,
      ...(request.tools?.length
        ? {
            tools: request.tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
              },
            })),
            tool_choice: "auto",
          }
        : {}),
      ...(request.maxOutputTokens ? { max_tokens: request.maxOutputTokens } : {}),
      ...(request.reasoningEffort ?? options.reasoningEffort
        ? { reasoning_effort: request.reasoningEffort ?? options.reasoningEffort }
        : {}),
      ...options.extraBody,
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    };
    const response = await requestFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.apiKey
          ? { authorization: `Bearer ${typeof options.apiKey === "string" ? options.apiKey : await options.apiKey()}` }
          : {}),
        ...options.defaultHeaders,
      },
      body: JSON.stringify(payload),
      signal: request.signal,
    });
    if (!response.ok) throw await providerError(provider, response);
    return response;
  }

  return {
    async generate(request): Promise<ModelResponse> {
      const response = await send(request, false);
      const payload: unknown = await response.json();
      const choice = firstChoice(payload);
      const message = isRecord(choice.message) ? choice.message : {};
      const calls = parseToolCalls(message.tool_calls);
      return {
        message: {
          role: "assistant",
          content: textContent(message.content),
          ...(calls.length ? { toolCalls: calls } : {}),
        },
        toolCalls: calls,
        finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
        usage: parseUsage(isRecord(payload) ? payload.usage : undefined),
      };
    },

    async *stream(request): AsyncIterable<ModelStreamEvent> {
      const response = await send(request, true);
      if (!response.body) throw new ProviderRequestError(provider, "Response has no stream body.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finishReason: string | null = null;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/u);
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const data = frame.split(/\r?\n/u)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (!data || data === "[DONE]") continue;
            const payload: unknown = JSON.parse(data);
            if (isRecord(payload) && isRecord(payload.usage)) {
              const usage = parseUsage(payload.usage);
              if (usage) yield { type: "usage", ...usage };
            }
            const choice = isRecord(payload) && Array.isArray(payload.choices)
              ? payload.choices[0]
              : undefined;
            if (!isRecord(choice)) continue;
            if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
            const delta = isRecord(choice.delta) ? choice.delta : {};
            if (typeof delta.content === "string" && delta.content) {
              yield { type: "text_delta", text: delta.content };
            }
            if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
              yield { type: "reasoning_delta", text: delta.reasoning_content };
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const entry of delta.tool_calls) {
                if (!isRecord(entry) || typeof entry.index !== "number") continue;
                const fn = isRecord(entry.function) ? entry.function : {};
                yield {
                  type: "tool_call_delta",
                  index: entry.index,
                  ...(typeof entry.id === "string" ? { id: entry.id } : {}),
                  ...(typeof fn.name === "string" ? { name: fn.name } : {}),
                  ...(typeof fn.arguments === "string" ? { arguments: fn.arguments } : {}),
                };
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      yield { type: "complete", finishReason };
    },
  };
}

function toApiMessage(message: ModelMessage): Record<string, unknown> {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls?.length
      ? {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        }
      : {}),
  };
}

function parseToolCalls(value: unknown): ModelToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.function)) return [];
    const fn = entry.function;
    return typeof entry.id === "string" && typeof fn.name === "string"
      ? [{ id: entry.id, name: fn.name, arguments: typeof fn.arguments === "string" ? fn.arguments : "{}" }]
      : [];
  });
}

function firstChoice(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) {
    throw new ProviderRequestError("OpenAI-compatible provider", "Response did not contain a completion choice.");
  }
  return value.choices[0];
}

function parseUsage(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(typeof value.prompt_tokens === "number" ? { inputTokens: value.prompt_tokens } : {}),
    ...(typeof value.completion_tokens === "number" ? { outputTokens: value.completion_tokens } : {}),
  };
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => isRecord(item) && typeof item.text === "string" ? item.text : "").join("");
  return "";
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}
