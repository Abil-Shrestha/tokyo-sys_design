import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, Maximize, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { CanvasPlacement, Collection, ItemCard } from "../../shared/types";
import { api } from "../api";
import { cardLayout, GAP } from "../lib/layout";
import { setState } from "../store";
import { Card } from "./Card";

interface Camera {
  x: number;
  y: number;
  scale: number;
}

const DEFAULT_W = 260;

function autoPlace(items: ItemCard[], existing: Map<string, CanvasPlacement>): Map<string, CanvasPlacement> {
  const out = new Map(existing);
  const missing = items.filter((i) => !out.has(i.id));
  if (!missing.length) return out;
  let maxX = 0;
  let minY = 0;
  let maxZ = 0;
  for (const p of out.values()) {
    maxX = Math.max(maxX, p.x + p.w);
    minY = Math.min(minY, p.y);
    maxZ = Math.max(maxZ, p.z);
  }
  const startX = out.size ? maxX + 120 : 0;
  const cols = Math.max(3, Math.min(6, Math.ceil(Math.sqrt(missing.length))));
  const tops = new Array(cols).fill(minY);
  for (const item of missing) {
    let col = 0;
    for (let c = 1; c < cols; c++) if (tops[c] < tops[col]) col = c;
    const h = cardLayout(item, DEFAULT_W).height;
    out.set(item.id, { itemId: item.id, x: startX + col * (DEFAULT_W + GAP * 2), y: tops[col], w: DEFAULT_W, z: ++maxZ });
    tops[col] += h + GAP * 2;
  }
  return out;
}

function tidy(items: ItemCard[]): Map<string, CanvasPlacement> {
  return autoPlace(items, new Map());
}

