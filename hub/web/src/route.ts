/** Parsed in-app route. Hash routing keeps the server a plain static host. */
export type Route =
  | { name: "overview" }
  | { name: "docs"; projectId: number; page: string; anchor: string }
  | { name: "admin" };

/**
 * Parse a location hash such as `#/projects/7/docs/architecture/jobs.md#queue`.
 *
 * @param hash - `window.location.hash`.
 * @returns The route; unknown hashes fall back to the overview.
 */
export function parseRoute(hash: string): Route {
  const [path, anchor = ""] = hash.replace(/^#/, "").split(/#(.*)/s);
  const docs = /^\/projects\/(\d+)\/docs\/(.+)$/.exec(path ?? "");
  if (docs) {
    return {
      name: "docs",
      projectId: Number(docs[1]),
      page: docs[2]!,
      anchor,
    };
  }
  if (path === "/verwaltung") return { name: "admin" };
  return { name: "overview" };
}

/** Hash for a project's page, with an optional heading anchor. */
export function docsHref(projectId: number, page: string, anchor = ""): string {
  return `#/projects/${projectId}/docs/${page}${anchor ? `#${anchor}` : ""}`;
}
