import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { HubDeps } from "../deps.js";
import { getProject } from "../store/projects.js";
import { syncProject, type SyncDeps } from "../sync/sync-project.js";

interface PushEvent {
  object_kind?: string;
  ref?: string;
  project?: { id?: number };
}

/** Constant-time comparison so the token cannot be guessed byte by byte. */
export function tokenMatches(received: string | undefined, expected: string): boolean {
  if (!received) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Accept GitLab push events. A push to a project's default branch queues one
 * sync for that project; other pushes are acknowledged and ignored.
 *
 * @param app - Fastify instance.
 * @param deps - Hub services.
 */
export function registerWebhookRoute(app: FastifyInstance, deps: HubDeps): void {
  const syncDeps: SyncDeps = {
    db: deps.db,
    client: deps.client,
    dataDir: deps.config.dataDir,
    retention: deps.config.retention,
    redact: deps.redact,
  };

  app.post<{ Body: PushEvent }>("/hooks/gitlab", async (request, reply) => {
    const token = request.headers["x-gitlab-token"];
    if (!tokenMatches(typeof token === "string" ? token : undefined, deps.config.webhookToken)) {
      return reply.code(401).send({ error: "Invalid webhook token." });
    }

    const event = request.body ?? {};
    if (event.object_kind !== "push" || typeof event.project?.id !== "number") {
      return reply.code(202).send({ ignored: true, reason: "not a push event" });
    }
    const project = listByGitlabId(deps, event.project.id);
    if (!project || !project.enabled || project.archived) {
      return reply.code(202).send({ ignored: true, reason: "unknown or inactive project" });
    }
    if (event.ref !== `refs/heads/${project.defaultBranch}`) {
      return reply.code(202).send({ ignored: true, reason: "not the default branch" });
    }

    void deps.queue.run(() => syncProject(syncDeps, project));
    return reply.code(202).send({ queued: true });
  });
}

function listByGitlabId(deps: HubDeps, gitlabId: number) {
  const row = deps.db
    .prepare("SELECT id FROM projects WHERE gitlab_id = ?")
    .get(gitlabId) as { id: number } | undefined;
  return row ? getProject(deps.db, row.id) : undefined;
}
