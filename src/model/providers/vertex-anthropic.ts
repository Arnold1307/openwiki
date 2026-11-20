import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { withAnthropicAuthEnvNeutralized, stripPublisherPath } from "../../agent/vertex-surface.js";
import type { ModelRequest, ModelResponse, ModelStreamEvent, ModelToolCall, ProviderModel } from "../types.js";

export function createVertexAnthropicModel(options: {
  projectId: string;
  location: string;
  maxOutputTokens?: number;
  maxRetries?: number;
}): ProviderModel {
  const client = withAnthropicAuthEnvNeutralized(() => new AnthropicVertex({
    projectId: options.projectId,
    region: options.location,
    dangerouslyAllowBrowser: true,
    maxRetries: options.maxRetries ?? 2,
  }));

  function input(request: ModelRequest) {
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    return {
      model: stripPublisherPath(request.modelId),
      max_tokens: request.maxOutputTokens ?? options.maxOutputTokens ?? 4096,
      ...(system ? { system } : {}),
      messages: request.messages.filter((message) => message.role !== "system").map((message) => {
        if (message.role === "tool") return { role: "user", content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }] };
        if (message.role === "assistant" && message.toolCalls?.length) return { role: "assistant", content: [
          ...(message.content ? [{ type: "text", text: message.content }] : []),
          ...message.toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: parseArguments(call.arguments) })),
        ] };
        return { role: message.role === "assistant" ? "assistant" : "user", content: message.content };
      }),
      ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
      ...(request.reasoningEffort ? { thinking: { type: "adaptive", effort: request.reasoningEffort } } : {}),
    };
  }

  return {
    async generate(request): Promise<ModelResponse> {
      const response = await client.messages.create(input(request) as never, { signal: request.signal });
      const payload = response as unknown as Record<string, any>;
      const blocks = Array.isArray(payload.content) ? payload.content : [];
      const content = blocks.filter((block: any) => block?.type === "text").map((block: any) => block.text ?? "").join("");
      const calls: ModelToolCall[] = blocks.flatMap((block: any) => block?.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string"
        ? [{ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }]
        : []);
      return { message: { role: "assistant", content, ...(calls.length ? { toolCalls: calls } : {}) }, toolCalls: calls, finishReason: typeof payload.stop_reason === "string" ? payload.stop_reason : null, usage: parseUsage(payload.usage) };
    },

    async *stream(request): AsyncIterable<ModelStreamEvent> {
      const stream = await client.messages.create({ ...input(request), stream: true } as never, { signal: request.signal }) as unknown as AsyncIterable<Record<string, any>>;
      let finishReason: string | null = null;
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
          yield { type: "tool_call_delta", index: event.index, id: event.content_block.id, name: event.content_block.name };
        } else if (event.type === "content_block_delta") {
          if (event.delta?.type === "text_delta" && typeof event.delta.text === "string") yield { type: "text_delta", text: event.delta.text };
          if (event.delta?.type === "thinking_delta" && typeof event.delta.thinking === "string") yield { type: "reasoning_delta", text: event.delta.thinking };
          if (event.delta?.type === "input_json_delta" && typeof event.delta.partial_json === "string") yield { type: "tool_call_delta", index: event.index, arguments: event.delta.partial_json };
        } else if (event.type === "message_delta") {
          if (typeof event.delta?.stop_reason === "string") finishReason = event.delta.stop_reason;
          const usage = parseUsage(event.usage);
          if (usage) yield { type: "usage", ...usage };
        } else if (event.type === "message_start") {
          const usage = parseUsage(event.message?.usage);
          if (usage) yield { type: "usage", ...usage };
        }
      }
      yield { type: "complete", finishReason };
    },
  };
}

function parseArguments(value: string): Record<string, unknown> {
  try { const parsed: unknown = JSON.parse(value); return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; }
  catch { return {}; }
}

function parseUsage(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const usage = value as Record<string, unknown>;
  return { ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}), ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}) };
}
