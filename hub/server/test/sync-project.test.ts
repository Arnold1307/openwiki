import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.ts";
import { listProjects, syncDiscovery } from "../src/store/projects.ts";
import { latestSuccessfulSnapshot } from "../src/store/snapshots.ts";
import { syncProject, type SyncDeps } from "../src/sync/sync-project.ts";
import { testConfig } from "./helpers.ts";

/** Build a GitLab-style archive: one top-level directory, then the files. */
async function archive(
  files: Record<string, string>,
): Promise<Uint8Array> {
  const work = mkdtempSync(path.join(tmpdir(), "hub-archive-"));
  const top = path.join(work, "repo-abc");
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(top, name)), { recursive: true });
    writeFileSync(path.join(top, name), body);
  }
  const file = path.join(work, "archive.tar.gz");
  await tar.c({ gzip: true, file, cwd: work }, ["repo-abc"]);
  return new Uint8Array(readFileSync(file));
}

function setup(bytesFor: (sha: string) => Promise<Uint8Array>, sha = "sha-1") {
  const db = openDb(":memory:");
  const config = testConfig();
  syncDiscovery(db, [
    {
      id: 7,
      path_with_namespace: "platform/core",
      default_branch: "main",
      archived: false,
      web_url: "https://gitlab.test/platform/core",
    },
  ]);
  const project = listProjects(db)[0]!;
  let downloads = 0;
  const deps: SyncDeps = {
    db,
    dataDir: config.dataDir,
    retention: config.retention,
    client: {
      defaultBranchHead: async () => ({ branch: "main", sha }),
      downloadArchive: async (_id: number, s: string) => {
        downloads++;
        return bytesFor(s);
      },
    },
    redact: (text: string) => text,
  };
  return { deps, project, downloads: () => downloads };
}

describe("syncProject", () => {
  it("extracts openwiki/ for a new commit and records success", async () => {
    const bytes = await archive({ "openwiki/quickstart.md": "# Hi" });
    const { deps, project } = setup(async () => bytes);

    const result = await syncProject(deps, project);

    expect(result.status).toBe("success");
    const snapshot = path.join(
      deps.dataDir,
      String(project.id),
      "sha-1",
      "openwiki",
      "quickstart.md",
    );
    expect(existsSync(snapshot)).toBe(true);
    expect(latestSuccessfulSnapshot(deps.db, project.id)?.sha).toBe("sha-1");
  });

  it("skips a commit that was already synced without downloading", async () => {
    const bytes = await archive({ "openwiki/quickstart.md": "# Hi" });
    const { deps, project, downloads } = setup(async () => bytes);
    await syncProject(deps, project);

    const again = await syncProject(deps, project);

    expect(again.status).toBe("skipped");
    expect(downloads()).toBe(1);
  });

  it("reports no-wiki when the archive has no openwiki directory", async () => {
    const bytes = await archive({ "src/index.ts": "export {}" });
    const { deps, project } = setup(async () => bytes);

    const result = await syncProject(deps, project);

    expect(result.status).toBe("no-wiki");
    expect(result.message).toMatch(/openwiki/);
    expect(latestSuccessfulSnapshot(deps.db, project.id)).toBeUndefined();
  });

  it("keeps the last good snapshot when a download fails", async () => {
    const good = await archive({ "openwiki/quickstart.md": "# Good" });
    let fail = false;
    const { deps, project } = setup(async () => {
      if (fail) throw new Error("network down");
      return good;
    });
    await syncProject(deps, project);

    fail = true;
    const next = { ...deps, client: { ...deps.client, defaultBranchHead: async () => ({ branch: "main", sha: "sha-2" }) } };
    const result = await syncProject(next, project);

    expect(result.status).toBe("failed");
    expect(latestSuccessfulSnapshot(deps.db, project.id)?.sha).toBe("sha-1");
  });

  it("prunes snapshot directories beyond retention", async () => {
    const bytes = await archive({ "openwiki/quickstart.md": "# Hi" });
    const { deps, project } = setup(async () => bytes);
    deps.retention = 2;
    for (const sha of ["sha-1", "sha-2", "sha-3"]) {
      const next = { ...deps, client: { ...deps.client, defaultBranchHead: async () => ({ branch: "main", sha }) } };
      await syncProject(next, project);
    }
    expect(existsSync(path.join(deps.dataDir, String(project.id), "sha-1"))).toBe(false);
    expect(existsSync(path.join(deps.dataDir, String(project.id), "sha-3"))).toBe(true);
  });
});
