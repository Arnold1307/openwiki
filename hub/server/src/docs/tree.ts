import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * List Markdown pages under an openwiki directory.
 *
 * @param openwikiDir - Absolute path of the `openwiki/` directory.
 * @returns Sorted paths relative to `openwiki/`, using forward slashes.
 */
export async function listDocPages(openwikiDir: string): Promise<string[]> {
  const pages: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".md")) {
        pages.push(path.relative(openwikiDir, full).split(path.sep).join("/"));
      }
    }
  }
  try {
    await walk(openwikiDir);
  } catch {
    return [];
  }
  return pages.sort();
}
