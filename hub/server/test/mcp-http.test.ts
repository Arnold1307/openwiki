import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/index.ts";
import { fakeGitLab, gitlabProject, makeArchive } from "./fakes.ts";
import { testConfig } from "./helpers.ts";

const WIKI = {
  "openwiki/quickstart.md":
    "# Quickstart\n\n## Retry handling\n\nRetries use exponential backoff.\n",
};

const openApps: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  while (openApps.length) await openApps.pop()!.close();
});

async function startHub() {
  const archive = await makeArchive(WIKI);
  const app = await buildServer(testConfig(), {
    client: fakeGitLab({
      projects: [gitlabProject(7, "platform/core")],
      head: "sha-1",
      archive,
    }),
  });
  openApps.push(app);
  const added = await app.inject({
    method: "POST",
    headers: { "x-requested-with": "openwiki-hub" },
    url: "/api/projects",
    payload: { url: "https://gitlab.test/platform/core" },
  });
  await app.inject({
    method: "POST",
    headers: { "x-requested-with": "openwiki-hub" },
    url: `/api/projects/${added.json().id}/scan`,
  });
  const url = await app.listen({ port: 0, host: "127.0.0.1" });
  return url;
}

async function connect(url: string) {
  const client = new Client({ name: "hub-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`)),
  );
  return client;
}

describe("MCP over HTTP", () => {
  it("lists all available retrieval tools including ref-resolver and read_at", async () => {
    const url = await startHub();
    const client = await connect(url);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "openwiki_list_wikis",
      "openwiki_read",
      "openwiki_read_at",
      "openwiki_resolve_ref",
      "openwiki_search",
    ]);
    await client.close();
  });

  it("searches across projects and reads a section by ref", async () => {
    const url = await startHub();
    const client = await connect(url);

    const search = await client.callTool({
      name: "openwiki_search",
      arguments: { query: "exponential backoff" },
    });
    const hits = JSON.parse(
      (search.content as Array<{ text: string }>)[0]!.text,
    ) as Array<{
      projectPath: string;
      ref: string;
    }>;
    expect(hits[0]).toMatchObject({ projectPath: "platform/core" });

    const read = await client.callTool({
      name: "openwiki_read",
      arguments: {
        project: "platform/core",
        page: hits[0]!.ref.split("#")[0],
        sections: [hits[0]!.ref.split("#")[1]],
      },
    });
    expect((read.content as Array<{ text: string }>)[0]!.text).toContain(
      "exponential backoff",
    );
    await client.close();
  });

  it("resolves SpecLab ref via openwiki_resolve_ref tool", async () => {
    const url = await startHub();
    const client = await connect(url);

    const resolveResult = await client.callTool({
      name: "openwiki_resolve_ref",
      arguments: {
        ref: "platform/core/openwiki/quickstart.md#retry-handling@sha-1",
      },
    });
    expect(resolveResult.isError).toBeFalsy();
    const parsed = JSON.parse(
      (resolveResult.content as Array<{ text: string }>)[0]!.text,
    );
    expect(parsed.projectPath).toBe("platform/core");
    expect(parsed.sha).toBe("sha-1");
    expect(parsed.content).toContain("exponential backoff");
    expect(parsed.changedSince).toBe(false);

    await client.close();
  });

  it("reads content at a specific commit via openwiki_read_at tool", async () => {
    const url = await startHub();
    const client = await connect(url);

    const readAtResult = await client.callTool({
      name: "openwiki_read_at",
      arguments: {
        project: "platform/core",
        sha: "sha-1",
        page: "openwiki/quickstart.md",
        anchor: "retry-handling",
      },
    });
    expect(readAtResult.isError).toBeFalsy();
    const parsed = JSON.parse(
      (readAtResult.content as Array<{ text: string }>)[0]!.text,
    );
    expect(parsed.project).toBe("platform/core");
    expect(parsed.sha).toBe("sha-1");
    expect(parsed.content).toContain("exponential backoff");

    await client.close();
  });

  it("refuses GET on the stateless endpoint", async () => {
    const url = await startHub();
    const response = await fetch(`${url}/mcp`);
    expect(response.status).toBe(405);
  });
});
