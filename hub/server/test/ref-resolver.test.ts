import { describe, expect, it } from "vitest";
import {
  parseSpecLabRef,
  RefResolutionError,
  resolveSpecLabRef,
} from "../src/retrieval/ref-resolver.ts";
import { buildServer } from "../src/index.ts";
import { fakeGitLab, gitlabProject, makeArchive } from "./fakes.ts";
import { testConfig } from "./helpers.ts";

describe("parseSpecLabRef", () => {
  it("parses full ref with project, page, anchor and sha", () => {
    const parsed = parseSpecLabRef(
      "platform/core/openwiki/architecture/jobs.md#retry-control@a1b2c3d",
    );
    expect(parsed).toEqual({
      raw: "platform/core/openwiki/architecture/jobs.md#retry-control@a1b2c3d",
      projectPath: "platform/core",
      page: "openwiki/architecture/jobs.md",
      anchor: "retry-control",
      sha: "a1b2c3d",
    });
  });

  it("parses ref with nested groups and namespaces", () => {
    const parsed = parseSpecLabRef(
      "org/subgroup/app/openwiki/quickstart.md#setup@sha-456",
    );
    expect(parsed.projectPath).toBe("org/subgroup/app");
    expect(parsed.page).toBe("openwiki/quickstart.md");
    expect(parsed.anchor).toBe("setup");
    expect(parsed.sha).toBe("sha-456");
  });

  it("parses ref without project prefix", () => {
    const parsed = parseSpecLabRef(
      "openwiki/quickstart.md#retry-handling@sha-1",
    );
    expect(parsed.projectPath).toBeUndefined();
    expect(parsed.page).toBe("openwiki/quickstart.md");
    expect(parsed.anchor).toBe("retry-handling");
    expect(parsed.sha).toBe("sha-1");
  });

  it("parses ref without anchor", () => {
    const parsed = parseSpecLabRef("openwiki/quickstart.md@sha-1");
    expect(parsed.anchor).toBeUndefined();
    expect(parsed.sha).toBe("sha-1");
    expect(parsed.page).toBe("openwiki/quickstart.md");
  });

  it("parses ref without sha", () => {
    const parsed = parseSpecLabRef("openwiki/quickstart.md#retry-handling");
    expect(parsed.anchor).toBe("retry-handling");
    expect(parsed.sha).toBeUndefined();
    expect(parsed.page).toBe("openwiki/quickstart.md");
  });

  it("normalizes page missing 'openwiki/' prefix and '.md' extension", () => {
    const parsed = parseSpecLabRef("architecture/overview");
    expect(parsed.page).toBe("openwiki/architecture/overview.md");
  });

  it("rejects empty ref or invalid sha", () => {
    expect(() => parseSpecLabRef("")).toThrow(RefResolutionError);
    expect(() => parseSpecLabRef("openwiki/quickstart.md@")).toThrow(
      RefResolutionError,
    );
    expect(() => parseSpecLabRef("openwiki/quickstart.md@invalid!sha")).toThrow(
      RefResolutionError,
    );
    expect(() => parseSpecLabRef("openwiki/quickstart.md#")).toThrow(
      RefResolutionError,
    );
  });
});

const WIKI_V1 = {
  "openwiki/quickstart.md":
    "# Quickstart\n\n## Retry handling\n\nRetries use exponential backoff.\n\n## Other\n\nSome other content.\n",
};

const WIKI_V2 = {
  "openwiki/quickstart.md":
    "# Quickstart\n\n## Retry handling\n\nRetries use linear backoff with jitter.\n\n## Other\n\nSome other content.\n",
};

async function createTestHub(
  projectPath: string,
  v1Archive: Uint8Array,
  v2Archive: Uint8Array,
) {
  let currentHead = "sha-v1";
  let currentArchive = v1Archive;

  const config = testConfig();
  const client = fakeGitLab({
    projects: [gitlabProject(42, projectPath)],
    head: currentHead,
    archive: currentArchive,
  });

  // Override dynamically for multi-version tests
  client.defaultBranchHead = async () => ({
    branch: "main",
    sha: currentHead,
  });
  client.downloadArchive = async () => currentArchive;

  const app = await buildServer(config, { client });

  return {
    app,
    config,
    setVersion: (sha: string, archive: Uint8Array) => {
      currentHead = sha;
      currentArchive = archive;
    },
  };
}

