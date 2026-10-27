# OpenWiki Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Web-Portal im Monorepo, das GitLab-Projekte automatisch klont, mit der bestehenden openwiki-Agent-Runtime dokumentiert und die Dokus über eine React-Oberfläche anzeigt.

**Architecture:** pnpm-Workspace mit dem bestehenden CLI-Paket an der Wurzel plus zwei neuen Paketen `hub/server` (Fastify, SQLite, Cron-Scheduler, GitLab-API, SSE) und `hub/web` (React-SPA via Vite). Der Server importiert `runOpenWikiAgent` direkt als Library (kein Kindprozess) und streamt Agent-Events live ans Frontend.

**Tech Stack:** TypeScript (ESM, NodeNext), Fastify 5, better-sqlite3, croner, React 18 + react-router-dom + Vite, marked, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-08-openwiki-hub-design.md` — bei Widersprüchen gilt der Spec.

## Global Constraints

- Node >= 20, ESM überall (`"type": "module"`), TypeScript `strict`. Server-Code nutzt module/moduleResolution `NodeNext`, das Frontend `ESNext`/`Bundler`.
- Paketmanager ist pnpm (Workspace). `pnpm-workspace.yaml` enthält `minimumReleaseAge: 10080` — neu aufgelöste Versionen sind mindestens eine Woche alt. Nicht dagegen ankämpfen; Versionsranges wie unten angeben und akzeptieren, was pnpm auflöst.
- Bestehende Dateien an der Wurzel (`src/`, `package.json`, `tsconfig.json`) nur additiv und minimal ändern (Upstream-Fork!). Bestehende Tests (`test/*.test.ts`) müssen grün bleiben: `pnpm test` an der Wurzel.
- UI-Texte auf Deutsch; Code-Bezeichner, Kommentare und Commit-Messages auf Englisch (Conventional Commits: `feat:`, `chore:`, `test:` …).
- Secrets (GitLab-Token, API-Keys) dürfen niemals in Logs, Scan-Logs, Fehlermeldungen oder API-Antworten auftauchen.
- Env-Variablen des Hubs: `GITLAB_BASE_URL`, `GITLAB_TOKEN`, `OPENWIKI_HUB_GROUPS`, `OPENWIKI_HUB_SCHEDULE` (Default `0 3 * * *`), `OPENWIKI_HUB_DATA_DIR` (Default `./data`), `OPENWIKI_HUB_CONCURRENCY` (Default `1`), `OPENWIKI_HUB_PORT` (Default `4600`). Provider-Variablen (`OPENWIKI_PROVIDER`, API-Keys) bleiben die des bestehenden CLI.
- Scan-Historie: maximal 20 Scans pro Projekt aufbewahren.
- Testkommandos laufen aus dem Repo-Root mit `pnpm --filter <pkg> exec vitest run <datei>`.
- Vor jedem Commit `pnpm run format` ausführen — der CI-Format-Check (Prettier) erfasst das ganze Repo, auch `hub/`. Falls `pnpm run lint:check` über `hub/`-Dateien stolpert, das `hub`-Verzeichnis additiv in die Ignores von `eslint.config.js` aufnehmen (Root-Lint-Setup nicht umbauen).
- Import-Stil: im Server (`hub/server`, NodeNext) enden relative Imports auf `.js`; im Frontend (`hub/web`, Bundler-Resolution) sind relative Imports extensionslos.

## Zieldateistruktur

```
openwiki/
├── package.json               # + "exports"-Feld (additiv)
├── pnpm-workspace.yaml        # + packages: hub/*
├── vitest.config.ts           # NEU: begrenzt Root-Tests auf test/**
├── src/                       # unverändert
├── hub/
│   ├── server/
│   │   ├── package.json, tsconfig.json, vitest.config.ts
│   │   ├── src/
│   │   │   ├── config.ts      # Env-Konfiguration
│   │   │   ├── db.ts          # SQLite-Schema + Zugriffsfunktionen
│   │   │   ├── gitlab.ts      # GitLab-API-Client (Discovery)
│   │   │   ├── discovery.ts   # Gruppen-Sync in die DB
│   │   │   ├── git.ts         # Klonen/Fetchen mit Token
│   │   │   ├── events.ts      # EventBus für SSE
│   │   │   ├── scanner.ts     # Warteschlange + Scan-Ablauf
│   │   │   ├── docs.ts        # Doku-Dateibaum + sicheres Lesen
│   │   │   ├── app.ts         # Fastify-Instanz + Routen
│   │   │   └── index.ts       # Start: Config, DB, Cron, Static, Listen
│   │   └── test/              # *.test.ts je Modul
│   └── web/
│       ├── package.json, tsconfig.json, vite.config.ts, index.html
│       └── src/
│           ├── main.tsx, App.tsx, styles.css
│           ├── api.ts         # Typen + fetch-Helfer
│           ├── useEvents.ts   # SSE-Hook
│           ├── lib/links.ts   # Link-Klassifizierung (+ links.test.ts)
│           └── pages/ProjectList.tsx, DocsView.tsx, Admin.tsx
└── docs/superpowers/…         # Spec + dieser Plan
```

---

### Task 1: Workspace-Setup & Library-Exports

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `package.json` (nur `exports`-Feld ergänzen)
- Create: `vitest.config.ts` (Repo-Root)
- Create: `hub/server/package.json`, `hub/server/tsconfig.json`, `hub/server/vitest.config.ts`
- Test: `hub/server/test/smoke.test.ts`

**Interfaces:**

- Consumes: bestehende Module `src/agent/index.ts` (`runOpenWikiAgent`), `src/agent/types.ts`, `src/constants.ts`, `src/env.ts` — alle bereits exportiert, aber ohne Package-Exports nicht importierbar.
- Produces: Workspace-Paket `openwiki-hub-server`, das `import { runOpenWikiAgent } from "openwiki/agent"` und `import type { OpenWikiRunEvent } from "openwiki/agent/types"` auflösen kann. Spätere Tasks verlassen sich exakt auf diese Import-Pfade.

- [ ] **Step 1: Workspace-Pakete deklarieren**

`pnpm-workspace.yaml` — die bestehenden Zeilen (Kommentar + `minimumReleaseAge`) stehen lassen und ergänzen:

```yaml
packages:
  - "hub/*"
```

- [ ] **Step 2: Exports-Feld im Root-`package.json` ergänzen**

Direkt nach dem `"files"`-Array einfügen (nichts anderes ändern):

```json
"exports": {
  ".": "./dist/agent/index.js",
  "./agent": "./dist/agent/index.js",
  "./agent/types": "./dist/agent/types.js",
  "./constants": "./dist/constants.js",
  "./env": "./dist/env.js",
  "./diagnostics": "./dist/diagnostics.js",
  "./package.json": "./package.json"
},
```

- [ ] **Step 3: Root-Vitest auf `test/**` begrenzen**

Ohne Config sammelt `pnpm test` an der Wurzel künftig auch `hub/**/test` ein. Neue Datei `vitest.config.ts` im Repo-Root:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Server-Paket anlegen**

`hub/server/package.json`:

```json
{
  "name": "openwiki-hub-server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@fastify/static": "^8.0.0",
    "better-sqlite3": "^11.7.0",
    "croner": "^9.0.0",
    "fastify": "^5.2.0",
    "openwiki": "workspace:*"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.10.2",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^4.1.10"
  }
}
```

`hub/server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022"
  },
  "include": ["src/**/*.ts"]
}
```

`hub/server/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Failing Smoke-Test schreiben**

`hub/server/test/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runOpenWikiAgent } from "openwiki/agent";
import type { OpenWikiRunEvent } from "openwiki/agent/types";

describe("workspace wiring", () => {
  it("resolves the openwiki agent library entry point", () => {
    expect(typeof runOpenWikiAgent).toBe("function");
    const event: OpenWikiRunEvent = { type: "debug", message: "smoke" };
    expect(event.type).toBe("debug");
  });
});
```

- [ ] **Step 6: Installieren, Root bauen, Test rot→grün prüfen**

```bash
pnpm install
pnpm run build          # baut dist/ an der Wurzel — nötig für die exports
pnpm --filter openwiki-hub-server exec vitest run test/smoke.test.ts
```

Erwartet: Vor `pnpm run build` schlägt der Test mit „Cannot find module" fehl; nach dem Build: PASS.

- [ ] **Step 7: Root-Checks absichern**

```bash
pnpm test        # bestehende Tests, erwartet: alle PASS, keine hub-Tests dabei
pnpm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml vitest.config.ts hub/server
git commit -m "chore: add hub/server workspace package with openwiki library exports"
```

---

### Task 2: Server-Konfiguration (`config.ts`)

**Files:**

- Create: `hub/server/src/config.ts`
- Test: `hub/server/test/config.test.ts`

**Interfaces:**

- Produces:
  - `type HubConfig = { gitlabBaseUrl: string; gitlabToken: string; groups: string[]; schedule: string; dataDir: string; concurrency: number; port: number }`
  - `function loadHubConfig(env?: NodeJS.ProcessEnv): HubConfig` — wirft `Error` mit deutscher Meldung, wenn `GITLAB_BASE_URL` oder `GITLAB_TOKEN` fehlen.

- [ ] **Step 1: Failing Test schreiben**

`hub/server/test/config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadHubConfig } from "../src/config.js";
import path from "node:path";

const baseEnv = {
  GITLAB_BASE_URL: "https://gitlab.example.com/",
  GITLAB_TOKEN: "glpat-secret",
};

describe("loadHubConfig", () => {
  it("applies defaults and trims the base URL", () => {
    const config = loadHubConfig({ ...baseEnv });
    expect(config.gitlabBaseUrl).toBe("https://gitlab.example.com");
    expect(config.schedule).toBe("0 3 * * *");
    expect(config.concurrency).toBe(1);
    expect(config.port).toBe(4600);
    expect(config.groups).toEqual([]);
    expect(path.isAbsolute(config.dataDir)).toBe(true);
  });

  it("parses groups as comma separated list", () => {
    const config = loadHubConfig({
      ...baseEnv,
      OPENWIKI_HUB_GROUPS: " team-a , team-b/sub ,",
    });
    expect(config.groups).toEqual(["team-a", "team-b/sub"]);
  });

  it("throws a clear error when GITLAB_BASE_URL is missing", () => {
    expect(() => loadHubConfig({ GITLAB_TOKEN: "x" })).toThrow(
      /GITLAB_BASE_URL/,
    );
  });

  it("throws when concurrency is not a positive integer", () => {
    expect(() =>
      loadHubConfig({ ...baseEnv, OPENWIKI_HUB_CONCURRENCY: "zero" }),
    ).toThrow(/OPENWIKI_HUB_CONCURRENCY/);
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/config.test.ts`
Expected: FAIL — „Cannot find module '../src/config.js'"

- [ ] **Step 3: Implementieren**

`hub/server/src/config.ts`:

```ts
import path from "node:path";

export type HubConfig = {
  gitlabBaseUrl: string;
  gitlabToken: string;
  groups: string[];
  schedule: string;
  dataDir: string;
  concurrency: number;
  port: number;
};

const DEFAULT_SCHEDULE = "0 3 * * *";
const DEFAULT_PORT = 4600;

export function loadHubConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  return {
    gitlabBaseUrl: requireEnv(env, "GITLAB_BASE_URL").replace(/\/+$/u, ""),
    gitlabToken: requireEnv(env, "GITLAB_TOKEN"),
    groups: (env.OPENWIKI_HUB_GROUPS ?? "")
      .split(",")
      .map((group) => group.trim())
      .filter((group) => group.length > 0),
    schedule: env.OPENWIKI_HUB_SCHEDULE ?? DEFAULT_SCHEDULE,
    dataDir: path.resolve(env.OPENWIKI_HUB_DATA_DIR ?? "./data"),
    concurrency: parsePositiveInt(env, "OPENWIKI_HUB_CONCURRENCY", 1),
    port: parsePositiveInt(env, "OPENWIKI_HUB_PORT", DEFAULT_PORT),
  };
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();

  if (!value) {
    throw new Error(
      `${key} muss gesetzt sein, damit der OpenWiki Hub starten kann.`,
    );
  }

  return value;
}

function parsePositiveInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key];

  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${key} muss eine positive Ganzzahl sein.`);
  }

  return value;
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/config.test.ts`
Expected: PASS (4 Tests)

- [ ] **Step 5: Commit**

```bash
git add hub/server/src/config.ts hub/server/test/config.test.ts
git commit -m "feat: add hub server configuration loader"
```

---

### Task 3: Datenbank-Schicht (`db.ts`)

**Files:**

- Create: `hub/server/src/db.ts`
- Test: `hub/server/test/db.test.ts`

**Interfaces:**

- Consumes: nichts aus früheren Tasks (eigenständig; better-sqlite3 ist synchron).
- Produces (spätere Tasks nutzen exakt diese Namen):
  - `type ProjectSource = "group" | "manual"`
  - `type Project = { id: number; gitlabProjectId: number | null; name: string; pathWithNamespace: string; cloneUrl: string; webUrl: string; defaultBranch: string; source: ProjectSource; enabled: boolean; archived: boolean }`
  - `type ScanStatus = "queued" | "running" | "success" | "failed" | "skipped"`
  - `type Scan = { id: number; projectId: number; status: ScanStatus; startedAt: string | null; finishedAt: string | null; commitSha: string | null; log: string; error: string | null }`
  - `type GroupProjectInput = { gitlabProjectId: number; name: string; pathWithNamespace: string; cloneUrl: string; webUrl: string; defaultBranch: string }`
  - `type ManualProjectInput = Omit<GroupProjectInput, "gitlabProjectId">`
  - `function createHubDb(filePath: string): HubDb` — `":memory:"` erlaubt (Tests).
  - `type HubDb` mit Methoden: `listProjects(): Project[]`, `getProject(id: number): Project | null`, `upsertGroupProject(input: GroupProjectInput): { created: boolean }`, `archiveGroupProjectsNotIn(paths: string[]): number`, `addManualProject(input: ManualProjectInput): Project`, `setProjectEnabled(id: number, enabled: boolean): void`, `deleteProject(id: number): void`, `createScan(projectId: number): Scan` (Status `queued`), `getScan(id: number): Scan | null`, `updateScan(id, fields: Partial<Pick<Scan, "status" | "startedAt" | "finishedAt" | "commitSha" | "error">>): void`, `appendScanLog(id: number, text: string): void`, `listScans(projectId: number, limit?: number): Scan[]` (neueste zuerst), `latestSuccessfulScan(projectId: number): Scan | null`, `pruneScans(projectId: number, keep: number): number`, `hasOpenScan(projectId: number): boolean` (queued/running), `markRunningScansInterrupted(): number`, `close(): void`

- [ ] **Step 1: Failing Test schreiben**

`hub/server/test/db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHubDb } from "../src/db.js";

