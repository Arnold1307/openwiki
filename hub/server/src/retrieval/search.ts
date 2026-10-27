import { readWikiSections, searchWiki } from "openwiki/retrieval";

/** A project snapshot that can be searched: its root contains openwiki/. */
export interface SearchableSnapshot {
  projectId: number;
  projectPath: string;
  root: string;
}

/** One ranked hit, tagged with the project it came from. */
export interface HubSearchHit {
  projectId: number;
  projectPath: string;
  /** `<page>#<heading-anchor>`, usable with {@link readSection}. */
  ref: string;
  content: string;
}

/**
 * Search each snapshot with the upstream retrieval engine and merge the
 * results round-robin, so one large wiki cannot push out the others.
 *
 * @param snapshots - Snapshots to search; each is searched standalone.
 * @param query - Natural-language query.
 * @param limit - Maximum number of merged hits.
 * @returns Up to `limit` hits.
 */
export async function searchSnapshots(
  snapshots: SearchableSnapshot[],
  query: string,
  limit: number,
): Promise<HubSearchHit[]> {
  const perProject: HubSearchHit[][] = [];
  for (const snapshot of snapshots) {
    const response = await searchWiki(snapshot.root, { query, limit });
    if (!("results" in response)) continue;
    perProject.push(
      response.results.map((result) => ({
        projectId: snapshot.projectId,
        projectPath: snapshot.projectPath,
        ref: result.ref[0] ?? "",
        content: result.content,
      })),
    );
  }

  const merged: HubSearchHit[] = [];
  for (let rank = 0; merged.length < limit; rank++) {
    let added = false;
    for (const hits of perProject) {
      const hit = hits[rank];
      if (!hit) continue;
      merged.push(hit);
      added = true;
      if (merged.length === limit) break;
    }
    if (!added) break;
  }
  return merged;
}

/**
 * Read the complete section named by a search ref.
 *
 * @param root - Snapshot root that contains openwiki/.
 * @param page - Wiki page from the ref, e.g. `openwiki/quickstart.md`.
 * @param anchor - Heading anchor from the ref.
 * @returns Upstream read response with the section content.
 */
export function readSection(root: string, page: string, anchor: string) {
  return readWikiSections(root, { page, sections: [anchor] });
}
