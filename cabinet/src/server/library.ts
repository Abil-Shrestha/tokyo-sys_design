import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { isEmptyQuery, normalizeTag, parseQuery, type ParsedQuery } from "../shared/query";
import type {
  CanvasPlacement,
  Collection,
  ColorSwatch,
  Facets,
  Item,
  ItemCard,
  ItemKind,
  ItemLinkRef,
  ItemMeta,
  ItemPage,
  ItemStatus,
  ItemTag,
  LibraryEvent,
  LinkType,
  Settings,
  TagCount,
  UpdateItemInput,
} from "../shared/types";
import { LocalBlobStore } from "./blobs";
import { classifyColor, hexToLab } from "./colors";
import { Database, migrate } from "./db";
import { HybridClock, ulid } from "./ids";
import { ThumbnailCache } from "./images";
import { buildSearch, orderClause, type SortOrder } from "./search";

export interface ItemRow {
  id: string;
  kind: ItemKind;
  link_type: LinkType | null;
  title: string | null;
  description: string | null;
  summary: string | null;
  body: string | null;
  content: string | null;
  content_html: string | null;
  note: string | null;
  url: string | null;
  domain: string | null;
  site_name: string | null;
  author: string | null;
  favicon: string | null;
  asset: string | null;
  asset_name: string | null;
  mime: string | null;
  size: number | null;
  preview: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  colors: string;
  meta: string;
  pinned_at: number | null;
  source: string | null;
  status: ItemStatus;
  error: string | null;
  ai_status: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  hlc: string;
}

/** Columns the enrichment pipeline and ingestion may write. */
export type ItemFields = Partial<Omit<ItemRow, "id" | "created_at" | "updated_at" | "hlc" | "colors" | "meta">> & {
  colors?: ColorSwatch[];
  meta?: ItemMeta;
  created_at?: number;
};

const CARD_COLUMNS = `items.id, items.kind, items.link_type, items.title, items.description,
  substr(items.body, 1, 700) AS body, substr(items.content, 1, 400) AS content, items.summary,
  items.url, items.domain, items.site_name, items.favicon, items.asset, items.asset_name, items.mime, items.size,
  items.preview, items.width, items.height, items.duration, items.colors, items.meta, items.pinned_at,
  items.status, items.created_at, items.updated_at, items.deleted_at`;

const WRITABLE = new Set([
  "kind",
  "link_type",
  "title",
  "description",
  "summary",
  "body",
  "content",
  "content_html",
  "note",
  "url",
  "domain",
  "site_name",
  "author",
  "favicon",
  "asset",
  "asset_name",
  "mime",
  "size",
  "preview",
  "width",
  "height",
  "duration",
  "colors",
  "meta",
  "pinned_at",
  "source",
  "status",
  "error",
  "ai_status",
  "created_at",
  "deleted_at",
]);

/** Fields that are local derivations and not worth recording in the change log. */
const UNLOGGED = new Set(["status", "error", "ai_status"]);

const DEFAULT_SETTINGS: Omit<Settings, "aiKeySet"> = {
  aiEnabled: false,
  aiModel: "claude-opus-5",
  autoTag: true,
  fetchLinkPreviews: true,
  trashRetentionDays: 30,
};

export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function excerptOf(row: Pick<ItemRow, "kind" | "body" | "content" | "description" | "summary">): string | null {
  if (row.kind === "note" || row.kind === "quote") return row.body ?? null;
  const text = row.summary || row.description || row.content;
  if (!text) return null;
  return text.length > 320 ? `${text.slice(0, 317).trimEnd()}…` : text;
}

export interface ListParams {
  q?: string;
  collectionId?: string;
  sort?: SortOrder;
  cursor?: string | null;
  limit?: number;
  trash?: boolean;
  seed?: number;
}

export interface LibraryDeps {
  path: string;
  deviceId: string;
}

export class Library extends EventEmitter {
  readonly path: string;
  readonly deviceId: string;
  readonly db: Database;
  readonly blobs: LocalBlobStore;
  readonly thumbs: ThumbnailCache;
  readonly clock: HybridClock;
  private closed = false;

  private constructor(deps: LibraryDeps, db: Database) {
    super();
    this.setMaxListeners(100);
    this.path = deps.path;
    this.deviceId = deps.deviceId;
    this.db = db;
    this.blobs = new LocalBlobStore(db, deps.path);
    this.thumbs = new ThumbnailCache(path.join(deps.path, "cache", "thumbs"));
    this.clock = new HybridClock(deps.deviceId);
  }

  static async open(deps: LibraryDeps): Promise<Library> {
    await fs.mkdir(deps.path, { recursive: true });
    const db = new Database(path.join(deps.path, "library.db"));
    migrate(db);
    const lib = new Library(deps, db);
    await lib.blobs.init();
    await fs.mkdir(path.join(deps.path, "cache", "thumbs"), { recursive: true });
    if (!db.get("SELECT value FROM meta WHERE key = 'library_id'")) {
      db.run("INSERT INTO meta (key, value) VALUES ('library_id', ?), ('created_at', ?)", [ulid(), String(Date.now())]);
    }
    await fs
      .writeFile(
        path.join(deps.path, "README.txt"),
        "This folder is a Cabinet library.\n\nlibrary.db holds your items, tags and collections; blobs/ holds the original files,\nnamed by their SHA-256 hash. cache/ can be deleted at any time.\n",
      )
      .catch(() => {});
    return lib;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.removeAllListeners();
    this.db.close();
  }

