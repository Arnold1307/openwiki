import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/index.ts";
import { fakeGitLab, gitlabProject, makeArchive } from "./fakes.ts";
import { testConfig } from "./helpers.ts";

async function hubWithCounter() {
  const archive = await makeArchive({ "openwiki/quickstart.md": "# Hi\n" });
  const base = fakeGitLab({
    projects: [gitlabProject(7, "platform/core")],
    head: "sha-1",
    archive,
  });
  const headCalls = vi.fn(async () => ({ branch: "main", sha: "sha-1" }));
  const config = testConfig();
  const app = await buildServer(config, {
    client: { ...base, defaultBranchHead: headCalls },
  });
  await app.inject({
    method: "POST",
    url: "/api/projects",
    payload: { url: "https://gitlab.test/platform/core" },
  });
  return { app, config, headCalls };
}

const push = (ref: string) => ({
  object_kind: "push",
  ref,
  project: { id: 7 },
});

describe("GitLab push webhook", () => {
  it("rejects a missing or wrong token without syncing", async () => {
    const { app, config, headCalls } = await hubWithCounter();
    try {
      const missing = await app.inject({
        method: "POST",
        url: "/hooks/gitlab",
        payload: push("refs/heads/main"),
      });
      const wrong = await app.inject({
        method: "POST",
        url: "/hooks/gitlab",
        headers: { "x-gitlab-token": `${config.webhookToken}x` },
        payload: push("refs/heads/main"),
      });
      expect(missing.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(401);
      await app.hubDeps.queue.drain();
      expect(headCalls).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("queues exactly one sync for a push to the default branch", async () => {
    const { app, config, headCalls } = await hubWithCounter();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/hooks/gitlab",
        headers: { "x-gitlab-token": config.webhookToken },
        payload: push("refs/heads/main"),
      });
      expect(response.statusCode).toBe(202);
      expect(response.json()).toEqual({ queued: true });
      await app.hubDeps.queue.drain();
      expect(headCalls).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("ignores pushes to other branches", async () => {
    const { app, config, headCalls } = await hubWithCounter();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/hooks/gitlab",
        headers: { "x-gitlab-token": config.webhookToken },
        payload: push("refs/heads/feature/x"),
      });
      expect(response.json()).toMatchObject({ ignored: true });
      await app.hubDeps.queue.drain();
      expect(headCalls).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
