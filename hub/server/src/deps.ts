import type { GitLabClient, GitLabProject } from "./gitlab/client.js";
import type { HubConfig } from "./config.js";
import type { Db } from "./store/db.js";
import type { SyncQueue } from "./sync/queue.js";
import type { SyncClient } from "./sync/sync-project.js";

/** Every GitLab call the hub makes; tests substitute a fake. */
export type HubGitLab = SyncClient &
  Pick<GitLabClient, "listGroupProjects" | "projectByPath" | "compareCount">;

/** Shared services handed to route handlers and background jobs. */
export interface HubDeps {
  config: HubConfig;
  db: Db;
  client: HubGitLab;
  queue: SyncQueue;
  /** Removes secrets from any text that leaves the server. */
  redact: (text: string) => string;
}

export type { GitLabProject };
