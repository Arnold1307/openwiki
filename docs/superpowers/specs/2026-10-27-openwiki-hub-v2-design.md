# OpenWiki Hub v2 — Design (Entwurf)

**Datum:** 2026-10-27
**Status:** E1–E5 freigegeben (2026-10-27). Offene Fragen unten sind mit Annahmen im Plan belegt, bis sie beantwortet sind.
**Ersetzt:** den entfernten v1-Entwurf vom 2026-07-08 (veraltet; nicht mehr Teil der aktuellen Dokumentation)
**Basis:** upstream `langchain-ai/openwiki` v0.7.2 (Branch `chore/upstream-v0.7.2`)

## Ziel

Ein interner Hub zeigt die `openwiki/`-Dokumentation mehrerer GitLab-Projekte: Übersicht, Aktualität, Doku-Ansicht, Suche. Er stellt dieselben Wikis per MCP für Agenten bereit (Claude Code, ACTOR, Flightdeck). Er ist der zentrale Zugangspunkt, den die SDLC-Landschaft braucht. Er erzeugt keine Doku selbst.

## Was sich gegenüber v1 ändert

| Thema          | v1 (2026-07-08)                                      | v2 (Entwurf)                                                 | Grund                                                                                 |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Doku-Erzeugung | Hub klont und ruft die Agent-Runtime als Library auf | CI pro Repo erzeugt `openwiki/` und committet es (E1)        | Landschaft: `openwiki/` liegt im Repo; Verweise `pfad@sha` müssen dort auflösbar sein |
| Kosten         | Hub trägt LLM-Kosten zentral                         | Kosten bleiben beim Projekt                                  | keine Provider-Keys im Hub                                                            |
| Paket-Struktur | `exports`-Eintrag in `package.json` nötig            | entfällt                                                     | Hub braucht keine Agent-Runtime                                                       |
| Suche          | nicht im Umfang                                      | Upstream-Retrieval (`src/retrieval/wiki.ts`) wiederverwenden | upstream liefert sie bereits                                                          |
| Doku-Ansicht   | eigener Markdown-Renderer                            | Visualizer-Export pro Projekt, Assets lokal (E3)             | Graph und Reader nicht neu bauen                                                      |
| Scan-Auslöser  | Cron                                                 | GitLab-Webhook plus nächtlicher Abgleich (E5)                | Aktualität nach dem Merge                                                             |

## Entscheidungen (Vorschläge)

**E1 — Wer erzeugt die Doku?** Vorschlag: die CI in jedem Repo, mit dem verbesserten Beispiel aus `examples/openwiki-update.gitlab-ci.yml` (Phase 5 des Fahrplans). Der Hub ruft kein LLM auf.
_Alternative:_ zentraler Scan im Hub (v1). Verworfen, weil Kosten, Keys und Schreibrechte dann zentral liegen.

**E2 — Was der Hub macht.** Vorschlag: Projekte finden, `openwiki/` vom Default-Branch holen (GitLab Repository Archive oder Files-API, flach), indexieren, anzeigen, durchsuchen, per MCP bereitstellen.

**E3 — Frontend.** Vorschlag: eigene React-SPA für Übersicht, Aktualität und Verwaltung. Die Doku-Ansicht bettet den Visualizer-Export (`openwiki visualize openwiki --export`) pro Projekt ein. Die Assets (`force-graph`, `marked`, `DOMPurify`, `mermaid`) liegen lokal im Bundle statt auf jsDelivr, damit das Portal im internen Netz ohne Internetzugang läuft.
_Hinweis:_ Upstream-Visualizer lädt seine Bibliotheken per CDN (`src/visualize/page.ts`). Eine lokale Variante braucht eine Änderung upstream oder eine eigene Build-Stufe. Das ist in Phase 5 des Fahrplans vorgesehen.

**E4 — Zugriff.** Vorschlag: GitLab-OIDC-Login oder SSO über einen Reverse Proxy. Zusätzlich CSRF-Schutz für alle schreibenden Endpunkte. Begründung: Der Hub hält einen GitLab-Token und kann Scans auslösen. Ein reiner Netzschutz reicht dafür nicht.
_Alternative:_ nur Netzzugang (v1). Nur tragbar, wenn der Hub nur lesend ist.

**E5 — Auslöser.** Vorschlag: GitLab-Webhook (Push auf den Default-Branch) für Aktualisierung, plus nächtlicher Abgleich aller Projekte als Sicherheitsnetz.

## Architektur

