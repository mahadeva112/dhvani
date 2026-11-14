import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import { usePageScrollLock } from './usePageScrollLock';

type Point = { x: number; y: number };
type Size = { w: number; h: number };
type Edge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const MARGIN = 8;
/** Smallest a resizable window can be made. */
const MIN: Size = { w: 480, h: 360 };
/** Any edge or corner can be dragged, as in a desktop window. */
const HANDLES: { edge: Edge; className: string }[] = [
  { edge: 'n', className: '-top-1 left-3 right-3 h-2 cursor-ns-resize' },
  { edge: 's', className: '-bottom-1 left-3 right-3 h-2 cursor-ns-resize' },
  { edge: 'w', className: '-left-1 top-3 bottom-3 w-2 cursor-ew-resize' },
  { edge: 'e', className: '-right-1 top-3 bottom-3 w-2 cursor-ew-resize' },
  { edge: 'nw', className: '-top-1 -left-1 w-3.5 h-3.5 cursor-nwse-resize' },
  { edge: 'ne', className: '-top-1 -right-1 w-3.5 h-3.5 cursor-nesw-resize' },
  { edge: 'sw', className: '-bottom-1 -left-1 w-3.5 h-3.5 cursor-nesw-resize' },
  { edge: 'se', className: '-bottom-1 -right-1 w-3.5 h-3.5 cursor-nwse-resize' },
];

const readSize = (key: string): Size | null => {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    return saved && Number.isFinite(saved.w) && Number.isFinite(saved.h) && saved.w > 0 && saved.h > 0 ? saved : null;
  } catch {
    return null;
  }
};

/** A size that fits the app's window, no smaller than the least. */
const fitSize = ({ w, h }: Size): Size => ({
  w: Math.round(Math.max(Math.min(MIN.w, window.innerWidth - 2 * MARGIN), Math.min(window.innerWidth - 2 * MARGIN, w))),
  h: Math.round(Math.max(Math.min(MIN.h, window.innerHeight - 2 * MARGIN), Math.min(window.innerHeight - 2 * MARGIN, h))),
});

const readPosition = (key: string): Point | null => {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
  } catch {
    return null;
  }
};

/**
 * A window that floats over the app without blocking it, as a video editor's
 * tool windows do: dragged by its title bar, kept where it was last put, and
 * closed only by its ✕ or Esc, never by a click elsewhere, so the page under
 * it stays in use. The page itself holds still while it is open. With `confirmClose`, closing first asks that question.
 * With `resizable`, any edge or corner is dragged to size it (no smaller than
 * 480 x 360, no bigger than the app's window), a double-click on the title
 * bar fills the app's window or puts it back, and the size is kept too. Its
 * body is a container (`@container`), so what is in it can lay out by its width.
 */
