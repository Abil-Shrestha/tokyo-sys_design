import type { Readable } from "node:stream";
import sharp from "sharp";
import type { ItemKind } from "../shared/types";
import { extFromName, mimeFromName, type BlobInfo } from "./blobs";
import type { ConfigStore } from "./config";
import { AiError, enrichWithClaude, type AiInput } from "./enrich/ai";
import { cleanUrl, decodeHtml, FetchError, fetchResource, isHttpUrl, type FetchFn } from "./enrich/fetch";
import { extractPage, metadataTags } from "./enrich/html";
import { analyzeImage, canAnalyze, normalizeSnapshot } from "./images";
import { consoleLogger, JobRunner, RetryableError, type Job, type Logger } from "./jobs";
import { Library, domainOf, parseJson, type ItemFields } from "./library";

export type Snapshotter = (url: string) => Promise<Buffer | null>;

export interface CabinetOptions {
  libraryPath: string;
  config: ConfigStore;
  fetch?: FetchFn;
  snapshot?: Snapshotter;
  logger?: Logger;
  /** Start the background job runner (default true). */
  startJobs?: boolean;
}

export interface SaveOptions {
  title?: string | null;
  note?: string | null;
  tags?: string[];
  collectionId?: string | null;
  source?: string;
}

export interface SaveResult {
  id: string;
  duplicate?: boolean;
}

const MEDIA_EXT = /\.(jpe?g|png|gif|webp|avif|svg|mp4|m4v|mov|webm|mp3|m4a|wav|ogg|pdf)$/i;

export function kindForMime(mime: string): ItemKind {
  if (mime === "image/vnd.adobe.photoshop") return "file";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return "file";
}

function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]{1,8}$/i, "");
}

