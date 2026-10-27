# OpenWiki-Fork – Roadmap und Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Fork wieder auf den Upstream-Stand bringen, die Hub-Spec an Upstream und an die SDLC-Landschaft anpassen und danach die Schnittstellen zu Prüfstand, ACTOR und SpecLab liefern.

**Architecture:** Phase 1 setzt die vier Doku-Commits des Forks auf `origin/main` (v0.7.2) auf. Phase 2 überarbeitet die Hub-Spec: Der Hub erzeugt keine Doku mehr, sondern sammelt die per CI erzeugten `openwiki/`-Ordner ein, zeigt sie an und stellt sie über MCP bereit. Die Phasen 3 bis 5 bauen darauf auf und werden erst nach der Spec-Freigabe zu ausführbaren Plänen.

**Tech Stack:** TypeScript (strict, ESM), Node ≥ 22.22, pnpm, Vitest, Ink, DeepAgents. Für den Hub geplant: Fastify, React und Vite, SQLite.

**Spec:** `docs/superpowers/specs/2026-07-08-openwiki-hub-design.md`. Sie ist veraltet und wird in Phase 2 ersetzt. Weitere Quellen: `C:\Develop\SDLC\Projektuebersicht.docx` (Kap. 4, 8, 9) und `TODO.md`.

## Global Constraints

- Ein PR enthält genau eine Änderung, mit einem Titel nach Conventional Commits (`CONTRIBUTING.md`).
- Kein Push und kein Force-Push auf `main`, solange der Nutzer nicht zustimmt. Gearbeitet wird auf Branches.
- `openwiki/` nicht von Hand bearbeiten; es wird von CI erzeugt.
- `src/` und `package.json` nur ändern, wenn es nötig ist, damit der Fork mit Upstream mergebar bleibt.
- Secrets nie loggen. Was ein Nutzer sieht, läuft durch die Sanitizing-Funktion aus Upstream (Nachfolger von `src/diagnostics.ts`, wird in Task 1.3 bestimmt).
- Node-Version laut Upstream `engines`: `>=22.22.0`. CI testet mit Node 22 und 24.

---

## Bestandsaufnahme (Stand 2026-10-27)

### Fork

| Thema             | Befund                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upstream-Abstand  | 415 Commits hinter `origin/main`, 4 voraus (nur Doku). CLAUDE.md nennt 337, die Zahl ist schon veraltet.                                                                                    |
| Code              | `src/` unverändert gegenüber Upstream-Stand Juli 2026. Upstream hat `src/` seitdem komplett umgebaut (`cli/`, `generation/`, `retrieval/`, `claims/`, `visualize/`, `integrations/mcp/` …). |
| Doku für Agenten  | CLAUDE.md, `docs/source-map.md` und 6 Skills verweisen auf Pfade, die es upstream nicht mehr gibt (`src/agent/index.ts`, `src/cli.tsx`, `src/constants.ts`, `dist/cli.js`).                 |
| Hub               | Nur Spec und Plan, kein Code.                                                                                                                                                               |
| Lokales Wiki      | `.last-update.json` vom 2026-06-30, veraltet.                                                                                                                                               |
| Offene Änderungen | `CLAUDE.md` (Abschnitt „Fork status“) und `TODO.md` sind nicht committet.                                                                                                                   |

### Upstream v0.7.2 – was es schon gibt

- Code-Wikis über Page-Jobs, die nach Abbruch fortgesetzt werden, mit parallelen Page-Workern. Dazu „Grounded Claims“ mit versionierter Quellen-Evidenz. Ein Update ohne Änderungen ruft kein Modell auf.
- **Retrieval über MCP:** `openwiki_search`, `openwiki_read`, `openwiki_list_workspaces`, `openwiki_list_wikis`. Lokal, nur lesend, ohne Modellaufrufe.
- **Workspaces:** `openwiki link` fasst mehrere Repo-Wikis zu einem durchsuchbaren Workspace zusammen.
- **Visualizer:** `openwiki visualize` zeigt einen Graphen mit Markdown-Reader daneben, nur auf Loopback. `--export` erzeugt eine statische Seite.
- CI-Beispiele für GitHub, GitLab und Bitbucket. Dazu Integrationen für Coding-Agents (Claude Code, Codex, Cursor …), das Ausgabeformat OKF v0.2, Connectors und Evals (`evals/`).
- 205 Testdateien. Lokaler Lauf unter Windows (Node 24.22, ohne vorherigen `build`) am 2026-10-27: **3388 bestanden, 44 fehlgeschlagen** in 22 Dateien. Die Fehler sehen nach Windows bzw. Umgebung aus: Dateimodus `438` statt `448`/`384` (chmod), `\r\n` statt `\n`, `EBUSY` beim Löschen von SQLite-Dateien, fehlendes `dist/` für die Pi-Tests, Timeouts. Ein echter Fehler zeigt sich bisher nur möglicherweise in `page-manifest`/`repository-run`. Die Analyse folgt in Task 1.4.

