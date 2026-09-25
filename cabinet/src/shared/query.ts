// Search query language.
//
//   red chair                 words (prefix-matched, all must match)
//   "exact phrase"            phrase
//   type:image  is:pinned     filters (type accepts kinds and link types)
//   tag:design  #design       tag filter
//   site:github.com           domain filter
//   color:red  color:#ff0000  colour filter
//   after:2024-01 before:7d   date filters; date:today|yesterday|week|month|year|2024-05
//   in:"Moodboard"            collection filter
//   has:note has:tags         presence filters
//   -word -tag:x              negation
//
// Bare colour words ("red") and type words ("images") are "soft": they match
// either the text or the colour/type, which is usually what people mean.

export type TypeName =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "file"
  | "link"
  | "note"
  | "quote"
  | "article"
  | "product"
  | "recipe"
  | "music"
  | "book"
  | "movie"
  | "repository"
  | "post"
  | "place"
  | "website"
  | "document";

export interface SoftTerm {
  word: string;
  color?: string;
  type?: TypeName;
}

export interface ParsedQuery {
  words: string[];
  phrases: string[];
  notWords: string[];
  soft: SoftTerm[];
  types: TypeName[];
  notTypes: TypeName[];
  tags: string[];
  notTags: string[];
  sites: string[];
  notSites: string[];
  colors: string[];
  collections: string[];
  has: string[];
  notHas: string[];
  pinned?: boolean;
  after?: number;
  before?: number;
}

export const KIND_TYPES: TypeName[] = ["image", "video", "audio", "pdf", "file", "link", "note", "quote"];
export const LINK_TYPES: TypeName[] = [
  "article",
  "product",
  "recipe",
  "music",
  "book",
  "movie",
  "repository",
  "post",
  "place",
  "website",
  "document",
];

const TYPE_ALIASES: Record<string, TypeName> = {
  image: "image",
  images: "image",
  img: "image",
  photo: "image",
  photos: "image",
  picture: "image",
  pictures: "image",
  screenshot: "image",
  screenshots: "image",
  gif: "image",
  gifs: "image",
  video: "video",
  videos: "video",
  movie: "movie",
  movies: "movie",
  film: "movie",
  films: "movie",
  audio: "audio",
  sound: "audio",
  pdf: "pdf",
  pdfs: "pdf",
  file: "file",
  files: "file",
  link: "link",
  links: "link",
  bookmark: "link",
  bookmarks: "link",
  url: "link",
  note: "note",
  notes: "note",
  quote: "quote",
  quotes: "quote",
  highlight: "quote",
  highlights: "quote",
  article: "article",
  articles: "article",
  post: "post",
  posts: "post",
  tweet: "post",
  tweets: "post",
  product: "product",
  products: "product",
  shop: "product",
  shopping: "product",
  recipe: "recipe",
  recipes: "recipe",
  music: "music",
  song: "music",
  songs: "music",
  album: "music",
  book: "book",
  books: "book",
  repo: "repository",
  repos: "repository",
  repository: "repository",
  code: "repository",
  place: "place",
  places: "place",
  website: "website",
  websites: "website",
  site: "website",
  document: "document",
  documents: "document",
  doc: "document",
  docs: "document",
};

/** Bare words that count as "soft" type terms (plural forms read naturally). */
const SOFT_TYPE_WORDS = new Set([
  "images",
  "photos",
  "pictures",
  "screenshots",
  "gifs",
  "videos",
  "movies",
  "pdfs",
  "links",
  "bookmarks",
  "notes",
  "quotes",
  "highlights",
  "articles",
  "tweets",
  "products",
  "recipes",
  "songs",
  "books",
  "repos",
  "websites",
]);

export const COLOR_NAMES: Record<string, string> = {
  red: "#e5322d",
  orange: "#f28c28",
  yellow: "#f5d033",
  green: "#3aa655",
  teal: "#1fa3a3",
  cyan: "#3cc7e0",
  blue: "#2f6fdb",
  navy: "#1d2c5e",
  purple: "#8a4fd1",
  violet: "#8a4fd1",
  pink: "#f06ea9",
  magenta: "#d63aa6",
  brown: "#8a5a36",
  beige: "#e3d3b5",
  cream: "#f3ead3",
  black: "#141414",
  white: "#f7f7f5",
  gray: "#8c8c8c",
  grey: "#8c8c8c",
  gold: "#c9a43a",
};

export function resolveType(word: string): TypeName | undefined {
  return TYPE_ALIASES[word.toLowerCase()];
}

export function emptyQuery(): ParsedQuery {
  return {
    words: [],
    phrases: [],
    notWords: [],
    soft: [],
    types: [],
    notTypes: [],
    tags: [],
    notTags: [],
    sites: [],
    notSites: [],
    colors: [],
    collections: [],
    has: [],
    notHas: [],
  };
}

interface RawToken {
  negated: boolean;
  key?: string;
  value: string;
  quoted: boolean;
}

function tokenize(input: string): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  const s = input;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let negated = false;
    if (s[i] === "-" && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      negated = true;
      i++;
    }
    let key: string | undefined;
    const keyMatch = /^([a-zA-Z]+):/.exec(s.slice(i));
    if (keyMatch && i + keyMatch[0].length < s.length && !/\s/.test(s[i + keyMatch[0].length])) {
      key = keyMatch[1].toLowerCase();
      i += keyMatch[0].length;
    }
    let value = "";
    let quoted = false;
    if (s[i] === '"') {
      quoted = true;
      i++;
      const end = s.indexOf('"', i);
      if (end === -1) {
        value = s.slice(i);
        i = s.length;
      } else {
        value = s.slice(i, end);
        i = end + 1;
      }
    } else {
      const start = i;
      while (i < s.length && !/\s/.test(s[i])) i++;
      value = s.slice(start, i);
    }
    if (value.length || key) tokens.push({ negated, key, value, quoted });
  }
  return tokens;
}

