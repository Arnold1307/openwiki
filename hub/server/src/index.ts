import Fastify, { type FastifyInstance } from "fastify";
import type { HubConfig } from "./config.js";

/**
 * Build the hub HTTP server. Routes are registered here as they are added.
 *
 * @param config - Validated hub configuration.
 * @returns Fastify instance, not yet listening.
 */
export async function buildServer(config: HubConfig): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("hubConfig", config);

  app.get("/healthz", async () => ({ ok: true }));

  return app;
}
