import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildServer } from "../src/index.ts";
import { makeArchive, fakeGitLab, gitlabProject } from "./fakes.ts";
import { testConfig } from "./helpers.ts";

const WIKI = {
  "openwiki/quickstart.md":
    "# Quickstart\n\n## Retry handling\n\nRetries use exponential backoff.\n",
  "openwiki/architecture/jobs.md":
    "# Jobs\n\n## Queue\n\nJobs run in a queue.\n",
};

async function hubWith(archive?: Uint8Array, rejectToken = false) {
  const config = testConfig();
  const client = fakeGitLab({
    projects: [gitlabProject(7, "platform/core")],
    head: "sha-1",
    archive,
    rejectToken,
  });
  const app = await buildServer(config, { client });
  return { app, config };
}

async function listed(app: Awaited<ReturnType<typeof buildServer>>) {
  const response = await app.inject({ method: "GET", url: "/api/projects" });
  return response.json() as Array<{ id: number; path: string; source: string }>;
}

describe("project API", () => {
  it("adds a project by URL on the configured host only", async () => {
    const { app } = await hubWith();
    try {
      const ok = await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: "/api/projects",
        payload: { url: "https://gitlab.test/platform/core" },
      });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject({
        path: "platform/core",
        source: "manual",
      });

      const foreign = await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: "/api/projects",
        payload: { url: "https://github.com/x/y" },
      });
      expect(foreign.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("refuses to delete a group project but deletes a manual one", async () => {
    const { app } = await hubWith();
    try {
      await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: "/api/scan-all",
      });
      const [group] = (await listed(app)).filter((p) => p.source === "group");
      expect(
        (
          await app.inject({
            method: "DELETE",
            headers: { "x-requested-with": "openwiki-hub" },
            url: `/api/projects/${group!.id}`,
          })
        ).statusCode,
      ).toBe(409);

      const created = await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: "/api/projects",
        payload: { url: "https://gitlab.test/platform/core" },
      });
      expect(created.statusCode).toBe(201);
    } finally {
      await app.close();
    }
  });

  it("reports a rejected token without echoing it", async () => {
    const { app, config } = await hubWith(undefined, true);
    try {
      const response = await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: "/api/scan-all",
      });
      expect(response.statusCode).toBe(502);
      expect(response.body).toMatch(/GITLAB_TOKEN/);
      expect(response.body).not.toContain(config.gitlabToken);
    } finally {
      await app.close();
    }
  });
});

describe("docs, context and search", () => {
  it("serves pages, rejects traversal, and answers search across projects", async () => {
    const archive = await makeArchive(WIKI);
    const { app } = await hubWith(archive);
    try {
      const added = await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: "/api/projects",
        payload: { url: "https://gitlab.test/platform/core" },
      });
      const project = added.json() as { id: number };
      const scan = await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: `/api/projects/${project.id}/scan`,
      });
      expect(scan.json()).toMatchObject({ status: "success", sha: "sha-1" });

      const page = await app.inject({
        method: "GET",
        url: `/api/projects/${project!.id}/docs/file?path=quickstart.md`,
      });
      expect(page.statusCode).toBe(200);
      expect(page.json().markdown).toContain("Retry handling");

      const traversal = await app.inject({
        method: "GET",
        url: `/api/projects/${project!.id}/docs/file?path=..%2F..%2Fsecret.txt`,
      });
      expect(traversal.statusCode).toBe(400);

      const search = await app.inject({
        method: "GET",
        url: "/api/search?q=exponential%20backoff",
      });
      expect(search.json().hits[0]).toMatchObject({
        projectId: project!.id,
        projectPath: "platform/core",
      });
    } finally {
      await app.close();
    }
  });

  it("returns 404 for a commit that was never synced", async () => {
    const archive = await makeArchive(WIKI);
    const { app } = await hubWith(archive);
    try {
      await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: "/api/scan-all",
      });
      const [project] = await listed(app);
      await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: `/api/projects/${project!.id}/scan`,
      });

      const missing = await app.inject({
        method: "GET",
        url: `/api/projects/${project!.id}/context?sha=unknown`,
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json().error).toMatch(/not synced/);

      const known = await app.inject({
        method: "GET",
        url: `/api/projects/${project!.id}/context?sha=sha-1`,
      });
      const repeated = await app.inject({
        method: "GET",
        url: `/api/projects/${project!.id}/context?sha=sha-1`,
      });
      expect(known.statusCode).toBe(200);
      expect(known.headers["x-openwiki-sha"]).toBe("sha-1");
      expect(repeated.headers["x-openwiki-sha"]).toBe("sha-1");
      expect(repeated.rawPayload).toEqual(known.rawPayload);
      expect(createHash("sha256").update(known.rawPayload).digest("hex")).toBe(
        createHash("sha256").update(repeated.rawPayload).digest("hex"),
      );
    } finally {
      await app.close();
    }
  });
});

describe("CSRF guard", () => {
  it("requires the X-Requested-With header on state-changing API calls", async () => {
    const { app } = await hubWith();
    try {
      const blocked = await app.inject({
        method: "POST",
        url: "/api/projects",
        payload: { url: "https://gitlab.test/platform/core" },
      });
      expect(blocked.statusCode).toBe(403);

      const allowed = await app.inject({
        method: "POST",
        url: "/api/projects",
        headers: { "x-requested-with": "openwiki-hub" },
        payload: { url: "https://gitlab.test/platform/core" },
      });
      expect(allowed.statusCode).toBe(201);

      const reads = await app.inject({ method: "GET", url: "/api/projects" });
      expect(reads.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
