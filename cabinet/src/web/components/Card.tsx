import { Check, Clock, ExternalLink, FileText, File as FileIcon, Music2, Pin, Play, Quote, TriangleAlert } from "lucide-react";
import { memo, useEffect, useState, type DragEvent, type MouseEvent } from "react";
import type { ItemCard } from "../../shared/types";
import { blobUrl, thumb } from "../api";
import { formatBytes, formatDuration, formatPrice, typeLabel } from "../lib/format";
import { cardLayout, LINE, type CardLayout } from "../lib/layout";
import { stripMarkdown } from "../lib/markdown";
import { ensureDerivedMedia } from "../lib/media";

const DPR = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

export interface CardProps {
  item: ItemCard;
  width: number;
  layout?: CardLayout;
  selected?: boolean;
  selecting?: boolean;
  onOpen?: (item: ItemCard, e: MouseEvent) => void;
  onToggleSelect?: (item: ItemCard, e: MouseEvent) => void;
  onContextMenu?: (item: ItemCard, e: MouseEvent) => void;
  onDragStart?: (item: ItemCard, e: DragEvent) => void;
  draggable?: boolean;
}

function placeholderColor(item: ItemCard): string | undefined {
  return item.colors[0]?.hex;
}

function Media({ hash, width, height, item, alt }: { hash: string; width: number; height: number; item: ItemCard; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="card-media" style={{ height, background: placeholderColor(item) }}>
      {!failed && (
        <img
          src={thumb(hash, width * DPR)}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={loaded ? "is-loaded" : ""}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function Favicon({ item }: { item: ItemCard }) {
  const [failed, setFailed] = useState(false);
  if (item.favicon && !failed) return <img className="favicon" src={blobUrl(item.favicon)} alt="" onError={() => setFailed(true)} />;
  return <span className="favicon favicon-fallback">{(item.siteName ?? item.domain ?? "?").slice(0, 1).toUpperCase()}</span>;
}

function SourceLine({ item, extra }: { item: ItemCard; extra?: string | null }) {
  return (
    <div className="card-source" style={{ height: LINE.footerMeta }}>
      {item.url && <Favicon item={item} />}
      <span className="card-source-text">{item.siteName ?? item.domain ?? typeLabel(item)}</span>
      {extra && <span className="card-source-extra">{extra}</span>}
      {item.status === "pending" && <span className="card-pending" title="Fetching details…" />}
      {item.status === "failed" && <TriangleAlert size={12} className="card-failed" aria-label="Could not fetch this page" />}
    </div>
  );
}

function Footer({ item, layout }: { item: ItemCard; layout: CardLayout }) {
  const title = item.title ?? item.assetName ?? item.url ?? "Untitled";
  return (
    <div className="card-footer">
      <div className="card-footer-title" style={{ WebkitLineClamp: layout.titleLines || 1, maxHeight: (layout.titleLines || 1) * LINE.footerTitle }}>
        {title}
      </div>
      <SourceLine item={item} extra={item.kind === "pdf" && item.meta.pages ? `${item.meta.pages} pages` : item.size && item.kind !== "link" ? formatBytes(item.size) : null} />
    </div>
  );
}

function CardBody({ item, width, layout }: { item: ItemCard; width: number; layout: CardLayout }) {
  const alt = item.title ?? item.summary ?? "";
  switch (layout.variant) {
    case "image":
      return (
        <>
          <Media hash={item.asset!} width={width} height={layout.media} item={item} alt={alt} />
          {(item.title || item.url) && (
            <div className="card-hover-caption">
              {item.title && <span className="card-hover-title">{item.title}</span>}
              {item.domain && <span className="card-hover-domain">{item.domain}</span>}
            </div>
          )}
          {item.mime === "image/gif" && <span className="card-badge">GIF</span>}
        </>
      );
    case "video":
      return (
        <>
          {item.preview ? (
            <Media hash={item.preview} width={width} height={layout.media} item={item} alt={alt} />
          ) : (
            <div className="card-media card-media-video" style={{ height: layout.media }}>
              <video src={`${blobUrl(item.asset!)}#t=0.5`} muted preload="metadata" playsInline />
            </div>
          )}
          <span className="card-play">
            <Play size={16} fill="currentColor" />
          </span>
          {item.duration ? <span className="card-badge">{formatDuration(item.duration)}</span> : null}
        </>
      );
    case "product": {
      const price = formatPrice(item.meta.price, item.meta.currency);
      const chip =
        item.linkType === "product"
          ? price
          : item.linkType === "recipe"
            ? item.meta.totalTime
            : typeLabel(item);
      return (
        <>
          <Media hash={item.preview!} width={width} height={layout.media} item={item} alt={alt} />
          {chip && (
            <span className="card-chip" style={{ top: layout.media - 34 }}>
              {item.linkType === "recipe" && <Clock size={11} />}
              {chip}
            </span>
          )}
          <Footer item={item} layout={layout} />
        </>
      );
    }
    case "link":
      return (
        <>
          <Media hash={item.preview!} width={width} height={layout.media} item={item} alt={alt} />
          {item.linkType === "video" && (
            <span className="card-play" style={{ top: layout.media / 2 }}>
              <Play size={16} fill="currentColor" />
            </span>
          )}
          <Footer item={item} layout={layout} />
        </>
      );
    case "article":
      return (
        <>
          {item.preview && <Media hash={item.preview} width={width} height={layout.media} item={item} alt={alt} />}
          <div className="card-article">
            <div className="card-article-title" style={{ WebkitLineClamp: layout.titleLines, maxHeight: layout.titleLines * LINE.articleTitle }}>
              {item.title ?? item.url}
            </div>
            {layout.bodyLines > 0 && (
              <div className="card-excerpt" style={{ WebkitLineClamp: layout.bodyLines, maxHeight: layout.bodyLines * LINE.excerpt }}>
                {item.excerpt}
              </div>
            )}
            <SourceLine item={item} extra={item.meta.readingMinutes ? `${item.meta.readingMinutes} min read` : null} />
          </div>
        </>
      );
    case "textlink":
      return (
        <div className="card-textlink">
          <SourceLine item={item} />
          <div className={`card-textlink-title${item.status === "pending" && !item.title ? " is-pending" : ""}`} style={{ WebkitLineClamp: layout.titleLines, maxHeight: layout.titleLines * LINE.serifTitle }}>
            {item.title ?? item.url}
          </div>
          {layout.bodyLines > 0 && (
            <div className="card-excerpt" style={{ WebkitLineClamp: layout.bodyLines, maxHeight: layout.bodyLines * LINE.excerpt }}>
              {item.description ?? item.excerpt}
            </div>
          )}
        </div>
      );
    case "note": {
      const text = stripMarkdown(item.excerpt ?? "");
      return (
        <div className="card-note">
          {item.title && (
            <div className="card-note-title" style={{ WebkitLineClamp: layout.titleLines, maxHeight: layout.titleLines * LINE.noteTitle }}>
              {item.title}
            </div>
          )}
          <div className={`card-note-body${layout.clamped ? " is-clamped" : ""}`} style={{ maxHeight: layout.bodyLines * LINE.noteBody }}>
            {text || <span className="muted">Empty note</span>}
          </div>
        </div>
      );
    }
    case "quote":
      return (
        <div className="card-quote">
          <Quote size={14} className="card-quote-mark" />
          <div className={`card-quote-body${layout.clamped ? " is-clamped" : ""}`} style={{ maxHeight: layout.bodyLines * LINE.quote }}>
            {item.excerpt}
          </div>
          {(item.url || item.title) && (
            <div className="card-quote-source">
              {item.url && <Favicon item={item} />}
              <span>{item.title ?? item.domain}</span>
            </div>
          )}
        </div>
      );
    case "pdf":
      return (
        <>
          {item.preview ? (
            <Media hash={item.preview} width={width} height={layout.media} item={item} alt={alt} />
          ) : (
            <div className="card-file-icon" style={{ height: layout.media }}>
              <FileText size={34} strokeWidth={1.3} />
              <span>PDF</span>
            </div>
          )}
          <Footer item={item} layout={layout} />
        </>
      );
    case "file":
    default:
      return (
        <>
          {item.preview ? (
            <Media hash={item.preview} width={width} height={layout.media} item={item} alt={alt} />
          ) : (
            <div className="card-file-icon" style={{ height: layout.media }}>
              {item.kind === "audio" ? <Music2 size={30} strokeWidth={1.3} /> : <FileIcon size={30} strokeWidth={1.3} />}
              <span>{(item.assetName?.split(".").pop() ?? item.kind).toUpperCase().slice(0, 5)}</span>
            </div>
          )}
          <Footer item={item} layout={layout} />
        </>
      );
  }
}

export const Card = memo(function Card({ item, width, layout, selected, selecting, onOpen, onToggleSelect, onContextMenu, onDragStart, draggable = true }: CardProps) {
  const l = layout ?? cardLayout(item, width);
  useEffect(() => ensureDerivedMedia(item), [item]);
  const external = item.url && (item.kind === "link" || item.kind === "image" || item.kind === "quote");
  return (
    <article
      className={`card card--${l.variant}${selected ? " is-selected" : ""}${selecting ? " is-selecting" : ""}${item.status === "pending" ? " is-pending" : ""}`}
      style={{ height: l.height }}
      onClick={(e) => (selecting || e.metaKey || e.ctrlKey || e.shiftKey ? onToggleSelect?.(item, e) : onOpen?.(item, e))}
      onContextMenu={(e) => {
        if (onContextMenu) {
          e.preventDefault();
          onContextMenu(item, e);
        }
      }}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(item, e)}
      data-id={item.id}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen?.(item, e as unknown as MouseEvent);
      }}
      aria-label={`${typeLabel(item)}: ${item.title ?? item.excerpt?.slice(0, 60) ?? item.assetName ?? ""}`}
    >
      <CardBody item={item} width={width} layout={l} />
      <button
        className="card-check"
        aria-label={selected ? "Deselect" : "Select"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect?.(item, e);
        }}
      >
        <Check size={13} strokeWidth={3} />
      </button>
      {item.pinned && (
        <span className="card-pin" title="Top of Mind">
          <Pin size={11} fill="currentColor" />
        </span>
      )}
      {external && (
        <a
          className="card-external"
          href={item.url!}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Open ${item.domain ?? "link"}`}
          aria-label="Open original"
        >
          <ExternalLink size={13} />
        </a>
      )}
    </article>
  );
});
