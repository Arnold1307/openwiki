# OpenWiki Hub v2 — MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein interner Hub, der `openwiki/`-Dokumentation mehrerer GitLab-Projekte einsammelt, anzeigt, durchsucht und per MCP über HTTP bereitstellt, ohne selbst Doku zu erzeugen.

**Architecture:** Zwei Pakete unter `hub/`: `hub/server` (Fastify, SQLite, GitLab-Client, Sync, Index, MCP-HTTP) und `hub/web` (React + Vite, nur Lesen). Der Hub nutzt die Upstream-Retrieval-Logik aus dem Root-Paket. Er ruft kein LLM auf. Erzeugt wird die Doku durch die CI pro Repo (E1).

**Tech Stack:** Node 22.22+ (ESM, NodeNext), TypeScript strict, Fastify, `@modelcontextprotocol/sdk` (Streamable-HTTP), SQLite, React 18, Vite, Vitest, marked, DOMPurify.

**Spec:** `docs/superpowers/specs/2026-10-27-openwiki-hub-v2-design.md` (E1–E5 freigegeben). Die alte Spec `2026-07-08-openwiki-hub-design.md` gilt nicht mehr.

## Annahmen zu den offenen Fragen

Bis zur Antwort gelten diese Annahmen. Jede lässt sich mit kleinem Aufwand ändern.

| #   | Frage (Spec)         | Annahme im MVP                                                                                                                    | Änderung später     |
| --- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| A1  | Versionen speichern? | Je Projekt die letzten **20** Snapshots (`sha`), älteste werden gelöscht.                                                         | Retention-Konstante |
| A2  | Projektzahl / Größe  | bis 200 Projekte, Wiki unter 10 MB. Download als Archiv, keine Klone.                                                             | —                   |
| A3  | Zugriff (E4)         | MVP läuft hinter einem Reverse Proxy mit SSO. CSRF-Schutz ist im Code. GitLab-OIDC kommt in Task 11, sobald ein Client existiert. | Task 11             |
| A4  | Gruppen              | Konfiguration über `OPENWIKI_HUB_GROUPS`, keine feste Gruppe im Code.                                                             | —                   |

## Umsetzungsstand (2026-10-27)

- Tasks 1–10: Server, Retrieval-API, MCP-HTTP, GitLab-Webhook/Zeitplan und
  Web-App liegen auf `feat/hub-mvp`. Server (59 Tests) und Web (11 Tests)
  bestehen; beide Pakete sind typgeprüft.
- Bei Task 10 ist die Playwright-End-to-End-Abnahme (Übersicht → Projekt →
  Seite → Suche bei gesperrtem externem Netz) noch offen. Die Web-Tests sind
  Vitest-Tests.
- Task 11 (GitLab-OIDC) bleibt ausgesetzt: Der MVP ist für SSO am Reverse Proxy
  vorgesehen; ein OIDC-Client wurde nicht festgelegt.
- Task 12 ist umgesetzt: Restart-Recovery, Container-Build und `/healthz` im
  gestarteten Container wurden geprüft.
- Phase 4: Der Prüfstand-Kontext ist über `GET /api/projects/:id/context?sha=`
  vorhanden und auf stabilen Inhalt/Ref getestet. Die Abstimmung mit ACTOR und
  der SpecLab-Resolver brauchen deren konkrete Schnittstellen.

## Global Constraints

- Ein PR = eine Änderung, Conventional-Commit-Titel (`CONTRIBUTING.md`). Ein Task = ein Commit.
- Root-Paket: Änderungen nur additiv und minimal. Ausnahme: ein `exports`-Eintrag für `./retrieval` (Task 7), damit der Hub die Retrieval-Logik importieren kann. `src/` selbst wird nicht geändert.
- ESM überall. `hub/server`: NodeNext, relative Imports mit `.js`. `hub/web`: Bundler, ohne Endung.
- Secrets (`GITLAB_TOKEN`, Provider-Keys) erscheinen nie in Logs, Scan-Protokollen, Fehlern oder Antworten. Jede Ausgabe mit Fehlertext läuft durch `sanitizeDiagnosticText` aus `src/platform/diagnostics.ts`.
- Kein CDN im Frontend. Alle Assets liegen im Bundle.
- Pfad-Auflösung im Doku-Endpunkt bleibt strikt innerhalb von `<snapshot>/openwiki/`.
- Formatierung: `pnpm run format` vor jedem Commit. Der Hub gehört in die Prettier-Prüfung des Roots.
- Upstream-Suite (`pnpm test` im Root) bleibt grün, so wie auf Linux belegt (3439 bestanden, 0 fehlgeschlagen).

## Review Focus