### Bewertung

**Frontend.**

- Das Ink-TUI ist ausgereift.
- Der Visualizer hat Lücken:
  - Er zeigt nur ein Wiki, mehrere Projekte gehen nicht.
  - Es gibt kein Suchfeld. In `client.ts` ist `filterQ` als „reserved for a future search box“ fest auf `""` gesetzt.
  - Die Oberfläche ist nur auf Englisch.
  - Er **braucht Internet**: force-graph, marked, DOMPurify und Mermaid kommen von jsDelivr. In einem internen Netz ohne CDN-Zugriff bleibt er leer.
- Die Web-App des Hubs existiert nicht. Die drei geplanten Seiten (Übersicht, Doku, Verwaltung) sind verständlich geschnitten. Es fehlen:
  - Suche
  - Aktualitätsanzeige: wie viele Commits das Wiki hinter HEAD liegt und ob Claims veraltet sind
  - zitierbare Referenzen `pfad@sha`
  - Leer- und Fehlerzustände mit Handlungsanweisung („Projekt hat noch kein Wiki → so richtest du CI ein“)

**Backend.**

- Die Hub-Spec baut Funktionen nach, die Upstream schon hat: Skip-Check (Upstream erkennt Updates ohne Änderungen selbst), Doku-Ansicht (Visualizer) und Suche („nicht im Umfang“, obwohl `retrieval/wiki.ts` sie liefert).
- Sie importiert die Agent-Runtime als Library, aber `package.json` hat upstream kein `exports`-Feld. Jeder Upstream-Umbau würde den Hub brechen.
- Sie widerspricht der SDLC-Landschaft. Die Projektübersicht verlangt `openwiki/` **im Repo**: Die CI pflegt es per MR, SpecLab referenziert `openwiki/payment.md@a3f9c2`, Agents lesen es über AGENTS.md/CLAUDE.md. Die Hub-Spec dagegen lässt die Doku „lokal beim Hub, nicht zurückgepusht“. Solche Referenzen würden im Repo dann nicht aufgelöst.
- Kein Login, obwohl der Hub einen GitLab-Token hält und LLM-Kosten per Knopfdruck auslöst. Es fehlen außerdem CSRF-Schutz, Kostenlimits und ein Webhook-Trigger (nur Cron ist vorgesehen).

**Workflow.**

- Zwei Wege konkurrieren: CI pro Repo (Upstream-Beispiel, Landschaft) und zentraler Hub-Scan (Spec). Das muss in eine Entscheidung münden.
- Das GitLab-CI-Beispiel läuft nur bei `schedule`/`web`. Die Landschaft will ein Update „nach jedem Merge“. Das Beispiel nimmt fälschlich `.github/workflows/openwiki-update.yml` mit in `git add`. Zum Merge-Trigger gehört ein Schutz vor Endlosschleifen (Merge des Doku-MR → neuer Lauf).
- Upstream-Änderungen kommen bisher nicht regelmäßig in den Fork.

**Tests.**

- Der Fork hat 8 Testdateien, Upstream 205. Nach dem Rebase gilt die Upstream-Suite.
- Im Hub-Testkonzept fehlen:
  - API-Integrationstests (`fastify.inject`)
  - Tests für SSE, die Recovery nach einem Neustart, die Aufbewahrung, die GitLab-Pagination und Token-Fehler
  - ein E2E-Test fürs Frontend
- Contract-Tests für die Schnittstellen zu Prüfstand, ACTOR und SpecLab fehlen überall.

**Fehlende Use Cases.**

1. Prüfstand bekommt den Wiki-Kontext genau **zum Basis-Commit des MR** (TODO-Punkt 1).
2. ACTOR und Flightdeck durchsuchen alle Wikis eines Services über einen **zentralen** MCP-Endpunkt, ohne lokale Klone (TODO-Punkt 2).
3. SpecLab löst `openwiki/<seite>.md#anker@sha` auf und erfährt, wenn sich die Seite seit `sha` geändert hat.
4. Ein Repo mit einem Klick anbinden: MR mit CI-Job und erstem `--init`.
5. Übersicht über veraltete Wikis aller Projekte (Commits hinter HEAD, veraltete Claims, fehlgeschlagene CI-Läufe).
6. LLM-Kosten pro Lauf und Projekt.

