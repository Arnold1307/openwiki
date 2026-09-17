# Source map

Per-file responsibilities and the exported symbols worth knowing, so an agent
can `Grep` for a name instead of reading whole files. No line numbers on
purpose — they rot. Generated architecture prose lives in `openwiki/`; this
file is hand-maintained and only lists what is in `src/` and `test/`.

Update this file when you add, rename, or remove an exported symbol.

## `src/` overview

| File              | Lines (approx.) | One-line responsibility                                                    |
| ----------------- | --------------- | -------------------------------------------------------------------------- |
| `cli.tsx`         | 3100            | Ink terminal UI, run lifecycle, print mode, startup validation             |
| `commands.ts`     | 270             | argv parsing into `CliCommand`, help content                               |
| `constants.ts`    | 240             | Providers, model presets, env-key names, validators, version               |
| `credentials.tsx` | 940             | Interactive first-run setup (`InitSetup`) and its step machine             |
| `diagnostics.ts`  | 90              | Secret redaction, error message extraction, OpenRouter 500 detection       |
| `env.ts`          | 320             | `~/.openwiki/.env` load/save/parse/format, credential diagnostics          |
| `fs-errors.ts`    | 35              | ENOENT / snapshot-race error classifiers                                   |
| `utils.ts`        | 20              | `stripHtmlTags`                                                            |
| `agent/index.ts`  | 1240            | Agent run orchestration, model construction, stream parsing, debug capture |
| `agent/prompt.ts` | 230             | System prompt, mode instructions, user prompt                              |
| `agent/utils.ts`  | 400             | Run context, git summary, `.last-update.json`, no-op check, content hash   |
| `agent/types.ts`  | 50              | Shared agent types                                                         |

## `src/commands.ts`

- `parseCommand(argv): CliCommand` — the only parser. Handles `--help/-h`,
  `--init`, `--update`, `-p/--print`, `--modelId <id>` / `--model-id` /
  `--modelId=<id>`, `--dry-run` (dev only), positional message. Returns
  `{ kind: "help" | "run" | "error" }`.
- `CliCommand` — discriminated union; the `run` variant carries `command`
  (`chat|init|update`), `dryRun`, `modelId`, `print`, `shouldStart`, `userMessage`.
- `isDevelopmentMode()` — `NODE_ENV=development` or `OPENWIKI_DEV=1`.
- `helpContent`, `getHelpText()`, `HelpRow`, `HelpContent` — help text data
  and renderer; `HelpView` in `cli.tsx` renders the same data with Ink.

Read this when: adding a flag, changing help text, changing what counts as
"should start a run".

## `src/constants.ts`

- Env-key constants: `*_API_KEY_ENV_KEY`, `ANTHROPIC_BASE_URL_ENV_KEY`,
  `OPENAI_COMPATIBLE_BASE_URL_ENV_KEY`, `OPENWIKI_PROVIDER_ENV_KEY`,
  `OPENWIKI_MODEL_ID_ENV_KEY`.
- `OpenWikiProvider` (union), `SELECTABLE_OPENWIKI_PROVIDERS` (menu order),
  `PROVIDER_CONFIGS` (`apiKeyEnvKey`, `baseURL?`, `baseUrlEnvKey?`,
  `requiresBaseUrl?`, `label`, `modelOptions`).
- Lookups: `getProviderConfig`, `getProviderLabel`, `getProviderApiKeyEnvKey`,
  `getProviderBaseUrlEnvKey`, `getProviderModelOptions`, `getDefaultModelId`,
  `providerRequiresBaseUrl`, `resolveProviderBaseUrl(provider, env?)`.
- Resolution/validation: `resolveConfiguredProvider(env?)`,
  `normalizeProvider`, `isValidProvider`, `normalizeModelId`, `isValidModelId`,
  `isValidBaseUrl`.
- `OPEN_WIKI_DIR = "openwiki"`, `UPDATE_METADATA_PATH`, `DEFAULT_PROVIDER`,
  `DEFAULT_MODEL_ID`, `OPENROUTER_BASE_URL`, `OPENWIKI_VERSION`.

Read this when: anything provider- or model-related. See skill
`add-model-provider`.

## `src/env.ts`

- `openWikiEnvDir`, `openWikiEnvPath` — `~/.openwiki`, `~/.openwiki/.env`.
- `MANAGED_ENV_KEYS` — single source of truth for persisted keys;
  `CREDENTIAL_DIAGNOSTIC_ENV_KEYS` and `DEBUG_ENV_KEYS` derive from it.
