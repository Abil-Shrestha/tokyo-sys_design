import { useQuery } from "@tanstack/react-query";
import { FolderPlus, Hash, Import, Inbox, Layers, Moon, Pin, Search, Settings, Sparkles, StickyNote, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pickFiles, startNote } from "../actions";
import { api, thumb } from "../api";
import { displayTitle, typeLabel } from "../lib/format";
import { useCollections, useTags } from "../queries";
import { getState, goTo, setState, useUi } from "../store";
import { createCollection } from "./Sidebar";
import { importBookmarksFlow } from "./TopBar";

interface Entry {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
  group: string;
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { data: collections = [] } = useCollections();
  const { data: tags = [] } = useTags();
  const { data: lastResults } = useQuery({
    queryKey: ["palette", q],
    queryFn: () => api.items({ q, limit: 8 }),
    enabled: open && q.trim().length > 0,
    placeholderData: (p) => p,
  });

  // Placeholder data from an earlier search must not show for an empty box.
  const results = q.trim() ? lastResults : undefined;

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const close = () => setState({ paletteOpen: false });

  const entries = useMemo(() => {
    const lower = q.trim().toLowerCase();
    const match = (s: string) => !lower || s.toLowerCase().includes(lower);
    const list: Entry[] = [];
    if (lower) {
      list.push({
        id: "search",
        label: `Search for “${q.trim()}”`,
        icon: <Search size={15} />,
        group: "Search",
        run: () => setState({ query: q.trim(), scope: getState().scope.type === "serendipity" ? { type: "all" } : getState().scope, openItemId: null }),
      });
    }
    for (const item of results?.items ?? []) {
      const hash = item.kind === "image" ? item.asset : item.preview;
      list.push({
        id: `item:${item.id}`,
        label: displayTitle(item),
        hint: typeLabel(item),
        icon: hash ? <img className="palette-thumb" src={thumb(hash, 64)} alt="" /> : <StickyNote size={15} />,
        group: "Items",
        run: () => setState({ openItemId: item.id }),
      });
    }
    const commands: Entry[] = [
      { id: "all", label: "Everything", icon: <Inbox size={15} />, group: "Go to", run: () => goTo({ type: "all" }) },
      { id: "pinned", label: "Top of Mind", icon: <Pin size={15} />, group: "Go to", run: () => goTo({ type: "pinned" }) },
      { id: "serendipity", label: "Serendipity", icon: <Sparkles size={15} />, group: "Go to", run: () => goTo({ type: "serendipity" }) },
      { id: "trash", label: "Trash", icon: <Trash2 size={15} />, group: "Go to", run: () => goTo({ type: "trash" }) },
      ...collections.map((c) => ({
        id: `c:${c.id}`,
        label: c.name,
        hint: c.kind === "smart" ? "Smart collection" : "Collection",
        icon: c.icon ? <span>{c.icon}</span> : <Layers size={15} />,
        group: "Go to",
        run: () => goTo({ type: "collection", id: c.id }),
      })),
      { id: "new-note", label: "New note", icon: <StickyNote size={15} />, group: "Actions", run: startNote },
      {
        id: "upload",
        label: "Upload files…",
        icon: <Upload size={15} />,
        group: "Actions",
        run: pickFiles,
      },
      { id: "new-collection", label: "New collection", icon: <FolderPlus size={15} />, group: "Actions", run: () => void createCollection("manual") },
      { id: "import", label: "Import bookmarks…", icon: <Import size={15} />, group: "Actions", run: () => void importBookmarksFlow() },
      {
        id: "theme",
        label: "Toggle dark mode",
        icon: <Moon size={15} />,
        group: "Actions",
        run: () => {
          const dark = document.documentElement.dataset.resolvedTheme === "dark";
          setState({ theme: dark ? "light" : "dark" });
        },
      },
      { id: "settings", label: "Settings", icon: <Settings size={15} />, group: "Actions", run: () => setState({ settingsOpen: true }) },
      ...tags.slice(0, 200).map((t) => ({
        id: `t:${t.name}`,
        label: `#${t.name}`,
        hint: `${t.count}`,
        icon: <Hash size={15} />,
        group: "Tags",
        run: () => setState({ query: `#${t.name}`, scope: { type: "all" }, openItemId: null }),
      })),
    ];
    const filtered = commands.filter((c) => match(c.label));
    list.push(...(lower ? filtered.slice(0, 12) : filtered.filter((c) => c.group !== "Tags").slice(0, 14)));
    return list;
  }, [q, results, collections, tags]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;
  let lastGroup = "";
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={close}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={17} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search items, collections, tags and commands…"
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing || e.keyCode === 229) return;
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(entries.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                const entry = entries[active];
                if (entry) {
                  close();
                  entry.run();
                }
              }
            }}
          />
        </div>
        <div className="palette-list" ref={listRef}>
          {entries.map((entry, i) => {
            const header = entry.group !== lastGroup ? <div className="palette-group">{entry.group}</div> : null;
            lastGroup = entry.group;
            return (
              <div key={entry.id}>
                {header}
                <button
                  className={`palette-item${i === active ? " is-active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => {
                    close();
                    entry.run();
                  }}
                >
                  <span className="palette-icon">{entry.icon}</span>
                  <span className="palette-label">{entry.label}</span>
                  {entry.hint && <span className="palette-hint">{entry.hint}</span>}
                </button>
              </div>
            );
          })}
          {!entries.length && <div className="palette-empty">No matches</div>}
        </div>
      </div>
    </div>
  );
}
