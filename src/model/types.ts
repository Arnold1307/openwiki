export type ModelRole = "system" | "user" | "assistant" | "tool";

export type ModelToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type ModelMessage = {
  role: ModelRole;
  content: string;
  toolCalls?: ModelToolCall[];
  toolCallId?: string;
  toolName?: string;
};

export type ModelTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type RuntimeTool = ModelTool & {
  execute(input: Record<string, unknown>): Promise<string>;
};

export type ModelRequest = {
  modelId: string;
  messages: ModelMessage[];
  tools?: ModelTool[];
  maxOutputTokens?: number;
  reasoningEffort?: string;
  signal?: AbortSignal;
};

export type ModelResponse = {
  message: ModelMessage;
  toolCalls: ModelToolCall[];
  finishReason: string | null;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type ModelStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | {
      type: "tool_call_delta";
      index: number;
      id?: string;
      name?: string;
      arguments?: string;
    }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "complete"; finishReason: string | null }
  | { type: "error"; error: Error };

export interface ProviderModel {
  readonly modelId?: string;
  readonly defaultMaxOutputTokens?: number;
  readonly defaultReasoningEffort?: string;
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}
