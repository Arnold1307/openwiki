/** Served wiki of a project: the newest successful sync. */
export interface ServedWikiInfo {
  sha: string;
  status: string;
  syncedAt: string;
  error: string | null;
}

export interface Project {
  id: number;
  path: string;
  webUrl: string;
  source: "group" | "manual";
  enabled: boolean;
  archived: boolean;
  /** Default-branch head seen at the last sync attempt. */
  lastHeadSha: string | null;
  latest: ServedWikiInfo | null;
}

export interface ScanRecord {
  sha: string;
  status: string;
  syncedAt: string;
  error: string | null;
}

export interface SearchHit {
  projectId: number;
  projectPath: string;
  ref: string;
  content: string;
}

/** Error shape returned by every failing hub route. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(response.status, payload.error ?? `Anfrage fehlgeschlagen (${response.status}).`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  projects: () => request<Project[]>("GET", "/projects"),
  project: (id: number) => request<Project & { staleness: unknown }>("GET", `/projects/${id}`),
  addProject: (url: string) => request<Project>("POST", "/projects", { url }),
  setEnabled: (id: number, enabled: boolean) =>
    request<Project>("PATCH", `/projects/${id}`, { enabled }),
  removeProject: (id: number) => request<void>("DELETE", `/projects/${id}`),
  scan: (id: number) => request<{ status: string; message?: string }>("POST", `/projects/${id}/scan`),
  scanAll: () => request<{ queued: number }>("POST", "/scan-all"),
  scans: (id: number) => request<ScanRecord[]>("GET", `/projects/${id}/scans`),
  docs: (id: number) => request<{ sha: string; pages: string[] }>("GET", `/projects/${id}/docs`),
  doc: (id: number, path: string) =>
    request<{ path: string; sha: string; markdown: string }>(
      "GET",
      `/projects/${id}/docs/file?path=${encodeURIComponent(path)}`,
    ),
  search: (q: string) =>
    request<{ hits: SearchHit[] }>("GET", `/search?q=${encodeURIComponent(q)}&limit=20`),
};