1. **Repo ohne `openwiki/`:** Status `kein Wiki` mit Anleitung, kein Absturz. Test in Task 5.
2. **`sha` nicht erreichbar oder nicht synchronisiert:** 404 mit klarer Meldung, kein stiller Fallback auf HEAD. Test in Task 7.
3. **Webhook-Token falsch oder fehlt:** 401, kein Sync. Test in Task 9.
4. **Pfad-Traversal im Doku-Endpunkt:** `../`, `%2e%2e`, absolute Pfade, Backslash. Test in Task 7.
5. **Kein Internet im Netz:** Die Doku-Ansicht rendert vollständig. Smoke-Test mit blockiertem Netz in Task 10.

---

### Task 1: Workspace-Gerüst

**Files:**

- Create: `hub/server/package.json`, `hub/server/tsconfig.json`, `hub/server/src/index.ts`, `hub/server/test/smoke.test.ts`
- Create: `hub/web/package.json`, `hub/web/tsconfig.json`, `hub/web/vite.config.ts`, `hub/web/src/main.tsx`
- Modify: `pnpm-workspace.yaml` (Pakete `hub/server`, `hub/web` ergänzen)
- Modify: `vitest.config.ts` im Root (nur `test/**` und `evals/**`, damit der Hub nicht mitläuft)

**Interfaces:**

- Consumes: nichts
- Produces: `buildServer(config: HubConfig): Promise<FastifyInstance>` in `hub/server/src/index.ts`

- [ ] **Step 1: Failing test:** `hub/server/test/smoke.test.ts` ruft `buildServer({...})` auf und erwartet `GET /healthz` → `200 { ok: true }`.
- [ ] **Step 2:** `pnpm --filter hub-server test` → FAIL (Modul fehlt).
- [ ] **Step 3:** Gerüst anlegen, `buildServer` mit einer Health-Route.
- [ ] **Step 4:** `pnpm --filter hub-server test` → PASS. `pnpm test` im Root → unverändert grün.
- [ ] **Step 5:** Commit `chore(hub): scaffold server and web workspaces`

### Task 2: Konfiguration

**Files:**

- Create: `hub/server/src/config.ts`, `hub/server/test/config.test.ts`

**Interfaces:**

- Produces: `loadConfig(env: NodeJS.ProcessEnv): HubConfig` mit `gitlabBaseUrl`, `gitlabToken`, `groups: string[]`, `schedule: string` (Default `0 2 * * *`), `dataDir` (Default `./data`), `concurrency` (Default 1), `webhookToken`, `retention` (Default 20).

- [ ] **Step 1: Failing tests:** fehlendes `GITLAB_TOKEN` → Fehler mit Variablennamen, aber **ohne** Tokenwert; `OPENWIKI_HUB_GROUPS="a, b ,"` → `["a","b"]`; Defaults.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `loadConfig` implementieren. Fehlermeldungen nennen nur Variablennamen.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(hub): load server configuration from environment`

### Task 3: GitLab-Client

**Files:**

- Create: `hub/server/src/gitlab/client.ts`, `hub/server/test/gitlab-client.test.ts`

**Interfaces:**

- Produces: `class GitLabClient { constructor(opts: {baseUrl, token, fetch?}); listGroupProjects(group: string): Promise<GitLabProject[]>; downloadArchive(projectId: number, ref: string, dest: string): Promise<void>; defaultBranchHead(projectId: number): Promise<{branch: string; sha: string}> }` und `GitLabAuthError`.
- `GitLabProject`: `{ id: number; path_with_namespace: string; default_branch: string; archived: boolean; web_url: string }`.

- [ ] **Step 1: Failing tests** (mit injiziertem `fetch`):
  - `listGroupProjects` folgt `x-next-page` über 3 Seiten und liefert alle Projekte, inklusive Untergruppen (`include_subgroups=true`).
  - Antwort 401 → `GitLabAuthError`, Fehlermeldung ohne Token.
  - `defaultBranchHead` liefert `sha` aus `/projects/:id/repository/branches/:default`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementieren. Token nur im Header `PRIVATE-TOKEN`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(hub): add GitLab API client with pagination`

### Task 4: Speicher (SQLite)

**Files:**

- Create: `hub/server/src/store/db.ts`, `hub/server/src/store/projects.ts`, `hub/server/src/store/snapshots.ts`, `hub/server/test/store-projects.test.ts`

**Interfaces:**

- Produces: `openDb(path): Db`; `upsertDiscovered(db, projects: GitLabProject[]): {created, archived}` mit Feldern `source = 'group'`; `addManualProject(db, url): Project` (`source='manual'`); `listProjects(db)`; `recordSnapshot(db, projectId, sha, status)`; `pruneSnapshots(db, projectId, keep: number)`.
- Tabellen: `projects(id, gitlab_id, path, web_url, default_branch, source, enabled, archived, updated_at)`, `snapshots(project_id, sha, status, synced_at, error)`.

