import type {
  CanvasPlacement,
  Collection,
  CreateItemInput,
  Facets,
  Item,
  ItemCard,
  ItemPage,
  LibraryInfo,
  Settings,
  TagCount,
  UpdateItemInput,
} from "../shared/types";

// In development the UI is served by Vite and talks to the library server
// through a proxy with a bearer token; in the app the server sets a cookie.
const DEV_TOKEN = (import.meta.env.VITE_CABINET_TOKEN as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function headers(extra?: Record<string, string>): Record<string, string> {
  return {
    "X-Cabinet-Client": "web",
    ...(DEV_TOKEN ? { Authorization: `Bearer ${DEV_TOKEN}` } : {}),
    ...extra,
  };
}

async function request<T>(method: string, url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const isForm = body instanceof FormData;
  const isBlob = body instanceof Blob;
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: headers(body === undefined || isForm ? undefined : isBlob ? { "Content-Type": (body as Blob).type || "application/octet-stream" } : { "Content-Type": "application/json" }),
    body: body === undefined ? undefined : isForm || isBlob ? (body as BodyInit) : JSON.stringify(body),
    ...init,
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, message);
  }
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

export const thumb = (hash: string, width: number) => `/thumbs/${hash}?w=${Math.round(width)}`;
export const blobUrl = (hash: string) => `/blobs/${hash}`;
export const downloadUrl = (hash: string, name?: string | null) => `/blobs/${hash}?download=1${name ? `&name=${encodeURIComponent(name)}` : ""}`;

export function eventsUrl(): string {
  return DEV_TOKEN ? `/api/events?token=${encodeURIComponent(DEV_TOKEN)}` : "/api/events";
}

export interface ListQuery {
  q?: string;
  collection?: string;
  sort?: string;
  trash?: boolean;
  cursor?: string | null;
  limit?: number;
  seed?: number;
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    s.set(k, String(v === true ? 1 : v));
  }
  const str = s.toString();
  return str ? `?${str}` : "";
}

export type SettingsResponse = Settings & { models: { id: string; label: string }[] };

export const api = {
  info: () => request<LibraryInfo>("GET", "/api/info"),
  items: (q: ListQuery) => request<ItemPage>("GET", `/api/items${qs({ ...q })}`),
  facets: (q: { q?: string; collection?: string }) => request<Facets>("GET", `/api/facets${qs(q)}`),
  item: (id: string) => request<Item>("GET", `/api/items/${id}`),
  create: (input: CreateItemInput & { src?: string }) => request<{ id: string; duplicate?: boolean; item: Item }>("POST", "/api/items", input),
  update: (id: string, patch: UpdateItemInput) => request<Item>("PATCH", `/api/items/${id}`, patch),
  refresh: (id: string) => request<{ ok: true }>("POST", `/api/items/${id}/refresh`, {}),
  setPreview: (id: string, blob: Blob) => request<{ ok: true }>("POST", `/api/items/${id}/preview`, blob),
  setText: (id: string, text: string, pages?: number) => request<{ ok: true }>("POST", `/api/items/${id}/text`, { text, pages }),
  similar: (id: string) => request<ItemCard[]>("GET", `/api/items/${id}/similar`),
  link: (id: string, targetId: string) => request<{ ok: true }>("POST", `/api/items/${id}/links`, { targetId }),
  unlink: (id: string, targetId: string) => request<{ ok: true }>("DELETE", `/api/items/${id}/links/${targetId}`),
  bulk: (action: string, ids: string[], extra: { tags?: string[]; collectionId?: string } = {}) =>
    request<{ count: number }>("POST", "/api/items/bulk", { action, ids, ...extra }),
  emptyTrash: () => request<{ count: number }>("DELETE", "/api/trash"),
  serendipity: (limit = 30) => request<ItemCard[]>("GET", `/api/serendipity?limit=${limit}`),
  upload: (files: File[], extra: { collectionId?: string | null; tags?: string[] } = {}) => {
    const form = new FormData();
    if (extra.collectionId) form.append("collectionId", extra.collectionId);
    if (extra.tags?.length) form.append("tags", extra.tags.join(","));
    for (const f of files) form.append("file", f, f.name);
    return request<{ ids: string[] }>("POST", "/api/upload", form);
  },
  tags: () => request<TagCount[]>("GET", "/api/tags"),
  renameTag: (from: string, to: string) => request<{ ok: true }>("POST", "/api/tags/rename", { from, to }),
  deleteTag: (name: string) => request<{ ok: true }>("DELETE", `/api/tags/${encodeURIComponent(name)}`),
  collections: () => request<Collection[]>("GET", "/api/collections"),
  createCollection: (input: { name: string; kind?: "manual" | "smart"; query?: string; icon?: string; itemIds?: string[] }) =>
    request<Collection>("POST", "/api/collections", input),
  updateCollection: (id: string, patch: Partial<Pick<Collection, "name" | "icon" | "query" | "view" | "position" | "description">>) =>
    request<Collection>("PATCH", `/api/collections/${id}`, patch),
  deleteCollection: (id: string) => request<{ ok: true }>("DELETE", `/api/collections/${id}`),
  canvas: (id: string) => request<CanvasPlacement[]>("GET", `/api/collections/${id}/canvas`),
  saveCanvas: (id: string, placements: CanvasPlacement[]) => request<{ ok: true }>("PUT", `/api/collections/${id}/canvas`, placements),
  settings: () => request<SettingsResponse>("GET", "/api/settings"),
  updateSettings: (patch: Partial<Settings> & { aiKey?: string | null }) => request<SettingsResponse>("PATCH", "/api/settings", patch),
  testAi: (aiKey?: string, aiModel?: string) => request<{ ok: true; tags: string[] }>("POST", "/api/settings/test-ai", { aiKey, aiModel }),
  aiBackfill: () => request<{ queued: number }>("POST", "/api/ai/backfill", {}),
  jobs: () => request<{ pending: number }>("GET", "/api/jobs"),
  importBookmarks: (file: File, collectionId?: string | null) => {
    const form = new FormData();
    if (collectionId) form.append("collectionId", collectionId);
    form.append("file", file, file.name);
    return request<{ imported: number; skipped: number }>("POST", "/api/import/bookmarks", form);
  },
  reveal: (hash?: string) => request<{ ok: true }>("POST", "/api/reveal", { hash }),
};
