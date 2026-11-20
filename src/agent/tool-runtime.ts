import type { RuntimeTool } from "../model/types.js";
import type { CompositeBackend, ExecuteResponse } from "./native-filesystem.js";
import type { OpenWikiOutputMode } from "./types.js";
import { createOpenWikiConnectorTools } from "../connectors/tools.js";

type ToolBackend = CompositeBackend;

export function createAgentTools(
  backend: ToolBackend,
  outputMode: OpenWikiOutputMode,
): RuntimeTool[] {
  const filesystem: RuntimeTool[] = [
    makeTool("ls", "List files and directories at a virtual path.", { path: stringSchema }, async (args) => backend.ls(stringArg(args, "path", "/"))),
    makeTool("read_file", "Read a text file from the workspace.", { file_path: stringSchema, offset: numberSchema, limit: numberSchema }, async (args) => backend.read(stringArg(args, "file_path"), numberArg(args, "offset"), numberArg(args, "limit"))),
    makeTool("glob", "Find files matching a glob pattern beneath a virtual path.", { pattern: stringSchema, path: stringSchema }, async (args) => backend.glob(stringArg(args, "pattern"), stringArg(args, "path", "/"))),
    makeTool("grep", "Search file contents beneath a virtual path.", { pattern: stringSchema, path: stringSchema, glob: stringSchema }, async (args) => backend.grep(stringArg(args, "pattern"), stringArg(args, "path", "/"), stringArg(args, "glob"))),
    makeTool("write_file", "Write a text file to the allowed workspace path.", { file_path: stringSchema, content: stringSchema }, async (args) => backend.write(stringArg(args, "file_path"), stringArg(args, "content"))),
    makeTool("edit_file", "Replace text in a workspace file.", { file_path: stringSchema, old_string: stringSchema, new_string: stringSchema, replace_all: { type: "boolean" } }, async (args) => backend.edit(stringArg(args, "file_path"), stringArg(args, "old_string"), stringArg(args, "new_string"), args.replace_all === true)),
    makeTool("execute", "Run a tightly restricted repository maintenance command.", { command: stringSchema }, async (args) => backend.execute(stringArg(args, "command"))),
  ];
  return [...filesystem, ...createOpenWikiConnectorTools(outputMode)];
}

export async function executeToolCall(
  tools: RuntimeTool[],
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` });
  return tool.execute(input);
}

function makeTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  run: (args: Record<string, unknown>) => Promise<unknown>,
): RuntimeTool {
  return {
    name,
    description,
    parameters: { type: "object", properties, additionalProperties: false },
    execute: async (input) => stringify(await run(input)),
  };
}

const stringSchema = { type: "string" } as const;
const numberSchema = { type: "number" } as const;

function stringArg(input: Record<string, unknown>, key: string, fallback?: string): string {
  const value = input[key];
  if (typeof value === "string") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing string tool argument: ${key}`);
}

function numberArg(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  return typeof value === "number" ? value : undefined;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
