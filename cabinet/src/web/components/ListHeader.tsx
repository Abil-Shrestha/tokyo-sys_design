import { useQueryClient } from "@tanstack/react-query";
import { ArrowDownUp, LayoutGrid, Map as MapIcon, Minus, Plus, Trash2, WandSparkles } from "lucide-react";
import type { Collection, Facets } from "../../shared/types";
import { COLOR_NAMES, parseQuery } from "../../shared/query";
import { api } from "../api";
import { TYPE_LABELS, plural } from "../lib/format";
import { errorToast, setState, toast, useUi, type Scope } from "../store";
import { confirmDialog } from "./Dialogs";
import { openMenuAt } from "./Menu";
import { createCollection } from "./Sidebar";

const TYPE_ORDER = ["image", "video", "article", "link", "product", "recipe", "note", "quote", "pdf", "post", "repository", "music", "book", "movie", "place", "document", "audio", "file"];
const CHIP_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "brown", "beige", "black", "white", "gray"];

const SORTS: { id: string; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "updated", label: "Recently changed" },
  { id: "title", label: "Title" },
  { id: "random", label: "Shuffle" },
];

export function toggleToken(query: string, token: string): string {
  const parts = query.split(/\s+/).filter(Boolean);
  const lower = token.toLowerCase();
  const has = parts.some((p) => p.toLowerCase() === lower);
  const next = has ? parts.filter((p) => p.toLowerCase() !== lower) : [...parts, token];
  return next.join(" ");
}

function typeCounts(f: Facets | undefined): { type: string; count: number }[] {
  if (!f) return [];
  const counts: Record<string, number> = {};
  for (const [k, n] of Object.entries(f.kinds)) if (k !== "link") counts[k] = n;
  const linkTotal = f.kinds.link ?? 0;
  let typed = 0;
  for (const [k, n] of Object.entries(f.linkTypes)) {
    if (k === "website") continue;
    counts[k] = (counts[k] ?? 0) + n;
    typed += n;
  }
  if (linkTotal - typed > 0) counts.link = linkTotal;
  return TYPE_ORDER.filter((t) => counts[t]).map((t) => ({ type: t, count: counts[t] }));
}

export function scopeTitle(scope: Scope, collection: Collection | undefined, query: string): string {
  if (scope.type === "pinned") return "Top of Mind";
  if (scope.type === "trash") return "Trash";
  if (scope.type === "serendipity") return "Serendipity";
  if (scope.type === "collection") return collection?.name ?? "Collection";
  const tag = /^#(\S+)$/.exec(query.trim())?.[1];
  if (tag) return `#${tag}`;
  return query.trim() ? "Results" : "Everything";
}

