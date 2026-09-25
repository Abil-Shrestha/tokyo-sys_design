// Importing bookmarks from browsers and other apps.

import { normalizeTag } from "../shared/query";
import { cleanUrl, isHttpUrl } from "./enrich/fetch";
import type { Cabinet } from "./engine";
import { domainOf } from "./library";

export interface ImportedBookmark {
  url: string;
  title: string | null;
  tags: string[];
  createdAt: number | null;
  note: string | null;
}

const ROOT_FOLDERS = new Set(["bookmarks bar", "bookmarks toolbar", "other bookmarks", "bookmarks menu", "mobile bookmarks", "favorites", "favourites bar", "bookmarks", "unfiled"]);

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** Position of the next match of a global regex at or after `from`, or -1. */
function indexFrom(text: string, re: RegExp, from: number): number {
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? m.index : -1;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!m) return null;
  return decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
}

/**
 * Netscape bookmark files: exported by Chrome, Safari, Firefox, Edge, Raindrop,
 * Pinboard and others. The format is loose HTML, so it is scanned token by
 * token: an H3 names the folder whose DL follows it, and folders become tags.
 */
export function parseBookmarksHtml(html: string): ImportedBookmark[] {
  const out: ImportedBookmark[] = [];
  const folders: string[] = [];
  let pendingFolder: string | null = null;
  let last: ImportedBookmark | null = null;
  const re = /<(\/?)(dl|h3|a|dd)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "dl") {
      if (closing) folders.pop();
      else {
        folders.push(pendingFolder ?? "");
        pendingFolder = null;
      }
      last = null;
    } else if (tag === "h3" && !closing) {
      const end = html.indexOf("</", re.lastIndex);
      pendingFolder = decodeEntities(html.slice(re.lastIndex, end < 0 ? undefined : end).replace(/<[^>]+>/g, "")).trim();
    } else if (tag === "a" && !closing) {
      const href = attr(m[3], "href") ?? "";
      const close = indexFrom(html, /<\/a/gi, re.lastIndex);
      const title = decodeEntities(html.slice(re.lastIndex, close < 0 ? re.lastIndex : close).replace(/<[^>]+>/g, "")).trim();
      last = null;
      if (!isHttpUrl(href)) continue;
      const addDate = Number(attr(m[3], "add_date"));
      const tags = [...folders, ...(attr(m[3], "tags") ?? "").split(",")].map(normalizeTag).filter((t) => t && !ROOT_FOLDERS.has(t));
      last = {
        url: href,
        title: title || null,
        tags: [...new Set(tags)],
        createdAt: addDate > 0 ? (addDate > 1e12 ? addDate : addDate * 1000) : null,
        note: null,
      };
      out.push(last);
    } else if (tag === "dd" && !closing && last) {
      const stop = indexFrom(html, /<(dt|dl|\/dl|dd)\b/gi, re.lastIndex);
      const note = decodeEntities(html.slice(re.lastIndex, stop < 0 ? re.lastIndex + 2000 : stop).replace(/<[^>]+>/g, "")).trim();
      if (note) last.note = note;
    }
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else cur += c;
  }
  cells.push(cur);
  return cells;
}

function splitCsvRows(text: string): string[] {
  const rows: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if ((ch === "\n" || ch === "\r") && !quoted) {
      if (cur.trim()) rows.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) rows.push(cur);
  return rows;
}

/** CSV exports (Pocket, Raindrop, Instapaper, spreadsheets) with a url column. */
export function parseBookmarksCsv(text: string): ImportedBookmark[] {
  const rows = splitCsvRows(text.replace(/^﻿/, ""));
  if (rows.length < 2) return [];
  const header = parseCsvLine(rows[0]).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const urlCol = col("url", "link", "href");
  if (urlCol < 0) return [];
  const titleCol = col("title", "name");
  const tagsCol = col("tags", "tag", "folder", "folders");
  const timeCol = col("time_added", "created", "created_at", "date", "timestamp");
  const noteCol = col("note", "notes", "excerpt", "description");
  const out: ImportedBookmark[] = [];
  for (const row of rows.slice(1)) {
    const cells = parseCsvLine(row);
    const url = cells[urlCol]?.trim();
    if (!url || !isHttpUrl(url)) continue;
    const rawTime = timeCol >= 0 ? cells[timeCol]?.trim() : "";
    let createdAt: number | null = null;
    if (rawTime) {
      const n = Number(rawTime);
      createdAt = Number.isFinite(n) && n > 0 ? (n > 1e12 ? n : n * 1000) : Date.parse(rawTime) || null;
    }
    out.push({
      url,
      title: titleCol >= 0 ? cells[titleCol]?.trim() || null : null,
      tags: tagsCol >= 0 ? (cells[tagsCol] ?? "").split(/[|,/;]/).map(normalizeTag).filter(Boolean) : [],
      createdAt,
      note: noteCol >= 0 ? cells[noteCol]?.trim() || null : null,
    });
  }
  return out;
}

export function importBookmarks(cabinet: Cabinet, bookmarks: ImportedBookmark[], opts: { collectionId?: string | null } = {}): { imported: number; skipped: number } {
  let imported = 0;
  let skipped = 0;
  const lib = cabinet.lib;
  const seen = new Set<string>();
  for (const b of bookmarks) {
    const url = cleanUrl(b.url);
    if (seen.has(url) || lib.findByUrl(url)) {
      skipped++;
      continue;
    }
    seen.add(url);
    const id = lib.insertItem(
      {
        kind: "link",
        link_type: "website",
        url,
        domain: domainOf(url),
        title: null,
        note: b.note,
        source: "import",
        status: "pending",
        meta: b.title ? { captureTitle: b.title } : {},
        created_at: b.createdAt ?? undefined,
      },
      { tags: b.tags, collectionId: opts.collectionId ?? undefined },
    );
    cabinet.jobs.enqueue("link", id);
    imported++;
  }
  lib.emitEvent({ type: "items.changed" });
  lib.emitEvent({ type: "tags.changed" });
  return { imported, skipped };
}
