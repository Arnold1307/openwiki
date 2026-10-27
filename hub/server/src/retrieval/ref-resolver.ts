import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { HubDeps } from "../deps.js";
import { PathError, resolveDocPath } from "../docs/resolve-path.js";
import { getProject, getProjectByPath, type Project } from "../store/projects.js";
import { latestSuccessfulSnapshot, snapshotForSha } from "../store/snapshots.js";
import { snapshotDir } from "../sync/sync-project.js";
import { readSection } from "./search.js";

/** Error raised when a SpecLab reference cannot be parsed or resolved. */
export class RefResolutionError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 404) {
    super(message);
    this.name = "RefResolutionError";
    this.statusCode = statusCode;
  }
}

/** Components of a parsed SpecLab reference. */
export interface ParsedSpecLabRef {
  /** The full raw reference string. */
  raw: string;
  /** Optional project path if embedded in the reference string. */
  projectPath?: string;
  /** Canonical page path with leading "openwiki/". */
  page: string;
  /** Section heading anchor slug (without '#'). */
  anchor?: string;
  /** Commit SHA (without '@'). */
  sha?: string;
}

/** Options for resolving a SpecLab reference. */
export interface ResolveRefOptions {
  /** The reference string in the form `[<project>/]openwiki/<page.md>[#<anchor>][@<sha>]`. */
  ref: string;
  /** Optional project identifier (ID or path) if not embedded in the reference string. */
  project?: string | number;
  /** Optional baseline commit SHA to compare against for `changedSince`. */
  since?: string;
}

/** Result of resolving a SpecLab reference. */
export interface ResolvedSpecLabRef {
  /** The input reference. */
  ref: string;
  /** Numeric ID of the resolved project. */
  projectId: number;
  /** Path of the resolved project with namespace (e.g. "platform/core"). */
  projectPath: string;
  /** Canonical page path (e.g. "openwiki/quickstart.md"). */
  page: string;
  /** Resolved anchor or null if referencing the entire page. */
  anchor: string | null;
  /** Exact commit SHA the content was resolved at. */
  sha: string;
  /** Newest available successful commit SHA for this project. */
  latestSha: string;
  /** Markdown text of the resolved section or full page. */
  content: string;
  /**
   * Whether the referenced content has changed since the pinned SHA (or specified baseline).
   * Evaluated by comparing the resolved content against the baseline snapshot.
   */
  changedSince: boolean;
}

/**
 * Parse a SpecLab reference string into its structural components.
 *
 * Supported formats:
 * - `openwiki/architecture/jobs.md#retry-control@a1b2c3d`
 * - `platform/core/openwiki/architecture/jobs.md#retry-control@a1b2c3d`
 * - `openwiki/quickstart.md@sha-1`
 * - `openwiki/quickstart.md#installation`
 * - `architecture/overview.md` (normalized to `openwiki/architecture/overview.md`)
 *
 * @param ref - Raw reference string.
 * @returns Parsed reference structure.
 * @throws {RefResolutionError} If the format is invalid.
 */
export function parseSpecLabRef(ref: string): ParsedSpecLabRef {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new RefResolutionError("Reference string cannot be empty.", 400);
  }

  let remainder = trimmed;
  let sha: string | undefined;
  let anchor: string | undefined;

  // 1. Extract @<sha> from the end if present
  const atIdx = remainder.lastIndexOf("@");
  if (atIdx !== -1) {
    const candidateSha = remainder.slice(atIdx + 1).trim();
    if (!candidateSha || !/^[a-zA-Z0-9_.-]+$/.test(candidateSha)) {
      throw new RefResolutionError(
        `Invalid commit SHA in reference: "${candidateSha}".`,
        400,
      );
    }
    sha = candidateSha;
    remainder = remainder.slice(0, atIdx).trim();
  }

  // 2. Extract #<anchor> if present
  const hashIdx = remainder.indexOf("#");
  if (hashIdx !== -1) {
    const candidateAnchor = remainder.slice(hashIdx + 1).trim();
    if (!candidateAnchor) {
      throw new RefResolutionError("Empty anchor in reference.", 400);
    }
    anchor = candidateAnchor;
    remainder = remainder.slice(0, hashIdx).trim();
  }

  // 3. Extract project path and page path
  let projectPath: string | undefined;
  let page = remainder;

  const openwikiIdx = remainder.indexOf("openwiki/");
  if (openwikiIdx > 0) {
    projectPath = remainder.slice(0, openwikiIdx).replace(/\/+$/, "");
    page = remainder.slice(openwikiIdx);
  } else if (openwikiIdx === 0) {
    page = remainder;
  } else {
    // If "openwiki/" was omitted, prepend it
    page = `openwiki/${remainder.replace(/^\/+/, "")}`;
  }

  // Ensure page has an extension (default to .md if none)
  if (!page.endsWith(".md") && !page.endsWith(".markdown")) {
    page = `${page}.md`;
  }

  return {
    raw: trimmed,
    projectPath: projectPath || undefined,
    page,
    anchor,
    sha,
  };
}

