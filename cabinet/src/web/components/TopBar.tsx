import { FolderPlus, Import, Link2, PanelLeftOpen, Plus, Search, StickyNote, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { saveText, startNote, uploadFiles } from "../actions";
import { api } from "../api";
import { isUrl } from "../lib/format";
import { queryClient } from "../queries";
import { errorToast, getState, setState, toast, useUi } from "../store";
import { promptText } from "./Dialogs";
import { openMenuAt } from "./Menu";
import { createCollection } from "./Sidebar";

export function focusSearch(): void {
  document.querySelector<HTMLInputElement>(".search-input")?.focus();
}

export async function importBookmarksFlow(): Promise<void> {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".html,.htm,.csv,text/html,text/csv";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const scope = getState().scope;
      const r = await api.importBookmarks(file, scope.type === "collection" ? scope.id : null);
      toast(`Imported ${r.imported.toLocaleString()} link${r.imported === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} already saved)` : ""}. Fetching previews in the background.`, { duration: 6000 });
      void queryClient.invalidateQueries();
    } catch (err) {
      errorToast(err);
    }
  };
  input.click();
}

export function TopBar() {
  const query = useUi((s) => s.query);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const [value, setValue] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep the field in sync when the query is changed elsewhere (tag clicks…).
  useEffect(() => setValue(query), [query]);

  const update = (v: string) => {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState({ query: v, selection: new Set() }), 140);
  };

  const addMenu = (el: HTMLElement) =>
    openMenuAt(el, [
      { label: "New note", icon: <StickyNote size={15} />, shortcut: "N", onSelect: startNote },
      {
        label: "Save a link…",
        icon: <Link2 size={15} />,
        onSelect: async () => {
          const url = await promptText({ title: "Save a link", placeholder: "https://…", confirmLabel: "Save" });
          if (url && isUrl(url)) await saveText(url);
          else if (url) errorToast("That doesn't look like a web address");
        },
      },
      { label: "Upload files…", icon: <Upload size={15} />, onSelect: () => fileRef.current?.click() },
      { separator: true, label: "" },
      { label: "New collection", icon: <FolderPlus size={15} />, onSelect: () => void createCollection("manual") },
      { label: "Import bookmarks…", icon: <Import size={15} />, onSelect: () => void importBookmarksFlow() },
    ]);

  return (
    <header className="topbar drag-region">
      {!sidebarOpen && (
        <button className="icon-button subtle no-drag topbar-sidebar" onClick={() => setState({ sidebarOpen: true })} title="Show sidebar" aria-label="Show sidebar">
          <PanelLeftOpen size={16} />
        </button>
      )}
      <div className="search no-drag">
        <Search size={16} className="search-icon" />
        <input
          className="search-input"
          value={value}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (value) update("");
              else (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Enter") {
              if (timer.current) clearTimeout(timer.current);
              setState({ query: value });
            }
            e.stopPropagation();
          }}
          placeholder="Search your cabinet"
          spellCheck={false}
          aria-label="Search"
        />
        {value ? (
          <button className="icon-button tiny search-clear" onClick={() => update("")} aria-label="Clear search">
            <X size={14} />
          </button>
        ) : (
          <kbd className="search-kbd">⌘K</kbd>
        )}
      </div>
      <div className="topbar-actions no-drag">
        <button className="button primary add-button" onClick={(e) => addMenu(e.currentTarget)} aria-label="Add">
          <Plus size={16} />
          <span>Add</span>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void uploadFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </header>
  );
}