---

## Phase 1 – Fork auf Upstream bringen (ausführbar)

### Task 1.1: Offene Änderungen sichern und Upgrade-Branch anlegen

**Files:**

- Commit: `CLAUDE.md`, `TODO.md` (auf `main`, lokal)

- [ ] **Step 1:** `git add CLAUDE.md TODO.md && git commit -m "docs: record fork status and SDLC open items"`
- [ ] **Step 2:** `git branch backup/pre-upstream-2026-10-27` (Sicherung des alten Stands)
- [ ] **Step 3:** `git fetch origin && git switch -c chore/upstream-v0.7.2 origin/main`
- [ ] **Step 4:** Prüfen: `git log --oneline -1` zeigt `305599f` oder neuer.

### Task 1.2: Fork-Commits auf Upstream übertragen

**Files:**

- Übernehmen: `docs/superpowers/specs/*`, `docs/superpowers/plans/*`, `.claude/skills/*`, `TODO.md`
- Konflikt: `CLAUDE.md` (upstream: 7 Zeilen, nur `@AGENTS.md`-Import zwischen `<!-- OPENWIKI:START/END -->`)
- Verwerfen: `docs/source-map.md`. Upstream erzeugt `openwiki/` samt Source-Map selbst, eine Kopie von Hand veraltet nur.

- [ ] **Step 1:** `git cherry-pick ccb379b fef9c11 86220d4 8d581ba <commit aus 1.1>`
- [ ] **Step 2:** Bei `CLAUDE.md` den Upstream-Block `<!-- OPENWIKI:START -->…<!-- OPENWIKI:END -->` unverändert lassen. Die Fork-Abschnitte (Commands, Conventions, Skills, Hub, Fork-Status) **nach** `OPENWIKI:END` anhängen. So kann die Automatik den Block weiter ersetzen, ohne Fork-Inhalt zu löschen.
- [ ] **Step 3:** `git rm docs/source-map.md`. Verweise darauf in CLAUDE.md und den Skills durch `openwiki/quickstart.md` bzw. `openwiki/index.md` ersetzen.
- [ ] **Step 4:** Prüfen: `git diff origin/main --stat` zeigt nur Dateien unter `docs/superpowers/`, `.claude/skills/`, `CLAUDE.md` und `TODO.md`.

### Task 1.3: CLAUDE.md und Skills auf die Upstream-Struktur umschreiben

**Files:**

- Modify: `CLAUDE.md` (nach `OPENWIKI:END`)
- Modify: `.claude/skills/{openwiki-dev-loop,add-model-provider,change-agent-prompt,write-tests,maintain-wiki,hub-implementation}/SKILL.md`

Fest vorgegebene Werte:

- Node `>=22.22.0`, CI auf Node 22 und 24
- Binary `dist/cli/cli.js`
- Smoke-Test `node dist/cli/cli.js code --dry-run --init`
- Befehl `openwiki code --update`

- [ ] **Step 1:** Für jeden Pfad, der in CLAUDE.md und den Skills genannt wird, prüfen, ob es ihn gibt: `grep -ohE '\`(src|test|dist)/[^\`]+\`' CLAUDE.md .claude/skills/*/SKILL.md | sort -u`, danach je Pfad `test -e`. Erwartet: Jeder nicht vorhandene Pfad steht auf einer Liste.
- [ ] **Step 2:** Jeden nicht vorhandenen Pfad durch sein Upstream-Gegenstück ersetzen. Gesucht wird mit `git grep` nach dem Symbol, z. B. `PROVIDER_CONFIGS`, `sanitizeDiagnosticText`, `parseCommand`, `buildSystemPrompt`. Gibt es kein Gegenstück, wird die Aussage gestrichen.
- [ ] **Step 3:** Skill `hub-implementation`: einen Hinweis „Spec in Überarbeitung (Phase 2), nicht umsetzen“ einfügen. Für `add-model-provider` die aktuelle Provider-Liste aus dem Upstream-README übernehmen.
- [ ] **Step 4:** Abschnitt „Fork status“ aktualisieren: Stand = v0.7.2 ohne Abstand. Dazu eine Upstream-Sync-Routine eintragen (Task 1.5).
- [ ] **Step 5:** Step 1 wiederholen. Erwartet: keine fehlenden Pfade mehr.
- [ ] **Step 6:** `pnpm exec prettier --check --end-of-line auto .` ist grün.
- [ ] **Step 7:** Commit `docs: align agent onboarding with upstream v0.7.2 layout`

