import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  submenu?: MenuItem[];
  separator?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

let current: MenuState | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function openMenu(x: number, y: number, items: MenuItem[]): void {
  current = { x, y, items };
  notify();
}

export function openMenuAt(el: HTMLElement, items: MenuItem[]): void {
  const r = el.getBoundingClientRect();
  openMenu(r.left, r.bottom + 4, items);
}

export function closeMenu(): void {
  current = null;
  notify();
}

function MenuList({ items, x, y, depth }: { items: MenuItem[]; x: number; y: number; depth: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [open, setOpen] = useState<number | null>(null);
  const [subPos, setSubPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth - 8) nx = depth ? x - r.width - 220 + 8 : window.innerWidth - r.width - 8;
    if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ x: Math.max(8, nx), y: ny });
  }, [x, y, depth]);

  return (
    <>
      <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} role="menu" onMouseDown={(e) => e.stopPropagation()}>
        {items.map((item, i) =>
          item.separator ? (
            <div key={i} className="menu-sep" />
          ) : (
            <button
              key={i}
              role="menuitem"
              className={`menu-item${item.danger ? " danger" : ""}${open === i ? " is-open" : ""}`}
              disabled={item.disabled}
              onMouseEnter={(e) => {
                if (item.submenu) {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setSubPos({ x: r.right + 2, y: r.top - 5 });
                  setOpen(i);
                } else setOpen(null);
              }}
              onClick={() => {
                if (item.submenu) return;
                closeMenu();
                item.onSelect?.();
              }}
            >
              {item.icon && <span className="menu-icon">{item.icon}</span>}
              <span className="menu-label">{item.label}</span>
              {item.shortcut && <span className="menu-shortcut">{item.shortcut}</span>}
              {item.submenu && <span className="menu-shortcut">›</span>}
            </button>
          ),
        )}
      </div>
      {open !== null && items[open]?.submenu && <MenuList items={items[open].submenu!} x={subPos.x} y={subPos.y} depth={depth + 1} />}
    </>
  );
}

export function MenuHost() {
  const state = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
  useEffect(() => {
    if (!state) return;
    const close = () => closeMenu();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", close, { passive: true });
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", close);
    };
  }, [state]);
  if (!state) return null;
  return <MenuList items={state.items} x={state.x} y={state.y} depth={0} />;
}
