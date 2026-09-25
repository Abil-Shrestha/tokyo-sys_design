import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType, StatementSync } from "node:sqlite";

// node:sqlite still prints an ExperimentalWarning on load. It is the only
// warning we want to hide, so filter it rather than disabling warnings.
const originalEmit = process.emitWarning;
process.emitWarning = function (warning: string | Error, ...args: unknown[]) {
  const text = typeof warning === "string" ? warning : warning?.message;
  if (typeof text === "string" && text.includes("SQLite is an experimental feature")) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (originalEmit as any).call(process, warning, ...args);
} as typeof process.emitWarning;

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

export type Row = Record<string, unknown>;
export type Params = Record<string, unknown> | unknown[];

/** Thin wrapper over node:sqlite with a statement cache and transactions. */
export class Database {
  readonly raw: DatabaseSyncType;
  private cache = new Map<string, StatementSync>();
  private depth = 0;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL");
    this.raw.exec("PRAGMA synchronous = NORMAL");
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.raw.exec("PRAGMA busy_timeout = 5000");
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      if (this.cache.size > 500) this.cache.clear();
      this.cache.set(sql, s);
    }
    return s;
  }

  private bind(params?: Params): unknown[] {
    if (params === undefined) return [];
    return Array.isArray(params) ? params : [params];
  }

  all<T = Row>(sql: string, params?: Params): T[] {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.stmt(sql).all(...(this.bind(params) as any[])) as T[];
  }

  get<T = Row>(sql: string, params?: Params): T | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.stmt(sql).get(...(this.bind(params) as any[])) as T | undefined;
  }

  run(sql: string, params?: Params): { changes: number; lastInsertRowid: number | bigint } {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = this.stmt(sql).run(...(this.bind(params) as any[]));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Runs fn inside a transaction (nested calls use savepoints). */
  tx<T>(fn: () => T): T {
    const name = `sp${this.depth}`;
    this.raw.exec(this.depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${name}`);
    this.depth++;
    try {
      const result = fn();
      this.depth--;
      this.raw.exec(this.depth === 0 ? "COMMIT" : `RELEASE ${name}`);
      return result;
    } catch (err) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
      throw err;
    }
  }

  close(): void {
    this.cache.clear();
    this.raw.close();
  }
}

const MIGRATIONS: string[] = [
  // 1: initial schema
  `
  CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE blobs (
    hash TEXT PRIMARY KEY,
    ext TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    link_type TEXT,
    title TEXT,
    description TEXT,
    summary TEXT,
    body TEXT,
    content TEXT,
    content_html TEXT,
    note TEXT,
    url TEXT,
    domain TEXT,
    site_name TEXT,
    author TEXT,
    favicon TEXT,
    asset TEXT,
    asset_name TEXT,
    mime TEXT,
    size INTEGER,
    preview TEXT,
    width INTEGER,
    height INTEGER,
    duration REAL,
    colors TEXT NOT NULL DEFAULT '[]',
    meta TEXT NOT NULL DEFAULT '{}',
    pinned_at INTEGER,
    source TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    error TEXT,
    ai_status TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    hlc TEXT NOT NULL
  );
  CREATE INDEX items_created ON items(deleted_at, created_at DESC);
  CREATE INDEX items_kind ON items(kind, link_type);
  CREATE INDEX items_url ON items(url);
  CREATE INDEX items_domain ON items(domain);
  CREATE INDEX items_status ON items(status);
  CREATE INDEX items_pinned ON items(pinned_at);

  CREATE TABLE item_tags (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (item_id, tag)
  );
  CREATE INDEX item_tags_tag ON item_tags(tag);

  CREATE TABLE item_colors (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    hex TEXT NOT NULL,
    name TEXT NOT NULL,
    weight REAL NOT NULL,
    l REAL NOT NULL,
    a REAL NOT NULL,
    b REAL NOT NULL
  );
  CREATE INDEX item_colors_item ON item_colors(item_id);
  CREATE INDEX item_colors_name ON item_colors(name, weight);

  CREATE TABLE item_links (
    from_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    to_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (from_id, to_id)
  );
  CREATE INDEX item_links_to ON item_links(to_id);

  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    parent_id TEXT,
    kind TEXT NOT NULL DEFAULT 'manual',
    query TEXT,
    view TEXT NOT NULL DEFAULT 'grid',
    position REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    hlc TEXT NOT NULL
  );

  CREATE TABLE collection_items (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    position REAL NOT NULL DEFAULT 0,
    x REAL,
    y REAL,
    w REAL,
    z INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (collection_id, item_id)
  );
  CREATE INDEX collection_items_item ON collection_items(item_id);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Append-only change log. Every mutation lands here with a hybrid logical
  -- clock so that libraries on different devices can later be merged
  -- (last-writer-wins per field). See docs/SYNC.md.
  CREATE TABLE changes (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    hlc TEXT NOT NULL,
    device TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    op TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX changes_entity ON changes(entity, entity_id);

  CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    item_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    attempts INTEGER NOT NULL DEFAULT 0,
    run_after INTEGER NOT NULL DEFAULT 0,
    locked_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX jobs_ready ON jobs(run_after);

  CREATE VIRTUAL TABLE items_fts USING fts5(
    item_id UNINDEXED,
    title,
    body,
    tags,
    extra,
    tokenize = 'unicode61 remove_diacritics 2',
    prefix = '2 3'
  );
  `,
];

export function migrate(db: Database): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.get<{ version: number }>("SELECT version FROM schema_version");
  let version = row?.version ?? 0;
  if (!row) db.run("INSERT INTO schema_version (version) VALUES (0)");
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    db.tx(() => {
      db.exec(sql);
      db.run("UPDATE schema_version SET version = ?", [version + 1]);
    });
    version++;
  }
}
