import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, CornerDownLeft, Download, ExternalLink, Search } from 'lucide-react';

/**
 * Tools and settings, opened from the header: one window in the middle of the
 * screen. The tools and settings are listed on the left; the one pointed at,
 * or picked with the arrow keys, is previewed on the right with what it is set
 * to now, and Open (or Enter) opens its own window. Ctrl K opens it from
 * anywhere; a click outside it or Escape closes it. Opening and closing are
 * a short fade and zoom, none when the system asks for reduced motion.
 */

export interface ToolsHubFact {
  label: string;
  value: React.ReactNode;
  /** A status dot before the value: ready, or not set up. */
  status?: 'ok' | 'off';
}

export interface ToolsHubItem {
  id: string;
  group: 'Studio' | 'Settings';
  label: string;
  /** What it is for, under its name in the preview. */
  hint: string;
  /** What it is set to now, in a few words, under its name in the list. */
  summary?: string | null;
  icon: React.ComponentType<{ className?: string }>;
  /** Its colour: the icon's tile and the glow behind the preview. */
  tone: keyof typeof TONES;
  facts: ToolsHubFact[];
  /** Anything more the preview shows under the facts, such as a meter. */
  extra?: React.ReactNode;
  /** One line at the foot of the preview: what opening it does, or when changes apply. */
  note?: string;
  onOpen: () => void;
}

const TONES = {
  indigo: { tile: 'from-indigo-400 to-indigo-600', glow: 'bg-indigo-500' },
  teal: { tile: 'from-teal-400 to-teal-600', glow: 'bg-teal-500' },
  pink: { tile: 'from-pink-400 to-pink-600', glow: 'bg-pink-500' },
  amber: { tile: 'from-amber-400 to-amber-600', glow: 'bg-amber-500' },
  slate: { tile: 'from-slate-400 to-slate-600', glow: 'bg-slate-400' },
  blue: { tile: 'from-blue-400 to-blue-600', glow: 'bg-blue-500' },
  violet: { tile: 'from-violet-400 to-violet-600', glow: 'bg-violet-500' },
  emerald: { tile: 'from-emerald-400 to-emerald-600', glow: 'bg-emerald-500' },
} as const;

/** How long closing takes; the window stays on screen until it has played. */
const CLOSE_MS = 150;

