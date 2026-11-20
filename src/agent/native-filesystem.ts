import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, readdir, lstat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export type FilesystemPermission = { operations: "write"[]; paths: string[]; mode: "deny" | "allow" };
export type FileInfo = { path: string; is_dir?: boolean; size?: number; modified_at?: string };
export type ReadResult = { content?: string; error?: string };
export type ReadRawResult = { data?: { content: string | Uint8Array; mimeType: string; created_at: string; modified_at: string }; error?: string };
export type WriteResult = { path?: string; error?: string; metadata?: Record<string, unknown> };
export type EditResult = WriteResult;
export type DeleteResult = WriteResult;
export type LsResult = { files?: FileInfo[]; error?: string };
export type GlobResult = { files: FileInfo[] | undefined; error?: string };
export type GrepResult = { matches?: Array<{ path: string; line: number; text: string }>; error?: string };
export type ExecuteResponse = { exitCode: number; output: string; truncated: boolean };
export type FileOperationError = "file_not_found" | "permission_denied" | "is_directory" | "invalid_path";
export type FileUploadResponse = { path: string; error: FileOperationError | null };
export type FileDownloadResponse = { path: string; content: Uint8Array | null; error: FileOperationError | null };
export type LocalShellBackendOptions = {
  rootDir: string;
  virtualMode?: boolean;
  maxOutputBytes?: number;
  timeout?: number;
};

export class LocalShellBackend {
  readonly cwd: string;
  protected readonly maxOutputBytes: number;
  protected readonly timeout: number;

  constructor(options: LocalShellBackendOptions) {
    this.cwd = path.resolve(options.rootDir);
    this.maxOutputBytes = options.maxOutputBytes ?? 100_000;
    this.timeout = options.timeout ?? 120;
  }

