import { mkdirSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { sanitizeDiagnosticText } from "openwiki/diagnostics";
import type { HubConfig } from "./config.js";
import type { HubDeps, HubGitLab } from "./deps.js";
import { GitLabClient } from "./gitlab/client.js";
import { registerMcpRoute } from "./mcp/http.js";
import { registerWebhookRoute } from "./routes/webhook.js";
import { registerApiRoutes } from "./routes/api.js";
import { openDb } from "./store/db.js";
import { markInterruptedSnapshots } from "./store/snapshots.js";
import { SyncQueue } from "./sync/queue.js";

export interface BuildOptions {
  /** Replaces the real GitLab client, for tests. */
  client?: HubGitLab;
}

/**
 * Build a redaction function that removes the GitLab token from any text.
 * The shared sanitizer covers provider keys; the token is not in its list.
 *
 * @param token - GitLab access token to remove.
 * @returns Text transform.
 */
export function redactorFor(token: string): (text: string) => string {
  return (text) => {
    const sanitized = sanitizeDiagnosticText(text);
    return token ? sanitized.split(token).join("[REDACTED:GITLAB_TOKEN]") : sanitized;
  };
}

/**
 * Build the hub HTTP server with its database, queue and routes.
 *
 * Snapshots left in the `running` state by a previous crash are marked failed
 * before the first request is served.
 *
 * @param config - Validated hub configuration.
 * @param options - Optional replacements for external services.
 * @returns Fastify instance, not yet listening.
 */
export async function buildServer(
  config: HubConfig,
  options: BuildOptions = {},
): Promise<FastifyInstance> {
  mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(path.join(config.dataDir, "hub.sqlite"));
  markInterruptedSnapshots(db);

  const deps: HubDeps = {
    config,
    db,
    client:
      options.client ??
      new GitLabClient({ baseUrl: config.gitlabBaseUrl, token: config.gitlabToken }),
    queue: new SyncQueue(config.concurrency),
    redact: redactorFor(config.gitlabToken),
  };

  const app = Fastify({ logger: false });
  app.addHook("onClose", async () => {
    await deps.queue.drain();
    db.close();
  });
  app.get("/healthz", async () => ({ ok: true }));
  registerApiRoutes(app, deps);
  registerMcpRoute(app, deps);
  registerWebhookRoute(app, deps);
  app.decorate("hubDeps", deps);
  return app;
}