function parseDataUrl(dataUrl: string): { mime: string; data: Buffer } | null {
  const m = /^data:([\w/+.-]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const data = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
  return { mime: m[1] ?? "application/octet-stream", data };
}

export class Cabinet {
  readonly lib: Library;
  readonly jobs: JobRunner;
  readonly config: ConfigStore;
  readonly fetch: FetchFn;
  readonly snapshot?: Snapshotter;
  readonly logger: Logger;

  private constructor(lib: Library, opts: CabinetOptions) {
    this.lib = lib;
    this.config = opts.config;
    this.fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.snapshot = opts.snapshot;
    this.logger = opts.logger ?? consoleLogger;
    this.jobs = new JobRunner(
      lib.db,
      {
        link: (job) => this.enrichLink(job),
        snapshot: (job) => this.takeSnapshot(job),
        ai: (job) => this.enrichAi(job),
      },
      this.logger,
    );
    this.jobs.onFailure = (job, err, final) => {
      if (!final || !job.itemId || lib.isClosed) return;
      const message = err instanceof Error ? err.message : String(err);
      if (job.type === "link") lib.patchItem(job.itemId, { status: "failed", error: message }, { touch: false });
      if (job.type === "ai") lib.patchItem(job.itemId, { ai_status: `failed: ${message}` }, { touch: false });
    };
  }

  static async open(opts: CabinetOptions): Promise<Cabinet> {
    const lib = await Library.open({ path: opts.libraryPath, deviceId: opts.config.get().deviceId });
    const cabinet = new Cabinet(lib, opts);
    const retention = lib.getSettings(false).trashRetentionDays;
    if (retention > 0) await lib.emptyTrash(Date.now() - retention * 86_400_000).catch(() => 0);
    if (opts.startJobs !== false) cabinet.jobs.start();
    return cabinet;
  }

  async close(): Promise<void> {
    await this.jobs.stop();
    this.lib.close();
  }

  settings() {
    return this.lib.getSettings(!!this.config.get().aiKey);
  }

  private aiEnabled(): boolean {
    const s = this.settings();
    return s.aiEnabled && !!this.config.get().aiKey;
  }

  private afterSave(id: string): void {
    if (this.aiEnabled()) this.jobs.enqueue("ai", id);
  }

  // ---------------------------------------------------------------------------
  // Saving things

  addNote(body: string, opts: SaveOptions = {}): SaveResult {
    const id = this.lib.insertItem(
      { kind: "note", body, title: opts.title ?? null, note: opts.note ?? null, source: opts.source ?? "app" },
      { tags: opts.tags, collectionId: opts.collectionId ?? undefined },
    );
    this.afterSave(id);
    return { id };
  }

  addQuote(text: string, opts: SaveOptions & { url?: string | null } = {}): SaveResult {
    const url = opts.url && isHttpUrl(opts.url) ? cleanUrl(opts.url) : null;
    const id = this.lib.insertItem(
      {
        kind: "quote",
        body: text.trim(),
        title: opts.title ?? null,
        url,
        note: opts.note ?? null,
        source: opts.source ?? "app",
      },
      { tags: opts.tags, collectionId: opts.collectionId ?? undefined },
    );
    this.afterSave(id);
    return { id };
  }

  async addUrl(rawUrl: string, opts: SaveOptions & { snapshot?: Buffer | null } = {}): Promise<SaveResult> {
    if (!isHttpUrl(rawUrl.trim())) throw new Error("Only http(s) links can be saved");
    const url = cleanUrl(rawUrl);
    const path = new URL(url).pathname;
    if (MEDIA_EXT.test(path)) {
      try {
        return await this.addRemoteFile(url, { ...opts, pageUrl: url });
      } catch (err) {
        this.logger.warn(`could not download ${url} as a file, saving as a link: ${(err as Error).message}`);
      }
    }
    const existing = this.lib.findByUrl(url);
    if (existing) {
      if (opts.tags?.length) this.lib.addTags([existing.id], opts.tags);
      if (opts.collectionId) this.lib.addToCollection(opts.collectionId, [existing.id]);
      if (opts.snapshot?.length && !existing.preview) {
        await this.setPreview(existing.id, opts.snapshot).catch(() => {});
      }
      return { id: existing.id, duplicate: true };
    }
    const fields: ItemFields & { kind: "link" } = {
      kind: "link",
      link_type: "website",
      url,
      domain: domainOf(url),
      title: null,
      note: opts.note ?? null,
      source: opts.source ?? "app",
      status: "pending",
      meta: opts.title ? { captureTitle: opts.title } : {},
    };
    if (opts.snapshot?.length) {
      try {
        const blob = await this.storeImage(await normalizeSnapshot(opts.snapshot), "snapshot.webp");
        fields.preview = blob.info.hash;
        fields.width = blob.width;
        fields.height = blob.height;
        fields.colors = blob.colors;
        fields.meta = { ...(fields.meta ?? {}), snapshot: true };
      } catch (err) {
        this.logger.warn(`ignoring unreadable snapshot: ${(err as Error).message}`);
      }
    }
    const id = this.lib.insertItem(fields, { tags: opts.tags, collectionId: opts.collectionId ?? undefined });
    this.jobs.enqueue("link", id);
    return { id };
  }

  /** Stores an image blob and analyses it for size and colours. */
  private async storeImage(data: Buffer, name: string) {
    const info = await this.lib.blobs.putBuffer(data, { name });
    let width: number | null = null;
    let height: number | null = null;
    let colors: { hex: string; weight: number }[] = [];
    if (canAnalyze(info.mime)) {
      const a = await analyzeImage(data);
      width = a.width;
      height = a.height;
      colors = a.colors;
      this.lib.blobs.setDimensions(info.hash, a.width, a.height);
    }
    return { info, width, height, colors };
  }

  async addFile(input: Readable | Buffer, meta: SaveOptions & { name?: string; mime?: string; url?: string | null; pageUrl?: string | null }): Promise<SaveResult> {
    const hint = { name: meta.name, mime: meta.mime };
    const info: BlobInfo = Buffer.isBuffer(input) ? await this.lib.blobs.putBuffer(input, hint) : await this.lib.blobs.putStream(input, hint);
    const kind = kindForMime(info.mime);
    const name = meta.name?.split(/[\\/]/).pop() || `${kind}.${info.ext}`;

    // Small text files become notes you can edit.
    if (kind === "file" && /^text\/(plain|markdown)$/.test(info.mime) && info.size < 256 * 1024) {
      const body = (await this.lib.blobs.read(info.hash)).toString("utf8");
      await this.lib.collectGarbage([info.hash]);
      return this.addNote(body, { ...meta, title: meta.title ?? null, source: meta.source ?? "file" });
    }

    const fields: ItemFields & { kind: ItemKind } = {
      kind,
      asset: info.hash,
      asset_name: name,
      mime: info.mime,
      size: info.size,
      title: meta.title ?? (kind === "image" || kind === "video" ? null : stripExt(name)),
      note: meta.note ?? null,
      url: meta.pageUrl ?? meta.url ?? null,
      source: meta.source ?? "file",
      meta: meta.url && meta.pageUrl && meta.url !== meta.pageUrl ? { sourceUrl: meta.url } : {},
    };
    if (kind === "image" && canAnalyze(info.mime)) {
      try {
        const path = this.lib.blobs.filePath(info.hash)!;
        const a = await analyzeImage(path);
        fields.width = a.width;
        fields.height = a.height;
        fields.colors = a.colors;
        this.lib.blobs.setDimensions(info.hash, a.width, a.height);
      } catch (err) {
        this.logger.warn(`could not analyse image ${name}: ${(err as Error).message}`);
      }
    }
    const id = this.lib.insertItem(fields, { tags: meta.tags, collectionId: meta.collectionId ?? undefined });
    if (kind === "image" || kind === "pdf" || kind === "file" || kind === "audio") this.afterSave(id);
    return { id };
  }

  /** Downloads an image/video/file from the web and saves it. */
  async addRemoteFile(src: string, opts: SaveOptions & { pageUrl?: string | null } = {}): Promise<SaveResult> {
    if (src.startsWith("data:")) {
      const parsed = parseDataUrl(src);
      if (!parsed) throw new Error("Unreadable data URL");
      return this.addFile(parsed.data, { ...opts, mime: parsed.mime, name: `image.${parsed.mime.split("/")[1] ?? "bin"}` });
    }
    if (!isHttpUrl(src)) throw new Error("Only http(s) files can be saved");
    const res = await fetchResource(this.fetch, src, {
      maxBytes: 512 * 1024 * 1024,
      timeoutMs: 120_000,
      accept: "image/avif,image/webp,image/*,video/*,*/*;q=0.8",
      referer: opts.pageUrl ?? undefined,
    });
    if (res.truncated) throw new Error("File is too large");
    if (res.contentType.includes("text/html")) throw new Error("Not a file");
    const name = decodeURIComponent(new URL(res.url).pathname.split("/").pop() || "download");
    const mime = res.contentType.split(";")[0] || mimeFromName(name);
    const pageUrl = opts.pageUrl && isHttpUrl(opts.pageUrl) ? cleanUrl(opts.pageUrl) : null;
    return this.addFile(res.body, {
      ...opts,
      name: extFromName(name) ? name : `${name}.${(mime ?? "").split("/")[1] ?? "bin"}`,
      mime,
      url: src,
      pageUrl: pageUrl ?? src,
      source: opts.source ?? "web",
    });
  }

  /** Attaches a poster image (video frame, PDF page) generated by the UI. */
  async setPreview(id: string, data: Buffer): Promise<void> {
    const row = this.lib.getRow(id);
    if (!row) throw new Error("Item not found");
    const img = await this.storeImage(await normalizeSnapshot(data), "preview.webp");
    const old = row.preview;
    this.lib.patchItem(id, { preview: img.info.hash, width: img.width, height: img.height, colors: img.colors }, { touch: false });
    if (old && old !== img.info.hash) await this.lib.collectGarbage([old]);
    if (row.kind === "video" && this.aiEnabled() && !row.ai_status) this.jobs.enqueue("ai", id);
  }

  /** Saves text the UI extracted from a document (e.g. a PDF) for search. */
  setExtractedText(id: string, text: string, pages?: number): void {
    const row = this.lib.getRow(id);
    if (!row) throw new Error("Item not found");
    const meta = parseJson<Record<string, unknown>>(row.meta, {});
    const words = text.split(/\s+/).filter(Boolean).length;
    this.lib.patchItem(id, { content: text.slice(0, 500_000), meta: { ...meta, pages, wordCount: words } }, { touch: false });
  }

  /** Re-runs metadata fetching and AI enrichment for an item. */
  refresh(id: string): void {
    const row = this.lib.getRow(id);
    if (!row) return;
    if (row.kind === "link") {
      this.lib.patchItem(id, { status: "pending", error: null }, { touch: false });
      this.jobs.enqueue("link", id, { force: true });
    } else if (this.aiEnabled()) {
      this.lib.patchItem(id, { ai_status: "pending" }, { touch: false });
      this.jobs.enqueue("ai", id);
    }
  }

  // ---------------------------------------------------------------------------
  // Background jobs

  private async enrichLink(job: Job): Promise<void> {
    const id = job.itemId!;
    const row = this.lib.getRow(id);
    if (!row || !row.url) return;
    const settings = this.settings();
    const meta = parseJson<Record<string, unknown>>(row.meta, {});
    const captureTitle = typeof meta.captureTitle === "string" ? meta.captureTitle : null;

    if (!settings.fetchLinkPreviews) {
      this.lib.patchItem(id, { status: "ready", title: row.title ?? captureTitle }, { touch: false });
      this.afterSave(id);
      return;
    }

    let res;
    try {
      res = await fetchResource(this.fetch, row.url);
    } catch (err) {
      if (err instanceof FetchError && err.retryable && job.attempts < 1) throw new RetryableError(err.message);
      const message = err instanceof Error ? err.message : String(err);
      this.lib.patchItem(id, { status: "failed", error: message, title: row.title ?? captureTitle }, { touch: false });
      if (!row.preview && this.snapshot) this.jobs.enqueue("snapshot", id);
      this.afterSave(id);
      return;
    }

    const ct = res.contentType;
    if (/^(image|video|audio)\//.test(ct) || ct.startsWith("application/pdf")) {
      // A link that turned out to be a file: keep it as the real thing.
      const info = await this.lib.blobs.putBuffer(res.body, { mime: ct, name: new URL(res.url).pathname });
      const kind = kindForMime(info.mime);
      const fields: ItemFields = { kind, link_type: null, asset: info.hash, asset_name: new URL(res.url).pathname.split("/").pop() || null, mime: info.mime, size: info.size, status: "ready", error: null };
      if (kind === "image" && canAnalyze(info.mime)) {
        const a = await analyzeImage(res.body);
        Object.assign(fields, { width: a.width, height: a.height, colors: a.colors });
      }
      this.lib.patchItem(id, fields, { touch: false });
      this.afterSave(id);
      return;
    }

    if (!ct.includes("html") && !ct.includes("xml") && ct !== "") {
      this.lib.patchItem(id, { status: "ready", error: null, title: row.title ?? captureTitle }, { touch: false });
      this.afterSave(id);
      return;
    }

    const page = extractPage(decodeHtml(res.body, ct), res.url);
    const fields: ItemFields = {
      status: "ready",
      error: null,
      title: row.title ?? page.title ?? captureTitle,
      description: page.description,
      site_name: page.siteName,
      author: page.author,
      link_type: page.linkType,
      meta: { ...meta, ...page.meta, canonical: page.canonical ?? undefined },
      content: page.article?.text ?? null,
      content_html: page.article && (page.linkType === "article" || page.article.words >= 350) ? page.article.html : null,
    };

    // Preview image: keep a local copy so the card survives link rot.
    const hadSnapshot = !!meta.snapshot && !!row.preview;
    if (page.image && (!row.preview || hadSnapshot || job.payload.force)) {
      try {
        const img = await fetchResource(this.fetch, page.image, { maxBytes: 20 * 1024 * 1024, accept: "image/avif,image/webp,image/*,*/*;q=0.5", referer: res.url });
        if (img.contentType.startsWith("image/") || !img.contentType) {
          const stored = await this.storeImage(img.body, new URL(img.url).pathname);
          if (stored.width && stored.width >= 80) {
            const old = row.preview;
            fields.preview = stored.info.hash;
            fields.width = stored.width;
            fields.height = stored.height;
            fields.colors = stored.colors;
            if (old && old !== stored.info.hash && !hadSnapshot) void this.lib.collectGarbage([old]);
          }
        }
      } catch (err) {
        this.logger.warn(`preview image for ${row.url} failed: ${(err as Error).message}`);
      }
    }

    if (page.favicon) {
      try {
        const icon = await fetchResource(this.fetch, page.favicon, { maxBytes: 512 * 1024, timeoutMs: 8000, accept: "image/*" });
        if (icon.body.length > 0 && (icon.contentType.startsWith("image/") || /\.(ico|png|svg)$/i.test(page.favicon))) {
          const info = await this.lib.blobs.putBuffer(icon.body, { mime: icon.contentType, name: new URL(icon.url).pathname });
          if (info.mime.startsWith("image/")) fields.favicon = info.hash;
        }
      } catch {
        // favicons are optional
      }
    }

    this.lib.patchItem(id, fields, { touch: false });
    if (settings.autoTag) this.lib.replaceGeneratedTags(id, metadataTags(page), "auto");
    if (!fields.preview && !row.preview && this.snapshot) this.jobs.enqueue("snapshot", id);
    this.afterSave(id);
  }

  private async takeSnapshot(job: Job): Promise<void> {
    const id = job.itemId!;
    const row = this.lib.getRow(id);
    if (!row?.url || !this.snapshot || (row.preview && !job.payload.force)) return;
    const png = await this.snapshot(row.url);
    if (!png) return;
    const img = await this.storeImage(await normalizeSnapshot(png), "snapshot.webp");
    const meta = parseJson<Record<string, unknown>>(row.meta, {});
    this.lib.patchItem(id, { preview: img.info.hash, width: img.width, height: img.height, colors: img.colors, meta: { ...meta, snapshot: true } }, { touch: false });
  }

  private async imageForAi(hash: string | null): Promise<AiInput["image"] | undefined> {
    if (!hash) return undefined;
    const path = this.lib.blobs.filePath(hash);
    const info = this.lib.blobs.get(hash);
    if (!path || !info || !canAnalyze(info.mime)) return undefined;
    const data = await sharp(path, { failOn: "none", pages: 1 })
      .rotate()
      .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { data: data.toString("base64"), mediaType: "image/jpeg" };
  }

  private async enrichAi(job: Job): Promise<void> {
    const id = job.itemId!;
    const row = this.lib.getRow(id);
    if (!row || row.deleted_at) return;
    const key = this.config.get().aiKey;
    const settings = this.settings();
    if (!key || !settings.aiEnabled) {
      this.lib.patchItem(id, { ai_status: "skipped" }, { touch: false, silent: true });
      return;
    }
    if (row.kind === "link" && row.status === "pending") {
      // Wait for the page metadata first.
      this.jobs.enqueue("ai", id, {}, 3000);
      return;
    }
    const imageHash = row.kind === "image" ? row.asset : row.preview;
    const text = row.kind === "note" || row.kind === "quote" ? row.body : row.content;
    const input: AiInput = {
      kind: row.kind,
      linkType: row.link_type,
      title: row.title ?? row.asset_name,
      description: row.description,
      url: row.url,
      siteName: row.site_name,
      text: text ? text.slice(0, 12_000) : null,
      note: row.note,
      image: await this.imageForAi(imageHash).catch(() => undefined),
      vocabulary: this.lib
        .listTags()
        .slice(0, 80)
        .map((t) => t.name),
    };
    if (!input.image && !input.text && !input.title && !input.description) {
      this.lib.patchItem(id, { ai_status: "skipped" }, { touch: false, silent: true });
      return;
    }
    this.lib.patchItem(id, { ai_status: "running" }, { touch: false, silent: true });
    let result;
    try {
      result = await enrichWithClaude(key, settings.aiModel, input);
    } catch (err) {
      if (err instanceof AiError && err.retryable) throw new RetryableError(err.message);
      throw err;
    }
    const fresh = this.lib.getRow(id);
    if (!fresh) return;
    const meta = parseJson<Record<string, unknown>>(fresh.meta, {});
    const visual = fresh.kind === "image" || fresh.kind === "video";
    this.lib.patchItem(
      id,
      {
        summary: visual ? (result.imageDescription ?? result.summary) : (result.summary ?? result.imageDescription),
        meta: { ...meta, imageText: result.imageText ?? undefined },
        ai_status: "done",
      },
      { touch: false },
    );
    this.lib.replaceGeneratedTags(id, result.tags, "ai");
  }
}
