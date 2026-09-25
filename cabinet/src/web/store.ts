import { useSyncExternalStore } from "react";

export type Scope =
  | { type: "all" }
  | { type: "pinned" }
  | { type: "trash" }
  | { type: "serendipity" }
  | { type: "collection"; id: string };

export type Theme = "system" | "light" | "dark";

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  tone?: "default" | "error";
}

export interface UiState {
  scope: Scope;
  query: string;
  sort: string;
  openItemId: string | null;
  selection: Set<string>;
  settingsOpen: boolean;
  settingsTab: string;
  paletteOpen: boolean;
  gridSize: number;
  theme: Theme;
  sidebarOpen: boolean;
  toasts: Toast[];
  composing: boolean;
}

function readLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`cabinet.${key}`);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(`cabinet.${key}`, JSON.stringify(value));
  } catch {
    // storage unavailable
  }
}

function scopeFromHash(): { scope: Scope; item: string | null } {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, itemPart] = h.split("/item/");
  const item = itemPart || null;
  if (path.startsWith("item/")) return { scope: { type: "all" }, item: path.slice(5) || null };
  if (path === "pinned") return { scope: { type: "pinned" }, item };
  if (path === "trash") return { scope: { type: "trash" }, item };
  if (path === "serendipity") return { scope: { type: "serendipity" }, item };
  if (path.startsWith("c/")) return { scope: { type: "collection", id: path.slice(2) }, item };
  return { scope: { type: "all" }, item };
}

function hashFor(scope: Scope, item: string | null): string {
  const base =
    scope.type === "collection" ? `c/${scope.id}` : scope.type === "all" ? "" : scope.type;
  const withItem = item ? `${base ? `${base}/` : ""}item/${item}` : base;
  return withItem ? `#/${withItem}` : "#/";
}

const initial = scopeFromHash();

let state: UiState = {
  scope: initial.scope,
  query: "",
  sort: readLocal("sort", "newest"),
  openItemId: initial.item,
  selection: new Set(),
  settingsOpen: false,
  settingsTab: "general",
  paletteOpen: false,
  gridSize: readLocal("gridSize", 260),
  theme: readLocal<Theme>("theme", "system"),
  sidebarOpen: readLocal("sidebarOpen", true),
  toasts: [],
  composing: false,
};

const listeners = new Set<() => void>();

export function getState(): UiState {
  return state;
}

export function setState(patch: Partial<UiState> | ((s: UiState) => Partial<UiState>)): void {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  if ("scope" in next || "openItemId" in next) {
    const h = hashFor(state.scope, state.openItemId);
    if (location.hash !== h) history.replaceState(null, "", h);
  }
  if ("gridSize" in next) writeLocal("gridSize", state.gridSize);
  if ("theme" in next) writeLocal("theme", state.theme);
  if ("sort" in next) writeLocal("sort", state.sort);
  if ("sidebarOpen" in next) writeLocal("sidebarOpen", state.sidebarOpen);
  for (const l of listeners) l();
}

export function useUi<T>(selector: (s: UiState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => selector(state),
  );
}

window.addEventListener("hashchange", () => {
  const { scope, item } = scopeFromHash();
  setState({ scope, openItemId: item });
});

let toastId = 0;
export function toast(message: string, opts: { action?: Toast["action"]; tone?: Toast["tone"]; duration?: number } = {}): void {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, action: opts.action, tone: opts.tone }] }));
  setTimeout(() => dismissToast(id), opts.duration ?? (opts.action ? 6000 : 3200));
}

export function dismissToast(id: number): void {
  setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function errorToast(err: unknown): void {
  toast(err instanceof Error ? err.message : String(err), { tone: "error" });
}

export function goTo(scope: Scope): void {
  setState({ scope, openItemId: null, selection: new Set(), query: "" });
}

export function scopeKey(scope: Scope): string {
  return scope.type === "collection" ? `c:${scope.id}` : scope.type;
}
