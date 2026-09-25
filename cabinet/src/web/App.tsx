import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CheckSquare, Copy, FolderPlus, Hash, Layers, Maximize2, Pin, PinOff, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import type { ItemCard } from "../shared/types";
import { addToCollection, copyText, openExternal, pickFiles, purgeItems, restoreItems, saveTransfer, setPinned, trashItems } from "./actions";
import { api } from "./api";
import { CanvasView } from "./components/CanvasView";
import { CommandPalette } from "./components/CommandPalette";
import { COMPOSER_HEIGHT, Composer } from "./components/Composer";
import { DialogHost, promptText } from "./components/Dialogs";
import { Grid } from "./components/Grid";
import { ItemView } from "./components/ItemView";
import { ListHeader } from "./components/ListHeader";
import { MenuHost, openMenu, type MenuItem } from "./components/Menu";
import { Serendipity } from "./components/Serendipity";
import { SettingsModal } from "./components/SettingsModal";
import { createCollection, DRAG_TYPE, Sidebar } from "./components/Sidebar";
import { focusSearch, importBookmarksFlow, TopBar } from "./components/TopBar";
import { isEditable, plural } from "./lib/format";
import { useCollections, useFacets, useItems, useLiveUpdates } from "./queries";
import { dismissToast, errorToast, getState, setState, toast, useUi } from "./store";

