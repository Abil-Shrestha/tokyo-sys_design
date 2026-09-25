import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Link2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Item, ItemCard } from "../../shared/types";
import { addToCollection, copyText, openExternal, purgeItems, restoreItems, setPinned, trashItems } from "../actions";
import { api, blobUrl, downloadUrl, thumb } from "../api";
import { formatBytes, formatPrice, fullDate, isEditable, relativeTime, typeLabel } from "../lib/format";
import { renderMarkdown, sanitizeArticle } from "../lib/markdown";
import { useCollections, useInfo, useItem } from "../queries";
import { errorToast, getState, setState, toast } from "../store";
import { isMenuOpen, openMenu, openMenuAt } from "./Menu";
import { createCollection } from "./Sidebar";
import { TagEditor } from "./TagEditor";

// ---------------------------------------------------------------------------
// Autosaving text fields

/**
 * Local text state for one field of an item, saved after a pause in typing.
 * While the field has focus or holds unsaved edits, values coming back from
 * the server (including the echo of our own save) never replace what is on
 * screen, so typing is never interrupted or undone.
 */
function useAutosave(id: string, field: "title" | "note" | "body", serverValue: string | null) {
  const qc = useQueryClient();
  const [value, setValue] = useState(serverValue ?? "");
  const valueRef = useRef(value);
  valueRef.current = value;
  const idRef = useRef(id);
  const pending = useRef(false);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    async (itemId: string, v: string) => {
      try {
        const item = await api.update(itemId, { [field]: v });
        qc.setQueryData(["item", itemId], item);
      } catch (err) {
        errorToast(err);
      } finally {
        // Only a save of what is currently on screen makes the field clean.
        if (idRef.current === itemId && valueRef.current === v) pending.current = false;
      }
    },
    [field, qc],
  );

  // Switching items: save what was typed for the previous one first.
  useEffect(() => {
    idRef.current = id;
    pending.current = false;
    setValue(serverValue ?? "");
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (pending.current) void save(id, valueRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!pending.current && !focused.current) setValue(serverValue ?? "");
  }, [serverValue]);

  const flush = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    void save(idRef.current, valueRef.current);
  };

  const onChange = (v: string) => {
    pending.current = true;
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void save(idRef.current, v);
    }, 600);
  };

  return {
    value,
    onChange,
    flush,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      flush();
    },
  };
}

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { minRows?: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { minRows = 1, ...rest } = props;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      rows={minRows}
      {...rest}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Escape leaves the field; a second Escape closes the item.
        if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur();
        props.onKeyDown?.(e);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Content (left side)

function youtubeEmbed(item: Item): string | null {
  if (!item.url) return null;
  try {
    const u = new URL(item.url);
    const host = u.hostname.replace(/^www\.|^m\./, "");
    if (host === "youtube.com" && u.searchParams.get("v")) return `https://www.youtube-nocookie.com/embed/${u.searchParams.get("v")}`;
    if (host === "youtube.com" && u.pathname.startsWith("/shorts/")) return `https://www.youtube-nocookie.com/embed/${u.pathname.split("/")[2]}`;
    if (host === "youtu.be") return `https://www.youtube-nocookie.com/embed/${u.pathname.slice(1)}`;
    if (host === "vimeo.com" && /^\/\d+/.test(u.pathname)) return `https://player.vimeo.com/video${u.pathname}`;
  } catch {
    // not a URL
  }
  return null;
}

function NoteContent({ item, focus }: { item: Item; focus: boolean }) {
  const body = useAutosave(item.id, "body", item.body);
  const [editing, setEditing] = useState(!item.body);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setEditing(!item.body), [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (editing) setTimeout(() => ref.current?.focus(), 30);
  }, [editing]);
  return (
    <div className={`note-content${focus ? " is-focus" : ""}`}>
      <div className="note-toolbar">
        <button className="button subtle small" onClick={() => setEditing(!editing)}>
          {editing ? <Eye size={14} /> : <Pencil size={14} />}
          {editing ? "Preview" : "Edit"}
        </button>
        <span className="muted small">Markdown supported</span>
      </div>
      {editing ? (
        <textarea
          ref={ref}
          className="note-editor"
          value={body.value}
          onChange={(e) => body.onChange(e.target.value)}
          onFocus={body.onFocus}
          onBlur={body.onBlur}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              body.flush();
              setEditing(false);
            }
          }}
          placeholder="Write something…"
          spellCheck
        />
      ) : (
        <div className="note-rendered prose" onDoubleClick={() => setEditing(true)} dangerouslySetInnerHTML={{ __html: renderMarkdown(body.value || "*Empty note — double-click to write*") }} />
      )}
    </div>
  );
}

