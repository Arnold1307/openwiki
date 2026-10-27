import { readFileSync } from "node:fs";
import path from "node:path";
import type { Db } from "../store/db.js";
import { latestSuccessfulSnapshot } from "../store/snapshots.js";
import { snapshotDir } from "./sync-project.js";

export interface StalenessInput {
  db: Db;
  dataDir: string;
  projectId: number;
  headSha: string;
  /** Number of commits from `from` to `to` (exclusive of `from`). */
  compare: (from: string, to: string) => Promise<number>;
}

export interface Staleness {
  /** Commit the served wiki was generated from, or null without a wiki. */
  documentedSha: string | null;
  /** Commits between the documented commit and HEAD, or null without a wiki. */
  commitsBehind: number | null;
}

/**
 * How far a project's served wiki lags behind the default branch.
 *
 * The documented commit comes from `gitHead` in the wiki's
 * `.last-update.json` when present; otherwise the snapshot's own commit is
 * used.
 *
 * @param input - Database, data directory, project, HEAD and a commit counter.
 * @returns Documented commit and commits behind HEAD.
 */
export async function wikiStaleness(input: StalenessInput): Promise<Staleness> {
  const latest = latestSuccessfulSnapshot(input.db, input.projectId);
  if (!latest) return { documentedSha: null, commitsBehind: null };

  const documentedSha =
    readGitHead(
      path.join(snapshotDir(input.dataDir, input.projectId, latest.sha), "openwiki"),
    ) ?? latest.sha;

  if (documentedSha === input.headSha) {
    return { documentedSha, commitsBehind: 0 };
  }
  return {
    documentedSha,
    commitsBehind: await input.compare(documentedSha, input.headSha),
  };
}

function readGitHead(openwikiDir: string): string | null {
  try {
    const raw = readFileSync(path.join(openwikiDir, ".last-update.json"), "utf8");
    const parsed = JSON.parse(raw) as { gitHead?: unknown };
    return typeof parsed.gitHead === "string" && parsed.gitHead ? parsed.gitHead : null;
  } catch {
    return null;
  }
}