### Task 1.4: Upstream-Suite unter Windows grün oder Ausnahmen begründen

**Files:**

- Create: `docs/superpowers/notes/2026-10-27-windows-test-baseline.md`

- [ ] **Step 1:** `pnpm install --frozen-lockfile && pnpm run typecheck && pnpm run build && pnpm test`
- [ ] **Step 2:** Jeden fehlschlagenden Test einordnen: (a) nur Windows (Pfadtrenner, CRLF, Exec-Bit, Symlinks), (b) Umgebung (Netz, git-Konfiguration), (c) echter Fehler. Das Ergebnis kommt mit Testname und Ursache in die Notiz.
- [ ] **Step 3:** Fälle aus (c) als Upstream-Issue-Entwurf in der Notiz festhalten. Nichts in `src/` patchen, es sei denn, der Nutzer gibt es frei.
- [ ] **Step 4:** Commit `docs: record windows test baseline for upstream v0.7.2`

### Task 1.5: Upstream-Sync als Routine

**Files:**

- Create: `.github/workflows/upstream-drift.yml`

- [ ] **Step 1:** Einen Workflow anlegen, der wöchentlich (`cron: "0 6 * * 1"`) `git rev-list --count HEAD..upstream/main` ausführt. Ab `> 30` öffnet oder aktualisiert er ein Issue „Upstream drift: N commits“. Actions werden per SHA gepinnt, wie upstream (#498).
- [ ] **Step 2:** Lokal mit `act` oder per `workflow_dispatch` prüfen. Erwartet: Bei Abstand 0 wird kein Issue angelegt.
- [ ] **Step 3:** Commit `ci: report upstream drift weekly`

### Task 1.6: Branch in `main` übernehmen (Nutzerentscheidung)

- [ ] **Step 1:** Dem Nutzer `git log --oneline origin/main..chore/upstream-v0.7.2` und `git diff origin/main --stat` zeigen.
- [ ] **Step 2:** Erst nach ausdrücklicher Freigabe: `main` auf den Branch setzen (`git switch main && git reset --hard chore/upstream-v0.7.2`, dann `git push --force-with-lease` in den eigenen Fork-Remote). Die Sicherung aus 1.1 bleibt erhalten.

---

## Phase 2 – Hub-Spec v2 (Entscheidungen, danach neuer Plan)

Ergebnis ist `docs/superpowers/specs/2026-11-XX-openwiki-hub-v2-design.md` mit dem Skill `superpowers:brainstorming`. Danach wird der alte Hub-Plan durch einen neuen ersetzt.

Empfehlungen zu den offenen Entscheidungen:

| #   | Frage                   | Empfehlung                                                                                                                                                                             | Grund                                                                                                                                                                          |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | Wer erzeugt die Doku?   | **Die CI pro Repo** (Upstream-Beispiel, verbessert). Der Hub ruft **kein** LLM auf.                                                                                                    | Entspricht der Landschaft (`openwiki/` im Repo, `pfad@sha`). Kosten bleiben beim Projekt. Der Hub bleibt klein und braucht keine Agent-Runtime als Library und kein `exports`. |
| E2  | Was macht der Hub dann? | Er findet die Projekte, holt `openwiki/` vom Default-Branch (GitLab Repository Files/Archive API, flacher Fetch), indexiert, zeigt an, durchsucht und stellt **MCP über HTTP** bereit. | Deckt TODO 1 und 2 sowie die Use Cases 2, 3 und 5 ab. Upstream-`retrieval` wird wiederverwendet.                                                                               |
| E3  | Frontend                | Eigene React-SPA für Übersicht, Aktualität und Verwaltung. Die Doku-Ansicht nutzt den Visualizer-Export pro Projekt, mit lokal gebündelten Assets statt CDN.                           | Graph und Reader nicht neu bauen. Läuft offline im internen Netz.                                                                                                              |
| E4  | Zugriff                 | GitLab-OAuth (OIDC) oder ein Reverse Proxy mit SSO, dazu CSRF-Schutz für POST.                                                                                                         | Internes Netz allein schützt den GitLab-Token und die Verwaltungsfunktionen nicht.                                                                                             |
| E5  | Trigger                 | GitLab-Webhook (Push auf den Default-Branch, Pipeline-Ereignis) plus nächtlicher Abgleich.                                                                                             | Aktualität statt Cron-Verzug.                                                                                                                                                  |

## Phase 3 – Hub-MVP (nach Spec v2, Umriss)

Komponenten und ihre Abnahme:

- **Discovery:** Gruppen-API mit Pagination und Untergruppen. Neu → `enabled`, verschwunden → `archived`, manuell angelegte bleiben unberührt. _Tests:_ Pagination über 3 Seiten; Token 401 → Banner-Status.
- **Wiki-Sync:** holt `openwiki/` und `.last-update.json` beim HEAD-SHA. _Tests:_ Projekt ohne Wiki → Status `no-wiki` mit Anleitung; Abstand `gitHead` zu HEAD = n Commits.
- **Index und Retrieval:** Upstream-`retrieval/wiki.ts` je Projekt, Workspaces je GitLab-Gruppe. _Tests:_ Suche über 2 Projekte liefert die Wiki-ID.
- **MCP-HTTP-Endpunkt:** die vier Upstream-Tools plus `openwiki_read_at` mit Parameter `sha`. _Tests:_ Contract-Test gegen das Upstream-MCP-Schema.
- **API und SSE:** `fastify.inject`-Tests für alle Routen. Path-Traversal-Test für `../`, `%2e%2e`, absolute Pfade und Backslash.
- **Web:** Übersicht mit Aktualitätsspalte, Suche, Leerzustände. _Tests:_ ein Playwright-Smoke-Test (Übersicht → Projekt → Seite → Suche).
- **Betrieb:** Container, Healthcheck, Aufbewahrung, Recovery nach Neustart. Secrets laufen durch die Upstream-Sanitizing-Funktion.

## Phase 4 – SDLC-Schnittstellen (TODO.md)

- **Prüfstand (TODO 1):** `GET /api/projects/:id/context?sha=<mr-base>` liefert das Wiki zu genau diesem Commit (Tarball oder JSON) und gibt den Ref im Antwort-Header zurück. _Contract-Test:_ gleicher SHA → gleicher Inhalt und gleicher Hash.
- **ACTOR (TODO 2):** MCP-Endpunkt aus Phase 3, Konfiguration über company-mcp. Mit ACTOR wird abgestimmt, welche Tools ACTOR aufruft, wie viele Treffer es höchstens bekommt und ob es Workspaces nutzt.
- **SpecLab:** Ref-Resolver `openwiki/<seite>.md#anker@sha` → Inhalt plus `changedSince: boolean` (Vergleich mit HEAD und Claims). Das Ref-Format wird im Skill `factory-conventions` (KANON) festgehalten.

## Phase 5 – Verbesserungen an Upstream-Funktionen (je ein eigener PR, möglichst upstream)

- GitLab-CI-Beispiel: Trigger nach dem Merge auf den Default-Branch mit Schleifenschutz (`$CI_COMMIT_MESSAGE !~ /^docs: update OpenWiki/`), `.github/...` aus `git add` entfernen, bestehendes MR aktualisieren statt pro Pipeline ein neues anlegen.
- Visualizer: Option für gebündelte Assets ohne CDN; das Suchfeld an das vorbereitete `filterQ` anschließen.
- Visualizer und Hub: Texte übersetzbar machen (de/en).

## Review Focus

1. **Repo ohne `openwiki/`** oder mit kaputter `.last-update.json`: Der Hub zeigt „kein Wiki“ mit Anleitung und stürzt nicht ab. Abgedeckt durch einen Test im Wiki-Sync (Phase 3).
2. **`sha` nicht mehr erreichbar** (Force-Push, gelöschter Branch) beim Prüfstand-Kontext: 404 mit klarer Fehlermeldung, kein Fallback auf HEAD. Abgedeckt durch einen Contract-Test (Phase 4).
3. **Doku-MR löst wieder die CI aus:** keine Endlosschleife. Abgedeckt durch die Rule im CI-Beispiel und einen Pipeline-Test (Phase 5).
4. **Upstream-Rebase überschreibt CLAUDE.md:** Fork-Inhalt außerhalb des `OPENWIKI`-Blocks bleibt erhalten. Abgedeckt durch Task 1.2, Step 2, Prüfung per `git diff`.
5. **Kein Internet im internen Netz:** Der Visualizer bzw. die Doku-Ansicht rendert trotzdem. Abgedeckt durch einen Playwright-Smoke-Test mit blockiertem CDN (Phase 3).
