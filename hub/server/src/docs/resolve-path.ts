import path from "node:path";

/** The requested documentation path is not a file inside openwiki/. */
export class PathError extends Error {
  constructor(message = "Path must name a file inside openwiki/.") {
    super(message);
    this.name = "PathError";
  }
}

/**
 * Resolve a page path requested by a client, strictly inside
 * `<snapshotRoot>/openwiki/`.
 *
 * The candidate is decoded once, then rejected if it is empty, contains a NUL
 * byte or a backslash, is absolute (POSIX or drive letter), or has a `..`
 * segment. The result is verified to stay under the openwiki directory.
 *
 * @param snapshotRoot - Directory that contains `openwiki/`.
 * @param candidate - Relative page path from the request.
 * @returns Absolute path of the requested file.
 * @throws {PathError} When the candidate would leave openwiki/.
 */
export function resolveDocPath(snapshotRoot: string, candidate: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    throw new PathError();
  }

  if (
    !decoded ||
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    path.posix.isAbsolute(decoded) ||
    path.win32.isAbsolute(decoded) ||
    decoded.split("/").includes("..")
  ) {
    throw new PathError();
  }

  const openwikiDir = path.resolve(snapshotRoot, "openwiki");
  const resolved = path.resolve(openwikiDir, decoded);
  if (!resolved.startsWith(openwikiDir + path.sep)) {
    throw new PathError();
  }
  return resolved;
}