export function CanvasView({ collection, items }: { collection: Collection; items: ItemCard[] }) {
  const qc = useQueryClient();
  const { data: saved } = useQuery({ queryKey: ["canvas", collection.id], queryFn: () => api.canvas(collection.id) });
  const [placements, setPlacements] = useState<Map<string, CanvasPlacement>>(new Map());
  const [camera, setCamera] = useState<Camera>({ x: 60, y: 40, scale: 1 });
  const dirty = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const initialised = useRef(false);

  useEffect(() => {
    if (!saved) return;
    const base = new Map(saved.map((p) => [p.itemId, p]));
    setPlacements((current) => {
      // Keep local positions for items being moved; fill the rest from the server.
      const merged = new Map(base);
      for (const [id, p] of current) if (dirty.current.has(id)) merged.set(id, p);
      const placed = autoPlace(items, merged);
      for (const id of placed.keys()) if (!base.has(id)) dirty.current.add(id);
      return placed;
    });
  }, [saved, items]);

  const persist = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const ids = [...dirty.current];
      dirty.current.clear();
      const list = ids.map((id) => placements.get(id)).filter((p): p is CanvasPlacement => !!p);
      if (list.length) void api.saveCanvas(collection.id, list).then(() => qc.setQueryData(["canvas", collection.id], [...placements.values()]));
    }, 500);
  }, [placements, collection.id, qc]);

  useEffect(() => {
    if (dirty.current.size) persist();
  }, [placements, persist]);

  const fitTo = useCallback(
    (map: Map<string, CanvasPlacement>) => {
      const el = rootRef.current;
      if (!el || !map.size) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const byId = new Map(items.map((i) => [i.id, i]));
      for (const p of map.values()) {
        const item = byId.get(p.itemId);
        if (!item) continue;
        const h = cardLayout(item, p.w).height;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + p.w);
        maxY = Math.max(maxY, p.y + h);
      }
      if (!Number.isFinite(minX)) return;
      const pad = 60;
      const scale = Math.min(1.2, Math.max(0.1, Math.min((el.clientWidth - pad * 2) / (maxX - minX), (el.clientHeight - pad * 2) / (maxY - minY))));
      setCamera({ scale, x: pad - minX * scale + (el.clientWidth - pad * 2 - (maxX - minX) * scale) / 2, y: pad - minY * scale });
    },
    [items],
  );
  const fit = useCallback(() => fitTo(placements), [fitTo, placements]);

  useEffect(() => {
    if (!initialised.current && placements.size && items.length) {
      initialised.current = true;
      fit();
    }
  }, [placements, items, fit]);

  // Wheel: scroll to pan, pinch or ⌘/Ctrl + wheel to zoom around the cursor.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0025);
        setCamera((c) => {
          const scale = Math.min(3, Math.max(0.08, c.scale * factor));
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          return { scale, x: px - ((px - c.x) * scale) / c.scale, y: py - ((py - c.y) * scale) / c.scale };
        });
      } else {
        setCamera((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const drag = useRef<{ kind: "pan" | "move" | "resize"; id?: string; sx: number; sy: number; ox: number; oy: number; ow?: number; moved: boolean } | null>(null);

  const onPointerDown = (e: RPointerEvent, id?: string, kind: "move" | "resize" = "move") => {
    if (e.button !== 0 && e.button !== 1) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (!id || e.button === 1) {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: camera.x, oy: camera.y, moved: false };
      return;
    }
    const p = placements.get(id);
    if (!p) return;
    const maxZ = Math.max(0, ...[...placements.values()].map((x) => x.z));
    if (p.z < maxZ) setPlacements((m) => new Map(m).set(id, { ...p, z: maxZ + 1 }));
    drag.current = { kind, id, sx: e.clientX, sy: e.clientY, ox: p.x, oy: p.y, ow: p.w, moved: false };
  };

  const onPointerMove = (e: RPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.kind === "pan") {
      setCamera((c) => ({ ...c, x: d.ox + dx, y: d.oy + dy }));
    } else if (d.id) {
      const id = d.id;
      setPlacements((m) => {
        const p = m.get(id);
        if (!p) return m;
        const next = new Map(m);
        if (d.kind === "move") next.set(id, { ...p, x: d.ox + dx / camera.scale, y: d.oy + dy / camera.scale });
        else next.set(id, { ...p, w: Math.max(120, Math.min(1200, (d.ow ?? p.w) + dx / camera.scale)) });
        return next;
      });
    }
  };

  const onPointerUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (d.id) {
      if (d.moved) {
        dirty.current.add(d.id);
        persist();
      } else if (d.kind === "move") {
        setState({ openItemId: d.id });
      }
    }
  };

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const zoomBy = (f: number) => {
    const el = rootRef.current;
    if (!el) return;
    const px = el.clientWidth / 2;
    const py = el.clientHeight / 2;
    setCamera((c) => {
      const scale = Math.min(3, Math.max(0.08, c.scale * f));
      return { scale, x: px - ((px - c.x) * scale) / c.scale, y: py - ((py - c.y) * scale) / c.scale };
    });
  };

  return (
    <div className="canvas-root" ref={rootRef} onPointerDown={(e) => onPointerDown(e)} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div
        className="canvas-grid-bg"
        style={{ backgroundSize: `${24 * camera.scale}px ${24 * camera.scale}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }}
      />
      <div className="canvas-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
        {[...placements.values()].map((p) => {
          const item = byId.get(p.itemId);
          if (!item) return null;
          const layout = cardLayout(item, p.w);
          return (
            <div
              key={p.itemId}
              className="canvas-item"
              style={{ transform: `translate(${p.x}px, ${p.y}px)`, width: p.w, height: layout.height, zIndex: p.z }}
              onPointerDown={(e) => onPointerDown(e, p.itemId)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              <div className="canvas-item-inner">
                <Card item={item} width={p.w} layout={layout} draggable={false} />
              </div>
              <div className="canvas-resize" onPointerDown={(e) => onPointerDown(e, p.itemId, "resize")} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />
            </div>
          );
        })}
      </div>
      {!items.length && (
        <div className="canvas-empty">
          <h2>An empty canvas</h2>
          <p>Drag cards onto “{collection.name}” in the sidebar, then arrange them here.</p>
        </div>
      )}
      <div className="canvas-toolbar" onPointerDown={(e) => e.stopPropagation()}>
        <button className="icon-button" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out">
          <Minus size={15} />
        </button>
        <span className="canvas-zoom">{Math.round(camera.scale * 100)}%</span>
        <button className="icon-button" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
          <Plus size={15} />
        </button>
        <button className="icon-button" onClick={fit} title="Fit everything" aria-label="Fit">
          <Maximize size={15} />
        </button>
        <button
          className="icon-button"
          title="Tidy up"
          aria-label="Tidy up"
          onClick={() => {
            const next = tidy(items);
            for (const id of next.keys()) dirty.current.add(id);
            setPlacements(next);
            fitTo(next);
          }}
        >
          <LayoutGrid size={15} />
        </button>
      </div>
    </div>
  );
}
