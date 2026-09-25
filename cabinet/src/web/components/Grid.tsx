import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import type { ItemCard } from "../../shared/types";
import { cardLayout, masonry } from "../lib/layout";
import { Card } from "./Card";

export interface GridProps {
  items: ItemCard[];
  targetWidth: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  selection: Set<string>;
  onOpen: (item: ItemCard) => void;
  onToggleSelect: (item: ItemCard, e: MouseEvent) => void;
  onContextMenu: (item: ItemCard, e: MouseEvent) => void;
  onDragStart: (item: ItemCard, e: DragEvent) => void;
  /** Optional first cell (e.g. the note composer) with a fixed height. */
  leading?: { node: ReactNode; height: number } | null;
  header?: ReactNode;
  footer?: ReactNode;
  scrollKey: string;
}

const OVERSCAN = 900;
const PADDING_X = 28;

export function Grid(props: GridProps) {
  const { items, targetWidth, selection, leading } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth - PADDING_X * 2);
      setViewport((v) => ({ ...v, height: el.clientHeight }));
    });
    ro.observe(el);
    setWidth(el.clientWidth - PADDING_X * 2);
    setViewport({ top: el.scrollTop, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Back to the top when the list changes identity (new scope or search).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [props.scrollKey]);

  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    ro.observe(el);
    setHeaderHeight(el.offsetHeight);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (width <= 0) return null;
    const probe = masonry([1], width, targetWidth);
    const colWidth = probe.colWidth;
    const layouts = items.map((it) => cardLayout(it, colWidth));
    const heights = [...(leading ? [leading.height] : []), ...layouts.map((l) => l.height)];
    const m = masonry(heights, width, targetWidth);
    return { ...m, layouts };
  }, [items, width, targetWidth, leading]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewport({ top: el.scrollTop, height: el.clientHeight });
  }, []);

  // Infinite loading.
  useEffect(() => {
    if (!layout || !props.hasMore || props.loadingMore) return;
    const bottom = headerHeight + layout.total;
    if (bottom - (viewport.top + viewport.height) < viewport.height * 1.5) props.onLoadMore();
  }, [layout, viewport, props.hasMore, props.loadingMore, headerHeight, props]);

  const offset = leading ? 1 : 0;
  const top = viewport.top - headerHeight - OVERSCAN;
  const bottom = viewport.top - headerHeight + viewport.height + OVERSCAN;
  const selecting = selection.size > 0;

  return (
    <div className="grid-scroll" ref={scrollRef} onScroll={onScroll}>
      <div ref={headerRef} className="grid-header">
        {props.header}
      </div>
      <div className="grid" style={{ height: layout ? layout.total : 0, margin: `0 ${PADDING_X}px` }}>
        {layout?.placed.map((p) => {
          if (p.y + p.h < top || p.y > bottom) return null;
          if (leading && p.index === 0) {
            return (
              <div key="__leading" className="grid-cell" style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: p.w, height: p.h }}>
                {leading.node}
              </div>
            );
          }
          const item = items[p.index - offset];
          if (!item) return null;
          return (
            <div key={item.id} className="grid-cell" style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: p.w, height: p.h }}>
              <Card
                item={item}
                width={p.w}
                layout={layout.layouts[p.index - offset]}
                selected={selection.has(item.id)}
                selecting={selecting}
                onOpen={props.onOpen}
                onToggleSelect={props.onToggleSelect}
                onContextMenu={props.onContextMenu}
                onDragStart={props.onDragStart}
              />
            </div>
          );
        })}
      </div>
      {props.footer}
    </div>
  );
}
