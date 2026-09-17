---
name: add-model-provider
description: Use when adding a new inference provider to OpenWiki, changing a provider's model presets, base URL handling, or env-key names, or when a provider "works in setup but fails at run time" / "key is not redacted".
---

# Add or change a model provider

## Overview

Provider support is data-driven from `PROVIDER_CONFIGS` in `src/constants.ts`;
the setup UI, env persistence and diagnostics derive from it. Only three places
still branch on provider names by hand. Missing one of those is the usual bug.

## Checklist (in order)

1. **`src/constants.ts`**
   - Add `export const <NAME>_API_KEY_ENV_KEY = "<NAME>_API_KEY";` (and a
     `<NAME>_BASE_URL_ENV_KEY` if the endpoint is user-configurable).
   - Add the id to the `OpenWikiProvider` union **and** to
     `SELECTABLE_OPENWIKI_PROVIDERS` (order = order in the setup menu).
   - Add an entry to `PROVIDER_CONFIGS`: `apiKeyEnvKey`, `label`,
     `modelOptions` (first entry is the default model; empty array = custom
     model id required), and either `baseURL` (fixed default) or
     `baseUrlEnvKey` (+ `requiresBaseUrl: true` if there is no default).
2. **`src/env.ts`** — insert the new env key(s) into `MANAGED_ENV_KEYS` (order
   = order in `~/.openwiki/.env`). This is what puts them in credential
   diagnostics and debug dumps. Nothing else in this file changes.
3. **`src/diagnostics.ts`** — add the API-key env constant to the hardcoded
   list inside `sanitizeDiagnosticText`. Without this the raw key can leak into
   error output. (This list is not derived from `MANAGED_ENV_KEYS`; note that
   `OPENAI_COMPATIBLE_API_KEY` is currently missing from it.)
4. **`src/agent/index.ts` → `createModel`** — only if the provider is not
   OpenAI-chat-compatible. The fall-through builds `ChatOpenAI` with
   `resolveProviderBaseUrl(provider)`; `anthropic` and `openrouter` have
   explicit branches; `useResponsesApi` is enabled only for `openai`. Add a
   dependency in `package.json` if a new LangChain chat class is needed.
5. **`src/credentials.tsx` → `getProviderArticle`** — returns "a"/"an" for the
   setup copy; add the id if the label starts with a consonant sound. The rest
   of the setup flow (provider list, key prompt, base-URL step, model menu with
   custom entry) is generic.
6. **Docs** — README "Customizing" section (provider list; add a subsection if
   there is a base-URL story). `openwiki/cli/usage.md` has a provider table
   but is CI-maintained: leave it unless asked (see `maintain-wiki`).
7. **Tests** — extend `test/constants.test.ts` (`resolveConfiguredProvider`,
   `resolveProviderBaseUrl`, `getDefaultModelId`) and `test/redaction.test.ts`
   (new key is redacted). See `write-tests`.

## Done when

- `pnpm run typecheck` passes — the `Record<OpenWikiProvider, ProviderConfig>`
  type forces a config entry for every union member.
- `OPENWIKI_PROVIDER=<id> <KEY>=x OPENWIKI_DEV=1 node dist/cli.js --dry-run`
  shows the provider label and default model in the header.
- A `-p` run with a real key completes (or fails with the provider's own error,
  not with `<KEY> is required…`).
- Redaction test for the new key passes.

## Common mistakes

- Adding to `OpenWikiProvider` but not `SELECTABLE_OPENWIKI_PROVIDERS`: the
  provider works via env but is invisible in the setup menu.
- Setting `requiresBaseUrl: true` without `baseUrlEnvKey` or `baseURL`:
  `ensureProviderBaseUrl` will always throw.
- Forgetting `MANAGED_ENV_KEYS`: the key still gets written to
  `~/.openwiki/.env` (unknown keys are appended alphabetically), but it is
  missing from credential diagnostics and debug dumps, so misconfiguration is
  invisible.
- Changing the OpenRouter branch: it deliberately uses the fixed
  `OPENROUTER_BASE_URL` and `siteName: "OpenWiki"`; base-URL overrides apply to
  the other providers only.
