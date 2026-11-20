import { createHash } from "node:crypto";
import path from "node:path";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { createOpenWikiConnectorTools } from "../connectors/tools.js";
import {
  DEBUG_ENV_KEYS,
  loadOpenWikiEnv,
  openWikiEnvDir,
  saveOpenWikiEnv,
} from "../config/env.js";
import {
  sanitizeDiagnosticText,
  SECRET_KEY_PATTERN_SOURCE,
} from "../platform/diagnostics.js";
import {
  openWikiHomeDisplayPath,
  openWikiLocalWikiDir,
} from "../config/openwiki-home.js";
import { requireResolvedLanguage } from "../platform/language.js";
import {
  resolveConceptTypeLabel,
  resolveIndexLabels,
} from "../okf/index-labels.js";
import { OpenWikiLocalShellBackend } from "./docs-only-backend.js";
import { getSelectedModelAvailability } from "../model-availability.js";
import {
  CODEX_ORIGINATOR,
  CODEX_RESPONSES_BASE_URL,
  codexTokensToEnv,
  createCodexFetch,
  isChatGptTokenExpired,
  readCodexTokensFromEnv,
  refreshChatGptTokens,
} from "./openai-chatgpt-oauth.js";
import { createBobFetch } from "./bob.js";
import { createEntraTokenProvider } from "./entra-auth.js";
import { createSystemPrompt, createUserPrompt } from "./prompt.js";
import { syncBundledSkills } from "./skills.js";
import { createAgentBackend } from "./agent-backend.js";
import { runNativeRepositoryGeneration } from "./repository-runner.js";
import {
  createVertexAuthFetch,
  resolveVertexSurface,
  stripPublisherPath,
  toVertexPublisherModel,
  vertexOpenAIBaseUrl,
  withAnthropicAuthEnvNeutralized,
} from "./vertex-surface.js";
import type {
  OpenWikiCommand,
  OpenWikiOutputMode,
  OpenWikiRunEvent,
  OpenWikiRunOptions,
  OpenWikiRunResult,
  RunContext,
} from "./types.js";
import {
  ANTHROPIC_BASE_URL_ENV_KEY,
  BASETEN_BASE_URL_ENV_KEY,
  BEDROCK_AWS_ACCESS_KEY_ID_ENV_KEY,
  BEDROCK_AWS_REGION_ENV_KEY,
  BEDROCK_AWS_SECRET_ACCESS_KEY_ENV_KEY,
  BEDROCK_AWS_SESSION_TOKEN_ENV_KEY,
  COPILOT_BASE_URL_ENV_KEY,
  DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS,
  getDefaultModelId,
  getMissingProviderEnvKey,
  getProviderApiKeyEnvKey,
  getProviderBaseUrlEnvKey,
  getProviderCredentialHint,
  getProviderLabel,
  getProviderBaseUrlWarnings,
  getProviderFixedModel,
  getProviderModelOptions,
  FIREWORKS_BASE_URL_ENV_KEY,
  getProviderRegionEnvKeys,
  getProviderSecretKeyEnvKey,
  getProvidersForKnownModelId,
  isModelIdForOtherProvider,
  DEFAULT_VERTEX_LOCATION,
  GOOGLE_CLOUD_PROJECT_ENV_KEY,
  isValidModelId,
  normalizeModelId,
  NVIDIA_BASE_URL_ENV_KEY,
  OPENAI_BASE_URL_ENV_KEY,
  OPENAI_COMPATIBLE_AUTH_ENV_KEY,
  OPENAI_COMPATIBLE_BASE_URL_ENV_KEY,
  OPENAI_COMPATIBLE_ENTRA_SCOPE_ENV_KEY,
  OPENAI_COMPATIBLE_STREAMING_ENV_KEY,
  OPENROUTER_API_KEY_ENV_KEY,
  OPENROUTER_BASE_URL,
  OPENWIKI_MAX_OUTPUT_TOKENS_ENV_KEY,
  OPENWIKI_MODEL_ID_ENV_KEY,
  OPENWIKI_OPENROUTER_MAX_TOKENS_ENV_KEY,
  OPENWIKI_PROVIDER_ENV_KEY,
  OPENWIKI_PROVIDER_RETRY_ATTEMPTS_ENV_KEY,
  OPENWIKI_STREAM_IDLE_TIMEOUT_ENV_KEY,
  providerRequiresBaseUrl,
  providerRequiresRegion,
  providerRequiresSecretKey,
  providerUsesAwsSdkCredentials,
  providerUsesEntraId,
  providerUsesExternalCliAuth,
  providerUsesResponsesApi,
  providerUsesStreaming,
  resolveConfiguredMaxOutputTokens,
  resolveConfiguredProvider,
  resolveOpenAiCompatibleStreamMessages,
  resolveOpenAICompatibleEntraScope,
  resolveOpenRouterMaxTokens,
  resolveOpenRouterProviderOnly,
  resolveProviderBaseUrl,
  resolveProviderLocation,
  resolveProviderRegion,
  resolvePageConcurrency,
  resolveProviderRetryAttempts,
  resolveStreamIdleTimeoutForProvider,
  type OpenWikiProvider,
} from "../config/constants.js";
import { resolveReasoningConfig } from "../config/reasoning.js";
import {
  resolveExternalCliCredential,
  validateExternalCliCredential,
} from "../auth/external-cli-auth.js";
import {
  createOpenWikiContentSnapshot,
  createRunContext,
  persistRunMetadataIfChanged,
} from "./utils.js";
import { clearActiveRun, registerActiveRun } from "./crash-guard.js";
import { inStage, inStageSync, tagErrorStage } from "../telemetry/index.js";
import type { RunTelemetryContext } from "../telemetry/index.js";
import { OpenWikiIgnore } from "./openwiki-ignore.js";
import type { ProviderModel, ModelMessage } from "../model/types.js";
import { createProviderModel } from "../model/registry.js";
import type { AgentLoopResult } from "./agent-loop.js";
import { runAgentLoop } from "./agent-loop.js";
import { createAgentTools } from "./tool-runtime.js";
import { readChatHistory, writeChatHistory } from "./chat-history.js";
import { prepareOpenWikiIndex, finalizeOpenWikiIndex } from "./okf-middleware.js";
import { resolveTranslationPlan, translateWikiForRun } from "./translation-middleware.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getStringRecordValue(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const result = value[key];
  return typeof result === "string" ? result : undefined;
}

export {
  createAgentBackend,
};

