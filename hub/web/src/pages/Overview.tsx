import { useEffect, useMemo, useState } from "react";
import { api, type Project, type SearchHit } from "../api.ts";
import { docsHref } from "../route.ts";

/** Human-readable state of a project's wiki, in German. */
export function wikiState(project: Project): { label: string; tone: "ok" | "warn" | "muted" } {
  if (project.archived) return { label: "Archiviert", tone: "muted" };
  if (!project.latest) return { label: "Noch keine Doku", tone: "muted" };
  if (project.latest.sha !== project.lastHeadSha) {
    return { label: "Doku veraltet", tone: "warn" };
  }
  return { label: "Doku aktuell", tone: "ok" };
}

/**
 * Project overview with a filter for project names and a full-text search
 * across all served wikis.
 */
export function Overview() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);

  useEffect(() => {
    api
      .projects()
      .then(setProjects)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const query = filter.trim();
    if (query.length < 3) {
      setHits(null);
      return;
    }
    const timer = setTimeout(() => {
      api
        .search(query)
        .then((result) => setHits(result.hits))
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [filter]);

  const visible = useMemo(
    () =>
      (projects ?? []).filter(
        (p) => !filter || p.path.toLowerCase().includes(filter.toLowerCase()),
      ),
    [projects, filter],
  );

  if (error) return <p role="alert">Projekte konnten nicht geladen werden: {error}</p>;
  if (!projects) return <p>Lade Projekte …</p>;

  return (
    <section>
      <h1>Projekte</h1>
      <input
        type="search"
        placeholder="Projekt filtern oder Doku durchsuchen (mind. 3 Zeichen)"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        aria-label="Projekte filtern oder Doku durchsuchen"
      />

      {hits && (
        <div>
          <h2>Treffer in der Doku</h2>
          {hits.length === 0 && <p>Keine Treffer.</p>}
          <ul>
            {hits.map((hit, index) => {
              const [page, anchor = ""] = hit.ref.split("#");
              const relative = page.replace(/^openwiki\//, "");
              return (
                <li key={`${hit.projectId}-${index}`}>
                  <a href={docsHref(hit.projectId, relative, anchor)}>
                    {hit.projectPath} · {relative}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {projects.length === 0 && (
        <p>
          Noch keine Projekte. Projekte kommen aus den konfigurierten Gruppen
          oder können im Bereich „Verwaltung“ per URL hinzugefügt werden.
        </p>
      )}

      <ul className="project-list">
        {visible.map((project) => {
          const state = wikiState(project);
          return (
            <li key={project.id} className={`project project--${state.tone}`}>
              <a href={project.latest ? docsHref(project.id, "quickstart.md") : "#/verwaltung"}>
                <strong>{project.path}</strong>
              </a>
              <span className={`badge badge--${state.tone}`}>{state.label}</span>
              {project.latest && (
                <small>
                  Stand {project.latest.sha.slice(0, 8)} · {new Date(project.latest.syncedAt).toLocaleString("de-DE")}
                </small>
              )}
              {!project.latest && (
                <small>
                  Kein Wiki vorhanden. Die CI-Anleitung steht im Bereich „Verwaltung“.
                </small>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
