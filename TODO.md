# TODO – OpenWiki

Quelle: `C:\Develop\SDLC\Projektuebersicht.docx`, Kapitel 8 und 9. Die Nummern entsprechen der Reihenfolge aus Abschnitt 9.3 (1 = zuerst). Die Einordnung ist eine Einschätzung.

## 1. Befund-Rückkanal und Team-Regeln

- [x] Den openwiki/-Ordner als Prüfkontext für den Prüfstand bereitstellen. `GET /api/projects/:id/context?sha=<commit>` liefert den archivierten Stand dieses Commits und bestätigt den SHA im `X-OpenWiki-SHA`-Header.
- [x] SpecLab-Ref-Resolver implementiert: Auflösung von `openwiki/<seite>.md#anker@sha` und `<projekt>/openwiki/...` mit Feld `changedSince` (REST: `GET /api/ref`, `GET /api/projects/:id/ref`; MCP: `openwiki_resolve_ref`, `openwiki_read_at`).

## Aus Kapitel 8.2 (ACTOR-Anbindung)

- [ ] Kontext-Ausgabe für ACTOR abstimmen. Die Anbindung liegt auf der ACTOR-Seite, die Schnittstelle hier.
