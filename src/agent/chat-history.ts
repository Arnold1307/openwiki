import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { openWikiEnvDir } from "../config/env.js";
import type { ModelMessage } from "../model/types.js";

const HISTORY_DIR = path.join(openWikiEnvDir, "chat-history");
const HISTORY_VERSION = 1;
const MAX_HISTORY_MESSAGES = 2_000;

/** Reads OpenWiki-owned chat history. The legacy LangGraph SQLite file is never opened. */
export async function readChatHistory(threadId: string): Promise<ModelMessage[]> {
  const filePath = historyPath(threadId);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.version !== HISTORY_VERSION || !Array.isArray(parsed.messages)) {
    throw new Error("OpenWiki chat history has an unsupported format.");
  }
  return parsed.messages.filter(isModelMessage).slice(-MAX_HISTORY_MESSAGES);
}

/** Atomically writes private OpenWiki-owned chat history. */
export async function writeChatHistory(
  threadId: string,
  messages: ModelMessage[],
): Promise<void> {
  await mkdir(HISTORY_DIR, { recursive: true, mode: 0o700 });
  await chmod(HISTORY_DIR, 0o700);
  const target = historyPath(threadId);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify({
    version: HISTORY_VERSION,
    updatedAt: new Date().toISOString(),
    messages: messages.slice(-MAX_HISTORY_MESSAGES),
  });
  try {
    await writeFile(temp, payload, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(temp, 0o600);
    await rename(temp, target);
    await chmod(target, 0o600);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function historyPath(threadId: string): string {
  const key = createHash("sha256").update(threadId).digest("hex");
  return path.join(HISTORY_DIR, `${key}.json`);
}

function isModelMessage(value: unknown): value is ModelMessage {
  if (!isRecord(value)) return false;
  return (
    (value.role === "system" || value.role === "user" || value.role === "assistant" || value.role === "tool") &&
    typeof value.content === "string" &&
    (value.toolCallId === undefined || typeof value.toolCallId === "string") &&
    (value.toolName === undefined || typeof value.toolName === "string") &&
    (value.toolCalls === undefined || Array.isArray(value.toolCalls))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