/**
 * Helper to read section or full page markdown from a snapshot directory.
 */
async function readContentFromSnapshot(
  snapshotRoot: string,
  page: string,
  anchor?: string,
): Promise<string> {
  const relPage = page.replace(/^openwiki\//, "");
  let filePath: string;
  try {
    filePath = resolveDocPath(snapshotRoot, relPage);
  } catch (error) {
    if (error instanceof PathError) {
      throw new RefResolutionError(error.message, 400);
    }
    throw error;
  }

  const fileInfo = await stat(filePath).catch(() => undefined);
  if (!fileInfo?.isFile()) {
    throw new RefResolutionError(`Page "${page}" not found in snapshot.`, 404);
  }

  if (anchor) {
    try {
      const response = await readSection(snapshotRoot, page, anchor);
      const section = response.sections?.[0];
      if (!section || section.content === undefined) {
        throw new RefResolutionError(
          `Anchor "${anchor}" not found in page "${page}".`,
          404,
        );
      }
      return section.content;
    } catch (error) {
      if (error instanceof RefResolutionError) throw error;
      throw new RefResolutionError(
        `Anchor "${anchor}" not found in page "${page}": ${
          error instanceof Error ? error.message : String(error)
        }`,
        404,
      );
    }
  }

  return readFile(filePath, "utf8");
}

/**
 * Resolve a SpecLab reference against the OpenWiki Hub snapshots, retrieving
 * the exact markdown content and computing the `changedSince` change status.
 *
 * @param deps - Shared hub dependencies.
 * @param options - Resolution parameters (ref, optional project, optional since baseline).
 * @returns The resolved reference with content and change flag.
 */
export async function resolveSpecLabRef(
  deps: HubDeps,
  options: ResolveRefOptions,
): Promise<ResolvedSpecLabRef> {
  const { db, config } = deps;
  const parsed = parseSpecLabRef(options.ref);

  // 1. Resolve project
  let project: Project | undefined;
  const projectCandidate = options.project ?? parsed.projectPath;

  if (projectCandidate !== undefined) {
    if (
      typeof projectCandidate === "number" ||
      /^\d+$/.test(String(projectCandidate))
    ) {
      project = getProject(db, Number(projectCandidate));
    } else {
      project = getProjectByPath(db, String(projectCandidate));
    }
  }

  if (!project) {
    throw new RefResolutionError(
      `Project not found for reference: ${options.ref}. Specify a project path or id.`,
      404,
    );
  }

  if (!project.enabled || project.archived) {
    throw new RefResolutionError(
      `Project "${project.path}" is disabled or archived.`,
      404,
    );
  }

  // 2. Resolve commit SHA
  const latestSnapshot = latestSuccessfulSnapshot(db, project.id);
  if (!latestSnapshot) {
    throw new RefResolutionError(
      `No successful wiki snapshot available for project "${project.path}".`,
      404,
    );
  }

  const targetSha = parsed.sha ?? latestSnapshot.sha;
  const targetSnapshot = snapshotForSha(db, project.id, targetSha);
  if (!targetSnapshot || targetSnapshot.status !== "success") {
    throw new RefResolutionError(
      `Snapshot for commit "${targetSha}" not found or not synced for project "${project.path}".`,
      404,
    );
  }

  // 3. Read content at targetSha
  const targetDir = snapshotDir(config.dataDir, project.id, targetSha);
  const content = await readContentFromSnapshot(
    targetDir,
    parsed.page,
    parsed.anchor,
  );

  // 4. Compute changedSince
  let changedSince = false;
  const compareSha = options.since ?? (parsed.sha ? latestSnapshot.sha : undefined);

  if (compareSha && compareSha !== targetSha) {
    const compareSnapshot = snapshotForSha(db, project.id, compareSha);
    if (!compareSnapshot || compareSnapshot.status !== "success") {
      // Baseline is unknown or missing -> treat as changed
      changedSince = true;
    } else {
      const compareDir = snapshotDir(config.dataDir, project.id, compareSha);
      try {
        const compareContent = await readContentFromSnapshot(
          compareDir,
          parsed.page,
          parsed.anchor,
        );
        changedSince = content !== compareContent;
      } catch {
        // Page or anchor does not exist in the comparison snapshot -> content changed / deleted
        changedSince = true;
      }
    }
  }

  return {
    ref: options.ref,
    projectId: project.id,
    projectPath: project.path,
    page: parsed.page,
    anchor: parsed.anchor ?? null,
    sha: targetSha,
    latestSha: latestSnapshot.sha,
    content,
    changedSince,
  };
}