export function ListHeader({ scope, total, facets, collection }: { scope: Scope; total: number | undefined; facets: Facets | undefined; collection?: Collection }) {
  const query = useUi((s) => s.query);
  const sort = useUi((s) => s.sort);
  const gridSize = useUi((s) => s.gridSize);
  const qc = useQueryClient();
  const parsed = parseQuery(query);
  const activeTypes = new Set([...parsed.types, ...parsed.soft.filter((s) => s.type).map((s) => s.type!)]);
  const activeColors = new Set([...parsed.colors, ...parsed.soft.filter((s) => s.color).map((s) => s.color!)]);
  const types = typeCounts(facets);
  const title = scopeTitle(scope, collection, query);

  const subtitle =
    scope.type === "pinned"
      ? "Things you want to keep in front of you. Pin anything from its menu."
      : scope.type === "trash"
        ? "Items here are deleted for good after 30 days."
        : collection?.kind === "smart"
          ? `Everything matching “${collection.query}”`
          : null;

  return (
    <div className="list-header">
      <div className="list-title-row">
        <div>
          <h1 className="list-title">
            {collection?.icon && <span className="list-title-icon">{collection.icon}</span>}
            {collection?.kind === "smart" && !collection.icon && <WandSparkles size={22} className="list-title-icon" />}
            {title}
          </h1>
          <div className="list-subtitle">
            {total !== undefined && <span>{plural(total, "item")}</span>}
            {subtitle && <span> · {subtitle}</span>}
          </div>
        </div>
        <div className="list-tools">
          {scope.type === "trash" && total ? (
            <button
              className="button danger-outline"
              onClick={async () => {
                const ok = await confirmDialog({ title: "Empty the trash?", message: `${plural(total, "item")} will be deleted for good.`, confirmLabel: "Empty trash", danger: true });
                if (!ok) return;
                try {
                  const r = await api.emptyTrash();
                  toast(`Deleted ${plural(r.count, "item")}`);
                  void qc.invalidateQueries();
                } catch (err) {
                  errorToast(err);
                }
              }}
            >
              <Trash2 size={14} /> Empty trash
            </button>
          ) : null}
          {query.trim() && scope.type === "all" && (
            <button className="button" onClick={() => void createCollection("smart")} title="Keep this search as a smart collection">
              <WandSparkles size={14} /> Save search
            </button>
          )}
          {collection?.kind === "manual" && (
            <div className="segmented" role="tablist" aria-label="View">
              <button
                className={collection.view !== "canvas" ? "is-active" : ""}
                onClick={() => api.updateCollection(collection.id, { view: "grid" }).then(() => qc.invalidateQueries({ queryKey: ["collections"] }))}
                title="Grid"
                aria-label="Grid view"
              >
                <LayoutGrid size={14} />
              </button>
              <button
                className={collection.view === "canvas" ? "is-active" : ""}
                onClick={() => api.updateCollection(collection.id, { view: "canvas" }).then(() => qc.invalidateQueries({ queryKey: ["collections"] }))}
                title="Canvas"
                aria-label="Canvas view"
              >
                <MapIcon size={14} />
              </button>
            </div>
          )}
          <button
            className="button subtle"
            onClick={(e) =>
              openMenuAt(
                e.currentTarget,
                SORTS.map((s) => ({ label: s.label, icon: s.id === sort ? <span className="dot" /> : <span className="dot-empty" />, onSelect: () => setState({ sort: s.id }) })),
              )
            }
            title="Sort"
          >
            <ArrowDownUp size={14} />
            {SORTS.find((s) => s.id === sort)?.label ?? "Sort"}
          </button>
          <div className="size-control" title="Card size">
            <button className="icon-button tiny" onClick={() => setState({ gridSize: Math.max(160, gridSize - 40) })} aria-label="Smaller cards">
              <Minus size={13} />
            </button>
            <input type="range" min={160} max={520} step={10} value={gridSize} onChange={(e) => setState({ gridSize: Number(e.target.value) })} aria-label="Card size" />
            <button className="icon-button tiny" onClick={() => setState({ gridSize: Math.min(520, gridSize + 40) })} aria-label="Larger cards">
              <Plus size={13} />
            </button>
          </div>
        </div>
      </div>
      {scope.type !== "trash" && (types.length > 1 || activeTypes.size > 0 || total! > 0) && (
        <div className="filter-row">
          {types.map((t) => {
            const active = activeTypes.has(t.type as never);
            return (
              <button
                key={t.type}
                className={`chip${active ? " is-active" : ""}`}
                onClick={() => {
                  let next = query;
                  // Remove a bare soft word like "images" before toggling the explicit filter.
                  for (const s of parsed.soft) if (s.type === t.type) next = toggleToken(next, s.word);
                  setState({ query: toggleToken(next, `type:${t.type}`).trim() });
                }}
              >
                {TYPE_LABELS[t.type] ?? t.type}
                <span className="chip-count">{t.count}</span>
              </button>
            );
          })}
          <span className="filter-sep" />
          {CHIP_COLORS.map((c) => {
            const active = activeColors.has(c);
            return (
              <button
                key={c}
                className={`color-dot${active ? " is-active" : ""}`}
                style={{ background: COLOR_NAMES[c] }}
                title={c}
                aria-label={`Filter by ${c}`}
                onClick={() => {
                  let next = query;
                  for (const s of parsed.soft) if (s.color === c) next = toggleToken(next, s.word);
                  setState({ query: toggleToken(next, `color:${c}`).trim() });
                }}
              />
            );
          })}
          {query.trim() && (
            <button className="chip ghost" onClick={() => setState({ query: "" })}>
              Clear
            </button>
          )}
          <button
            className="chip ghost help-chip"
            onClick={(e) =>
              openMenuAt(e.currentTarget, [
                { label: "red chair — words and colours", disabled: true },
                { label: "#travel — a tag", disabled: true },
                { label: "type:article · type:image", disabled: true },
                { label: "site:github.com", disabled: true },
                { label: "color:#ff6600", disabled: true },
                { label: "date:week · after:2024-01", disabled: true },
                { label: "has:note · is:pinned", disabled: true },
                { label: '"exact phrase" · -exclude', disabled: true },
              ])
            }
          >
            Search tips
          </button>
        </div>
      )}
    </div>
  );
}