const groupInput = {
  gitlabProjectId: 42,
  name: "demo",
  pathWithNamespace: "team/demo",
  cloneUrl: "https://gitlab.example.com/team/demo.git",
  webUrl: "https://gitlab.example.com/team/demo",
  defaultBranch: "main",
};

describe("HubDb projects", () => {
  it("upserts group projects idempotently", () => {
    const db = createHubDb(":memory:");
    expect(db.upsertGroupProject(groupInput).created).toBe(true);
    expect(db.upsertGroupProject(groupInput).created).toBe(false);
    const projects = db.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      source: "group",
      enabled: true,
      archived: false,
      pathWithNamespace: "team/demo",
    });
  });

  it("archives group projects that disappeared, leaves manual ones alone", () => {
    const db = createHubDb(":memory:");
    db.upsertGroupProject(groupInput);
    db.addManualProject({
      name: "solo",
      pathWithNamespace: "misc/solo",
      cloneUrl: "https://gitlab.example.com/misc/solo.git",
      webUrl: "https://gitlab.example.com/misc/solo",
      defaultBranch: "main",
    });
    const archived = db.archiveGroupProjectsNotIn(["somewhere/else"]);
    expect(archived).toBe(1);
    const byPath = Object.fromEntries(
      db.listProjects().map((p) => [p.pathWithNamespace, p.archived]),
    );
    expect(byPath["team/demo"]).toBe(true);
    expect(byPath["misc/solo"]).toBe(false);
  });

  it("re-activates an archived group project when it reappears", () => {
    const db = createHubDb(":memory:");
    db.upsertGroupProject(groupInput);
    db.archiveGroupProjectsNotIn([]);
    db.upsertGroupProject(groupInput);
    expect(db.listProjects()[0]?.archived).toBe(false);
  });
});

describe("HubDb scans", () => {
  it("tracks scan lifecycle, log appends and pruning", () => {
    const db = createHubDb(":memory:");
    db.upsertGroupProject(groupInput);
    const project = db.listProjects()[0]!;
    const scan = db.createScan(project.id);
    expect(scan.status).toBe("queued");
    expect(db.hasOpenScan(project.id)).toBe(true);

    db.updateScan(scan.id, {
      status: "running",
      startedAt: "2026-07-08T00:00:00Z",
    });
    db.appendScanLog(scan.id, "hello ");
    db.appendScanLog(scan.id, "world");
    db.updateScan(scan.id, { status: "success", commitSha: "abc123" });

    const stored = db.getScan(scan.id)!;
    expect(stored.log).toBe("hello world");
    expect(db.latestSuccessfulScan(project.id)?.commitSha).toBe("abc123");
    expect(db.hasOpenScan(project.id)).toBe(false);

    for (let i = 0; i < 25; i += 1) {
      const s = db.createScan(project.id);
      db.updateScan(s.id, { status: "failed", error: "x" });
    }
    db.pruneScans(project.id, 20);
    expect(db.listScans(project.id, 100)).toHaveLength(20);
  });

  it("marks queued and running scans as interrupted on startup", () => {
    const db = createHubDb(":memory:");
    db.upsertGroupProject(groupInput);
    const project = db.listProjects()[0]!;
    const a = db.createScan(project.id);
    db.updateScan(a.id, { status: "running" });
    const b = db.createScan(project.id);
    expect(db.markRunningScansInterrupted()).toBe(2);
    expect(db.getScan(a.id)?.status).toBe("failed");
    expect(db.getScan(b.id)?.error).toMatch(/unterbrochen/i);
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/db.test.ts`
Expected: FAIL — „Cannot find module '../src/db.js'"

- [ ] **Step 3: Implementieren**

`hub/server/src/db.ts`:

```ts
import Database from "better-sqlite3";

export type ProjectSource = "group" | "manual";

export type Project = {
  id: number;
  gitlabProjectId: number | null;
  name: string;
  pathWithNamespace: string;
  cloneUrl: string;
  webUrl: string;
  defaultBranch: string;
  source: ProjectSource;
  enabled: boolean;
  archived: boolean;
};

export type ScanStatus =
  "queued" | "running" | "success" | "failed" | "skipped";

export type Scan = {
  id: number;
  projectId: number;
  status: ScanStatus;
  startedAt: string | null;
  finishedAt: string | null;
  commitSha: string | null;
  log: string;
  error: string | null;
};

export type GroupProjectInput = {
  gitlabProjectId: number;
  name: string;
  pathWithNamespace: string;
  cloneUrl: string;
  webUrl: string;
  defaultBranch: string;
};

export type ManualProjectInput = Omit<GroupProjectInput, "gitlabProjectId">;

export type HubDb = ReturnType<typeof createHubDb>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gitlab_project_id INTEGER,
  name TEXT NOT NULL,
  path_with_namespace TEXT NOT NULL UNIQUE,
  clone_url TEXT NOT NULL,
  web_url TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('group','manual')),
  enabled INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued','running','success','failed','skipped')),
  started_at TEXT,
  finished_at TEXT,
  commit_sha TEXT,
  log TEXT NOT NULL DEFAULT '',
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_scans_project ON scans(project_id, id DESC);
`;

export function createHubDb(filePath: string) {
  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  return {
    listProjects(): Project[] {
      return db
        .prepare("SELECT * FROM projects ORDER BY path_with_namespace")
        .all()
        .map(rowToProject);
    },

    getProject(id: number): Project | null {
      const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
      return row ? rowToProject(row) : null;
    },

    upsertGroupProject(input: GroupProjectInput): { created: boolean } {
      const existing = db
        .prepare("SELECT id FROM projects WHERE path_with_namespace = ?")
        .get(input.pathWithNamespace) as { id: number } | undefined;

      if (existing) {
        db.prepare(
          `UPDATE projects SET gitlab_project_id = ?, name = ?, clone_url = ?,
           web_url = ?, default_branch = ?, archived = 0 WHERE id = ?`,
        ).run(
          input.gitlabProjectId,
          input.name,
          input.cloneUrl,
          input.webUrl,
          input.defaultBranch,
          existing.id,
        );
        return { created: false };
      }

      db.prepare(
        `INSERT INTO projects (gitlab_project_id, name, path_with_namespace,
         clone_url, web_url, default_branch, source)
         VALUES (?, ?, ?, ?, ?, ?, 'group')`,
      ).run(
        input.gitlabProjectId,
        input.name,
        input.pathWithNamespace,
        input.cloneUrl,
        input.webUrl,
        input.defaultBranch,
      );
      return { created: true };
    },

    archiveGroupProjectsNotIn(paths: string[]): number {
      const keep = new Set(paths);
      const rows = db
        .prepare(
          "SELECT id, path_with_namespace FROM projects WHERE source = 'group' AND archived = 0",
        )
        .all() as { id: number; path_with_namespace: string }[];
      const archive = db.prepare(
        "UPDATE projects SET archived = 1 WHERE id = ?",
      );
      let count = 0;

      for (const row of rows) {
        if (!keep.has(row.path_with_namespace)) {
          archive.run(row.id);
          count += 1;
        }
      }

      return count;
    },

    addManualProject(input: ManualProjectInput): Project {
      const result = db
        .prepare(
          `INSERT INTO projects (name, path_with_namespace, clone_url, web_url,
           default_branch, source) VALUES (?, ?, ?, ?, ?, 'manual')`,
        )
        .run(
          input.name,
          input.pathWithNamespace,
          input.cloneUrl,
          input.webUrl,
          input.defaultBranch,
        );
      return this.getProject(Number(result.lastInsertRowid))!;
    },

    setProjectEnabled(id: number, enabled: boolean): void {
      db.prepare("UPDATE projects SET enabled = ? WHERE id = ?").run(
        enabled ? 1 : 0,
        id,
      );
    },

    deleteProject(id: number): void {
      db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    },

    createScan(projectId: number): Scan {
      const result = db
        .prepare("INSERT INTO scans (project_id, status) VALUES (?, 'queued')")
        .run(projectId);
      return this.getScan(Number(result.lastInsertRowid))!;
    },

    getScan(id: number): Scan | null {
      const row = db.prepare("SELECT * FROM scans WHERE id = ?").get(id);
      return row ? rowToScan(row) : null;
    },

    updateScan(
      id: number,
      fields: Partial<
        Pick<
          Scan,
          "status" | "startedAt" | "finishedAt" | "commitSha" | "error"
        >
      >,
    ): void {
      const mapping = {
        status: "status",
        startedAt: "started_at",
        finishedAt: "finished_at",
        commitSha: "commit_sha",
        error: "error",
      } as const;
      const columns: string[] = [];
      const values: unknown[] = [];

      for (const [key, column] of Object.entries(mapping)) {
        if (key in fields) {
          columns.push(`${column} = ?`);
          values.push(fields[key as keyof typeof fields] ?? null);
        }
      }

      if (columns.length === 0) {
        return;
      }

      db.prepare(`UPDATE scans SET ${columns.join(", ")} WHERE id = ?`).run(
        ...values,
        id,
      );
    },

    appendScanLog(id: number, text: string): void {
      db.prepare("UPDATE scans SET log = log || ? WHERE id = ?").run(text, id);
    },

    listScans(projectId: number, limit = 20): Scan[] {
      return db
        .prepare(
          "SELECT * FROM scans WHERE project_id = ? ORDER BY id DESC LIMIT ?",
        )
        .all(projectId, limit)
        .map(rowToScan);
    },

    latestSuccessfulScan(projectId: number): Scan | null {
      const row = db
        .prepare(
          "SELECT * FROM scans WHERE project_id = ? AND status = 'success' ORDER BY id DESC LIMIT 1",
        )
        .get(projectId);
      return row ? rowToScan(row) : null;
    },

    pruneScans(projectId: number, keep: number): number {
      const result = db
        .prepare(
          `DELETE FROM scans WHERE project_id = ? AND id NOT IN (
             SELECT id FROM scans WHERE project_id = ? ORDER BY id DESC LIMIT ?
           )`,
        )
        .run(projectId, projectId, keep);
      return result.changes;
    },

    hasOpenScan(projectId: number): boolean {
      const row = db
        .prepare(
          "SELECT id FROM scans WHERE project_id = ? AND status IN ('queued','running') LIMIT 1",
        )
        .get(projectId);
      return row !== undefined;
    },

    markRunningScansInterrupted(): number {
      const result = db
        .prepare(
          `UPDATE scans SET status = 'failed', error = 'Durch Server-Neustart unterbrochen',
           finished_at = datetime('now') WHERE status IN ('queued','running')`,
        )
        .run();
      return result.changes;
    },

    close(): void {
      db.close();
    },
  };
}

function rowToProject(row: unknown): Project {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as number,
    gitlabProjectId: (r.gitlab_project_id as number | null) ?? null,
    name: r.name as string,
    pathWithNamespace: r.path_with_namespace as string,
    cloneUrl: r.clone_url as string,
    webUrl: r.web_url as string,
    defaultBranch: r.default_branch as string,
    source: r.source as ProjectSource,
    enabled: r.enabled === 1,
    archived: r.archived === 1,
  };
}

function rowToScan(row: unknown): Scan {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as number,
    projectId: r.project_id as number,
    status: r.status as ScanStatus,
    startedAt: (r.started_at as string | null) ?? null,
    finishedAt: (r.finished_at as string | null) ?? null,
    commitSha: (r.commit_sha as string | null) ?? null,
    log: r.log as string,
    error: (r.error as string | null) ?? null,
  };
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/db.test.ts`
Expected: PASS (5 Tests)

- [ ] **Step 5: Commit**

```bash
git add hub/server/src/db.ts hub/server/test/db.test.ts
git commit -m "feat: add hub sqlite database layer for projects and scans"
```

---

### Task 4: GitLab-API-Client (`gitlab.ts`)

**Files:**

- Create: `hub/server/src/gitlab.ts`
- Test: `hub/server/test/gitlab.test.ts`

**Interfaces:**

- Consumes: `HubConfig` aus Task 2 (nur `gitlabBaseUrl`, `gitlabToken`).
- Produces:
  - `type GitLabProject = { gitlabProjectId: number; name: string; pathWithNamespace: string; cloneUrl: string; webUrl: string; defaultBranch: string }`
  - `function listGroupProjects(config: Pick<HubConfig, "gitlabBaseUrl" | "gitlabToken">, group: string, fetchImpl?: typeof fetch): Promise<GitLabProject[]>` — paginiert über den `x-next-page`-Header, nutzt `include_subgroups=true`, wirft bei HTTP-Fehlern einen `Error` mit Statuscode, der den Token nicht enthält.

- [ ] **Step 1: Failing Test schreiben**

`hub/server/test/gitlab.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { listGroupProjects } from "../src/gitlab.js";

const config = {
  gitlabBaseUrl: "https://gitlab.example.com",
  gitlabToken: "glpat-secret",
};

function gitlabProject(id: number) {
  return {
    id,
    name: `p${id}`,
    path_with_namespace: `team/p${id}`,
    http_url_to_repo: `https://gitlab.example.com/team/p${id}.git`,
    web_url: `https://gitlab.example.com/team/p${id}`,
    default_branch: "main",
  };
}

function jsonResponse(body: unknown, nextPage: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "x-next-page": nextPage },
  });
}

describe("listGroupProjects", () => {
  it("follows pagination and maps fields", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requested.push(url);
      expect((init?.headers as Record<string, string>)["PRIVATE-TOKEN"]).toBe(
        "glpat-secret",
      );
      return url.includes("page=2")
        ? jsonResponse([gitlabProject(2)], "")
        : jsonResponse([gitlabProject(1)], "2");
    }) as typeof fetch;

    const projects = await listGroupProjects(config, "team", fetchImpl);
    expect(projects).toHaveLength(2);
    expect(projects[0]).toEqual({
      gitlabProjectId: 1,
      name: "p1",
      pathWithNamespace: "team/p1",
      cloneUrl: "https://gitlab.example.com/team/p1.git",
      webUrl: "https://gitlab.example.com/team/p1",
      defaultBranch: "main",
    });
    expect(requested[0]).toContain("/api/v4/groups/team/projects");
    expect(requested[0]).toContain("include_subgroups=true");
  });

  it("encodes group paths with slashes", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/groups/team%2Fsub/projects");
      return jsonResponse([], "");
    }) as typeof fetch;
    await listGroupProjects(config, "team/sub", fetchImpl);
  });

  it("throws without leaking the token on http errors", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 401 })) as typeof fetch;
    await expect(listGroupProjects(config, "team", fetchImpl)).rejects.toThrow(
      /401/,
    );
    await expect(
      listGroupProjects(config, "team", fetchImpl),
    ).rejects.not.toThrow(/glpat-secret/);
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/gitlab.test.ts`
Expected: FAIL — „Cannot find module '../src/gitlab.js'"

- [ ] **Step 3: Implementieren**

`hub/server/src/gitlab.ts`:

```ts
import type { HubConfig } from "./config.js";

