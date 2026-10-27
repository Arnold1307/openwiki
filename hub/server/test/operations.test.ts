import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/index.ts";
import { openDb } from "../src/store/db.ts";
import { fakeGitLab, gitlabProject } from "./fakes.ts";
import { testConfig } from "./helpers.ts";

const apps: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

describe("restart recovery", () => {
  it("marks a sync that was running at shutdown as failed on the next start", async () => {
    const config = testConfig();
    const client = fakeGitLab({
      projects: [gitlabProject(7, "platform/core")],
    });

    const first = await buildServer(config, { client });
    const added = await first.inject({
      method: "POST",
      headers: { "x-requested-with": "openwiki-hub" },
      url: "/api/projects",
      payload: { url: "https://gitlab.test/platform/core" },
    });
    const id = added.json().id as number;
    // Simulate a crash mid-sync: a row left in the running state.
    const raw = openDb(path.join(config.dataDir, "hub.sqlite"));
    raw
      .prepare(
        "INSERT INTO snapshots (project_id, sha, status, synced_at) VALUES (?, 'crashed', 'running', ?)",
      )
      .run(id, new Date().toISOString());
    raw.close();
    await first.close();

    const second = await buildServer(config, { client });
    apps.push(second);
    const scans = await second.inject({
      method: "GET",
      url: `/api/projects/${id}/scans`,
    });
    expect(scans.json()[0]).toMatchObject({
      sha: "crashed",
      status: "failed",
      error: "interrupted by restart",
    });
  });
});

describe("web app delivery", () => {
  it("serves the built index for client-side routes but not for API paths", async () => {
    const webRoot = mkdtempSync(path.join(tmpdir(), "hub-web-"));
    mkdirSync(path.join(webRoot, "assets"));
    writeFileSync(
      path.join(webRoot, "index.html"),
      "<!doctype html><title>hub</title>",
    );
    writeFileSync(path.join(webRoot, "assets", "app.js"), "console.log(1)");
    expect(existsSync(path.join(webRoot, "index.html"))).toBe(true);

    const app = await buildServer(testConfig(), {
      client: fakeGitLab(),
      webRoot,
    });
    apps.push(app);

    const page = await app.inject({ method: "GET", url: "/verwaltung" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("<title>hub</title>");

    const asset = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(asset.statusCode).toBe(200);

    const api = await app.inject({ method: "GET", url: "/api/unknown-route" });
    expect(api.statusCode).toBe(404);
    expect(api.body).not.toContain("<title>hub</title>");
  });
});