- `loadOpenWikiEnv()` — file → `process.env` for unset keys only; skips
  deprecated keys (`OPENAI_BASE_URL`, `OPENAI_ORG_ID`, `OPENAI_PROJECT`).
- `saveOpenWikiEnv(updates)` — merge, drop deprecated, write with `0600`.
- `getCredentialDiagnostics()` → `CredentialDiagnostic[]` (source, length,
  masked preview, warnings) for the debug panel.
- `parseEnv(content)`, `formatEnv(env)` — pure; managed keys first, then
  unknown keys sorted; double-quoted, escaped values.

## `src/credentials.tsx`

- `needsCredentialSetup(modelIdOverride?)` — true if provider invalid, key
  missing, required base URL missing, model unset (and no override), or
  `LANGSMITH_API_KEY` unset.
- `InitSetup` (Ink component) — steps `provider → api-key → base-url → model
→ langsmith`; `PromptStep` type. Step routing helpers: `getInitialStep`,
  `getNextStepAfterProvider`, `getNextStepAfterApiKey`,
  `getNextStepAfterBaseUrl`.
- Model menu: `getModelSelectionOptions` (presets + custom),
  `shouldStartWithCustomModelInput` (no presets → custom input first),
  `getSelectedModelId`.
- Provider-specific: `getProviderArticle` ("a"/"an") is the only hardcoded
  provider list here.
- `InitSetupResult` — what `App` receives on completion.

## `src/cli.tsx`

Top-level flow (bottom of file): `parseCommand(argv)` → `loadOpenWikiEnv()`
(unless dry-run) → `resolveStartupCommand` (non-interactive runs need a key;
empty message is an error) → either print error, `runPrintCommand`, or
`render(<App/>)`.

Components, in file order:

- `App` — owns `RunState`, `CompletedRun[]`, session provider/model, thread
  id; decides between `HelpView`, `DryRunView`, `InitSetup`, `RunView`,
  `ChatInput`. Contains `submitChatMessage`, the `runOpenWikiAgent` call with
  `onEvent`, auto-exit after successful `--init`/`--update`.
- `HelpView`, `DryRunView` (execution plan; dev only).
- `CredentialDiagnosticsPanel`, `ErrorDiagnosticsPanel` — shown in debug mode
  (`isDebugMode`: `OPENWIKI_DEBUG=1`; `shouldShowCredentialDiagnostics` also
  honours `OPENWIKI_DEBUG_CREDENTIALS=1`).
- `Header`, `StatusLine`, `Panel`, `Rows` — layout primitives.
- `RunView`, `RunLogLine` — live run log; `getActiveRunningToolLogId`,
  `getSpinnerFrame`.
- `MarkdownText`, `MarkdownBlock`, `InlineMarkdown*`, `renderPlainTable`,
  `renderHtmlToken` — `marked` tokens → Ink.
- `ChatHistory`, `ChatInput`, `SlashMenu`, `MenuRow` — input line with slash
  commands (`SlashCommandId`: clear, exit, help, init, model, provider, update)
  and model/provider menus. Input editing helpers: `moveInputCursor`,
  `deleteBeforeInputCursor`, `applyRawInputValue`, `insertAtInputCursor`,
  `syncMenuStateForInput`, `parseSlashInput`, `getModelMenuOptions`.
- `PromptBlock`, `InputCursor`.

Run-log reducers: `appendRunLogEvent`, `appendToolStartLogItem`,
`completeToolLogItem`, `completeToolGroupItem`, `createToolDisplay`,
`pickToolDisplay` (maps tool names/args to human labels), `truncateLogOutput`.

Error diagnostics: `getErrorDiagnostics` and the `addSafe*Diagnostics` family
walk an error object and emit redacted label/value pairs; `isSecretLikeKey`,
`sanitizeHeaderValue`, `stripControlCharacters`, `dedupeDiagnostics`.

Startup helpers: `runPrintCommand` (collects `text` events from the main
graph only, prints once), `writePrintErrorDiagnostics`,
`shouldPrintStartupError`, `shouldAutoExitStartupRun`, `resolveStartupCommand`.

Read this when: UI behaviour, slash commands, print mode, auto-exit, what the
user sees on errors. Grep for the component name; do not read top to bottom.

## `src/agent/index.ts`

- `runOpenWikiAgent(command, cwd?, options?)` → `OpenWikiRunResult` — entry
  point used by the CLI (and the future Hub). Loads env, runs the update
  no-op check, resolves provider/model, installs OpenRouter debug fetch, then
  `runOpenWikiAgentCore`.
