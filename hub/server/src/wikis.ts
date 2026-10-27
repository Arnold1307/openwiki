import type { HubDeps } from "./deps.js";
import type { Project } from "./store/projects.js";
import { listProjects } from "./store/projects.js";
import { latestSuccessfulSnapshot, type Snapshot } from "./store/snapshots.js";
import { snapshotDir } from "./sync/sync-project.js";

/** A project's currently served wiki: the newest successful snapshot. */
export interface ServedWiki {
  latest: Snapshot;
  /** Snapshot root; `openwiki/` lives directly below it. */
  root: string;
}

/**
 * The wiki a project serves right now, if any sync has succeeded.
 *
 * @param deps - Hub services.
 * @param project - Project to look up.
 * @returns Served wiki, or undefined when none exists yet.
 */
export function servedWiki(
  deps: HubDeps,
  project: Project,
): ServedWiki | undefined {
  const latest = latestSuccessfulSnapshot(deps.db, project.id);
  return latest
    ? { latest, root: snapshotDir(deps.config.dataDir, project.id, latest.sha) }
    : undefined;
}

/**
 * Enabled, non-archived projects that have a served wiki.
 *
 * @param deps - Hub services.
 * @returns Projects with their served wiki, ordered by path.
 */
export function servedProjects(
  deps: HubDeps,
): Array<{ project: Project; wiki: ServedWiki }> {
  const result: Array<{ project: Project; wiki: ServedWiki }> = [];
  for (const project of listProjects(deps.db)) {
    if (!project.enabled || project.archived) continue;
    const wiki = servedWiki(deps, project);
    if (wiki) result.push({ project, wiki });
  }
  return result;
}