export async function runOpenWikiAgent(
  command: OpenWikiCommand,
  cwd = openWikiLocalWikiDir,
  options: OpenWikiRunOptions = {},
  telemetryContext: RunTelemetryContext = {},
): Promise<OpenWikiRunResult> {
  const outputMode = options.outputMode ?? "local-wiki";
  const runtimeCwd = options.outputMode ? cwd : openWikiLocalWikiDir;
  const runTimestamp = new Date().toISOString();

  emitDebug(options, `command=${command}`);
  emitDebug(options, `cwd=${runtimeCwd}`);
  emitDebug(
    options,
    `userMessage=${options.userMessage ? "provided" : "not-provided"}`,
  );
  emitDebug(options, `userMessage.followup=${options.isFollowup === true}`);
  emitDebug(options, `env.beforeLoad ${formatEnvironmentDebug()}`);

  await loadOpenWikiEnv();
  await syncBundledSkills();
  emitDebug(options, `env=loaded ${openWikiHomeDisplayPath}/.env`);
  emitDebug(options, `env.afterLoad ${formatEnvironmentDebug()}`);

  const isRepositoryGeneration =
    outputMode === "repository" && (command === "init" || command === "update");

  if (isRepositoryGeneration) {
    const debugFetchCapture = installOpenRouterDebugFetch(options);
    try {
      const config = await resolveRunConfig(options, (resolved) => {
        telemetryContext.provider = resolved;
      });
      debugFetchCapture.setRetryAttempts(config.providerRetryAttempts);
      const model = inStageSync(
        "build",
        () =>
          createProviderModelForRun(
            config.provider,
            config.modelId,
            config.providerRetryAttempts,
            config.maxOutputTokens,
            config.streamIdleTimeout,
          ),
        { errorClass: "build_error", errorDetail: "model" },
      );
      const generation = await inStage(
        "run",
        () =>
          runNativeRepositoryGeneration({
            root: runtimeCwd,
            mode: command,
            language: options.language,
            force: Boolean(options.userMessage?.trim()),
            planningContext: options.userMessage,
            modelId: config.modelId,
            model,
            pageConcurrency: config.pageConcurrency,
            onEvent: options.onEvent,
          }),
        { errorClass: "agent_error" },
      );

      if (generation.skipped) {
        telemetryContext.outcome = "noop";
      }

      return {
        command,
        model: config.modelId,
        ...(generation.skipped ? { skipped: true } : {}),
      };
    } catch (error) {
      attachOpenRouterDebugInfo(error, debugFetchCapture.getLastFailure());
      throw error;
    } finally {
      debugFetchCapture.restore();
    }
  }

  const openWikiIgnore =
    outputMode === "repository"
      ? await OpenWikiIgnore.load(runtimeCwd)
      : new OpenWikiIgnore([]);
  emitDebug(
    options,
    `openwikiignore.patterns=${openWikiIgnore.patterns.length}`,
  );

  const debugFetchCapture = installOpenRouterDebugFetch(options);

  try {
    // Published onto the shared context the instant the provider is resolved, so a
    // failure later in the run still attributes the provider. It stays undefined
    // only if the very first resolution step throws. The single telemetry boundary
    // (withRunTelemetry) reads this context to record the run.
    const config = await resolveRunConfig(options, (resolved) => {
      telemetryContext.provider = resolved;
    });
    debugFetchCapture.setRetryAttempts(config.providerRetryAttempts);

    return await runOpenWikiAgentCore(
      command,
      runtimeCwd,
      options,
      config.provider,
      config.modelId,
      config.providerRetryAttempts,
      config.maxOutputTokens,
      config.streamIdleTimeout,
      openWikiIgnore,
      runTimestamp,
    );
  } catch (error) {
    // Enrich the error for the CLI's debug/auth UI, then rethrow. The telemetry
    // record is owned by withRunTelemetry, which reads the stage/class tags this
    // error already carries.
    attachOpenRouterDebugInfo(error, debugFetchCapture.getLastFailure());

    throw error;
  } finally {
    debugFetchCapture.restore();
  }
}

/**
 * Resolves everything the run needs before the agent is built: provider,
 * credentials, model id, and retry count. Any throw here is tagged `config` so
 * the failure telemetry locates it to the resolution stage. `onProviderResolved`
 * fires the moment the provider is known, letting the caller attribute a failure
 * that happens later in resolution to the right provider.
 */
async function resolveRunConfig(
  options: OpenWikiRunOptions,
  onProviderResolved: (provider: OpenWikiProvider) => void,
): Promise<{
  provider: OpenWikiProvider;
  modelId: string;
  providerRetryAttempts: number;
  pageConcurrency: number;
  maxOutputTokens: number | undefined;
  streamIdleTimeout: number | undefined;
}> {
  try {
    const provider = resolveConfiguredProvider();
    onProviderResolved(provider);

    const providerBaseUrl = resolveProviderBaseUrl(provider);
    emitDebug(options, `provider=${provider}`);
    if (providerBaseUrl) {
      emitDebug(
        options,
        `provider.baseUrl=${formatUrlDebugValue(providerBaseUrl)}`,
      );
    }
    await resolveExternalCliCredential(provider);
    const providerApiKey = getProviderApiKey(provider);
    if (providerUsesExternalCliAuth(provider) && providerApiKey) {
      validateExternalCliCredential(provider, providerApiKey);
    }
    ensureProviderCredentials(provider);
    emitDebug(
      options,
      providerUsesAwsSdkCredentials(provider)
        ? `credentials=${provider} delegated-to-aws-sdk`
        : `credentials=${provider} present`,
    );
    ensureProviderBaseUrl(provider);
    ensureProviderSecretKey(provider);
    ensureProviderRegion(provider);

    if (provider === "openai-chatgpt") {
      // Refresh before the model is built, so provider model creation stays synchronous.
      await ensureFreshChatGptTokens();
      emitDebug(options, "chatgpt.token=fresh");
    }

    const modelId = resolveModelId(options, provider);
    emitDebug(options, `model=${modelId}`);
    const modelAvailability = await getSelectedModelAvailability({
      provider,
      modelId,
      apiKey: getProviderApiKey(provider),
      baseUrl: providerBaseUrl,
    });
    if (modelAvailability.status === "unavailable") {
      throw new Error(
        `${getProviderLabel(provider)} does not make model "${modelId}" available to the configured credentials. Set ${OPENWIKI_MODEL_ID_ENV_KEY} to an available model.`,
      );
    }
    if (modelAvailability.status === "unknown") {
      emitDebug(
        options,
        `model.availability=unknown${
          modelAvailability.reason ? ` reason=${modelAvailability.reason}` : ""
        }`,
      );
    }
    const pageConcurrency = resolvePageConcurrency();
    emitDebug(options, `generation.pageConcurrency=${pageConcurrency}`);
    const providerRetryAttempts = resolveProviderRetryAttempts(process.env, {
      pageConcurrency,
    });
    emitDebug(options, `provider.retryAttempts=${providerRetryAttempts}`);
    const maxOutputTokens = resolveConfiguredMaxOutputTokens(provider);
    emitDebug(
      options,
      `model.maxOutputTokens=${maxOutputTokens ?? "provider-default"}`,
    );
    const streamIdleTimeout = resolveStreamIdleTimeoutForProvider(provider);
    emitDebug(
      options,
      `model.streamIdleTimeout=${streamIdleTimeout ?? "provider-default"}`,
    );

    return {
      provider,
      modelId,
      providerRetryAttempts,
      pageConcurrency,
      maxOutputTokens,
      streamIdleTimeout,
    };
  } catch (error) {
    tagErrorStage(error, "config");
    throw error;
  }
}

