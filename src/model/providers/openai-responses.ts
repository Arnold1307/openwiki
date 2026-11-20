import { ProviderRequestError, providerError } from "../errors.js";
import type { ModelMessage, ModelRequest, ModelResponse, ModelStreamEvent, ModelToolCall, ProviderModel } from "../types.js";

export type OpenAIResponsesOptions = {
  apiKey?: string | (() => Promise<string>);
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  fetch?: typeof fetch;
  store?: boolean;
};

export function createOpenAIResponsesModel(options: OpenAIResponsesOptions = {}): ProviderModel {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const endpoint = `${(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/u, "")}/responses`;

  async function send(request: ModelRequest, stream: boolean): Promise<Response> {
    const body = {
      model: request.modelId,
      input: request.messages.flatMap(toInputItems),
      ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })) } : {}),
      ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
      ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
      stream,
      store: options.store ?? false,
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
      body: JSON.stringify(body),
      signal: request.signal,
    });
    if (!response.ok) throw await providerError("OpenAI Responses", response);
    return response;
  }

  return {
    async generate(request): Promise<ModelResponse> {
      const response = await send(request, false);
      const payload = await response.json() as Record<string, any>;
      const output = Array.isArray(payload.output) ? payload.output : [];
      const message = output.find((item: any) => item?.type === "message");
      const content = message?.content?.filter((item: any) => item?.type === "output_text").map((item: any) => item.text ?? "").join("") ?? "";
      const calls: ModelToolCall[] = output.flatMap((item: any) => item?.type === "function_call" && typeof item.name === "string"
        ? [{ id: typeof item.call_id === "string" ? item.call_id : String(item.id ?? ""), name: item.name, arguments: typeof item.arguments === "string" ? item.arguments : "{}" }]
        : []);
      const finishReason = payload.status === "incomplete" ? payload.incomplete_details?.reason ?? "incomplete" : payload.status ?? null;
      return {
        message: { role: "assistant", content, ...(calls.length ? { toolCalls: calls } : {}) },
        toolCalls: calls,
        finishReason: typeof finishReason === "string" ? finishReason : null,
        usage: parseUsage(payload.usage),
      };
    },

    async *stream(request): AsyncIterable<ModelStreamEvent> {
      const response = await send(request, true);
      if (!response.body) throw new ProviderRequestError("OpenAI Responses", "Response has no stream body.");
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
            const eventLine = frame.split(/\r?\n/u).find((line) => line.startsWith("event:"))?.slice(6).trim();
            const data = frame.split(/\r?\n/u).find((line) => line.startsWith("data:"))?.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            const payload = JSON.parse(data) as Record<string, any>;
            const event = typeof eventLine === "string" ? eventLine : payload.type;
            if (event === "response.output_text.delta" && typeof payload.delta === "string") yield { type: "text_delta", text: payload.delta };
            else if ((event === "response.reasoning_summary_text.delta" || event === "response.reasoning_text.delta") && typeof payload.delta === "string") yield { type: "reasoning_delta", text: payload.delta };
            else if (event === "response.output_item.added" && payload.item?.type === "function_call") {
              yield { type: "tool_call_delta", index: payload.output_index ?? 0, id: payload.item.call_id ?? payload.item.id, name: payload.item.name };
            } else if (event === "response.function_call_arguments.delta" && typeof payload.delta === "string") {
              yield { type: "tool_call_delta", index: payload.output_index ?? 0, arguments: payload.delta };
            } else if (event === "response.completed" || event === "response.incomplete") {
              const responsePayload = payload.response ?? {};
              finishReason = responsePayload.status === "incomplete" ? responsePayload.incomplete_details?.reason ?? "incomplete" : responsePayload.status ?? "completed";
              const usage = parseUsage(responsePayload.usage);
              if (usage) yield { type: "usage", ...usage };
            } else if (event === "response.failed" || event === "error") {
              throw new Error(payload.response?.error?.message ?? payload.error?.message ?? "OpenAI Responses stream failed.");
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

function toInputItems(message: ModelMessage): Record<string, unknown>[] {
  if (message.role === "tool") return [{ type: "function_call_output", call_id: message.toolCallId, output: message.content }];
  const items: Record<string, unknown>[] = [{ role: message.role === "system" ? "system" : message.role, content: message.content }];
  if (message.role === "assistant") {
    for (const call of message.toolCalls ?? []) items.push({ type: "function_call", call_id: call.id, name: call.name, arguments: call.arguments });
  }
  return items;
}

function parseUsage(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const usage = value as Record<string, unknown>;
  return {
    ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}),
  };
}
