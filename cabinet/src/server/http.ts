import { timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { CanvasPlacement, CreateItemInput, LibraryEvent, LibraryInfo, Settings, UpdateItemInput } from "../shared/types";
import { AI_MODELS, enrichWithClaude, AiError } from "./enrich/ai";
import { isHttpUrl } from "./enrich/fetch";
import type { Cabinet } from "./engine";
import { importBookmarks, parseBookmarksCsv, parseBookmarksHtml } from "./importers";
import type { SortOrder } from "./search";

export interface ServerOptions {
  /** Directory with the built UI (index.html + assets). */
  webRoot?: string | null;
  version?: string;
  desktop?: boolean;
  /** Called by POST /api/reveal to show a file in Finder/Explorer. */
  reveal?: (filePath: string) => void;
  logger?: boolean;
}

const SESSION_COOKIE = "cabinet_session";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const SORTS: SortOrder[] = ["newest", "oldest", "updated", "title", "random", "relevance"];

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookie(req: FastifyRequest, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function isExtensionOrigin(origin: string | undefined): boolean {
  return !!origin && /^(chrome|moz|safari-web)-extension:\/\//.test(origin);
}

function str(v: unknown, max = 100_000): string | undefined {
  if (typeof v !== "string") return undefined;
  return v.length > max ? v.slice(0, max) : v;
}

function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string").slice(0, 1000);
}

function ids(v: unknown): string[] {
  const list = strArray(v) ?? [];
  if (!list.length) throw new HttpError(400, "ids required");
  return list;
}

function dataUrlToBuffer(dataUrl: string | undefined): Buffer | null {
  if (!dataUrl) return null;
  const m = /^data:image\/[\w+.-]+;base64,(.+)$/s.exec(dataUrl);
  return m ? Buffer.from(m[1], "base64") : null;
}

export async function createServer(cabinet: Cabinet, opts: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 60 * 1024 * 1024 });
  const lib = cabinet.lib;
  const token = () => cabinet.config.get().token;
  let boundPort = 0;

  await app.register(multipart, { limits: { fileSize: 4 * 1024 * 1024 * 1024, files: 500 } });
  app.addContentTypeParser(/^image\/.*/, { parseAs: "buffer" }, (_req, body, done) => done(null, body));
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => done(null, body));

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const status = err instanceof HttpError ? err.statusCode : (err.statusCode ?? 500);
    if (status >= 500) cabinet.logger.error(err.stack ?? err.message);
    void reply.status(status).send({ error: err.message || "Something went wrong" });
  });

  // DNS rebinding protection: only answer to local host names.
  app.addHook("onRequest", async (req, reply) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
    if (!LOCAL_HOSTS.has(host)) {
      await reply.status(403).send({ error: "Cabinet only accepts local connections" });
      return reply;
    }
    const origin = req.headers.origin;
    if (isExtensionOrigin(origin)) {
      void reply.header("Access-Control-Allow-Origin", origin);
      void reply.header("Vary", "Origin");
      void reply.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Cabinet-Client");
      void reply.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
      if (req.method === "OPTIONS") {
        await reply.status(204).send();
        return reply;
      }
    }
  });

  // Authentication for the API: a bearer token (browser extension, dev UI) or
  // the session cookie set when the UI is served, plus a custom header on
  // writes so other sites cannot forge requests.
  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/") || req.url === "/api/ping") return;
    const auth = req.headers.authorization;
    const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
    const queryToken = req.url.startsWith("/api/events") ? (req.query as Record<string, string>)?.token : null;
    const session = cookie(req, SESSION_COOKIE);
    const t = token();
    if ((bearer && safeEqual(bearer, t)) || (queryToken && safeEqual(queryToken, t))) return;
    if (session && safeEqual(session, t)) {
      if (req.method === "GET" || req.method === "HEAD" || req.headers["x-cabinet-client"]) return;
    }
    await reply.status(401).send({ error: "Not authorised" });
    return reply;
  });

  // ---------------------------------------------------------------------------
  // Library info and settings

  const info = (): LibraryInfo => {
    const stats = lib.blobs.stats();
    return {
      path: lib.path,
      deviceId: lib.deviceId,
      version: opts.version ?? "0.0.0",
      itemCount: lib.itemCount(),
      blobCount: stats.count,
      blobBytes: stats.bytes,
      port: boundPort,
      token: token(),
      capabilities: { snapshots: !!cabinet.snapshot, desktop: !!opts.desktop },
    };
  };

  app.get("/api/ping", async () => ({ ok: true, app: "cabinet" }));
  app.get("/api/info", async () => info());

  app.get("/api/settings", async () => ({ ...cabinet.settings(), models: AI_MODELS }));
  app.patch("/api/settings", async (req) => {
    const body = (req.body ?? {}) as Partial<Settings> & { aiKey?: string | null };
    if (body.aiKey !== undefined) {
      cabinet.config.update({ aiKey: body.aiKey ? String(body.aiKey).trim() : undefined });
    }
    const patch: Partial<Settings> = {};
    if (typeof body.aiEnabled === "boolean") patch.aiEnabled = body.aiEnabled;
    if (typeof body.aiModel === "string" && body.aiModel.startsWith("claude-")) patch.aiModel = body.aiModel;
    if (typeof body.autoTag === "boolean") patch.autoTag = body.autoTag;
    if (typeof body.fetchLinkPreviews === "boolean") patch.fetchLinkPreviews = body.fetchLinkPreviews;
    if (typeof body.trashRetentionDays === "number" && body.trashRetentionDays >= 0) patch.trashRetentionDays = Math.round(body.trashRetentionDays);
    lib.setSettings(patch);
    return { ...cabinet.settings(), models: AI_MODELS };
  });

  app.post("/api/settings/test-ai", async (req) => {
    const body = (req.body ?? {}) as { aiKey?: string; aiModel?: string };
    const key = body.aiKey?.trim() || cabinet.config.get().aiKey;
    if (!key) throw new HttpError(400, "Add an API key first");
    try {
      const r = await enrichWithClaude(key, body.aiModel || cabinet.settings().aiModel, {
        kind: "note",
        linkType: null,
        title: "Test",
        description: null,
        url: null,
        siteName: null,
        text: "A short note about planting tomatoes on a sunny balcony in spring.",
        note: null,
        vocabulary: [],
      });
      return { ok: true, tags: r.tags };
    } catch (err) {
      if (err instanceof AiError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  app.post("/api/ai/backfill", async () => {
    if (!cabinet.settings().aiEnabled || !cabinet.config.get().aiKey) throw new HttpError(400, "Turn on AI and add a key first");
    const rows = lib.db.all<{ id: string }>(
      "SELECT id FROM items WHERE deleted_at IS NULL AND (ai_status IS NULL OR ai_status = 'skipped' OR ai_status LIKE 'failed%') ORDER BY created_at DESC LIMIT 5000",
    );
    for (const r of rows) cabinet.jobs.enqueue("ai", r.id);
    return { queued: rows.length };
  });

  app.get("/api/jobs", async () => ({ pending: cabinet.jobs.pending() }));

  // ---------------------------------------------------------------------------
  // Items

  app.get("/api/items", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const sort = SORTS.includes(q.sort as SortOrder) ? (q.sort as SortOrder) : undefined;
    return lib.listItems({
      q: q.q,
      collectionId: q.collection || undefined,
      sort,
      cursor: q.cursor,
      limit: q.limit ? Number(q.limit) : undefined,
      trash: q.trash === "1" || q.trash === "true",
      seed: q.seed ? Number(q.seed) : undefined,
    });
  });

  app.get("/api/facets", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    return lib.facets({ q: q.q, collectionId: q.collection || undefined });
  });

  app.get("/api/items/:id", async (req) => {
    const item = lib.getItem((req.params as { id: string }).id);
    if (!item) throw new HttpError(404, "Item not found");
    return item;
  });

  app.post("/api/items", async (req) => {
    const body = (req.body ?? {}) as CreateItemInput & { src?: string };
    const common = {
      tags: strArray(body.tags),
      collectionId: str(body.collectionId, 64) ?? null,
      note: str(body.note) ?? null,
      source: str(body.source, 40) ?? "app",
    };
    let result;
    if (body.kind === "image" || body.kind === "video" || body.src) {
      const src = str(body.src, 50_000_000) ?? str(body.url, 50_000_000);
      if (!src) throw new HttpError(400, "src required");
      result = await cabinet.addRemoteFile(src, { ...common, title: str(body.title, 400) ?? null, pageUrl: str(body.pageUrl, 4000) ?? null });
    } else if (body.kind === "quote") {
      const text = str(body.body);
      if (!text?.trim()) throw new HttpError(400, "Quote text required");
      result = cabinet.addQuote(text, { ...common, url: str(body.pageUrl, 4000) ?? str(body.url, 4000) ?? null, title: str(body.pageTitle, 400) ?? str(body.title, 400) ?? null });
    } else if (body.kind === "note" || (!body.url && body.body !== undefined)) {
      const text = str(body.body) ?? "";
      result = cabinet.addNote(text, { ...common, title: str(body.title, 400) ?? null });
    } else if (body.url) {
      if (!isHttpUrl(body.url)) throw new HttpError(400, "That doesn't look like a web link");
      result = await cabinet.addUrl(body.url, {
        ...common,
        title: str(body.title, 400) ?? str(body.pageTitle, 400) ?? null,
        snapshot: dataUrlToBuffer(str(body.snapshot, 30_000_000)),
      });
    } else {
      throw new HttpError(400, "Nothing to save");
    }
    return { ...result, item: lib.getItem(result.id) };
  });

  app.post("/api/upload", async (req) => {
    const created: string[] = [];
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === "field") {
        fields[part.fieldname] = String(part.value);
        continue;
      }
      const tags = fields.tags ? fields.tags.split(",").filter(Boolean) : undefined;
      const r = await cabinet.addFile(part.file, {
        name: part.filename,
        mime: part.mimetype,
        tags,
        collectionId: fields.collectionId || null,
        source: fields.source || "upload",
      });
      if (part.file.truncated) {
        await lib.purgeItems([r.id]);
        throw new HttpError(413, `${part.filename} is too large`);
      }
      created.push(r.id);
    }
    return { ids: created };
  });

  app.patch("/api/items/:id", async (req) => {
    const body = (req.body ?? {}) as UpdateItemInput;
    const patch: UpdateItemInput = {};
    if (body.title !== undefined) patch.title = body.title === null ? null : str(body.title, 1000);
    if (body.description !== undefined) patch.description = body.description === null ? null : str(body.description, 5000);
    if (body.body !== undefined) patch.body = body.body === null ? null : str(body.body, 2_000_000);
    if (body.note !== undefined) patch.note = body.note === null ? null : str(body.note, 200_000);
    if (body.url !== undefined) {
      if (body.url && !isHttpUrl(body.url)) throw new HttpError(400, "Invalid link");
      patch.url = body.url || null;
    }
    if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
    if (body.tags) patch.tags = strArray(body.tags);
    if (body.userTags) patch.userTags = strArray(body.userTags);
    const item = lib.updateItem((req.params as { id: string }).id, patch);
    if (!item) throw new HttpError(404, "Item not found");
    return item;
  });

  app.post("/api/items/:id/refresh", async (req) => {
    cabinet.refresh((req.params as { id: string }).id);
    return { ok: true };
  });

  app.post("/api/items/:id/preview", async (req) => {
    const id = (req.params as { id: string }).id;
    let data: Buffer | null = null;
    if (Buffer.isBuffer(req.body)) data = req.body;
    else data = dataUrlToBuffer(str((req.body as { dataUrl?: string })?.dataUrl, 30_000_000));
    if (!data?.length) throw new HttpError(400, "Image required");
    await cabinet.setPreview(id, data);
    return { ok: true };
  });

  app.post("/api/items/:id/text", async (req) => {
    const body = (req.body ?? {}) as { text?: string; pages?: number };
    cabinet.setExtractedText((req.params as { id: string }).id, str(body.text, 2_000_000) ?? "", typeof body.pages === "number" ? body.pages : undefined);
    return { ok: true };
  });

  app.get("/api/items/:id/similar", async (req) => lib.similar((req.params as { id: string }).id));

  app.post("/api/items/:id/links", async (req) => {
    const target = str((req.body as { targetId?: string })?.targetId, 64);
    if (!target) throw new HttpError(400, "targetId required");
    lib.linkItems((req.params as { id: string }).id, target);
    return { ok: true };
  });
  app.delete("/api/items/:id/links/:target", async (req) => {
    const p = req.params as { id: string; target: string };
    lib.unlinkItems(p.id, p.target);
    return { ok: true };
  });

  app.post("/api/items/bulk", async (req) => {
    const body = (req.body ?? {}) as { action?: string; ids?: string[]; tags?: string[]; collectionId?: string };
    const list = ids(body.ids);
    switch (body.action) {
      case "trash":
        return { count: lib.trashItems(list) };
      case "restore":
        return { count: lib.restoreItems(list) };
      case "purge":
        return { count: await lib.purgeItems(list) };
      case "tag":
        lib.addTags(list, strArray(body.tags) ?? []);
        return { count: list.length };
      case "untag":
        lib.removeTags(list, strArray(body.tags) ?? []);
        return { count: list.length };
      case "collect":
        if (!body.collectionId) throw new HttpError(400, "collectionId required");
        lib.addToCollection(body.collectionId, list);
        return { count: list.length };
      case "uncollect":
        if (!body.collectionId) throw new HttpError(400, "collectionId required");
        lib.removeFromCollection(body.collectionId, list);
        return { count: list.length };
      case "pin":
      case "unpin":
        for (const id of list) lib.updateItem(id, { pinned: body.action === "pin" });
        return { count: list.length };
      case "refresh":
        for (const id of list) cabinet.refresh(id);
        return { count: list.length };
      default:
        throw new HttpError(400, "Unknown action");
    }
  });

  app.delete("/api/trash", async () => ({ count: await lib.emptyTrash() }));

  app.get("/api/serendipity", async (req) => {
    const limit = Number((req.query as Record<string, string>).limit ?? 20);
    return lib.serendipity(Math.min(Math.max(limit, 1), 100));
  });

  // ---------------------------------------------------------------------------
  // Tags and collections

  app.get("/api/tags", async () => lib.listTags());
  app.post("/api/tags/rename", async (req) => {
    const body = (req.body ?? {}) as { from?: string; to?: string };
    if (!body.from || !body.to) throw new HttpError(400, "from and to required");
    lib.renameTag(body.from, body.to);
    return { ok: true };
  });
  app.delete("/api/tags/:name", async (req) => {
    lib.deleteTag(decodeURIComponent((req.params as { name: string }).name));
    return { ok: true };
  });

  app.get("/api/collections", async () => lib.listCollections());
  app.post("/api/collections", async (req) => {
    const body = (req.body ?? {}) as { name?: string; kind?: "manual" | "smart"; query?: string; icon?: string; itemIds?: string[] };
    if (!body.name?.trim()) throw new HttpError(400, "Name required");
    const c = lib.createCollection({ name: body.name, kind: body.kind === "smart" ? "smart" : "manual", query: body.query ?? null, icon: body.icon ?? null });
    if (body.itemIds?.length && c.kind === "manual") lib.addToCollection(c.id, strArray(body.itemIds) ?? []);
    return lib.listCollections().find((x) => x.id === c.id) ?? c;
  });
  app.patch("/api/collections/:id", async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    lib.updateCollection((req.params as { id: string }).id, {
      name: str(body.name, 120),
      description: body.description === null ? null : str(body.description, 2000),
      icon: body.icon === null ? null : str(body.icon, 16),
      query: body.query === null ? null : str(body.query, 2000),
      view: body.view === "canvas" || body.view === "grid" ? body.view : undefined,
      position: typeof body.position === "number" ? body.position : undefined,
    });
    return lib.listCollections().find((c) => c.id === (req.params as { id: string }).id) ?? null;
  });
  app.delete("/api/collections/:id", async (req) => {
    lib.deleteCollection((req.params as { id: string }).id);
    return { ok: true };
  });
  app.get("/api/collections/:id/canvas", async (req) => lib.getCanvas((req.params as { id: string }).id));
  app.put("/api/collections/:id/canvas", async (req) => {
    const list = Array.isArray(req.body) ? (req.body as CanvasPlacement[]) : [];
    lib.setCanvas(
      (req.params as { id: string }).id,
      list
        .filter((p) => typeof p.itemId === "string" && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({ itemId: p.itemId, x: p.x, y: p.y, w: Number.isFinite(p.w) ? p.w : 240, z: Number.isFinite(p.z) ? Math.round(p.z) : 0 })),
    );
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Import / export

  app.post("/api/import/bookmarks", async (req) => {
    let text = "";
    let name = "";
    let collectionId: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === "file") {
        name = part.filename;
        text = (await part.toBuffer()).toString("utf8");
      } else if (part.fieldname === "collectionId") {
        collectionId = String(part.value) || null;
      }
    }
    if (!text) throw new HttpError(400, "Choose a bookmarks file");
    const list = /\.csv$/i.test(name) || !/<a\s/i.test(text) ? parseBookmarksCsv(text) : parseBookmarksHtml(text);
    if (!list.length) throw new HttpError(400, "No links found in that file");
    return importBookmarks(cabinet, list, { collectionId });
  });

  app.get("/api/export", async (_req, reply) => {
    const items = lib.db.all<Record<string, unknown>>("SELECT * FROM items WHERE deleted_at IS NULL ORDER BY created_at");
    const tags = lib.db.all<{ item_id: string; tag: string; source: string }>("SELECT item_id, tag, source FROM item_tags");
    const collections = lib.db.all("SELECT * FROM collections WHERE deleted_at IS NULL");
    const members = lib.db.all("SELECT * FROM collection_items");
    const byItem = new Map<string, { tag: string; source: string }[]>();
    for (const t of tags) byItem.set(t.item_id, [...(byItem.get(t.item_id) ?? []), { tag: t.tag, source: t.source }]);
    const payload = {
      format: "cabinet-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      items: items.map((i) => ({ ...i, colors: JSON.parse(String(i.colors ?? "[]")), meta: JSON.parse(String(i.meta ?? "{}")), tags: byItem.get(String(i.id)) ?? [] })),
      collections,
      collectionItems: members,
      note: "Files referenced by asset/preview/favicon hashes live in the library's blobs/ folder.",
    };
    const date = new Date().toISOString().slice(0, 10);
    void reply.header("Content-Disposition", `attachment; filename="cabinet-export-${date}.json"`);
    void reply.type("application/json");
    return JSON.stringify(payload, null, 1);
  });

  app.post("/api/reveal", async (req) => {
    if (!opts.reveal) throw new HttpError(400, "Only available in the desktop app");
    const hash = str((req.body as { hash?: string })?.hash, 64);
    const target = hash ? lib.blobs.filePath(hash) : lib.path;
    if (!target) throw new HttpError(404, "File not found");
    opts.reveal(target);
    return { ok: true };
  });

  // ---------------------------------------------------------------------------
  // Live updates

  app.get("/api/events", (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(isExtensionOrigin(req.headers.origin) ? { "Access-Control-Allow-Origin": req.headers.origin! } : {}),
    });
    reply.raw.write(`retry: 2000\n\n`);
    const send = (event: LibraryEvent) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    lib.on("event", send);
    req.raw.on("close", () => {
      clearInterval(ping);
      lib.off("event", send);
    });
  });

  // ---------------------------------------------------------------------------
  // Files

  app.get("/blobs/:hash", async (req, reply) => {
    const hash = (req.params as { hash: string }).hash.replace(/\..*$/, "");
    const blob = lib.blobs.get(hash);
    const file = blob && lib.blobs.filePath(hash);
    if (!blob || !file) throw new HttpError(404, "File not found");
    const q = req.query as Record<string, string>;
    if (q.download) {
      const name = (q.name || `file.${blob.ext}`).replace(/["\\\r\n]/g, "");
      void reply.header("Content-Disposition", `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    }
    void reply.header("Cache-Control", "private, max-age=31536000, immutable");
    void reply.header("X-Content-Type-Options", "nosniff");
    // SVGs can carry scripts; keep them from running if opened directly.
    if (blob.mime === "image/svg+xml") void reply.header("Content-Security-Policy", "script-src 'none'; sandbox");
    void reply.type(blob.mime);
    return reply.sendFile(path.basename(file), path.dirname(file), { cacheControl: false, contentType: false });
  });

  app.get("/thumbs/:hash", async (req, reply) => {
    const hash = (req.params as { hash: string }).hash;
    const width = Number((req.query as Record<string, string>).w ?? 480) || 480;
    const blob = lib.blobs.get(hash);
    const file = blob && lib.blobs.filePath(hash);
    if (!blob || !file) throw new HttpError(404, "File not found");
    void reply.header("Cache-Control", "private, max-age=31536000, immutable");
    if (!/^image\/(jpeg|png|gif|webp|avif|svg\+xml|tiff|bmp)$/.test(blob.mime)) {
      void reply.type(blob.mime);
      return reply.sendFile(path.basename(file), path.dirname(file), { cacheControl: false, contentType: false });
    }
    try {
      const thumb = await lib.thumbs.get(hash, file, width);
      void reply.type("image/webp");
      return reply.sendFile(path.basename(thumb), path.dirname(thumb), { cacheControl: false, contentType: false });
    } catch {
      void reply.type(blob.mime);
      return reply.sendFile(path.basename(file), path.dirname(file), { cacheControl: false, contentType: false });
    }
  });

  // The file routes above stream from the library; @fastify/static provides
  // reply.sendFile (with range requests for video seeking).
  await app.register(fastifyStatic, {
    root: opts.webRoot && existsSync(opts.webRoot) ? opts.webRoot : lib.path,
    serve: false,
  });

  // ---------------------------------------------------------------------------
  // The UI

  const webRoot = opts.webRoot && existsSync(path.join(opts.webRoot, "index.html")) ? opts.webRoot : null;
  const sendIndex = async (reply: FastifyReply) => {
    if (!webRoot) {
      void reply.type("text/html");
      return "<!doctype html><title>Cabinet</title><p style='font:16px system-ui;padding:40px'>Cabinet's library server is running, but the UI has not been built. Run <code>npm run build</code>.</p>";
    }
    const html = readFileSync(path.join(webRoot, "index.html"), "utf8");
    void reply.header("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(token())}; Path=/; HttpOnly; SameSite=Strict`);
    void reply.header("Cache-Control", "no-store");
    void reply.type("text/html");
    return html;
  };
  app.get("/", async (_req, reply) => sendIndex(reply));
  app.get("/index.html", async (_req, reply) => sendIndex(reply));
  app.get("/assets/*", async (req, reply) => {
    if (!webRoot) throw new HttpError(404, "Not found");
    const rel = path.normalize((req.params as { "*": string })["*"]).replace(/^(\.\.[/\\])+/, "");
    void reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.sendFile(path.join("assets", rel), webRoot);
  });
  app.get("/favicon.svg", async (_req, reply) => {
    if (!webRoot) throw new HttpError(404, "Not found");
    return reply.sendFile("favicon.svg", webRoot);
  });

  app.addHook("onListen", async () => {
    const address = app.server.address();
    if (address && typeof address === "object") boundPort = address.port;
  });

  return app;
}

/** Listens on the preferred port, falling back to the next free ones. */
export async function listen(app: FastifyInstance, port: number, host = "127.0.0.1"): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await app.listen({ port: port + attempt, host });
      const address = app.server.address();
      return typeof address === "object" && address ? address.port : port + attempt;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    }
  }
  await app.listen({ port: 0, host });
  const address = app.server.address();
  return typeof address === "object" && address ? address.port : 0;
}
