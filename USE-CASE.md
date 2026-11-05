# Anwendungsfälle – OpenWiki

OpenWiki macht aus einer Codebasis und Wissensquellen ein verlinktes Markdown-Wiki, das Coding-Agenten lesen. Es läuft als CLI und ist als npm-Paket verfügbar; die Hub-Komponente verwaltet verknüpfte Wikis. Ausführlich: `README.md`, `hub/README.md`.

## UC-1: Wiki für ein Repository anlegen

**Akteur:** Entwickler.
**Ablauf:** `openwiki --init` im Repository → Seiten werden erzeugt (parallel, mit Fortschritt je Seite).
**Ergebnis:** Ordner `openwiki/` mit verlinkten Seiten; `AGENTS.md` oder `CLAUDE.md` verweist darauf.

## UC-2: Wiki aktuell halten

**Akteur:** CI oder Entwickler.
**Ablauf:** `openwiki --update` nach Änderungen. Belege aus dem Quellcode zeigen, welche Fakten sich geändert haben; nur diese Seiten werden neu geschrieben.
**Ergebnis:** Kleine, nachvollziehbare Updates statt Neugenerierung.

## UC-3: Agent fragt das Wiki

**Akteur:** Coding-Agent (Claude Code, Codex, Cursor, Copilot u. a.).
**Ablauf:** Der Agent liest `openwiki/` oder fragt über MCP (`openwiki_read_at`, `openwiki_resolve_ref`).
**Ergebnis:** Kontext für Antworten und Änderungen.

## UC-4: Verknüpfte Repositories durchsuchen

**Akteur:** Entwickler mit mehreren Repositories.
**Ablauf:** Repositories mit `openwiki link` zu einem Arbeitsbereich verbinden → Suche über alle Wikis.
**Ergebnis:** Relevante Abschnitte aus mehreren Repositories.

## UC-5: Code-Referenz für Specs (SpecLab)

**Akteur:** SpecLab-Nutzer.
**Ablauf:** Eine Spec verweist auf `openwiki/payment.md#limit@a3f9c2`. Der Ref-Resolver (REST `GET /api/ref`, MCP) prüft mit `changedSince`, ob die Stelle sich geändert hat.
**Ergebnis:** Veraltete Referenzen fallen auf.
**Grenze:** Die Live-Anbindung in SpecLab ist noch offen.

## UC-6: Visualisieren ohne Netz

**Akteur:** Teammitglied ohne Internetzugang.
**Ablauf:** `--no-cdn` erzeugt den Offline-Visualizer mit Suche, Typfiltern und Sprache (de/en).

## UC-7: CI-Aktualisierung

**Akteur:** CI-Betrieb.
**Ablauf:** Vorlagen für GitHub Actions, GitLab CI (mit Schleifenschutz und Wiederverwendung eines MR) oder Bitbucket. Die Aktualisierung erscheint als Merge Request mit der geänderten Doku.

## Nicht im Umfang

- Die Hub-Anbindung an ACTOR und den Prüfstand ist nicht durchgängig.
- Ausführung von Code durch den Agenten; OpenWiki liest und schreibt nur die Doku.
