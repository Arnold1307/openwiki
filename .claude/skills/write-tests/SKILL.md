---
name: write-tests
description: Use when adding or changing Vitest tests in the OpenWiki repository — testing CLI parsing, env handling, provider config, git-based update logic, or secret redaction — or when a test leaks environment variables into other tests.
---

# Write tests (OpenWiki conventions)

## Overview

Plain Vitest, no config file, no mocking library. Tests exercise real
functions against real temp directories and real `git`. Keep new tests in that
style; do not introduce `vi.mock` for filesystem or git.

## Quick reference

| Concern                         | Pattern                                                                                         | Example file                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------- |
| File location/name              | `test/<module>.test.ts`, flat, one file per source module or concern                            | `test/cli/commands.test.ts`      |
| Imports                         | `from "../src/x.ts"` / `"../src/x.tsx"` — real extension, not `.js`                             | `test/setup/credentials.test.ts` |
| Pure functions with env         | Prefer functions that take `env` as a parameter (`resolveConfiguredProvider({...})`)            | `test/config/constants.test.ts`  |
| Functions reading `process.env` | Snapshot the keys you touch, restore in `afterEach`, delete when originally undefined           | `test/setup/credentials.test.ts` |
| Git-dependent logic             | `mkdtemp` + `execFile("git", …)` helper; commit fixtures; assert on returned status objects     | `test/agent/update-noop.test.ts` |
| Secret redaction                | Set a fake secret in `process.env`, assert it is replaced by `[REDACTED:<KEY>]`                 | `test/agent/redaction.test.ts`   |
| CLI parsing                     | Call `parseCommand([...argv])` and assert on the discriminated union (`kind: "run" \| "error"`) | `test/cli/commands.test.ts`      |
| Dev-only flags                  | Set `OPENWIKI_DEV=1` inside the test, restore after                                             | `test/cli/commands.test.ts`      |
| Run one file                    | `pnpm exec vitest run test/<name>.test.ts`                                                      |                                  |

## Env isolation template

```ts
const ENV_KEYS = ["OPENWIKI_PROVIDER", "OPENROUTER_API_KEY"] as const;
const originalEnv = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
```

Vitest runs files in isolated workers but tests within a file share
`process.env`; without this, a forgotten key changes `resolveConfiguredProvider`
for the next test.

## Temp git repo template

Copy `git()` and `createRepoWithOpenWiki()` from `test/agent/update-noop.test.ts`.
Always set `user.email`/`user.name` in the temp repo — CI runners have no
global git identity. Windows: the repo path comes from `tmpdir()`; do not
hardcode `/tmp`.

## What not to test

- Ink components (`src/cli/cli.tsx`, `src/setup/credentials.tsx` UI) — no renderer test
  harness is set up; extract logic into plain functions and test those
  (`needsCredentialSetup` is the existing example).
- The LLM/agent run itself (`runOpenWikiAgent`) — network and cost. Test the
  pieces around it: `getUpdateNoopStatus`, `createRunContext`, prompt builders.

## Common mistakes

- Importing with `.js` in tests: works in `src/` (NodeNext rewrites) but
  Vitest resolves the real file — use `.ts`/`.tsx`.
- Asserting on `helpContent` strings verbatim: fine for structure, brittle for
  copy. Test `parseCommand` behaviour instead.
- Leaving `~/.openwiki/.env` in play: nothing in `test/` may call
  `loadOpenWikiEnv`/`saveOpenWikiEnv` against the real home directory.
