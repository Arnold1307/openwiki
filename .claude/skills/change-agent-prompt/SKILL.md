---
name: change-agent-prompt
description: Use when editing the OpenWiki agent's system or user prompt (`src/agent/prompt.ts`), the git evidence / run context it receives, the AGENTS.md/CLAUDE.md section it inserts, or when generated wikis have the wrong structure, touch files they should not, or updates are not surgical.
---

# Change the agent prompt

## Overview

The agent is a `deepagents` deep agent with a `LocalShellBackend` in virtual
mode (`/` = repo root). Everything it knows about _how_ to write docs comes
from three strings in `src/agent/prompt.ts`; everything it knows about _this
run_ comes from `RunContext` built in `src/agent/utils.ts`. Prompt changes are
cheap to make and expensive to validate — validate offline first.

## How a run is assembled (`src/agent/index.ts`)

```
runOpenWikiAgent(command, cwd, options)
  loadOpenWikiEnv → (update only) getUpdateNoopStatus → may return {skipped}
  resolveConfiguredProvider / ensureProviderKey / ensureProviderBaseUrl / resolveModelId
  runOpenWikiAgentCore
    createRunContext(command, cwd)        # lastUpdate + gitSummary   (utils.ts)
    createOpenWikiContentSnapshot(cwd)    # sha256 of openwiki/ before
    createDeepAgent({ systemPrompt: createSystemPrompt(command), backend, checkpointer })
    messages[0] = createRunUserMessage → createUserPrompt(command, context, userMessage) + runtime note
    stream events → options.onEvent
    if snapshot changed → writeLastUpdateMetadata(command, cwd, modelId)
```

- `createSystemPrompt(command)` — global discipline + `createModeInstructions(command)`
  for `chat` | `init` | `update`.
- `createUserPrompt(command, context, userMessage)` — task statement with
  `context.gitSummary` and, for update, `context.lastUpdate` JSON.
- Follow-up chat turns (`options.isFollowup`) send the raw user message only;
  the system prompt is still attached to the thread.

## Contracts you must keep

| Prompt text                                            | Depends on code                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| "## OpenWiki" section template for AGENTS.md/CLAUDE.md | The update-run rule "refresh only if semantically stale"; this repo's own `CLAUDE.md` starts with that exact block |
| `${UPDATE_METADATA_PATH}` / gitHead wording            | `writeLastUpdateMetadata`, `readLastUpdate`, `getUpdateNoopStatus` in `utils.ts`                                   |
| `/openwiki/...` virtual path instructions              | `LocalShellBackend({ virtualMode: true, rootDir: cwd })`                                                           |
| "Do not modify source outside openwiki/"               | Nothing enforces it — the prompt is the guard                                                                      |
| "Updates may be a no-op"                               | Metadata is only written when the content snapshot changed                                                         |

Constants come from `src/constants.ts` (`OPEN_WIKI_DIR`, `UPDATE_METADATA_PATH`);
never hardcode `openwiki/` in prompt text.

## Validate without an LLM call

```sh
pnpm exec tsx -e "import('./src/agent/prompt.ts').then(m => console.log(m.createSystemPrompt('update')))"
```

For the user prompt, build a context in a Vitest test:
`createRunContext("update", repo)` against a temp git repo (pattern in
`test/update-noop.test.ts`), then assert on `createUserPrompt(...)`. There is
no prompt test file yet; add `test/prompt.test.ts` when behaviour changes.

`--dry-run` does **not** print the prompt (see `openwiki-dev-loop`).

## Validate with one real run

Use a small scratch repo, `-p`, and the cheapest model:

```sh
cd /path/to/scratch && openwiki --init -p --modelId z-ai/glm-5.2
```

Check: `openwiki/quickstart.md` exists, no `openwiki/_plan.md` left behind,
`AGENTS.md` got exactly the template section, nothing outside `openwiki/`
changed (`git status`). For update-mode changes, commit, touch a source file,
and run `openwiki --update -p`; then run it again unchanged and expect
"No repository changes detected" (no-op path, no LLM call).

## Common mistakes

- Editing the runtime note in `createRunUserMessage` (index.ts) when the
  change belongs in `createUserPrompt` (prompt.ts), or vice versa.
- Loosening "surgical update" rules: the update prompt's diff budget exists
  because models otherwise rewrite the whole wiki every night in CI.
- Changing the AGENTS.md template text: every repo that already has the old
  block will be rewritten on its next update run.
- Adding instructions that reference tools the backend does not expose
  (there is no delete tool; the prompt tells the agent to use `rm -f`).
