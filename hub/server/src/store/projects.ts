import type { GitLabProject } from "../gitlab/client.js";
import type { Db } from "./db.js";

/** A project row as the rest of the hub sees it. */
export interface Project {
  id: number;
  gitlabId: number | null;
  path: string;
  webUrl: string;
  defaultBranch: string;
  source: "group" | "manual";
  enabled: boolean;
  archived: boolean;
  /** Default-branch head seen at the last sync attempt. */
  lastHeadSha: string | null;
}

interface ProjectRow {
  id: number;
  gitlab_id: number | null;
  path: string;
  web_url: string;
  default_branch: string;
  source: "group" | "manual";
  enabled: number;
  archived: number;
  last_head_sha: string | null;
}

/** Thrown when an operation is not allowed for the project's source. */
export class ProjectSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectSourceError";
  }
}

const fromRow = (row: ProjectRow): Project => ({
  id: row.id,
  gitlabId: row.gitlab_id,
  path: row.path,
  webUrl: row.web_url,
  defaultBranch: row.default_branch,
  source: row.source,
  enabled: row.enabled === 1,
  archived: row.archived === 1,
  lastHeadSha: row.last_head_sha,
});

/**
 * Reconcile group discovery with the stored projects.
 *
 * New projects are added as enabled group projects. Known ones get fresh
 * metadata and are un-archived. Group projects missing from the discovery
 * result are archived, never deleted. Manual projects are not touched.
 *
 * @param db - Open database.
 * @param discovered - Projects returned by the GitLab group listing.
 * @returns Counts of created and newly archived projects.
 */
export function syncDiscovery(
  db: Db,
  discovered: GitLabProject[],
): { created: number; archived: number } {
  const now = new Date().toISOString();
  let created = 0;
  const seen = new Set<string>();

  const find = db.prepare("SELECT source FROM projects WHERE path = ?");
  const insert = db.prepare(`
    INSERT INTO projects (gitlab_id, path, web_url, default_branch, source, enabled, archived, updated_at)
    VALUES (?, ?, ?, ?, 'group', 1, 0, ?)`);
  const refresh = db.prepare(`
    UPDATE projects SET gitlab_id = ?, web_url = ?, default_branch = ?, archived = 0, updated_at = ?
    WHERE path = ?`);

  db.transaction(() => {
    for (const project of discovered) {
      seen.add(project.path_with_namespace);
      const branch = project.default_branch ?? "main";
      if (find.get(project.path_with_namespace)) {
        refresh.run(
          project.id,
          project.web_url,
          branch,
          now,
          project.path_with_namespace,
        );
      } else {
        insert.run(
          project.id,
          project.path_with_namespace,
          project.web_url,
          branch,
          now,
        );
        created++;
      }
    }
  })();

  const groupRows = db
    .prepare("SELECT path FROM projects WHERE source = 'group' AND archived = 0")
    .all() as { path: string }[];
  const archive = db.prepare(
    "UPDATE projects SET archived = 1, updated_at = ? WHERE path = ?",
  );
  let archived = 0;
  db.transaction(() => {
    for (const row of groupRows) {
      if (seen.has(row.path)) continue;
      archive.run(now, row.path);
      archived++;
    }
  })();

  return { created, archived };
}

/**
 * Add a project by hand. Re-adding an existing path returns that project.
 *
 * @param db - Open database.
 * @param input - Path and metadata of the project.
 * @returns The stored project.
 */
export function addManualProject(
  db: Db,
  input: {
    path: string;
    webUrl: string;
    defaultBranch: string;
    gitlabId?: number;
  },
): Project {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO projects (gitlab_id, path, web_url, default_branch, source, enabled, archived, updated_at)
     VALUES (?, ?, ?, ?, 'manual', 1, 0, ?)`,
  ).run(
    input.gitlabId ?? null,
    input.path,
    input.webUrl,
    input.defaultBranch,
    now,
  );
  return getProjectByPath(db, input.path)!;
}

/**
 * Delete a manually added project. Group projects are removed by discovery
 * only, so their wiki history stays visible after the group changes.
 *
 * @param db - Open database.
 * @param id - Project ID.
 * @throws {ProjectSourceError} When the project was discovered from a group.
 */
export function deleteManualProject(db: Db, id: number): void {
  const row = db
    .prepare("SELECT source FROM projects WHERE id = ?")
    .get(id) as { source: string } | undefined;
  if (!row) return;
  if (row.source !== "manual") {
    throw new ProjectSourceError(
      "Group projects are archived by discovery, not deleted.",
    );
  }
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
}

/**
 * Enable or disable a project for scans.
 *
 * @param db - Open database.
 * @param id - Project ID.
 * @param enabled - New flag value.
 */
export function setProjectEnabled(db: Db, id: number, enabled: boolean): void {
  db.prepare("UPDATE projects SET enabled = ?, updated_at = ? WHERE id = ?").run(
    enabled ? 1 : 0,
    new Date().toISOString(),
    id,
  );
}

/**
 * List all projects, active and archived.
 *
 * @param db - Open database.
 * @returns Projects ordered by path.
 */
export function listProjects(db: Db): Project[] {
  return (
    db.prepare("SELECT * FROM projects ORDER BY path").all() as ProjectRow[]
  ).map(fromRow);
}

/**
 * Look up one project by ID.
 *
 * @param db - Open database.
 * @param id - Project ID.
 * @returns The project, or undefined.
 */
export function getProject(db: Db, id: number): Project | undefined {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    | ProjectRow
    | undefined;
  return row ? fromRow(row) : undefined;
}

/**
 * Look up one project by its full path.
 *
 * @param db - Open database.
 * @param path - Full path such as `platform/core`.
 * @returns The project, or undefined.
 */
export function getProjectByPath(db: Db, path: string): Project | undefined {
  const row = db.prepare("SELECT * FROM projects WHERE path = ?").get(path) as
    | ProjectRow
    | undefined;
  return row ? fromRow(row) : undefined;
}

/**
 * Remember the default-branch head seen by the latest sync attempt.
 *
 * @param db - Open database.
 * @param id - Project ID.
 * @param sha - Head commit SHA.
 */
export function recordHead(db: Db, id: number, sha: string): void {
  db.prepare("UPDATE projects SET last_head_sha = ? WHERE id = ?").run(sha, id);
}
