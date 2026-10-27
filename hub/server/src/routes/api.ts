import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import * as tar from "tar";
import { z } from "zod";
import { PathError, resolveDocPath } from "../docs/resolve-path.js";
import { listDocPages } from "../docs/tree.js";
import type { HubDeps } from "../deps.js";
import { GitLabAuthError, GitLabError } from "../gitlab/client.js";
import {
  RefResolutionError,
  resolveSpecLabRef,
} from "../retrieval/ref-resolver.js";
import {
  searchSnapshots,
  type SearchableSnapshot,
} from "../retrieval/search.js";
import {
  addManualProject,
  deleteManualProject,
  getProject,
  listProjects,
  ProjectSourceError,
  setProjectEnabled,
  type Project,
} from "../store/projects.js";
import {
  latestSuccessfulSnapshot,
  listSnapshots,
  snapshotForSha,
} from "../store/snapshots.js";
import {
  snapshotDir,
  syncProject,
  type SyncDeps,
} from "../sync/sync-project.js";
import { runScanAll } from "../sync/scan-all.js";
import { wikiStaleness } from "../sync/staleness.js";
import { servedProjects, servedWiki } from "../wikis.js";

/** Value the web app sends in X-Requested-With on every API request. */
export const CSRF_HEADER_VALUE = "openwiki-hub";