export type OpenWikiAgentOptions = {
  command: OpenWikiCommand;
  cwd: string;
  language?: string | null;
  model: ProviderModel;
  modelId: string;
  onEvent?: (event: OpenWikiRunEvent) => void;
  outputMode: OpenWikiOutputMode;
  maxOutputTokens?: number;
  reasoningEffort?: string;
  runTimestamp: string;
};

export type OpenWikiAgent = {
  run(messages: ModelMessage[], signal?: AbortSignal): Promise<AgentLoopResult>;
};

/** Creates an OpenWiki-owned agent session over the confined filesystem backend. */
export async function createOpenWikiAgent(
  options: OpenWikiAgentOptions,
): Promise<OpenWikiAgent> {
  if (!path.isAbsolute(options.cwd)) {
    throw new Error("OpenWiki agent cwd must be an absolute path.");
  }
  if (options.outputMode === "repository" && options.command !== "chat") {
    throw new Error("Repository init/update use the page-job runner; call runOpenWikiAgent instead.");
  }
  await syncBundledSkills();
  const openWikiIgnore = options.outputMode === "repository"
    ? await OpenWikiIgnore.load(options.cwd)
    : new OpenWikiIgnore([]);
  const context = await createRunContext(options.cwd, options.outputMode, options.language);
  const wikiBackend = new OpenWikiLocalShellBackend({
    docsOnly: options.command !== "chat",
    openWikiIgnore,
    maxOutputBytes: 100_000,
    outputMode: options.outputMode,
    rootDir: options.cwd,
    timeout: 120,
    virtualMode: true,
  });
  const backend = createAgentBackend(wikiBackend);
  const tools = createAgentTools(backend, options.outputMode);
  const prepared = options.command === "chat"
    ? undefined
    : await prepareOpenWikiIndex(wikiBackend, options.outputMode, undefined, undefined, options.runTimestamp);
  const system = createSystemPrompt(options.command, options.outputMode, context.language, openWikiIgnore);
  const translationPlan = resolveTranslationPlan(options.command, options.language ?? undefined, context.language ?? undefined);
  return {
    run: async (messages, signal) => {
      if (translationPlan) {
        await translateWikiForRun(
          wikiBackend,
          options.outputMode,
          options.model,
          translationPlan,
          (message) => {
            options.onEvent?.({ type: "text", text: message });
            process.stderr.write(`${message}\n`);
          },
          (message) => {
            options.onEvent?.({ type: "text", text: message });
            process.stderr.write(`${message}\n`);
          },
        );
      }
      const result = await runAgentLoop({
        model: options.model,
        modelId: options.modelId,
        messages: [{ role: "system", content: system }, ...messages],
        tools,
        signal,
        maxOutputTokens: options.maxOutputTokens,
        reasoningEffort: options.reasoningEffort,
        onEvent: (event) => {
          if (event.type === "text") options.onEvent?.({ type: "text", text: event.text });
        },
      });
      if (prepared) await finalizeOpenWikiIndex(wikiBackend, options.outputMode, prepared, undefined, undefined, options.runTimestamp);
      return result;
    },
  };
}
async function runOpenWikiAgentCore(
  command: OpenWikiCommand,
  cwd: string,
  options: OpenWikiRunOptions,
  provider: OpenWikiProvider,
  modelId: string,
  providerRetryAttempts: number,
  maxOutputTokens: number | undefined,
  streamIdleTimeout: number | undefined,
  openWikiIgnore: OpenWikiIgnore,
  runTimestamp: string,
): Promise<OpenWikiRunResult> {
  const outputMode = options.outputMode ?? "local-wiki";
  const context = await inStage("build", () => createRunContext(cwd, outputMode, options.language), {
    errorClass: "build_error", errorDetail: "run_context",
  });
  emitDebug(options, "context=created");
  const snapshotBefore = command === "chat" ? null : await inStage(
    "build", () => createOpenWikiContentSnapshot(cwd, outputMode),
    { errorClass: "build_error", errorDetail: "snapshot" },
  );
  const model = inStageSync("build", () => createProviderModelForRun(
    provider, modelId, providerRetryAttempts, maxOutputTokens, streamIdleTimeout,
  ), { errorClass: "build_error", errorDetail: "model" });
  const threadId = options.threadId ?? createThreadId(cwd, createRunThreadId());
  const history = command === "chat" && options.isFollowup === true
    ? await readChatHistory(threadId)
    : [];
  const messages: ModelMessage[] = [...history, {
    role: "user",
    content: createRunUserMessage(command, cwd, context, options),
  }];
  const agent = await createOpenWikiAgent({
    command, cwd, language: options.language, model, modelId, onEvent: options.onEvent, outputMode,
    maxOutputTokens: provider === "openrouter" ? (resolveOpenRouterMaxTokens() ?? maxOutputTokens) : maxOutputTokens,
    reasoningEffort: resolveReasoningConfig(provider, modelId, process.env, {
      useResponsesApi: providerUsesResponsesApi(provider, modelId),
    })?.effort,
    runTimestamp,
  });
  registerActiveRun({
    command, cwd, modelId, outputMode,
    snapshotBefore: snapshotBefore ?? undefined,
    language: context.language,
  });
  try {
    const result = await inStage("run", () => agent.run(messages), { errorClass: "agent_error" });
    if (command === "chat") {
      await writeChatHistory(threadId, result.messages);
    }
    clearActiveRun();
    const metadataWritten = await persistRunMetadataIfChanged(
      command, cwd, modelId, outputMode, snapshotBefore, "complete", context.language,
    );
    emitDebug(options, metadataWritten ? "metadata=written" : "metadata=skipped");
    return { command, model: modelId };
  } catch (error) {
    tagErrorStage(error, "run");
    clearActiveRun();
    if (command !== "chat") {
      await persistRunMetadataIfChanged(
        command, cwd, modelId, outputMode, snapshotBefore, "interrupted", context.language,
      ).catch(() => undefined);
    }
    throw error;
  }
}
function createProviderModelForRun(
  provider: OpenWikiProvider,
  modelId: string,
  maxRetries: number,
  maxOutputTokens: number | undefined,
  streamIdleTimeout: number | undefined,
): ProviderModel {
  const bindModelId = (model: ProviderModel): ProviderModel => Object.assign(model, {
    modelId,
    defaultMaxOutputTokens: maxOutputTokens,
    defaultReasoningEffort: reasoningEffort,
  });
  const baseUrl = resolveProviderBaseUrl(provider);
  const useResponsesApi = providerUsesResponsesApi(provider, modelId);
  const reasoningEffort = resolveReasoningConfig(provider, modelId, process.env, { useResponsesApi })?.effort;
  const common = { maxRetries, maxOutputTokens, reasoningEffort };

  if (provider === "openai-chatgpt") {
    const tokens = readCodexTokensFromEnv();
    if (!tokens) throw new Error(CHATGPT_LOGIN_INCOMPLETE_MESSAGE);
    return bindModelId(createProviderModel(provider, modelId, {
      ...common,
      apiKey: tokens.access,
      baseUrl: CODEX_RESPONSES_BASE_URL,
      defaultHeaders: {
        "chatgpt-account-id": tokens.accountId,
        originator: CODEX_ORIGINATOR,
        "OpenAI-Beta": "responses=experimental",
      },
      fetch: createCodexFetch(modelId),
      useResponsesApi: true,
    }));
  }
  if (provider === "gemini-enterprise") {
    const projectId = process.env[GOOGLE_CLOUD_PROJECT_ENV_KEY];
    if (!projectId) throw new Error(`${GOOGLE_CLOUD_PROJECT_ENV_KEY} is required for the gemini-enterprise provider.`);
    return bindModelId(createProviderModel(provider, modelId, {
      ...common, projectId,
      location: resolveProviderLocation(provider) ?? DEFAULT_VERTEX_LOCATION,
      fetch: createVertexAuthFetch(), streamIdleTimeout,
    }));
  }
  if (provider === "bedrock") {
    return bindModelId(createProviderModel(provider, modelId, { ...common, region: resolveProviderRegion(provider), streamIdleTimeout }));
  }
  if (provider === "anthropic") {
    return bindModelId(createProviderModel(provider, modelId, {
      ...common, apiKey: getProviderApiKey(provider), baseUrl,
      maxOutputTokens: resolveAnthropicMaxOutputTokens(modelId, maxOutputTokens),
    }));
  }
  if (provider === "gemini") {
    return bindModelId(createProviderModel(provider, modelId, { ...common, apiKey: getProviderApiKey(provider), baseUrl }));
  }
  if (provider === "openrouter") {
    const providerOnly = resolveOpenRouterProviderOnly();
    return bindModelId(createProviderModel(provider, modelId, {
      ...common,
      apiKey: process.env[OPENROUTER_API_KEY_ENV_KEY],
      baseUrl: OPENROUTER_BASE_URL,
      defaultHeaders: { "HTTP-Referer": "https://github.com/langchain-ai/openwiki", "X-Title": "OpenWiki" },
      extraBody: providerOnly ? { provider: { only: providerOnly } } : undefined,
    }));
  }
  if (provider === "bob") {
    return bindModelId(createProviderModel(provider, modelId, {
      ...common, apiKey: "bob-placeholder",
      baseUrl: baseUrl ?? "https://api.us-east.bob.ibm.com/inference/v1",
      fetch: createBobFetch(),
    }));
  }
  const apiKey = providerUsesEntraId(provider)
    ? createEntraTokenProvider(baseUrl, resolveOpenAICompatibleEntraScope())
    : getProviderApiKey(provider);
  return bindModelId(createProviderModel(provider, modelId, {
    ...common, apiKey, baseUrl,
    fetch: provider === "openai-compatible" && !useResponsesApi ? createOpenAiCompatibleFetch() : undefined,
    useResponsesApi,
  }));
}

