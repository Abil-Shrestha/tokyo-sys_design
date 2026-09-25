import type { ItemCard } from "../../shared/types";

export function formatBytes(n: number | null | undefined): string {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatPrice(price: number | undefined, currency: string | undefined): string | null {
  if (price === undefined || price === null || Number.isNaN(price)) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: currency ? "currency" : "decimal",
      currency: currency || undefined,
      maximumFractionDigits: price % 1 === 0 ? 0 : 2,
    }).format(price);
  } catch {
    return `${price} ${currency ?? ""}`.trim();
  }
}

const rtf = typeof Intl !== "undefined" && "RelativeTimeFormat" in Intl ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;

export function relativeTime(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (!rtf) return new Date(ts).toLocaleDateString();
  if (abs < min) return "just now";
  if (abs < hour) return rtf.format(Math.round(diff / min), "minute");
  if (abs < day) return rtf.format(Math.round(diff / hour), "hour");
  if (abs < 7 * day) return rtf.format(Math.round(diff / day), "day");
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

export function fullDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export const TYPE_LABELS: Record<string, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  file: "File",
  link: "Link",
  note: "Note",
  quote: "Quote",
  website: "Website",
  article: "Article",
  product: "Product",
  recipe: "Recipe",
  music: "Music",
  book: "Book",
  movie: "Movie",
  repository: "Code",
  post: "Post",
  place: "Place",
  document: "Document",
};

export function typeLabel(item: Pick<ItemCard, "kind" | "linkType">): string {
  if (item.kind === "link" && item.linkType) return TYPE_LABELS[item.linkType] ?? "Link";
  return TYPE_LABELS[item.kind] ?? item.kind;
}

export function displayTitle(item: Pick<ItemCard, "title" | "assetName" | "url" | "domain" | "excerpt" | "kind">): string {
  if (item.title) return item.title;
  if (item.assetName) return item.assetName;
  if (item.kind === "note" && item.excerpt) return item.excerpt.split("\n")[0].replace(/^#+\s*/, "").slice(0, 80);
  if (item.url) return item.domain ?? item.url;
  return "Untitled";
}

export function isUrl(text: string): boolean {
  const t = text.trim();
  if (/\s/.test(t)) return false;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

/** True when an event comes from a place where the user is typing. */
export function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("input, textarea, select, [contenteditable=true]");
}
