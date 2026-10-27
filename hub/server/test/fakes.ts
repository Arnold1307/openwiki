import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as tar from "tar";
import { GitLabAuthError, type GitLabProject } from "../src/gitlab/client.js";
import type { HubGitLab } from "../src/deps.js";

/** Build a GitLab-style archive: one top-level directory, then the files. */
export async function makeArchive(files: Record<string, string>): Promise<Uint8Array> {
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

export interface FakeGitLabOptions {
  projects?: GitLabProject[];
  head?: string;
  archive?: Uint8Array;
  rejectToken?: boolean;
}

/** In-memory GitLab stand-in. Records nothing beyond what tests assert on. */
export function fakeGitLab(options: FakeGitLabOptions = {}): HubGitLab {
  const projects = options.projects ?? [];
  const head = options.head ?? "head-sha";
  return {
    listGroupProjects: async () => {
      if (options.rejectToken) throw new GitLabAuthError(401);
      return projects;
    },
    projectByPath: async (projectPath: string) => {
      const found = projects.find((p) => p.path_with_namespace === projectPath);
      if (!found) throw new Error(`no project ${projectPath}`);
      return found;
    },
    defaultBranchHead: async () => ({ branch: "main", sha: head }),
    downloadArchive: async () => options.archive ?? new Uint8Array(),
    compareCount: async () => 3,
  };
}

export function gitlabProject(id: number, pathWithNamespace: string): GitLabProject {
  return {
    id,
    path_with_namespace: pathWithNamespace,
    default_branch: "main",
    archived: false,
    web_url: `https://gitlab.test/${pathWithNamespace}`,
  };
}