/**
 * Builds the initial user message for a production run.
 *
 * @param command - Current OpenWiki command.
 * @param cwd - Absolute runtime root.
 * @param context - Persisted run context.
 * @param options - User-supplied run options.
 * @returns Follow-up text or a fully populated command prompt.
 */
function createRunUserMessage(
  command: OpenWikiCommand,
  cwd: string,
  context: Awaited<ReturnType<typeof createRunContext>>,
  options: OpenWikiRunOptions,
): string {
  if (options.isFollowup === true && options.userMessage?.trim()) {
    return options.userMessage.trim();
  }

  return createUserPrompt(
    command,
    context,
    options.userMessage ?? null,
    options.outputMode ?? "local-wiki",
    cwd,
  );
}

export function createOpenWikiThreadId(cwd = process.cwd()): string {
  return createThreadId(cwd, createRunThreadId());
}

function createThreadId(cwd: string, runId: string): string {
  const digest = createHash("sha256").update(path.resolve(cwd)).digest("hex");

  return `openwiki-${digest.slice(0, 32)}-${runId}`;
}

function createRunThreadId(): string {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function emitDebug(options: OpenWikiRunOptions, message: string): void {
  if (!options.debug) {
    return;
  }

  options.onEvent?.({
    type: "debug",
    message,
  });
}

function ensureProviderCredentials(provider: OpenWikiProvider): void {
  const missingEnvKey = getMissingProviderEnvKey(provider);

  if (!missingEnvKey) {
    return;
  }

  const hint = getProviderCredentialHint(provider);

  throw new Error(
    `${missingEnvKey} is required to run OpenWiki with ${getProviderLabel(provider)}.${
      hint ? ` ${hint}` : ""
    }`,
  );
}

function ensureProviderBaseUrl(provider: OpenWikiProvider): void {
  const baseUrlEnvKey = getProviderBaseUrlEnvKey(provider) ?? "base URL";
  const baseUrl = resolveProviderBaseUrl(provider);

  if (!baseUrl) {
    if (providerRequiresBaseUrl(provider)) {
      throw new Error(
        `${baseUrlEnvKey} is required to run OpenWiki with ${getProviderLabel(provider)}.`,
      );
    }

    return;
  }

  const warnings = getProviderBaseUrlWarnings(provider, baseUrl);
  if (warnings.length > 0) {
    throw new Error(`${baseUrlEnvKey} is invalid: ${warnings.join(", ")}.`);
  }
}

function ensureProviderSecretKey(provider: OpenWikiProvider): void {
  if (!providerRequiresSecretKey(provider)) {
    return;
  }

  const secretKeyEnvKey = getProviderSecretKeyEnvKey(provider);

  if (secretKeyEnvKey && !process.env[secretKeyEnvKey]) {
    throw new Error(
      `${secretKeyEnvKey} is required to run OpenWiki with ${getProviderLabel(provider)}.`,
    );
  }
}

function ensureProviderRegion(provider: OpenWikiProvider): void {
  if (!providerRequiresRegion(provider)) {
    return;
  }

  if (!resolveProviderRegion(provider)) {
    const regionEnvKeys = getProviderRegionEnvKeys(provider);
    const regionRequirement =
      regionEnvKeys.length > 0 ? regionEnvKeys.join(", ") : "region";

    throw new Error(
      `One of ${regionRequirement} is required to run OpenWiki with ${getProviderLabel(provider)}.`,
    );
  }
}

export function resolveModelId(
  options: OpenWikiRunOptions,
  provider: OpenWikiProvider,
): string {
  const fixedModel = getProviderFixedModel(provider);
  if (fixedModel) {
    return fixedModel;
  }

  const configuredModelId =
    options.modelId ?? process.env[OPENWIKI_MODEL_ID_ENV_KEY];

  if (!configuredModelId && getProviderModelOptions(provider).length === 0) {
    throw new Error(
      `${OPENWIKI_MODEL_ID_ENV_KEY} is required to run OpenWiki with ${getProviderLabel(provider)}.`,
    );
  }

  const modelId = normalizeModelId(
    configuredModelId ?? getDefaultModelId(provider),
  );

  if (!isValidModelId(modelId)) {
    throw new Error(
      `Invalid model ID configured in ${OPENWIKI_MODEL_ID_ENV_KEY}.`,
    );
  }

  warnOnProviderModelMismatch(options, provider, modelId);

  return modelId;
}

// Non-fatal: if the configured model is a known model of a different provider
// (e.g. an Anthropic model left in OPENWIKI_MODEL_ID while the provider is now
// OpenAI), surface an actionable warning instead of letting the request fail
// later with an opaque provider-side 400/404. The run still proceeds, since a
// custom endpoint or gateway may legitimately serve the model.
function warnOnProviderModelMismatch(
  options: OpenWikiRunOptions,
  provider: OpenWikiProvider,
  modelId: string,
): void {
  if (!isModelIdForOtherProvider(modelId, provider)) {
    return;
  }

  const otherProviders = getProvidersForKnownModelId(modelId, provider)
    .map((otherProvider) => getProviderLabel(otherProvider))
    .join(", ");
  const message =
    `Warning: model "${modelId}" is not a known ${getProviderLabel(provider)} model ` +
    `(it belongs to ${otherProviders}). The request may fail. ` +
    `Set ${OPENWIKI_MODEL_ID_ENV_KEY} to a ${getProviderLabel(provider)} model, or switch providers.`;

  emitDebug(options, `model.mismatch provider=${provider} model=${modelId}`);
  options.onEvent?.({ type: "text", text: message });
  // Also emit to stderr so the warning survives on failure, where the TUI
  // re-renders the log away and --print discards buffered streamed text.
  process.stderr.write(`${message}\n`);
}

function createOpenAiCompatibleFetch(): typeof fetch {
  return (input, init) =>
    globalThis.fetch(
      input,
      normalizeOpenAiCompatibleChatCompletionsInit(input, init) ?? init,
    );
}

function normalizeOpenAiCompatibleChatCompletionsInit(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): Parameters<typeof fetch>[1] | null {
  if (!isOpenAiCompatibleChatCompletionsRequest(input, init)) {
    return null;
  }

  const body = typeof init?.body === "string" ? init.body : null;
  const parsedBody = parseJsonRecord(body);
  const normalizedBody =
    parsedBody === null
      ? null
      : normalizeOpenAiCompatibleChatCompletionsBody(parsedBody);

  return normalizedBody === null
    ? null
    : {
        ...init,
        body: JSON.stringify(normalizedBody),
      };
}

function isOpenAiCompatibleChatCompletionsRequest(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): boolean {
  const method = init?.method;

  if (method !== undefined && method.toUpperCase() !== "POST") {
    return false;
  }

  const url = getFetchInputUrl(input);

  if (url === null) {
    return false;
  }

  try {
    return new URL(url).pathname.endsWith("/chat/completions");
  } catch {
    return url.includes("/chat/completions");
  }
}

function normalizeOpenAiCompatibleChatCompletionsBody(
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  const messages = body.messages;

  if (!Array.isArray(messages)) {
    return null;
  }

  let changed = false;
  const normalizedMessages = (messages as unknown[]).map((message) => {
    if (!isRecord(message)) {
      return message;
    }

    const content = normalizeOpenAiCompatibleTextContent(message.content);

    if (content === null) {
      return message;
    }

    changed = true;
    return { ...message, content };
  });

  return changed ? { ...body, messages: normalizedMessages } : null;
}

function normalizeOpenAiCompatibleTextContent(
  content: unknown,
): Record<string, unknown>[] | null {
  if (!Array.isArray(content) || content.length !== 1) {
    return null;
  }

  const [nestedContent] = content as unknown[];

  if (!Array.isArray(nestedContent) || nestedContent.length === 0) {
    return null;
  }

  return nestedContent.every(isOpenAiCompatibleTextContentBlock)
    ? nestedContent
    : null;
}

function isOpenAiCompatibleTextContentBlock(
  block: unknown,
): block is Record<string, unknown> {
  return (
    isRecord(block) && block.type === "text" && typeof block.text === "string"
  );
}

const CHATGPT_LOGIN_INCOMPLETE_MESSAGE =
  "ChatGPT login is incomplete. Run `openwiki code --init` or `openwiki personal --init` to sign in with your ChatGPT account.";

/**
 * Refreshes the persisted ChatGPT OAuth tokens once at startup when they are
 * expired/near-expiry, writing the rotated tokens back to `~/.openwiki/.env`
 * (which also updates `process.env`, so provider model creation can stay synchronous).
 * This is a short-lived CLI process, so a single refresh-at-startup is enough:
 * there is no background refresh loop.
 */
async function ensureFreshChatGptTokens(): Promise<void> {
  const tokens = readCodexTokensFromEnv();

  if (!tokens) {
    throw new Error(CHATGPT_LOGIN_INCOMPLETE_MESSAGE);
  }

  if (!isChatGptTokenExpired(tokens.expiresAtMs)) {
    return;
  }

  await saveOpenWikiEnv(
    codexTokensToEnv(await refreshChatGptTokens(tokens.refresh)),
  );
}

function getProviderApiKey(provider: OpenWikiProvider): string | undefined {
  const apiKeyEnvKey = getProviderApiKeyEnvKey(provider);

  return apiKeyEnvKey ? process.env[apiKeyEnvKey] : undefined;
}

// Placeholder OpenAI API key for the Vertex MaaS surface; overwritten per
// request by the auth fetch's Authorization header (see createVertexAuthFetch).
type OpenRouterFetchCapture = {
  clearLastFailure: () => void;
  getLastFailure: () => OpenRouterFetchFailure | null;
  restore: () => void;
  setRetryAttempts: (retryAttempts: number) => void;
};

type OpenRouterFetchOptions = {
  sleep?: (ms: number) => Promise<void>;
};

type OpenRouterFetchFailure = {
  fetchError?: string;
  request: OpenRouterRequestSummary;
  response?: OpenRouterResponseSummary;
};

type OpenRouterRequestSummary = {
  bodyBytes?: number;
  messageChars?: number;
  messageCount?: number;
  method: string;
  model?: string;
  stream?: boolean;
  toolCount?: number;
  toolNames?: string[];
  url: string;
};

type OpenRouterResponseSummary = {
  bodyPreview: string;
  headers: Record<string, string>;
  malformedReason?: string;
  status: number;
  statusText: string;
  upstreamStatus?: number;
  upstreamStatusText?: string;
};

const OPENROUTER_DEBUG_PROPERTY = "openRouterDebug";
const OPENROUTER_DEBUG_BODY_LIMIT = 4_000;

/**
 * Per-run sink for the most recent OpenRouter HTTP failure. Each run registers
 * its own so concurrent runs don't share (or clobber) each other's captured
 * failure. `ChatOpenRouter` (unlike the OpenAI/Codex/Vertex clients) extends
 * the previous provider model and calls `globalThis.fetch` directly with no injectable
 * fetch, so a global wrapper is the only interception point — hence the
 * reference-counted installer below rather than a per-model `configuration.fetch`.
 */
type OpenRouterFetchSink = {
  lastFailure: OpenRouterFetchFailure | null;
  options: OpenWikiRunOptions;
  retryAttempts: number;
  sleep: (ms: number) => Promise<void>;
};

const activeOpenRouterSinks = new Set<OpenRouterFetchSink>();
let openRouterOriginalFetch: typeof fetch | null = null;
const OPENROUTER_PROVIDER_ERROR_RETRY_BASE_DELAY_MS = 1_000;
const OPENROUTER_PROVIDER_ERROR_RETRY_MAX_DELAY_MS = 30_000;

function resolveAnthropicMaxOutputTokens(
  modelId: string,
  configuredMaxOutputTokens: number | undefined,
): number | undefined {
  if (configuredMaxOutputTokens !== undefined) return configuredMaxOutputTokens;
  return /^claude-(?:haiku|sonnet|opus)-(?:4|5)(?:[-.@]|$)/u.test(modelId)
    ? DEFAULT_ANTHROPIC_MAX_OUTPUT_TOKENS
    : undefined;
}

function openRouterDebugFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  // Captured when the wrapper was installed; the wrapper is only live while at
  // least one sink is registered, so this is always set here.
  const baseFetch = openRouterOriginalFetch ?? globalThis.fetch;

  if (!isOpenRouterFetchInput(input)) {
    return baseFetch(input, init);
  }

  const request = summarizeOpenRouterRequest(input, init);

  const recordFailure = (failure: OpenRouterFetchFailure): void => {
    for (const sink of activeOpenRouterSinks) {
      sink.lastFailure = failure;
    }
  };

  return (async () => {
    let attempt = 0;

    try {
      while (true) {
        const response = await baseFetch(input, init);

        if (response.ok && request.stream === false) {
          const malformedResponse =
            await createMalformedOpenRouterResponse(response);

          if (malformedResponse) {
            const body = await readResponseBody(response);
            const failure: OpenRouterFetchFailure = {
              request,
              response: {
                bodyPreview: body.preview,
                headers: getSafeResponseHeaders(response.headers),
                malformedReason: malformedResponse.reason,
                status: malformedResponse.response.status,
                statusText: malformedResponse.response.statusText,
                upstreamStatus: response.status,
                upstreamStatusText: response.statusText,
              },
            };
            recordFailure(failure);
            for (const sink of activeOpenRouterSinks) {
              emitDebug(
                sink.options,
                `openrouter.http status=${malformedResponse.response.status} statusText=${JSON.stringify(
                  malformedResponse.response.statusText,
                )} upstreamStatus=${response.status} malformed=${JSON.stringify(
                  malformedResponse.reason,
                )}`,
              );
            }

            await response.body?.cancel().catch(() => undefined);
            return malformedResponse.response;
          }
        }

        if (!response.ok) {
          const body = await readResponseBody(response);
          const failure: OpenRouterFetchFailure = {
            request,
            response: {
              bodyPreview: body.preview,
              headers: getSafeResponseHeaders(response.headers),
              status: response.status,
              statusText: response.statusText,
            },
          };
          recordFailure(failure);
          for (const sink of activeOpenRouterSinks) {
            emitDebug(
              sink.options,
              `openrouter.http status=${response.status} statusText=${JSON.stringify(
                response.statusText,
              )}`,
            );
          }

          const retry = getOpenRouterProviderErrorRetry();
          if (
            attempt < retry.maxRetries &&
            isOpenRouterRequestResendable(input, init) &&
            isTransientOpenRouterProvider404(response, body.raw)
          ) {
            attempt += 1;
            const delayMs = getOpenRouterProviderErrorRetryDelayMs(attempt);
            for (const sink of activeOpenRouterSinks) {
              emitDebug(
                sink.options,
                `openrouter.retry status=404 attempt=${attempt}/${retry.maxRetries} delayMs=${delayMs}`,
              );
            }
            await response.body?.cancel().catch(() => undefined);
            await retry.sleep(delayMs);
            continue;
          }
        }

        return response;
      }
    } catch (error) {
      recordFailure({
        fetchError: error instanceof Error ? error.message : String(error),
        request,
      });
      throw error;
    }
  })();
}

