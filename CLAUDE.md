## OpenWiki

This repository has documentation located in the /openwiki directory.

Start here:

- [OpenWiki quickstart](openwiki/quickstart.md)

OpenWiki includes repository overview, architecture notes, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

When working in this repository, read the OpenWiki quickstart first, then follow its links to the relevant architecture, workflow, domain, operation, and testing notes.

## Commands

- `pnpm install --frozen-lockfile` — install (Node >= 20, pnpm 10).
- `pnpm run build` — `tsc` to `dist/` (runs `clean` first). `node dist/cli.js` is the published binary.
- `pnpm dev --help` — run the CLI from source via `tsx` without building.
- `pnpm test` — Vitest suite. Single file: `pnpm exec vitest run test/<name>.test.ts`.
- `pnpm run typecheck` — `tsc --noEmit`.
- `pnpm run lint:check` / `pnpm run lint` — ESLint (check / fix).
- `pnpm run format:check` / `pnpm run format` — Prettier over the whole repo, including `.md`, `docs/` and `.claude/`.
- CI runs format, lint, typecheck, build and test on Node 20 and 22 (`.github/workflows/checks.yml`). Windows checkouts with `core.autocrlf=true` fail `format:check` on line endings only; verify with `pnpm exec prettier --check --end-of-line auto .`.

## Conventions

- One PR = one change, Conventional Commits titles (`feat:`, `fix:`, `chore:`, `docs:`). See `CONTRIBUTING.md`; its rules are binding for agents — if a change would violate them, stop and surface it.
- ESM only (`"type": "module"`, `moduleResolution: NodeNext`): relative imports in `src/` end in `.js`; tests import sources with their real `.ts`/`.tsx` extension.
- TypeScript `strict`; React 18 + Ink 5 for the terminal UI; LangChain `deepagents` for the agent; Vitest for tests.
- Never log, print or persist secret values. Anything user-visible that may contain a credential goes through `sanitizeDiagnosticText` in `src/diagnostics.ts`.
- `openwiki/` in this repo is generated output maintained by CI (`.github/workflows/openwiki-update.yml`). Do not hand-edit it or run `openwiki --update` here unless explicitly asked.
- Do not modify `src/` or `package.json` beyond what a task needs: this is a fork of `langchain-ai/openwiki` and should stay easy to merge upstream.

## Where things live

- CLI argument parsing and `--help` text → `src/commands.ts` (`parseCommand`, `helpContent`, `isDevelopmentMode`).
- Terminal UI, run lifecycle, `-p/--print` mode, auto-exit → `src/cli.tsx` (large; use `docs/source-map.md` to find the right function).
- Provider list, model presets, env-key names, validation → `src/constants.ts` (`PROVIDER_CONFIGS`, `OpenWikiProvider`).
- Model construction, agent run, stream parsing, OpenRouter debug capture → `src/agent/index.ts` (`runOpenWikiAgent`, `createModel`).
- System/user prompts for init/update/chat → `src/agent/prompt.ts`.
- Git evidence, `.last-update.json`, no-op detection, content snapshot → `src/agent/utils.ts`.
- `~/.openwiki/.env` read/write and credential diagnostics → `src/env.ts` (`MANAGED_ENV_KEYS`).
- Interactive first-run setup (provider, key, base URL, model, LangSmith) → `src/credentials.tsx`.
- Secret redaction and error classification → `src/diagnostics.ts`.
- Tests → `test/*.test.ts`; CI example workflows → `examples/`.
- Full per-file map with exported symbols → `docs/source-map.md`.

## Skills

Project skills live in `.claude/skills/`. Use them when the task matches:

- `openwiki-dev-loop` — building, testing, running the CLI locally or against another repo, pre-PR checks.
- `add-model-provider` — adding or changing an inference provider or its model presets.
- `change-agent-prompt` — editing `src/agent/prompt.ts` or run-context assembly.
- `write-tests` — adding Vitest tests in this repo's style.
- `maintain-wiki` — anything touching `openwiki/`, `.last-update.json` or the OpenWiki section of this file.
- `hub-implementation` — working on the OpenWiki Hub (GitLab multi-project portal).

## Hub work

The Hub (multi-project GitLab portal) is specified but not yet implemented. Spec: `docs/superpowers/specs/2026-07-08-openwiki-hub-design.md`. Plan: `docs/superpowers/plans/2026-07-08-openwiki-hub.md`. Start from the `hub-implementation` skill.

## Fork status and role in the SDLC landscape (2026-10-26)

- This fork is **337 commits behind** `origin/main` (`langchain-ai/openwiki`) and 4 commits ahead (agent onboarding, Hub spec and plan). The README describes upstream behaviour as of July 2026; check upstream before relying on CLI flags or provider lists, and rebase before new feature work.
- Fork-specific changes stay out of `README.md` to keep merges simple; they live here and under `docs/superpowers/`.
- In the SDLC project landscape OpenWiki supplies repository documentation as context: for the Prüfstand review pipeline (the `openwiki/` folder as review context, referenced by path and commit) and for ACTOR (context output). Open items: `TODO.md`.