const DAY = 86_400_000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Resolves a date expression to a [from, to) range in epoch ms. */
export function parseDateRange(value: string, now = new Date()): [number, number] | null {
  const v = value.toLowerCase().trim();
  const today = startOfDay(now).getTime();
  switch (v) {
    case "today":
      return [today, today + DAY];
    case "yesterday":
      return [today - DAY, today];
    case "week":
    case "thisweek":
      return [today - 6 * DAY, today + DAY];
    case "lastweek":
      return [today - 13 * DAY, today - 6 * DAY];
    case "month":
    case "thismonth":
      return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), today + DAY];
    case "lastmonth":
      return [
        new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
        new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      ];
    case "year":
    case "thisyear":
      return [new Date(now.getFullYear(), 0, 1).getTime(), today + DAY];
    case "lastyear":
      return [new Date(now.getFullYear() - 1, 0, 1).getTime(), new Date(now.getFullYear(), 0, 1).getTime()];
  }
  const rel = /^(\d+)([dwmy])$/.exec(v);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const days = unit === "d" ? n : unit === "w" ? n * 7 : unit === "m" ? n * 30 : n * 365;
    return [now.getTime() - days * DAY, now.getTime() + DAY];
  }
  const ymd = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(v);
  if (ymd) {
    const y = Number(ymd[1]);
    if (ymd[3]) {
      const from = new Date(y, Number(ymd[2]) - 1, Number(ymd[3])).getTime();
      return [from, from + DAY];
    }
    if (ymd[2]) {
      const m = Number(ymd[2]) - 1;
      return [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()];
    }
    return [new Date(y, 0, 1).getTime(), new Date(y + 1, 0, 1).getTime()];
  }
  return null;
}

export function normalizeTag(tag: string): string {
  return tag
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .slice(0, 64);
}

export function normalizeColor(value: string): string | null {
  const v = value.toLowerCase().trim();
  if (COLOR_NAMES[v]) return v;
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (!hex) return null;
  let h = hex[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h}`;
}

export function parseQuery(input: string, now = new Date()): ParsedQuery {
  const q = emptyQuery();
  for (const t of tokenize(input)) {
    const value = t.value.trim();
    if (!t.key) {
      if (!value) continue;
      if (!t.quoted && value.startsWith("#") && value.length > 1) {
        (t.negated ? q.notTags : q.tags).push(normalizeTag(value));
        continue;
      }
      if (t.quoted) {
        if (t.negated) q.notWords.push(value);
        else q.phrases.push(value);
        continue;
      }
      if (t.negated) {
        q.notWords.push(value);
        continue;
      }
      const lower = value.toLowerCase();
      if (COLOR_NAMES[lower]) {
        q.soft.push({ word: value, color: lower });
      } else if (SOFT_TYPE_WORDS.has(lower)) {
        q.soft.push({ word: value, type: TYPE_ALIASES[lower] });
      } else {
        q.words.push(value);
      }
      continue;
    }
    switch (t.key) {
      case "type":
      case "kind":
      case "is": {
        if (value.toLowerCase() === "pinned" || value.toLowerCase() === "top") {
          q.pinned = !t.negated;
          break;
        }
        const type = resolveType(value);
        if (type) (t.negated ? q.notTypes : q.types).push(type);
        break;
      }
      case "tag":
      case "tags":
        if (value) (t.negated ? q.notTags : q.tags).push(normalizeTag(value));
        break;
      case "site":
      case "domain":
      case "from":
        if (value)
          (t.negated ? q.notSites : q.sites).push(
            value.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""),
          );
        break;
      case "color":
      case "colour": {
        const c = normalizeColor(value);
        if (c) q.colors.push(c);
        break;
      }
      case "in":
      case "collection":
        if (value) q.collections.push(value);
        break;
      case "has":
        if (value) (t.negated ? q.notHas : q.has).push(value.toLowerCase());
        break;
      case "after":
      case "since": {
        const r = parseDateRange(value, now);
        if (r) q.after = r[0];
        break;
      }
      case "before":
      case "until": {
        const r = parseDateRange(value, now);
        // "before:2024-06" means before June starts; "before:7d" before a week ago.
        if (r) q.before = r[0];
        break;
      }
      case "date":
      case "on":
      case "saved": {
        const r = parseDateRange(value.replace(/\s+/g, ""), now);
        if (r) {
          q.after = r[0];
          q.before = r[1];
        }
        break;
      }
      default:
        // Unknown key: treat "key:value" as ordinary text so URLs etc. still work.
        q.words.push(`${t.key}:${value}`);
    }
  }
  return q;
}

export function isEmptyQuery(q: ParsedQuery): boolean {
  return (
    !q.words.length &&
    !q.phrases.length &&
    !q.notWords.length &&
    !q.soft.length &&
    !q.types.length &&
    !q.notTypes.length &&
    !q.tags.length &&
    !q.notTags.length &&
    !q.sites.length &&
    !q.notSites.length &&
    !q.colors.length &&
    !q.collections.length &&
    !q.has.length &&
    !q.notHas.length &&
    q.pinned === undefined &&
    q.after === undefined &&
    q.before === undefined
  );
}
