# OpenWiki – nächste Schritte

**Stand:** 2026-10-27

**Basis:** Upstream v0.7.2 plus Hub-MVP auf `main`.

## Umgesetzt

- Upstream übernommen und Agent-Onboarding an die aktuelle Repository-Struktur
  angepasst.
- Hub-MVP mit GitLab-Discovery und Snapshot-Sync, Statusübersicht, Doku-Ansicht,
  Suche, REST- und MCP-Schnittstellen, Webhook, Zeitplan und Container erstellt.
- Prüfstand kann einen synchronisierten Wiki-Stand zu einem exakten Commit über
  `GET /api/projects/:id/context?sha=<commit>` abrufen. Der Header
  `X-OpenWiki-SHA` bestätigt den Ref.
- Playwright-End-to-End-Smoke-Test für Übersicht → Projekt → Doku-Navigation →
  Suche bei gesperrtem externem Netz implementiert (`hub/web/e2e/smoke.spec.ts`).
- GitLab-CI-Beispiel (`examples/openwiki-update.gitlab-ci.yml`) verbessert:
  Schleifenschutz gegen Rekursion nach Doku-Merges, Wiederverwendung/Aktualisierung
  bestehender Merge Requests auf einem stabilen `openwiki/update`-Branch, Entfernung
  transienter `.run.json` und Ausschluss von GitHub-Workflow-Dateien.
- Server- und Web-Tests, Typechecks, E2E-Smoke-Tests, Container-Build und `/healthz`
  wurden erfolgreich geprüft.
- **Upstream-Visualizer für Offline-Betrieb & Lokalisierung**:
  - Offline-Modus mit `--no-cdn` (Server & statischer Export): Vendor-Assets (`force-graph`, `marked`, `dompurify`, `mermaid`) gebündelt in `dist/visualize/vendor/` und ohne externe CDNs ausgeliefert; angepasste restriktive Content Security Policy (`OFFLINE_CSP`).
  - Vollständige Lokalisierungsunterstützung (`--lang <de|en>`) mit Übersetzungswörterbuch (`src/visualize/i18n.ts`) für Labels, Tooltips, Statusanzeigen und Barrierefreiheit.
  - Interaktive Suche und Typ-Filter im Visualizer (`#search`, `#filter-type`), mit Live-Filterung in Graph & Seitenleiste über Titel, Pfad/ID, Typ, Tags, Kurzbeschreibung und Textkörper.

## Noch offen

1. Mit ACTOR die gewünschte MCP-Konfiguration und den Aufruf der drei Tools
   `openwiki_search`, `openwiki_read` und `openwiki_list_wikis` abstimmen.
2. Mit SpecLab das Ref-Format `openwiki/<seite>.md#anker@sha` und das Feld
   `changedSince` abstimmen; danach den Ref-Resolver implementieren.

## Betriebsannahmen

- Der Hub erzeugt keine Dokumentation. Die CI jedes Repositories committet
  `openwiki/`; der Hub lädt Snapshots nur lesend.
- Der Hub hat keinen eigenen Login. Betrieb nur intern und hinter einem
  Reverse Proxy mit SSO. GitLab-OIDC bleibt offen, bis ein Client feststeht.
- Der vollständige Umsetzungsplan und die Implementierungschecks stehen in
  `docs/superpowers/plans/2026-10-27-openwiki-hub-v2-mvp.md`; offene
  SDLC-Punkte stehen in `TODO.md`.
