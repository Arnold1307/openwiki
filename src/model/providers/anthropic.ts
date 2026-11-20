import { providerError } from "../errors.js";
import type {
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ModelToolCall,
  ProviderModel,
} from "../types.js";

export type AnthropicOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function createAnthropicModel(options: AnthropicOptions = {}): ProviderModel {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const endpoint = `${(options.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/u, "")}/v1/messages`;

  async function send(request: ModelRequest, stream: boolean): Promise<Response> {
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const body = {
      model: request.modelId,
      max_tokens: request.maxOutputTokens ?? 4096,
      ...(system ? { system } : {}),
      messages: request.messages.filter((message) => message.role !== "system").map((message) => {
        if (message.role === "tool") {
          return { role: "user", content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }] };
        }
        if (message.role === "assistant" && message.toolCalls?.length) {
          return { role: "assistant", content: [
            ...(message.content ? [{ type: "text", text: message.content }] : []),
            ...message.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: parseArguments(call.arguments) })),
          ] };
        }
        return { role: message.role === "assistant" ? "assistant" : "user", content: message.content };
      }),
      ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
      ...(request.reasoningEffort ? { thinking: { type: "adaptive", effort: request.reasoningEffort } } : {}),
      stream,
    };
    const response = await requestFetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(options.apiKey ? { "x-api-key": options.apiKey } : {}),
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
    if (!response.ok) throw await providerError("Anthropic", response);
    return response;
  }

  return {
    async generate(request): Promise<ModelResponse> {
      const response = await send(request, false);
      const payload = await response.json() as Record<string, any>;
      const blocks = Array.isArray(payload.content) ? payload.content : [];
      const content = blocks.filter((block: any) => block?.type === "text").map((block: any) => block.text ?? "").join("");
      const calls: ModelToolCall[] = blocks.flatMap((block: any) => block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string"
        ? [{ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }]
        : []);
      return {
        message: { role: "assistant", content, ...(calls.length ? { toolCalls: calls } : {}) },
        toolCalls: calls,
        finishReason: typeof payload.stop_reason === "string" ? payload.stop_reason : null,
        usage: parseUsage(payload.usage),
      };
    },

    async *stream(request): AsyncIterable<ModelStreamEvent> {
      const response = await send(request, true);
      if (!response.body) throw new Error("Anthropic response has no stream body.");
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
            const eventName = frame.match(/^event:\s*(.+)$/mu)?.[1]?.trim();
            const data = frame.split(/\r?\n/u).find((line) => line.startsWith("data:"))?.slice(5).trim();
            if (!data) continue;
            const event = JSON.parse(data) as Record<string, any>;
            if (eventName === "content_block_start" && event.content_block?.type === "tool_use") {
              yield { type: "tool_call_delta", index: event.index, id: event.content_block.id, name: event.content_block.name };
            } else if (eventName === "content_block_delta") {
              if (event.delta?.type === "text_delta" && typeof event.delta.text === "string") yield { type: "text_delta", text: event.delta.text };
              if (event.delta?.type === "thinking_delta" && typeof event.delta.thinking === "string") yield { type: "reasoning_delta", text: event.delta.thinking };
              if (event.delta?.type === "input_json_delta" && typeof event.delta.partial_json === "string") yield { type: "tool_call_delta", index: event.index, arguments: event.delta.partial_json };
            } else if (eventName === "message_start") {
              const usage = parseUsage(event.message?.usage);
              if (usage) yield { type: "usage", ...usage };
            } else if (eventName === "message_delta") {
              if (typeof event.delta?.stop_reason === "string") finishReason = event.delta.stop_reason;
              const usage = parseUsage(event.usage);
              if (usage) yield { type: "usage", ...usage };
            } else if (eventName === "error") {
              throw new Error(typeof event.error?.message === "string" ? event.error.message : "Anthropic stream failed.");
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

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseUsage(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const usage = value as Record<string, unknown>;
  return {
    ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}),
  };
}