async function createMalformedOpenRouterResponse(
  response: Response,
): Promise<{ reason: string; response: Response } | null> {
  let body: unknown;

  try {
    body = await response.clone().json();
  } catch {
    return {
      reason: "invalid_json",
      response: createOpenRouterMalformedSuccessResponse(
        response,
        "the response body was not valid JSON",
      ),
    };
  }

  const reason = getMalformedOpenRouterChatCompletionReason(body);

  if (reason === null) {
    return null;
  }

  return {
    reason,
    response: createOpenRouterMalformedSuccessResponse(
      response,
      describeMalformedOpenRouterReason(reason),
    ),
  };
}

function getMalformedOpenRouterChatCompletionReason(
  body: unknown,
): string | null {
  if (!isRecord(body)) {
    return "root_not_object";
  }

  if (!Array.isArray(body.choices) || body.choices.length === 0) {
    return "missing_choices";
  }

  const firstChoice: unknown = body.choices[0];

  if (!isRecord(firstChoice)) {
    return "first_choice_not_object";
  }

  if (!isRecord(firstChoice.message)) {
    return "missing_choices_0_message";
  }

  return null;
}

function describeMalformedOpenRouterReason(reason: string): string {
  switch (reason) {
    case "root_not_object":
      return "the JSON root was not an object";
    case "missing_choices":
      return "choices was missing or empty";
    case "first_choice_not_object":
      return "choices[0] was not an object";
    case "missing_choices_0_message":
      return "choices[0].message was missing or not an object";
    default:
      return reason;
  }
}

