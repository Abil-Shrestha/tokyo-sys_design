import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { Database } from "./db";

export interface BlobInfo {
  hash: string;
  ext: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
}

/**
 * Storage for file contents, addressed by SHA-256. Identical files are stored
 * once, and a hash is a stable name for a file on every device, which is what
 * a future S3 (or any object store) backend needs. See docs/SYNC.md.
 */
export interface BlobStore {
  putBuffer(data: Buffer, hint?: { mime?: string; name?: string }): Promise<BlobInfo>;
  putStream(stream: Readable, hint?: { mime?: string; name?: string }): Promise<BlobInfo>;
  get(hash: string): BlobInfo | undefined;
  filePath(hash: string): string | null;
  read(hash: string): Promise<Buffer>;
  remove(hash: string): Promise<void>;
  setDimensions(hash: string, width: number, height: number): void;
}

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  htm: "text/html",
  json: "application/json",
  csv: "text/csv",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  key: "application/vnd.apple.keynote",
  psd: "image/vnd.adobe.photoshop",
  ai: "application/postscript",
  fig: "application/octet-stream",
  sketch: "application/octet-stream",
};

const MIME_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_MIME)
    .reverse()
    .map(([ext, mime]) => [mime, ext]),
);
MIME_EXT["image/jpeg"] = "jpg";
MIME_EXT["video/mp4"] = "mp4";
MIME_EXT["text/plain"] = "txt";
MIME_EXT["text/html"] = "html";

export function extFromName(name?: string): string | undefined {
  if (!name) return undefined;
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.split(/[?#]/)[0]);
  return m ? m[1].toLowerCase() : undefined;
}

export function mimeFromName(name?: string): string | undefined {
  const ext = extFromName(name);
  return ext ? EXT_MIME[ext] : undefined;
}

/** Recognises common formats from their first bytes. */
export function sniffMime(head: Buffer): string | undefined {
  const b = head;
  const ascii = (start: number, len: number) => b.subarray(start, start + len).toString("latin1");
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && ascii(1, 3) === "PNG") return "image/png";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (ascii(0, 5) === "%PDF-") return "application/pdf";
  if (ascii(0, 2) === "BM") return "image/bmp";
  if (ascii(0, 4) === "8BPS") return "image/vnd.adobe.photoshop";
  if (ascii(4, 4) === "ftyp") {
    const brand = ascii(8, 4);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "hevc", "mif1", "msf1"].includes(brand)) return "image/heic";
    if (brand === "qt  ") return "video/quicktime";
    if (brand.startsWith("M4A")) return "audio/mp4";
    return "video/mp4";
  }
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "audio/mpeg";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  if (ascii(0, 4) === "PK\x03\x04") return "application/zip";
  const text = b.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (text.startsWith("<svg") || (text.startsWith("<?xml") && text.includes("<svg"))) return "image/svg+xml";
  return undefined;
}

export class LocalBlobStore implements BlobStore {
  readonly root: string;
  private readonly tmp: string;

  constructor(
    private readonly db: Database,
    libraryPath: string,
  ) {
    this.root = path.join(libraryPath, "blobs");
    this.tmp = path.join(libraryPath, "tmp");
  }

  async init(): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(this.tmp, { recursive: true });
  }

  private resolveMime(head: Buffer, hint?: { mime?: string; name?: string }): { mime: string; ext: string } {
    const sniffed = sniffMime(head);
    const hinted = hint?.mime && hint.mime !== "application/octet-stream" ? hint.mime.split(";")[0].trim() : undefined;
    const fromName = mimeFromName(hint?.name);
    const mime = sniffed ?? fromName ?? hinted ?? "application/octet-stream";
    const nameExt = extFromName(hint?.name);
    const ext =
      (nameExt && EXT_MIME[nameExt] === mime ? nameExt : undefined) ??
      MIME_EXT[mime] ??
      (nameExt && !sniffed ? nameExt : undefined) ??
      "bin";
    return { mime, ext };
  }

  private blobPath(hash: string, ext: string): string {
    return path.join(this.root, hash.slice(0, 2), `${hash}.${ext}`);
  }

  private async commit(tmpFile: string, hash: string, size: number, head: Buffer, hint?: { mime?: string; name?: string }) {
    const existing = this.get(hash);
    if (existing && existsSync(this.blobPath(hash, existing.ext))) {
      await fs.rm(tmpFile, { force: true });
      return existing;
    }
    const { mime, ext } = this.resolveMime(head, hint);
    const dest = this.blobPath(hash, ext);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(tmpFile, dest);
    const info: BlobInfo = { hash, ext, mime, size, width: null, height: null };
    this.db.run(
      `INSERT INTO blobs (hash, ext, mime, size, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET ext = excluded.ext, mime = excluded.mime, size = excluded.size`,
      [hash, ext, mime, size, Date.now()],
    );
    return info;
  }

  async putBuffer(data: Buffer, hint?: { mime?: string; name?: string }): Promise<BlobInfo> {
    const hash = createHash("sha256").update(data).digest("hex");
    const existing = this.get(hash);
    if (existing && existsSync(this.blobPath(hash, existing.ext))) return existing;
    const tmpFile = path.join(this.tmp, randomBytes(8).toString("hex"));
    await fs.writeFile(tmpFile, data);
    return this.commit(tmpFile, hash, data.length, data.subarray(0, 4100), hint);
  }

  async putStream(stream: Readable, hint?: { mime?: string; name?: string }): Promise<BlobInfo> {
    const tmpFile = path.join(this.tmp, randomBytes(8).toString("hex"));
    const hasher = createHash("sha256");
    let size = 0;
    let head = Buffer.alloc(0);
    stream.on("data", (chunk: Buffer) => {
      hasher.update(chunk);
      size += chunk.length;
      if (head.length < 4100) head = Buffer.concat([head, chunk.subarray(0, 4100 - head.length)]);
    });
    try {
      await pipeline(stream, createWriteStream(tmpFile));
    } catch (err) {
      await fs.rm(tmpFile, { force: true });
      throw err;
    }
    return this.commit(tmpFile, hasher.digest("hex"), size, head, hint);
  }

  get(hash: string): BlobInfo | undefined {
    if (!/^[0-9a-f]{64}$/.test(hash)) return undefined;
    return this.db.get<BlobInfo>("SELECT hash, ext, mime, size, width, height FROM blobs WHERE hash = ?", [hash]);
  }

  filePath(hash: string): string | null {
    const info = this.get(hash);
    if (!info) return null;
    const p = this.blobPath(hash, info.ext);
    return existsSync(p) ? p : null;
  }

  async read(hash: string): Promise<Buffer> {
    const p = this.filePath(hash);
    if (!p) throw new Error(`blob ${hash} not found`);
    return fs.readFile(p);
  }

  stream(hash: string): Readable {
    const p = this.filePath(hash);
    if (!p) throw new Error(`blob ${hash} not found`);
    return createReadStream(p);
  }

  async remove(hash: string): Promise<void> {
    const info = this.get(hash);
    if (!info) return;
    await fs.rm(this.blobPath(hash, info.ext), { force: true });
    this.db.run("DELETE FROM blobs WHERE hash = ?", [hash]);
  }

  setDimensions(hash: string, width: number, height: number): void {
    this.db.run("UPDATE blobs SET width = ?, height = ? WHERE hash = ?", [width, height, hash]);
  }

  stats(): { count: number; bytes: number } {
    const r = this.db.get<{ count: number; bytes: number }>("SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM blobs");
    return { count: Number(r?.count ?? 0), bytes: Number(r?.bytes ?? 0) };
  }
}
