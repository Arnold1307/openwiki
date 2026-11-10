import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildServer } from "../src/index.ts";
import {
  normalizePagePath,
  parseSpecRef,
  renderPageWithSpecRef,
  upsertLocalPageWithSpecRef,
} from "../src/local/spec-ref-page.ts";
import { openDb } from "../src/store/db.ts";
import { CSRF_HEADER_VALUE } from "../src/routes/api.ts";
import { fakeGitLab } from "./fakes.ts";
import { testConfig } from "./helpers.ts";

const SPEC = {
  ref: "SPEC-GP-PASSWD",
  version: "1",
  checksum: "sha256:51a3b55918233b178c06474b5d42dd603131decb3c243716d34a3ea79f317085",
};

describe("spec_ref front matter", () => {
  it("renders and parses spec_ref", () => {
    const markdown = renderPageWithSpecRef(
      "Passwort zurücksetzen",
      "# Ziel\n\nReset per E-Mail.\n",
      SPEC,
    );
    expect(markdown).toContain("spec_ref:");
    expect(markdown).toContain("ref: SPEC-GP-PASSWD");
    expect(parseSpecRef(markdown)).toEqual(SPEC);
  });

  it("rejects unsafe page paths", () => {
    expect(() => normalizePagePath("../secret.md")).toThrow(/Page path/);
    expect(() => normalizePagePath("readme.txt")).toThrow(/Page path/);
  });
});

describe("upsertLocalPageWithSpecRef", () => {
  it("stores spec_ref on the page and reports changedSince", async () => {
    const config = testConfig();
    const db = openDb(path.join(config.dataDir, "hub.sqlite"));
    const first = await upsertLocalPageWithSpecRef({
      dataDir: config.dataDir,
      db,
      projectPath: "demo/passwd",
      page: "passwd-reset.md",
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      title: "Passwort zurücksetzen",
      body: "# Alt\n",
      specRef: SPEC,
    });
    expect(first.spec_ref).toEqual(SPEC);
    expect(parseSpecRef(first.markdown)).toEqual(SPEC);

    const second = await upsertLocalPageWithSpecRef({
      dataDir: config.dataDir,
      db,
      projectPath: "demo/passwd",
      page: "passwd-reset.md",
      sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      title: "Passwort zurücksetzen",
      body: "# Neu nach Merge\n",
      specRef: SPEC,
      changedSince: first.sha,
    });
    expect(second.changedSince).toBe(true);
    expect(parseSpecRef(second.markdown)).toEqual(SPEC);

    const onDisk = await readFile(
      path.join(
        config.dataDir,
        String(second.project.id),
        second.sha,
        "openwiki",
        "passwd-reset.md",
      ),
      "utf8",
    );
    expect(parseSpecRef(onDisk)).toEqual(SPEC);
  });
});

describe("POST /api/local/pages", () => {
  it("persists spec_ref via the local demo endpoint", async () => {
    const config = testConfig();
    const app = await buildServer(config, { client: fakeGitLab() });
    try {
      const created = await app.inject({
        method: "POST",
        headers: { "x-requested-with": CSRF_HEADER_VALUE },
        url: "/api/local/pages",
        payload: {
          projectPath: "demo/passwd",
          page: "passwd-reset.md",
          sha: "1c2833c70b55b8502092562c783f05cfeb08057b",
          title: "Passwort zurücksetzen",
          body: "Dokumentation der Demo-Umsetzung.\n",
          spec_ref: SPEC,
        },
      });
      expect(created.statusCode).toBe(201);
      const body = created.json() as {
        projectId: number;
        path: string;
        spec_ref: typeof SPEC;
        markdown: string;
      };
      expect(body.path).toBe("passwd-reset.md");
      expect(body.spec_ref).toEqual(SPEC);
      expect(parseSpecRef(body.markdown)).toEqual(SPEC);

      const file = await app.inject({
        method: "GET",
        url: `/api/projects/${body.projectId}/docs/file?path=passwd-reset.md`,
      });
      expect(file.statusCode).toBe(200);
      expect(parseSpecRef((file.json() as { markdown: string }).markdown)).toEqual(
        SPEC,
      );
    } finally {
      await app.close();
    }
  });
});