function QuoteContent({ item }: { item: Item }) {
  const body = useAutosave(item.id, "body", item.body);
  return (
    <div className="quote-content">
      <AutoTextarea className="quote-editor" value={body.value} onChange={(e) => body.onChange(e.target.value)} onFocus={body.onFocus} onBlur={body.onBlur} />
      {(item.title || item.url) && (
        <div className="quote-source">
          — {item.title ?? item.domain}
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <ArrowUpRight size={14} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function ImageContent({ item }: { item: Item }) {
  const [zoom, setZoom] = useState(false);
  return (
    <div className={`image-content${zoom ? " is-zoomed" : ""}`} onClick={() => setZoom(!zoom)} style={{ background: item.colors[0]?.hex ? `${item.colors[0].hex}22` : undefined }}>
      <img src={blobUrl(item.asset!)} alt={item.title ?? item.summary ?? ""} draggable={false} />
    </div>
  );
}

function LinkContent({ item, onRefresh }: { item: Item; onRefresh: () => void }) {
  const embed = youtubeEmbed(item);
  const price = formatPrice(item.meta.price, item.meta.currency);
  if (embed) {
    return (
      <div className="embed-content">
        <iframe src={embed} title={item.title ?? "Video"} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      </div>
    );
  }
  if (item.contentHtml) {
    return (
      <div className="reader">
        <div className="reader-inner">
          <div className="reader-site">
            {item.favicon && <img src={blobUrl(item.favicon)} alt="" className="favicon" />}
            {item.siteName ?? item.domain}
          </div>
          <h1 className="reader-title">{item.title}</h1>
          <div className="reader-meta">
            {item.author && <span>{item.author}</span>}
            {item.meta.readingMinutes && (
              <span>
                <Clock size={12} /> {item.meta.readingMinutes} min read
              </span>
            )}
            {item.meta.publishedAt && <span>{new Date(item.meta.publishedAt).toLocaleDateString(undefined, { dateStyle: "long" })}</span>}
          </div>
          {item.preview && !item.meta.snapshot && <img className="reader-hero" src={thumb(item.preview, 1600)} alt="" />}
          <div className="prose reader-body" dangerouslySetInnerHTML={{ __html: sanitizeArticle(item.contentHtml) }} />
          <a className="button reader-original" href={item.url!} target="_blank" rel="noopener noreferrer">
            Read on {item.siteName ?? item.domain} <ArrowUpRight size={14} />
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="link-content">
      {item.preview ? (
        <img className={`link-hero${item.meta.snapshot ? " is-snapshot" : ""}`} src={thumb(item.preview, 1600)} alt="" />
      ) : (
        <div className="link-hero-empty">{item.status === "pending" ? <span className="spinner" /> : <Link2 size={40} strokeWidth={1.2} />}</div>
      )}
      <div className="link-info">
        <div className="reader-site">
          {item.favicon && <img src={blobUrl(item.favicon)} alt="" className="favicon" />}
          {item.siteName ?? item.domain}
        </div>
        <h1 className="link-title">{item.title ?? item.url}</h1>
        {price && (
          <div className="product-price">
            {price}
            {item.meta.brand && <span className="muted"> · {item.meta.brand}</span>}
            {item.meta.availability && <span className={`availability${/InStock/i.test(item.meta.availability) ? " in" : ""}`}>{item.meta.availability.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>}
          </div>
        )}
        {item.meta.rating && (
          <div className="muted small">
            <Star size={12} fill="currentColor" /> {item.meta.rating}
            {item.meta.ratingCount ? ` (${item.meta.ratingCount})` : ""}
          </div>
        )}
        {item.linkType === "recipe" && (item.meta.totalTime || item.meta.recipeYield) && (
          <div className="recipe-facts">
            {item.meta.totalTime && (
              <span>
                <Clock size={13} /> {item.meta.totalTime}
              </span>
            )}
            {item.meta.recipeYield && (
              <span>
                <Users size={13} /> {item.meta.recipeYield}
              </span>
            )}
          </div>
        )}
        {item.description && <p className="link-description">{item.description}</p>}
        {item.meta.ingredients && item.meta.ingredients.length > 0 && (
          <div className="ingredients">
            <h3>Ingredients</h3>
            <ul>
              {item.meta.ingredients.map((i, n) => (
                <li key={n}>{i}</li>
              ))}
            </ul>
          </div>
        )}
        {item.status === "failed" && (
          <div className="notice">
            <TriangleAlert size={14} /> Couldn't load details: {item.error}
            <button className="button small" onClick={onRefresh}>
              Try again
            </button>
          </div>
        )}
        {item.status === "pending" && <div className="muted small">Fetching details…</div>}
        <a className="button primary visit-button" href={item.url!} target="_blank" rel="noopener noreferrer">
          Visit {item.domain} <ArrowUpRight size={15} />
        </a>
      </div>
    </div>
  );
}

function FileContent({ item }: { item: Item }) {
  const { data: info } = useInfo();
  if (item.kind === "pdf") {
    return (
      <div className="pdf-content">
        <iframe src={blobUrl(item.asset!)} title={item.title ?? "PDF"} />
      </div>
    );
  }
  if (item.kind === "video") {
    return (
      <div className="video-content">
        <video src={blobUrl(item.asset!)} controls autoPlay playsInline poster={item.preview ? thumb(item.preview, 1600) : undefined} />
      </div>
    );
  }
  if (item.kind === "audio") {
    return (
      <div className="file-content">
        <FileText size={48} strokeWidth={1} />
        <div className="file-name">{item.assetName}</div>
        <audio src={blobUrl(item.asset!)} controls />
      </div>
    );
  }
  return (
    <div className="file-content">
      {item.preview ? <img className="file-preview" src={thumb(item.preview, 1200)} alt="" /> : <FileText size={56} strokeWidth={1} />}
      <div className="file-name">{item.assetName}</div>
      <div className="muted">
        {item.mime} · {formatBytes(item.size)}
      </div>
      <div className="file-actions">
        <a className="button primary" href={downloadUrl(item.asset!, item.assetName)}>
          <Download size={15} /> Download
        </a>
        {info?.capabilities.desktop && (
          <button className="button" onClick={() => void api.reveal(item.asset!)}>
            <FolderOpen size={15} /> Show in folder
          </button>
        )}
      </div>
    </div>
  );
}

function Content({ item, focus, onRefresh }: { item: Item; focus: boolean; onRefresh: () => void }) {
  switch (item.kind) {
    case "note":
      return <NoteContent item={item} focus={focus} />;
    case "quote":
      return <QuoteContent item={item} />;
    case "image":
      return <ImageContent item={item} />;
    case "link":
      return <LinkContent item={item} onRefresh={onRefresh} />;
    default:
      return <FileContent item={item} />;
  }
}

// ---------------------------------------------------------------------------
// Info panel (right side)

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="panel-row">
      <div className="panel-label">{label}</div>
      <div className="panel-value">{children}</div>
    </div>
  );
}

function ConnectPicker({ item, onDone }: { item: Item; onDone: () => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({ queryKey: ["connect", q], queryFn: () => api.items({ q, limit: 8 }), enabled: q.trim().length > 1 });
  const qc = useQueryClient();
  return (
    <div className="connect-picker">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for something to connect…" onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onDone(); }} />
      <div className="connect-results">
        {data?.items
          .filter((i) => i.id !== item.id)
          .map((i) => (
            <button
              key={i.id}
              onClick={async () => {
                await api.link(item.id, i.id).catch(errorToast);
                void qc.invalidateQueries({ queryKey: ["item", item.id] });
                onDone();
              }}
            >
              <MiniThumb item={i} />
              <span>{i.title ?? i.excerpt?.slice(0, 60) ?? i.assetName ?? typeLabel(i)}</span>
            </button>
          ))}
      </div>
    </div>
  );
}

function MiniThumb({ item }: { item: Pick<ItemCard, "kind" | "asset" | "preview"> }) {
  const hash = item.kind === "image" ? item.asset : item.preview;
  if (hash) return <img className="mini-thumb" src={thumb(hash, 96)} alt="" />;
  return (
    <span className="mini-thumb mini-thumb-empty">
      <FileText size={12} />
    </span>
  );
}

function Panel({ item, onClose }: { item: Item; onClose: () => void }) {
  const title = useAutosave(item.id, "title", item.title);
  const note = useAutosave(item.id, "note", item.note);
  const qc = useQueryClient();
  const { data: collections = [] } = useCollections();
  const { data: info } = useInfo();
  const { data: similar = [] } = useQuery({ queryKey: ["similar", item.id], queryFn: () => api.similar(item.id), staleTime: 60_000 });
  const [connecting, setConnecting] = useState(false);
  const trashed = !!item.deletedAt;

  const update = async (patch: Parameters<typeof api.update>[1]) => {
    try {
      const next = await api.update(item.id, patch);
      qc.setQueryData(["item", item.id], next);
      void qc.invalidateQueries({ queryKey: ["items"] });
      void qc.invalidateQueries({ queryKey: ["tags"] });
    } catch (err) {
      errorToast(err);
    }
  };

  // Tags change one at a time so tags added meanwhile (by the AI, say) survive.
  const changeTags = async (action: "tag" | "untag", tag: string) => {
    try {
      await api.bulk(action, [item.id], { tags: [tag] });
      qc.setQueryData(["item", item.id], await api.item(item.id));
      void qc.invalidateQueries({ queryKey: ["tags"] });
    } catch (err) {
      errorToast(err);
    }
  };

  const refresh = async () => {
    await api.refresh(item.id);
    toast(item.kind === "link" ? "Refreshing…" : "Re-analysing…");
  };

  const more = (el: HTMLElement) =>
    openMenuAt(el, [
      ...(item.url ? [{ label: "Copy link", icon: <Copy size={14} />, onSelect: () => void copyText(item.url!, "Link copied") }] : []),
      ...(item.kind === "note" || item.kind === "quote" ? [{ label: "Copy text", icon: <Copy size={14} />, onSelect: () => void copyText(item.body ?? "", "Text copied") }] : []),
      ...(item.asset ? [{ label: "Download original", icon: <Download size={14} />, onSelect: () => (window.location.href = downloadUrl(item.asset!, item.assetName)) }] : []),
      ...(item.asset && info?.capabilities.desktop ? [{ label: "Show in folder", icon: <FolderOpen size={14} />, onSelect: () => void api.reveal(item.asset!) }] : []),
      { label: item.kind === "link" ? "Refresh from the web" : "Re-analyse", icon: <RefreshCw size={14} />, onSelect: () => void refresh() },
      { separator: true, label: "" },
      trashed
        ? { label: "Delete forever", icon: <Trash2 size={14} />, danger: true, onSelect: () => void purgeItems([item.id]) }
        : { label: "Move to trash", icon: <Trash2 size={14} />, danger: true, shortcut: "⌫", onSelect: () => void trashItems([item.id]) },
    ]);

  const collectionMenu = (el: HTMLElement) => {
    const inIds = new Set(item.collections.map((c) => c.id));
    openMenuAt(el, [
      ...collections
        .filter((c) => c.kind === "manual" && !inIds.has(c.id))
        .map((c) => ({ label: c.name, icon: c.icon ? <span>{c.icon}</span> : undefined, onSelect: () => void addToCollection(c.id, [item.id], c.name) })),
      { separator: true, label: "" },
      { label: "New collection…", icon: <Plus size={14} />, onSelect: () => void createCollection("manual", [item.id]) },
    ]);
  };

  return (
    <aside className="panel">
      <div className="panel-head">
        <span className="panel-type">{typeLabel(item)}</span>
        <div className="panel-head-actions">
          {trashed ? (
            <button className="button small" onClick={() => void restoreItems([item.id]).then(() => qc.invalidateQueries({ queryKey: ["item", item.id] }))}>
              <RotateCcw size={14} /> Restore
            </button>
          ) : (
            <button className={`icon-button${item.pinned ? " is-on" : ""}`} onClick={() => void update({ pinned: !item.pinned })} title={item.pinned ? "Remove from Top of Mind" : "Pin to Top of Mind"} aria-label="Pin">
              {item.pinned ? <PinOff size={16} /> : <Pin size={16} />}
            </button>
          )}
          {item.url && (
            <button className="icon-button" onClick={() => openExternal(item.url!)} title="Open original" aria-label="Open original">
              <ArrowUpRight size={17} />
            </button>
          )}
          <button className="icon-button" onClick={(e) => more(e.currentTarget)} title="More" aria-label="More actions">
            <MoreHorizontal size={17} />
          </button>
          <button className="icon-button" onClick={onClose} title="Close (Esc)" aria-label="Close">
            <X size={17} />
          </button>
        </div>
      </div>

      <div className="panel-scroll">
        <AutoTextarea className="panel-title" value={title.value} placeholder="Add a title" onChange={(e) => title.onChange(e.target.value)} onFocus={title.onFocus} onBlur={title.onBlur} />
        {item.url && (
          <a className="panel-source" href={item.url} target="_blank" rel="noopener noreferrer" title={item.url}>
            {item.favicon && <img src={blobUrl(item.favicon)} alt="" className="favicon" />}
            <span>{item.domain ?? item.url}</span>
            <ArrowUpRight size={12} />
          </a>
        )}

        {(item.summary || (item.description && item.kind !== "link")) && (
          <div className="panel-summary">
            {item.summary && <Sparkles size={13} className="summary-icon" />}
            <p>{item.summary ?? item.description}</p>
          </div>
        )}
        {item.aiStatus === "running" || item.aiStatus === "pending" ? (
          <div className="muted small ai-working">
            <span className="spinner small" /> Looking at this…
          </div>
        ) : null}
        {item.aiStatus?.startsWith("failed") && <div className="muted small">AI: {item.aiStatus.replace(/^failed: /, "")}</div>}

        <div className="panel-section">
          <div className="panel-section-title">Tags</div>
          <TagEditor
            tags={item.tags}
            onAdd={(tag) => void changeTags("tag", tag)}
            onRemove={(tag) => void changeTags("untag", tag)}
          />
        </div>

        <div className="panel-section">
          <div className="panel-section-title">Note</div>
          <AutoTextarea className="panel-note" value={note.value} minRows={2} placeholder="Why did you save this?" onChange={(e) => note.onChange(e.target.value)} onFocus={note.onFocus} onBlur={note.onBlur} />
        </div>

        {item.colors.length > 0 && (
          <div className="panel-section">
            <div className="panel-section-title">Colours</div>
            <div className="swatches">
              {item.colors.map((c) => (
                <button
                  key={c.hex}
                  className="swatch"
                  style={{ background: c.hex, flexGrow: Math.max(1, Math.round(c.weight * 10)) }}
                  title={`${c.hex} · ${Math.round(c.weight * 100)}% — find similar colours`}
                  onClick={() => setState({ query: `color:${c.hex}`, scope: { type: "all" }, openItemId: null })}
                />
              ))}
            </div>
          </div>
        )}

        <div className="panel-section">
          <div className="panel-section-title">
            Collections
            <button className="icon-button tiny" onClick={(e) => collectionMenu(e.currentTarget)} aria-label="Add to collection">
              <Plus size={14} />
            </button>
          </div>
          {item.collections.length ? (
            <div className="chip-list">
              {item.collections.map((c) => (
                <span key={c.id} className="chip">
                  <button onClick={() => setState({ scope: { type: "collection", id: c.id }, openItemId: null, query: "" })}>{c.name}</button>
                  <button
                    className="chip-x"
                    onClick={async () => {
                      await api.bulk("uncollect", [item.id], { collectionId: c.id });
                      void qc.invalidateQueries();
                    }}
                    aria-label={`Remove from ${c.name}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <button className="link-button" onClick={(e) => collectionMenu(e.currentTarget)}>
              Add to a collection
            </button>
          )}
        </div>

        <div className="panel-section">
          <div className="panel-section-title">
            Connections
            <button className="icon-button tiny" onClick={() => setConnecting(!connecting)} aria-label="Connect to another item">
              <Plus size={14} />
            </button>
          </div>
          {connecting && <ConnectPicker item={item} onDone={() => setConnecting(false)} />}
          {item.links.length > 0 ? (
            <div className="connections">
              {item.links.map((l) => (
                <div key={l.id} className="connection">
                  <button className="connection-main" onClick={() => setState({ openItemId: l.id })}>
                    <MiniThumb item={{ kind: l.kind, asset: l.preview, preview: l.preview }} />
                    <span>{l.title ?? typeLabel({ kind: l.kind, linkType: null })}</span>
                  </button>
                  <button
                    className="icon-button tiny"
                    onClick={async () => {
                      await api.unlink(item.id, l.id);
                      void qc.invalidateQueries({ queryKey: ["item", item.id] });
                    }}
                    aria-label="Remove connection"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            !connecting && (
              <button className="link-button" onClick={() => setConnecting(true)}>
                Connect to another item
              </button>
            )
          )}
        </div>

        <div className="panel-section details">
          <Row label="Saved">{fullDate(item.createdAt)}</Row>
          {item.updatedAt - item.createdAt > 60_000 && <Row label="Edited">{relativeTime(item.updatedAt)}</Row>}
          {item.width && item.height && item.kind !== "link" ? (
            <Row label="Size">
              {item.width} × {item.height}
            </Row>
          ) : null}
          {item.size ? <Row label="File">{formatBytes(item.size)}</Row> : null}
          {item.meta.pages ? <Row label="Pages">{String(item.meta.pages)}</Row> : null}
          {item.meta.wordCount ? <Row label="Words">{item.meta.wordCount.toLocaleString()}</Row> : null}
          {item.author && <Row label="By">{item.author}</Row>}
          {item.meta.imageText && (
            <Row label="Text in image">
              <span className="image-text">{item.meta.imageText}</span>
            </Row>
          )}
        </div>

        {similar.length > 0 && (
          <div className="panel-section">
            <div className="panel-section-title">Same vibe</div>
            <div className="similar-grid">
              {similar.slice(0, 9).map((s) => (
                <button key={s.id} className="similar-cell" onClick={() => setState({ openItemId: s.id })} title={s.title ?? ""}>
                  {s.kind === "image" && s.asset ? (
                    <img src={thumb(s.asset, 200)} alt="" />
                  ) : s.preview ? (
                    <img src={thumb(s.preview, 200)} alt="" />
                  ) : (
                    <span className="similar-text">{s.title ?? s.excerpt?.slice(0, 80)}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------

export function ItemView({ id, siblings }: { id: string; siblings: string[] }) {
  const { data: item, error } = useItem(id);
  const [focus, setFocus] = useState(false);
  const index = siblings.indexOf(id);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  const close = useCallback(() => setState({ openItemId: null }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = getState();
      if (isEditable(e.target) || s.settingsOpen || s.paletteOpen || isMenuOpen()) return;
      // Players and embedded pages use the arrow keys themselves.
      if (e.target instanceof Element && e.target.closest("video, audio, iframe")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (focus) setFocus(false);
        else close();
      } else if (e.key === "ArrowLeft" && prev) setState({ openItemId: prev });
      else if (e.key === "ArrowRight" && next) setState({ openItemId: next });
      else if ((e.key === "Backspace" || e.key === "Delete") && item && !item.deletedAt) void trashItems([item.id]);
      else if (e.key === "p" && item) void setPinned([item.id], !item.pinned);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, item, focus, close]);

  useEffect(() => {
    if (error) {
      close();
      toast("That item no longer exists");
    }
  }, [error, close]);

  const canFocus = item?.kind === "note" || (item?.kind === "link" && !!item.contentHtml);
  const content = useMemo(() => (item ? <Content item={item} focus={focus} onRefresh={() => void api.refresh(item.id)} /> : null), [item, focus]);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={item?.title ?? "Item"}>
      <div className="viewer-backdrop" onClick={close} />
      <div className={`viewer-shell${focus ? " is-focus" : ""}`}>
        <div className="viewer-content" onContextMenu={(e) => item?.url && openMenu(e.clientX, e.clientY, [{ label: "Open original", onSelect: () => openExternal(item.url!) }, { label: "Copy link", onSelect: () => void copyText(item.url!, "Link copied") }])}>
          {content ?? <div className="viewer-loading"><span className="spinner" /></div>}
          <div className="viewer-nav">
            <button className="icon-button glass" disabled={!prev} onClick={() => prev && setState({ openItemId: prev })} aria-label="Previous">
              <ChevronLeft size={18} />
            </button>
            <button className="icon-button glass" disabled={!next} onClick={() => next && setState({ openItemId: next })} aria-label="Next">
              <ChevronRight size={18} />
            </button>
          </div>
          {canFocus && (
            <button className="icon-button glass viewer-focus" onClick={() => setFocus(!focus)} title={focus ? "Exit focus mode" : "Focus mode"} aria-label="Focus mode">
              {focus ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          {focus && (
            <button className="icon-button glass viewer-close" onClick={close} aria-label="Close">
              <X size={17} />
            </button>
          )}
        </div>
        {item && !focus && <Panel item={item} onClose={close} />}
      </div>
    </div>
  );
}

