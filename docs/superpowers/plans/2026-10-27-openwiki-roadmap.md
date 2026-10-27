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
- Server- und Web-Tests, Typechecks, Container-Build und `/healthz` wurden
  erfolgreich geprüft.

## Noch offen

1. Playwright-End-to-End-Test für Übersicht → Projekt → Doku → Suche bei
   gesperrtem externem Netz ergänzen. Die vorhandenen Web-Tests sind Vitest-
   Tests.
2. Mit ACTOR die gewünschte MCP-Konfiguration und den Aufruf der drei Tools
   `openwiki_search`, `openwiki_read` und `openwiki_list_wikis` abstimmen.
3. Mit SpecLab das Ref-Format `openwiki/<seite>.md#anker@sha` und das Feld
   `changedSince` abstimmen; danach den Ref-Resolver implementieren.
4. GitLab-CI-Beispiel verbessern: Schleifenschutz nach Doku-Merge,
   vorhandenes Merge Request aktualisieren und keine GitHub-Dateien
   committen.
5. Upstream-Visualizer optional ohne CDN ausliefern, Suche anschließen und
   Oberfläche übersetzbar machen.

## Betriebsannahmen

- Der Hub erzeugt keine Dokumentation. Die CI jedes Repositories committet
  `openwiki/`; der Hub lädt Snapshots nur lesend.
- Der Hub hat keinen eigenen Login. Betrieb nur intern und hinter einem
  Reverse Proxy mit SSO. GitLab-OIDC bleibt offen, bis ein Client feststeht.
- Der vollständige Umsetzungsplan und die Implementierungschecks stehen in
  `docs/superpowers/plans/2026-10-27-openwiki-hub-v2-mvp.md`; offene
  SDLC-Punkte stehen in `TODO.md`.
