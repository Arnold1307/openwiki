import type { Db } from "./db.js";

export type SnapshotStatus = "success" | "no-wiki" | "failed" | "running";

export interface Snapshot {
  sha: string;
  status: SnapshotStatus;
  syncedAt: string;
  error: string | null;
}

/**
 * Store the outcome of one sync attempt for a commit. A repeated attempt for
 * the same commit replaces the earlier row.
 *
 * @param db - Open database.
 * @param projectId - Project ID.
 * @param sha - Commit that was synced.
 * @param status - Outcome.
 * @param error - Short failure message, without secrets.
 */
export function recordSnapshot(
  db: Db,
  projectId: number,
  sha: string,
  status: SnapshotStatus,
  error: string | null = null,
): void {
  db.prepare(
    `INSERT INTO snapshots (project_id, sha, status, synced_at, error)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_id, sha) DO UPDATE SET
       status = excluded.status, synced_at = excluded.synced_at, error = excluded.error`,
  ).run(projectId, sha, status, new Date().toISOString(), error);
}

/**
 * Most recent snapshot that produced a usable wiki.
 *
 * @param db - Open database.
 * @param projectId - Project ID.
 * @returns The snapshot, or undefined when nothing succeeded yet.
 */
export function latestSuccessfulSnapshot(
  db: Db,
  projectId: number,
): Snapshot | undefined {
  const row = db
    .prepare(
      `SELECT sha, status, synced_at, error FROM snapshots
       WHERE project_id = ? AND status = 'success'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(projectId) as
    | { sha: string; status: SnapshotStatus; synced_at: string; error: string | null }
    | undefined;
  return row
    ? { sha: row.sha, status: row.status, syncedAt: row.synced_at, error: row.error }
    : undefined;
}

/**
 * Snapshot for one exact commit, used by the context endpoint.
 *
 * @param db - Open database.
 * @param projectId - Project ID.
 * @param sha - Commit SHA.
 * @returns The snapshot, or undefined when that commit was never synced.
 */
export function snapshotForSha(
  db: Db,
  projectId: number,
  sha: string,
): Snapshot | undefined {
  const row = db
    .prepare(
      `SELECT sha, status, synced_at, error FROM snapshots
       WHERE project_id = ? AND sha = ?`,
    )
    .get(projectId, sha) as
    | { sha: string; status: SnapshotStatus; synced_at: string; error: string | null }
    | undefined;
  return row
    ? { sha: row.sha, status: row.status, syncedAt: row.synced_at, error: row.error }
    : undefined;
}

/**
 * Drop snapshot rows beyond the newest `keep`. Returns the removed commit SHAs
 * so the caller can delete their directories.
 *
 * @param db - Open database.
 * @param projectId - Project ID.
 * @param keep - Number of newest snapshots to keep.
 * @returns SHAs whose rows were removed.
 */
export function pruneSnapshots(db: Db, projectId: number, keep: number): string[] {
  const rows = db
    .prepare("SELECT id, sha FROM snapshots WHERE project_id = ? ORDER BY id DESC")
    .all(projectId) as { id: number; sha: string }[];
  const stale = rows.slice(keep);
  const remove = db.prepare("DELETE FROM snapshots WHERE id = ?");
  db.transaction(() => {
    for (const row of stale) remove.run(row.id);
  })();
  return stale.map((row) => row.sha);
}

/**
 * Mark snapshots that were still running when the server stopped as failed.
 *
 * @param db - Open database.
 * @returns Number of rows changed.
 */
export function markInterruptedSnapshots(db: Db): number {
  return db
    .prepare(
      "UPDATE snapshots SET status = 'failed', error = 'interrupted by restart' WHERE status = 'running'",
    )
    .run().changes;
}

/**
 * Recent sync attempts for one project, newest first. Doubles as the scan
 * history shown in the admin view.
 *
 * @param db - Open database.
 * @param projectId - Project ID.
 * @param limit - Maximum rows.
 * @returns Snapshot rows, newest first.
 */
export function listSnapshots(db: Db, projectId: number, limit = 20): Snapshot[] {
  return (
    db
      .prepare(
        `SELECT sha, status, synced_at, error FROM snapshots
         WHERE project_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(projectId, limit) as {
      sha: string;
      status: SnapshotStatus;
      synced_at: string;
      error: string | null;
    }[]
  ).map((row) => ({
    sha: row.sha,
    status: row.status,
    syncedAt: row.synced_at,
    error: row.error,
  }));
}