  get isClosed(): boolean {
    return this.closed;
  }

  emitEvent(event: LibraryEvent): void {
    this.emit("event", event);
  }

  // ---------------------------------------------------------------------------
  // Change log

  private logChange(entity: string, entityId: string, op: string, data: Record<string, unknown>, hlc?: string): void {
    this.db.run("INSERT INTO changes (hlc, device, entity, entity_id, op, data) VALUES (?, ?, ?, ?, ?, ?)", [
      hlc ?? this.clock.now(),
      this.deviceId,
      entity,
      entityId,
      op,
      JSON.stringify(data),
    ]);
  }

  changesSince(seq: number, limit = 1000): { seq: number; hlc: string; device: string; entity: string; entityId: string; op: string; data: unknown }[] {
    return this.db
      .all<{ seq: number; hlc: string; device: string; entity: string; entity_id: string; op: string; data: string }>(
        "SELECT * FROM changes WHERE seq > ? ORDER BY seq LIMIT ?",
        [seq, limit],
      )
      .map((r) => ({ seq: Number(r.seq), hlc: r.hlc, device: r.device, entity: r.entity, entityId: r.entity_id, op: r.op, data: parseJson(r.data, {}) }));
  }

  // ---------------------------------------------------------------------------
  // Settings (library-wide, synced with the library)

  getSettings(aiKeySet: boolean): Settings {
    const rows = this.db.all<{ key: string; value: string }>("SELECT key, value FROM settings");
    const stored: Record<string, unknown> = {};
    for (const r of rows) stored[r.key] = parseJson(r.value, null);
    return { ...DEFAULT_SETTINGS, ...stored, aiKeySet } as Settings;
  }

