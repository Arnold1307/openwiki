import { getErrorMessage } from "../platform/diagnostics.js";
import type {
  ModelMessage,
  ModelRequest,
  ModelStreamEvent,
  ProviderModel,
  RuntimeTool,
} from "../model/types.js";

export type AgentLoopEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool-result"; id: string; name: string; result: string }
  | { type: "model-event"; event: ModelStreamEvent };

export type AgentLoopOptions = {
  model: ProviderModel;
  modelId: string;
  messages: ModelMessage[];
  tools?: RuntimeTool[];
  maxOutputTokens?: number;
  reasoningEffort?: string;
  signal?: AbortSignal;
  maxIterations?: number;
  onEvent?: (event: AgentLoopEvent) => void;
};

export type AgentLoopResult = {
  messages: ModelMessage[];
  finalMessage: ModelMessage;
  iterations: number;
};

const DEFAULT_MAX_ITERATIONS = 12;

/** Runs streamed model turns and dispatches validated tool calls. */
export async function runAgentLoop(
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const messages = [...options.messages];
  const tools = options.tools ?? [];
  const toolByName = new Map(tools.map((tool) => [tool.name, tool]));
  const maxIterations = Math.max(
    1,
    Math.min(options.maxIterations ?? DEFAULT_MAX_ITERATIONS, 64),
  );

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (options.signal?.aborted) throw abortError();
    const request: ModelRequest = {
      modelId: options.modelId,
      messages,
      ...(tools.length ? { tools } : {}),
      ...(options.maxOutputTokens ?? options.model.defaultMaxOutputTokens
        ? { maxOutputTokens: options.maxOutputTokens ?? options.model.defaultMaxOutputTokens }
        : {}),
      ...(options.reasoningEffort ?? options.model.defaultReasoningEffort
        ? { reasoningEffort: options.reasoningEffort ?? options.model.defaultReasoningEffort }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    };

    const content: string[] = [];
    const reasoning: string[] = [];
    const partialCalls = new Map<number, { id: string; name: string; arguments: string }>();
    for await (const event of options.model.stream(request)) {
      options.onEvent?.({ type: "model-event", event });
      if (event.type === "error") throw event.error;
      if (event.type === "text_delta") {
        content.push(event.text);
        options.onEvent?.({ type: "text", text: event.text });
      } else if (event.type === "reasoning_delta") {
        reasoning.push(event.text);
        options.onEvent?.({ type: "reasoning", text: event.text });
      } else if (event.type === "tool_call_delta") {
        const call = partialCalls.get(event.index) ?? { id: "", name: "", arguments: "" };
        if (event.id) call.id += event.id;
        if (event.name) call.name += event.name;
        if (event.arguments) call.arguments += event.arguments;
        partialCalls.set(event.index, call);
      }
    }

    const toolCalls = [...partialCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, call]) => ({
        id: call.id || `tool-${iteration}-${index}`,
        name: call.name,
        arguments: call.arguments || "{}",
      }));
    const assistantMessage: ModelMessage = {
      role: "assistant",
      content: content.join(""),
      ...(toolCalls.length ? { toolCalls } : {}),
    };
    messages.push(assistantMessage);

    if (toolCalls.length === 0) {
      return { messages, finalMessage: assistantMessage, iterations: iteration };
    }

    for (const call of toolCalls) {
      if (options.signal?.aborted) throw abortError();
      const tool = toolByName.get(call.name);
      let result: string;
      if (!tool) {
        result = `Unknown tool: ${call.name}`;
      } else {
        try {
          const input: unknown = JSON.parse(call.arguments);
          if (!isRecord(input)) throw new Error("Tool arguments must be a JSON object.");
          options.onEvent?.({ type: "tool-start", id: call.id, name: call.name, input });
          result = await tool.execute(input);
        } catch (error) {
          result = `Tool failed: ${getErrorMessage(error)}`;
        }
      }
      messages.push({ role: "tool", toolCallId: call.id, toolName: call.name, content: result });
      options.onEvent?.({ type: "tool-result", id: call.id, name: call.name, result });
    }
  }

  throw new Error(`Agent reached its ${maxIterations}-turn limit without finishing.`);
}

function abortError(): Error {
  const error = new Error("Agent run was cancelled.");
  error.name = "AbortError";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
