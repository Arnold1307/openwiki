import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readSection,
  searchSnapshots,
  type SearchableSnapshot,
} from "../src/retrieval/search.ts";

function snapshot(projectId: number, pages: Record<string, string>): SearchableSnapshot {
  const root = mkdtempSync(path.join(tmpdir(), "hub-search-"));
  for (const [name, body] of Object.entries(pages)) {
    const file = path.join(root, "openwiki", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return { projectId, projectPath: `platform/p${projectId}`, root };
}

describe("searchSnapshots", () => {
  it("returns hits from several projects and names each project", async () => {
    const a = snapshot(1, {
      "quickstart.md": "# Quickstart\n\n## Retry handling\n\nRetries use exponential backoff.\n",
    });
    const b = snapshot(2, {
      "jobs.md": "# Jobs\n\n## Backoff\n\nJobs wait with exponential backoff too.\n",
    });

    const hits = await searchSnapshots([a, b], "exponential backoff", 10);

    expect(new Set(hits.map((hit) => hit.projectId))).toEqual(new Set([1, 2]));
    expect(hits.every((hit) => hit.ref.includes("#"))).toBe(true);
  });

  it("honours the limit across projects", async () => {
    const a = snapshot(1, {
      "one.md": "# One\n\n## Retry\n\nretry retry retry\n",
    });
    const b = snapshot(2, {
      "two.md": "# Two\n\n## Retry\n\nretry retry retry\n",
    });
    const hits = await searchSnapshots([a, b], "retry", 1);
    expect(hits).toHaveLength(1);
  });

  it("returns no hits for a snapshot without an openwiki directory", async () => {
    const empty = mkdtempSync(path.join(tmpdir(), "hub-empty-"));
    const hits = await searchSnapshots(
      [{ projectId: 3, projectPath: "platform/p3", root: empty }],
      "anything",
      5,
    );
    expect(hits).toEqual([]);
  });
});

describe("readSection", () => {
  it("returns the complete section named by a search ref", async () => {
    const a = snapshot(1, {
      "quickstart.md": "# Quickstart\n\n## Retry handling\n\nRetries use exponential backoff.\n",
    });
    const [hit] = await searchSnapshots([a], "exponential backoff", 1);
    const [page, anchor] = hit!.ref.split("#") as [string, string];

    const section = await readSection(a.root, page, anchor);

    expect(section.sections[0]?.content).toContain("exponential backoff");
  });
});