export const FloatingWindow: React.FC<{
  title: React.ReactNode;
  /** localStorage key the window's position is kept under. */
  storageKey: string;
  width?: number;
  /** Sized by dragging its edges and corners; the size is kept under `<storageKey>.size`. */
  resizable?: boolean;
  /** Asked before closing, when there is something closing would lose. */
  confirmClose?: string | null;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, storageKey, width = 560, resizable = false, confirmClose = null, onClose, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Point | null>(() => readPosition(storageKey));
  const sizeKey = `${storageKey}.size`;
  // Its own size once sized by hand; else as wide as `width` and as tall as what is in it.
  const [size, setSize] = useState<Size | null>(() => (resizable ? readSize(sizeKey) : null));
  const [sizing, setSizing] = useState(false);
  // Where it was before a double-click filled the app's window.
  const restore = useRef<{ pos: Point; size: Size | null } | null>(null);
  const save = (p: Point | null, s: Size | null) => {
    try {
      if (p) localStorage.setItem(storageKey, JSON.stringify(p));
      if (resizable) {
        if (s) localStorage.setItem(sizeKey, JSON.stringify(s));
        else localStorage.removeItem(sizeKey);
      }
    } catch {}
  };
  const [asking, setAsking] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  usePageScrollLock();

  /** The point moved so the title bar stays on screen. */
  const clampToView = (p: Point, w = ref.current?.offsetWidth ?? width): Point => {
    return {
      x: Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, p.x)),
      y: Math.max(MARGIN, Math.min(window.innerHeight - 48, p.y)),
    };
  };

  // First open: bottom right of the screen, clear of the timeline's middle.
  useLayoutEffect(() => {
    if (pos) setPos(clampToView(pos));
    else {
      const w = ref.current?.offsetWidth ?? width;
      const h = ref.current?.offsetHeight ?? 400;
      setPos(clampToView({ x: window.innerWidth - w - 24, y: window.innerHeight - h - 24 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A window made wider stays on screen where it was.
  useLayoutEffect(() => {
    setPos((p) => (p ? clampToView(p) : p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  // A saved size bigger than the app's window now is made to fit it.
  useLayoutEffect(() => {
    setSize((s) => (s ? fitSize(s) : s));
  }, []);

  useEffect(() => {
    const onResize = () => {
      setSize((s) => (s ? fitSize(s) : s));
      setPos((p) => (p ? clampToView(p) : p));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestClose = () => {
    if (confirmClose && !asking) setAsking(true);
    else onClose();
  };
  useEffect(() => {
    if (!confirmClose) setAsking(false);
  }, [confirmClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A modal dialog over the page takes its own Esc.
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      if (asking) setAsking(false);
      else requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button') || !pos) return;
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setPos(clampToView({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    save(pos, size);
  };

  /** Any edge or corner: the opposite side stays where it is. */
  const resize = (edge: Edge) => (e: React.PointerEvent) => {
    if (e.button !== 0 || !ref.current) return;
    e.preventDefault();
    e.stopPropagation();
    const box = ref.current.getBoundingClientRect();
    const start = { x: box.left, y: box.top, w: box.width, h: box.height };
    const x0 = e.clientX;
    const y0 = e.clientY;
    restore.current = null;
    setSizing(true);
    let last = { pos: { x: Math.round(start.x), y: Math.round(start.y) }, size: { w: Math.round(start.w), h: Math.round(start.h) } };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      let { x, y, w, h } = start;
      if (edge.includes('e')) w = Math.min(window.innerWidth - MARGIN - start.x, start.w + dx);
      if (edge.includes('s')) h = Math.min(window.innerHeight - MARGIN - start.y, start.h + dy);
      if (edge.includes('w')) {
        x = Math.max(MARGIN, Math.min(start.x + start.w - MIN.w, start.x + dx));
        w = start.x + start.w - x;
      }
      if (edge.includes('n')) {
        y = Math.max(MARGIN, Math.min(start.y + start.h - MIN.h, start.y + dy));
        h = start.y + start.h - y;
      }
      last = { pos: { x: Math.round(x), y: Math.round(y) }, size: { w: Math.round(Math.max(MIN.w, w)), h: Math.round(Math.max(MIN.h, h)) } };
      setPos(last.pos);
      setSize(last.size);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setSizing(false);
      save(last.pos, last.size);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** Double-click on the title bar: fills the app's window, or goes back to how it was. */
  const toggleFill = (e: React.MouseEvent) => {
    if (!resizable || (e.target as HTMLElement).closest('button') || !pos) return;
    const back = restore.current;
    if (back) {
      restore.current = null;
      // Kept on screen at the width it goes back to, not the width it fills now.
      const p = clampToView(back.pos, back.size ? fitSize(back.size).w : Math.min(width, window.innerWidth - 2 * MARGIN));
      if (back.size) back.size = fitSize(back.size);
      setPos(p);
      setSize(back.size);
      save(p, back.size);
      return;
    }
    restore.current = { pos, size };
    const full = { w: window.innerWidth - 2 * MARGIN, h: window.innerHeight - 2 * MARGIN };
    setPos({ x: MARGIN, y: MARGIN });
    setSize(full);
    save({ x: MARGIN, y: MARGIN }, full);
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      className={`fixed z-50 flex flex-col rounded-xl border bg-slate-950 shadow-2xl shadow-black/60 ${size ? '' : 'max-h-[85vh]'} ${sizing ? 'border-indigo-400' : 'border-slate-600'}`}
      style={{
        width: size ? size.w : `min(${width}px, calc(100vw - ${2 * MARGIN}px))`,
        ...(size && { height: size.h }),
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div
        onDoubleClick={toggleFill}
        title={resizable ? 'Drag to move · double-click to fill the window, or put it back' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex items-center gap-2 px-3 h-10 shrink-0 rounded-t-xl border-b border-edge bg-slate-900 cursor-default select-none touch-none"
      >
        <GripHorizontal className="w-4 h-4 text-slate-500" aria-hidden="true" />
        <div className="min-w-0 flex-1 flex items-center gap-2 text-[13px] font-semibold text-slate-100">{title}</div>
        {sizing && size && (
          <span className="font-mono text-[11px] font-medium text-indigo-200 tabular-nums">
            {size.w} × {size.h}
          </span>
        )}
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close"
          title="Close (Esc)"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-default"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {asking && confirmClose && (
        <div role="alertdialog" className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-amber-400/30 bg-amber-950/30 text-[12px] text-amber-100">
          <span className="flex-1 min-w-0">{confirmClose}</span>
          <button type="button" onClick={onClose} className="h-7 px-2.5 rounded-lg bg-amber-500/90 hover:bg-amber-400 text-slate-950 font-semibold cursor-default">
            Close anyway
          </button>
          <button type="button" onClick={() => setAsking(false)} className="h-7 px-2.5 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 cursor-default">
            Keep editing
          </button>
        </div>
      )}
      <div className={`min-h-0 overflow-y-auto overscroll-contain p-3 ${resizable ? '@container flex-1' : ''}`}>{children}</div>
      {resizable && (
        <>
          {HANDLES.map(({ edge, className }) => (
            <div key={edge} aria-hidden="true" onPointerDown={resize(edge)} className={`absolute z-10 touch-none ${className}`} />
          ))}
          {/* The corner shows it can be taken hold of */}
          <span aria-hidden="true" className="pointer-events-none absolute right-1.5 bottom-1.5 w-2.5 h-2.5 border-r-2 border-b-2 border-slate-600 rounded-br-[3px]" />
        </>
      )}
    </div>
  );
};
