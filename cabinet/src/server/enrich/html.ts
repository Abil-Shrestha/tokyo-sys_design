// Extracts what a page is about from its HTML: Open Graph, Twitter cards,
// JSON-LD (schema.org), plain meta tags and a readable article body.

import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ItemMeta, LinkType } from "../../shared/types";

export interface PageInfo {
  url: string;
  canonical: string | null;
  title: string | null;
  description: string | null;
  siteName: string | null;
  author: string | null;
  image: string | null;
  favicon: string | null;
  lang: string | null;
  ogType: string | null;
  linkType: LinkType;
  meta: ItemMeta;
  keywords: string[];
  article: { title: string | null; html: string; text: string; words: number } | null;
}

type JsonLdNode = Record<string, unknown>;

function text(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return text(o.name ?? o["@value"] ?? o.url ?? o.text);
  }
  return null;
}

/** A character for a numeric entity, or U+FFFD for an invalid one. */
function codePoint(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\ufffd";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => codePoint(parseInt(n, 16)));
}

function clean(s: string | null | undefined, max = 2000): string | null {
  if (!s) return null;
  const v = decodeEntities(s).replace(/\s+/g, " ").trim();
  if (!v) return null;
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function absolutize(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(href.trim(), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function typesOf(node: JsonLdNode): string[] {
  const t = node["@type"];
  if (Array.isArray(t)) return t.map(String);
  return t ? [String(t)] : [];
}

function flattenJsonLd(data: unknown, out: JsonLdNode[] = []): JsonLdNode[] {
  if (Array.isArray(data)) {
    for (const d of data) flattenJsonLd(d, out);
  } else if (data && typeof data === "object") {
    const node = data as JsonLdNode;
    if (node["@graph"]) flattenJsonLd(node["@graph"], out);
    if (node["@type"]) out.push(node);
    if (node.mainEntity) flattenJsonLd(node.mainEntity, out);
  }
  return out;
}

function imageOf(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return imageOf(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return text(o.url ?? o.contentUrl ?? o["@id"]);
  }
  return null;
}

/** ISO 8601 duration (PT1H30M) to a friendly string. */
export function formatDuration(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(iso.trim());
  if (!m) return iso;
  const [, d, h, min] = m;
  const parts: string[] = [];
  if (d) parts.push(`${d} d`);
  if (h) parts.push(`${h} h`);
  if (min) parts.push(`${min} min`);
  return parts.join(" ") || undefined;
}

function durationSeconds(iso: string | null): number | undefined {
  if (!iso) return undefined;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(iso.trim());
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

const SITE_TYPES: { test: RegExp; type: LinkType; path?: RegExp }[] = [
  { test: /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|twitch\.tv|dailymotion\.com|loom\.com|tiktok\.com)$/, type: "video" },
  { test: /(^|\.)(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org|sr\.ht)$/, type: "repository", path: /^\/[^/]+\/[^/]+\/?$/ },
  { test: /(^|\.)(twitter\.com|x\.com|threads\.net|bsky\.app|mastodon\.social|instagram\.com|reddit\.com|news\.ycombinator\.com)$/, type: "post" },
  { test: /(^|\.)(open\.spotify\.com|soundcloud\.com|bandcamp\.com|music\.apple\.com|tidal\.com)$/, type: "music" },
  { test: /(^|\.)(goodreads\.com)$/, type: "book" },
  { test: /(^|\.)(imdb\.com|letterboxd\.com|themoviedb\.org)$/, type: "movie" },
  { test: /(^|\.)(maps\.google\.[a-z.]+|google\.[a-z.]+|maps\.apple\.com|openstreetmap\.org)$/, type: "place", path: /^\/maps/ },
  { test: /(^|\.)(docs\.google\.com|notion\.so|dropbox\.com|drive\.google\.com)$/, type: "document" },
  { test: /(^|\.)(amazon\.[a-z.]+)$/, type: "product", path: /\/(dp|gp\/product)\// },
  { test: /(^|\.)(etsy\.com)$/, type: "product", path: /^\/listing\// },
  { test: /(^|\.)(arxiv\.org|medium\.com|substack\.com)$/, type: "article" },
];

function siteType(url: string): LinkType | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    for (const r of SITE_TYPES) {
      if (r.test.test(host) && (!r.path || r.path.test(u.pathname))) return r.type;
    }
  } catch {
    // ignore
  }
  return null;
}

function jsonLdType(types: string[]): LinkType | null {
  const has = (...names: string[]) => types.some((t) => names.includes(t));
  if (has("Product", "ProductGroup", "IndividualProduct")) return "product";
  if (has("Recipe")) return "recipe";
  if (has("Book")) return "book";
  if (has("Movie", "TVSeries", "TVEpisode")) return "movie";
  if (has("MusicRecording", "MusicAlbum", "MusicPlaylist", "PodcastEpisode")) return "music";
  if (has("VideoObject")) return "video";
  if (has("SoftwareSourceCode")) return "repository";
  if (has("Restaurant", "LocalBusiness", "Place", "Hotel", "TouristAttraction", "Museum")) return "place";
  if (has("Article", "NewsArticle", "BlogPosting", "TechArticle", "ScholarlyArticle", "Report", "OpinionNewsArticle", "AnalysisNewsArticle"))
    return "article";
  return null;
}

function ogTypeToLinkType(og: string | null): LinkType | null {
  if (!og) return null;
  const t = og.toLowerCase();
  if (t === "article" || t === "blog") return "article";
  if (t.includes("product")) return "product";
  if (t.startsWith("video")) return "video";
  if (t.startsWith("music")) return "music";
  if (t === "book" || t.startsWith("books")) return "book";
  if (t.includes("restaurant") || t === "place") return "place";
  return null;
}

export function extractPage(html: string, pageUrl: string): PageInfo {
  const { document } = parseHTML(html);
  const metas = new Map<string, string[]>();
  for (const el of Array.from(document.querySelectorAll("meta"))) {
    const key = (el.getAttribute("property") ?? el.getAttribute("name") ?? el.getAttribute("itemprop") ?? "").toLowerCase().trim();
    const content = el.getAttribute("content");
    if (!key || content == null) continue;
    const list = metas.get(key) ?? [];
    list.push(content);
    metas.set(key, list);
  }
  const meta = (...keys: string[]) => {
    for (const k of keys) {
      const v = metas.get(k)?.find((x) => x.trim());
      if (v) return v.trim();
    }
    return null;
  };

  const canonical =
    absolutize(document.querySelector('link[rel="canonical"]')?.getAttribute("href"), pageUrl) ?? absolutize(meta("og:url"), pageUrl);
  const base = pageUrl;

  // JSON-LD
  const nodes: JsonLdNode[] = [];
  for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    const raw = s.textContent ?? "";
    try {
      flattenJsonLd(JSON.parse(raw), nodes);
    } catch {
      try {
        flattenJsonLd(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, " ")), nodes);
      } catch {
        // malformed JSON-LD is common; ignore
      }
    }
  }
  const primary =
    nodes.find((n) => jsonLdType(typesOf(n)) === "product") ??
    nodes.find((n) => jsonLdType(typesOf(n)) === "recipe") ??
    nodes.find((n) => ["book", "movie", "music", "place", "repository"].includes(jsonLdType(typesOf(n)) ?? "")) ??
    nodes.find((n) => jsonLdType(typesOf(n)) === "article") ??
    nodes.find((n) => jsonLdType(typesOf(n)) === "video");

  const info: ItemMeta = {};
  const keywords: string[] = [];
  const addKeywords = (v: unknown) => {
    if (!v) return;
    const list = Array.isArray(v) ? v.map(String) : String(v).split(/[,;|]/);
    for (const k of list) {
      const t = k.trim();
      if (t && t.length <= 40 && t.split(/\s+/).length <= 3 && !keywords.includes(t)) keywords.push(t);
    }
  };

  let ldType: LinkType | null = null;
  let ldImage: string | null = null;
  if (primary) {
    ldType = jsonLdType(typesOf(primary));
    ldImage = imageOf(primary.image ?? primary.thumbnailUrl);
    if (ldType === "product") {
      const offersRaw = primary.offers;
      const offers = (Array.isArray(offersRaw) ? offersRaw[0] : offersRaw) as Record<string, unknown> | undefined;
      const price = text(offers?.price ?? offers?.lowPrice ?? (offers?.priceSpecification as Record<string, unknown> | undefined)?.price);
      if (price && !Number.isNaN(Number(price))) info.price = Number(price);
      const currency = text(offers?.priceCurrency ?? (offers?.priceSpecification as Record<string, unknown> | undefined)?.priceCurrency);
      if (currency) info.currency = currency;
      const availability = text(offers?.availability);
      if (availability) info.availability = availability.replace(/^https?:\/\/schema\.org\//, "");
      const brand = text(primary.brand);
      if (brand) info.brand = brand;
      const rating = primary.aggregateRating as Record<string, unknown> | undefined;
      if (rating?.ratingValue) info.rating = Number(rating.ratingValue);
      if (rating?.reviewCount || rating?.ratingCount) info.ratingCount = Number(rating.reviewCount ?? rating.ratingCount);
      addKeywords(primary.category);
    }
    if (ldType === "recipe") {
      const yieldV = text(primary.recipeYield);
      if (yieldV) info.recipeYield = yieldV;
      info.totalTime = formatDuration(text(primary.totalTime) ?? text(primary.cookTime) ?? null);
      const ing = primary.recipeIngredient ?? primary.ingredients;
      if (Array.isArray(ing)) info.ingredients = ing.map((i) => clean(String(i), 200)).filter((i): i is string => !!i).slice(0, 60);
      addKeywords(primary.recipeCategory);
      addKeywords(primary.recipeCuisine);
    }
    if (ldType === "video") {
      const embed = text(primary.embedUrl);
      if (embed) info.embedUrl = embed;
      const secs = durationSeconds(text(primary.duration));
      if (secs) info.durationSeconds = secs;
    }
    const published = text(primary.datePublished ?? primary.uploadDate);
    if (published) info.publishedAt = published;
    addKeywords(primary.keywords);
  }

  const ogType = meta("og:type");
  const priceMeta = meta("product:price:amount", "og:price:amount", "twitter:data1");
  if (info.price === undefined && priceMeta && /^[\d.,\s]+$/.test(priceMeta)) {
    const n = Number(priceMeta.replace(/[,\s]/g, ""));
    if (!Number.isNaN(n)) info.price = n;
    info.currency = info.currency ?? meta("product:price:currency", "og:price:currency") ?? undefined;
  }
  const published = meta("article:published_time", "og:published_time", "date", "pubdate", "datepublished");
  if (!info.publishedAt && published) info.publishedAt = published;
  for (const t of metas.get("article:tag") ?? []) addKeywords(t);
  addKeywords(meta("keywords", "news_keywords"));

  const ogVideo = meta("og:video:secure_url", "og:video:url", "og:video", "twitter:player");
  if (!info.embedUrl && ogVideo) info.embedUrl = absolutize(ogVideo, base) ?? undefined;

  const title =
    clean(meta("og:title", "twitter:title"), 400) ??
    clean(primary ? text(primary.headline ?? primary.name) : null, 400) ??
    clean(document.querySelector("title")?.textContent, 400) ??
    clean(document.querySelector("h1")?.textContent, 400);
  const description = clean(meta("og:description", "twitter:description", "description"), 1200);
  const siteName = clean(meta("og:site_name", "application-name", "twitter:site"), 100)?.replace(/^@/, "") ?? null;
  const author =
    clean(meta("author", "article:author", "twitter:creator"), 120) ??
    clean(primary ? text(primary.author) : null, 120);

  const image =
    absolutize(meta("og:image:secure_url", "og:image:url", "og:image", "twitter:image", "twitter:image:src"), base) ??
    absolutize(ldImage, base) ??
    absolutize(document.querySelector('link[rel="image_src"]')?.getAttribute("href"), base);

  // Prefer a large touch icon, then any declared icon, then /favicon.ico.
  const iconLinks = Array.from(document.querySelectorAll("link[rel]"))
    .map((l) => ({ rel: (l.getAttribute("rel") ?? "").toLowerCase(), href: l.getAttribute("href"), sizes: l.getAttribute("sizes") ?? "" }))
    .filter((l) => l.href && /(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/.test(l.rel));
  iconLinks.sort((a, b) => {
    const size = (s: string) => Number(/(\d+)x/.exec(s)?.[1] ?? (s === "any" ? 512 : 0));
    const score = (l: typeof a) => (l.rel.includes("apple-touch") ? 180 : 0) + size(l.sizes) - (l.href!.endsWith(".svg") ? 1000 : 0);
    return score(b) - score(a);
  });
  let favicon = absolutize(iconLinks[0]?.href, base);
  if (!favicon) {
    try {
      favicon = new URL("/favicon.ico", pageUrl).toString();
    } catch {
      favicon = null;
    }
  }

  const lang = document.documentElement?.getAttribute("lang")?.slice(0, 12) ?? null;
  if (lang) info.lang = lang;

  // Readable body text (for search and the reader view).
  let article: PageInfo["article"] = null;
  try {
    const { document: doc2 } = parseHTML(html);
    for (const el of Array.from(doc2.querySelectorAll("script, style, noscript, iframe, svg"))) el.remove();
    const parsed = new Readability(doc2 as unknown as Document, { charThreshold: 300, keepClasses: false }).parse();
    if (parsed?.textContent) {
      const textContent = parsed.textContent.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      const words = textContent.split(/\s+/).filter(Boolean).length;
      if (words >= 60) {
        article = { title: parsed.title ?? null, html: absolutizeHtml(parsed.content ?? "", pageUrl), text: textContent, words };
      }
    }
  } catch {
    article = null;
  }

  let linkType: LinkType =
    siteType(canonical ?? pageUrl) ?? ldType ?? ogTypeToLinkType(ogType) ?? (info.price !== undefined ? "product" : null) ?? "website";
  if (linkType === "website" && article && article.words >= 350 && (info.publishedAt || author)) linkType = "article";
  if (linkType === "article" || (article && article.words >= 200)) {
    if (article) {
      info.wordCount = article.words;
      info.readingMinutes = Math.max(1, Math.round(article.words / 230));
    }
  }
  if (keywords.length) info.keywords = keywords.slice(0, 12);

  return {
    url: pageUrl,
    canonical,
    title,
    description,
    siteName,
    author,
    image,
    favicon,
    lang,
    ogType,
    linkType,
    meta: info,
    keywords,
    article,
  };
}

/** Rewrites relative src/href attributes in an HTML fragment to absolute URLs. */
function absolutizeHtml(html: string, base: string): string {
  if (!html) return html;
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${html}</div></body></html>`);
  const root = document.getElementById("root");
  if (!root) return html;
  for (const el of Array.from(root.querySelectorAll("[src], [href], [srcset]"))) {
    const src = el.getAttribute("src");
    if (src) {
      const abs = absolutize(src, base);
      if (abs) el.setAttribute("src", abs);
      else el.removeAttribute("src");
    }
    const href = el.getAttribute("href");
    if (href && !href.startsWith("#")) {
      const abs = absolutize(href, base);
      if (abs) el.setAttribute("href", abs);
    }
    const srcset = el.getAttribute("srcset");
    if (srcset) {
      const fixed = srcset
        .split(",")
        .map((part) => {
          const [u, d] = part.trim().split(/\s+/);
          const abs = absolutize(u, base);
          return abs ? [abs, d].filter(Boolean).join(" ") : "";
        })
        .filter(Boolean)
        .join(", ");
      el.setAttribute("srcset", fixed);
    }
  }
  return root.innerHTML;
}

/** Tags derived from page metadata alone (used when AI tagging is off). */
export function metadataTags(page: PageInfo): string[] {
  const out: string[] = [];
  const site = (page.siteName ?? "").toLowerCase();
  for (const k of page.keywords) {
    const t = k.toLowerCase().replace(/^#/, "").trim();
    if (!t || t.length < 2 || t === site || /^\d+$/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= 4) break;
  }
  return out;
}
