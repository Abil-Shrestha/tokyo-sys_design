// Types shared between the library server, the UI and the Electron shell.

/** Primary kind of an item: what the thing *is* on disk. */
export type ItemKind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "file"
  | "link"
  | "note"
  | "quote";

/** Finer classification for links, derived from page metadata. */
export type LinkType =
  | "website"
  | "article"
  | "product"
  | "recipe"
  | "video"
  | "music"
  | "book"
  | "movie"
  | "repository"
  | "post"
  | "place"
  | "document";

export type ItemStatus = "pending" | "ready" | "failed";

export interface ColorSwatch {
  hex: string;
  /** Share of the image covered by this colour, 0..1. */
  weight: number;
}

export interface ItemMeta {
  price?: number;
  currency?: string;
  brand?: string;
  availability?: string;
  rating?: number;
  ratingCount?: number;
  recipeYield?: string;
  totalTime?: string;
  ingredients?: string[];
  readingMinutes?: number;
  wordCount?: number;
  publishedAt?: string;
  embedUrl?: string;
  provider?: string;
  lang?: string;
  /** Free text recognised in an image by the AI model. */
  imageText?: string;
  keywords?: string[];
  [key: string]: unknown;
}

export interface ItemTag {
  name: string;
  /** "user" tags are typed by you; "auto" come from metadata; "ai" from the model. */
  source: "user" | "auto" | "ai";
}

/** Lightweight shape used by grids. */
export interface ItemCard {
  id: string;
  kind: ItemKind;
  linkType: LinkType | null;
  title: string | null;
  description: string | null;
  /** AI summary, or for images an AI description of what is in them. */
  summary: string | null;
  excerpt: string | null;
  url: string | null;
  domain: string | null;
  siteName: string | null;
  favicon: string | null;
  asset: string | null;
  assetName: string | null;
  mime: string | null;
  size: number | null;
  preview: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  colors: ColorSwatch[];
  meta: ItemMeta;
  tags: ItemTag[];
  pinned: boolean;
  status: ItemStatus;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** Full item including long text fields, used by the detail view. */
export interface Item extends ItemCard {
  body: string | null;
  content: string | null;
  contentHtml: string | null;
  note: string | null;
  author: string | null;
  source: string | null;
  error: string | null;
  aiStatus: string | null;
  collections: { id: string; name: string }[];
  links: ItemLinkRef[];
}

export interface ItemLinkRef {
  id: string;
  title: string | null;
  kind: ItemKind;
  preview: string | null;
}

export interface Collection {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  parentId: string | null;
  kind: "manual" | "smart";
  query: string | null;
  view: "grid" | "canvas";
  position: number;
  count: number;
  cover: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CanvasPlacement {
  itemId: string;
  x: number;
  y: number;
  w: number;
  z: number;
}

export interface TagCount {
  name: string;
  count: number;
}

export interface Facets {
  total: number;
  pinned: number;
  trash: number;
  kinds: Record<string, number>;
  linkTypes: Record<string, number>;
  tags: TagCount[];
  domains: { domain: string; count: number }[];
}

export interface ItemPage {
  items: ItemCard[];
  total: number;
  nextCursor: string | null;
}

export interface CreateItemInput {
  kind?: ItemKind;
  url?: string;
  title?: string;
  body?: string;
  note?: string;
  tags?: string[];
  collectionId?: string;
  source?: string;
  /** Page snapshot sent by the browser extension, as a data: URL. */
  snapshot?: string;
  /** Source page when saving an image/quote from the web. */
  pageUrl?: string;
  pageTitle?: string;
}

export interface UpdateItemInput {
  title?: string | null;
  description?: string | null;
  body?: string | null;
  note?: string | null;
  url?: string | null;
  pinned?: boolean;
  /** Replaces all tags, whatever added them. */
  tags?: string[];
  /** Replaces only the tags you added yourself, keeping page and AI tags. */
  userTags?: string[];
  kind?: ItemKind;
}

export interface Settings {
  aiEnabled: boolean;
  aiModel: string;
  aiKeySet: boolean;
  autoTag: boolean;
  fetchLinkPreviews: boolean;
  trashRetentionDays: number;
}

export interface LibraryInfo {
  path: string;
  deviceId: string;
  version: string;
  itemCount: number;
  blobCount: number;
  blobBytes: number;
  port: number;
  token: string;
  capabilities: { snapshots: boolean; desktop: boolean };
}

export type LibraryEvent =
  | { type: "item.created"; id: string }
  | { type: "item.updated"; id: string }
  | { type: "item.deleted"; id: string }
  | { type: "items.changed" }
  | { type: "collections.changed" }
  | { type: "tags.changed" }
  | { type: "settings.changed" };
