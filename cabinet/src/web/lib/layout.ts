// Card geometry. Heights are computed up front from what we know about each
// item (image aspect ratio, text length) so the masonry grid can place and
// virtualise thousands of cards without measuring the DOM. The card renderer
// uses the same numbers, so what is drawn matches what was planned.

import type { ItemCard } from "../../shared/types";
import { stripMarkdown } from "./markdown";

export const GAP = 16;

export interface CardLayout {
  height: number;
  media: number;
  titleLines: number;
  bodyLines: number;
  /** True when the text did not fit and is cut off (the card fades it out). */
  clamped?: boolean;
  variant: "image" | "video" | "link" | "textlink" | "article" | "product" | "note" | "quote" | "pdf" | "file";
}

const SANS = 0.53;
const SERIF = 0.39;

export function estimateLines(text: string | null | undefined, fontPx: number, width: number, factor = SANS, max = 99): number {
  if (!text) return 0;
  const perLine = Math.max(8, Math.floor(width / (fontPx * factor)));
  let lines = 0;
  for (const para of text.split("\n")) {
    lines += Math.max(1, Math.ceil(para.trim().length / perLine));
    if (lines >= max) return max;
  }
  return Math.min(lines, max);
}

function ratio(item: ItemCard, min: number, max: number, fallback: number): number {
  if (item.width && item.height) return Math.min(max, Math.max(min, item.height / item.width));
  return fallback;
}

export const LINE = {
  footerTitle: 18,
  footerMeta: 16,
  noteBody: 23,
  noteTitle: 23,
  quote: 29,
  serifTitle: 25,
  articleTitle: 24,
  excerpt: 20,
};

export function footerHeight(titleLines: number): number {
  return 12 + titleLines * LINE.footerTitle + 5 + LINE.footerMeta + 12;
}

export function cardLayout(item: ItemCard, w: number): CardLayout {
  const inner = w - 36;
  const title = item.title ?? item.assetName ?? item.domain ?? item.url ?? "";

  switch (item.kind) {
    case "image": {
      const media = Math.round(w * ratio(item, 0.3, 2.6, 0.75));
      return { variant: "image", height: media, media, titleLines: 0, bodyLines: 0 };
    }
    case "video": {
      const media = Math.round(w * ratio(item, 0.4, 1.9, 9 / 16));
      return { variant: "video", height: media, media, titleLines: 0, bodyLines: 0 };
    }
    case "note": {
      const text = stripMarkdown(item.excerpt ?? "");
      const titleLines = item.title ? Math.min(2, estimateLines(item.title, 17, inner, SANS)) : 0;
      const maxBody = Math.max(4, Math.round(w / 22));
      const full = text ? estimateLines(text, 15, inner, SANS, 999) : 1;
      const bodyLines = Math.min(full, maxBody);
      const height = 18 + (titleLines ? titleLines * LINE.noteTitle + 6 : 0) + bodyLines * LINE.noteBody + 18;
      return { variant: "note", height: Math.max(height, 88), media: 0, titleLines, bodyLines, clamped: full > maxBody };
    }
    case "quote": {
      const maxBody = Math.max(5, Math.round(w / 30));
      const full = estimateLines(item.excerpt ?? "", 21, w - 44, SERIF, 999);
      const bodyLines = Math.min(full, maxBody);
      const source = item.url || item.title ? 12 + LINE.footerMeta : 0;
      return { variant: "quote", height: 22 + bodyLines * LINE.quote + source + 22, media: 0, titleLines: 0, bodyLines, clamped: full > maxBody };
    }
    case "pdf": {
      const titleLines = Math.min(2, estimateLines(title, 13.5, w - 24));
      const media = item.preview ? Math.round(w * ratio(item, 0.9, 1.5, 1.3)) : Math.round(w * 0.55);
      return { variant: "pdf", height: media + footerHeight(titleLines), media, titleLines, bodyLines: 0 };
    }
    case "file":
    case "audio": {
      const titleLines = Math.min(2, estimateLines(title, 13.5, w - 24));
      const media = item.preview ? Math.round(w * ratio(item, 0.5, 1.4, 0.75)) : 120;
      return { variant: "file", height: media + footerHeight(titleLines), media, titleLines, bodyLines: 0 };
    }
    case "link":
    default: {
      const lt = item.linkType;
      if (lt === "product" || lt === "recipe" || lt === "book" || lt === "movie" || lt === "music" || lt === "place") {
        const titleLines = Math.min(2, estimateLines(title, 13.5, w - 24));
        const media = item.preview ? Math.round(w * ratio(item, 0.6, 1.5, 1)) : 0;
        if (media) return { variant: "product", height: media + footerHeight(titleLines), media, titleLines, bodyLines: 0 };
      }
      if (lt === "article" || (lt === "post" && !item.preview)) {
        const media = item.preview ? Math.round(w * ratio(item, 0.45, 0.75, 0.56)) : 0;
        const titleLines = Math.min(4, estimateLines(title, 20, inner, SERIF));
        const bodyLines = Math.min(4, estimateLines(item.excerpt, 13.5, inner, SANS, 4));
        const height = media + 16 + titleLines * LINE.articleTitle + (bodyLines ? 8 + bodyLines * LINE.excerpt : 0) + 10 + LINE.footerMeta + 16;
        return { variant: "article", height, media, titleLines, bodyLines };
      }
      if (item.preview) {
        const titleLines = Math.min(2, estimateLines(title, 13.5, w - 24));
        const media = Math.round(w * ratio(item, 0.4, 1.4, 0.56));
        return { variant: "link", height: media + footerHeight(titleLines), media, titleLines, bodyLines: 0 };
      }
      const titleLines = Math.min(4, estimateLines(title, 21, inner, SERIF));
      const bodyLines = Math.min(4, estimateLines(item.description ?? item.excerpt, 13.5, inner, SANS, 4));
      const height = 18 + LINE.footerMeta + 12 + titleLines * LINE.serifTitle + (bodyLines ? 8 + bodyLines * LINE.excerpt : 0) + 18;
      return { variant: "textlink", height, media: 0, titleLines, bodyLines };
    }
  }
}

export interface Placed {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function columnsFor(width: number, target: number): { cols: number; colWidth: number } {
  const cols = Math.max(1, Math.floor((width + GAP) / (target + GAP)));
  return { cols, colWidth: (width - GAP * (cols - 1)) / cols };
}

/** Classic shortest-column masonry. `leading` reserves space for cards that come first (e.g. the composer). */
export function masonry(heights: number[], width: number, target: number): { placed: Placed[]; total: number; colWidth: number; cols: number } {
  const { cols, colWidth } = columnsFor(width, target);
  const tops = new Array(cols).fill(0);
  const placed: Placed[] = [];
  for (let i = 0; i < heights.length; i++) {
    let col = 0;
    for (let c = 1; c < cols; c++) if (tops[c] < tops[col] - 1) col = c;
    const x = col * (colWidth + GAP);
    const y = tops[col];
    placed.push({ index: i, x, y, w: colWidth, h: heights[i] });
    tops[col] = y + heights[i] + GAP;
  }
  return { placed, total: Math.max(0, ...tops), colWidth, cols };
}
