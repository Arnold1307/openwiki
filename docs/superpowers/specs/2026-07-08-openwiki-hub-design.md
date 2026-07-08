# OpenWiki Hub — Design

**Datum:** 2026-07-08
**Status:** Entwurf, vom Nutzer im Brainstorming abschnittsweise freigegeben

## Ziel

OpenWiki wird um einen "Hub" erweitert: eine Web-App, die mehrere GitLab-Projekte
einer selbst gehosteten GitLab-Instanz automatisch scannt, mit der bestehenden
openwiki-Agent-Runtime Dokumentation generiert bzw. aktualisiert und die Dokus
auf einer Website präsentiert — Projektübersicht, klickbare Doku-Ansicht,
Verwaltungsseite.

## Getroffene Grundentscheidungen

- **Monorepo (Ansatz B):** Server und Frontend werden in dieses Repo integriert;
  der Hub importiert die Agent-Module direkt (Live-Fortschritt als Kernfeature).
  Bewusst in Kauf genommen: stärkere Divergenz zum Upstream `langchain-ai/openwiki`.
- **Scannen auf dem Server:** Die Web-App klont die Repos selbst und führt die
  Scans mit eingebautem Cron-Scheduler aus — kein GitLab-CI-Anteil.
- **Projektauswahl:** GitLab-Gruppen-Auto-Discovery per API **plus** manuelles
  Hinzufügen/Deaktivieren einzelner Projekte in der UI.
- **Zugriff:** Kein Login; die App läuft nur im internen Netz erreichbar.
- **GitLab:** Eine selbst gehostete Instanz; Basis-URL und Token konfigurierbar.
- **Lese-Portal:** Generierte Dokus bleiben lokal beim Hub und werden **nicht**
  in die gescannten Repos zurückgepusht.

## Repo-Struktur & Komponenten

pnpm-Workspace-Monorepo; das bestehende CLI-Paket bleibt an der Wurzel, um
Upstream-Merges so konfliktarm wie möglich zu halten:

```
openwiki/
├── src/                  # bestehendes CLI + Agent (nahezu unverändert)
├── hub/
│   ├── server/           # Fastify-Backend: REST-API, Scheduler, SQLite, GitLab-API
│   └── web/              # React-SPA (Vite), im Produktivbetrieb vom Server ausgeliefert
├── pnpm-workspace.yaml   # neu: root, hub/server, hub/web
└── package.json          # bestehend; bekommt zusätzlich "exports" für Agent-Module
```

1. **openwiki-Kern (bestehend):** Einzige additive Änderung ist ein
   `exports`-Eintrag in `package.json` (plus ggf. eine kleine Index-Datei),
   damit `hub/server` die Agent-Runtime (`runAgent`-Äquivalent, Typen,
   Provider-Konfiguration aus `src/constants.ts`, Diagnose aus
   `src/diagnostics.ts`) als Library importieren kann. Dadurch erhält der Hub
   die feingranularen Agent-Events (Fortschritt, Tool-Aufrufe) direkt — kein
   Kindprozess.
2. **hub/server (Fastify, ein Prozess, ein Port):**
   REST-API fürs Frontend, Cron-Scheduler, GitLab-API-Client für Discovery,
   Git-Klonen/Fetchen, Ausführen der Agent-Runtime, SSE-Streaming, Ausliefern
   der gebauten SPA. Als Container deploybar.
3. **hub/web (React + Vite):** Projektübersicht, Doku-Ansicht mit
   Markdown-Rendering, Verwaltungsseite; Live-Updates über Server-Sent Events.
   UI-Sprache: Deutsch.

### Konfiguration (Umgebungsvariablen / `.env` des Servers)

| Variable | Zweck |
|---|---|
| `GITLAB_BASE_URL` | Basis-URL der selbst gehosteten Instanz |
| `GITLAB_TOKEN` | Token mit `read_api` + Clone-Rechten |
| `OPENWIKI_HUB_GROUPS` | GitLab-Gruppenpfade für Auto-Discovery (kommasepariert) |
| `OPENWIKI_HUB_SCHEDULE` | Cron-Ausdruck für geplante Läufe (Default: täglich nachts) |
| `OPENWIKI_HUB_DATA_DIR` | Datenverzeichnis (Default `./data`) |
| `OPENWIKI_HUB_CONCURRENCY` | Parallele Scans (Default 1) |
| `OPENWIKI_PROVIDER`, Provider-API-Keys | unverändert die bestehenden openwiki-Variablen |

## Datenhaltung

```
data/
├── hub.sqlite            # Metadaten (SQLite via better-sqlite3)
└── repos/
    └── <projekt-id>/     # lokaler Klon jedes gescannten Repos
        └── openwiki/     # generierte Doku — wird direkt von hier gelesen
```

**Tabelle `projects`:** GitLab-Projekt-ID (bei manuellen Einträgen leer), Name,
Pfad (`gruppe/projekt`), Clone-URL, Default-Branch, Quelle (`group`/`manual`),
`enabled`-Flag, `archived`-Flag, Zeitstempel.

**Tabelle `scans`:** Projekt-Referenz, Status
(`queued`/`running`/`success`/`failed`/`skipped`), Start-/Endzeit, gescannter
Commit (SHA), Log der Agent-Events (Text), Fehlermeldung. Aufbewahrung: die
letzten 20 Scans pro Projekt, ältere werden gelöscht.

## Projekt-Discovery