function createOpenRouterMalformedSuccessResponse(
  upstreamResponse: Response,
  detail: string,
): Response {
  const headers = new Headers({ "content-type": "application/json" });

  for (const [key, value] of Object.entries(
    getSafeResponseHeaders(upstreamResponse.headers),
  )) {
    headers.set(key, value);
  }

  return new Response(
    JSON.stringify({
      error: {
        code: 502,
        message: `OpenRouter returned a malformed successful non-streaming chat completion response: ${detail}.`,
        metadata: {
          openwiki_reason: "malformed_success_response",
          upstream_status: upstreamResponse.status,
          upstream_status_text: upstreamResponse.statusText,
        },
      },
    }),
    {
      headers,
      status: 502,
      statusText: "Bad Gateway",
    },
  );
}

/**
 * Installs the reference-counted OpenRouter debug-fetch wrapper for one run and
 * returns that run's capture handle. Exported for testing. Safe under
 * concurrent runs: each caller gets an isolated failure sink and the global
 * `fetch` is only restored once the last run detaches.
 */
export function installOpenRouterDebugFetch(
  options: OpenWikiRunOptions,
  retryAttempts = 0,
  fetchOptions: OpenRouterFetchOptions = {},
): OpenRouterFetchCapture {
  const sink: OpenRouterFetchSink = {
    lastFailure: null,
    options,
    retryAttempts,
    sleep: fetchOptions.sleep ?? sleep,
  };

  // Install the wrapper once, capturing the genuine original fetch. Concurrent
  // runs share the single wrapper and each detach their own sink; the global
  // is only restored when the last run leaves, so overlapping install/restore
  // can no longer leak or lose the patch.
  if (activeOpenRouterSinks.size === 0) {
    openRouterOriginalFetch = globalThis.fetch;
    globalThis.fetch = openRouterDebugFetch;
  }
  activeOpenRouterSinks.add(sink);

  return {
    clearLastFailure: () => {
      sink.lastFailure = null;
    },
    getLastFailure: () => sink.lastFailure,
    restore: () => {
      if (!activeOpenRouterSinks.delete(sink)) {
        return;
      }

      if (activeOpenRouterSinks.size === 0 && openRouterOriginalFetch) {
        globalThis.fetch = openRouterOriginalFetch;
        openRouterOriginalFetch = null;
      }
    },
    setRetryAttempts: (updatedRetryAttempts) => {
      sink.retryAttempts = updatedRetryAttempts;
    },
  };
}