  async read(filePath: string, offset = 0, limit = 20_000): Promise<ReadResult> {
    try {
      const content = await readFile(await this.hostPath(filePath), "utf8");
      return { content: content.split(/\r?\n/u).slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit)).join("\n") };
    } catch (error) { return { error: errorText(error) }; }
  }

  async readRaw(filePath: string): Promise<ReadRawResult> {
    try {
      const host = await this.hostPath(filePath);
      const [content, stats] = await Promise.all([readFile(host, "utf8"), lstat(host)]);
      return { data: { content, mimeType: "text/plain", created_at: stats.birthtime.toISOString(), modified_at: stats.mtime.toISOString() } };
    }
    catch (error) { return { error: errorText(error) }; }
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    try {
      const host = await this.hostPath(filePath, true);
      await mkdir(path.dirname(host), { recursive: true });
      await writeFile(host, content, "utf8");
      return { path: normalizeVirtualPath(filePath) };
    } catch (error) { return { error: errorText(error), path: normalizeVirtualPath(filePath) }; }
  }

  async edit(filePath: string, oldString: string, newString: string, replaceAll = false): Promise<EditResult> {
    try {
      const host = await this.hostPath(filePath);
      const content = await readFile(host, "utf8");
      if (!oldString) return { error: "The old text cannot be empty." };
      if (!content.includes(oldString)) return { error: "The requested text was not found." };
      const edited = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
      await writeFile(host, edited, "utf8");
      return { path: normalizeVirtualPath(filePath) };
    } catch (error) { return { error: errorText(error), path: normalizeVirtualPath(filePath) }; }
  }

  async delete(filePath: string): Promise<DeleteResult> {
    try { await unlink(await this.hostPath(filePath)); return { path: normalizeVirtualPath(filePath) }; }
    catch (error) { return { error: errorText(error), path: normalizeVirtualPath(filePath) }; }
  }

  async ls(dirPath: string): Promise<LsResult> {
    try {
      const host = await this.hostPath(dirPath);
      const entries = await readdir(host, { withFileTypes: true });
      const files: FileInfo[] = [];
      for (const entry of entries) {
        const virtualPath = path.posix.join(normalizeVirtualPath(dirPath), entry.name);
        if (entry.isSymbolicLink()) continue;
        const stats = await lstat(path.join(host, entry.name));
        files.push({ path: virtualPath, is_dir: entry.isDirectory(), size: stats.size, modified_at: stats.mtime.toISOString() });
      }
      return { files };
    } catch (error) { return { error: errorText(error) }; }
  }

  async grep(pattern: string, dirPath = "/", glob?: string | null): Promise<GrepResult> {
    try {
      const root = await this.hostPath(dirPath);
      const expression = new RegExp(pattern, "u");
      const files = await walk(root);
      const matches: GrepResult["matches"] = [];
      for (const host of files) {
        const rel = path.relative(root, host).replaceAll("\\", "/");
        if (glob && !globRegex(glob).test(rel)) continue;
        const text = await readFile(host, "utf8").catch(() => "");
        for (const [index, line] of text.split(/\r?\n/u).entries()) {
          if (expression.test(line)) matches.push({ path: path.posix.join(normalizeVirtualPath(dirPath), rel), line: index + 1, text: line });
          expression.lastIndex = 0;
        }
      }
      return { matches };
    } catch (error) { return { error: errorText(error) }; }
  }

  async glob(pattern: string, searchPath = "/"): Promise<GlobResult> {
    try {
      const root = await this.hostPath(searchPath);
      const regex = globRegex(pattern);
      const files = await walk(root, true);
      return { files: files.flatMap((host) => {
        const rel = path.relative(root, host).replaceAll("\\", "/");
        if (!regex.test(rel)) return [];
        return [{ path: path.posix.join(normalizeVirtualPath(searchPath), rel), is_dir: false }];
      }) };
    } catch (error) { return { files: [], error: errorText(error) }; }
  }

  async uploadFiles(files: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    return Promise.all(files.map(async ([filePath, content]) => {
      try {
        const host = await this.hostPath(filePath, true);
        await mkdir(path.dirname(host), { recursive: true });
        await writeFile(host, content);
        return { path: filePath, error: null };
      } catch { return { path: filePath, error: "invalid_path" }; }
    }));
  }

  async downloadFiles(paths: string[]): Promise<FileDownloadResponse[]> {
    return Promise.all(paths.map(async (filePath) => {
      try { return { path: filePath, content: await readFile(await this.hostPath(filePath)), error: null }; }
      catch (error) { return { path: filePath, content: null, error: (error as NodeJS.ErrnoException).code === "ENOENT" ? "file_not_found" : "permission_denied" }; }
    }));
  }

  async execute(command: string): Promise<ExecuteResponse> {
    try {
      const { stdout, stderr } = await execFile("git", ["rev-parse", "HEAD"], { cwd: this.cwd, timeout: this.timeout * 1000 });
      const output = command.trim() === "pwd" ? this.cwd : `${stdout}${stderr}`;
      return { exitCode: 0, output: truncate(output, this.maxOutputBytes), truncated: Buffer.byteLength(output) > this.maxOutputBytes };
    } catch (error) { return { exitCode: 1, output: errorText(error), truncated: false }; }
  }

  protected async hostPath(filePath: string, allowMissing = false): Promise<string> {
    const virtual = normalizeVirtualPath(filePath);
    const host = path.resolve(this.cwd, `.${virtual.replaceAll("/", path.sep)}`);
    if (!isInside(this.cwd, host)) throw new Error("Path escapes the workspace root.");
    const relative = path.relative(this.cwd, host);
    let current = this.cwd;
    for (const part of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      try {
        const info = await lstat(current);
        if (info.isSymbolicLink()) throw new Error("Symbolic links are not accessible.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissing) break;
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
    }
    return host;
  }
}

export class FilesystemBackend extends LocalShellBackend {}

export class CompositeBackend extends LocalShellBackend {
  constructor(private readonly base: LocalShellBackend, private readonly mounts: Record<string, LocalShellBackend>) {
    super({ rootDir: base.cwd });
  }
  private route(virtualPath: string): { backend: LocalShellBackend; path: string } {
    const normalized = normalizeVirtualPath(virtualPath);
    const mount = Object.keys(this.mounts).sort((a, b) => b.length - a.length).find((key) => normalized.startsWith(key));
    return mount
      ? { backend: this.mounts[mount], path: `/${normalized.slice(mount.length)}` }
      : { backend: this.base, path: normalized };
  }
  override async read(path: string, offset?: number, limit?: number) { const r = this.route(path); return r.backend.read(r.path, offset, limit); }
  override async readRaw(path: string) { const r = this.route(path); return r.backend.readRaw(r.path); }
  override async write(path: string, content: string) { const r = this.route(path); return r.backend.write(r.path, content); }
  override async edit(path: string, old: string, next: string, all?: boolean) { const r = this.route(path); return r.backend.edit(r.path, old, next, all); }
  override async delete(path: string) { const r = this.route(path); return r.backend.delete(r.path); }
  override async ls(virtualPath: string) {
    const normalized = normalizeVirtualPath(virtualPath);
    if (normalized === "/") {
      const base = await this.base.ls("/");
      return { ...base, files: [...(base.files ?? []), ...Object.keys(this.mounts).map((mount) => ({ path: mount.slice(0, -1), is_dir: true }))] };
    }
    const r = this.route(virtualPath); const result = await r.backend.ls(r.path);
    return { ...result, files: result.files?.map((file) => ({ ...file, path: path.posix.join(normalized, path.posix.basename(file.path)) })) };
  }
  override async grep(pattern: string, directory?: string | null, glob?: string | null) { const r = this.route(directory ?? "/"); return r.backend.grep(pattern, r.path, glob); }
  override async glob(pattern: string, searchPath = "/") { const r = this.route(searchPath); const result = await r.backend.glob(pattern, r.path); return { ...result, files: result.files?.map((file) => ({ ...file, path: path.posix.join(normalizeVirtualPath(searchPath), path.posix.basename(file.path)) })) }; }
  override async uploadFiles(files: Array<[string, Uint8Array]>) { return Promise.all(files.map(([p, bytes]) => { const r = this.route(p); return r.backend.uploadFiles([[r.path, bytes]]).then((results) => ({ ...results[0], path: p })); })); }
  override async downloadFiles(paths: string[]) { return Promise.all(paths.map((p) => { const r = this.route(p); return r.backend.downloadFiles([r.path]).then((results) => ({ ...results[0], path: p })); })); }
  override async execute(command: string) { return this.base.execute(command); }
}

async function walk(root: string, includeDirs = false): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (includeDirs) result.push(candidate);
        await visit(candidate);
      } else if (entry.isFile()) result.push(candidate);
    }
  };
  await visit(root);
  return result;
}

function globRegex(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      i += 1;
      if (pattern[i + 1] === "/") { i += 1; source += "(?:.*/)?"; }
      else source += ".*";
    } else if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "{") source += "(?:";
    else if (c === "}") source += ")";
    else if (c === ",") source += "|";
    else source += c.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
  }
  return new RegExp(`^${source}$`, "u");
}

function normalizeVirtualPath(filePath: string): string {
  const normalized = path.posix.normalize(`/${filePath.replaceAll("\\", "/").replace(/^\/+/, "")}`);
  if (normalized === "/.." || normalized.startsWith("/../")) throw new Error("Path escapes the workspace root.");
  return normalized;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function truncate(value: string, maxBytes: number): string { return Buffer.from(value).subarray(0, maxBytes).toString("utf8"); }
