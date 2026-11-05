# Workflow – OpenWiki

Der Weg vom Quellcode zur Wiki-Seite und wieder zurück zum Agenten. Der Ablauf unterscheidet Erstellung, Aktualisierung und die Hub-Referenzierung.

## Erstellen und Aktualisieren

```
Repository
   │  --init (erste Erstellung) oder --update (nach Änderungen)
   ▼
Analyse: Seitenplan, Quellen, Belege (Versionierung der Quellen)
   │
   ▼
Seiten schreiben (parallel, Fortschritt je Seite gesichert, Anpassung an Anbieter-Limits)
   │
   ▼
Claims mit Belegen ──► geänderte Fakten markiert
   │
   ▼
openwiki/ im Repository  ──► AGENTS.md / CLAUDE.md verweist darauf
```

Unterbrechungen: Fertige Seiten bleiben erhalten; ein Lauf setzt dort fort, wo er abbrach.

## Hub und Referenzen

```
Repository A, B, C  ──► openwiki link (Arbeitsbereich)
   │
   ▼
Hub: Suche über alle Wikis; Webhook (GitLab, geschützt durch OPENWIKI_HUB_WEBHOOK_TOKEN) und nächtlicher Abgleich
   │
   ▼
Ref-Resolver: GET /api/ref  |  MCP openwiki_resolve_ref, openwiki_read_at
   │
   ▼
changedSince: Referenz veraltet oder aktuell
```

## CI-Vorlagen

1. Änderung auf dem Default-Branch oder im Merge Request.
2. CI führt `--update` aus.
3. Ergebnis wird als Merge Request mit der Doku angelegt; eine vorhandene MR wird wiederverwendet.
4. Schleifenschutz verhindert, dass die Doku-Änderung selbst einen neuen Lauf auslöst.

## Abweichungen

- **Seed-Pfad außerhalb des Repositorys**: abgelehnt (`Invalid seed path`).
- **Anbieter-Limit**: Parallelität wird gedrosselt; der Lauf setzt fort.
- **Webhook ohne Token**: abgelehnt.

## Offen

- ACTOR-Schnittstelle und Ende-zu-Ende-Anbindung an den Prüfstand.
