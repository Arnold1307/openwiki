import { describe, expect, it } from "vitest";
import { openDb } from "../src/store/db.ts";
import {
  addManualProject,
  deleteManualProject,
  listProjects,
  ProjectSourceError,
  syncDiscovery,
} from "../src/store/projects.ts";
import {
  latestSuccessfulSnapshot,
  pruneSnapshots,
  recordSnapshot,
} from "../src/store/snapshots.ts";

const found = (id: number, path: string) => ({
  id,
  path_with_namespace: path,
  default_branch: "main",
  archived: false,
  web_url: `https://gitlab.test/${path}`,
});

describe("project discovery", () => {
  it("creates new group projects as enabled and archives vanished ones", () => {
    const db = openDb(":memory:");
    syncDiscovery(db, [found(1, "platform/a"), found(2, "platform/b")]);

    const again = syncDiscovery(db, [found(1, "platform/a")]);

    expect(again.archived).toBe(1);
    const byPath = Object.fromEntries(
      listProjects(db).map((p) => [p.path, p]),
    );
    expect(byPath["platform/a"]).toMatchObject({
      source: "group",
      enabled: true,
      archived: false,
    });
    expect(byPath["platform/b"]).toMatchObject({ archived: true });
  });

  it("leaves manually added projects alone, even when discovery misses them", () => {
    const db = openDb(":memory:");
    addManualProject(db, {
      path: "external/tool",
      webUrl: "https://gitlab.test/external/tool",
      defaultBranch: "main",
      gitlabId: 99,
    });

    syncDiscovery(db, []);

    expect(listProjects(db)).toEqual([
      expect.objectContaining({ path: "external/tool", archived: false }),
    ]);
  });

  it("refuses to delete a group-sourced project", () => {
    const db = openDb(":memory:");
    syncDiscovery(db, [found(1, "platform/a")]);
    const [project] = listProjects(db);
    expect(() => deleteManualProject(db, project!.id)).toThrow(
      ProjectSourceError,
    );
  });
});

describe("snapshot retention", () => {
  it("keeps the newest snapshots and reports the removed shas", () => {
    const db = openDb(":memory:");
    syncDiscovery(db, [found(1, "platform/a")]);
    const [project] = listProjects(db);
    for (let i = 0; i < 25; i++) {
      recordSnapshot(db, project!.id, `sha${i}`, "success");
    }

    const removed = pruneSnapshots(db, project!.id, 20);

    expect(removed).toHaveLength(5);
    expect(removed).toContain("sha0");
    expect(latestSuccessfulSnapshot(db, project!.id)?.sha).toBe("sha24");
  });
});
