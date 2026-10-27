# Testbasis upstream v0.7.2 unter Windows (2026-10-27)

**Lauf:** `pnpm test` (Typecheck, Build, Vitest mit Coverage) auf `305599f`, Windows 11, Node 24.22.1.
**Ergebnis:** 3394 Tests bestanden, 6 übersprungen, **42 fehlgeschlagen** in 18 Dateien (von 241).

Die Zuordnung unten ist eine **Einschätzung aus den Fehlermeldungen**, nicht bestätigt. Bestätigen heißt: dieselben Dateien unter Linux (CI-Referenz, Node 22/24) laufen lassen. Solange das nicht passiert ist, gilt jede Zeile als „wahrscheinlich Umgebung“.

## Wahrscheinlich Windows-spezifisch

| Muster                                     | Betroffene Dateien                                                                                                                                         | Beleg in der Fehlermeldung                                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Zeilenenden CRLF                           | `evals/ledger/replay/git-replay.test.ts` (4 Tests)                                                                                                         | `expected 'one\r\n' to be 'one\n'`                                                                            |
| POSIX-Dateirechte (0700, 0600, Modus-Bits) | `test/config/openwiki-home.test.ts` (4), `test/integrations/config-adapters.test.ts` (1), `test/integrations/installer.test.ts` (9)                        | `expected 438 to be 448`, `expected 438 to be 384`                                                            |
| SQLite-Datei gesperrt beim Löschen         | `test/agent/claims-agent-integration.test.ts` (3), `test/agent/docs-only-backend.test.ts` (3), `test/agent/personal-shell-boundary.test.ts` (Suite-Fehler) | `EBUSY: resource busy or locked, unlink …openwiki.sqlite`                                                     |
| Atomares Umbenennen schlägt fehl           | `test/generation/page-manifest.test.ts` (1), `test/generation/repository-run.test.ts` (1)                                                                  | Windows verweigert `rename`, solange eine Datei offen ist (Vermutung, nicht geprüft)                          |
| Darwin-spezifischer Test                   | `test/scheduling/schedules-launchd.test.ts` (1)                                                                                                            | Testname „darwin native install“. Auf Windows sollte er übersprungen werden. Prüfen, ob ein Skip-Guard fehlt. |

## Unklar, Ursache offen

| Datei                                                | Fehler                                                     | Nächster Schritt                                                |
| ---------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `test/git-repo-connector.test.ts` (3)                | `readManifest` findet kein `manifest`-Dokument im Ergebnis | Pfad-Trenner `\` vs. `/` oder CRLF prüfen                       |
| `test/cli/runners.test.ts` (1)                       | `expected false to be true` bei `runVisualizeCommand`      | prüfen, ob ein Pfad- oder Port-Problem vorliegt                 |
| `test/agent/wiki-link-validator-dogfood.test.ts` (1) | 22 kaputte Links im eingecheckten `openwiki/`-Baum         | evtl. CRLF in den Markdown-Dateien; Link-Parser auf `\r` prüfen |
| `evals/ledger/run/reevaluate-args.test.ts` (1)       | Pfad- bzw. Umgebungs-Defaults                              | ansehen                                                         |

## Konsequenz

- **Kein Fehler wurde in `src/` gepatcht.** Das braucht eine Freigabe, und die Ursachen sind noch nicht bestätigt.
- Vor einem eigenen Fork-CI-Lauf sollte die Liste unter Linux verifiziert werden. Erst dann lohnt sich ein Upstream-Issue, und nur für echte Fehler.
- Die Testbasis dient als Referenz: Nach dem Rebase darf die Zahl der Fehler nicht steigen.
