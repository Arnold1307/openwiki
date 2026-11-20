import { providerError } from "../errors.js";
import type {
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  ModelToolCall,
  ProviderModel,
} from "../types.js";

export type GoogleModelOptions = {
  apiKey?: string;
  baseUrl?: string;
  bearerToken?: string | (() => Promise<string>);
  fetch?: typeof fetch;
};

/** Google Gemini generateContent / streamGenerateContent adapter. */
export function createGoogleModel(options: GoogleModelOptions = {}): ProviderModel {
  const requestFetch = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/u, "");

  async function send(request: ModelRequest, stream: boolean): Promise<Response> {
    const system = request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    const contents = request.messages.filter((message) => message.role !== "system").map((message) => {
      if (message.role === "tool") {
        const callName = message.toolName ?? "tool";
        return { role: "user", parts: [{ functionResponse: { name: callName, response: { content: message.content } } }] };
      }
      if (message.role === "assistant" && message.toolCalls?.length) {
        return { role: "model", parts: [
          ...(message.content ? [{ text: message.content }] : []),
          ...message.toolCalls.map((call) => ({ functionCall: { name: call.name, args: parseArguments(call.arguments) } })),
        ] };
      }
      return { role: message.role === "assistant" ? "model" : "user", parts: [{ text: message.content }] };
    });
    const url = new URL(`${baseUrl}/models/${encodeURIComponent(request.modelId)}:${stream ? "streamGenerateContent" : "generateContent"}`);
    if (stream) url.searchParams.set("alt", "sse");
    const response = await requestFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.apiKey ? { "x-goog-api-key": options.apiKey } : {}),
        ...(options.bearerToken
          ? { authorization: `Bearer ${typeof options.bearerToken === "string" ? options.bearerToken : await options.bearerToken()}` }
          : {}),
      },
      body: JSON.stringify({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }] } : {}),
        ...(request.maxOutputTokens || request.reasoningEffort ? { generationConfig: {
          ...(request.maxOutputTokens ? { maxOutputTokens: request.maxOutputTokens } : {}),
          ...(request.reasoningEffort ? { thinkingConfig: { thinkingLevel: request.reasoningEffort.toUpperCase() } } : {}),
        } } : {}),
      }),
      signal: request.signal,
    });
    if (!response.ok) throw await providerError("Google Gemini", response);
    return response;
  }

  return {
    async generate(request): Promise<ModelResponse> {
      const response = await send(request, false);
      const payload = await response.json() as Record<string, any>;
      const candidate = payload.candidates?.[0] ?? {};
      const parts = candidate.content?.parts ?? [];
      const content = parts.filter((part: any) => typeof part.text === "string" && part.thought !== true).map((part: any) => part.text).join("");
      const calls: ModelToolCall[] = parts.flatMap((part: any, index: number) => part.functionCall?.name
        ? [{ id: `${request.modelId}-${index}`, name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) }]
        : []);
      return {
        message: { role: "assistant", content, ...(calls.length ? { toolCalls: calls } : {}) },
        toolCalls: calls,
        finishReason: typeof candidate.finishReason === "string" ? candidate.finishReason.toLowerCase() : null,
        usage: parseUsage(payload.usageMetadata),
      };
    },

    async *stream(request): AsyncIterable<ModelStreamEvent> {
      const response = await send(request, true);
      if (!response.body) throw new Error("Google Gemini response has no stream body.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finishReason: string | null = null;
      let callIndex = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/u);
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const data = frame.split(/\r?\n/u).find((line) => line.startsWith("data:"))?.slice(5).trim();
            if (!data) continue;
            const payload = JSON.parse(data) as Record<string, any>;
            const candidate = payload.candidates?.[0] ?? {};
            const parts = candidate.content?.parts ?? [];
            for (const part of parts) {
              if (typeof part.text === "string") {
                yield part.thought === true
                  ? { type: "reasoning_delta", text: part.text }
                  : { type: "text_delta", text: part.text };
              }
              if (part.functionCall?.name) {
                const index = callIndex++;
                yield { type: "tool_call_delta", index, id: `${request.modelId}-${index}`, name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) };
              }
            }
            if (typeof candidate.finishReason === "string") finishReason = candidate.finishReason.toLowerCase();
            const usage = parseUsage(payload.usageMetadata);
            if (usage) yield { type: "usage", ...usage };
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
  } catch { return {}; }
}

function parseUsage(value: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const usage = value as Record<string, unknown>;
  return {
    ...(typeof usage.promptTokenCount === "number" ? { inputTokens: usage.promptTokenCount } : {}),
    ...(typeof usage.candidatesTokenCount === "number" ? { outputTokens: usage.candidatesTokenCount } : {}),
  };
}