function useTheme() {
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.resolvedTheme = resolved;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.tone === "error" ? " is-error" : ""}`}>
          <span>{t.message}</span>
          {t.action && (
            <button
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function BulkBar({ items }: { items: ItemCard[] }) {
  const selection = useUi((s) => s.selection);
  const scope = useUi((s) => s.scope);
  const { data: collections = [] } = useCollections();
  const qc = useQueryClient();
  if (!selection.size) return null;
  const ids = [...selection];
  const clear = () => setState({ selection: new Set() });
  const trash = scope.type === "trash";
  const allPinned = ids.every((id) => items.find((i) => i.id === id)?.pinned);
  return (
    <div className="bulkbar" role="toolbar" aria-label="Selection">
      <span className="bulkbar-count">{plural(ids.length, "item")} selected</span>
      {trash ? (
        <>
          <button className="button small" onClick={() => void restoreItems(ids).then(clear)}>
            <RotateCcw size={14} /> Restore
          </button>
          <button className="button small danger" onClick={() => void purgeItems(ids)}>
            <Trash2 size={14} /> Delete forever
          </button>
        </>
      ) : (
        <>
          <button
            className="button small"
            onClick={async () => {
              const t = await promptText({ title: `Tag ${plural(ids.length, "item")}`, placeholder: "design, inspiration", confirmLabel: "Add tags" });
              if (!t) return;
              await api.bulk("tag", ids, { tags: t.split(",").map((x) => x.trim()).filter(Boolean) }).catch(errorToast);
              void qc.invalidateQueries();
              toast("Tags added");
            }}
          >
            <Hash size={14} /> Tag
          </button>
          <button
            className="button small"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openMenu(r.left, r.top - 8 - Math.min(10, collections.length + 2) * 32, [
                ...collections.filter((c) => c.kind === "manual").map((c) => ({ label: c.name, onSelect: () => void addToCollection(c.id, ids, c.name) })),
                { separator: true, label: "" },
                { label: "New collection…", icon: <FolderPlus size={14} />, onSelect: () => void createCollection("manual", ids) },
              ]);
            }}
          >
            <Layers size={14} /> Add to…
          </button>
          <button className="button small" onClick={() => void setPinned(ids, !allPinned)}>
            {allPinned ? <PinOff size={14} /> : <Pin size={14} />} {allPinned ? "Unpin" : "Pin"}
          </button>
          {scope.type === "collection" && collections.find((c) => c.id === scope.id)?.kind === "manual" && (
            <button
              className="button small"
              onClick={async () => {
                await api.bulk("uncollect", ids, { collectionId: scope.id });
                void qc.invalidateQueries();
                clear();
              }}
            >
              Remove from collection
            </button>
          )}
          <button className="button small danger" onClick={() => void trashItems(ids)}>
            <Trash2 size={14} /> Trash
          </button>
        </>
      )}
      <button className="icon-button" onClick={clear} aria-label="Clear selection" title="Clear selection (Esc)">
        <X size={15} />
      </button>
    </div>
  );
}

function EmptyState({ kind, query }: { kind: string; query: string }) {
  if (query.trim()) {
    return (
      <div className="empty">
        <h2>Nothing matches “{query.trim()}”</h2>
        <p>Try fewer words, a colour (“blue”), a type (“type:article”) or a tag (“#travel”).</p>
      </div>
    );
  }
  if (kind === "trash")
    return (
      <div className="empty">
        <h2>The trash is empty</h2>
      </div>
    );
  if (kind === "pinned")
    return (
      <div className="empty">
        <h2>Nothing pinned yet</h2>
        <p>Pin things you want to keep in front of you: open an item and press the pin, or drag cards onto Top of Mind.</p>
      </div>
    );
  if (kind === "collection")
    return (
      <div className="empty">
        <h2>This collection is empty</h2>
        <p>Drag cards onto it in the sidebar, or drop and paste things while it is open.</p>
      </div>
    );
  return (
    <div className="empty welcome">
      <h2>A place for everything you want to remember</h2>
      <p>No folders to maintain. Save it, and find it again by what it is, what it says or what it looks like.</p>
      <ul>
        <li>
          <b>Paste</b> anything with ⌘V: links, images, screenshots, text.
        </li>
        <li>
          <b>Drop</b> files, images and links from anywhere onto this window.
        </li>
        <li>
          <b>Write</b> a note in the card above.
        </li>
        <li>
          <b>Import</b> your browser bookmarks from Settings → Import & export.
        </li>
        <li>
          <b>Save from the browser</b> with the extension (Settings → Browser extension).
        </li>
      </ul>
    </div>
  );
}

export function App() {
  useTheme();
  useLiveUpdates();
  const qc = useQueryClient();
  const scope = useUi((s) => s.scope);
  const query = useUi((s) => s.query);
  const sort = useUi((s) => s.sort);
  const openItemId = useUi((s) => s.openItemId);
  const selection = useUi((s) => s.selection);
  const gridSize = useUi((s) => s.gridSize);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const { data: collections = [] } = useCollections();
  const collection = scope.type === "collection" ? collections.find((c) => c.id === scope.id) : undefined;
  const itemsQuery = useItems(scope, query, sort);
  const { data: facets } = useFacets(scope, query);
  const items = useMemo(() => itemsQuery.data?.pages.flatMap((p) => p.items) ?? [], [itemsQuery.data]);
  const total = itemsQuery.data?.pages[0]?.total;
  const [dragging, setDragging] = useState(false);
  const canvas = collection?.kind === "manual" && collection.view === "canvas";

  // Canvas needs every item of the collection.
  useEffect(() => {
    if (canvas && itemsQuery.hasNextPage && !itemsQuery.isFetchingNextPage) void itemsQuery.fetchNextPage();
  }, [canvas, itemsQuery]);

  // A collection that no longer exists: go home.
  useEffect(() => {
    if (scope.type === "collection" && collections.length && !collection) setState({ scope: { type: "all" } });
  }, [scope, collections, collection]);

  const onOpen = useCallback((item: ItemCard) => setState({ openItemId: item.id }), []);

  const onToggleSelect = useCallback(
    (item: ItemCard, e: MouseEvent) => {
      setState((s) => {
        const next = new Set(s.selection);
        if (e.shiftKey && s.selection.size) {
          const ids = items.map((i) => i.id);
          const last = [...s.selection].pop()!;
          const a = ids.indexOf(last);
          const b = ids.indexOf(item.id);
          if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(ids[i]);
        } else if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return { selection: next };
      });
    },
    [items],
  );

  const onContextMenu = useCallback(
    (item: ItemCard, e: MouseEvent) => {
      const sel = getState().selection;
      const ids = sel.has(item.id) ? [...sel] : [item.id];
      const many = ids.length > 1;
      const trash = getState().scope.type === "trash";
      const entries: MenuItem[] = trash
        ? [
            { label: many ? `Restore ${ids.length} items` : "Restore", icon: <RotateCcw size={14} />, onSelect: () => void restoreItems(ids) },
            { label: "Delete forever", icon: <Trash2 size={14} />, danger: true, onSelect: () => void purgeItems(ids) },
          ]
        : [
            ...(!many ? [{ label: "Open", icon: <Maximize2 size={14} />, onSelect: () => onOpen(item) }] : []),
            ...(!many && item.url ? [{ label: "Open original", icon: <ArrowUpRight size={14} />, onSelect: () => openExternal(item.url!) }] : []),
            ...(!many && item.url ? [{ label: "Copy link", icon: <Copy size={14} />, onSelect: () => void copyText(item.url!, "Link copied") }] : []),
            {
              label: "Add to collection",
              icon: <Layers size={14} />,
              submenu: [
                ...collections.filter((c) => c.kind === "manual").map((c) => ({ label: c.name, onSelect: () => void addToCollection(c.id, ids, c.name) })),
                ...(collections.some((c) => c.kind === "manual") ? [{ separator: true, label: "" }] : []),
                { label: "New collection…", onSelect: () => void createCollection("manual", ids) },
              ],
            },
            { label: item.pinned ? "Remove from Top of Mind" : "Pin to Top of Mind", icon: item.pinned ? <PinOff size={14} /> : <Pin size={14} />, onSelect: () => void setPinned(ids, !item.pinned) },
            { label: "Select", icon: <CheckSquare size={14} />, onSelect: () => setState((s) => ({ selection: new Set([...s.selection, ...ids]) })) },
            { separator: true, label: "" },
            { label: many ? `Move ${ids.length} items to trash` : "Move to trash", icon: <Trash2 size={14} />, danger: true, onSelect: () => void trashItems(ids) },
          ];
      openMenu(e.clientX, e.clientY, entries);
    },
    [collections, onOpen],
  );

  const onDragStart = useCallback((item: ItemCard, e: DragEvent) => {
    const sel = getState().selection;
    const ids = sel.has(item.id) ? [...sel] : [item.id];
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
    if (item.url) {
      e.dataTransfer.setData("text/uri-list", item.url);
      e.dataTransfer.setData("text/plain", item.url);
    } else if (item.kind === "note" || item.kind === "quote") {
      e.dataTransfer.setData("text/plain", item.excerpt ?? "");
    }
    e.dataTransfer.effectAllowed = "copyLink";
  }, []);

  // Commands from the desktop app's menu.
  useEffect(
    () =>
      window.cabinetDesktop?.onCommand((command) => {
        const s = getState();
        if (command === "settings") setState({ settingsOpen: true });
        else if (command === "palette") setState({ paletteOpen: !s.paletteOpen });
        else if (command === "sidebar") setState({ sidebarOpen: !s.sidebarOpen });
        else if (command === "upload") pickFiles();
        else if (command === "import") void importBookmarksFlow();
        else if (command === "new-note")
          setState({ composing: true, query: "", openItemId: null, scope: s.scope.type === "all" || s.scope.type === "collection" ? s.scope : { type: "all" } });
      }),
    [],
  );

  // Paste anywhere (outside text fields) to save.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || !e.clipboardData) return;
      e.preventDefault();
      void saveTransfer(e.clipboardData);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Drop files and links from other apps.
  useEffect(() => {
    let depth = 0;
    const external = (e: globalThis.DragEvent) => {
      const types = Array.from(e.dataTransfer?.types ?? []);
      return !types.includes(DRAG_TYPE) && (types.includes("Files") || types.includes("text/uri-list") || types.includes("text/plain") || types.includes("text/html"));
    };
    const enter = (e: globalThis.DragEvent) => {
      if (!external(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: globalThis.DragEvent) => {
      if (!external(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: globalThis.DragEvent) => {
      if (!external(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const drop = (e: globalThis.DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!external(e) || !e.dataTransfer) return;
      e.preventDefault();
      void saveTransfer(e.dataTransfer);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = isEditable(e.target);
      const mod = e.metaKey || e.ctrlKey;
      const s = getState();
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setState({ paletteOpen: !s.paletteOpen });
        return;
      }
      if (mod && e.key === ",") {
        e.preventDefault();
        setState({ settingsOpen: true });
        return;
      }
      if (typing || s.openItemId || s.paletteOpen || s.settingsOpen) return;
      if (e.key === "/") {
        e.preventDefault();
        focusSearch();
      } else if (e.key === "n" && !mod) {
        e.preventDefault();
        if (s.scope.type !== "all" && s.scope.type !== "collection") setState({ scope: { type: "all" } });
        setState({ composing: true, query: "" });
      } else if (e.key === "Escape" && s.selection.size) {
        setState({ selection: new Set() });
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setState({ selection: new Set(items.map((i) => i.id)) });
      } else if ((e.key === "Backspace" || e.key === "Delete") && s.selection.size) {
        e.preventDefault();
        if (s.scope.type === "trash") void purgeItems([...s.selection]);
        else void trashItems([...s.selection]);
      } else if (mod && e.key.toLowerCase() === "o") {
        e.preventDefault();
        pickFiles();
      } else if (e.key === "\\" && mod) {
        setState({ sidebarOpen: !s.sidebarOpen });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items]);

  const showComposer = !query.trim() && (scope.type === "all" || (scope.type === "collection" && collection?.kind === "manual"));
  const leading = useMemo(() => (showComposer ? { node: <Composer />, height: COMPOSER_HEIGHT } : null), [showComposer]);
  const scopeKeyStr = `${scope.type}:${scope.type === "collection" ? scope.id : ""}:${query}:${sort}`;

  let main;
  if (scope.type === "serendipity") {
    main = <Serendipity />;
  } else if (canvas && collection) {
    main = (
      <div className="canvas-layout">
        <div className="canvas-header">
          <ListHeader scope={scope} total={total} facets={facets} collection={collection} />
        </div>
        <CanvasView collection={collection} items={items} />
      </div>
    );
  } else {
    main = (
      <Grid
        items={items}
        targetWidth={gridSize}
        hasMore={!!itemsQuery.hasNextPage}
        loadingMore={itemsQuery.isFetchingNextPage}
        onLoadMore={() => void itemsQuery.fetchNextPage()}
        selection={selection}
        onOpen={onOpen}
        onToggleSelect={onToggleSelect}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
        leading={leading}
        scrollKey={scopeKeyStr}
        header={<ListHeader scope={scope} total={total} facets={facets} collection={collection} />}
        footer={
          <>
            {itemsQuery.isFetchingNextPage && (
              <div className="grid-more">
                <span className="spinner" />
              </div>
            )}
            {itemsQuery.isSuccess && total === 0 && <EmptyState kind={scope.type} query={query} />}
            {itemsQuery.isError && (
              <div className="empty">
                <h2>Couldn't load your library</h2>
                <p>{(itemsQuery.error as Error)?.message}</p>
                <button className="button" onClick={() => void qc.invalidateQueries()}>
                  Try again
                </button>
              </div>
            )}
          </>
        }
      />
    );
  }

  return (
    <div className={`app${sidebarOpen ? "" : " sidebar-hidden"}${window.cabinetDesktop?.platform === "darwin" ? " is-mac-desktop" : ""}`}>
      {sidebarOpen && <Sidebar />}
      <main className="main">
        <TopBar />
        {main}
        <BulkBar items={items} />
      </main>
      {openItemId && <ItemView id={openItemId} siblings={scope.type === "serendipity" ? [] : items.map((i) => i.id)} />}
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <div className="drop-title">Drop to save</div>
            <div className="muted">{collection ? `Into ${collection.name}` : "Files, images, links and text"}</div>
          </div>
        </div>
      )}
      <SettingsModal />
      <CommandPalette />
      <MenuHost />
      <DialogHost />
      <Toasts />
    </div>
  );
}

declare global {
  interface Window {
    cabinetDesktop?: {
      platform: string;
      version: string;
      onCommand(callback: (command: string) => void): () => void;
      chooseLibrary(): Promise<string | null>;
    };
  }
}