- [ ] **Step 1: Failing tests:**
  - Neu entdeckte Projekte werden mit `source='group'` und `enabled=1` angelegt.
  - Ein verschwundenes Projekt wird `archived=1`, nicht gelöscht.
  - Ein manuelles Projekt bleibt unberührt, auch wenn die Discovery es nicht findet.
  - `pruneSnapshots(keep=20)` behält die 20 neuesten.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementieren. Bibliothek: `better-sqlite3` oder `node:sqlite` (Node 22.22 bringt es mit; Stabilität vorher prüfen).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(hub): persist projects and snapshots in sqlite`

### Task 5: Sync eines Projekts

**Files:**

- Create: `hub/server/src/sync/sync-project.ts`, `hub/server/test/sync-project.test.ts`

**Interfaces:**

- Consumes: `GitLabClient.defaultBranchHead`, `GitLabClient.downloadArchive`, Store aus Task 4
- Produces: `syncProject(deps, project): Promise<SyncResult>` mit `status: 'success' | 'skipped' | 'no-wiki' | 'failed'`. Snapshot-Pfad: `<dataDir>/<projectId>/<sha>/openwiki/`.

- [ ] **Step 1: Failing tests** (Fake-Client):
  - Gleicher `sha` wie letzter Erfolg → `skipped`, kein Download.
  - Archiv ohne `openwiki/` → `no-wiki`, Snapshot-Status ebenfalls `no-wiki`, mit Hinweis zur CI-Einrichtung.
  - Download-Fehler → `failed` mit Fehlertext, letzter erfolgreicher Snapshot bleibt nutzbar.
  - Nach Erfolg wird `pruneSnapshots(keep=20)` aufgerufen.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implementieren. Archiv in temporäres Verzeichnis, dann atomar umbenennen.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(hub): sync a project's openwiki snapshot by commit sha`

### Task 6: Staleness

**Files:**

- Create: `hub/server/src/sync/staleness.ts`, `hub/server/test/staleness.test.ts`

**Interfaces:**

- Produces: `wikiStaleness(db, projectId, headSha: string, compare: (from, to) => Promise<number>): Promise<{ syncedSha: string | null; commitsBehind: number | null }>`.
- Liest `gitHead` aus `.last-update.json` des letzten erfolgreichen Snapshots, wenn vorhanden; sonst `sha` des Snapshots.

- [ ] **Step 1: Failing tests:** Kein Snapshot → `syncedSha: null`, `commitsBehind: null`. Snapshot = HEAD → `0`. Snapshot ≠ HEAD → Vergleichsfunktion wird mit beiden SHAs aufgerufen.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(hub): report how far a project's wiki lags behind HEAD`

### Task 7: Suche, Lesen und REST-API

**Files:**

- Modify: `package.json` (Root): `exports` mit `"./retrieval": "./dist/retrieval/wiki.js"` (additiv, ein Eintrag)
- Create: `hub/server/src/routes/projects.ts`, `hub/server/src/routes/docs.ts`, `hub/server/src/docs/resolve-path.ts`, `hub/server/test/routes.test.ts`, `hub/server/test/resolve-path.test.ts`

**Interfaces:**

- Consumes: Retrieval aus `openwiki/retrieval` (Funktionen in `src/retrieval/wiki.ts`, bei Umsetzung Signatur prüfen)
- Produces: `resolveDocPath(snapshotRoot: string, relative: string): string` — wirft `PathError` bei allem außerhalb `<root>/openwiki/`.
- Routen (aus Spec): `GET /api/projects`, `POST /api/projects` (Body `{url}`), `PATCH /api/projects/:id`, `DELETE /api/projects/:id` (nur manuell), `POST /api/projects/:id/scan`, `POST /api/scan-all`, `GET /api/projects/:id/scans`, `GET /api/projects/:id/docs`, `GET /api/projects/:id/docs/file?path=`, `GET /api/projects/:id/context?sha=` (für Prüfstand), `GET /api/search?q=`.

- [ ] **Step 1: Failing tests** `resolve-path`: `../x`, `%2e%2e/x`, `/etc/passwd`, `a\\..\\..\\x` → `PathError`; `quickstart.md` → innerhalb `openwiki/`.
- [ ] **Step 2: Failing tests** `routes` (`fastify.inject`):
  - `GET /api/projects/:id/context?sha=unbekannt` → 404 mit Meldung, kein Fallback auf HEAD.
  - `GET /api/projects/:id/docs/file?path=../../x` → 400.
  - `DELETE` eines Gruppen-Projekts → 409.
  - `GET /api/search?q=retry` liefert Treffer mit `project` und Wiki-ID.
- [ ] **Step 3:** FAIL. **Step 4:** Implementieren. Den Root-Export nur für diese Funktionen nutzen.
- [ ] **Step 5:** `pnpm run build` im Root und `pnpm test` (Root) grün prüfen. Commit `feat(hub): expose project docs, context and search over REST`

