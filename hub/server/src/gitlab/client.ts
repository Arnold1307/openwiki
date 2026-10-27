/** Minimal fetch signature so tests can inject a fake network. */
export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Project fields the hub uses from `GET /groups/:id/projects`. */
export interface GitLabProject {
  id: number;
  path_with_namespace: string;
  default_branch: string | null;
  archived: boolean;
  web_url: string;
}

/** GitLab rejected the configured token. The message never includes it. */
export class GitLabAuthError extends Error {
  constructor(status: number) {
    super(`GitLab rejected the access token (HTTP ${status}).`);
    this.name = "GitLabAuthError";
  }
}

/** Any other non-success GitLab response. */
export class GitLabError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`GitLab request to ${path} failed (HTTP ${status}).`);
    this.name = "GitLabError";
  }
}

export interface GitLabClientOptions {
  baseUrl: string;
  token: string;
  fetch?: FetchLike;
}

/**
 * Read-only GitLab REST client for discovery and archive download.
 */
export class GitLabClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: GitLabClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetch ?? fetch;
  }

  /**
   * List every project in a group, including subgroups, across all pages.
   *
   * @param group - Full group path such as `platform/core`.
   * @returns Projects in GitLab's order.
   * @throws {GitLabAuthError} When the token is rejected.
   * @throws {GitLabError} On any other failed request.
   */
  async listGroupProjects(group: string): Promise<GitLabProject[]> {
    const encoded = encodeURIComponent(group);
    const projects: GitLabProject[] = [];
    let page = "1";
    while (page) {
      const params = new URLSearchParams({
        include_subgroups: "true",
        per_page: "100",
        page,
      });
      const path = `/api/v4/groups/${encoded}/projects?${params}`;
      const response = await this.request(path);
      projects.push(...((await response.json()) as GitLabProject[]));
      page = response.headers.get("x-next-page") ?? "";
    }
    return projects;
  }

  /**
   * Resolve the default branch name and the commit it currently points to.
   *
   * @param projectId - GitLab project ID.
   * @returns Branch name and head commit SHA.
   */
  async defaultBranchHead(
    projectId: number,
  ): Promise<{ branch: string; sha: string }> {
    const project = (await (
      await this.request(`/api/v4/projects/${projectId}`)
    ).json()) as { default_branch: string };
    const branch = encodeURIComponent(project.default_branch);
    const head = (await (
      await this.request(
        `/api/v4/projects/${projectId}/repository/branches/${branch}`,
      )
    ).json()) as { commit: { id: string } };
    return { branch: project.default_branch, sha: head.commit.id };
  }

  /**
   * Download the repository archive at one commit.
   *
   * @param projectId - GitLab project ID.
   * @param sha - Commit to archive.
   * @returns Gzipped tar bytes.
   */
  async downloadArchive(projectId: number, sha: string): Promise<Uint8Array> {
    const params = new URLSearchParams({ sha });
    const response = await this.request(
      `/api/v4/projects/${projectId}/repository/archive.tar.gz?${params}`,
    );
    return new Uint8Array(await response.arrayBuffer());
  }

  private async request(path: string): Promise<Response> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { "PRIVATE-TOKEN": this.token },
    });
    if (response.status === 401 || response.status === 403) {
      throw new GitLabAuthError(response.status);
    }
    if (!response.ok) throw new GitLabError(response.status, path.split("?")[0]!);
    return response;
  }
}
