export type FileInfo = {
  path: string;
  is_dir?: boolean;
};

type Awaitable<T> = T | Promise<T>;

export type BackendResult = {
  error?: string;
  path?: string;
  metadata?: Record<string, unknown>;
};

export type BackendListResult = BackendResult & { files?: FileInfo[] };
export type BackendReadRawResult = BackendResult & {
  data?: { content?: string | string[] | Uint8Array | null };
};

/** Minimal filesystem contract used by OpenWiki's deterministic wiki lifecycle. */
export interface OpenWikiBackend {
  ls(directoryPath: string): Awaitable<BackendListResult>;
  readRaw(filePath: string): Awaitable<BackendReadRawResult>;
  write(filePath: string, content: string): Awaitable<BackendResult>;
  edit(filePath: string, oldString: string, newString: string, replaceAll?: boolean): Awaitable<BackendResult>;
}
