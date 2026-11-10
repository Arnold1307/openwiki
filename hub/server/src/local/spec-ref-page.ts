import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PathError, resolveDocPath } from "../docs/resolve-path.js";
import type { Db } from "../store/db.js";
import {
  addManualProject,
  getProject,
  recordHead,
  type Project,
} from "../store/projects.js";
import { recordSnapshot } from "../store/snapshots.js";
import { snapshotDir } from "../sync/sync-project.js";

/** Spec reference stored in OpenWiki page front matter. */
export interface SpecRef {
  ref: string;
  version: string;
  checksum: string;
}

export interface UpsertLocalPageInput {
  dataDir: string;
  db: Db;
  projectPath: string;
  page: string;
  sha: string;
  title: string;
  body: string;
  specRef: SpecRef;
  /** Previous commit to compare against for changedSince. */
  changedSince?: string;
}

export interface UpsertLocalPageResult {
  project: Project;
  sha: string;
  path: string;
  spec_ref: SpecRef;
  markdown: string;
  changedSince: boolean | null;
}

/**
 * Normalize a client page path to a relative openwiki path (forward slashes).
 *
 * @param page - Requested page path.
 * @returns Relative path under openwiki/.
 * @throws {PathError} When the path is empty or unsafe.
 */
export function normalizePagePath(page: string): string {
  const trimmed = page.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !trimmed ||
    !trimmed.toLowerCase().endsWith(".md") ||
    trimmed.includes("\0") ||
    path.posix.isAbsolute(trimmed) ||
    path.win32.isAbsolute(trimmed) ||
    trimmed.split("/").includes("..")
  ) {
    throw new PathError("Page path must be a .md file inside openwiki/.");
  }
  return trimmed;
}

/**
 * Build Markdown with YAML front matter that includes `spec_ref`.
 *
 * @param title - Page title.
 * @param body - Markdown body without front matter.
 * @param specRef - Spec reference to store.
 * @returns Full page Markdown.
 */
export function renderPageWithSpecRef(
  title: string,
  body: string,
  specRef: SpecRef,
): string {
  const safeTitle = title.replace(/[\r\n]/g, " ").trim() || "Untitled";
  const bodyText = body.replace(/^\uFEFF/, "").replace(/^\s+/, "");
  return [
    "---",
    `title: ${yamlScalar(safeTitle)}`,
    "spec_ref:",
    `  ref: ${yamlScalar(specRef.ref)}`,
    `  version: ${yamlScalar(specRef.version)}`,
    `  checksum: ${yamlScalar(specRef.checksum)}`,
    "---",
    "",
    bodyText.endsWith("\n") ? bodyText : `${bodyText}\n`,
  ].join("\n");
}

/**
 * Read `spec_ref` from page front matter when present.
 *
 * @param markdown - Full page content.
 * @returns Spec reference, or null when missing/invalid.
 */
export function parseSpecRef(markdown: string): SpecRef | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) return null;
  const block = match[1] ?? "";
  const lines = block.split(/\r?\n/);
  let inSpec = false;
  const values: Record<string, string> = {};
  for (const line of lines) {
    if (/^spec_ref:\s*$/.test(line)) {
      inSpec = true;
      continue;
    }
    if (inSpec) {
      if (/^\S/.test(line)) {
        inSpec = false;
      } else {
        const field = /^\s+(ref|version|checksum):\s*(.+)\s*$/.exec(line);
        if (field) {
          values[field[1]!] = unquote(field[2]!);
        }
        continue;
      }
    }
  }
  if (!values.ref || !values.version || !values.checksum) return null;
  return {
    ref: values.ref,
    version: values.version,
    checksum: values.checksum,
  };
}

/**
 * Ensure a local manual project exists, write a wiki page with `spec_ref`,
 * and record a successful snapshot for the given commit.
 *
 * @param input - Project, page, sha, body and spec reference.
 * @returns Stored project, page path, markdown and changedSince flag.
 */
export async function upsertLocalPageWithSpecRef(
  input: UpsertLocalPageInput,
): Promise<UpsertLocalPageResult> {
  const pagePath = normalizePagePath(input.page);
  const sha = input.sha.trim().toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(sha)) {
    throw new PathError("sha must be a hex commit id.");
  }

  const projectPath = input.projectPath.trim().replace(/^\/+|\/+$/g, "");
  if (!projectPath || projectPath.split("/").includes("..")) {
    throw new PathError("projectPath is invalid.");
  }

  const project = addManualProject(input.db, {
    path: projectPath,
    webUrl: `local://${projectPath}`,
    defaultBranch: "main",
  });

  const markdown = renderPageWithSpecRef(input.title, input.body, input.specRef);
  const root = snapshotDir(input.dataDir, project.id, sha);
  const absolute = resolveDocPath(root, pagePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, markdown, "utf8");

  recordSnapshot(input.db, project.id, sha, "success");
  recordHead(input.db, project.id, sha);

  let changedSince: boolean | null = null;
  const baseline = input.changedSince?.trim().toLowerCase();
  if (baseline) {
    if (!/^[0-9a-f]{7,64}$/.test(baseline)) {
      throw new PathError("changedSince must be a hex commit id.");
    }
    if (baseline === sha) {
      changedSince = false;
    } else {
      const previousRoot = snapshotDir(input.dataDir, project.id, baseline);
      try {
        const previousPath = resolveDocPath(previousRoot, pagePath);
        const previous = await readFile(previousPath, "utf8");
        changedSince = previous !== markdown;
      } catch {
        changedSince = true;
      }
    }
  }

  return {
    project: getProject(input.db, project.id)!,
    sha,
    path: pagePath,
    spec_ref: input.specRef,
    markdown,
    changedSince,
  };
}

function yamlScalar(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed.startsWith("'") ? `"${trimmed.slice(1, -1)}"` : trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}