export type GitLabProject = {
  gitlabProjectId: number;
  name: string;
  pathWithNamespace: string;
  cloneUrl: string;
  webUrl: string;
  defaultBranch: string;
};

type GitLabApiProject = {
  id: number;
  name: string;
  path_with_namespace: string;
  http_url_to_repo: string;
  web_url: string;
  default_branch: string | null;
};

export async function listGroupProjects(
  config: Pick<HubConfig, "gitlabBaseUrl" | "gitlabToken">,
  group: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GitLabProject[]> {
  const projects: GitLabProject[] = [];
  let page = "1";

  while (page !== "") {
    const url =
      `${config.gitlabBaseUrl}/api/v4/groups/${encodeURIComponent(group)}` +
      `/projects?include_subgroups=true&archived=false&per_page=100&page=${page}`;
    const response = await fetchImpl(url, {
      headers: { "PRIVATE-TOKEN": config.gitlabToken },
    });

    if (!response.ok) {
      throw new Error(
        `GitLab-API-Fehler ${response.status} beim Laden der Gruppe "${group}".`,
      );
    }

    const body = (await response.json()) as GitLabApiProject[];

    for (const project of body) {
      projects.push({
        gitlabProjectId: project.id,
        name: project.name,
        pathWithNamespace: project.path_with_namespace,
        cloneUrl: project.http_url_to_repo,
        webUrl: project.web_url,
        defaultBranch: project.default_branch ?? "main",
      });
    }

    page = response.headers.get("x-next-page") ?? "";
  }

  return projects;
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/gitlab.test.ts`
Expected: PASS (3 Tests)

- [ ] **Step 5: Commit**

```bash
git add hub/server/src/gitlab.ts hub/server/test/gitlab.test.ts
git commit -m "feat: add gitlab group project discovery client"
```

---

### Task 5: Discovery (`discovery.ts`)

**Files:**

- Create: `hub/server/src/discovery.ts`
- Test: `hub/server/test/discovery.test.ts`

**Interfaces:**

- Consumes: `HubDb` (Task 3: `upsertGroupProject`, `archiveGroupProjectsNotIn`), `listGroupProjects` (Task 4), `HubConfig` (Task 2).
- Produces:
  - `function runDiscovery(db: HubDb, config: HubConfig, list?: typeof listGroupProjects): Promise<{ added: number; archived: number }>` — bei `config.groups.length === 0` No-Op mit `{ added: 0, archived: 0 }`.

- [ ] **Step 1: Failing Test schreiben**

`hub/server/test/discovery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createHubDb } from "../src/db.js";
import { runDiscovery } from "../src/discovery.js";
import type { GitLabProject } from "../src/gitlab.js";

const config = {
  gitlabBaseUrl: "https://gitlab.example.com",
  gitlabToken: "t",
  groups: ["team-a", "team-b"],
  schedule: "0 3 * * *",
  dataDir: "/tmp/data",
  concurrency: 1,
  port: 4600,
};

function remote(id: number, path: string): GitLabProject {
  return {
    gitlabProjectId: id,
    name: path.split("/").at(-1)!,
    pathWithNamespace: path,
    cloneUrl: `https://gitlab.example.com/${path}.git`,
    webUrl: `https://gitlab.example.com/${path}`,
    defaultBranch: "main",
  };
}

describe("runDiscovery", () => {
  it("adds new projects from all groups and archives vanished ones", async () => {
    const db = createHubDb(":memory:");
    db.upsertGroupProject(remote(9, "team-a/old"));

    const byGroup: Record<string, GitLabProject[]> = {
      "team-a": [remote(1, "team-a/one")],
      "team-b": [remote(2, "team-b/two")],
    };
    const result = await runDiscovery(
      db,
      config,
      async (_c, group) => byGroup[group] ?? [],
    );

    expect(result).toEqual({ added: 2, archived: 1 });
    const byPath = Object.fromEntries(
      db.listProjects().map((p) => [p.pathWithNamespace, p.archived]),
    );
    expect(byPath).toEqual({
      "team-a/old": true,
      "team-a/one": false,
      "team-b/two": false,
    });
  });

  it("is a no-op without configured groups", async () => {
    const db = createHubDb(":memory:");
    const result = await runDiscovery(db, { ...config, groups: [] });
    expect(result).toEqual({ added: 0, archived: 0 });
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/discovery.test.ts`
Expected: FAIL — „Cannot find module '../src/discovery.js'"

- [ ] **Step 3: Implementieren**

`hub/server/src/discovery.ts`:

```ts
import type { HubConfig } from "./config.js";
import type { HubDb } from "./db.js";
import { listGroupProjects } from "./gitlab.js";

export async function runDiscovery(
  db: HubDb,
  config: HubConfig,
  list: typeof listGroupProjects = listGroupProjects,
): Promise<{ added: number; archived: number }> {
  if (config.groups.length === 0) {
    return { added: 0, archived: 0 };
  }

  const seenPaths: string[] = [];
  let added = 0;

  for (const group of config.groups) {
    for (const project of await list(config, group)) {
      seenPaths.push(project.pathWithNamespace);

      if (db.upsertGroupProject(project).created) {
        added += 1;
      }
    }
  }

  return { added, archived: db.archiveGroupProjectsNotIn(seenPaths) };
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/discovery.test.ts`
Expected: PASS (2 Tests)

- [ ] **Step 5: Commit**

```bash
git add hub/server/src/discovery.ts hub/server/test/discovery.test.ts
git commit -m "feat: sync gitlab group projects into hub database"
```

---

### Task 6: Git-Sync (`git.ts`)

**Files:**

- Create: `hub/server/src/git.ts`
- Test: `hub/server/test/git.test.ts`

**Interfaces:**

- Consumes: nichts aus früheren Tasks.
- Produces:
  - `function buildAuthenticatedCloneUrl(cloneUrl: string, token: string): string` — bettet `oauth2:<token>@` nur bei http(s)-URLs ein; andere URLs (z. B. `file://` für Tests) unverändert.
  - `function redactSecret(text: string, secret: string): string` — ersetzt jedes Vorkommen durch `[REDACTED]`.
  - `function syncRepo(options: { cloneUrl: string; defaultBranch: string; token: string; repoDir: string }): Promise<{ headSha: string }>` — klont beim ersten Mal, sonst `fetch` + `checkout` + `reset --hard origin/<branch>`. Läuft **ohne** `git clean`, damit der untracked `openwiki/`-Ordner im Klon überlebt. Fehlermeldungen werden vor dem Werfen mit `redactSecret` bereinigt.

- [ ] **Step 1: Failing Test schreiben**

`hub/server/test/git.test.ts` (der Integrationstest nutzt ein lokales Origin-Repo im Temp-Verzeichnis; `git` ist in CI und Dev vorhanden):

```ts
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAuthenticatedCloneUrl,
  redactSecret,
  syncRepo,
} from "../src/git.js";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function createOrigin(): {
  originDir: string;
  commit: (name: string) => string;
} {
  const originDir = mkdtempSync(path.join(os.tmpdir(), "hub-origin-"));
  git(["init", "--initial-branch=main"], originDir);
  git(["config", "user.email", "test@example.com"], originDir);
  git(["config", "user.name", "Test"], originDir);

  return {
    originDir,
    commit: (name: string) => {
      writeFileSync(path.join(originDir, name), name);
      git(["add", "."], originDir);
      git(["commit", "-m", `add ${name}`], originDir);
      return git(["rev-parse", "HEAD"], originDir).trim();
    },
  };
}

describe("buildAuthenticatedCloneUrl", () => {
  it("embeds oauth2 credentials into https urls", () => {
    expect(
      buildAuthenticatedCloneUrl("https://gitlab.example.com/a/b.git", "tok"),
    ).toBe("https://oauth2:tok@gitlab.example.com/a/b.git");
  });

  it("leaves non-http urls untouched", () => {
    expect(buildAuthenticatedCloneUrl("file:///tmp/repo", "tok")).toBe(
      "file:///tmp/repo",
    );
  });
});

describe("redactSecret", () => {
  it("removes every occurrence of the secret", () => {
    expect(redactSecret("x tok y tok", "tok")).toBe(
      "x [REDACTED] y [REDACTED]",
    );
    expect(redactSecret("nothing", "")).toBe("nothing");
  });
});

describe("syncRepo", () => {
  it("clones, then fetches new commits, and keeps untracked files", async () => {
    const { originDir, commit } = createOrigin();
    const firstSha = commit("one.txt");
    const workDir = mkdtempSync(path.join(os.tmpdir(), "hub-work-"));
    const repoDir = path.join(workDir, "repos", "1");
    const cloneUrl = pathToFileURL(originDir).toString();

    const first = await syncRepo({
      cloneUrl,
      defaultBranch: "main",
      token: "tok",
      repoDir,
    });
    expect(first.headSha).toBe(firstSha);

    // simulate generated docs (untracked in the scanned repo)
    mkdirSync(path.join(repoDir, "openwiki"), { recursive: true });
    writeFileSync(path.join(repoDir, "openwiki", "quickstart.md"), "# hi");

    const secondSha = commit("two.txt");
    const second = await syncRepo({
      cloneUrl,
      defaultBranch: "main",
      token: "tok",
      repoDir,
    });
    expect(second.headSha).toBe(secondSha);
    expect(existsSync(path.join(repoDir, "two.txt"))).toBe(true);
    expect(
      readFileSync(path.join(repoDir, "openwiki", "quickstart.md"), "utf8"),
    ).toBe("# hi");
  });

  it("throws redacted errors", async () => {
    const workDir = mkdtempSync(path.join(os.tmpdir(), "hub-work-"));
    await expect(
      syncRepo({
        cloneUrl: "https://gitlab.invalid/nope.git",
        defaultBranch: "main",
        token: "supersecret",
        repoDir: path.join(workDir, "repos", "2"),
      }),
    ).rejects.toThrow(/^((?!supersecret).)*$/s);
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/git.test.ts`
Expected: FAIL — „Cannot find module '../src/git.js'"

- [ ] **Step 3: Implementieren**

`hub/server/src/git.ts`:

```ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function buildAuthenticatedCloneUrl(
  cloneUrl: string,
  token: string,
): string {
  let url: URL;

  try {
    url = new URL(cloneUrl);
  } catch {
    return cloneUrl;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return cloneUrl;
  }

  url.username = "oauth2";
  url.password = token;
  return url.toString();
}

export function redactSecret(text: string, secret: string): string {
  if (secret.length === 0) {
    return text;
  }

  return text.split(secret).join("[REDACTED]");
}

export async function syncRepo(options: {
  cloneUrl: string;
  defaultBranch: string;
  token: string;
  repoDir: string;
}): Promise<{ headSha: string }> {
  const { cloneUrl, defaultBranch, token, repoDir } = options;
  const authUrl = buildAuthenticatedCloneUrl(cloneUrl, token);

  try {
    if (existsSync(path.join(repoDir, ".git"))) {
      await git(["remote", "set-url", "origin", authUrl], repoDir);
      await git(["fetch", "origin", defaultBranch], repoDir);
      await git(["checkout", defaultBranch], repoDir);
      // No `git clean`: the generated openwiki/ docs are untracked in the
      // scanned repo and must survive updates.
      await git(["reset", "--hard", `origin/${defaultBranch}`], repoDir);
    } else {
      await mkdir(path.dirname(repoDir), { recursive: true });
      await git(
        ["clone", "--branch", defaultBranch, authUrl, repoDir],
        path.dirname(repoDir),
      );
    }

    const { stdout } = await git(["rev-parse", "HEAD"], repoDir);
    return { headSha: stdout.trim() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redactSecret(message, token));
  }
}

function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/git.test.ts`
Expected: PASS (5 Tests; der Fehlerfall-Test darf einige Sekunden dauern, weil git die ungültige Domain auflösen will)

- [ ] **Step 5: Commit**

```bash
git add hub/server/src/git.ts hub/server/test/git.test.ts
git commit -m "feat: add token-authenticated git clone and fetch helper"
```

---

### Task 7: Event-Bus (`events.ts`)

**Files:**

- Create: `hub/server/src/events.ts`
- Test: `hub/server/test/events.test.ts`

**Interfaces:**

- Consumes: `ScanStatus` aus Task 3.
- Produces (Scanner und SSE-Route nutzen exakt diese Formen):
  - `type HubEvent = { type: "scan-status"; projectId: number; scanId: number; status: ScanStatus } | { type: "scan-log"; projectId: number; scanId: number; line: string }`
  - `class EventBus { subscribe(listener: (event: HubEvent) => void): () => void; publish(event: HubEvent): void }` — `subscribe` liefert eine Unsubscribe-Funktion; ein werfender Listener darf andere Listener nicht stören.

- [ ] **Step 1: Failing Test schreiben**

`hub/server/test/events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EventBus, type HubEvent } from "../src/events.js";

const event: HubEvent = {
  type: "scan-status",
  projectId: 1,
  scanId: 2,
  status: "running",
};

describe("EventBus", () => {
  it("delivers events to subscribers until unsubscribe", () => {
    const bus = new EventBus();
    const seen: HubEvent[] = [];
    const unsubscribe = bus.subscribe((e) => seen.push(e));

    bus.publish(event);
    unsubscribe();
    bus.publish(event);

    expect(seen).toHaveLength(1);
  });

  it("keeps delivering when one listener throws", () => {
    const bus = new EventBus();
    const seen: HubEvent[] = [];
    bus.subscribe(() => {
      throw new Error("boom");
    });
    bus.subscribe((e) => seen.push(e));

    bus.publish(event);
    expect(seen).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/events.test.ts`
Expected: FAIL — „Cannot find module '../src/events.js'"

- [ ] **Step 3: Implementieren**

`hub/server/src/events.ts`:

```ts
import type { ScanStatus } from "./db.js";

export type HubEvent =
  | {
      type: "scan-status";
      projectId: number;
      scanId: number;
      status: ScanStatus;
    }
  | {
      type: "scan-log";
      projectId: number;
      scanId: number;
      line: string;
    };

export class EventBus {
  private listeners = new Set<(event: HubEvent) => void>();

  subscribe(listener: (event: HubEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(event: HubEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken SSE client must not break other subscribers.
      }
    }
  }
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/events.test.ts`
Expected: PASS (2 Tests)

- [ ] **Step 5: Commit**

```bash
git add hub/server/src/events.ts hub/server/test/events.test.ts
git commit -m "feat: add hub event bus for scan status streaming"
```

---

### Task 8: Scanner & Warteschlange (`scanner.ts`)

**Files:**

- Create: `hub/server/src/scanner.ts`
- Test: `hub/server/test/scanner.test.ts`

**Interfaces:**

- Consumes: `HubDb`, `Scan` (Task 3), `HubConfig` (Task 2), `EventBus` (Task 7), `syncRepo` (Task 6), `runOpenWikiAgent` + `OpenWikiRunEvent` aus `openwiki/agent` bzw. `openwiki/agent/types` (Task 1).
- Produces (Routen in Task 10 nutzen exakt diese API):
  - `type ScannerDeps = { db: HubDb; config: HubConfig; bus: EventBus; sync?: typeof syncRepo; runAgent?: typeof runOpenWikiAgent }`
  - `class Scanner { constructor(deps: ScannerDeps); enqueueProject(projectId: number): Scan | null; enqueueAllEnabled(): Scan[]; onIdle(): Promise<void> }`
    - `enqueueProject` liefert `null`, wenn das Projekt fehlt/deaktiviert ist oder bereits ein offener Scan existiert (`hasOpenScan`).
    - `onIdle()` löst auf, sobald die Warteschlange leer ist (für Tests und sauberes Herunterfahren).
  - `function formatRunEvent(event: OpenWikiRunEvent): string | null` — `text` → Rohtext, `tool_start` → `"\n» <call>\n"`, `tool_end` mit `status === "error"` → `"\n✗ <name>\n"`, sonst `null` (auch für `debug`).
  - Ablauf pro Scan (Spec „Scan-Ablauf"): running setzen → `sync` → Skip-Check gegen `latestSuccessfulScan(...).commitSha` → `init` wenn `<repoDir>/openwiki` fehlt, sonst `update` → Events in Log + Bus → `success`/`skipped`/`failed` → `pruneScans(projectId, 20)`. Repo-Verzeichnis: `path.join(config.dataDir, "repos", String(project.id))`. Fehlertexte mit `redactSecret(..., config.gitlabToken)` bereinigen.

- [ ] **Step 1: Failing Test schreiben**

`hub/server/test/scanner.test.ts`:

```ts
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHubDb } from "../src/db.js";
import { EventBus, type HubEvent } from "../src/events.js";
import { Scanner, formatRunEvent } from "../src/scanner.js";
import type { OpenWikiRunEvent } from "openwiki/agent/types";

function setup(overrides: {
  sync?: () => Promise<{ headSha: string }>;
  agentEvents?: OpenWikiRunEvent[];
  failAgent?: boolean;
}) {
  const db = createHubDb(":memory:");
  db.upsertGroupProject({
    gitlabProjectId: 1,
    name: "demo",
    pathWithNamespace: "team/demo",
    cloneUrl: "https://gitlab.example.com/team/demo.git",
    webUrl: "https://gitlab.example.com/team/demo",
    defaultBranch: "main",
  });
  const project = db.listProjects()[0]!;
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "hub-scan-"));
  const bus = new EventBus();
  const events: HubEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const agentCalls: { command: string; cwd: string }[] = [];

  const scanner = new Scanner({
    db,
    bus,
    config: {
      gitlabBaseUrl: "https://gitlab.example.com",
      gitlabToken: "secret-token",
      groups: [],
      schedule: "0 3 * * *",
      dataDir,
      concurrency: 1,
      port: 4600,
    },
    sync: overrides.sync ?? (async () => ({ headSha: "sha-1" })),
    runAgent: (async (command: string, cwd: string, options: any) => {
      agentCalls.push({ command, cwd });
      if (overrides.failAgent) {
        throw new Error("agent exploded with secret-token inside");
      }
      for (const event of overrides.agentEvents ?? []) {
        options?.onEvent?.(event);
      }
      return { command, model: "test-model" };
    }) as never,
  });

  return { db, project, scanner, events, agentCalls, dataDir };
}

describe("Scanner", () => {
  it("runs an init scan, stores log and publishes events", async () => {
    const { db, project, scanner, events, agentCalls } = setup({
      agentEvents: [
        { type: "text", text: "Hallo" },
        {
          type: "tool_start",
          call: 'Execute(cmd="ls")',
          id: "1",
          input: {},
          name: "execute",
        },
        { type: "debug", message: "hidden" },
      ],
    });

    const scan = scanner.enqueueProject(project.id);
    expect(scan?.status).toBe("queued");
    await scanner.onIdle();

    const stored = db.getScan(scan!.id)!;
    expect(stored.status).toBe("success");
    expect(stored.commitSha).toBe("sha-1");
    expect(stored.log).toContain("Hallo");
    expect(stored.log).toContain("» Execute");
    expect(stored.log).not.toContain("hidden");
    expect(agentCalls[0]?.command).toBe("init");
    expect(
      events.some((e) => e.type === "scan-status" && e.status === "running"),
    ).toBe(true);
    expect(events.some((e) => e.type === "scan-log")).toBe(true);
  });

  it("skips when the head commit matches the last successful scan", async () => {
    const { db, project, scanner, agentCalls } = setup({});
    const previous = db.createScan(project.id);
    db.updateScan(previous.id, { status: "success", commitSha: "sha-1" });

    const scan = scanner.enqueueProject(project.id);
    await scanner.onIdle();

    expect(db.getScan(scan!.id)?.status).toBe("skipped");
    expect(agentCalls).toHaveLength(0);
  });

  it("runs update when the clone already has an openwiki directory", async () => {
    const { project, scanner, agentCalls, dataDir } = setup({});
    mkdirSync(path.join(dataDir, "repos", String(project.id), "openwiki"), {
      recursive: true,
    });

    scanner.enqueueProject(project.id);
    await scanner.onIdle();
    expect(agentCalls[0]?.command).toBe("update");
  });

  it("stores redacted errors on failure", async () => {
    const { db, project, scanner } = setup({ failAgent: true });
    const scan = scanner.enqueueProject(project.id);
    await scanner.onIdle();

    const stored = db.getScan(scan!.id)!;
    expect(stored.status).toBe("failed");
    expect(stored.error).toContain("[REDACTED]");
    expect(stored.error).not.toContain("secret-token");
  });

  it("rejects duplicate enqueues and disabled projects", async () => {
    const { db, project, scanner } = setup({});
    expect(scanner.enqueueProject(project.id)).not.toBeNull();
    expect(scanner.enqueueProject(project.id)).toBeNull();
    await scanner.onIdle();

    db.setProjectEnabled(project.id, false);
    expect(scanner.enqueueProject(project.id)).toBeNull();
  });
});

describe("formatRunEvent", () => {
  it("formats text, tool and debug events", () => {
    expect(formatRunEvent({ type: "text", text: "abc" })).toBe("abc");
    expect(
      formatRunEvent({
        type: "tool_start",
        call: "Execute()",
        id: "1",
        input: null,
        name: "execute",
      }),
    ).toBe("\n» Execute()\n");
    expect(
      formatRunEvent({
        type: "tool_end",
        id: "1",
        name: "execute",
        status: "error",
      }),
    ).toBe("\n✗ execute\n");
    expect(
      formatRunEvent({
        type: "tool_end",
        id: "1",
        name: "execute",
        status: "finished",
      }),
    ).toBeNull();
    expect(formatRunEvent({ type: "debug", message: "x" })).toBeNull();
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/scanner.test.ts`
Expected: FAIL — „Cannot find module '../src/scanner.js'"

- [ ] **Step 3: Implementieren**

`hub/server/src/scanner.ts`:

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import { runOpenWikiAgent } from "openwiki/agent";
import type { OpenWikiRunEvent } from "openwiki/agent/types";
import type { HubConfig } from "./config.js";
import type { HubDb, Scan } from "./db.js";
import type { EventBus } from "./events.js";
import { redactSecret, syncRepo } from "./git.js";

export type ScannerDeps = {
  db: HubDb;
  config: HubConfig;
  bus: EventBus;
  sync?: typeof syncRepo;
  runAgent?: typeof runOpenWikiAgent;
};

export function formatRunEvent(event: OpenWikiRunEvent): string | null {
  if (event.type === "text") {
    return event.text;
  }

  if (event.type === "tool_start") {
    return `\n» ${event.call}\n`;
  }

  if (event.type === "tool_end" && event.status === "error") {
    return `\n✗ ${event.name}\n`;
  }

  return null;
}

export class Scanner {
  private readonly db: HubDb;
  private readonly config: HubConfig;
  private readonly bus: EventBus;
  private readonly sync: typeof syncRepo;
  private readonly runAgent: typeof runOpenWikiAgent;
  private readonly queue: number[] = [];
  private active = 0;
  private idleResolvers: (() => void)[] = [];

  constructor(deps: ScannerDeps) {
    this.db = deps.db;
    this.config = deps.config;
    this.bus = deps.bus;
    this.sync = deps.sync ?? syncRepo;
    this.runAgent = deps.runAgent ?? runOpenWikiAgent;
  }

  enqueueProject(projectId: number): Scan | null {
    const project = this.db.getProject(projectId);

    if (!project || !project.enabled || this.db.hasOpenScan(projectId)) {
      return null;
    }

    const scan = this.db.createScan(projectId);
    this.queue.push(scan.id);
    this.publishStatus(scan.id, projectId, "queued");
    queueMicrotask(() => this.pump());
    return scan;
  }

  enqueueAllEnabled(): Scan[] {
    return this.db
      .listProjects()
      .filter((project) => project.enabled && !project.archived)
      .map((project) => this.enqueueProject(project.id))
      .filter((scan): scan is Scan => scan !== null);
  }

  onIdle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private pump(): void {
    while (this.active < this.config.concurrency && this.queue.length > 0) {
      const scanId = this.queue.shift()!;
      this.active += 1;
      void this.process(scanId).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }

    if (this.active === 0 && this.queue.length === 0) {
      for (const resolve of this.idleResolvers.splice(0)) {
        resolve();
      }
    }
  }

  private async process(scanId: number): Promise<void> {
    const scan = this.db.getScan(scanId);
    const project = scan ? this.db.getProject(scan.projectId) : null;

    if (!scan || !project) {
      return;
    }

    this.db.updateScan(scanId, {
      status: "running",
      startedAt: new Date().toISOString(),
    });
    this.publishStatus(scanId, project.id, "running");

    try {
      const repoDir = path.join(
        this.config.dataDir,
        "repos",
        String(project.id),
      );
      const { headSha } = await this.sync({
        cloneUrl: project.cloneUrl,
        defaultBranch: project.defaultBranch,
        token: this.config.gitlabToken,
        repoDir,
      });

      if (this.db.latestSuccessfulScan(project.id)?.commitSha === headSha) {
        this.finish(scanId, project.id, "skipped", { commitSha: headSha });
        return;
      }

      const command = existsSync(path.join(repoDir, "openwiki"))
        ? "update"
        : "init";

      await this.runAgent(command, repoDir, {
        onEvent: (event) => {
          const line = formatRunEvent(event);

          if (line !== null) {
            this.db.appendScanLog(scanId, line);
            this.bus.publish({
              type: "scan-log",
              projectId: project.id,
              scanId,
              line,
            });
          }
        },
      });

      this.finish(scanId, project.id, "success", { commitSha: headSha });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.finish(scanId, project.id, "failed", {
        error: redactSecret(message, this.config.gitlabToken),
      });
    } finally {
      this.db.pruneScans(project.id, 20);
    }
  }

  private finish(
    scanId: number,
    projectId: number,
    status: "success" | "failed" | "skipped",
    fields: { commitSha?: string; error?: string },
  ): void {
    this.db.updateScan(scanId, {
      status,
      finishedAt: new Date().toISOString(),
      ...fields,
    });
    this.publishStatus(scanId, projectId, status);
  }

  private publishStatus(
    scanId: number,
    projectId: number,
    status: Scan["status"],
  ): void {
    this.bus.publish({ type: "scan-status", projectId, scanId, status });
  }
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/scanner.test.ts`
Expected: PASS (6 Tests)

- [ ] **Step 5: Commit**

```bash
git add hub/server/src/scanner.ts hub/server/test/scanner.test.ts
git commit -m "feat: add scan queue orchestrating git sync and agent runs"
```

---

### Task 9: Doku-Zugriff (`docs.ts`)

**Files:**

- Create: `hub/server/src/docs.ts`
- Test: `hub/server/test/docs.test.ts`

**Interfaces:**

- Consumes: nichts aus früheren Tasks.
- Produces:
  - `type DocsNode = { name: string; path: string; children?: DocsNode[] }` — `path` ist relativ zum `openwiki/`-Ordner (posix-Separatoren); Ordner haben `children`, Dateien nicht. Sortierung: `quickstart.md` zuerst auf oberster Ebene, dann Ordner, dann Dateien, jeweils alphabetisch.
  - `class DocsAccessError extends Error` — für ungültige/ausbrechende Pfade.
  - `function listDocsTree(repoDir: string): Promise<DocsNode[]>` — leeres Array, wenn `openwiki/` nicht existiert; nur `.md`-Dateien und Ordner, die (transitiv) `.md`-Dateien enthalten; versteckte Einträge (führender Punkt, z. B. `.last-update.json`) werden übersprungen.
  - `function readDocFile(repoDir: string, relPath: string): Promise<string>` — wirft `DocsAccessError` bei Path Traversal oder Nicht-`.md`-Dateien.

- [ ] **Step 1: Failing Test schreiben**

`hub/server/test/docs.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DocsAccessError, listDocsTree, readDocFile } from "../src/docs.js";

function createRepo(): string {
  const repoDir = mkdtempSync(path.join(os.tmpdir(), "hub-docs-"));
  const docs = path.join(repoDir, "openwiki");
  mkdirSync(path.join(docs, "architecture"), { recursive: true });
  writeFileSync(path.join(docs, "quickstart.md"), "# Quickstart");
  writeFileSync(path.join(docs, "agents.md"), "# Agents");
  writeFileSync(path.join(docs, ".last-update.json"), "{}");
  writeFileSync(path.join(docs, "architecture", "overview.md"), "# Overview");
  writeFileSync(path.join(repoDir, "secret.md"), "top secret");
  return repoDir;
}

describe("listDocsTree", () => {
  it("lists markdown files with quickstart first and skips hidden files", async () => {
    const tree = await listDocsTree(createRepo());
    expect(tree.map((node) => node.name)).toEqual([
      "quickstart.md",
      "architecture",
      "agents.md",
    ]);
    expect(tree[1]?.children?.[0]?.path).toBe("architecture/overview.md");
    expect(JSON.stringify(tree)).not.toContain(".last-update");
  });

  it("returns an empty tree when openwiki/ is missing", async () => {
    const emptyRepo = mkdtempSync(path.join(os.tmpdir(), "hub-docs-empty-"));
    expect(await listDocsTree(emptyRepo)).toEqual([]);
  });
});

describe("readDocFile", () => {
  it("reads files inside openwiki/", async () => {
    const repo = createRepo();
    expect(await readDocFile(repo, "quickstart.md")).toBe("# Quickstart");
    expect(await readDocFile(repo, "architecture/overview.md")).toBe(
      "# Overview",
    );
  });

  it("rejects traversal and non-markdown paths", async () => {
    const repo = createRepo();
    await expect(readDocFile(repo, "../secret.md")).rejects.toThrow(
      DocsAccessError,
    );
    await expect(readDocFile(repo, "..\\secret.md")).rejects.toThrow(
      DocsAccessError,
    );
    await expect(readDocFile(repo, ".last-update.json")).rejects.toThrow(
      DocsAccessError,
    );
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/docs.test.ts`
Expected: FAIL — „Cannot find module '../src/docs.js'"

- [ ] **Step 3: Implementieren**

`hub/server/src/docs.ts`:

```ts
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type DocsNode = {
  name: string;
  path: string;
  children?: DocsNode[];
};

export class DocsAccessError extends Error {
  constructor(relPath: string) {
    super(`Ungültiger Doku-Pfad: ${relPath}`);
    this.name = "DocsAccessError";
  }
}

export async function listDocsTree(repoDir: string): Promise<DocsNode[]> {
  return listDir(path.join(repoDir, "openwiki"), "");
}

async function listDir(absDir: string, relDir: string): Promise<DocsNode[]> {
  let entries;

  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const directories: DocsNode[] = [];
  const files: DocsNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;

    if (entry.isDirectory()) {
      const children = await listDir(path.join(absDir, entry.name), relPath);

      if (children.length > 0) {
        directories.push({ name: entry.name, path: relPath, children });
      }
    } else if (entry.name.endsWith(".md")) {
      files.push({ name: entry.name, path: relPath });
    }
  }

  directories.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  const quickstartIndex = files.findIndex(
    (file) => relDir === "" && file.name === "quickstart.md",
  );

  if (quickstartIndex >= 0) {
    const [quickstart] = files.splice(quickstartIndex, 1);
    return [quickstart!, ...directories, ...files];
  }

  return [...directories, ...files];
}

export async function readDocFile(
  repoDir: string,
  relPath: string,
): Promise<string> {
  const docsRoot = path.resolve(repoDir, "openwiki");
  const resolved = path.resolve(docsRoot, relPath);

  if (!resolved.startsWith(docsRoot + path.sep)) {
    throw new DocsAccessError(relPath);
  }

  if (!resolved.endsWith(".md")) {
    throw new DocsAccessError(relPath);
  }

  try {
    return await readFile(resolved, "utf8");
  } catch {
    throw new DocsAccessError(relPath);
  }
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/docs.test.ts`
Expected: PASS (4 Tests)

- [ ] **Step 5: Commit**

```bash
git add hub/server/src/docs.ts hub/server/test/docs.test.ts
git commit -m "feat: add safe docs tree listing and file access"
```

---

### Task 10: Fastify-App, REST-API & Serverstart (`app.ts`, `index.ts`)

**Files:**

- Create: `hub/server/src/app.ts`
- Create: `hub/server/src/index.ts`
- Test: `hub/server/test/app.test.ts`

**Interfaces:**

- Consumes: alles aus Tasks 2–9 (`loadHubConfig`, `createHubDb`, `runDiscovery`, `Scanner`, `EventBus`, `listDocsTree`, `readDocFile`, `DocsAccessError`); außerdem `loadOpenWikiEnv` aus `openwiki/env` sowie `resolveConfiguredProvider`, `getProviderApiKeyEnvKey`, `getProviderLabel` aus `openwiki/constants` (Startup-Diagnose).
- Produces:
  - `type AppDeps = { db: HubDb; config: HubConfig; scanner: Scanner; bus: EventBus; discover?: () => Promise<{ added: number; archived: number }> }`
  - `function createApp(deps: AppDeps): FastifyInstance` — registriert alle `/api`-Routen; statisches Ausliefern der SPA kommt erst in Task 14 dazu.
  - REST-Antwortformen (Frontend in Tasks 11–13 nutzt exakt diese):
    - `GET /api/projects` → `{ projects: Array<Project & { lastScan: Scan | null; lastSuccess: Scan | null }> }` (Logs sind in dieser Liste auf `""` gekürzt)
    - `POST /api/projects` Body `{ url: string; defaultBranch?: string }` → `201 { project: Project }`; `400 { error: string }` bei ungültiger URL/Duplikat
    - `PATCH /api/projects/:id` Body `{ enabled: boolean }` → `{ ok: true }`
    - `DELETE /api/projects/:id` → `{ ok: true }`; `400`, wenn `source !== "manual"`; `404`, wenn unbekannt
    - `POST /api/projects/:id/scan` → `202 { scan: Scan }`; `409 { error }`, wenn bereits offen/deaktiviert
    - `POST /api/scan-all` → `{ discovery: { added: number; archived: number }; queued: number }`; bei Discovery-Fehler `502 { error }` (Token nie im Fehlertext)
    - `GET /api/projects/:id/scans` → `{ scans: Scan[] }`
    - `GET /api/projects/:id/docs` → `{ tree: DocsNode[] }`
    - `GET /api/projects/:id/docs/file?path=…` → `{ content: string }`; `400` bei `DocsAccessError`
    - `GET /api/config` → `{ groups: string[]; schedule: string; gitlabBaseUrl: string }`
    - `GET /api/events` → SSE-Stream; jede Nachricht `data: <JSON eines HubEvent>\n\n`
  - `index.ts` (Startskript, kein Test): lädt `~/.openwiki/.env` via `loadOpenWikiEnv()`, prüft Provider-Key (`resolveConfiguredProvider()` + `process.env[getProviderApiKeyEnvKey(provider)]` — bei Fehlen: klare deutsche Fehlermeldung und `process.exit(1)`), legt `dataDir` an, öffnet DB unter `<dataDir>/hub.sqlite`, ruft `markRunningScansInterrupted()`, startet `Cron` (croner) mit `config.schedule` → `runDiscovery` + `scanner.enqueueAllEnabled()`, dann `app.listen({ host: "0.0.0.0", port: config.port })`.

- [ ] **Step 1: Failing Test schreiben**

`hub/server/test/app.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createHubDb } from "../src/db.js";
import { EventBus } from "../src/events.js";
import { Scanner } from "../src/scanner.js";

function setup() {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "hub-app-"));
  const db = createHubDb(":memory:");
  const bus = new EventBus();
  const config = {
    gitlabBaseUrl: "https://gitlab.example.com",
    gitlabToken: "secret",
    groups: ["team"],
    schedule: "0 3 * * *",
    dataDir,
    concurrency: 1,
    port: 4600,
  };
  const scanner = new Scanner({
    db,
    config,
    bus,
    sync: async () => ({ headSha: "sha" }),
    runAgent: (async () => ({ command: "init", model: "m" })) as never,
  });
  const app = createApp({
    db,
    config,
    scanner,
    bus,
    discover: async () => ({ added: 1, archived: 0 }),
  });
  return { app, db, config, dataDir };
}

let cleanup: (() => Promise<void>) | null = null;
afterEach(async () => {
  await cleanup?.();
  cleanup = null;
});

describe("REST API", () => {
  it("creates manual projects from a gitlab url and lists them", async () => {
    const { app } = setup();
    cleanup = () => app.close();

    const created = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: "https://gitlab.example.com/misc/tool.git" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().project).toMatchObject({
      name: "tool",
      pathWithNamespace: "misc/tool",
      source: "manual",
      webUrl: "https://gitlab.example.com/misc/tool",
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: { url: "not a url" },
    });
    expect(invalid.statusCode).toBe(400);

    const list = await app.inject({ method: "GET", url: "/api/projects" });
    expect(list.json().projects).toHaveLength(1);
    expect(list.json().projects[0].lastScan).toBeNull();
  });

  it("only deletes manual projects", async () => {
    const { app, db } = setup();
    cleanup = () => app.close();
    db.upsertGroupProject({
      gitlabProjectId: 1,
      name: "demo",
      pathWithNamespace: "team/demo",
      cloneUrl: "https://gitlab.example.com/team/demo.git",
      webUrl: "https://gitlab.example.com/team/demo",
      defaultBranch: "main",
    });
    const project = db.listProjects()[0]!;

    const denied = await app.inject({
      method: "DELETE",
      url: `/api/projects/${project.id}`,
    });
    expect(denied.statusCode).toBe(400);
  });

  it("queues scans and rejects duplicates with 409", async () => {
    const { app, db } = setup();
    cleanup = () => app.close();
    db.upsertGroupProject({
      gitlabProjectId: 1,
      name: "demo",
      pathWithNamespace: "team/demo",
      cloneUrl: "https://gitlab.example.com/team/demo.git",
      webUrl: "https://gitlab.example.com/team/demo",
      defaultBranch: "main",
    });
    const project = db.listProjects()[0]!;

    const queued = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scan`,
    });
    expect(queued.statusCode).toBe(202);

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/projects/${project.id}/scan`,
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it("runs discovery plus scan-all", async () => {
    const { app } = setup();
    cleanup = () => app.close();
    const response = await app.inject({ method: "POST", url: "/api/scan-all" });
    expect(response.json().discovery).toEqual({ added: 1, archived: 0 });
  });

  it("serves docs tree and file content, rejecting traversal", async () => {
    const { app, db, dataDir } = setup();
    cleanup = () => app.close();
    db.upsertGroupProject({
      gitlabProjectId: 1,
      name: "demo",
      pathWithNamespace: "team/demo",
      cloneUrl: "https://gitlab.example.com/team/demo.git",
      webUrl: "https://gitlab.example.com/team/demo",
      defaultBranch: "main",
    });
    const project = db.listProjects()[0]!;
    const docsDir = path.join(dataDir, "repos", String(project.id), "openwiki");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(path.join(docsDir, "quickstart.md"), "# Hi");

    const tree = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/docs`,
    });
    expect(tree.json().tree[0].name).toBe("quickstart.md");

    const file = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/docs/file?path=quickstart.md`,
    });
    expect(file.json().content).toBe("# Hi");

    const traversal = await app.inject({
      method: "GET",
      url: `/api/projects/${project.id}/docs/file?path=../../secret.md`,
    });
    expect(traversal.statusCode).toBe(400);
  });

  it("exposes sanitized config", async () => {
    const { app } = setup();
    cleanup = () => app.close();
    const response = await app.inject({ method: "GET", url: "/api/config" });
    expect(response.json()).toEqual({
      groups: ["team"],
      schedule: "0 3 * * *",
      gitlabBaseUrl: "https://gitlab.example.com",
    });
    expect(response.body).not.toContain("secret");
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/app.test.ts`
Expected: FAIL — „Cannot find module '../src/app.js'"

- [ ] **Step 3: `app.ts` implementieren**

`hub/server/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from "fastify";
import path from "node:path";
import type { HubConfig } from "./config.js";
import type { HubDb, Project } from "./db.js";
import { DocsAccessError, listDocsTree, readDocFile } from "./docs.js";
import type { EventBus } from "./events.js";
import type { Scanner } from "./scanner.js";

export type AppDeps = {
  db: HubDb;
  config: HubConfig;
  scanner: Scanner;
  bus: EventBus;
  discover?: () => Promise<{ added: number; archived: number }>;
};

export function createApp(deps: AppDeps): FastifyInstance {
  const { db, config, scanner, bus } = deps;
  const app = Fastify({ logger: false });

  app.get("/api/projects", () => ({
    projects: db.listProjects().map((project) => ({
      ...project,
      lastScan: stripLog(db.listScans(project.id, 1)[0] ?? null),
      lastSuccess: stripLog(db.latestSuccessfulScan(project.id)),
    })),
  }));

  app.post("/api/projects", (request, reply) => {
    const body = request.body as { url?: string; defaultBranch?: string };
    const parsed = parseProjectUrl(body?.url ?? "");

    if (!parsed) {
      return reply
        .code(400)
        .send({ error: "Bitte eine gültige GitLab-Projekt-URL angeben." });
    }

    const duplicate = db
      .listProjects()
      .some((p) => p.pathWithNamespace === parsed.pathWithNamespace);

    if (duplicate) {
      return reply
        .code(400)
        .send({ error: "Dieses Projekt ist bereits eingetragen." });
    }

    const project = db.addManualProject({
      ...parsed,
      defaultBranch: body?.defaultBranch?.trim() || "main",
    });
    return reply.code(201).send({ project });
  });

  app.patch("/api/projects/:id", (request, reply) => {
    const project = findProject(request.params);

    if (!project) {
      return reply.code(404).send({ error: "Projekt nicht gefunden." });
    }

    const body = request.body as { enabled?: boolean };
    db.setProjectEnabled(project.id, body?.enabled === true);
    return { ok: true };
  });

  app.delete("/api/projects/:id", (request, reply) => {
    const project = findProject(request.params);

    if (!project) {
      return reply.code(404).send({ error: "Projekt nicht gefunden." });
    }

    if (project.source !== "manual") {
      return reply.code(400).send({
        error: "Nur manuell hinzugefügte Projekte können gelöscht werden.",
      });
    }

    db.deleteProject(project.id);
    return { ok: true };
  });

  app.post("/api/projects/:id/scan", (request, reply) => {
    const project = findProject(request.params);

    if (!project) {
      return reply.code(404).send({ error: "Projekt nicht gefunden." });
    }

    const scan = scanner.enqueueProject(project.id);

    if (!scan) {
      return reply.code(409).send({
        error: "Scan läuft bereits oder das Projekt ist deaktiviert.",
      });
    }

    return reply.code(202).send({ scan });
  });

  app.post("/api/scan-all", async (_request, reply) => {
    try {
      const discovery = deps.discover
        ? await deps.discover()
        : { added: 0, archived: 0 };
      return { discovery, queued: scanner.enqueueAllEnabled().length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(502).send({ error: message });
    }
  });

  app.get("/api/projects/:id/scans", (request, reply) => {
    const project = findProject(request.params);

    if (!project) {
      return reply.code(404).send({ error: "Projekt nicht gefunden." });
    }

    return { scans: db.listScans(project.id, 20) };
  });

  app.get("/api/projects/:id/docs", async (request, reply) => {
    const project = findProject(request.params);

    if (!project) {
      return reply.code(404).send({ error: "Projekt nicht gefunden." });
    }

    return { tree: await listDocsTree(repoDir(project)) };
  });

  app.get("/api/projects/:id/docs/file", async (request, reply) => {
    const project = findProject(request.params);

    if (!project) {
      return reply.code(404).send({ error: "Projekt nicht gefunden." });
    }

    const relPath = (request.query as { path?: string })?.path ?? "";

    try {
      return { content: await readDocFile(repoDir(project), relPath) };
    } catch (error) {
      if (error instanceof DocsAccessError) {
        return reply.code(400).send({ error: error.message });
      }

      throw error;
    }
  });

  app.get("/api/config", () => ({
    groups: config.groups,
    schedule: config.schedule,
    gitlabBaseUrl: config.gitlabBaseUrl,
  }));

  app.get("/api/events", (request, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    reply.raw.write(": connected\n\n");
    const unsubscribe = bus.subscribe((event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    request.raw.on("close", () => {
      unsubscribe();
      reply.raw.end();
    });
  });

  function findProject(params: unknown): Project | null {
    const id = Number.parseInt((params as { id?: string })?.id ?? "", 10);
    return Number.isInteger(id) ? db.getProject(id) : null;
  }

  function repoDir(project: Project): string {
    return path.join(config.dataDir, "repos", String(project.id));
  }

  return app;
}

function stripLog<T extends { log: string } | null>(scan: T): T {
  return scan === null ? scan : { ...scan, log: "" };
}

export function parseProjectUrl(raw: string): {
  name: string;
  pathWithNamespace: string;
  cloneUrl: string;
  webUrl: string;
} | null {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }

  const pathWithNamespace = url.pathname
    .replace(/^\/+/u, "")
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "");

  if (!pathWithNamespace.includes("/")) {
    return null;
  }

  const webUrl = `${url.origin}/${pathWithNamespace}`;
  return {
    name: pathWithNamespace.split("/").at(-1)!,
    pathWithNamespace,
    cloneUrl: `${webUrl}.git`,
    webUrl,
  };
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `pnpm --filter openwiki-hub-server exec vitest run test/app.test.ts`
Expected: PASS (6 Tests)

- [ ] **Step 5: `index.ts` implementieren (Startskript, per Smoke-Typecheck geprüft)**

`hub/server/src/index.ts`:

```ts
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Cron } from "croner";
import { loadOpenWikiEnv } from "openwiki/env";
import {
  getProviderApiKeyEnvKey,
  getProviderLabel,
  resolveConfiguredProvider,
} from "openwiki/constants";
import { createApp } from "./app.js";
import { loadHubConfig } from "./config.js";
import { createHubDb } from "./db.js";
import { runDiscovery } from "./discovery.js";
import { EventBus } from "./events.js";
import { Scanner } from "./scanner.js";

async function main(): Promise<void> {
  await loadOpenWikiEnv();

  const provider = resolveConfiguredProvider();
  const apiKeyEnvKey = getProviderApiKeyEnvKey(provider);

  if (!process.env[apiKeyEnvKey]) {
    console.error(
      `Fehlende Provider-Konfiguration: ${apiKeyEnvKey} ist nicht gesetzt ` +
        `(Provider: ${getProviderLabel(provider)}). ` +
        "Bitte ~/.openwiki/.env pflegen oder die Variable setzen.",
    );
    process.exit(1);
  }

  const config = loadHubConfig();
  await mkdir(config.dataDir, { recursive: true });

  const db = createHubDb(path.join(config.dataDir, "hub.sqlite"));
  const interrupted = db.markRunningScansInterrupted();

  if (interrupted > 0) {
    console.warn(
      `${interrupted} unterbrochene Scans als fehlgeschlagen markiert.`,
    );
  }

  const bus = new EventBus();
  const scanner = new Scanner({ db, config, bus });
  const discover = () => runDiscovery(db, config);
  const app = createApp({ db, config, scanner, bus, discover });

  new Cron(config.schedule, async () => {
    try {
      await discover();
    } catch (error) {
      console.error("Discovery fehlgeschlagen:", error);
    }

    scanner.enqueueAllEnabled();
  });

  await app.listen({ host: "0.0.0.0", port: config.port });
  console.log(`OpenWiki Hub läuft auf Port ${config.port}.`);
}

void main();
```

- [ ] **Step 6: Typecheck + alle Server-Tests**

```bash
pnpm --filter openwiki-hub-server typecheck
pnpm --filter openwiki-hub-server test
```

Expected: Typecheck ohne Fehler; alle Testdateien PASS.

- [ ] **Step 7: Commit**

```bash
git add hub/server/src/app.ts hub/server/src/index.ts hub/server/test/app.test.ts
git commit -m "feat: add hub rest api, sse endpoint and server entrypoint"
```

---

### Task 11: Web-Scaffold & Projektübersicht (`hub/web`)

**Files:**

- Create: `hub/web/package.json`, `hub/web/tsconfig.json`, `hub/web/vite.config.ts`, `hub/web/index.html`
- Create: `hub/web/src/main.tsx`, `hub/web/src/App.tsx`, `hub/web/src/styles.css`, `hub/web/src/api.ts`, `hub/web/src/lib/status.ts`, `hub/web/src/pages/ProjectList.tsx`
- Create (Platzhalter, werden in Task 12/13 gefüllt): `hub/web/src/pages/DocsView.tsx`, `hub/web/src/pages/Admin.tsx`
- Test: `hub/web/src/lib/status.test.ts`

**Interfaces:**

- Consumes: REST-Antwortformen aus Task 10 (`GET /api/projects` → `{ projects: ProjectWithStatus[] }`).
- Produces:
  - `api.ts`-Typen (Tasks 12/13 nutzen exakt diese): `Project`, `Scan`, `DocsNode`, `HubEvent`, `ProjectWithStatus = Project & { lastScan: Scan | null; lastSuccess: Scan | null }` sowie Funktionen `fetchProjects(): Promise<ProjectWithStatus[]>`, `addProject(url: string): Promise<void>`, `setProjectEnabled(id: number, enabled: boolean): Promise<void>`, `deleteProject(id: number): Promise<void>`, `triggerScan(id: number): Promise<void>`, `scanAll(): Promise<{ queued: number }>`, `fetchScans(id: number): Promise<Scan[]>`, `fetchDocsTree(id: number): Promise<DocsNode[]>`, `fetchDocFile(id: number, path: string): Promise<string>`, `fetchConfig(): Promise<{ groups: string[]; schedule: string; gitlabBaseUrl: string }>`
  - `lib/status.ts`: `function statusInfo(project: ProjectWithStatus): { label: string; tone: "ok" | "busy" | "error" | "none" }`
  - Routen: `/` (Übersicht), `/projekte/:id/doku/*` (Task 12), `/verwaltung` (Task 13).

- [ ] **Step 1: Failing Test für die Status-Ableitung schreiben**

`hub/web/src/lib/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { statusInfo } from "./status";
import type { ProjectWithStatus, Scan } from "../api";

function project(overrides: Partial<ProjectWithStatus>): ProjectWithStatus {
  return {
    id: 1,
    gitlabProjectId: 1,
    name: "demo",
    pathWithNamespace: "team/demo",
    cloneUrl: "https://x/team/demo.git",
    webUrl: "https://x/team/demo",
    defaultBranch: "main",
    source: "group",
    enabled: true,
    archived: false,
    lastScan: null,
    lastSuccess: null,
    ...overrides,
  };
}

function scan(status: Scan["status"]): Scan {
  return {
    id: 1,
    projectId: 1,
    status,
    startedAt: null,
    finishedAt: null,
    commitSha: null,
    log: "",
    error: null,
  };
}

describe("statusInfo", () => {
  it("maps scan states to badges", () => {
    expect(statusInfo(project({})).tone).toBe("none");
    expect(statusInfo(project({ lastScan: scan("running") })).tone).toBe(
      "busy",
    );
    expect(statusInfo(project({ lastScan: scan("queued") })).tone).toBe("busy");
    expect(
      statusInfo(
        project({ lastScan: scan("failed"), lastSuccess: scan("success") }),
      ).tone,
    ).toBe("error");
    expect(statusInfo(project({ lastScan: scan("success") })).tone).toBe("ok");
    expect(
      statusInfo(
        project({ lastScan: scan("skipped"), lastSuccess: scan("success") }),
      ).tone,
    ).toBe("ok");
  });

  it("uses German labels", () => {
    expect(statusInfo(project({})).label).toBe("Noch keine Doku");
    expect(statusInfo(project({ lastScan: scan("running") })).label).toBe(
      "Scan läuft",
    );
    expect(statusInfo(project({ lastScan: scan("failed") })).label).toBe(
      "Fehler",
    );
    expect(statusInfo(project({ lastScan: scan("success") })).label).toBe(
      "Doku aktuell",
    );
  });
});
```

- [ ] **Step 2: Scaffold-Dateien anlegen**

`hub/web/package.json`:

```json
{
  "name": "openwiki-hub-web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc --noEmit -p tsconfig.json && vite build",
    "dev": "vite",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "marked": "^18.0.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.1.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.17",
    "@types/react-dom": "^18.3.5",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "^5.7.2",
    "vite": "^6.0.0",
    "vitest": "^4.1.10"
  }
}
```

`hub/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022",
    "useDefineForClassFields": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

`hub/web/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:4600",
    },
  },
});
```

`hub/web/index.html`:

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpenWiki Hub</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: `api.ts` implementieren**

`hub/web/src/api.ts`:

```ts
export type Project = {
  id: number;
  gitlabProjectId: number | null;
  name: string;
  pathWithNamespace: string;
  cloneUrl: string;
  webUrl: string;
  defaultBranch: string;
  source: "group" | "manual";
  enabled: boolean;
  archived: boolean;
};

export type Scan = {
  id: number;
  projectId: number;
  status: "queued" | "running" | "success" | "failed" | "skipped";
  startedAt: string | null;
  finishedAt: string | null;
  commitSha: string | null;
  log: string;
  error: string | null;
};

export type ProjectWithStatus = Project & {
  lastScan: Scan | null;
  lastSuccess: Scan | null;
};

export type DocsNode = {
  name: string;
  path: string;
  children?: DocsNode[];
};

export type HubEvent =
  | {
      type: "scan-status";
      projectId: number;
      scanId: number;
      status: Scan["status"];
    }
  | { type: "scan-log"; projectId: number; scanId: number; line: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };

  if (!response.ok) {
    throw new Error(
      body.error ?? `Anfrage fehlgeschlagen (${response.status})`,
    );
  }

  return body;
}

export async function fetchProjects(): Promise<ProjectWithStatus[]> {
  const body = await request<{ projects: ProjectWithStatus[] }>(
    "/api/projects",
  );
  return body.projects;
}

export async function addProject(url: string): Promise<void> {
  await request("/api/projects", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export async function setProjectEnabled(
  id: number,
  enabled: boolean,
): Promise<void> {
  await request(`/api/projects/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function deleteProject(id: number): Promise<void> {
  await request(`/api/projects/${id}`, { method: "DELETE" });
}

export async function triggerScan(id: number): Promise<void> {
  await request(`/api/projects/${id}/scan`, { method: "POST" });
}

export async function scanAll(): Promise<{ queued: number }> {
  return request("/api/scan-all", { method: "POST" });
}

export async function fetchScans(id: number): Promise<Scan[]> {
  const body = await request<{ scans: Scan[] }>(`/api/projects/${id}/scans`);
  return body.scans;
}

export async function fetchDocsTree(id: number): Promise<DocsNode[]> {
  const body = await request<{ tree: DocsNode[] }>(`/api/projects/${id}/docs`);
  return body.tree;
}

export async function fetchDocFile(id: number, path: string): Promise<string> {
  const body = await request<{ content: string }>(
    `/api/projects/${id}/docs/file?path=${encodeURIComponent(path)}`,
  );
  return body.content;
}

export async function fetchConfig(): Promise<{
  groups: string[];
  schedule: string;
  gitlabBaseUrl: string;
}> {
  return request("/api/config");
}
```

- [ ] **Step 4: `status.ts`, App-Gerüst und Projektübersicht implementieren**

`hub/web/src/lib/status.ts`:

```ts
import type { ProjectWithStatus } from "../api";

export function statusInfo(project: ProjectWithStatus): {
  label: string;
  tone: "ok" | "busy" | "error" | "none";
} {
  const status = project.lastScan?.status;

  if (status === "running" || status === "queued") {
    return { label: "Scan läuft", tone: "busy" };
  }

  if (status === "failed") {
    return { label: "Fehler", tone: "error" };
  }

  if (status === "success" || status === "skipped" || project.lastSuccess) {
    return { label: "Doku aktuell", tone: "ok" };
  }

  return { label: "Noch keine Doku", tone: "none" };
}
```

`hub/web/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
```

`hub/web/src/App.tsx`:

```tsx
import { Link, Route, Routes } from "react-router-dom";
import Admin from "./pages/Admin";
import DocsView from "./pages/DocsView";
import ProjectList from "./pages/ProjectList";

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <Link to="/" className="brand">
          OpenWiki Hub
        </Link>
        <nav>
          <Link to="/">Projekte</Link>
          <Link to="/verwaltung">Verwaltung</Link>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/projekte/:id/doku/*" element={<DocsView />} />
          <Route path="/verwaltung" element={<Admin />} />
        </Routes>
      </main>
    </div>
  );
}
```

`hub/web/src/pages/ProjectList.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchProjects, type ProjectWithStatus } from "../api";
import { statusInfo } from "../lib/status.js";
import { useEvents } from "../useEvents";

export default function ProjectList() {
  const [projects, setProjects] = useState<ProjectWithStatus[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    fetchProjects()
      .then(setProjects)
      .catch((e) => setError(String(e)));
  };

  useEffect(reload, []);
  useEvents((event) => {
    if (event.type === "scan-status") {
      reload();
    }
  });

  const visible = projects.filter(
    (p) =>
      !p.archived &&
      p.pathWithNamespace.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <section>
      <div className="toolbar">
        <h1>Projekte</h1>
        <input
          type="search"
          placeholder="Projekte filtern…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <p className="error-banner">{error}</p>}
      <ul className="project-grid">
        {visible.map((project) => {
          const status = statusInfo(project);
          return (
            <li key={project.id} className="project-card">
              <Link to={`/projekte/${project.id}/doku/quickstart.md`}>
                <strong>{project.name}</strong>
                <span className="muted">{project.pathWithNamespace}</span>
                <span className={`badge badge-${status.tone}`}>
                  {status.label}
                </span>
                {project.lastSuccess?.finishedAt && (
                  <span className="muted">
                    Zuletzt aktualisiert:{" "}
                    {new Date(project.lastSuccess.finishedAt).toLocaleString(
                      "de-DE",
                    )}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
      {visible.length === 0 && !error && (
        <p className="muted">
          Keine Projekte gefunden. Unter „Verwaltung" kannst du Projekte
          hinzufügen oder einen Scan starten.
        </p>
      )}
    </section>
  );
}
```

`hub/web/src/useEvents.ts` (wird in Task 13 auch von der Verwaltung genutzt):

```ts
import { useEffect, useRef } from "react";
import type { HubEvent } from "./api";

export function useEvents(onEvent: (event: HubEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const source = new EventSource("/api/events");
    source.onmessage = (message) => {
      try {
        handler.current(JSON.parse(message.data) as HubEvent);
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
  }, []);
}
```

Platzhalter, damit App.tsx kompiliert (Inhalt folgt in Tasks 12/13):

`hub/web/src/pages/DocsView.tsx`:

```tsx
export default function DocsView() {
  return <p>Doku-Ansicht folgt.</p>;
}
```

`hub/web/src/pages/Admin.tsx`:

```tsx
export default function Admin() {
  return <p>Verwaltung folgt.</p>;
}
```

`hub/web/src/styles.css`:

```css
:root {
  color-scheme: light dark;
  font-family: system-ui, sans-serif;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
}
.app-header {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent);
}
.app-header .brand {
  font-weight: 700;
  text-decoration: none;
  color: inherit;
}
.app-header nav {
  display: flex;
  gap: 1rem;
}
main {
  padding: 1.5rem;
  max-width: 1100px;
  margin: 0 auto;
}
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
}
.toolbar input {
  padding: 0.5rem;
  min-width: 220px;
}
.project-grid {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 1rem;
}
.project-card a {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 1rem;
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
}
.badge {
  align-self: flex-start;
  padding: 0.1rem 0.6rem;
  border-radius: 999px;
  font-size: 0.8rem;
}
.badge-ok {
  background: #16a34a33;
}
.badge-busy {
  background: #f59e0b33;
}
.badge-error {
  background: #dc262633;
}
.badge-none {
  background: #6b728033;
}
.muted {
  opacity: 0.7;
  font-size: 0.85rem;
}
.error-banner {
  background: #dc262622;
  border: 1px solid #dc2626;
  padding: 0.5rem 1rem;
  border-radius: 6px;
}
.docs-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 2rem;
}
.docs-nav ul {
  list-style: none;
  padding-left: 0.9rem;
}
.docs-nav a {
  text-decoration: none;
  color: inherit;
}
.docs-nav a.active {
  font-weight: 700;
}
.doc-content {
  min-width: 0;
  overflow-wrap: anywhere;
}
.doc-content pre {
  overflow-x: auto;
  padding: 0.75rem;
  background: color-mix(in srgb, currentColor 8%, transparent);
  border-radius: 6px;
}
.admin-table {
  width: 100%;
  border-collapse: collapse;
}
.admin-table td,
.admin-table th {
  padding: 0.5rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  text-align: left;
}
.log-view {
  background: #0b0f14;
  color: #d1e3f0;
  padding: 0.75rem;
  border-radius: 6px;
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  font-family: ui-monospace, monospace;
  font-size: 0.8rem;
}
.add-form {
  display: flex;
  gap: 0.5rem;
  margin: 1rem 0;
}
.add-form input {
  flex: 1;
  padding: 0.5rem;
}
button {
  cursor: pointer;
}
```

- [ ] **Step 5: Installieren und Tests/Build prüfen**

```bash
pnpm install
pnpm --filter openwiki-hub-web exec vitest run src/lib/status.test.ts
pnpm --filter openwiki-hub-web build
```

Expected: Test PASS (2 Tests), Build erzeugt `hub/web/dist/` ohne Fehler.

- [ ] **Step 6: Manueller Dev-Smoke**

```bash
pnpm --filter openwiki-hub-web dev
```

Erwartet: Übersichtsseite lädt auf http://localhost:5173; ohne laufenden Server erscheint das Fehler-Banner (Proxy-Fehler) — das ist hier okay.

- [ ] **Step 7: Commit**

```bash
git add hub/web
git commit -m "feat: add hub web app scaffold with project overview"
```

---

### Task 12: Doku-Ansicht & Link-Klassifizierung

**Files:**

- Create: `hub/web/src/lib/links.ts`
- Modify: `hub/web/src/pages/DocsView.tsx` (Platzhalter ersetzen)
- Test: `hub/web/src/lib/links.test.ts`

**Interfaces:**

- Consumes: `fetchProjects`, `fetchDocsTree`, `fetchDocFile`, `DocsNode` (Task 11); Route `/projekte/:id/doku/*` (Task 11); `marked` für Markdown-Rendering.
- Produces:
  - `type DocLinkTarget = { kind: "external" } | { kind: "anchor" } | { kind: "doc"; docPath: string } | { kind: "source"; repoPath: string }`
  - `function classifyDocLink(href: string, currentDocPath: string): DocLinkTarget` — `currentDocPath` ist der Pfad der gerade angezeigten Datei relativ zu `openwiki/` (z. B. `architecture/overview.md`). Regeln: Protokoll-URLs (`http:`, `https:`, `mailto:` …) → `external`; `#…` → `anchor`; relative Pfade werden gegen das Verzeichnis der aktuellen Datei aufgelöst; bleibt der Pfad innerhalb der Doku und endet auf `.md` → `doc`; führt er per `../` aus der Doku heraus → `source` mit Pfad relativ zur Repo-Wurzel; `/…`-Pfade gelten als Repo-Wurzel-Pfade (`/openwiki/x.md` → `doc`, sonst `source`); Nicht-`.md` innerhalb der Doku → `source` mit Präfix `openwiki/`. Query/Anker im Href werden vor der Auflösung abgeschnitten.

- [ ] **Step 1: Failing Test schreiben**

`hub/web/src/lib/links.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyDocLink } from "./links";

describe("classifyDocLink", () => {
  it("passes through external links and anchors", () => {
    expect(classifyDocLink("https://example.com", "quickstart.md")).toEqual({
      kind: "external",
    });
    expect(classifyDocLink("mailto:a@b.c", "quickstart.md")).toEqual({
      kind: "external",
    });
    expect(classifyDocLink("#abschnitt", "quickstart.md")).toEqual({
      kind: "anchor",
    });
  });

  it("resolves markdown links relative to the current file", () => {
    expect(classifyDocLink("./cli/usage.md", "quickstart.md")).toEqual({
      kind: "doc",
      docPath: "cli/usage.md",
    });
    expect(
      classifyDocLink("../operations/updates.md", "architecture/overview.md"),
    ).toEqual({ kind: "doc", docPath: "operations/updates.md" });
    expect(
      classifyDocLink("overview.md#intro", "architecture/details.md"),
    ).toEqual({ kind: "doc", docPath: "architecture/overview.md" });
  });

  it("classifies paths escaping the docs dir as source links", () => {
    expect(classifyDocLink("../src/cli.tsx", "quickstart.md")).toEqual({
      kind: "source",
      repoPath: "src/cli.tsx",
    });
    expect(
      classifyDocLink("../../examples/x.yml", "architecture/overview.md"),
    ).toEqual({ kind: "source", repoPath: "examples/x.yml" });
  });

  it("treats root-absolute hrefs as repository paths", () => {
    expect(classifyDocLink("/src/env.ts", "quickstart.md")).toEqual({
      kind: "source",
      repoPath: "src/env.ts",
    });
    expect(classifyDocLink("/openwiki/agents.md", "quickstart.md")).toEqual({
      kind: "doc",
      docPath: "agents.md",
    });
  });

  it("classifies non-markdown files inside the docs dir as source", () => {
    expect(classifyDocLink("./diagram.png", "quickstart.md")).toEqual({
      kind: "source",
      repoPath: "openwiki/diagram.png",
    });
  });
});
```

- [ ] **Step 2: Test rot laufen lassen**

Run: `pnpm --filter openwiki-hub-web exec vitest run src/lib/links.test.ts`
Expected: FAIL — „Cannot find module './links'"

- [ ] **Step 3: `links.ts` implementieren**

`hub/web/src/lib/links.ts`:

```ts
export type DocLinkTarget =
  | { kind: "external" }
  | { kind: "anchor" }
  | { kind: "doc"; docPath: string }
  | { kind: "source"; repoPath: string };

export function classifyDocLink(
  href: string,
  currentDocPath: string,
): DocLinkTarget {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(href) || href.startsWith("//")) {
    return { kind: "external" };
  }

  if (href.startsWith("#")) {
    return { kind: "anchor" };
  }

  const cleaned = href.split("#")[0]!.split("?")[0]!;

  if (cleaned === "") {
    return { kind: "anchor" };
  }

  if (cleaned.startsWith("/")) {
    const repoPath = cleaned.replace(/^\/+/u, "");
    return repoPath.startsWith("openwiki/") && repoPath.endsWith(".md")
      ? { kind: "doc", docPath: repoPath.slice("openwiki/".length) }
      : { kind: "source", repoPath };
  }

  const baseDir = currentDocPath.includes("/")
    ? currentDocPath.slice(0, currentDocPath.lastIndexOf("/"))
    : "";
  const segments = baseDir === "" ? [] : baseDir.split("/");
  let escapes = 0;

  for (const part of cleaned.split("/")) {
    if (part === "" || part === ".") {
      continue;
    }

    if (part === "..") {
      if (segments.length > 0) {
        segments.pop();
      } else {
        escapes += 1;
      }
    } else {
      segments.push(part);
    }
  }

  const resolved = segments.join("/");

  if (escapes > 0) {
    return { kind: "source", repoPath: resolved };
  }

  return resolved.endsWith(".md")
    ? { kind: "doc", docPath: resolved }
    : { kind: "source", repoPath: `openwiki/${resolved}` };
}
```

- [ ] **Step 4: Test grün laufen lassen**

Run: `pnpm --filter openwiki-hub-web exec vitest run src/lib/links.test.ts`
Expected: PASS (5 Tests)

- [ ] **Step 5: `DocsView.tsx` implementieren**

`hub/web/src/pages/DocsView.tsx` (ersetzt den Platzhalter):

```tsx
import { marked } from "marked";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  fetchDocFile,
  fetchDocsTree,
  fetchProjects,
  type DocsNode,
  type Project,
} from "../api";
import { classifyDocLink } from "../lib/links";

export default function DocsView() {
  const params = useParams();
  const navigate = useNavigate();
  const projectId = Number(params.id);
  const docPath = params["*"] || "quickstart.md";

  const [project, setProject] = useState<Project | null>(null);
  const [tree, setTree] = useState<DocsNode[]>([]);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects()
      .then((projects) =>
        setProject(projects.find((p) => p.id === projectId) ?? null),
      )
      .catch((e) => setError(String(e)));
    fetchDocsTree(projectId)
      .then(setTree)
      .catch((e) => setError(String(e)));
  }, [projectId]);

  useEffect(() => {
    setError(null);
    fetchDocFile(projectId, docPath)
      .then(setContent)
      .catch(() =>
        setError(
          "Diese Seite existiert (noch) nicht. Läuft der erste Scan noch?",
        ),
      );
  }, [projectId, docPath]);

  const html = useMemo(() => marked.parse(content) as string, [content]);

  const onContentClick = (event: MouseEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");

    if (!anchor || !href) {
      return;
    }

    const target = classifyDocLink(href, docPath);

    if (target.kind === "doc") {
      event.preventDefault();
      navigate(`/projekte/${projectId}/doku/${target.docPath}`);
    } else if (target.kind === "source" && project) {
      event.preventDefault();
      window.open(
        `${project.webUrl}/-/blob/${project.defaultBranch}/${target.repoPath}`,
        "_blank",
        "noopener",
      );
    } else if (target.kind === "external") {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener");
    }
  };

  return (
    <section>
      <p className="muted">
        <Link to="/">Projekte</Link> /{" "}
        {project?.pathWithNamespace ?? `#${projectId}`}
      </p>
      <div className="docs-layout">
        <nav className="docs-nav">
          <DocsTree nodes={tree} projectId={projectId} activePath={docPath} />
        </nav>
        <article className="doc-content">
          {error ? (
            <p className="error-banner">{error}</p>
          ) : (
            <div
              onClick={onContentClick}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </article>
      </div>
    </section>
  );
}

function DocsTree(props: {
  nodes: DocsNode[];
  projectId: number;
  activePath: string;
}) {
  return (
    <ul>
      {props.nodes.map((node) =>
        node.children ? (
          <li key={node.path}>
            <strong>{node.name}</strong>
            <DocsTree
              nodes={node.children}
              projectId={props.projectId}
              activePath={props.activePath}
            />
          </li>
        ) : (
          <li key={node.path}>
            <Link
              className={node.path === props.activePath ? "active" : ""}
              to={`/projekte/${props.projectId}/doku/${node.path}`}
            >
              {node.name.replace(/\.md$/u, "")}
            </Link>
          </li>
        ),
      )}
    </ul>
  );
}
```

Hinweis Sicherheit: `dangerouslySetInnerHTML` ist hier akzeptiert — die Inhalte stammen aus den eigenen, vom Hub generierten Markdown-Dateien im internen Netz (siehe Spec: kein Login, reines Lese-Portal).

- [ ] **Step 6: Typecheck + Build**

```bash
pnpm --filter openwiki-hub-web typecheck
pnpm --filter openwiki-hub-web build
```

Expected: keine Fehler.

- [ ] **Step 7: Commit**

```bash
git add hub/web/src/lib/links.ts hub/web/src/lib/links.test.ts hub/web/src/pages/DocsView.tsx
git commit -m "feat: add docs viewer with wiki-style link navigation"
```

---

### Task 13: Verwaltungsseite mit Live-Logs

**Files:**

- Modify: `hub/web/src/pages/Admin.tsx` (Platzhalter ersetzen)

**Interfaces:**

- Consumes: `fetchProjects`, `fetchConfig`, `fetchScans`, `addProject`, `setProjectEnabled`, `deleteProject`, `triggerScan`, `scanAll`, Typen `ProjectWithStatus`, `Scan` (Task 11); `useEvents` (Task 11); `statusInfo` (Task 11).
- Produces: Verwaltungsseite unter `/verwaltung` mit: Projekt-per-URL-Formular, Aktivieren/Deaktivieren, Löschen (nur manuelle), „Jetzt scannen" (einzeln + alle), aufklappbarer Scan-Historie mit Logs, Live-Log laufender Scans (SSE), Anzeige der Discovery-Konfiguration. Fehler von API-Aufrufen erscheinen als Banner (deckt „GitLab-API-/Token-Fehler → Warnbanner" aus dem Spec ab).

- [ ] **Step 1: Implementieren**

`hub/web/src/pages/Admin.tsx` (ersetzt den Platzhalter):

```tsx
import { useEffect, useState, type FormEvent } from "react";
import {
  addProject,
  deleteProject,
  fetchConfig,
  fetchProjects,
  fetchScans,
  scanAll,
  setProjectEnabled,
  triggerScan,
  type ProjectWithStatus,
  type Scan,
} from "../api";
import { statusInfo } from "../lib/status.js";
import { useEvents } from "../useEvents";

export default function Admin() {
  const [projects, setProjects] = useState<ProjectWithStatus[]>([]);
  const [config, setConfig] = useState<{
    groups: string[];
    schedule: string;
    gitlabBaseUrl: string;
  } | null>(null);
  const [url, setUrl] = useState("");
  const [banner, setBanner] = useState<string | null>(null);
  const [openProjectId, setOpenProjectId] = useState<number | null>(null);
  const [scans, setScans] = useState<Scan[]>([]);
  const [liveLog, setLiveLog] = useState("");

  const reload = () => {
    fetchProjects()
      .then(setProjects)
      .catch((e) => setBanner(String(e)));
  };

  useEffect(() => {
    reload();
    fetchConfig()
      .then(setConfig)
      .catch((e) => setBanner(String(e)));
  }, []);

  useEvents((event) => {
    if (event.type === "scan-status") {
      reload();
      if (event.projectId === openProjectId) {
        loadScans(event.projectId);
      }
      if (event.status === "running") {
        setLiveLog("");
      }
    }
    if (event.type === "scan-log" && event.projectId === openProjectId) {
      setLiveLog((log) => log + event.line);
    }
  });

  const loadScans = (projectId: number) => {
    fetchScans(projectId)
      .then(setScans)
      .catch((e) => setBanner(String(e)));
  };

  const run = (action: () => Promise<unknown>) => {
    setBanner(null);
    action()
      .then(reload)
      .catch((e) => setBanner(String(e)));
  };

  const onAdd = (event: FormEvent) => {
    event.preventDefault();
    run(async () => {
      await addProject(url);
      setUrl("");
    });
  };

  const toggleHistory = (projectId: number) => {
    if (openProjectId === projectId) {
      setOpenProjectId(null);
      return;
    }
    setOpenProjectId(projectId);
    setLiveLog("");
    loadScans(projectId);
  };

  return (
    <section>
      <h1>Verwaltung</h1>
      {banner && <p className="error-banner">{banner}</p>}

      {config && (
        <p className="muted">
          GitLab: {config.gitlabBaseUrl} · Gruppen:{" "}
          {config.groups.length > 0 ? config.groups.join(", ") : "keine"} ·
          Zeitplan: {config.schedule}
        </p>
      )}

      <form className="add-form" onSubmit={onAdd}>
        <input
          type="url"
          required
          placeholder="https://gitlab.example.com/gruppe/projekt"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button type="submit">Projekt hinzufügen</button>
        <button type="button" onClick={() => run(scanAll)}>
          Alle scannen
        </button>
      </form>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Projekt</th>
            <th>Quelle</th>
            <th>Status</th>
            <th>Aktionen</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              open={openProjectId === project.id}
              scans={scans}
              liveLog={liveLog}
              onToggleHistory={() => toggleHistory(project.id)}
              onScan={() => run(() => triggerScan(project.id))}
              onToggleEnabled={() =>
                run(() => setProjectEnabled(project.id, !project.enabled))
              }
              onDelete={() =>
                window.confirm(
                  `Projekt "${project.name}" wirklich entfernen?`,
                ) && run(() => deleteProject(project.id))
              }
            />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ProjectRow(props: {
  project: ProjectWithStatus;
  open: boolean;
  scans: Scan[];
  liveLog: string;
  onToggleHistory: () => void;
  onScan: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}) {
  const { project } = props;
  const status = statusInfo(project);

  return (
    <>
      <tr>
        <td>
          {project.pathWithNamespace}
          {project.archived && <span className="muted"> (archiviert)</span>}
        </td>
        <td>{project.source === "group" ? "Gruppe" : "manuell"}</td>
        <td>
          <span className={`badge badge-${status.tone}`}>{status.label}</span>
          {project.lastScan?.error && (
            <div className="muted">{project.lastScan.error}</div>
          )}
        </td>
        <td>
          <button onClick={props.onScan}>Jetzt scannen</button>{" "}
          <button onClick={props.onToggleEnabled}>
            {project.enabled ? "Deaktivieren" : "Aktivieren"}
          </button>{" "}
          <button onClick={props.onToggleHistory}>
            {props.open ? "Historie zu" : "Historie"}
          </button>{" "}
          {project.source === "manual" && (
            <button onClick={props.onDelete}>Entfernen</button>
          )}
        </td>
      </tr>
      {props.open && (
        <tr>
          <td colSpan={4}>
            {props.liveLog && (
              <>
                <strong>Live-Log</strong>
                <pre className="log-view">{props.liveLog}</pre>
              </>
            )}
            <ScanHistory scans={props.scans} />
          </td>
        </tr>
      )}
    </>
  );
}

function ScanHistory(props: { scans: Scan[] }) {
  const [openScanId, setOpenScanId] = useState<number | null>(null);

  if (props.scans.length === 0) {
    return <p className="muted">Noch keine Scans.</p>;
  }

  return (
    <ul>
      {props.scans.map((scan) => (
        <li key={scan.id}>
          <button
            onClick={() =>
              setOpenScanId(openScanId === scan.id ? null : scan.id)
            }
          >
            #{scan.id} · {scan.status}
            {scan.finishedAt &&
              ` · ${new Date(scan.finishedAt).toLocaleString("de-DE")}`}
          </button>
          {scan.error && <span className="muted"> {scan.error}</span>}
          {openScanId === scan.id && scan.log && (
            <pre className="log-view">{scan.log}</pre>
          )}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Typecheck + Build + bestehende Web-Tests**

```bash
pnpm --filter openwiki-hub-web typecheck
pnpm --filter openwiki-hub-web test
pnpm --filter openwiki-hub-web build
```

Expected: keine Fehler; Tests aus Tasks 11/12 weiterhin PASS.

- [ ] **Step 3: Commit**

```bash
git add hub/web/src/pages/Admin.tsx
git commit -m "feat: add admin page with scan controls and live logs"
```

---

### Task 14: Produktiv-Auslieferung, CI & Doku

**Files:**

- Modify: `hub/server/src/index.ts` (SPA-Auslieferung ergänzen)
- Modify: `package.json` (Root — nur `hub:*`-Scripts ergänzen)
- Modify: `.github/workflows/checks.yml` (Hub-Job ergänzen)
- Create: `hub/README.md`, `hub/server/.env.example`

**Interfaces:**

- Consumes: `createApp` (Task 10), gebautes `hub/web/dist` (Tasks 11–13).
- Produces: Ein Prozess, ein Port — `node hub/server/dist/index.js` liefert API **und** SPA aus. Root-Scripts: `pnpm hub:build`, `pnpm hub:start`, `pnpm hub:dev:server`, `pnpm hub:dev:web`.

- [ ] **Step 1: SPA-Auslieferung in `index.ts` ergänzen**

In `hub/server/src/index.ts` die Imports erweitern:

```ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
```

und in `main()` direkt **vor** `app.listen(...)` einfügen:

```ts
// In production the built SPA sits at hub/web/dist (relative to this file:
// src/ during dev via tsx, dist/ after tsc — both are one level below hub/server/).
const webDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "web",
  "dist",
);

if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler(async (request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      return reply.code(404).send({ error: "Nicht gefunden." });
    }

    // SPA fallback: client-side routes like /projekte/1/doku/… load index.html.
    return reply
      .type("text/html")
      .send(await readFile(path.join(webDist, "index.html"), "utf8"));
  });
}
```

- [ ] **Step 2: Root-Scripts ergänzen**

Im Root-`package.json` unter `scripts` ergänzen (bestehende Scripts unangetastet):

```json
"hub:build": "pnpm run build && pnpm --filter openwiki-hub-web build && pnpm --filter openwiki-hub-server build",
"hub:dev:server": "pnpm --filter openwiki-hub-server dev",
"hub:dev:web": "pnpm --filter openwiki-hub-web dev",
"hub:start": "pnpm --filter openwiki-hub-server start",
```

- [ ] **Step 3: `.env.example` und Hub-README schreiben**

`hub/server/.env.example`:

```bash
# GitLab (Pflicht)
GITLAB_BASE_URL=https://gitlab.example.com
GITLAB_TOKEN=glpat-...

# Discovery & Zeitplan (optional)
OPENWIKI_HUB_GROUPS=meine-gruppe,andere-gruppe/untergruppe
OPENWIKI_HUB_SCHEDULE=0 3 * * *
OPENWIKI_HUB_DATA_DIR=./data
OPENWIKI_HUB_CONCURRENCY=1
OPENWIKI_HUB_PORT=4600

# LLM-Provider: entweder hier setzen oder ~/.openwiki/.env pflegen
# OPENWIKI_PROVIDER=anthropic
# ANTHROPIC_API_KEY=...
```

`hub/README.md`:

````markdown
# OpenWiki Hub

Web-Portal, das GitLab-Projekte automatisch klont, per OpenWiki-Agent
dokumentiert und die Dokus im Browser anzeigt.

## Entwicklung

```sh
pnpm install
pnpm run build                 # baut das openwiki-Kernpaket (dist/)
pnpm hub:dev:server            # Fastify-API auf Port 4600
pnpm hub:dev:web               # Vite-Dev-Server auf Port 5173 (Proxy auf 4600)
```
````

Konfiguration über Umgebungsvariablen oder eine `.env` — siehe
`hub/server/.env.example`. Der GitLab-Token braucht `read_api` und
Clone-Rechte auf die zu scannenden Projekte.

## Produktion

```sh
pnpm hub:build                 # Kern + SPA + Server bauen
GITLAB_BASE_URL=... GITLAB_TOKEN=... pnpm hub:start
```

Der Server liefert API und Oberfläche auf einem Port aus (Default 4600) und
ist für den Betrieb im internen Netz ohne Login gedacht. Scans laufen
automatisch nach Zeitplan (`OPENWIKI_HUB_SCHEDULE`, Cron-Syntax) oder manuell
über die Verwaltungsseite. Daten (SQLite + Klone) liegen unter
`OPENWIKI_HUB_DATA_DIR`.

````

- [ ] **Step 4: CI-Job ergänzen**

In `.github/workflows/checks.yml` als weiteren Job auf oberster Ebene unter `jobs:` anhängen (Stil der bestehenden Jobs übernehmen):

```yaml
  hub:
    name: Hub
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up pnpm
        uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
        with:
          run_install: false

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build openwiki core
        run: pnpm run build

      - name: Typecheck hub server
        run: pnpm --filter openwiki-hub-server typecheck

      - name: Test hub server
        run: pnpm --filter openwiki-hub-server test

      - name: Typecheck hub web
        run: pnpm --filter openwiki-hub-web typecheck

      - name: Test hub web
        run: pnpm --filter openwiki-hub-web test

      - name: Build hub web
        run: pnpm --filter openwiki-hub-web build
````

- [ ] **Step 5: Kompletter Build + alle Tests**

```bash
pnpm hub:build
pnpm test
pnpm --filter openwiki-hub-server test
pnpm --filter openwiki-hub-web test
```

Expected: Build ohne Fehler; alle drei Test-Suites PASS.

- [ ] **Step 6: Manueller End-to-End-Smoke-Test**

Voraussetzungen: erreichbare GitLab-Instanz, Token, konfigurierter LLM-Provider (`~/.openwiki/.env`).

```bash
GITLAB_BASE_URL=https://gitlab.example.com \
GITLAB_TOKEN=glpat-... \
OPENWIKI_HUB_GROUPS=meine-gruppe \
pnpm hub:start
```

Prüfen (im Browser auf http://localhost:4600):

1. Übersicht lädt; nach „Alle scannen" (Verwaltung) erscheinen die Gruppen-Projekte.
2. Ein Scan durchläuft `queued → running → success`; Live-Log auf der Verwaltungsseite füllt sich.
3. Nach Abschluss: Klick auf ein Projekt öffnet die Doku, Sidebar-Navigation und Markdown-Links funktionieren, `src/…`-Links öffnen GitLab.
4. Zweiter Scan desselben Projekts ohne neue Commits endet als `skipped`.
5. Manuelles Projekt per URL hinzufügen, scannen, wieder entfernen.

- [ ] **Step 7: Commit**

```bash
git add hub/server/src/index.ts package.json .github/workflows/checks.yml hub/README.md hub/server/.env.example
git commit -m "feat: serve hub spa from server, add ci job and docs"
```

---

## Plan-Selbstprüfung (bereits eingearbeitet)

- **Spec-Abdeckung:** Monorepo-Struktur + Exports (Task 1); Konfiguration (Task 2); Datenmodell inkl. 20er-Retention und `skipped` (Task 3); Discovery mit Archivierung (Tasks 4–5); Git-Sync ohne `git clean`, Token-Redaction (Task 6); SSE-Events (Tasks 7, 10); Scan-Ablauf mit Skip-Check, init/update-Wahl, Warteschlange mit Concurrency, Fehler-Redaction (Task 8); Path-Traversal-Schutz (Task 9); komplette REST-API, `markRunningScansInterrupted` beim Start, Provider-Startup-Check, Cron (Task 10); Projektübersicht mit Badges + Suche (Task 11); Doku-Ansicht mit Link-Umschreibung und GitLab-Quelllinks (Task 12); Verwaltung mit Live-Log und Warnbanner (Task 13); Ein-Prozess-Deployment, CI, Betriebs-Doku (Task 14).
- **Bewusste Abweichung:** Der Spec nennt `POST /api/scan-all` mit Discovery — umgesetzt; „Anzeige der Discovery-Konfiguration" läuft über `GET /api/config`.
- **Nicht im Umfang** (wie Spec): kein Login, kein Push-back, keine Volltextsuche, eine GitLab-Instanz, Linux-Container als Deployment-Ziel.
