---
name: hub-implementation
description: Use when implementing, continuing, or reviewing the OpenWiki Hub — the multi-project GitLab documentation portal under `hub/` — including its Fastify server, React web app, scanner/scheduler, or the `exports` wiring that lets it import the agent runtime.
---

# OpenWiki Hub implementation

## Overview

> **Status:** the v1 spec and plan are being revised (roadmap: `docs/superpowers/plans/2026-10-27-openwiki-roadmap.md`). Do not start implementation until the v2 spec is approved.

The Hub is a planned monorepo addition: `hub/server` (Fastify, SQLite, cron,
GitLab API, SSE) and `hub/web` (React + Vite) that clone GitLab projects, run
`runOpenWikiAgent` as a library, and serve the resulting `openwiki/` docs.
It is fully specified and planned; do not re-design it.

- Spec (authoritative on conflicts): `docs/superpowers/specs/2026-07-08-openwiki-hub-design.md`
- Plan (14 tasks, checkbox steps, German): `docs/superpowers/plans/2026-07-08-openwiki-hub.md`

Both documents are in German; code identifiers, comments and commit messages
are English; UI copy is German.

## Before writing code

1. Check what already exists: `ls hub/` and the plan's checkboxes. Continue
   from the first unchecked task; do not reorder tasks.
2. Read the plan's **Global Constraints** section in full — it fixes env-var
   names, ports, retention limits, import-extension rules and test commands.
3. Execute the plan with superpowers:subagent-driven-development or
   superpowers:executing-plans, one task per commit.

## Hard constraints (from spec + plan)

| Area              | Rule                                                                                                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root package      | Only additive, minimal changes: `exports` field in `package.json`, `packages:` in `pnpm-workspace.yaml`, optional `vitest.config.ts` limiting root tests to `test/**`. `src/` stays untouched.        |
| Upstream          | This is a fork of `langchain-ai/openwiki`; keep root diffs small so upstream merges stay cheap.                                                                                                       |
| Agent integration | Import `runOpenWikiAgent`/types/constants/diagnostics via the package exports — no child process.                                                                                                     |
| pnpm              | `minimumReleaseAge: 10080` in `pnpm-workspace.yaml` delays new versions by a week; accept what resolves.                                                                                              |
| Modules           | ESM everywhere. `hub/server` = NodeNext (`.js` on relative imports); `hub/web` = Bundler (extensionless).                                                                                             |
| Data              | `OPENWIKI_HUB_DATA_DIR/hub.sqlite` + `repos/<project-id>/`; docs are read from the clone, never pushed back.                                                                                          |
| Security          | No auth by design (internal network). GitLab token and provider keys must never appear in logs, scan logs, errors or API responses. Docs endpoint resolves paths strictly inside `<clone>/openwiki/`. |
| Tests             | Root `pnpm test` must stay green. Hub tests: `pnpm --filter <pkg> exec vitest run <file>`.                                                                                                            |
| Formatting        | `pnpm run format` before every commit — root Prettier covers `hub/`. If root ESLint trips over `hub/`, add it to the ignores in `eslint.config.js` additively.                                        |

## Reuse from the CLI package

| Need                        | Use                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run init/update on a clone  | `runOpenWikiAgent(command, cloneDir, { onEvent })` from `src/agent/index.ts`                                                                                    |
| Decide init vs update       | Existence of `<clone>/openwiki/`                                                                                                                                |
| Event shape for logs/SSE    | `OpenWikiRunEvent` in `src/agent/types.ts`                                                                                                                      |
| Provider validation at boot | `resolveConfiguredProvider` + `getProviderApiKeyEnvKey` (`src/config/constants.ts`), `getErrorMessage`/`sanitizeDiagnosticText` (`src/platform/diagnostics.ts`) |
| Skip when nothing changed   | Compare HEAD to last successful scan's SHA (Hub-side), not `.last-update.json`                                                                                  |

## Common mistakes

- Touching `src/` to "make it exportable" — add an index/exports entry
  instead.
- Running the agent with `cwd` = the Hub process directory; it must be the
  clone directory, or the Hub documents itself.
- Skipping `pnpm run build` at the root before running the server — the
  `exports` point at `dist/`.
