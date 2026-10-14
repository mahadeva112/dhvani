import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GripHorizontal, X } from 'lucide-react';

type Point = { x: number; y: number };

const MARGIN = 8;

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
 * it stays in use. With `confirmClose`, closing first asks that question.
 */
export const FloatingWindow: React.FC<{
  title: React.ReactNode;
  /** localStorage key the window's position is kept under. */
  storageKey: string;
  width?: number;
  /** Asked before closing, when there is something closing would lose. */
  confirmClose?: string | null;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, storageKey, width = 560, confirmClose = null, onClose, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Point | null>(() => readPosition(storageKey));
  const [asking, setAsking] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  /** The point moved so the title bar stays on screen. */
  const clampToView = (p: Point): Point => {
    const w = ref.current?.offsetWidth ?? width;
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

  useEffect(() => {
    const onResize = () => setPos((p) => (p ? clampToView(p) : p));
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
    try {
      if (pos) localStorage.setItem(storageKey, JSON.stringify(pos));
    } catch {}
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      className="fixed z-50 flex flex-col max-h-[85vh] rounded-xl border border-slate-600 bg-slate-950 shadow-2xl shadow-black/60"
      style={{ width: `min(${width}px, calc(100vw - ${2 * MARGIN}px))`, left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="flex items-center gap-2 px-3 h-10 shrink-0 rounded-t-xl border-b border-slate-800 bg-slate-900 cursor-grab active:cursor-grabbing select-none touch-none"
      >
        <GripHorizontal className="w-4 h-4 text-slate-500" aria-hidden="true" />
        <div className="min-w-0 flex-1 flex items-center gap-2 text-[13px] font-semibold text-slate-100">{title}</div>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close"
          title="Close (Esc)"
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {asking && confirmClose && (
        <div role="alertdialog" className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-amber-400/30 bg-amber-950/30 text-[12px] text-amber-100">
          <span className="flex-1 min-w-0">{confirmClose}</span>
          <button type="button" onClick={onClose} className="h-7 px-2.5 rounded-lg bg-amber-500/90 hover:bg-amber-400 text-slate-950 font-semibold cursor-pointer">
            Close anyway
          </button>
          <button type="button" onClick={() => setAsking(false)} className="h-7 px-2.5 rounded-lg border border-slate-600 text-slate-200 hover:bg-slate-800 cursor-pointer">
            Keep editing
          </button>
        </div>
      )}
      <div className="min-h-0 overflow-y-auto p-3">{children}</div>
    </div>
  );
};
