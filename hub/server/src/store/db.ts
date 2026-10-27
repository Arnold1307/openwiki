import Database from "better-sqlite3";

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  gitlab_id      INTEGER UNIQUE,
  path           TEXT NOT NULL UNIQUE,
  web_url        TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('group', 'manual')),
  enabled        INTEGER NOT NULL DEFAULT 1,
  archived       INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sha        TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('success', 'no-wiki', 'failed', 'running')),
  synced_at  TEXT NOT NULL,
  error      TEXT,
  UNIQUE (project_id, sha)
);
`;

/**
 * Open the hub database and make sure the schema exists.
 *
 * @param file - Database file path, or `:memory:` for tests.
 * @returns Open database handle.
 */
export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
