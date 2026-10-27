---
name: hub-implementation
description: Use when implementing, continuing, or reviewing the OpenWiki Hub under `hub/`, including its Fastify server, React web app, GitLab sync, MCP endpoint, and operations.
---

# OpenWiki Hub implementation

## Current design and status

The Hub MVP is implemented. The authoritative design is
`docs/superpowers/specs/2026-10-27-openwiki-hub-v2-design.md`. The MVP plan and
its remaining checks are in `docs/superpowers/plans/2026-10-27-openwiki-hub-v2-mvp.md`.
SDLC follow-ups are tracked in `TODO.md` and
`docs/superpowers/plans/2026-10-27-openwiki-roadmap.md`.

The Hub collects committed `openwiki/` directories from GitLab projects. Each
repository's CI generates its wiki; the Hub does not run an LLM or push changes
back to repositories.

## Architecture

- `hub/server`: Fastify, GitLab client, SQLite metadata, snapshot sync, REST,
  MCP over Streamable HTTP, webhook, scheduler, and restart recovery.
- `hub/web`: React/Vite portal for project status, wiki pages, search, and
  administration. Assets are bundled locally; the app does not rely on a CDN.
- `hub/Dockerfile`: container build and runtime entry point. Data is stored in
  the configured data directory.

## Security and operations

- The API has no user authentication. Run the Hub behind an SSO reverse proxy
  on an internal network.
- The webhook is protected by `OPENWIKI_HUB_WEBHOOK_TOKEN`. State-changing API
  requests require `X-Requested-With` as a CSRF guard; this does not replace
  authentication.
- Never expose GitLab tokens in logs or responses. Continue redacting errors
  through the existing `redact` dependency.
- Resolve requested wiki paths strictly inside a snapshot's `openwiki/` tree.
- Do not hand-edit generated files under the repository's `openwiki/` folder.

## Build and verification

```sh
pnpm run build
pnpm --filter openwiki-hub-server typecheck
pnpm --filter openwiki-hub-server test
pnpm --filter openwiki-hub-web typecheck
pnpm --filter openwiki-hub-web test
pnpm --filter openwiki-hub-server run build
pnpm --filter openwiki-hub-web run build
```

For container changes, build from the repository root with
`docker build -f hub/Dockerfile -t openwiki-hub .` and verify `/healthz`.