export const ToolsHub: React.FC<{
  open: boolean;
  onClose: () => void;
  items: ToolsHubItem[];
  /** Check for updates, at the foot of the list; absent where the app can't update itself. */
  onCheckUpdates?: () => void;
}> = ({ open, onClose, items, onCheckUpdates }) => {
  const [shown, setShown] = useState(open);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Stays on screen while it plays its closing animation.
  useEffect(() => {
    if (open) {
      setShown(true);
      setClosing(false);
      setQuery('');
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
    () =>
      items.filter(
        (item) =>
          !needle ||
          [item.label, item.hint, item.summary ?? '', ...item.facts.map((f) => `${f.label} ${typeof f.value === 'string' ? f.value : ''}`)]
            .join(' ')
            .toLowerCase()
            .includes(needle)
      ),
    [items, needle]
  );
  const current = listed.find((item) => item.id === selected) ?? listed[0] ?? null;

  const openItem = (item: ToolsHubItem) => {
    onClose();
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
        const next = listed[(at + (e.key === 'ArrowDown' ? 1 : -1) + listed.length) % listed.length];
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
  const tone = current ? TONES[current.tone] : TONES.indigo;
  const groups = (['Studio', 'Settings'] as const).map((group) => ({ group, items: listed.filter((item) => item.group === group) }));

  return createPortal(
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6 bg-slate-950/70 backdrop-blur-sm ${
        closing ? 'tools-hub-veil-out' : 'tools-hub-veil-in'
      }`}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Tools and settings"
        className={`relative w-full max-w-[58rem] h-[min(36rem,100%)] grid md:grid-cols-[17.5rem_minmax(0,1fr)] rounded-[20px] bg-slate-900/95 border border-slate-700/80 shadow-2xl shadow-black/60 overflow-hidden text-slate-100 ${
          closing ? 'tools-hub-panel-out' : 'tools-hub-panel-in'
        }`}
      >
        <div className="min-h-0 flex flex-col border-r border-slate-800 bg-slate-950/40">
          <div className="px-4 pt-4 pb-3">
            <h2 className="text-[15px] font-semibold text-slate-100">Tools and settings</h2>
            <label className="mt-3 flex items-center gap-2 h-9 px-2.5 rounded-lg border border-slate-700 bg-slate-950 text-slate-500 focus-within:border-indigo-500">
              <Search className="w-4 h-4 shrink-0" />
              <input
                ref={searchRef}
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

          <div ref={listRef} role="listbox" aria-label="Tools and settings" className="flex-1 min-h-0 overflow-y-auto px-2.5 pb-2 [scrollbar-width:thin]">
            {listed.length === 0 && <p className="px-2 py-8 text-center text-[12px] text-slate-500">Nothing matches “{query.trim()}”.</p>}
            {groups.map(
              ({ group, items: groupItems }) =>
                groupItems.length > 0 && (
                  <div key={group} className="mb-1.5">
                    <p className="px-2 pt-2 pb-1 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">{group}</p>
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
                          onMouseEnter={() => setSelected(item.id)}
                          onFocus={() => setSelected(item.id)}
                          onClick={() => openItem(item)}
                          className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors cursor-default ${
                            on ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:bg-slate-800/60'
                          }`}
                        >
                          <span className={`w-7 h-7 shrink-0 rounded-lg bg-gradient-to-b ${TONES[item.tone].tile} text-white flex items-center justify-center`}>
                            <Icon className="w-[15px] h-[15px]" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13px] font-medium leading-tight truncate">{item.label}</span>
                            {item.summary && <span className="block text-[11px] text-slate-500 leading-tight truncate mt-0.5">{item.summary}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )
            )}
          </div>

          <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 border-t border-slate-800 text-[11px] text-slate-500">
            <span className="hidden md:flex items-center gap-1">
              <ArrowUp className="w-3 h-3" />
              <ArrowDown className="w-3 h-3" /> move
            </span>
            <span className="hidden md:flex items-center gap-1">
              <CornerDownLeft className="w-3 h-3" /> open
            </span>
            <span className="flex-1" />
            {onCheckUpdates && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onCheckUpdates();
                }}
                className="flex items-center gap-1 text-indigo-300 hover:text-indigo-200 cursor-default"
              >
                <Download className="w-3 h-3" /> Check for updates
              </button>
            )}
          </div>
        </div>

        <div className="relative hidden md:flex min-h-0 flex-col p-7 overflow-hidden">
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute -top-40 -right-32 w-[26rem] h-[26rem] rounded-full blur-3xl opacity-20 transition-colors duration-300 ${tone.glow}`}
          />
          {current ? (
            <div key={current.id} className="relative flex-1 min-h-0 flex flex-col tools-hub-preview-in">
              <div className="flex items-center gap-4">
                <span className={`w-14 h-14 shrink-0 rounded-2xl bg-gradient-to-b ${tone.tile} text-white flex items-center justify-center shadow-lg shadow-black/30`}>
                  <current.icon className="w-7 h-7" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[20px] font-semibold text-slate-50 leading-tight">{current.label}</h3>
                  <p className="text-[13px] text-slate-400 mt-1">{current.hint}</p>
                </div>
              </div>

              {current.facts.length > 0 && (
                <dl className="mt-6 grid grid-cols-2 gap-2.5">
                  {current.facts.map((fact) => (
                    <div key={fact.label} className="min-w-0 rounded-xl border border-slate-800 bg-slate-800/30 px-3.5 py-2.5">
                      <dt className="text-[11px] text-slate-500">{fact.label}</dt>
                      <dd className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-slate-100 min-w-0">
                        {fact.status && (
                          <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${fact.status === 'ok' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                        )}
                        <span className="truncate">{fact.value}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {current.extra && <div className="mt-3">{current.extra}</div>}

              <div className="mt-auto pt-5 flex items-center gap-3">
                {current.note && <span className="min-w-0 flex-1 text-[12px] text-slate-500">{current.note}</span>}
                <button
                  type="button"
                  onClick={() => openItem(current)}
                  className="ml-auto shrink-0 h-9 flex items-center gap-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold transition-colors cursor-default"
                >
                  <ExternalLink className="w-4 h-4" /> Open {current.label}
                </button>
              </div>
            </div>
          ) : (
            <p className="m-auto text-[13px] text-slate-500">Nothing to show.</p>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
};

/** A thin bar for a share, 0 to 1, with words at both ends: the meters in a preview. */
export const HubMeter: React.FC<{ share: number; left?: string; right?: string; tone?: 'indigo' | 'amber' | 'emerald' | 'rose' }> = ({
  share,
  left,
  right,
  tone = 'indigo',
}) => (
  <div className="rounded-xl border border-slate-800 bg-slate-800/30 px-3.5 py-3">
    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
      <div
        className={`h-full rounded-full ${tone === 'amber' ? 'bg-amber-400' : tone === 'emerald' ? 'bg-emerald-400' : tone === 'rose' ? 'bg-rose-400' : 'bg-indigo-400'}`}
        style={{ width: `${Math.round(Math.min(1, Math.max(0, share)) * 100)}%` }}
      />
    </div>
    {(left || right) && (
      <div className="mt-1.5 flex justify-between gap-3 text-[11px] text-slate-500">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    )}
  </div>
);
