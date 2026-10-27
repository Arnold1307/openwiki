---
name: openwiki-dev-loop
description: Use when building, testing, or running the OpenWiki CLI in this repository, running it against another local repo, debugging a run, or preparing a PR (format/lint/typecheck/test gate). Also use when `format:check` fails on Windows or `--dry-run` is rejected.
---

# OpenWiki dev loop

## Overview

Everything runs through pnpm scripts in `package.json`. The CLI can run from
source (`tsx`) or from the compiled `dist/cli/cli.js`; the agent needs a provider
key from the environment or `~/.openwiki/.env`.

## Quick reference

| Goal                        | Command                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Install                     | `pnpm install --frozen-lockfile`                                                                                          |
| Run from source             | `pnpm dev --help` (any CLI args go straight through)                                                                      |
| Build                       | `pnpm run build` → `dist/cli/cli.js`                                                                                      |
| Run built CLI here          | `node dist/cli/cli.js -p "Summarize what you can do"`                                                                     |
| All tests                   | `pnpm test`                                                                                                               |
| One test file               | `pnpm exec vitest run test/cli/commands.test.ts`                                                                          |
| Typecheck                   | `pnpm run typecheck`                                                                                                      |
| Lint                        | `pnpm run lint:check` (fix: `pnpm run lint`)                                                                              |
| Format                      | `pnpm run format:check` (fix: `pnpm run format`)                                                                          |
| Execution plan, no LLM call | `OPENWIKI_DEV=1 node dist/cli/cli.js --dry-run` (or `--init --dry-run`, etc.)                                             |
| Debug output during a run   | `OPENWIKI_DEBUG=1` (agent debug events + credential diagnostics panel); `OPENWIKI_DEBUG_CREDENTIALS=1` for the panel only |

## Running against another repository

The CLI documents the **current working directory**. Link the build once, then
run from the target repo (see `DEVELOPMENT.md`):

```sh
pnpm run build && pnpm link --global   # in this repo
cd /path/to/target && OPENWIKI_DEV=1 openwiki --dry-run
cd /path/to/target && openwiki --update -p
```

Without linking: `node /path/to/openwiki/dist/cli/cli.js --update` from inside the
target repo. Do not use `pnpm --dir …` for this — it changes `cwd` to this repo
and the agent would document OpenWiki itself.

`--dry-run` only exists in development mode (`isDevelopmentMode` in
`src/cli/commands.ts`: `OPENWIKI_DEV=1` or `NODE_ENV=development`). It renders
`DryRunView` with the execution plan; it does not read credentials, invoke the
agent, print the prompt, or write files.

## Credentials during development

- Runtime precedence: `process.env` wins over `~/.openwiki/.env`
  (`loadOpenWikiEnv` in `src/config/env.ts` only fills unset keys).
- Non-interactive runs (`-p`, or no TTY) fail fast without a provider key
  (`resolveStartupCommand` in `src/cli/startup.ts`). Interactive runs open `InitSetup`.
- Tests never touch `~/.openwiki/.env`; they set and restore `process.env`
  directly (see `write-tests`).
- To try a different provider once: `OPENWIKI_PROVIDER=anthropic ANTHROPIC_API_KEY=… node dist/cli/cli.js -p "hi"`.

## Pre-PR gate

Run all four; CI runs the same on Node 22 and 24:

```sh
pnpm run format:check && pnpm run lint:check && pnpm run typecheck && pnpm test
```

Then confirm the change is one concern (CONTRIBUTING.md) and the PR title is a
Conventional Commit.

## Common mistakes

- **`format:check` reports ~40 files on Windows** with `core.autocrlf=true`:
  that is CRLF, not style. Verify with
  `pnpm exec prettier --check --end-of-line auto .`; `pnpm run format` rewrites
  to LF, which git normalises back on commit, so it is harmless but noisy.
- **`--dry-run` "unknown option"**: `OPENWIKI_DEV=1` is missing.
- **Editing `dist/`**: it is build output and git-ignored. Edit `src/` and
  rebuild.
- **`pnpm run build` wipes `dist/`** (`prebuild` runs `clean`) — a globally
  linked `openwiki` is briefly broken while `tsc` runs.
- **Running the real agent in this repo** writes `openwiki/` and
  `openwiki/.last-update.json`; that directory is CI-owned here
  (see `maintain-wiki`). Prefer `-p` runs in a scratch repo.