describe("resolveSpecLabRef", () => {
  it("resolves ref with exact sha, anchor, and computes changedSince", async () => {
    const v1 = await makeArchive(WIKI_V1);
    const v2 = await makeArchive(WIKI_V2);
    const { app, setVersion } = await createTestHub("sdlc/service", v1, v2);

    try {
      // 1. Sync v1
      await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: "/api/scan-all",
      });
      const [proj] = (
        await (await app.inject({ method: "GET", url: "/api/projects" })).json()
      ) as Array<{ id: number; path: string }>;

      await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: `/api/projects/${proj!.id}/scan`,
      });

      // 2. Query ref pointing to sha-v1 (only v1 synced so far)
      const resV1 = await app.inject({
        method: "GET",
        url: `/api/projects/${proj!.id}/ref?ref=openwiki/quickstart.md%23retry-handling@sha-v1`,
      });
      expect(resV1.statusCode).toBe(200);
      const dataV1 = resV1.json();
      expect(dataV1.content).toContain("exponential backoff");
      expect(dataV1.sha).toBe("sha-v1");
      expect(dataV1.anchor).toBe("retry-handling");
      expect(dataV1.changedSince).toBe(false);

      // 3. Sync v2 (content changes under retry-handling)
      setVersion("sha-v2", v2);
      await app.inject({
        method: "POST",
        headers: { "x-requested-with": "openwiki-hub" },
        url: `/api/projects/${proj!.id}/scan`,
      });

      // 4. Query ref pinned to @sha-v1 again: should report changedSince = true!
      const resV1AfterV2 = await app.inject({
        method: "GET",
        url: `/api/projects/${proj!.id}/ref?ref=openwiki/quickstart.md%23retry-handling@sha-v1`,
      });
      expect(resV1AfterV2.statusCode).toBe(200);
      const dataV1AfterV2 = resV1AfterV2.json();
      expect(dataV1AfterV2.content).toContain("exponential backoff");
      expect(dataV1AfterV2.sha).toBe("sha-v1");
      expect(dataV1AfterV2.latestSha).toBe("sha-v2");
      expect(dataV1AfterV2.changedSince).toBe(true);

      // 5. Query an unchanged section: 'Other'
      const resOther = await app.inject({
        method: "GET",
        url: `/api/projects/${proj!.id}/ref?ref=openwiki/quickstart.md%23other@sha-v1`,
      });
      expect(resOther.statusCode).toBe(200);
      expect(resOther.json().changedSince).toBe(false);

      // 6. Test global /api/ref endpoint with embedded project path
      const globalRes = await app.inject({
        method: "GET",
        url: `/api/ref?ref=sdlc/service/openwiki/quickstart.md%23retry-handling@sha-v2`,
      });
      expect(globalRes.statusCode).toBe(200);
      expect(globalRes.json().content).toContain("linear backoff with jitter");
      expect(globalRes.json().changedSince).toBe(false);

      // 7. Test query with explicit ?since=sha-v1
      const sinceRes = await app.inject({
        method: "GET",
        url: `/api/ref?ref=sdlc/service/openwiki/quickstart.md%23retry-handling@sha-v2&since=sha-v1`,
      });
      expect(sinceRes.statusCode).toBe(200);
      expect(sinceRes.json().changedSince).toBe(true);

      // 8. Error cases: unknown commit, unknown anchor, path traversal
      const missingSha = await app.inject({
        method: "GET",
        url: `/api/projects/${proj!.id}/ref?ref=openwiki/quickstart.md@nonexistent`,
      });
      expect(missingSha.statusCode).toBe(404);

      const missingAnchor = await app.inject({
        method: "GET",
        url: `/api/projects/${proj!.id}/ref?ref=openwiki/quickstart.md%23unknown-heading@sha-v1`,
      });
      expect(missingAnchor.statusCode).toBe(404);

      const traversal = await app.inject({
        method: "GET",
        url: `/api/projects/${proj!.id}/ref?ref=..%2Fsecret.txt@sha-v1`,
      });
      expect(traversal.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