- `runOpenWikiAgentCore` — `createRunContext`, content snapshot before,
  `createModel`, `SqliteSaver` checkpointer at `~/.openwiki/openwiki.sqlite`,
  `createDeepAgent` with `LocalShellBackend` (virtual mode, 120 s timeout,
  100 kB output cap), stream with `streamMode: ["messages","tools"]`,
  `writeLastUpdateMetadata` if snapshot changed.
- `createModel(provider, modelId)` — `ChatAnthropic` | `ChatOpenRouter` |
  `ChatOpenAI` (with `useResponsesApi` for `openai`).
- Guards: `ensureProviderKey`, `ensureProviderBaseUrl`, `resolveModelId`.
- `createOpenWikiThreadId(cwd)` — stable per-cwd thread id prefix.
- Stream parsing: `parseStreamEvent` → `normalizeStreamEvent`,
  `extractMessageText*`, `parseToolStreamEvent`, `formatToolCallName`,
  `formatToolArgs`; emits `OpenWikiRunEvent`s.
- OpenRouter debugging: `installOpenRouterDebugFetch`,
  `attachOpenRouterDebugInfo`, `summarizeOpenRouterRequest`,
  `sanitizeOpenRouterResponseBody` (exported, tested), `formatEnvironmentDebug`.

Read this when: model/provider construction, event stream shape, checkpoint
storage, debugging a provider request.

## `src/agent/prompt.ts`

- `createSystemPrompt(command)` — full system prompt incl. the AGENTS.md/
  CLAUDE.md "## OpenWiki" template and `createModeInstructions(command)`.
- `createModeInstructions(command)` — chat / init / update rules.
- `createUserPrompt(command, context, userMessage?)` — task message with git
  evidence; `appendUserMessage` adds the CLI message.

See skill `change-agent-prompt`.

## `src/agent/utils.ts`

- `createRunContext(command, cwd)` → `RunContext { lastUpdate, gitSummary }`.
- `createGitSummary` (private) — `git status --short`, `rev-parse HEAD`, and
  `log <gitHead>..HEAD` / `log --since` / last 20 commits, plus
  `diff --name-status HEAD`; `runGit` never throws on normal git errors.
- `getUpdateNoopStatus(cwd)` → `UpdateNoopStatus` — skip when HEAD equals
  recorded `gitHead`, worktree clean (ignoring `.last-update.json`), and no
  non-`openwiki/` paths changed since.
- `shouldCheckUpdateNoop(options)` — false when a user message is given.
- `writeLastUpdateMetadata(command, cwd, modelId)`, `readLastUpdate` (private,
  tolerant of missing/invalid JSON).
- `createOpenWikiContentSnapshot(cwd)` — sha256 over `openwiki/` file paths
  and bytes, excluding `.last-update.json`; tolerant of snapshot races.

## `src/agent/types.ts`

`OpenWikiCommand`, `OpenWikiRunResult` (`skipped?`), `OpenWikiRunEvent`
(`text` with `source: main|subgraph`, `tool_start`, `tool_end`, `debug`),
`OpenWikiRunOptions` (`debug`, `isFollowup`, `modelId`, `onEvent`, `threadId`,
`userMessage`), `UpdateMetadata`, `RunContext`.

## `src/diagnostics.ts`

- `sanitizeDiagnosticText(value)` — the security boundary for anything shown
  to the user: replaces exact env secret values (hardcoded key list — keep in
  sync when adding a provider) and known token shapes.
- `isOpenRouterServerError(error, message)`, `getErrorMessage(error)`.

## `src/fs-errors.ts`, `src/utils.ts`

`isFileNotFoundError`, `isExpectedSnapshotRaceError`; `stripHtmlTags`.

## `test/`

| File                  | Covers                                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `commands.test.ts`    | `parseCommand`: help, chat default, init/update, print, `--modelId`, dry-run gating                                        |
| `constants.test.ts`   | model-id/provider validation, `resolveConfiguredProvider`, `resolveProviderBaseUrl`, `isValidBaseUrl`, `getDefaultModelId` |
| `credentials.test.ts` | `needsCredentialSetup` with env isolation                                                                                  |
| `env.test.ts`         | `parseEnv` / `formatEnv` and round-trip                                                                                    |
| `fs-errors.test.ts`   | error classifiers                                                                                                          |
| `redaction.test.ts`   | `sanitizeDiagnosticText`, `getErrorMessage`, `isOpenRouterServerError`, `sanitizeOpenRouterResponseBody`                   |
| `update-noop.test.ts` | `getUpdateNoopStatus` / `shouldCheckUpdateNoop` against temp git repos                                                     |
| `utils.test.ts`       | `stripHtmlTags`                                                                                                            |

Not covered: Ink components, `runOpenWikiAgent`, prompt builders. See skill
`write-tests`.