- Vor jedem geplanten Lauf und auf Knopfdruck: GitLab-API
  (`/groups/:id/projects`, inkl. Untergruppen, paginiert) für alle
  konfigurierten Gruppen; neue Projekte werden als `source=group`, `enabled`
  angelegt.
- Aus den Gruppen verschwundene Projekte werden als `archived` markiert, nicht
  gelöscht — die vorhandene Doku bleibt sichtbar.
- Manuell per URL hinzugefügte Projekte (`source=manual`) sind von der
  Discovery unberührt.

## Scan-Ablauf

Pro Projekt in der Warteschlange:

1. **Klonen/Aktualisieren:** Erstklon bzw. `fetch` + Reset auf den
   Default-Branch, authentifiziert über `GITLAB_TOKEN`.
2. **Skip-Check:** Ist der HEAD-Commit identisch mit dem des letzten
   erfolgreichen Scans → Status `skipped`, kein LLM-Aufruf.
3. **Agent-Lauf:** Existiert noch kein `openwiki/`-Ordner → Init-Verhalten,
   sonst Update-Verhalten der Agent-Runtime.
4. **Protokoll:** Agent-Events ins Scan-Log schreiben und live per SSE ans
   Frontend streamen; abschließend Status `success`/`failed` setzen.

**Zeitsteuerung:** Cron-Ausdruck stößt Discovery + Scan aller aktiven Projekte
an. Zusätzlich in der UI: „Jetzt scannen" pro Projekt und für alle.
**Warteschlange:** konfigurierbare Parallelität, Default 1 (nacheinander), um
LLM-Kosten und Serverlast zu begrenzen.

## Frontend

1. **Projektübersicht (`/`):** Liste/Karten mit Name, Gruppenpfad,
   Status-Badge (Doku aktuell / Scan läuft / Fehler / noch keine Doku),
   Zeitpunkt des letzten erfolgreichen Scans, Suchfeld. Klick → Doku-Ansicht.
2. **Doku-Ansicht (`/projekte/:id/doku/...`):** Sidebar mit Dateibaum des
   `openwiki/`-Ordners (Quickstart oben), Hauptbereich mit gerendertem
   Markdown (`marked`, bereits Dependency). Relative Links zwischen
   Markdown-Dateien werden zu Router-Links umgeschrieben (Wiki-Navigation);
   Links auf Quelldateien (`src/...`) zeigen auf die GitLab-Weboberfläche des
   Projekts.
3. **Verwaltung (`/verwaltung`):** Projekt per URL hinzufügen,
   aktivieren/deaktivieren, Scans auslösen, Scan-Historie mit aufklappbaren
   Logs, Live-Log des laufenden Scans (SSE), Anzeige der
   Discovery-Konfiguration (Gruppen, Zeitplan).

## REST-API

| Endpoint | Zweck |
|---|---|
| `GET /api/projects` | Projektliste mit Status |
| `POST /api/projects` | Projekt manuell hinzufügen (URL) |
| `PATCH /api/projects/:id` | aktivieren/deaktivieren |
| `DELETE /api/projects/:id` | nur für manuelle Projekte |
| `POST /api/projects/:id/scan` | Einzel-Scan auslösen |
| `POST /api/scan-all` | Discovery + Gesamtlauf auslösen |
| `GET /api/projects/:id/scans` | Scan-Historie inkl. Logs |
| `GET /api/projects/:id/docs` | Doku-Dateibaum |
| `GET /api/projects/:id/docs/file?path=…` | Markdown-Inhalt einer Datei |
| `GET /api/events` | SSE-Stream (Scan-Status, Live-Logs) |

## Fehlerbehandlung

- **Fehlgeschlagene Scans** (Git, LLM, Timeout): Status `failed` mit
  Fehlermeldung und vollständigem Log; die letzte funktionierende Doku bleibt
  erhalten und sichtbar. Der nächste geplante Lauf versucht es erneut.
- **Server-Neustart:** Scans im Status `running` werden beim Start als
  `failed` („unterbrochen") markiert.
- **GitLab-API-/Token-Fehler:** Warnbanner auf der Verwaltungsseite.
- **Path Traversal:** Der Docs-Endpoint löst Pfade strikt innerhalb des
  `openwiki/`-Ordners des jeweiligen Klons auf; alles andere → 400.
- **Provider-Fehlkonfiguration:** Prüfung beim Serverstart über die bestehende
  Diagnose-Logik (`src/diagnostics.ts`) mit klarer Fehlermeldung.

## Testen

- **Server (Vitest, wie im Repo etabliert):** Warteschlangen-Verhalten,
  Discovery-Upsert (neu/archiviert/manuell unberührt), Skip-Check per
  Commit-Vergleich, Pfad-Validierung des Docs-Endpoints,
  Markdown-Link-Umschreibung.
- **Frontend:** Komponententest für die Link-Umschreibung; im Übrigen
  manueller Smoke-Test.
- **Bestehende CLI-Tests** bleiben unberührt und müssen weiterhin grün sein.

## Nicht im Umfang (bewusst)

- Kein Login/Auth (rein internes Netz).
- Kein Zurückpushen der Dokus in die gescannten Repos.
- Keine Volltextsuche über alle Dokus (späterer Ausbau möglich).
- Keine Unterstützung mehrerer GitLab-Instanzen gleichzeitig.
- Kein Windows-Service-Setup; Deployment-Ziel ist ein Linux-Container.