  setSettings(patch: Partial<Settings>): void {
    const allowed = Object.keys(DEFAULT_SETTINGS);
    this.db.tx(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (!allowed.includes(key) || value === undefined) continue;
        this.db.run(
          "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
          [key, JSON.stringify(value), Date.now()],
        );
        this.logChange("setting", key, "set", { value });
      }
    });
    this.emitEvent({ type: "settings.changed" });
  }

  // ---------------------------------------------------------------------------
  // Items: rows and DTOs

  getRow(id: string): ItemRow | undefined {
    return this.db.get<ItemRow>("SELECT * FROM items WHERE id = ?", [id]);
  }

  private tagsFor(ids: string[]): Map<string, ItemTag[]> {
    const map = new Map<string, ItemTag[]>();
    if (!ids.length) return map;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = this.db.all<{ item_id: string; tag: string; source: ItemTag["source"] }>(
        `SELECT item_id, tag, source FROM item_tags WHERE item_id IN (${chunk.map(() => "?").join(",")}) ORDER BY created_at, rowid`,
        chunk,
      );
      for (const r of rows) {
        const list = map.get(r.item_id) ?? [];
        list.push({ name: r.tag, source: r.source });
        map.set(r.item_id, list);
      }
    }
    return map;
  }

  private toCard(row: Omit<ItemRow, "content_html" | "hlc" | "note" | "author" | "source" | "error" | "ai_status">, tags: ItemTag[]): ItemCard {
    return {
      id: row.id,
      kind: row.kind,
      linkType: row.link_type,
      title: row.title,
      description: row.description,
      summary: row.summary,
      excerpt: excerptOf(row),
      url: row.url,
      domain: row.domain,
      siteName: row.site_name,
      favicon: row.favicon,
      asset: row.asset,
      assetName: row.asset_name,
      mime: row.mime,
      size: row.size === null ? null : Number(row.size),
      preview: row.preview,
      width: row.width === null ? null : Number(row.width),
      height: row.height === null ? null : Number(row.height),
      duration: row.duration,
      colors: parseJson<ColorSwatch[]>(row.colors, []),
      meta: parseJson<ItemMeta>(row.meta, {}),
      tags,
      pinned: row.pinned_at !== null,
      status: row.status,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      deletedAt: row.deleted_at === null ? null : Number(row.deleted_at),
    };
  }

  getItem(id: string): Item | null {
    const row = this.getRow(id);
    if (!row) return null;
    const card = this.toCard(row, this.tagsFor([id]).get(id) ?? []);
    const collections = this.db.all<{ id: string; name: string }>(
      `SELECT c.id, c.name FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
       WHERE ci.item_id = ? AND c.deleted_at IS NULL ORDER BY c.name`,
      [id],
    );
    const links = this.db.all<{ id: string; title: string | null; kind: ItemKind; preview: string | null; asset: string | null; body: string | null }>(
      `SELECT i.id, i.title, i.kind, i.preview, i.asset, substr(i.body, 1, 80) AS body FROM items i
       WHERE i.deleted_at IS NULL AND i.id IN (
         SELECT to_id FROM item_links WHERE from_id = ? UNION SELECT from_id FROM item_links WHERE to_id = ?)`,
      [id, id],
    );
    return {
      ...card,
      body: row.body,
      content: row.content,
      contentHtml: row.content_html,
      note: row.note,
      author: row.author,
      source: row.source,
      error: row.error,
      aiStatus: row.ai_status,
      collections,
      links: links.map(
        (l): ItemLinkRef => ({
          id: l.id,
          title: l.title ?? l.body,
          kind: l.kind,
          preview: l.kind === "image" ? l.asset : l.preview,
        }),
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // Items: writes

  private reindex(id: string): void {
    this.db.run("DELETE FROM items_fts WHERE item_id = ?", [id]);
    const row = this.getRow(id);
    if (!row) return;
    const tags = this.db.all<{ tag: string }>("SELECT tag FROM item_tags WHERE item_id = ?", [id]).map((t) => t.tag);
    const meta = parseJson<ItemMeta>(row.meta, {});
    const colors = this.db.all<{ name: string }>("SELECT DISTINCT name FROM item_colors WHERE item_id = ? AND weight >= 0.08", [id]).map((c) => c.name);
    this.db.run("INSERT INTO items_fts (item_id, title, body, tags, extra) VALUES (?, ?, ?, ?, ?)", [
      id,
      [row.title, row.asset_name].filter(Boolean).join(" \n"),
      [row.body, row.note, row.description, row.summary, meta.imageText, (row.content ?? "").slice(0, 200_000)].filter(Boolean).join(" \n"),
      tags.join(" \n"),
      [
        row.url,
        row.domain,
        row.site_name,
        row.author,
        row.kind,
        row.link_type,
        meta.brand,
        (meta.ingredients ?? []).join(" "),
        (meta.keywords ?? []).join(" "),
        colors.join(" "),
      ]
        .filter(Boolean)
        .join(" \n"),
    ]);
  }

  private writeColors(id: string, colors: ColorSwatch[]): void {
    this.db.run("DELETE FROM item_colors WHERE item_id = ?", [id]);
    for (const c of colors) {
      const lab = hexToLab(c.hex);
      this.db.run("INSERT INTO item_colors (item_id, hex, name, weight, l, a, b) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        id,
        c.hex,
        classifyColor(lab),
        c.weight,
        lab.l,
        lab.a,
        lab.b,
      ]);
    }
  }

  private serialize(fields: ItemFields): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (!WRITABLE.has(k) || v === undefined) continue;
      if (k === "colors" || k === "meta") out[k] = JSON.stringify(v);
      else out[k] = typeof v === "string" && k !== "body" && k !== "note" && k !== "content" && k !== "content_html" ? v.trim() || null : v;
    }
    return out;
  }

  insertItem(fields: ItemFields & { kind: ItemKind }, opts: { tags?: string[]; tagSource?: ItemTag["source"]; collectionId?: string } = {}): string {
    const id = ulid();
    const now = Date.now();
    const hlc = this.clock.now();
    const values = this.serialize({ status: "ready", ...fields });
    if (values.url && !values.domain) values.domain = domainOf(values.url as string);
    const createdAt = (values.created_at as number | undefined) ?? now;
    delete values.created_at;
    const cols = Object.keys(values);
    this.db.tx(() => {
      this.db.run(
        `INSERT INTO items (id, ${cols.join(", ")}, created_at, updated_at, hlc) VALUES (?, ${cols.map(() => "?").join(", ")}, ?, ?, ?)`,
        [id, ...cols.map((c) => values[c]), createdAt, now, hlc],
      );
      const logged = Object.fromEntries(Object.entries(values).filter(([k]) => !UNLOGGED.has(k)));
      this.logChange("item", id, "create", { ...logged, created_at: createdAt }, hlc);
      if (fields.colors?.length) this.writeColors(id, fields.colors);
      if (opts.tags?.length) this.addTagsTx([id], opts.tags, opts.tagSource ?? "user");
      if (opts.collectionId) this.addToCollectionTx(opts.collectionId, [id]);
      this.reindex(id);
    });
    this.emitEvent({ type: "item.created", id });
    return id;
  }

  /** Low-level update used by ingestion and enrichment. */
  patchItem(id: string, fields: ItemFields, opts: { silent?: boolean; touch?: boolean } = {}): void {
    const values = this.serialize(fields);
    if ("url" in values && values.url && !("domain" in values)) values.domain = domainOf(values.url as string);
    const cols = Object.keys(values);
    if (!cols.length) return;
    const hlc = this.clock.now();
    this.db.tx(() => {
      const r = this.db.run(
        `UPDATE items SET ${cols.map((c) => `${c} = ?`).join(", ")}${opts.touch === false ? "" : ", updated_at = ?"}, hlc = ? WHERE id = ?`,
        [...cols.map((c) => values[c]), ...(opts.touch === false ? [] : [Date.now()]), hlc, id],
      );
      if (!r.changes) return;
      const logged = Object.fromEntries(Object.entries(values).filter(([k]) => !UNLOGGED.has(k)));
      if (Object.keys(logged).length) this.logChange("item", id, "update", logged, hlc);
      if (fields.colors) this.writeColors(id, fields.colors);
      this.reindex(id);
    });
    if (!opts.silent) this.emitEvent({ type: "item.updated", id });
  }

  updateItem(id: string, patch: UpdateItemInput): Item | null {
    const row = this.getRow(id);
    if (!row) return null;
    const fields: ItemFields = {};
    if (patch.title !== undefined) fields.title = patch.title;
    if (patch.description !== undefined) fields.description = patch.description;
    if (patch.body !== undefined) fields.body = patch.body;
    if (patch.note !== undefined) fields.note = patch.note;
    if (patch.url !== undefined) {
      fields.url = patch.url;
      fields.domain = domainOf(patch.url);
    }
    if (patch.kind !== undefined) fields.kind = patch.kind;
    if (patch.pinned !== undefined) fields.pinned_at = patch.pinned ? Date.now() : null;
    this.db.tx(() => {
      this.patchItem(id, fields, { silent: true });
      if (patch.tags) this.setTagsTx(id, patch.tags);
    });
    this.emitEvent({ type: "item.updated", id });
    if (patch.tags) this.emitEvent({ type: "tags.changed" });
    return this.getItem(id);
  }

  trashItems(ids: string[]): number {
    let n = 0;
    const now = Date.now();
    this.db.tx(() => {
      for (const id of ids) {
        const hlc = this.clock.now();
        const r = this.db.run("UPDATE items SET deleted_at = ?, updated_at = ?, hlc = ? WHERE id = ? AND deleted_at IS NULL", [now, now, hlc, id]);
        if (r.changes) {
          n++;
          this.logChange("item", id, "update", { deleted_at: now }, hlc);
        }
      }
    });
    for (const id of ids) this.emitEvent({ type: "item.deleted", id });
    this.emitEvent({ type: "items.changed" });
    return n;
  }

  restoreItems(ids: string[]): number {
    let n = 0;
    this.db.tx(() => {
      for (const id of ids) {
        const hlc = this.clock.now();
        const r = this.db.run("UPDATE items SET deleted_at = NULL, updated_at = ?, hlc = ? WHERE id = ? AND deleted_at IS NOT NULL", [Date.now(), hlc, id]);
        if (r.changes) {
          n++;
          this.logChange("item", id, "update", { deleted_at: null }, hlc);
        }
      }
    });
    this.emitEvent({ type: "items.changed" });
    return n;
  }

  /** Permanently removes items and any files no other item uses. */
  async purgeItems(ids: string[]): Promise<number> {
    const hashes = new Set<string>();
    let n = 0;
    this.db.tx(() => {
      for (const id of ids) {
        const row = this.getRow(id);
        if (!row) continue;
        for (const h of [row.asset, row.preview, row.favicon]) if (h) hashes.add(h);
        this.db.run("DELETE FROM items_fts WHERE item_id = ?", [id]);
        this.db.run("DELETE FROM jobs WHERE item_id = ?", [id]);
        this.db.run("DELETE FROM items WHERE id = ?", [id]);
        this.logChange("item", id, "delete", {});
        n++;
      }
    });
    await this.collectGarbage([...hashes]);
    this.emitEvent({ type: "items.changed" });
    return n;
  }

  async emptyTrash(olderThan?: number): Promise<number> {
    const rows = this.db.all<{ id: string }>(
      olderThan ? "SELECT id FROM items WHERE deleted_at IS NOT NULL AND deleted_at < ?" : "SELECT id FROM items WHERE deleted_at IS NOT NULL",
      olderThan ? [olderThan] : [],
    );
    return this.purgeItems(rows.map((r) => r.id));
  }

  async collectGarbage(hashes: string[]): Promise<void> {
    for (const hash of hashes) {
      const used = this.db.get("SELECT 1 FROM items WHERE asset = ? OR preview = ? OR favicon = ? LIMIT 1", [hash, hash, hash]);
      if (used) continue;
      await this.blobs.remove(hash);
      await this.thumbs.removeFor(hash);
    }
  }

  // ---------------------------------------------------------------------------
  // Tags

  private addTagsTx(ids: string[], tags: string[], source: ItemTag["source"]): void {
    const now = Date.now();
    for (const raw of tags) {
      const tag = normalizeTag(raw);
      if (!tag) continue;
      for (const id of ids) {
        const r = this.db.run("INSERT OR IGNORE INTO item_tags (item_id, tag, source, created_at) VALUES (?, ?, ?, ?)", [id, tag, source, now]);
        if (r.changes) this.logChange("item_tag", `${id}\u0000${tag}`, "add", { item_id: id, tag, source });
      }
    }
  }

  private setTagsTx(id: string, tags: string[]): void {
    const wanted = new Set(tags.map(normalizeTag).filter(Boolean));
    const current = this.db.all<{ tag: string }>("SELECT tag FROM item_tags WHERE item_id = ?", [id]).map((r) => r.tag);
    for (const tag of current) {
      if (!wanted.has(tag)) {
        this.db.run("DELETE FROM item_tags WHERE item_id = ? AND tag = ?", [id, tag]);
        this.logChange("item_tag", `${id}\u0000${tag}`, "remove", { item_id: id, tag });
      }
    }
    this.addTagsTx([id], [...wanted].filter((t) => !current.includes(t)), "user");
    this.reindex(id);
  }

  addTags(ids: string[], tags: string[], source: ItemTag["source"] = "user"): void {
    this.db.tx(() => {
      this.addTagsTx(ids, tags, source);
      for (const id of ids) this.reindex(id);
    });
    for (const id of ids) this.emitEvent({ type: "item.updated", id });
    this.emitEvent({ type: "tags.changed" });
  }

  removeTags(ids: string[], tags: string[]): void {
    const names = tags.map(normalizeTag);
    this.db.tx(() => {
      for (const id of ids) {
        for (const tag of names) {
          const r = this.db.run("DELETE FROM item_tags WHERE item_id = ? AND tag = ?", [id, tag]);
          if (r.changes) this.logChange("item_tag", `${id}\u0000${tag}`, "remove", { item_id: id, tag });
        }
        this.reindex(id);
      }
    });
    for (const id of ids) this.emitEvent({ type: "item.updated", id });
    this.emitEvent({ type: "tags.changed" });
  }

  /** Replaces machine-generated tags of one source, leaving user tags alone. */
  replaceGeneratedTags(id: string, tags: string[], source: "auto" | "ai"): void {
    this.db.tx(() => {
      const existing = this.db.all<{ tag: string; source: string }>("SELECT tag, source FROM item_tags WHERE item_id = ?", [id]);
      for (const t of existing) {
        if (t.source === source) {
          this.db.run("DELETE FROM item_tags WHERE item_id = ? AND tag = ?", [id, t.tag]);
          this.logChange("item_tag", `${id}\u0000${t.tag}`, "remove", { item_id: id, tag: t.tag });
        }
      }
      const kept = new Set(existing.filter((t) => t.source !== source).map((t) => t.tag));
      this.addTagsTx([id], tags.filter((t) => !kept.has(normalizeTag(t))), source);
      this.reindex(id);
    });
    this.emitEvent({ type: "item.updated", id });
    this.emitEvent({ type: "tags.changed" });
  }

  listTags(): TagCount[] {
    return this.db
      .all<{ name: string; count: number }>(
        `SELECT t.tag AS name, COUNT(*) AS count FROM item_tags t JOIN items i ON i.id = t.item_id
         WHERE i.deleted_at IS NULL GROUP BY t.tag ORDER BY count DESC, name ASC`,
      )
      .map((t) => ({ name: t.name, count: Number(t.count) }));
  }

  renameTag(from: string, to: string): void {
    const a = normalizeTag(from);
    const b = normalizeTag(to);
    if (!a || !b || a === b) return;
    this.db.tx(() => {
      const rows = this.db.all<{ item_id: string; source: ItemTag["source"] }>("SELECT item_id, source FROM item_tags WHERE tag = ?", [a]);
      for (const r of rows) {
        this.db.run("DELETE FROM item_tags WHERE item_id = ? AND tag = ?", [r.item_id, a]);
        this.logChange("item_tag", `${r.item_id}\u0000${a}`, "remove", { item_id: r.item_id, tag: a });
        this.addTagsTx([r.item_id], [b], "user");
        this.reindex(r.item_id);
      }
    });
    this.emitEvent({ type: "tags.changed" });
    this.emitEvent({ type: "items.changed" });
  }

  deleteTag(name: string): void {
    const tag = normalizeTag(name);
    this.db.tx(() => {
      const rows = this.db.all<{ item_id: string }>("SELECT item_id FROM item_tags WHERE tag = ?", [tag]);
      for (const r of rows) {
        this.db.run("DELETE FROM item_tags WHERE item_id = ? AND tag = ?", [r.item_id, tag]);
        this.logChange("item_tag", `${r.item_id}\u0000${tag}`, "remove", { item_id: r.item_id, tag });
        this.reindex(r.item_id);
      }
    });
    this.emitEvent({ type: "tags.changed" });
    this.emitEvent({ type: "items.changed" });
  }

  // ---------------------------------------------------------------------------
  // Listing and search

  private scopeFor(params: ListParams): { q: ParsedQuery; collectionJoin: string; collectionParams: unknown[]; manual: boolean } {
    let q = parseQuery(params.q ?? "");
    let collectionJoin = "";
    const collectionParams: unknown[] = [];
    let manual = false;
    if (params.collectionId) {
      const c = this.db.get<{ kind: string; query: string | null }>("SELECT kind, query FROM collections WHERE id = ?", [params.collectionId]);
      if (c?.kind === "smart") {
        const smart = parseQuery(c.query ?? "");
        q = mergeQueries(smart, q);
      } else {
        manual = true;
        collectionJoin = "JOIN collection_items ci ON ci.item_id = items.id AND ci.collection_id = ?";
        collectionParams.push(params.collectionId);
      }
    }
    return { q, collectionJoin, collectionParams, manual };
  }

  listItems(params: ListParams): ItemPage {
    const limit = Math.min(Math.max(params.limit ?? 60, 1), 500);
    const offset = Math.max(Number(params.cursor ?? 0) || 0, 0);
    const { q, collectionJoin, collectionParams, manual } = this.scopeFor(params);
    const s = buildSearch(q);
    const where = [params.trash ? "items.deleted_at IS NOT NULL" : "items.deleted_at IS NULL", ...s.where];
    let sort: SortOrder = params.sort ?? (s.hasRank ? "relevance" : "newest");
    if (sort === "relevance" && !s.hasRank) sort = "newest";
    let order = orderClause(sort, s.hasRank, params.seed ?? 1);
    if (params.trash && sort === "newest") order = "items.deleted_at DESC";
    if (manual && sort === "newest" && !s.hasRank) order = "ci.added_at DESC, items.id DESC";
    const from = `FROM items ${collectionJoin} ${s.join} WHERE ${where.join(" AND ")}`;
    const baseParams = [...collectionParams, ...s.joinParams, ...s.params];
    const total = Number(this.db.get<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, baseParams)?.n ?? 0);
    const rows = this.db.all<ItemRow>(`SELECT ${CARD_COLUMNS} ${from} ORDER BY ${order} LIMIT ? OFFSET ?`, [...baseParams, limit, offset]);
    const tags = this.tagsFor(rows.map((r) => r.id));
    return {
      items: rows.map((r) => this.toCard(r, tags.get(r.id) ?? [])),
      total,
      nextCursor: offset + rows.length < total ? String(offset + rows.length) : null,
    };
  }

  facets(params: ListParams = {}): Facets {
    const { q, collectionJoin, collectionParams } = this.scopeFor(params);
    const s = buildSearch(q);
    const where = ["items.deleted_at IS NULL", ...s.where];
    const from = `FROM items ${collectionJoin} ${s.join} WHERE ${where.join(" AND ")}`;
    const p = [...collectionParams, ...s.joinParams, ...s.params];
    const kinds: Record<string, number> = {};
    for (const r of this.db.all<{ kind: string; n: number }>(`SELECT items.kind AS kind, COUNT(*) AS n ${from} GROUP BY items.kind`, p)) kinds[r.kind] = Number(r.n);
    const linkTypes: Record<string, number> = {};
    for (const r of this.db.all<{ t: string; n: number }>(`SELECT items.link_type AS t, COUNT(*) AS n ${from} AND items.link_type IS NOT NULL GROUP BY items.link_type`, p))
      linkTypes[r.t] = Number(r.n);
    const tags = this.db
      .all<{ name: string; n: number }>(
        `SELECT t.tag AS name, COUNT(*) AS n FROM item_tags t WHERE t.item_id IN (SELECT items.id ${from}) GROUP BY t.tag ORDER BY n DESC, name LIMIT 200`,
        p,
      )
      .map((r) => ({ name: r.name, count: Number(r.n) }));
    const domains = this.db
      .all<{ domain: string; n: number }>(
        `SELECT items.domain AS domain, COUNT(*) AS n ${from} AND items.domain IS NOT NULL GROUP BY items.domain ORDER BY n DESC LIMIT 30`,
        p,
      )
      .map((r) => ({ domain: r.domain, count: Number(r.n) }));
    const total = Number(this.db.get<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, p)?.n ?? 0);
    const pinned = Number(this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE deleted_at IS NULL AND pinned_at IS NOT NULL")?.n ?? 0);
    const trash = Number(this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE deleted_at IS NOT NULL")?.n ?? 0);
    return { total, pinned, trash, kinds, linkTypes, tags, domains };
  }

  /** Items that look or read alike: shared tags, colours, site and words. */
  similar(id: string, limit = 24): ItemCard[] {
    const row = this.getRow(id);
    if (!row) return [];
    const scores = new Map<string, number>();
    const bump = (other: string, n: number) => {
      if (other !== id) scores.set(other, (scores.get(other) ?? 0) + n);
    };
    for (const r of this.db.all<{ item_id: string; n: number }>(
      `SELECT t2.item_id, COUNT(*) AS n FROM item_tags t1 JOIN item_tags t2 ON t1.tag = t2.tag
       WHERE t1.item_id = ? AND t2.item_id != ? GROUP BY t2.item_id ORDER BY n DESC LIMIT 200`,
      [id, id],
    ))
      bump(r.item_id, Number(r.n) * 3);
    const colors = this.db.all<{ l: number; a: number; b: number; weight: number }>("SELECT l, a, b, weight FROM item_colors WHERE item_id = ?", [id]);
    for (const c of colors.slice(0, 3)) {
      for (const r of this.db.all<{ item_id: string; d: number; weight: number }>(
        `SELECT item_id, weight, ((l - ?) * (l - ?) + (a - ?) * (a - ?) + (b - ?) * (b - ?)) AS d
         FROM item_colors WHERE item_id != ? AND weight >= 0.1 AND d < 225 LIMIT 300`,
        [c.l, c.l, c.a, c.a, c.b, c.b, id],
      ))
        bump(r.item_id, 2 * c.weight * r.weight * 4 * (1 - Math.sqrt(r.d) / 15));
    }
    if (row.domain) {
      for (const r of this.db.all<{ id: string }>("SELECT id FROM items WHERE domain = ? AND id != ? LIMIT 50", [row.domain, id])) bump(r.id, 0.8);
    }
    const words = `${row.title ?? ""} ${row.description ?? ""}`
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 4)
      .slice(0, 12);
    if (words.length) {
      const match = [...new Set(words)].map((w) => `"${w}"`).join(" OR ");
      for (const r of this.db.all<{ item_id: string; rank: number }>(
        "SELECT item_id, bm25(items_fts) AS rank FROM items_fts WHERE items_fts MATCH ? ORDER BY rank LIMIT 40",
        [match],
      ))
        bump(r.item_id, 1.5);
    }
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit * 2).map(([k]) => k);
    if (!ranked.length) return [];
    const rows = this.db.all<ItemRow>(
      `SELECT ${CARD_COLUMNS} FROM items WHERE deleted_at IS NULL AND id IN (${ranked.map(() => "?").join(",")})`,
      ranked,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const tags = this.tagsFor(rows.map((r) => r.id));
    return ranked
      .map((k) => byId.get(k))
      .filter((r): r is ItemRow => !!r)
      .slice(0, limit)
      .map((r) => this.toCard(r, tags.get(r.id) ?? []));
  }

  /** A handful of older items to rediscover. Favours things not seen in a while. */
  serendipity(limit = 20): ItemCard[] {
    const rows = this.db.all<ItemRow>(
      `SELECT ${CARD_COLUMNS} FROM items WHERE deleted_at IS NULL
       ORDER BY (abs(random()) % 1000) * (1.0 + (strftime('%s','now') * 1000 - items.updated_at) / 86400000.0 / 30.0) DESC LIMIT ?`,
      [limit],
    );
    const tags = this.tagsFor(rows.map((r) => r.id));
    return rows.map((r) => this.toCard(r, tags.get(r.id) ?? []));
  }

  findByUrl(url: string): ItemRow | undefined {
    return this.db.get<ItemRow>("SELECT * FROM items WHERE url = ? AND deleted_at IS NULL AND kind = 'link' ORDER BY created_at DESC LIMIT 1", [url]);
  }

  // ---------------------------------------------------------------------------
  // Item connections (bidirectional links)

  linkItems(a: string, b: string): void {
    if (a === b) return;
    const [from, to] = a < b ? [a, b] : [b, a];
    this.db.tx(() => {
      const r = this.db.run("INSERT OR IGNORE INTO item_links (from_id, to_id, created_at) VALUES (?, ?, ?)", [from, to, Date.now()]);
      if (r.changes) this.logChange("item_link", `${from}\u0000${to}`, "add", { from_id: from, to_id: to });
    });
    this.emitEvent({ type: "item.updated", id: a });
    this.emitEvent({ type: "item.updated", id: b });
  }

  unlinkItems(a: string, b: string): void {
    const [from, to] = a < b ? [a, b] : [b, a];
    this.db.tx(() => {
      const r = this.db.run("DELETE FROM item_links WHERE from_id = ? AND to_id = ?", [from, to]);
      if (r.changes) this.logChange("item_link", `${from}\u0000${to}`, "remove", { from_id: from, to_id: to });
    });
    this.emitEvent({ type: "item.updated", id: a });
    this.emitEvent({ type: "item.updated", id: b });
  }

  // ---------------------------------------------------------------------------
  // Collections

  listCollections(): Collection[] {
    const rows = this.db.all<{
      id: string;
      name: string;
      description: string | null;
      icon: string | null;
      parent_id: string | null;
      kind: "manual" | "smart";
      query: string | null;
      view: "grid" | "canvas";
      position: number;
      created_at: number;
      updated_at: number;
      count: number;
      cover: string | null;
    }>(
      `SELECT c.*,
        (SELECT COUNT(*) FROM collection_items ci JOIN items i ON i.id = ci.item_id WHERE ci.collection_id = c.id AND i.deleted_at IS NULL) AS count,
        (SELECT COALESCE(i.preview, CASE WHEN i.kind = 'image' THEN i.asset END) FROM collection_items ci JOIN items i ON i.id = ci.item_id
          WHERE ci.collection_id = c.id AND i.deleted_at IS NULL AND (i.preview IS NOT NULL OR i.kind = 'image')
          ORDER BY ci.added_at DESC LIMIT 1) AS cover
       FROM collections c WHERE c.deleted_at IS NULL ORDER BY c.position, c.created_at`,
    );
    return rows.map((r) => {
      let count = Number(r.count);
      if (r.kind === "smart") {
        const q = parseQuery(r.query ?? "");
        if (!isEmptyQuery(q)) {
          const s = buildSearch(q);
          count = Number(
            this.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM items ${s.join} WHERE items.deleted_at IS NULL ${s.where.map((w) => `AND ${w}`).join(" ")}`, [
              ...s.joinParams,
              ...s.params,
            ])?.n ?? 0,
          );
        }
      }
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        icon: r.icon,
        parentId: r.parent_id,
        kind: r.kind,
        query: r.query,
        view: r.view,
        position: r.position,
        count,
        cover: r.cover,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
      };
    });
  }

  createCollection(input: { name: string; kind?: "manual" | "smart"; query?: string | null; icon?: string | null; description?: string | null; parentId?: string | null }): Collection {
    const id = ulid();
    const now = Date.now();
    const hlc = this.clock.now();
    const pos = Number(this.db.get<{ p: number }>("SELECT COALESCE(MAX(position), 0) + 1 AS p FROM collections")?.p ?? 1);
    const name = input.name.trim().slice(0, 120) || "Untitled";
    this.db.tx(() => {
      this.db.run(
        "INSERT INTO collections (id, name, description, icon, parent_id, kind, query, view, position, created_at, updated_at, hlc) VALUES (?, ?, ?, ?, ?, ?, ?, 'grid', ?, ?, ?, ?)",
        [id, name, input.description ?? null, input.icon ?? null, input.parentId ?? null, input.kind ?? "manual", input.query ?? null, pos, now, now, hlc],
      );
      this.logChange("collection", id, "create", { name, kind: input.kind ?? "manual", query: input.query ?? null, icon: input.icon ?? null, position: pos }, hlc);
    });
    this.emitEvent({ type: "collections.changed" });
    return this.listCollections().find((c) => c.id === id)!;
  }

  updateCollection(id: string, patch: Partial<Pick<Collection, "name" | "description" | "icon" | "query" | "view" | "position" | "parentId">>): void {
    const map: Record<string, string> = { name: "name", description: "description", icon: "icon", query: "query", view: "view", position: "position", parentId: "parent_id" };
    const sets: string[] = [];
    const vals: unknown[] = [];
    const logged: Record<string, unknown> = {};
    for (const [k, col] of Object.entries(map)) {
      const v = (patch as Record<string, unknown>)[k];
      if (v === undefined) continue;
      sets.push(`${col} = ?`);
      vals.push(v);
      logged[col] = v;
    }
    if (!sets.length) return;
    const hlc = this.clock.now();
    this.db.tx(() => {
      this.db.run(`UPDATE collections SET ${sets.join(", ")}, updated_at = ?, hlc = ? WHERE id = ?`, [...vals, Date.now(), hlc, id]);
      this.logChange("collection", id, "update", logged, hlc);
    });
    this.emitEvent({ type: "collections.changed" });
  }

  deleteCollection(id: string): void {
    const now = Date.now();
    this.db.tx(() => {
      this.db.run("UPDATE collections SET deleted_at = ?, updated_at = ? WHERE id = ?", [now, now, id]);
      this.db.run("DELETE FROM collection_items WHERE collection_id = ?", [id]);
      this.logChange("collection", id, "update", { deleted_at: now });
    });
    this.emitEvent({ type: "collections.changed" });
  }

  private addToCollectionTx(collectionId: string, ids: string[]): void {
    const now = Date.now();
    for (const id of ids) {
      const r = this.db.run("INSERT OR IGNORE INTO collection_items (collection_id, item_id, position, added_at) VALUES (?, ?, ?, ?)", [collectionId, id, now, now]);
      if (r.changes) this.logChange("collection_item", `${collectionId}\u0000${id}`, "add", { collection_id: collectionId, item_id: id });
    }
  }

  addToCollection(collectionId: string, ids: string[]): void {
    const c = this.db.get<{ kind: string }>("SELECT kind FROM collections WHERE id = ? AND deleted_at IS NULL", [collectionId]);
    if (!c || c.kind !== "manual") throw new Error("Items can only be added to regular collections");
    this.db.tx(() => this.addToCollectionTx(collectionId, ids));
    this.emitEvent({ type: "collections.changed" });
    for (const id of ids) this.emitEvent({ type: "item.updated", id });
  }

  removeFromCollection(collectionId: string, ids: string[]): void {
    this.db.tx(() => {
      for (const id of ids) {
        const r = this.db.run("DELETE FROM collection_items WHERE collection_id = ? AND item_id = ?", [collectionId, id]);
        if (r.changes) this.logChange("collection_item", `${collectionId}\u0000${id}`, "remove", { collection_id: collectionId, item_id: id });
      }
    });
    this.emitEvent({ type: "collections.changed" });
    for (const id of ids) this.emitEvent({ type: "item.updated", id });
  }

  getCanvas(collectionId: string): CanvasPlacement[] {
    return this.db
      .all<{ item_id: string; x: number | null; y: number | null; w: number | null; z: number }>(
        `SELECT ci.item_id, ci.x, ci.y, ci.w, ci.z FROM collection_items ci JOIN items i ON i.id = ci.item_id
         WHERE ci.collection_id = ? AND i.deleted_at IS NULL AND ci.x IS NOT NULL`,
        [collectionId],
      )
      .map((r) => ({ itemId: r.item_id, x: Number(r.x), y: Number(r.y), w: Number(r.w ?? 240), z: Number(r.z) }));
  }

  setCanvas(collectionId: string, placements: CanvasPlacement[]): void {
    this.db.tx(() => {
      for (const p of placements) {
        const r = this.db.run("UPDATE collection_items SET x = ?, y = ?, w = ?, z = ? WHERE collection_id = ? AND item_id = ?", [
          p.x,
          p.y,
          p.w,
          p.z,
          collectionId,
          p.itemId,
        ]);
        if (r.changes)
          this.logChange("collection_item", `${collectionId}\u0000${p.itemId}`, "update", { x: p.x, y: p.y, w: p.w, z: p.z });
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Stats

  itemCount(): number {
    return Number(this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE deleted_at IS NULL")?.n ?? 0);
  }
}

function mergeQueries(a: ParsedQuery, b: ParsedQuery): ParsedQuery {
  return {
    words: [...a.words, ...b.words],
    phrases: [...a.phrases, ...b.phrases],
    notWords: [...a.notWords, ...b.notWords],
    soft: [...a.soft, ...b.soft],
    types: b.types.length ? b.types : a.types,
    notTypes: [...a.notTypes, ...b.notTypes],
    tags: [...a.tags, ...b.tags],
    notTags: [...a.notTags, ...b.notTags],
    sites: b.sites.length ? b.sites : a.sites,
    notSites: [...a.notSites, ...b.notSites],
    colors: [...a.colors, ...b.colors],
    collections: [...a.collections, ...b.collections],
    has: [...a.has, ...b.has],
    notHas: [...a.notHas, ...b.notHas],
    pinned: b.pinned ?? a.pinned,
    after: b.after ?? a.after,
    before: b.before ?? a.before,
  };
}
