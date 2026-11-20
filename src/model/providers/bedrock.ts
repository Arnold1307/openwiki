import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import { ProviderRequestError } from "../errors.js";
import type { ModelRequest, ModelResponse, ModelStreamEvent, ModelToolCall, ProviderModel } from "../types.js";

export type BedrockOptions = {
  region?: string;
  streamIdleTimeout?: number;
  maxRetries?: number;
  client?: BedrockRuntimeClient;
};

export function createBedrockModel(options: BedrockOptions = {}): ProviderModel {
  const client = options.client ?? new BedrockRuntimeClient({
    ...(options.region ? { region: options.region } : {}),
    maxAttempts: Math.max(1, (options.maxRetries ?? 2) + 1),
  });

  function requestInput(request: ModelRequest) {
    const system = request.messages.filter((message) => message.role === "system").map((message) => ({ text: message.content }));
    const messages: Message[] = request.messages.filter((message) => message.role !== "system").map((message) => {
      if (message.role === "tool") {
        return { role: "user", content: [{ toolResult: { toolUseId: message.toolCallId ?? "", content: [{ text: message.content }] } }] };
      }
      const content: ContentBlock[] = [];
      if (message.content) content.push({ text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({ toolUse: { toolUseId: call.id, name: call.name, input: parseArguments(call.arguments) as never } });
      }
      return { role: message.role === "assistant" ? "assistant" : "user", content };
    });
    return {
      modelId: request.modelId,
      messages,
      ...(system.length ? { system } : {}),
      ...(request.tools?.length ? { toolConfig: { tools: request.tools.map((tool) => ({ toolSpec: { name: tool.name, description: tool.description, inputSchema: { json: tool.parameters as never } } })) } } : {}),
      ...(request.maxOutputTokens ? { inferenceConfig: { maxTokens: request.maxOutputTokens } } : {}),
    };
  }

  return {
    async generate(request): Promise<ModelResponse> {
      const response = await client.send(new ConverseCommand(requestInput(request) as ConstructorParameters<typeof ConverseCommand>[0]), { abortSignal: request.signal });
      const blocks = response.output?.message?.content ?? [];
      const content = blocks.flatMap((block) => "text" in block && typeof block.text === "string" ? [block.text] : []).join("");
      const calls: ModelToolCall[] = blocks.flatMap((block) => "toolUse" in block && block.toolUse?.name
        ? [{ id: block.toolUse.toolUseId ?? "", name: block.toolUse.name, arguments: JSON.stringify(block.toolUse.input ?? {}) }]
        : []);
      return {
        message: { role: "assistant", content, ...(calls.length ? { toolCalls: calls } : {}) },
        toolCalls: calls,
        finishReason: response.stopReason ?? null,
        usage: {
          ...(typeof response.usage?.inputTokens === "number" ? { inputTokens: response.usage.inputTokens } : {}),
          ...(typeof response.usage?.outputTokens === "number" ? { outputTokens: response.usage.outputTokens } : {}),
        },
      };
    },

    async *stream(request): AsyncIterable<ModelStreamEvent> {
      const response = await client.send(new ConverseStreamCommand(requestInput(request) as ConstructorParameters<typeof ConverseStreamCommand>[0]), { abortSignal: request.signal });
      if (!response.stream) throw new ProviderRequestError("Bedrock", "Converse stream was empty.");
      let finishReason: string | null = null;
      const iterator = response.stream[Symbol.asyncIterator]();
      try {
        while (true) {
          const next = await nextWithIdleTimeout(
            iterator,
            options.streamIdleTimeout,
            request.signal,
          );
          if (next.done) break;
          const event = next.value;
          if (event.contentBlockStart?.start?.toolUse) {
            const { toolUseId, name } = event.contentBlockStart.start.toolUse;
            yield { type: "tool_call_delta", index: event.contentBlockStart.contentBlockIndex ?? 0, ...(toolUseId ? { id: toolUseId } : {}), ...(name ? { name } : {}) };
          }
          const delta = event.contentBlockDelta?.delta;
          if (delta && "text" in delta && typeof delta.text === "string") yield { type: "text_delta", text: delta.text };
          if (delta && "toolUse" in delta && typeof delta.toolUse?.input === "string") {
            yield { type: "tool_call_delta", index: event.contentBlockDelta?.contentBlockIndex ?? 0, arguments: delta.toolUse.input };
          }
          if (event.messageStop?.stopReason) finishReason = event.messageStop.stopReason;
          if (event.metadata?.usage) yield { type: "usage", ...(event.metadata.usage.inputTokens !== undefined ? { inputTokens: event.metadata.usage.inputTokens } : {}), ...(event.metadata.usage.outputTokens !== undefined ? { outputTokens: event.metadata.usage.outputTokens } : {}) };
        }
      } finally {
        await iterator.return?.();
      }
      yield { type: "complete", finishReason };
    },
  };
}

async function nextWithIdleTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
): Promise<IteratorResult<T>> {
  if (signal?.aborted) throw signal.reason ?? new Error("Bedrock request cancelled.");
  const pending = iterator.next();
  const races: Promise<IteratorResult<T>>[] = [pending];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  if (timeoutMs !== undefined && timeoutMs > 0) {
    races.push(new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Bedrock stream idle timeout.")), timeoutMs);
    }));
  }
  if (signal) {
    races.push(new Promise((_, reject) => {
      onAbort = () => reject(signal.reason ?? new Error("Bedrock request cancelled."));
      signal.addEventListener("abort", onAbort, { once: true });
    }));
  }
  try {
    return await Promise.race(races);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}
