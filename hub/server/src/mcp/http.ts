import type { FastifyInstance } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { HubDeps } from "../deps.js";
import { readSection, searchSnapshots } from "../retrieval/search.js";
import { getProjectByPath } from "../store/projects.js";
import { servedProjects, servedWiki } from "../wikis.js";

const textResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

/**
 * Build an MCP server with the read-only wiki tools. The tools mirror the
 * upstream names; the hub addresses wikis by project path instead of a local
 * repository root.
 *
 * @param deps - Hub services.
 * @returns A new server; one per request, because the endpoint is stateless.
 */
export function createMcpServer(deps: HubDeps): McpServer {
  const server = new McpServer({ name: "openwiki-hub", version: "0.1.0" });

  server.registerTool(
    "openwiki_search",
    {
      description:
        "Search the served OpenWiki pages of all hub projects. Returns ranked refs; pass a ref's page and anchor to openwiki_read.",
      inputSchema: {
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit }) => {
      const snapshots = servedProjects(deps).map(({ project, wiki }) => ({
        projectId: project.id,
        projectPath: project.path,
        root: wiki.root,
      }));
      return textResult(await searchSnapshots(snapshots, query, limit ?? 10));
    },
  );

  server.registerTool(
    "openwiki_read",
    {
      description:
        "Read complete sections of one project's served wiki page, using a page and heading anchors from openwiki_search.",
      inputSchema: {
        project: z.string().min(1),
        page: z.string().min(1),
        sections: z.array(z.string().min(1)).min(1).max(10),
      },
    },
    async ({ project, page, sections }) => {
      const found = getProjectByPath(deps.db, project);
      const wiki = found && servedWiki(deps, found);
      if (!wiki) {
        return { isError: true, ...textResult({ error: `No served wiki for ${project}.` }) };
      }
      const result = await Promise.all(
        sections.map((anchor) => readSection(wiki.root, page, anchor)),
      );
      return textResult(result.map((response) => response.sections));
    },
  );

  server.registerTool(
    "openwiki_list_wikis",
    {
      description: "List projects that currently serve an OpenWiki, with the commit they were generated from.",
      inputSchema: {},
    },
    async () =>
      textResult(
        servedProjects(deps).map(({ project, wiki }) => ({
          project: project.path,
          sha: wiki.latest.sha,
          syncedAt: wiki.latest.syncedAt,
        })),
      ),
  );

  return server;
}

/**
 * Serve the MCP tools at `POST /mcp` using Streamable HTTP in stateless mode.
 * Each request gets its own server and transport.
 *
 * @param app - Fastify instance.
 * @param deps - Hub services.
 */
export function registerMcpRoute(app: FastifyInstance, deps: HubDeps): void {
  app.post("/mcp", async (request, reply) => {
    const server = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });

  // Stateless mode has no server-initiated stream and no sessions to end.
  for (const method of ["GET", "DELETE"] as const) {
    app.route({
      method,
      url: "/mcp",
      handler: async (_request, reply) => reply.code(405).send({ error: "Use POST /mcp." }),
    });
  }
}