const AddProjectBody = z.object({ url: z.string().min(1) });
const PatchProjectBody = z.object({ enabled: z.boolean() });
const SearchQuery = z.object({
  q: z.string().trim().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
const ProjectRefQuery = z.object({
  ref: z.string().trim().min(1),
  since: z.string().trim().min(1).optional(),
});
const GlobalRefQuery = z.object({
  ref: z.string().trim().min(1),
  project: z.string().trim().min(1).optional(),
  since: z.string().trim().min(1).optional(),
});

/**
 * Register the REST API used by the web app and by the review pipeline.
 *
 * @param app - Fastify instance.
 * @param deps - Shared database, GitLab client and queue.
 */
export function registerApiRoutes(app: FastifyInstance, deps: HubDeps): void {
  const { db, config, client, queue, redact } = deps;

  // Browsers cannot attach this header to a cross-site form post, and CORS is
  // not enabled, so requiring it blocks cross-site state changes.
  app.addHook("preHandler", async (request, reply) => {
    if (
      request.url.startsWith("/api/") &&
      request.method !== "GET" &&
      request.headers["x-requested-with"] !== CSRF_HEADER_VALUE
    ) {
      return reply
        .code(403)
        .send({ error: "Missing X-Requested-With header." });
    }
  });
  const syncDeps: SyncDeps = {
    db,
    client,
    dataDir: config.dataDir,
    retention: config.retention,
    redact,
  };

  const failureFor = (error: unknown) => {
    if (error instanceof GitLabAuthError) {
      return {
        status: 502,
        error: "GitLab rejected the access token. Check GITLAB_TOKEN.",
      };
    }
    if (error instanceof GitLabError)
      return { status: 502, error: error.message };
    throw error;
  };

  app.get("/api/projects", async () =>
    listProjects(db).map((project) => ({
      ...project,
      latest: latestSuccessfulSnapshot(db, project.id) ?? null,
    })),
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id",
    async (request, reply) => {
      const project = getProject(db, Number(request.params.id));
      if (!project) return reply.code(404).send({ error: "Unknown project." });
      const staleness = project.lastHeadSha
        ? await wikiStaleness({
            db,
            dataDir: config.dataDir,
            projectId: project.id,
            headSha: project.lastHeadSha,
            compare: (from, to) =>
              client.compareCount(project.gitlabId ?? project.id, from, to),
          }).catch((error: unknown) => ({ error: redact(String(error)) }))
        : null;
      return { ...project, staleness };
    },
  );

  app.post<{ Body: unknown }>("/api/projects", async (request, reply) => {
    const body = AddProjectBody.safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ error: "Body needs a url." });
    let target: URL;
    try {
      target = new URL(body.data.url);
    } catch {
      return reply.code(400).send({ error: "The url is not valid." });
    }
    const base = new URL(config.gitlabBaseUrl);
    if (target.origin !== base.origin) {
      return reply
        .code(400)
        .send({ error: `Only projects on ${base.origin} can be added.` });
    }
    const projectPath = target.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/, "");
    try {
      const found = await client.projectByPath(projectPath);
      const project = addManualProject(db, {
        path: found.path_with_namespace,
        webUrl: found.web_url,
        defaultBranch: found.default_branch ?? "main",
        gitlabId: found.id,
      });
      return reply.code(201).send(project);
    } catch (error) {
      const failure = failureFor(error);
      return reply.code(failure.status).send({ error: failure.error });
    }
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/projects/:id",
    async (request, reply) => {
      const body = PatchProjectBody.safeParse(request.body);
      if (!body.success)
        return reply.code(400).send({ error: "Body needs enabled: boolean." });
      const id = Number(request.params.id);
      if (!getProject(db, id))
        return reply.code(404).send({ error: "Unknown project." });
      setProjectEnabled(db, id, body.data.enabled);
      return getProject(db, id);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/projects/:id",
    async (request, reply) => {
      try {
        deleteManualProject(db, Number(request.params.id));
        return reply.code(204).send();
      } catch (error) {
        if (error instanceof ProjectSourceError) {
          return reply.code(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/projects/:id/scan",
    async (request, reply) => {
      const project = getProject(db, Number(request.params.id));
      if (!project) return reply.code(404).send({ error: "Unknown project." });
      return queue.run(() => syncProject(syncDeps, project));
    },
  );

  app.post("/api/scan-all", async (_request, reply) => {
    try {
      return reply.code(202).send(await runScanAll(deps));
    } catch (error) {
      const failure = failureFor(error);
      return reply.code(failure.status).send({ error: failure.error });
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/scans",
    async (request, reply) => {
      const project = getProject(db, Number(request.params.id));
      if (!project) return reply.code(404).send({ error: "Unknown project." });
      return listSnapshots(db, project.id);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/projects/:id/docs",
    async (request, reply) => {
      const project = getProject(db, Number(request.params.id));
      const served = project && servedWiki(deps, project);
      if (!served)
        return reply.code(404).send({ error: "No wiki for this project yet." });
      return {
        sha: served.latest.sha,
        pages: await listDocPages(path.join(served.root, "openwiki")),
      };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>(
    "/api/projects/:id/docs/file",
    async (request, reply) => {
      const project = getProject(db, Number(request.params.id));
      const served = project && servedWiki(deps, project);
      if (!served)
        return reply.code(404).send({ error: "No wiki for this project yet." });
      let file: string;
      try {
        file = resolveDocPath(served.root, request.query.path ?? "");
      } catch (error) {
        if (error instanceof PathError)
          return reply.code(400).send({ error: error.message });
        throw error;
      }
      const info = await stat(file).catch(() => undefined);
      if (!info?.isFile())
        return reply.code(404).send({ error: "Page not found." });
      return {
        path: request.query.path,
        sha: served.latest.sha,
        markdown: await readFile(file, "utf8"),
      };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { sha?: string } }>(
    "/api/projects/:id/context",
    async (request, reply) => {
      const project = getProject(db, Number(request.params.id));
      if (!project) return reply.code(404).send({ error: "Unknown project." });
      const sha = request.query.sha?.trim();
      if (!sha) return reply.code(400).send({ error: "Pass ?sha=<commit>." });
      const snapshot = snapshotForSha(db, project.id, sha);
      if (!snapshot || snapshot.status !== "success") {
        return reply.code(404).send({
          error: `Commit ${sha} is not synced as a wiki for this project.`,
        });
      }
      reply.header("content-type", "application/gzip");
      reply.header("x-openwiki-sha", sha);
      reply.header(
        "content-disposition",
        `attachment; filename="openwiki-${sha}.tar.gz"`,
      );
      return reply.send(
        tar.c(
          {
            gzip: true,
            cwd: snapshotDir(config.dataDir, project.id, sha),
            portable: true,
          },
          ["openwiki"],
        ),
      );
    },
  );

  app.get<{ Params: { id: string }; Querystring: { ref?: string; since?: string } }>(
    "/api/projects/:id/ref",
    async (request, reply) => {
      const query = ProjectRefQuery.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "Pass ?ref=<reference>." });
      }
      const projectId = Number(request.params.id);
      try {
        const result = await resolveSpecLabRef(deps, {
          ref: query.data.ref,
          project: projectId,
          since: query.data.since,
        });
        return result;
      } catch (error) {
        if (error instanceof RefResolutionError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get<{ Querystring: { ref?: string; project?: string; since?: string } }>(
    "/api/ref",
    async (request, reply) => {
      const query = GlobalRefQuery.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: "Pass ?ref=<reference>." });
      }
      try {
        const result = await resolveSpecLabRef(deps, {
          ref: query.data.ref,
          project: query.data.project,
          since: query.data.since,
        });
        return result;
      } catch (error) {
        if (error instanceof RefResolutionError) {
          return reply.code(error.statusCode).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.get<{ Querystring: { q?: string; limit?: string } }>(
    "/api/search",
    async (request, reply) => {
      const query = SearchQuery.safeParse(request.query);
      if (!query.success) {
        return reply
          .code(400)
          .send({ error: "Pass q (1–500 characters) and an optional limit." });
      }
      const snapshots: SearchableSnapshot[] = [];
      for (const project of listProjects(db)) {
        if (!project.enabled || project.archived) continue;
        const served = servedWiki(deps, project);
        if (served) {
          snapshots.push({
            projectId: project.id,
            projectPath: project.path,
            root: served.root,
          });
        }
      }
      return {
        hits: await searchSnapshots(snapshots, query.data.q, query.data.limit),
      };
    },
  );
}