function getOpenRouterProviderErrorRetry(): {
  maxRetries: number;
  sleep: (ms: number) => Promise<void>;
} {
  let maxRetries = 0;
  let retrySleep = sleep;

  // The OpenRouter wrapper is process-global, so retry follows the same
  // best-effort active-run fan-out contract used for debug capture.
  for (const sink of activeOpenRouterSinks) {
    if (sink.retryAttempts > maxRetries) {
      maxRetries = sink.retryAttempts;
      retrySleep = sink.sleep;
    }
  }

  return { maxRetries, sleep: retrySleep };
}

function getOpenRouterProviderErrorRetryDelayMs(attempt: number): number {
  return Math.min(
    OPENROUTER_PROVIDER_ERROR_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
    OPENROUTER_PROVIDER_ERROR_RETRY_MAX_DELAY_MS,
  );
}

function isOpenRouterRequestResendable(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): boolean {
  if (input instanceof Request && input.body !== null) {
    return false;
  }

  return (
    init?.body === undefined ||
    init.body === null ||
    typeof init.body === "string"
  );
}

function isTransientOpenRouterProvider404(
  response: Response,
  rawBody: string | null,
): boolean {
  if (response.status !== 404 || rawBody === null) {
    return false;
  }

  const parsedBody = parseJsonRecord(rawBody);
  if (parsedBody === null) {
    return false;
  }

  const error = isRecord(parsedBody?.error) ? parsedBody.error : parsedBody;
  const message = getStringRecordValue(error, "message");
  const metadata = isRecord(error?.metadata) ? error.metadata : null;

  return (
    metadata !== null &&
    message === "Provider returned error" &&
    metadata.raw === "" &&
    typeof metadata.provider_name === "string"
  );
}

function attachOpenRouterDebugInfo(
  error: unknown,
  failure: OpenRouterFetchFailure | null,
): void {
  if (!failure || !isRecord(error)) {
    return;
  }

  error[OPENROUTER_DEBUG_PROPERTY] = failure;
}

function isOpenRouterFetchInput(input: Parameters<typeof fetch>[0]): boolean {
  const url = getFetchInputUrl(input);

  return (
    url !== null &&
    url.startsWith(OPENROUTER_BASE_URL) &&
    url.includes("/chat/completions")
  );
}

function getFetchInputUrl(input: Parameters<typeof fetch>[0]): string | null {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return "url" in input && typeof input.url === "string" ? input.url : null;
}

