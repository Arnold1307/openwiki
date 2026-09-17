---
name: maintain-wiki
description: Use when a task touches the `openwiki/` directory in this repository, `openwiki/.last-update.json`, the "## OpenWiki" section of CLAUDE.md/AGENTS.md, the scheduled wiki-update workflow, or when the generated docs look stale or contradict the source.
---

# Maintain the generated wiki

## Overview

`openwiki/` in this repo is OpenWiki's own output: the tool documenting
itself. It is refreshed by `.github/workflows/openwiki-update.yml` (daily,
`openwiki --update --print`, opens a PR on branch `openwiki/update`). Treat it
as generated, CI-owned content.

## Decision

```
Is the wiki wrong?
├─ A single sentence/fact is wrong and misleads agents now → fix that sentence by hand, `docs:` PR
├─ Whole pages are stale after a feature → leave it; CI's next update run handles it
│    (or, if explicitly asked, run `openwiki --update` locally — see below)
└─ Structure/navigation is wrong → change the prompt (`change-agent-prompt`), not the output
```

Never restructure, reformat, or "improve" `openwiki/*.md` by hand: the next
update run will either fight it or treat it as the new baseline.

## `.last-update.json`

Written by `writeLastUpdateMetadata` (`src/agent/utils.ts`) only when the
content hash of `openwiki/` changed during a run. Fields: `updatedAt`,
`command`, `gitHead`, `model`. It drives two things:

- **Update evidence**: `createGitSummary` sends `git log <gitHead>..HEAD` to
  the agent.
- **No-op skip**: `getUpdateNoopStatus` skips the LLM call when HEAD equals
  `gitHead`, the worktree is clean, and nothing outside `openwiki/` changed
  since. A user message on the command line disables the check.

Do not hand-edit it. Do not delete it to "force" a refresh — the update prompt
then falls back to a 20-commit log and loses the diff baseline.

## The "## OpenWiki" section in CLAUDE.md / AGENTS.md

The exact template lives in `createSystemPrompt` (`src/agent/prompt.ts`).
Update runs are told to rewrite the section only if it is missing or
semantically stale, so:

- keep the block **byte-identical** to the template, at the top of both
  files, and keep the two files identical to each other;
- put everything else (commands, conventions, skills) **below** it under
  other headings — the agent is instructed to preserve surrounding content.

## Running an update locally (only when asked)

```sh
pnpm run build && node dist/cli.js --update -p
```

Needs a provider key (`~/.openwiki/.env` or env). It writes `openwiki/` and
`.last-update.json`; commit both together as `docs: update OpenWiki`. Expect
model-dependent wording churn — review the diff for lost facts, not style.

## Common mistakes

- Editing `openwiki/quickstart.md` to add project conventions for agents: that
  belongs in `CLAUDE.md`/skills. The wiki describes the code, not the workflow.
- Adding `openwiki/` pages by hand in a CI-owned repo: the next run may merge
  or delete "thin" pages per the section-quality rules.
- Committing `.last-update.json` from a run against a dirty or unpushed HEAD:
  the recorded `gitHead` then points at a commit CI cannot see.