### Task 8: MCP über HTTP

**Files:**

- Create: `hub/server/src/mcp/http.ts`, `hub/server/test/mcp-http.test.ts`

**Interfaces:**

- Produces: `registerMcpRoutes(app, search: SearchFn, readFn: ReadFn)`; Endpunkt `POST /mcp` (Streamable-HTTP) mit den Tools `openwiki_search`, `openwiki_read`, `openwiki_list_wikis`.
- Tool-Namen und Argumente gleich wie upstream (`src/integrations/mcp/server.ts`).

- [ ] **Step 1: Failing test:** `initialize` über HTTP → Antwort mit Server-Info; `tools/list` enthält die drei Tools mit dem Upstream-Schema (Vergleich mit Snapshot aus dem Root-Paket).
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(hub): serve wiki retrieval tools over MCP HTTP`

### Task 9: Webhook und Zeitplan

**Files:**

- Create: `hub/server/src/scheduler.ts`, `hub/server/src/routes/webhook.ts`, `hub/server/test/webhook.test.ts`

**Interfaces:**

- Produces: `POST /hooks/gitlab` prüft Header `X-Gitlab-Token` gegen `webhookToken` (Vergleich konstant); bei `object_kind === 'push'` und `ref === 'refs/heads/<default>'` wird `syncProject` für dieses Projekt eingereiht. `startScheduler(cron, job)`.

- [ ] **Step 1: Failing tests:** falscher oder fehlender Token → 401, kein Sync. Push auf Default-Branch → genau ein Sync. Push auf Feature-Branch → kein Sync.
- [ ] **Step 2:** FAIL. **Step 3:** Implementieren. Warteschlange mit `concurrency` aus Task 2. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(hub): sync on gitlab push webhook and nightly schedule`

### Task 10: Web-App

**Files:**

- Create: `hub/web/src/pages/Overview.tsx`, `hub/web/src/pages/ProjectDocs.tsx`, `hub/web/src/pages/Admin.tsx`, `hub/web/src/markdown.ts`, `hub/web/src/markdown.test.ts`
- Create: `hub/web/e2e/smoke.spec.ts` (Playwright, Netz blockiert)

**Interfaces:**

- Consumes: REST-API aus Task 7, `GET /api/projects` liefert `commitsBehind` aus Task 6.
- `markdown.ts`: `renderMarkdown(source: string, linkMap: (href) => string): string` mit DOMPurify, relative `.md`-Links werden zu Router-Links. Links auf `src/…` zeigen auf die GitLab-Weboberfläche.

- [ ] **Step 1: Failing test:** `markdown.test.ts`: `[x](./a.md)` → Router-Link; `<script>` wird entfernt; `[y](src/x.ts)` → GitLab-URL.
- [ ] **Step 2:** FAIL. **Step 3:** Seiten und Markdown-Hilfe implementieren. Alle Texte auf Deutsch, keine CDN-URLs (`grep -r "cdn\." hub/web/src` darf nichts finden).
- [ ] **Step 4:** PASS. Playwright-Smoke (Übersicht → Projekt → Seite → Suche) mit blockierter Netzverbindung zu externen Hosts.
- [ ] **Step 5:** Commit `feat(hub): add overview, docs and admin pages`

### Task 11: GitLab-OIDC (nur wenn A3 bestätigt)

**Files:** offen, nach Antwort auf Frage 3.

- [ ] **Step 1:** Warten auf Antwort. Ohne OIDC-Client bleibt der MVP hinter dem Reverse Proxy.

### Task 12: Betrieb

**Files:**

- Create: `hub/Dockerfile`, `hub/README.md`, `hub/server/test/healthz.test.ts` (ergänzen)

- [ ] **Step 1:** Container-Build, Healthcheck auf `/healthz`, `OPENWIKI_HUB_DATA_DIR` als Volume.
- [ ] **Step 2:** Aufbewahrung und Neustart-Verhalten: Scans im Status `running` werden beim Start als `failed („unterbrochen“)` markiert. Test in `hub/server/test/recovery.test.ts`.
- [ ] **Step 3:** Commit `chore(hub): add container, healthcheck and restart recovery`

---

## Abnahme (MVP)

- `pnpm --filter hub-server test` und `pnpm --filter hub-web test` grün; Root-`pnpm test` unverändert grün (Linux).
- Ein Gruppen-Lauf gegen eine Test-GitLab-Instanz zeigt Projekte, Aktualität, Doku-Ansicht und Suche.
- MCP-Client (Claude Code) kann `openwiki_search` und `openwiki_read` über HTTP aufrufen.
- Prüfstand-Kontext (`/context?sha=`) liefert den Snapshot zu einem bekannten Commit und 404 zu einem unbekannten.
