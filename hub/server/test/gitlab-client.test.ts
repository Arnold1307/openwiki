import { describe, expect, it } from "vitest";
import {
  GitLabAuthError,
  GitLabClient,
  type FetchLike,
} from "../src/gitlab/client.ts";

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });

describe("GitLabClient", () => {
  it("follows x-next-page across all project pages", async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      seen.push(String(url));
      const page = new URL(String(url)).searchParams.get("page");
      const next = page === "3" ? "" : String(Number(page) + 1);
      return json(
        [{ id: Number(page), path_with_namespace: `platform/p${page}` }],
        { "x-next-page": next },
      );
    };
    const client = new GitLabClient({
      baseUrl: "https://gitlab.test",
      token: "t",
      fetch: fetchImpl,
    });

    const projects = await client.listGroupProjects("platform/core");

    expect(projects.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(seen[0]).toContain("/api/v4/groups/platform%2Fcore/projects");
    expect(seen[0]).toContain("include_subgroups=true");
  });

  it("sends the token only in the PRIVATE-TOKEN header", async () => {
    let sentHeaders: Headers | undefined;
    const client = new GitLabClient({
      baseUrl: "https://gitlab.test",
      token: "secret-token",
      fetch: async (_url, init) => {
        sentHeaders = new Headers(init?.headers);
        return json([], { "x-next-page": "" });
      },
    });
    await client.listGroupProjects("g");
    expect(sentHeaders?.get("PRIVATE-TOKEN")).toBe("secret-token");
  });

  it("maps 401 to GitLabAuthError without echoing the token", async () => {
    const client = new GitLabClient({
      baseUrl: "https://gitlab.test",
      token: "secret-token",
      fetch: async () => new Response("nope", { status: 401 }),
    });
    const error = await client.listGroupProjects("g").catch((e) => e);
    expect(error).toBeInstanceOf(GitLabAuthError);
    expect(String(error.message)).not.toContain("secret-token");
  });

  it("resolves the default branch head sha", async () => {
    const client = new GitLabClient({
      baseUrl: "https://gitlab.test",
      token: "t",
      fetch: async (url) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/repository/branches/main")) {
          return json({ name: "main", commit: { id: "abc123" } });
        }
        return json({ id: 7, default_branch: "main" });
      },
    });
    expect(await client.defaultBranchHead(7)).toEqual({
      branch: "main",
      sha: "abc123",
    });
  });
});
