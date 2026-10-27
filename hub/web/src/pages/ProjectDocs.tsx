import { useEffect, useMemo, useState } from "react";
import { api, type Project } from "../api.ts";
import { mapWikiLink, renderMarkdown } from "../markdown.ts";

interface Props {
  projectId: number;
  page: string;
  anchor: string;
}

/**
 * One project's wiki: page list on the left, rendered page on the right.
 * Links between pages stay inside the app; source links open GitLab.
 */
export function ProjectDocs({ projectId, page, anchor }: Props) {
  const [project, setProject] = useState<Project | null>(null);
  const [pages, setPages] = useState<string[] | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    Promise.all([api.projects(), api.docs(projectId)])
      .then(([projects, docs]) => {
        setProject(projects.find((p) => p.id === projectId) ?? null);
        setPages(docs.pages);
      })
      .catch((e: Error) => setError(e.message));
  }, [projectId]);

  useEffect(() => {
    setMarkdown(null);
    api
      .doc(projectId, page)
      .then((result) => setMarkdown(result.markdown))
      .catch((e: Error) => setError(e.message));
  }, [projectId, page]);

  const html = useMemo(() => {
    if (markdown === null || !project) return null;
    const ctx = {
      projectId,
      currentPage: page,
      webUrl: project.webUrl,
      branch: "main",
    };
    return renderMarkdown(markdown, (href) => mapWikiLink(href, ctx));
  }, [markdown, project, page, projectId]);

  useEffect(() => {
    if (anchor && html) document.getElementById(anchor)?.scrollIntoView();
  }, [anchor, html]);

  if (error) return <p role="alert">Seite konnte nicht geladen werden: {error}</p>;
  if (!pages) return <p>Lade Doku …</p>;
  if (pages.length === 0) {
    return <p>Für dieses Projekt gibt es noch keine Doku.</p>;
  }

  return (
    <div className="docs">
      <nav aria-label="Seiten">
        <ul>
          {pages.map((name) => (
            <li key={name}>
              <a
                href={`#/projects/${projectId}/docs/${name}`}
                aria-current={name === page ? "page" : undefined}
              >
                {name}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <article
        className="markdown"
        // Sanitized by DOMPurify inside renderMarkdown.
        dangerouslySetInnerHTML={{ __html: html ?? "<p>Lade Seite …</p>" }}
      />
    </div>
  );
}
