import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ColorSwatch } from "../shared/types";
import { extractPalette } from "./colors";

sharp.cache({ memory: 64, files: 0, items: 100 });
sharp.concurrency(2);

export const THUMB_WIDTHS = [240, 480, 960, 1600];

export interface ImageAnalysis {
  width: number;
  height: number;
  format: string | undefined;
  animated: boolean;
  colors: ColorSwatch[];
}

const RASTERISABLE = /^image\/(jpeg|png|gif|webp|avif|svg\+xml|tiff|bmp)$/;

export function canAnalyze(mime: string | null | undefined): boolean {
  return !!mime && RASTERISABLE.test(mime);
}

export async function analyzeImage(input: string | Buffer): Promise<ImageAnalysis> {
  const img = sharp(input, { failOn: "none", limitInputPixels: 268_402_689 });
  const meta = await img.metadata();
  let width = meta.width ?? 0;
  let height = meta.pageHeight && meta.pages && meta.pages > 1 ? meta.pageHeight : (meta.height ?? 0);
  // EXIF orientations 5-8 rotate by 90 degrees.
  if (meta.orientation && meta.orientation >= 5) [width, height] = [height, width];
  const { data, info } = await sharp(input, { failOn: "none", pages: 1 })
    .rotate()
    .resize(64, 64, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width,
    height,
    format: meta.format,
    animated: (meta.pages ?? 1) > 1,
    colors: extractPalette(data, info.channels),
  };
}

export class ThumbnailCache {
  private inflight = new Map<string, Promise<string>>();

  constructor(private readonly dir: string) {}

  static pickWidth(requested: number): number {
    return THUMB_WIDTHS.find((w) => w >= requested) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
  }

  /** Returns the path of a WebP thumbnail, creating it on first use. */
  async get(hash: string, source: string, requested: number): Promise<string> {
    const width = ThumbnailCache.pickWidth(requested);
    const out = path.join(this.dir, hash.slice(0, 2), `${hash}_${width}.webp`);
    if (existsSync(out)) return out;
    const key = out;
    let job = this.inflight.get(key);
    if (!job) {
      job = (async () => {
        await fs.mkdir(path.dirname(out), { recursive: true });
        const meta = await sharp(source, { failOn: "none" }).metadata();
        const animated = (meta.pages ?? 1) > 1 && meta.format !== "pdf";
        const tmp = `${out}.${process.pid}.tmp`;
        await sharp(source, { failOn: "none", animated })
          .rotate()
          .resize({ width, withoutEnlargement: true })
          .webp({ quality: 80, effort: 3 })
          .toFile(tmp);
        await fs.rename(tmp, out);
        return out;
      })().finally(() => this.inflight.delete(key));
      this.inflight.set(key, job);
    }
    return job;
  }

  async removeFor(hash: string): Promise<void> {
    await Promise.all(
      THUMB_WIDTHS.map((w) => fs.rm(path.join(this.dir, hash.slice(0, 2), `${hash}_${w}.webp`), { force: true })),
    );
  }
}

/** Converts arbitrary image data (e.g. a PNG snapshot) to a compact JPEG/WebP buffer. */
export async function normalizeSnapshot(data: Buffer, maxWidth = 1600): Promise<Buffer> {
  return sharp(data, { failOn: "none" }).resize({ width: maxWidth, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
}