```
GitLab (Gruppen) ──API──► hub/server (Fastify)
                              │  Discovery, Sync (Files-API), Index (Upstream-Retrieval)
                              │  REST für die Web-App, MCP über HTTP
                              ▼
                          SQLite (Metadaten) + data/<projekt>/openwiki/
```

- **Sync:** holt `openwiki/` und `.last-update.json` für den HEAD-Commit des Default-Branches. Speichert `sha` und `gitHead` je Projekt.
- **Aktualität:** Anzahl Commits zwischen `gitHead` (aus `.last-update.json`) und HEAD. Upstream-Befehl dafür ist nicht nötig, der Hub zählt über die GitLab-API.
- **MCP über HTTP:** Upstream spricht nur stdio (`src/integrations/mcp/stdio.ts`). Der HTTP-Transport ist neu zu bauen, nutzt aber dieselben Tools (`openwiki_search`, `openwiki_read`, `openwiki_list_workspaces`, `openwiki_list_wikis`).
- **Zusätzliches Tool `openwiki_read_at(project, sha, page, anchor)`:** liefert eine Seite zu einem bestimmten Commit. Dafür braucht der Hub Versionen, nicht nur den letzten Stand. Entscheidung offen, siehe unten.

## Schnittstellen zur SDLC-Landschaft

| Verbraucher        | Schnittstelle                                                                                                    | Quelle in TODO.md |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------- |
| Prüfstand          | `GET /api/projects/:id/context?sha=<MR-Basis>` liefert den Wiki-Stand zu genau diesem Commit, mit Hash im Header | Punkt 1           |
| ACTOR / Flightdeck | MCP-Endpunkt über HTTP, Konfiguration über company-mcp                                                           | Punkt 2           |
| SpecLab            | Auflösung von `openwiki/<seite>.md#anker@sha` mit Feld `changedSince`                                            | Kapitel 8.2       |

## Datenhaltung

- `hub.sqlite`: Projekte (`id`, `path`, `source` = `group`|`manual`, `enabled`, `archived`), Sync-Läufe (`status`, `sha`, Fehler), Index-Stand.
- `data/<projekt>/openwiki/`: heruntergeladene Doku. Nur lesend, nie zurückgepusht.
- Aufbewahrung der Versionen: offen (siehe unten).

## Fehlerbehandlung

- Repo ohne `openwiki/`: Status `kein Wiki`, mit Anleitung zur CI-Einrichtung. Kein Absturz.
- `sha` nicht mehr erreichbar (Force-Push): 404 mit klarer Meldung, kein stiller Fallback auf HEAD.
- GitLab-Token ungültig: Warnbanner, Sync pausiert.
- Pfad-Traversal im Doku-Endpunkt: Pfade werden strikt unterhalb von `openwiki/` aufgelöst, sonst 400. Tests für `../`, `%2e%2e`, absolute Pfade, Backslash.
- Secrets (Token) erscheinen nie in Logs oder Antworten. Jede Ausgabe läuft durch `sanitizeDiagnosticText` (`src/platform/diagnostics.ts`).

## Tests

- **API:** `fastify.inject` für alle Routen, inklusive Fehlerfälle.
- **Sync:** Gruppen-Pagination über mehrere Seiten, Token-Fehler, Projekt ohne Wiki.
- **Contract:** MCP-Tools gegen das Upstream-Schema, `read_at` gegen einen festen Commit.
- **Frontend:** Smoke-Test (Übersicht → Projekt → Seite → Suche) und ein Test mit blockiertem CDN.
- **Upstream-Suite:** bleibt grün; der Hub darf `src/` nicht ändern, außer dort, wo Phase 5 es ausdrücklich vorsieht.

## Offene Fragen

1. **Versionen:** Soll der Hub mehrere Versionen je Projekt speichern (für `read_at` und Prüfstand) oder nur den letzten Stand plus den Commit-Hash, der gerade geprüft wird?
2. **Speicher:** Wie viele Projekte sind es ungefähr, und wie groß ist ein `openwiki/`-Ordner typischerweise? Davon hängt ab, ob Klone oder reine Archiv-Downloads reichen.
3. **Zugriff (E4):** Gibt es einen GitLab-OIDC-Client oder einen Reverse Proxy mit SSO, den der Hub nutzen kann?
4. **Namespace:** In welcher GitLab-Gruppe liegt der Hub selbst, und welche Gruppen sollen gescannt werden?

## Nicht im Umfang

- Doku-Erzeugung durch den Hub (E1).
- Zurückpushen der Doku in die Repos.
- Mehrere GitLab-Instanzen gleichzeitig.
- Eigene Volltextsuche neben dem Upstream-Retrieval.
