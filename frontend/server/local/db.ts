// The local store: ONE SQLite database (node:sqlite, built into Node 24) at frontend/data/factory.db, plus uploaded file
// bytes under frontend/data/files/. One connection per process, shared through globalThis, so the Vite config side
// (auth, /api/data) and the SSR side (functions, gateway) see the same rows. Plain module: no OpError, no Filter.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface LocalPaths {
  /** The frontend/ folder. */
  root: string;
  dataDir: string;
  dbFile: string;
  filesDir: string;
}

export function localPaths(root: string): LocalPaths {
  // FACTORY_LOCAL_DATA_DIR: another local store (a second dev server or a check run beside the usual one)
  const dataDir = process.env.FACTORY_LOCAL_DATA_DIR ? path.resolve(process.env.FACTORY_LOCAL_DATA_DIR) : path.join(root, "data");
  return { root, dataDir, dbFile: path.join(dataDir, "factory.db"), filesDir: path.join(dataDir, "files") };
}

const DDL = `
CREATE TABLE IF NOT EXISTS rows (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  schema TEXT NOT NULL,
  item_id TEXT NOT NULL,
  doc TEXT NOT NULL,
  UNIQUE (schema, item_id)
);
CREATE INDEX IF NOT EXISTS rows_by_schema ON rows (schema, seq);

CREATE TABLE IF NOT EXISTS iam_users (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  roles TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  activated INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_sign_in_at TEXT
);
CREATE TABLE IF NOT EXISTS iam_preferences (
  user_id TEXT PRIMARY KEY,
  language TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS iam_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT NOT NULL,
  family TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS iam_tokens_by_user ON iam_tokens (user_id);
CREATE TABLE IF NOT EXISTS iam_codes (
  code_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS storage_directories (
  directory_id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (parent_id, name)
);
CREATE TABLE IF NOT EXISTS storage_files (
  file_id TEXT PRIMARY KEY,
  directory_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  uploaded_at TEXT
);

CREATE TABLE IF NOT EXISTS mail_drop (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  kind TEXT NOT NULL,
  link TEXT,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** Every table a reset empties (meta keeps the session secret). */
export const DATA_TABLES = ["rows", "iam_users", "iam_preferences", "iam_tokens", "iam_codes", "storage_directories", "storage_files", "mail_drop"] as const;

const KEY = Symbol.for("madp.factory.local.db.v2");
type Held = Map<string, { db: DatabaseSync; ino: number }>;

/** The inode of the database file, or null when it does not exist. */
export function dbFileId(dbFile: string): number | null {
  try {
    return fs.statSync(dbFile).ino;
  } catch {
    return null;
  }
}

/** The process's connection to `dbFile` (created with its tables on first use). A file that was deleted or replaced
 *  since the connection opened is opened again, so a recreated store is never read through a stale handle. */
export function openDb(dbFile: string): DatabaseSync {
  const g = globalThis as unknown as Record<symbol, Held | undefined>;
  const held = (g[KEY] ??= new Map());
  const open = held.get(dbFile);
  if (open && open.db.isOpen && open.ino === dbFileId(dbFile)) return open.db;
  if (open?.db.isOpen) open.db.close();
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF;");
  db.exec(DDL);
  held.set(dbFile, { db, ino: dbFileId(dbFile) ?? -1 });
  return db;
}

/** Runs `fn` in one transaction (nested calls join the outer one). */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export function metaGet(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined;
  return typeof row?.value === "string" ? row.value : null;
}

export function metaSet(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}
