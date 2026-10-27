import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { wikiStaleness } from "../src/sync/staleness.ts";
import { openDb } from "../src/store/db.ts";
import { listProjects, syncDiscovery } from "../src/store/projects.ts";
import { recordSnapshot } from "../src/store/snapshots.ts";

function projectWithSnapshot(sha: string | null, gitHead?: string) {
  const db = openDb(":memory:");
  const dataDir = mkdtempSync(path.join(tmpdir(), "hub-stale-"));
  syncDiscovery(db, [
    {
      id: 1,
      path_with_namespace: "platform/core",
      default_branch: "main",
      archived: false,
      web_url: "https://gitlab.test/platform/core",
    },
  ]);
  const project = listProjects(db)[0]!;
  if (sha) {
    recordSnapshot(db, project.id, sha, "success");
    if (gitHead) {
      const dir = path.join(dataDir, String(project.id), sha, "openwiki");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, ".last-update.json"),
        JSON.stringify({ gitHead }),
      );
    }
  }
  return { db, dataDir, project };
}

describe("wikiStaleness", () => {
  it("reports no wiki when nothing was synced", async () => {
    const { db, dataDir, project } = projectWithSnapshot(null);
    const compare = vi.fn();
    const result = await wikiStaleness({
      db,
      dataDir,
      projectId: project.id,
      headSha: "head",
      compare,
    });
    expect(result).toEqual({ documentedSha: null, commitsBehind: null });
    expect(compare).not.toHaveBeenCalled();
  });

  it("reports zero commits behind when the wiki matches HEAD", async () => {
    const { db, dataDir, project } = projectWithSnapshot("head", "head");
    const result = await wikiStaleness({
      db,
      dataDir,
      projectId: project.id,
      headSha: "head",
      compare: async () => 99,
    });
    expect(result.commitsBehind).toBe(0);
  });

  it("compares the commit recorded in .last-update.json with HEAD", async () => {
    const { db, dataDir, project } = projectWithSnapshot("snap", "documented");
    const compare = vi.fn(async () => 4);
    const result = await wikiStaleness({
      db,
      dataDir,
      projectId: project.id,
      headSha: "head",
      compare,
    });
    expect(compare).toHaveBeenCalledWith("documented", "head");
    expect(result).toEqual({ documentedSha: "documented", commitsBehind: 4 });
  });

  it("falls back to the snapshot commit when no metadata file exists", async () => {
    const { db, dataDir, project } = projectWithSnapshot("snap");
    const compare = vi.fn(async () => 2);
    const result = await wikiStaleness({
      db,
      dataDir,
      projectId: project.id,
      headSha: "head",
      compare,
    });
    expect(compare).toHaveBeenCalledWith("snap", "head");
    expect(result.commitsBehind).toBe(2);
  });
});
