import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react';
import { PageScrollLock } from './usePageScrollLock';
import type { ToolWindowTone } from './ToolWindow';
import { markOpenedFromTools } from './toolsReturn';

/**
 * Tools and settings, opened from the header: a small window in the middle of
 * the screen, the same as every other window in the app, listing the tools and
 * settings with what each is set to now. A click, or Enter on the one the arrow
 * keys picked, closes the list and opens that tool's own window. Ctrl K opens
 * it from anywhere; a click outside it or Escape closes it. Opening and closing
 * are a short fade and zoom, none when the system asks for reduced motion.
 */

export interface ToolsHubItem {
  id: string;
  group: 'Studio' | 'Settings' | 'App';
  label: string;
  /** What it is for: the row's tooltip, and found by the search. */
  hint: string;
  /** What it is set to now, in a few words, under its name. */
  summary?: string | null;
  icon: React.ComponentType<{ className?: string }>;
  /** The colour of its icon, the same as its own window's. */
  tone: ToolWindowTone;
  /** Opens its own window. */
  onOpen: () => void;
}

const TILE: Record<ToolWindowTone, string> = {
  indigo: 'bg-indigo-500/15 text-indigo-300',
  teal: 'bg-teal-500/15 text-teal-300',
  pink: 'bg-pink-500/15 text-pink-300',
  amber: 'bg-amber-500/15 text-amber-300',
  slate: 'bg-slate-400/15 text-slate-300',
  blue: 'bg-blue-500/15 text-blue-300',
  violet: 'bg-violet-500/15 text-violet-300',
  emerald: 'bg-emerald-500/15 text-emerald-300',
};

/** How long closing takes; the window stays on screen until it has played. */
const CLOSE_MS = 150;

export const ToolsHub: React.FC<{
  open: boolean;
  onClose: () => void;
  items: ToolsHubItem[];
  /** Shown at the foot of the list: the services and what is left on them. */
  footer?: React.ReactNode;
}> = ({ open, onClose, items, footer }) => {
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Stays on screen while it plays its closing animation.
  useEffect(() => {
    if (open) {
      setShown(true);
      setClosing(false);
      setQuery('');
      setSelected(null);
      return;
    }
    if (!shown) return;
    setClosing(true);
    const timer = setTimeout(() => {
      setShown(false);
      setClosing(false);
    }, CLOSE_MS);
    return () => clearTimeout(timer);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const needle = query.trim().toLowerCase();
  const listed = useMemo(
    () => items.filter((item) => !needle || [item.label, item.hint, item.summary ?? ''].join(' ').toLowerCase().includes(needle)),
    [items, needle]
  );
  // The arrow keys move a highlight; with a search typed, the first match is ready for Enter.
  const current = listed.find((item) => item.id === selected) ?? (needle ? listed[0] : null) ?? null;

  const openItem = (item: ToolsHubItem) => {
    onClose();
    // Its window shows Back, which brings this list back.
    markOpenedFromTools();
    item.onOpen();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (query) setQuery('');
        else onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (listed.length === 0) return;
        const at = current ? listed.indexOf(current) : -1;
        const step = e.key === 'ArrowDown' ? 1 : -1;
        const next = listed[at === -1 ? (step === 1 ? 0 : listed.length - 1) : (at + step + listed.length) % listed.length];
        setSelected(next.id);
        listRef.current?.querySelector(`[data-hub-item="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter' && current) {
        e.preventDefault();
        openItem(current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // Re-bound each render, so it always sees the list as it is now.

  if (!shown) return null;
  const groups = (['Studio', 'Settings', 'App'] as const).map((group) => ({ group, items: listed.filter((item) => item.group === group) }));

  return createPortal(
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-sm ${
        closing ? 'tools-hub-veil-out' : 'tools-hub-veil-in'
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <PageScrollLock />
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Tools and settings"
        className={`relative w-full max-w-[30rem] max-h-full flex flex-col rounded-[20px] bg-slate-900/95 border border-slate-700/80 shadow-2xl shadow-black/60 overflow-hidden text-slate-100 ${
          closing ? 'tools-hub-panel-out' : 'tools-hub-panel-in'
        }`}
      >
        <header className="shrink-0 flex items-center gap-3 px-5 pt-4 pb-3 border-b border-edge">
          <span className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300" aria-hidden="true">
            <SlidersHorizontal className="w-[18px] h-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-slate-100 leading-tight">Tools and settings</h2>
            <p className="text-[12px] text-slate-400 mt-0.5">Click one to open it.</p>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 shrink-0 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center transition-colors cursor-default"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="shrink-0 px-5 pt-3">
          <label className="flex items-center gap-2 h-9 px-2.5 rounded-lg border border-slate-700 bg-slate-950 text-slate-500 focus-within:border-indigo-500">
            <Search className="w-4 h-4 shrink-0" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelected(null);
              }}
              placeholder="Find a tool or setting"
              aria-label="Find a tool or setting"
              className="flex-1 min-w-0 bg-transparent text-[13px] text-slate-200 placeholder:text-slate-500 focus:outline-none"
            />
            {!query && <span className="text-[10.5px] px-1 rounded border border-slate-700 font-mono">Ctrl K</span>}
          </label>
        </div>

        <div ref={listRef} role="listbox" aria-label="Tools and settings" className="flex-1 min-h-0 overflow-y-auto px-3 pt-1 pb-3 [scrollbar-width:thin]">
          {listed.length === 0 && <p className="px-2 py-8 text-center text-[12px] text-slate-500">Nothing matches “{query.trim()}”.</p>}
          {groups.map(
            ({ group, items: groupItems }) =>
              groupItems.length > 0 && (
                <div key={group}>
                  <p className="px-2.5 pt-3 pb-1 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">{group}</p>
                  {groupItems.map((item) => {
                    const Icon = item.icon;
                    const on = current?.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        aria-selected={on}
                        data-hub-item={item.id}
                        title={item.hint}
                        onClick={() => openItem(item)}
                        className={`group w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-[10px] text-left transition-colors cursor-default ${
                          on ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:bg-slate-800/60'
                        }`}
                      >
                        <span className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${TILE[item.tone]}`}>
                          <Icon className="w-[15px] h-[15px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium leading-tight truncate">{item.label}</span>
                          {item.summary && <span className="block text-[11px] text-slate-500 leading-tight truncate mt-0.5">{item.summary}</span>}
                        </span>
                        <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-colors ${on ? 'text-indigo-300' : 'text-slate-600 group-hover:text-indigo-300'}`} />
                      </button>
                    );
                  })}
                </div>
              )
          )}
        </div>

        {footer && <div className="shrink-0 px-5 py-3 border-t border-edge">{footer}</div>}
      </section>
    </div>,
    document.body
  );
};
