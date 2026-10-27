import { useEffect, useState } from "react";
import { api, ApiError, type Project, type ScanRecord } from "../api.ts";
import { wikiState } from "./Overview.tsx";

/**
 * Manage which projects are scanned: add by URL, enable or disable, trigger
 * scans, and read the scan history of each project.
 */
export function Admin() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<number, ScanRecord[]>>({});
  const [busy, setBusy] = useState(false);

  const reload = () =>
    api
      .projects()
      .then(setProjects)
      .catch((e: Error) => setMessage(e.message));

  useEffect(() => {
    void reload();
  }, []);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(done);
      await reload();
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Unerwarteter Fehler.");
    } finally {
      setBusy(false);
    }
  };

  const toggleHistory = async (id: number) => {
    if (history[id]) {
      setHistory(({ [id]: _removed, ...rest }) => rest);
      return;
    }
    const records = await api.scans(id);
    setHistory((current) => ({ ...current, [id]: records }));
  };

  if (!projects) return <p>Lade Verwaltung …</p>;

  return (
    <section>
      <h1>Verwaltung</h1>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            await api.addProject(url.trim());
            setUrl("");
          }, "Projekt hinzugefügt.");
        }}
      >
        <label>
          Projekt-URL
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://gitlab.example.com/gruppe/projekt"
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          Hinzufügen
        </button>
      </form>

      <p>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => api.scanAll(), "Alle Projekte sind zum Scan eingereiht.")
          }
        >
          Alle jetzt scannen
        </button>
      </p>

      {message && <p role="status">{message}</p>}

      <table>
        <thead>
          <tr>
            <th>Projekt</th>
            <th>Quelle</th>
            <th>Status</th>
            <th>Aktiv</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => {
            const state = wikiState(project);
            return (
              <tr key={project.id}>
                <td>
                  {project.path}
                  {history[project.id] && (
                    <ul>
                      {history[project.id]!.map((record) => (
                        <li key={`${record.sha}-${record.syncedAt}`}>
                          {record.syncedAt.slice(0, 16).replace("T", " ")} · {record.sha.slice(0, 8)} ·{" "}
                          {record.status}
                          {record.error && <em> — {record.error}</em>}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>{project.source === "group" ? "Gruppe" : "Manuell"}</td>
                <td>{state.label}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={project.enabled}
                    disabled={busy || project.archived}
                    aria-label={`${project.path} aktiv`}
                    onChange={(event) =>
                      void run(() => api.setEnabled(project.id, event.target.checked), "Gespeichert.")
                    }
                  />
                </td>
                <td>
                  <button type="button" disabled={busy} onClick={() => void run(() => api.scan(project.id), "Scan abgeschlossen.")}>
                    Scannen
                  </button>{" "}
                  <button type="button" onClick={() => void toggleHistory(project.id)}>
                    Verlauf
                  </button>{" "}
                  {project.source === "manual" && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void run(() => api.removeProject(project.id), "Projekt entfernt.")}
                    >
                      Entfernen
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
