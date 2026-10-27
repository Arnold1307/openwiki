import type { HubDeps } from "../deps.js";
import { syncDiscovery, listProjects } from "../store/projects.js";
import { syncProject, type SyncDeps } from "./sync-project.js";

/**
 * Discover projects in the configured groups, then queue a sync for every
 * enabled, non-archived project. Syncs run in the background; the returned
 * counts describe the discovery, not the syncs.
 *
 * @param deps - Hub services.
 * @returns Discovery changes and the number of queued syncs.
 * @throws When GitLab discovery fails; the caller maps the error.
 */
export async function runScanAll(
  deps: HubDeps,
): Promise<{ created: number; archived: number; queued: number }> {
  const discovered = (
    await Promise.all(deps.config.groups.map((group) => deps.client.listGroupProjects(group)))
  ).flat();
  const changes = syncDiscovery(deps.db, discovered);
  const syncDeps: SyncDeps = {
    db: deps.db,
    client: deps.client,
    dataDir: deps.config.dataDir,
    retention: deps.config.retention,
    redact: deps.redact,
  };
  const active = listProjects(deps.db).filter((p) => p.enabled && !p.archived);
  for (const project of active) {
    void deps.queue.run(() => syncProject(syncDeps, project));
  }
  return { ...changes, queued: active.length };
}
