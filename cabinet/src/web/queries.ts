import { QueryClient, useInfiniteQuery, useQuery, type InfiniteData } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ItemCard, ItemPage, LibraryEvent } from "../shared/types";
import { api, eventsUrl } from "./api";
import { scopeKey, type Scope } from "./store";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

export const PAGE_SIZE = 120;

export function scopeQuery(scope: Scope, query: string): { q: string; collection?: string; trash?: boolean } {
  switch (scope.type) {
    case "pinned":
      return { q: `is:pinned ${query}`.trim() };
    case "trash":
      return { q: query, trash: true };
    case "collection":
      return { q: query, collection: scope.id };
    default:
      return { q: query };
  }
}

export function useItems(scope: Scope, query: string, sort: string) {
  const params = scopeQuery(scope, query);
  return useInfiniteQuery({
    queryKey: ["items", scopeKey(scope), query, sort],
    queryFn: ({ pageParam }) => api.items({ ...params, sort: query.trim() && sort === "newest" ? "relevance" : sort, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: (prev) => prev,
    enabled: scope.type !== "serendipity",
  });
}

export function useFacets(scope: Scope, query: string) {
  const params = scopeQuery(scope, query);
  return useQuery({
    queryKey: ["facets", scopeKey(scope), query],
    queryFn: () => api.facets({ q: params.q, collection: params.collection }),
    placeholderData: (prev) => prev,
    enabled: scope.type !== "trash" && scope.type !== "serendipity",
  });
}

export function useLibraryCounts() {
  return useQuery({ queryKey: ["facets", "all", ""], queryFn: () => api.facets({}) });
}

export function useItem(id: string | null) {
  return useQuery({ queryKey: ["item", id], queryFn: () => api.item(id!), enabled: !!id });
}

export function useCollections() {
  return useQuery({ queryKey: ["collections"], queryFn: api.collections });
}

export function useTags() {
  return useQuery({ queryKey: ["tags"], queryFn: api.tags });
}

export function useSettings() {
  return useQuery({ queryKey: ["settings"], queryFn: api.settings });
}

export function useInfo() {
  return useQuery({ queryKey: ["info"], queryFn: api.info });
}

/** Replaces one card wherever it appears in cached item lists. */
function patchCard(card: ItemCard): void {
  queryClient.setQueriesData<InfiniteData<ItemPage>>({ queryKey: ["items"] }, (data) => {
    if (!data) return data;
    let changed = false;
    const pages = data.pages.map((p) => ({
      ...p,
      items: p.items.map((i) => {
        if (i.id !== card.id) return i;
        changed = true;
        return card;
      }),
    }));
    return changed ? { ...data, pages } : data;
  });
}

let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
const pendingKeys = new Set<string>();

function invalidateSoon(...keys: string[]): void {
  for (const k of keys) pendingKeys.add(k);
  if (invalidateTimer) return;
  invalidateTimer = setTimeout(() => {
    invalidateTimer = null;
    const list = [...pendingKeys];
    pendingKeys.clear();
    for (const k of list) void queryClient.invalidateQueries({ queryKey: [k] });
  }, 250);
}

const updateTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function refreshItem(id: string): Promise<void> {
  try {
    const item = await api.item(id);
    queryClient.setQueryData(["item", id], item);
    patchCard(item);
  } catch {
    invalidateSoon("items");
  }
}

export function handleEvent(event: LibraryEvent): void {
  switch (event.type) {
    case "item.created":
      invalidateSoon("items", "facets");
      break;
    case "item.updated": {
      // Coalesce bursts of updates to the same item.
      const existing = updateTimers.get(event.id);
      if (existing) clearTimeout(existing);
      updateTimers.set(
        event.id,
        setTimeout(() => {
          updateTimers.delete(event.id);
          void refreshItem(event.id);
          invalidateSoon("facets", "similar");
        }, 120),
      );
      break;
    }
    case "item.deleted":
    case "items.changed":
      invalidateSoon("items", "facets", "collections", "tags");
      break;
    case "collections.changed":
      invalidateSoon("collections", "canvas");
      break;
    case "tags.changed":
      invalidateSoon("tags", "facets");
      break;
    case "settings.changed":
      invalidateSoon("settings");
      break;
  }
}

export function useLiveUpdates(): void {
  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      source = new EventSource(eventsUrl(), { withCredentials: true });
      source.onmessage = (e) => {
        try {
          handleEvent(JSON.parse(e.data) as LibraryEvent);
        } catch {
          // ignore malformed events
        }
      };
      source.onerror = () => {
        source?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
      source.onopen = () => invalidateSoon("items", "facets", "collections", "tags");
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, []);
}
