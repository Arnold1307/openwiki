import type { OpenWikiProvider } from "../config/constants.js";
import { createAnthropicModel, type AnthropicOptions } from "./providers/anthropic.js";
import { createBedrockModel, type BedrockOptions } from "./providers/bedrock.js";
import { createGoogleModel, type GoogleModelOptions } from "./providers/google.js";
import { createOpenAICompatibleModel, type OpenAICompatibleOptions } from "./providers/openai-compatible.js";
import { createOpenAIResponsesModel, type OpenAIResponsesOptions } from "./providers/openai-responses.js";
import { createVertexAnthropicModel } from "./providers/vertex-anthropic.js";
import { createVertexAuthFetch, resolveVertexSurface, stripPublisherPath, toVertexPublisherModel, vertexOpenAIBaseUrl } from "../agent/vertex-surface.js";
import { createRetryingFetch } from "./retry.js";
import type { ProviderModel } from "./types.js";

export type ProviderModelOptions = {
  apiKey?: string | (() => Promise<string>);
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
  fetch?: typeof fetch;
  reasoningEffort?: string;
  extraBody?: Record<string, unknown>;
  useResponsesApi?: boolean;
  region?: string;
  streamIdleTimeout?: number;
  googleBearerToken?: string | (() => Promise<string>);
  projectId?: string;
  location?: string;
  maxOutputTokens?: number;
  maxRetries?: number;
};

/** The single model-construction boundary for OpenWiki agents. */
export function createProviderModel(
  provider: OpenWikiProvider,
  modelId: string,
  options: ProviderModelOptions = {},
): ProviderModel {
  const fetchWithRetry = createRetryingFetch(options.fetch, options.maxRetries ?? 2);
  if (provider === "anthropic") {
    return createAnthropicModel({ ...options, fetch: fetchWithRetry } as AnthropicOptions);
  }
  if (provider === "bedrock") {
    return createBedrockModel(options as BedrockOptions);
  }
  if (provider === "gemini-enterprise") {
    if (!options.projectId || !options.location) {
      throw new Error("Gemini Enterprise requires a Google Cloud project and location.");
    }
    const surface = resolveVertexSurface(modelId);
    if (surface === "anthropic") {
      return createVertexAnthropicModel({
        projectId: options.projectId,
        location: options.location,
        maxOutputTokens: options.maxOutputTokens,
        maxRetries: options.maxRetries,
      });
    }
    if (surface === "openai-maas") {
      return withModelId(createOpenAICompatibleModel({
        baseUrl: vertexOpenAIBaseUrl(options.projectId, options.location),
        fetch: createRetryingFetch(options.fetch ?? createVertexAuthFetch(), options.maxRetries ?? 2),
        providerName: provider,
      }), toVertexPublisherModel(modelId));
    }
    const host = options.location === "global" ? "aiplatform.googleapis.com" : `${options.location}-aiplatform.googleapis.com`;
    const baseUrl = `https://${host}/v1/projects/${options.projectId}/locations/${options.location}/publishers/google`;
    return withModelId(createGoogleModel({
      baseUrl,
      bearerToken: options.googleBearerToken,
      fetch: createRetryingFetch(options.fetch ?? createVertexAuthFetch(), options.maxRetries ?? 2),
    }), stripPublisherPath(modelId));
  }
  if (provider === "gemini") {
    return createGoogleModel({
      apiKey: typeof options.apiKey === "string" ? options.apiKey : undefined,
      baseUrl: options.baseUrl,
      bearerToken: options.googleBearerToken,
      fetch: fetchWithRetry,
    } as GoogleModelOptions);
  }
  if (provider === "openai-chatgpt" || options.useResponsesApi) {
    return createOpenAIResponsesModel({ ...options, fetch: fetchWithRetry } as OpenAIResponsesOptions);
  }
  const compatibleOptions: OpenAICompatibleOptions = {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    defaultHeaders: options.defaultHeaders,
    fetch: fetchWithRetry,
    providerName: provider,
    reasoningEffort: options.reasoningEffort,
    extraBody: options.extraBody,
  };
  return createOpenAICompatibleModel(compatibleOptions);
}

function withModelId(model: ProviderModel, modelId: string): ProviderModel {
  return {
    generate: (request) => model.generate({ ...request, modelId }),
    stream: (request) => model.stream({ ...request, modelId }),
  };
}
