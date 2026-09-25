import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Hash, Inbox, Layers, PanelLeftClose, Pin, Plus, Settings, Sparkles, Trash2, WandSparkles } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";
import type { Collection } from "../../shared/types";
import { addToCollection, trashItems } from "../actions";
import { api, thumb } from "../api";
import { useCollections, useLibraryCounts, useTags } from "../queries";
import { errorToast, getState, goTo, setState, toast, useUi, type Scope } from "../store";
import { confirmDialog, promptText } from "./Dialogs";
import { openMenu } from "./Menu";

export const DRAG_TYPE = "application/x-cabinet-items";

function NavRow({
  icon,
  label,
  count,
  active,
  onClick,
  onContextMenu,
  onDrop,
  title,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDrop?: (ids: string[]) => void;
  title?: string;
}) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => !!onDrop && e.dataTransfer.types.includes(DRAG_TYPE);
  return (
    <button
      className={`nav-row${active ? " is-active" : ""}${over ? " is-drop" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title ?? label}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!accepts(e)) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          onDrop!(JSON.parse(e.dataTransfer.getData(DRAG_TYPE)));
        } catch {
          // ignore
        }
      }}
    >
      <span className="nav-icon">{icon}</span>
      <span className="nav-label">{label}</span>
      {count !== undefined && count > 0 && <span className="nav-count">{count.toLocaleString()}</span>}
    </button>
  );
}

function CollectionIcon({ c }: { c: Collection }) {
  if (c.icon) return <span className="nav-emoji">{c.icon}</span>;
  if (c.kind === "smart") return <WandSparkles size={15} />;
  if (c.cover) return <img className="nav-cover" src={thumb(c.cover, 64)} alt="" />;
  return <Layers size={15} />;
}

function Section({ title, onAdd, addLabel, children, collapsible, initiallyOpen = true }: { title: string; onAdd?: () => void; addLabel?: string; children: ReactNode; collapsible?: boolean; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="nav-section">
      <div className="nav-section-head">
        <button className="nav-section-title" onClick={() => collapsible && setOpen(!open)} disabled={!collapsible}>
          {collapsible && <ChevronRight size={12} className={`chev${open ? " open" : ""}`} />}
          {title}
        </button>
        {onAdd && (
          <button className="icon-button tiny" onClick={onAdd} title={addLabel} aria-label={addLabel}>
            <Plus size={14} />
          </button>
        )}
      </div>
      {(!collapsible || open) && children}
    </div>
  );
}

export async function createCollection(kind: "manual" | "smart" = "manual", itemIds?: string[]): Promise<Collection | null> {
  const query = getState().query.trim();
  if (kind === "smart" && !query) {
    toast("Search for something first, then save it as a smart collection");
    return null;
  }
  const name = await promptText({
    title: kind === "smart" ? "New smart collection" : "New collection",
    message: kind === "smart" ? `Everything matching “${query}”, now and in the future.` : undefined,
    placeholder: kind === "smart" ? query : "Moodboard, Reading list, Gift ideas…",
    initial: kind === "smart" ? query : "",
    confirmLabel: "Create",
  });
  if (!name) return null;
  try {
    const c = await api.createCollection({ name, kind, query: kind === "smart" ? query : undefined, itemIds });
    goTo({ type: "collection", id: c.id });
    return c;
  } catch (err) {
    errorToast(err);
    return null;
  }
}

export function Sidebar() {
  const scope = useUi((s) => s.scope);
  const query = useUi((s) => s.query);
  const { data: collections = [] } = useCollections();
  const { data: tags = [] } = useTags();
  const { data: counts } = useLibraryCounts();
  const qc = useQueryClient();
  const is = (s: Scope) => JSON.stringify(s) === JSON.stringify(scope);

  const manual = collections.filter((c) => c.kind === "manual");
  const smart = collections.filter((c) => c.kind === "smart");

  const collectionMenu = (c: Collection, e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      {
        label: "Rename…",
        onSelect: async () => {
          const name = await promptText({ title: "Rename collection", initial: c.name });
          if (name) await api.updateCollection(c.id, { name }).catch(errorToast);
          void qc.invalidateQueries({ queryKey: ["collections"] });
        },
      },
      {
        label: "Set icon…",
        onSelect: async () => {
          const icon = await promptText({ title: "Collection icon", message: "Type or paste an emoji. Leave empty to use the cover image.", initial: c.icon ?? "", confirmLabel: "Set" });
          await api.updateCollection(c.id, { icon: icon ? [...icon][0] : null }).catch(errorToast);
          void qc.invalidateQueries({ queryKey: ["collections"] });
        },
      },
      ...(c.kind === "smart"
        ? [
            {
              label: "Edit search…",
              onSelect: async () => {
                const q = await promptText({ title: "Smart collection search", initial: c.query ?? "", message: "Examples: type:image color:blue, #recipes, site:github.com" });
                if (q) await api.updateCollection(c.id, { query: q }).catch(errorToast);
                void qc.invalidateQueries();
              },
            },
          ]
        : []),
      { separator: true, label: "" },
      {
        label: "Delete collection",
        danger: true,
        onSelect: async () => {
          const ok = await confirmDialog({
            title: `Delete “${c.name}”?`,
            message: c.kind === "manual" ? "The items stay in your cabinet; only the collection is removed." : "Only the saved search is removed.",
            confirmLabel: "Delete",
            danger: true,
          });
          if (!ok) return;
          await api.deleteCollection(c.id).catch(errorToast);
          if (is({ type: "collection", id: c.id })) goTo({ type: "all" });
          void qc.invalidateQueries({ queryKey: ["collections"] });
        },
      },
    ]);
  };

  const tagMenu = (name: string, e: React.MouseEvent) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY, [
      {
        label: "Rename tag…",
        onSelect: async () => {
          const to = await promptText({ title: "Rename tag", initial: name });
          if (to && to !== name) {
            await api.renameTag(name, to).catch(errorToast);
            void qc.invalidateQueries();
          }
        },
      },
      {
        label: "Delete tag",
        danger: true,
        onSelect: async () => {
          const ok = await confirmDialog({ title: `Delete the tag “${name}”?`, message: "It is removed from every item. The items stay.", confirmLabel: "Delete", danger: true });
          if (ok) {
            await api.deleteTag(name).catch(errorToast);
            void qc.invalidateQueries();
          }
        },
      },
    ]);
  };

  const activeTag = /^#(\S+)$/.exec(query.trim())?.[1];

  return (
    <aside className="sidebar">
      <div className="sidebar-top drag-region">
        <div className="brand">Cabinet</div>
        <button className="icon-button subtle no-drag" onClick={() => setState({ sidebarOpen: false })} title="Hide sidebar" aria-label="Hide sidebar">
          <PanelLeftClose size={16} />
        </button>
      </div>
      <nav className="sidebar-scroll">
        <div className="nav-section">
          <NavRow icon={<Inbox size={16} />} label="Everything" count={counts?.total} active={is({ type: "all" }) && !activeTag} onClick={() => goTo({ type: "all" })} />
          <NavRow
            icon={<Pin size={16} />}
            label="Top of Mind"
            count={counts?.pinned}
            active={is({ type: "pinned" })}
            onClick={() => goTo({ type: "pinned" })}
            onDrop={async (ids) => {
              await api.bulk("pin", ids);
              void qc.invalidateQueries();
              toast("Pinned to Top of Mind");
            }}
          />
          <NavRow icon={<Sparkles size={16} />} label="Serendipity" active={is({ type: "serendipity" })} onClick={() => goTo({ type: "serendipity" })} />
        </div>

        <Section title="Collections" onAdd={() => void createCollection("manual")} addLabel="New collection">
          {manual.length === 0 && <div className="nav-empty">Group things by project or mood. Drag cards here.</div>}
          {manual.map((c) => (
            <NavRow
              key={c.id}
              icon={<CollectionIcon c={c} />}
              label={c.name}
              count={c.count}
              active={is({ type: "collection", id: c.id })}
              onClick={() => goTo({ type: "collection", id: c.id })}
              onContextMenu={(e) => collectionMenu(c, e)}
              onDrop={(ids) => void addToCollection(c.id, ids, c.name)}
            />
          ))}
        </Section>

        <Section title="Smart collections" onAdd={() => void createCollection("smart")} addLabel="Save current search as a smart collection" collapsible>
          {smart.length === 0 && <div className="nav-empty">Search, then press + to keep that search as a collection that fills itself.</div>}
          {smart.map((c) => (
            <NavRow
              key={c.id}
              icon={<CollectionIcon c={c} />}
              label={c.name}
              count={c.count}
              title={`${c.name} — ${c.query}`}
              active={is({ type: "collection", id: c.id })}
              onClick={() => goTo({ type: "collection", id: c.id })}
              onContextMenu={(e) => collectionMenu(c, e)}
            />
          ))}
        </Section>

        {tags.length > 0 && (
          <Section title="Tags" collapsible initiallyOpen={tags.length <= 40}>
            <div className="tag-cloud">
              {tags.slice(0, 120).map((t) => (
                <button
                  key={t.name}
                  className={`tag-pill${activeTag === t.name ? " is-active" : ""}`}
                  onClick={() => setState({ scope: { type: "all" }, query: activeTag === t.name ? "" : `#${t.name}`, openItemId: null })}
                  onContextMenu={(e) => tagMenu(t.name, e)}
                  title={`${t.count} item${t.count === 1 ? "" : "s"}`}
                >
                  <Hash size={10} />
                  {t.name}
                </button>
              ))}
            </div>
          </Section>
        )}
      </nav>
      <div className="sidebar-bottom">
        <NavRow
          icon={<Trash2 size={16} />}
          label="Trash"
          count={counts?.trash}
          active={is({ type: "trash" })}
          onClick={() => goTo({ type: "trash" })}
          onDrop={(ids) => void trashItems(ids)}
        />
        <NavRow icon={<Settings size={16} />} label="Settings" onClick={() => setState({ settingsOpen: true })} />
      </div>
    </aside>
  );
}
