# OpenWiki Hub

Ein interner Hub, der die `openwiki/`-Dokumentation mehrerer GitLab-Projekte
einsammelt, anzeigt, durchsucht und per MCP für Agenten bereitstellt. Der Hub
erzeugt keine Dokumentation selbst. Erzeugt wird sie durch die CI jedes Repos
(siehe `examples/openwiki-update.gitlab-ci.yml`); der Hub holt das Ergebnis.

Spezifikation: `docs/superpowers/specs/2026-10-27-openwiki-hub-v2-design.md`.

Der MVP ist auf `feat/hub-mvp` umgesetzt. Der Stand wurde mit den Server- und
Web-Tests, Typechecks, Server-Build und einem Docker-Healthcheck geprüft. Der
Hub hat keinen eigenen Login; der Betrieb setzt einen Reverse Proxy mit SSO
voraus.

## Konfiguration

| Variable                     | Pflicht | Standard           | Zweck                                                               |
| ---------------------------- | ------- | ------------------ | ------------------------------------------------------------------- |
| `GITLAB_BASE_URL`            | ja      | –                  | Basis-URL der GitLab-Instanz                                        |
| `GITLAB_TOKEN`               | ja      | –                  | Token mit `read_api` (Lesen genügt)                                 |
| `OPENWIKI_HUB_WEBHOOK_TOKEN` | ja      | –                  | Geheimnis für `POST /hooks/gitlab` (GitLab-Header `X-Gitlab-Token`) |
| `OPENWIKI_HUB_GROUPS`        | nein    | leer               | Gruppen für die Discovery, kommagetrennt                            |
| `OPENWIKI_HUB_SCHEDULE`      | nein    | `0 2 * * *`        | Cron-Ausdruck für den nächtlichen Abgleich                          |
| `OPENWIKI_HUB_DATA_DIR`      | nein    | `./data`           | Datenbank und Snapshots                                             |
| `OPENWIKI_HUB_CONCURRENCY`   | nein    | `1`                | parallele Syncs                                                     |
| `OPENWIKI_HUB_RETENTION`     | nein    | `20`               | Snapshots je Projekt, die behalten werden                           |
| `HOST` / `PORT`              | nein    | `0.0.0.0` / `8080` | Listen-Adresse                                                      |

Fehlermeldungen nennen nur den Variablennamen, nie den Wert.

## Start

```sh
pnpm install --frozen-lockfile
pnpm run build                             # Root-Paket, das die Hub-Module importiert
pnpm --filter openwiki-hub-server run build
pnpm --filter openwiki-hub-web run build   # Web-App nach hub/web/dist
node hub/server/dist/main.js
```

Die Web-App wird vom Server unter `/` ausgeliefert. Ohne gebaute Web-App
antwortet der Server nur auf die API.

## GitLab-Webhook einrichten

Im Projekt (oder in der Gruppe) unter _Settings → Webhooks_:

- URL: `https://<hub-host>/hooks/gitlab`
- Secret token: der Wert von `OPENWIKI_HUB_WEBHOOK_TOKEN`
- Trigger: _Push events_

Ein Push auf den Default-Branch stößt einen Sync dieses Projekts an. Andere
Branches werden bestätigt und ignoriert.

## API

| Methode und Pfad                        | Zweck                                                                                                                |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /api/projects`                     | Projekte mit aktuellem Wiki-Stand                                                                                    |
| `GET /api/projects/:id`                 | Projekt mit Abstand zu HEAD (`staleness`)                                                                            |
| `POST /api/projects`                    | Projekt per URL hinzufügen                                                                                           |
| `PATCH /api/projects/:id`               | aktivieren oder deaktivieren                                                                                         |
| `DELETE /api/projects/:id`              | nur manuell hinzugefügte Projekte                                                                                    |
| `POST /api/projects/:id/scan`           | Sync eines Projekts (wartet auf das Ergebnis)                                                                        |
| `POST /api/scan-all`                    | Discovery und Sync aller aktiven Projekte (asynchron)                                                                |
| `GET /api/projects/:id/scans`           | Verlauf der Sync-Versuche                                                                                            |
| `GET /api/projects/:id/docs`            | Seiten des aktuellen Wikis                                                                                           |
| `GET /api/projects/:id/docs/file?path=` | Markdown einer Seite                                                                                                 |
| `GET /api/projects/:id/context?sha=`    | `openwiki/` zu genau diesem Commit als `tar.gz`; `X-OpenWiki-SHA` bestätigt den Ref (404, wenn nicht synchronisiert) |
| `GET /api/search?q=&limit=`             | Suche über alle aktuellen Wikis                                                                                      |
| `POST /mcp`                             | MCP über Streamable HTTP (stateless)                                                                                 |
| `GET /healthz`                          | Health-Check                                                                                                         |

### MCP-Werkzeuge

- `openwiki_search` — `{ query, limit? }`, Treffer über alle Projekte
- `openwiki_read` — `{ project, page, sections[] }`, vollständige Abschnitte
- `openwiki_list_wikis` — Projekte mit aktuellem Wiki und Commit

Im Gegensatz zum Upstream-MCP werden Wikis über den Projektpfad angesprochen,
nicht über einen lokalen Repository-Pfad.

## Betrieb

- Der Server beendet laufende Syncs beim Herunterfahren nicht abrupt: er wartet
  auf die Warteschlange, bevor die Datenbank geschlossen wird.
- Ein Sync, der beim Absturz im Status `running` stand, wird beim nächsten Start
  als `failed` („interrupted by restart“) markiert. Die letzte gute Doku bleibt
  sichtbar.
- Der Hub hat keinen eigenen Login. Die API hat keine Benutzerauthentifizierung;
  schreibende API-Aufrufe verlangen den Header `X-Requested-With` als CSRF-Schutz.
  Das ersetzt kein Login. Den Hub nur intern und hinter einem Reverse Proxy mit
  SSO betreiben. Der Webhook ist separat durch `OPENWIKI_HUB_WEBHOOK_TOKEN`
  geschützt.

## Container

```sh
docker build -f hub/Dockerfile -t openwiki-hub .
docker run -p 8080:8080 -v hub-data:/data \
  -e GITLAB_BASE_URL=https://gitlab.example.com \
  -e GITLAB_TOKEN \
  -e OPENWIKI_HUB_WEBHOOK_TOKEN \
  -e OPENWIKI_HUB_GROUPS=platform \
  openwiki-hub
```

Das Image enthält das gesamte Repository mit Entwicklungsabhängigkeiten. Ein
schlankeres Laufzeitbild ist ein möglicher Folgeschritt.

## Tests

```sh
pnpm --filter openwiki-hub-server test
pnpm --filter openwiki-hub-web test
```

Die Server-Tests importieren das Root-Paket aus `dist/`. Deshalb muss
`pnpm run build` im Root vorher gelaufen sein.
