import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as tar from "tar";
import type { GitLabClient } from "../gitlab/client.js";
import type { Db } from "../store/db.js";
import type { Project } from "../store/projects.js";
import { recordHead } from "../store/projects.js";
import {
  pruneSnapshots,
  recordSnapshot,
  snapshotForSha,
} from "../store/snapshots.js";

/** The slice of the GitLab client that sync needs; tests pass a fake. */
export type SyncClient = Pick<GitLabClient, "defaultBranchHead" | "downloadArchive">;

export interface SyncDeps {
  db: Db;
  client: SyncClient;
  dataDir: string;
  retention: number;
  /** Removes secrets from text before it is stored or shown. */
  redact: (text: string) => string;
}

export type SyncStatus = "success" | "skipped" | "no-wiki" | "failed";

export interface SyncResult {
  status: SyncStatus;
  sha?: string;
  message?: string;
}

/** Directory holding the openwiki/ tree for one commit of one project. */
export function snapshotDir(dataDir: string, projectId: number, sha: string): string {
  return path.join(dataDir, String(projectId), sha);
}

/**
 * Fetch the default branch at its current head and store its `openwiki/`
 * tree as a snapshot. Commits that were already synced are skipped without a
 * download. A failure keeps the last successful snapshot in place.
 *
 * @param deps - Database, client, data directory and retention settings.
 * @param project - Project to sync.
 * @returns Outcome for this attempt.
 */
export async function syncProject(
  deps: SyncDeps,
  project: Project,
): Promise<SyncResult> {
  const { db, client, dataDir, retention, redact } = deps;
  const projectDir = path.join(dataDir, String(project.id));
  const workDir = path.join(projectDir, `.work-${randomUUID()}`);
  let headSha: string | undefined;

  try {
    const head = await client.defaultBranchHead(project.gitlabId ?? project.id);
    headSha = head.sha;
    recordHead(db, project.id, head.sha);
    const known = snapshotForSha(db, project.id, head.sha);
    if (known && (known.status === "success" || known.status === "no-wiki")) {
      return { status: "skipped", sha: head.sha };
    }

    recordSnapshot(db, project.id, head.sha, "running");
    await mkdir(workDir, { recursive: true });
    const archiveFile = path.join(workDir, "archive.tar.gz");
    const extractDir = path.join(workDir, "extract");
    await mkdir(extractDir);
    await writeFile(archiveFile, await client.downloadArchive(project.gitlabId ?? project.id, head.sha));
    await tar.x({ file: archiveFile, cwd: extractDir, strip: 1 });

    if (!existsSync(path.join(extractDir, "openwiki"))) {
      recordSnapshot(
        db,
        project.id,
        head.sha,
        "no-wiki",
        "No openwiki/ directory at this commit. Add the OpenWiki CI job to the repository.",
      );
      return {
        status: "no-wiki",
        sha: head.sha,
        message: "No openwiki/ directory at this commit.",
      };
    }

    const target = snapshotDir(dataDir, project.id, head.sha);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    await rename(path.join(extractDir, "openwiki"), path.join(target, "openwiki"));
    recordSnapshot(db, project.id, head.sha, "success");

    for (const sha of pruneSnapshots(db, project.id, retention)) {
      await rm(snapshotDir(dataDir, project.id, sha), { recursive: true, force: true });
    }
    return { status: "success", sha: head.sha };
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error));
    if (headSha) recordSnapshot(db, project.id, headSha, "failed", message);
    return { status: "failed", message };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