function summarizeOpenRouterRequest(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
): OpenRouterRequestSummary {
  const body = typeof init?.body === "string" ? init.body : null;
  const parsedBody = parseJsonRecord(body);
  const toolNames = getOpenRouterToolNames(parsedBody?.tools);

  return {
    bodyBytes: body === null ? undefined : Buffer.byteLength(body, "utf8"),
    messageChars: getOpenRouterMessageChars(parsedBody?.messages),
    messageCount: Array.isArray(parsedBody?.messages)
      ? parsedBody.messages.length
      : undefined,
    method: init?.method ?? "GET",
    model: typeof parsedBody?.model === "string" ? parsedBody.model : undefined,
    stream:
      typeof parsedBody?.stream === "boolean" ? parsedBody.stream : undefined,
    toolCount: toolNames.length,
    toolNames: toolNames.slice(0, 20),
    url: formatOpenRouterDebugUrl(getFetchInputUrl(input) ?? "unknown"),
  };
}

function parseJsonRecord(value: string | null): Record<string, unknown> | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getOpenRouterToolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .map((tool) => {
      if (!isRecord(tool) || !isRecord(tool.function)) {
        return null;
      }

      return typeof tool.function.name === "string" ? tool.function.name : null;
    })
    .filter((name): name is string => name !== null);
}

function getOpenRouterMessageChars(messages: unknown): number | undefined {
  if (!Array.isArray(messages)) {
    return undefined;
  }

  return messages.reduce<number>((total, message) => {
    if (!isRecord(message)) {
      return total;
    }

    return total + countMessageContentChars(message.content);
  }, 0);
}

function countMessageContentChars(content: unknown): number {
  if (typeof content === "string") {
    return content.length;
  }

  if (Array.isArray(content)) {
    return content.reduce<number>(
      (total, block) => total + countMessageContentChars(block),
      0,
    );
  }

  if (!isRecord(content)) {
    return 0;
  }

  return Object.entries(content).reduce((total, [key, value]) => {
    if (key === "text" || key === "content") {
      return total + countMessageContentChars(value);
    }

    return total;
  }, 0);
}

async function readResponseBody(
  response: Response,
): Promise<{ preview: string; raw: string | null }> {
  try {
    const body = await response.clone().text();
    const sanitizedBody = sanitizeOpenRouterResponseBody(body);

    return {
      preview:
        sanitizedBody.length <= OPENROUTER_DEBUG_BODY_LIMIT
          ? sanitizedBody
          : `${sanitizedBody.slice(0, OPENROUTER_DEBUG_BODY_LIMIT - 3)}...`,
      raw: body,
    };
  } catch (error) {
    return {
      preview: `Unable to read response body: ${
        error instanceof Error ? error.message : String(error)
      }`,
      raw: null,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeOpenRouterResponseBody(body: string): string {
  // Redact string values whose JSON key name contains any secret-bearing term
  // (shared source of truth with isSecretLikeKey / the MCP redactor).
  const secretJsonKeyPattern = new RegExp(
    `"([^"]*(?:${SECRET_KEY_PATTERN_SOURCE})[^"]*)"\\s*:\\s*"[^"]*"`,
    "giu",
  );

  return body.replace(
    secretJsonKeyPattern,
    (_, key: string) => `${JSON.stringify(key)}:"[REDACTED]"`,
  );
}

function getSafeResponseHeaders(headers: Headers): Record<string, string> {
  const safeHeaders: Record<string, string> = {};

  for (const key of ["cf-ray", "content-type", "request-id", "x-request-id"]) {
    const value = headers.get(key);

    if (value) {
      safeHeaders[key] = value;
    }
  }

  return safeHeaders;
}

function formatOpenRouterDebugUrl(value: string): string {
  try {
    const url = new URL(value);

    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";

    return url.toString();
  } catch {
    return value;
  }
}

function formatEnvironmentDebug(): string {
  return DEBUG_ENV_KEYS.map(
    (key) => `${key}:${formatEnvironmentDebugValue(key, process.env[key])}`,
  ).join(" ");
}

export function formatEnvironmentDebugValue(
  key: string,
  value: string | undefined,
): string {
  if (value === undefined) {
    return "unset";
  }

  if (
    key === ANTHROPIC_BASE_URL_ENV_KEY ||
    key === BASETEN_BASE_URL_ENV_KEY ||
    key === COPILOT_BASE_URL_ENV_KEY ||
    key === FIREWORKS_BASE_URL_ENV_KEY ||
    key === NVIDIA_BASE_URL_ENV_KEY ||
    key === OPENAI_BASE_URL_ENV_KEY ||
    key === OPENAI_COMPATIBLE_BASE_URL_ENV_KEY
  ) {
    return formatUrlDebugValue(value);
  }

  if (
    key.endsWith("_API_KEY") ||
    key === BEDROCK_AWS_ACCESS_KEY_ID_ENV_KEY ||
    key === BEDROCK_AWS_SECRET_ACCESS_KEY_ENV_KEY ||
    key === BEDROCK_AWS_SESSION_TOKEN_ENV_KEY
  ) {
    return `set(length=${value.length})`;
  }

  if (
    key === OPENWIKI_MODEL_ID_ENV_KEY ||
    key === OPENWIKI_PROVIDER_ENV_KEY ||
    key === OPENWIKI_MAX_OUTPUT_TOKENS_ENV_KEY ||
    key === OPENWIKI_STREAM_IDLE_TIMEOUT_ENV_KEY ||
    key === OPENWIKI_PROVIDER_RETRY_ATTEMPTS_ENV_KEY ||
    key === OPENWIKI_OPENROUTER_MAX_TOKENS_ENV_KEY ||
    key === OPENAI_COMPATIBLE_AUTH_ENV_KEY ||
    key === OPENAI_COMPATIBLE_ENTRA_SCOPE_ENV_KEY ||
    key === OPENAI_COMPATIBLE_STREAMING_ENV_KEY ||
    key === BEDROCK_AWS_REGION_ENV_KEY
  ) {
    return `set(value=${JSON.stringify(value)})`;
  }

  if (value.length <= 10) {
    return `set(length=${value.length})`;
  }

  return `set(length=${value.length}, preview=${JSON.stringify(
    `${value.slice(0, 6)}...${value.slice(-4)}`,
  )})`;
}

function formatUrlDebugValue(value: string): string {
  try {
    const url = new URL(value);
    const redacted: string[] = [];

    if (url.username || url.password) {
      redacted.push("auth");
      url.username = "";
      url.password = "";
    }

    if (url.search) {
      redacted.push("query");
      url.search = "";
    }

    if (url.hash) {
      redacted.push("hash");
      url.hash = "";
    }

    const redactionSuffix =
      redacted.length > 0 ? `, redacted=${redacted.join("+")}` : "";

    return `set(url=${JSON.stringify(url.toString())}${redactionSuffix})`;
  } catch {
    return `set(length=${value.length}, preview=${JSON.stringify(
      `${value.slice(0, 6)}...${value.slice(-4)}`,
    )})`;
  }
}
