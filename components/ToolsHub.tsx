import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CornerDownLeft, ExternalLink, Search, X } from 'lucide-react';

/**
 * Tools and settings, opened from the header: one window in the middle of the
 * screen, laid out like an inspector. The tools and settings are listed on the
 * left; the one picked (a click, or the arrow keys) fills the right side with
 * what it is set to now and, for the common settings, controls that change
 * them right there. Open, Enter or a double click opens its own window for the
 * rest. Ctrl K opens it from anywhere; a click outside it or Escape closes it.
 * Opening and closing are a short fade and zoom, none when the system asks for
 * reduced motion.
 */

export interface ToolsHubFact {
  label: string;
  value: React.ReactNode;
  /** A status dot before the value: ready, or not set up. */
  status?: 'ok' | 'off';
}

/** A setting changed right in the window: its name and help on the left, its control on the right. */
export interface ToolsHubControl {
  label: string;
  help?: string;
  control: React.ReactNode;
}

export interface ToolsHubItem {
  id: string;
  group: 'Studio' | 'Settings' | 'App';
  label: string;
  /** What it is for, under its name at the top of the right side. */
  hint: string;
  /** What it is set to now, in a few words, under its name in the list. */
  summary?: string | null;
  icon: React.ComponentType<{ className?: string }>;
  /** Its colour: the icon's tile, the glow at the top and the controls' picked state. */
  tone: keyof typeof TONES;
  /** Settings changed right here, listed above the facts. */
  controls?: ToolsHubControl[];
  facts: ToolsHubFact[];
  /** Anything more shown under the facts, such as a meter. */
  extra?: React.ReactNode;
  /** One line at the foot: what opening it does, or when changes apply. */
  note?: string;
  /** The button at the foot, when "Open" and the name don't read right. */
  openLabel?: string;
  onOpen: () => void;
}

const TONES = {
  indigo: { tile: 'from-indigo-400 to-indigo-600', glow: 'bg-indigo-500', picked: 'bg-indigo-500/30', on: 'bg-indigo-500' },
  teal: { tile: 'from-teal-400 to-teal-600', glow: 'bg-teal-500', picked: 'bg-teal-500/30', on: 'bg-teal-500' },
  pink: { tile: 'from-pink-400 to-pink-600', glow: 'bg-pink-500', picked: 'bg-pink-500/30', on: 'bg-pink-500' },
  amber: { tile: 'from-amber-400 to-amber-600', glow: 'bg-amber-500', picked: 'bg-amber-500/30', on: 'bg-amber-500' },
  slate: { tile: 'from-slate-400 to-slate-600', glow: 'bg-slate-400', picked: 'bg-slate-500/40', on: 'bg-slate-400' },
  blue: { tile: 'from-blue-400 to-blue-600', glow: 'bg-blue-500', picked: 'bg-blue-500/30', on: 'bg-blue-500' },
  violet: { tile: 'from-violet-400 to-violet-600', glow: 'bg-violet-500', picked: 'bg-violet-500/30', on: 'bg-violet-500' },
  emerald: { tile: 'from-emerald-400 to-emerald-600', glow: 'bg-emerald-500', picked: 'bg-emerald-500/30', on: 'bg-emerald-500' },
} as const;

/** The picked item's colour, for the controls on the right. */
const ToneContext = createContext<(typeof TONES)[keyof typeof TONES]>(TONES.indigo);

/** How long closing takes; the window stays on screen until it has played. */
const CLOSE_MS = 150;

/** With the right side hidden on a narrow screen, a click in the list opens the item instead of picking it. */
const previewShown = () => typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches;

export const ToolsHub: React.FC<{
  open: boolean;
  onClose: () => void;
  items: ToolsHubItem[];
  /** Shown at the foot of the list, above the key hints: the services and what is left on them. */
  footer?: React.ReactNode;
}> = ({ open, onClose, items, footer }) => {
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
          [
            item.label,
            item.hint,
            item.summary ?? '',
            ...item.facts.map((f) => `${f.label} ${typeof f.value === 'string' ? f.value : ''}`),
            ...(item.controls ?? []).map((c) => `${c.label} ${c.help ?? ''}`),
          ]
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
      // Keys pressed on a control on the right are the control's own.
      if (e.target instanceof Element && e.target.closest('[data-hub-controls]')) return;
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
  const groups = (['Studio', 'Settings', 'App'] as const).map((group) => ({ group, items: listed.filter((item) => item.group === group) }));

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
        className={`relative w-full max-w-[62rem] h-[min(43rem,100%)] grid md:grid-cols-[16.5rem_minmax(0,1fr)] rounded-[20px] bg-slate-900/95 border border-slate-700/80 shadow-2xl shadow-black/60 overflow-hidden text-slate-100 ${
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
                          onFocus={() => setSelected(item.id)}
                          onClick={() => (previewShown() ? setSelected(item.id) : openItem(item))}
                          onDoubleClick={() => openItem(item)}
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
                          {on && <ChevronRight className="hidden md:block w-3.5 h-3.5 shrink-0 text-slate-500" />}
                        </button>
                      );
                    })}
                  </div>
                )
            )}
          </div>

          {footer && <div className="shrink-0 px-4 py-3 border-t border-slate-800">{footer}</div>}
          <div className="shrink-0 hidden md:flex items-center gap-3 px-4 py-2.5 border-t border-slate-800 text-[11px] text-slate-500">
            <span className="flex items-center gap-1">
              <Key><ArrowUp className="w-3 h-3" /></Key>
              <Key><ArrowDown className="w-3 h-3" /></Key> move
            </span>
            <span className="flex items-center gap-1">
              <Key><CornerDownLeft className="w-3 h-3" /></Key> open
            </span>
            <span className="ml-auto flex items-center gap-1">
              <Key>Esc</Key> close
            </span>
          </div>
        </div>

        <div className="relative hidden md:flex min-h-0 flex-col overflow-hidden">
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute -top-28 -left-20 w-[30rem] h-[15rem] rounded-full blur-3xl opacity-25 transition-colors duration-300 ${tone.glow}`}
          />
          {current ? (
            <ToneContext.Provider value={tone}>
              <div className="relative shrink-0 flex items-center gap-4 px-7 pt-6 pb-2">
                <span className={`w-12 h-12 shrink-0 rounded-2xl bg-gradient-to-b ${tone.tile} text-white flex items-center justify-center shadow-lg shadow-black/30`}>
                  <current.icon className="w-6 h-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-[19px] font-semibold text-slate-50 leading-tight">{current.label}</h3>
                  <p className="text-[12.5px] text-slate-400 mt-0.5">{current.hint}</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="w-8 h-8 shrink-0 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-default"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div key={current.id} className="relative flex-1 min-h-0 overflow-y-auto px-7 pb-5 [scrollbar-width:thin] tools-hub-preview-in">
                {current.controls && current.controls.length > 0 && (
                  <HubGroup title="Change here" controls>
                    {current.controls.map((c) => (
                      <HubRow key={c.label} label={c.label} help={c.help}>
                        {c.control}
                      </HubRow>
                    ))}
                  </HubGroup>
                )}
                {current.facts.length > 0 && (
                  <HubGroup title="Now">
                    {current.facts.map((fact) => (
                      <HubRow key={fact.label} label={fact.label}>
                        <span className={`flex items-center gap-1.5 text-[12.5px] min-w-0 max-w-[18rem] ${fact.status === 'off' ? 'text-slate-400' : 'text-slate-100'}`}>
                          {fact.status && (
                            <span className={`w-1.5 h-1.5 shrink-0 rounded-full ${fact.status === 'ok' ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                          )}
                          <span className="truncate">{fact.value}</span>
                        </span>
                      </HubRow>
                    ))}
                  </HubGroup>
                )}
                {current.extra && <div className="mt-3">{current.extra}</div>}
              </div>

              <div className="relative shrink-0 flex items-center gap-3 px-7 py-3.5 border-t border-slate-800 bg-slate-950/30">
                <span className="min-w-0 flex-1 text-[12px] text-slate-500">
                  {current.note ?? (current.controls?.length ? 'Changes here save as you make them.' : '')}
                </span>
                <button
                  type="button"
                  onClick={() => openItem(current)}
                  className="shrink-0 h-9 flex items-center gap-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold transition-colors cursor-default"
                >
                  <ExternalLink className="w-4 h-4" /> {current.openLabel ?? `Open ${current.label}`}
                </button>
              </div>
            </ToneContext.Provider>
          ) : (
            <p className="m-auto text-[13px] text-slate-500">Nothing to show.</p>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
};

/** A titled group of rows on the right, divided like a settings list. */
const HubGroup: React.FC<{ title: string; controls?: boolean; children: React.ReactNode }> = ({ title, controls, children }) => (
  <div className="mt-5">
    <p className="px-1 pb-1.5 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">{title}</p>
    <div data-hub-controls={controls || undefined} className="rounded-xl border border-slate-800 bg-slate-800/25 divide-y divide-slate-800">
      {children}
    </div>
  </div>
);

/** One row: a name, with a line of help under it, and what goes on the right. */
const HubRow: React.FC<{ label: string; help?: string; children: React.ReactNode }> = ({ label, help, children }) => (
  <div className="flex items-center gap-4 px-4 py-2.5 min-h-[48px]">
    <div className="min-w-0 flex-1">
      <div className="text-[13px] text-slate-100">{label}</div>
      {help && <div className="text-[11.5px] text-slate-500 mt-0.5">{help}</div>}
    </div>
    <div className="shrink-0 min-w-0 flex justify-end">{children}</div>
  </div>
);

/** A key cap in the footer's keyboard hints. */
const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded border border-slate-700 bg-slate-800/60 text-slate-300 font-sans text-[10.5px]">
    {children}
  </kbd>
);

/** A few choices side by side, the picked one in the item's colour. */
export function HubSegmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const tone = useContext(ToneContext);
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex p-0.5 rounded-lg bg-slate-950/70 border border-slate-800 text-[12px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1 rounded-md transition-colors cursor-default ${
            o.id === value ? `${tone.picked} text-white font-medium` : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** An on and off switch, in the item's colour when on. */
export const HubSwitch: React.FC<{ on: boolean; onChange: (on: boolean) => void; label: string }> = ({ on, onChange, label }) => {
  const tone = useContext(ToneContext);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative w-[34px] h-5 shrink-0 rounded-full transition-colors cursor-default ${on ? tone.on : 'bg-slate-700'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[14px]' : ''}`} />
    </button>
  );
};

/** A drop-down list of choices. */
export function HubSelect<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <span className="relative inline-flex">
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
        className="appearance-none h-8 min-w-[10rem] pl-3 pr-8 rounded-lg bg-slate-950/70 border border-slate-800 text-[12.5px] text-slate-100 focus:outline-none focus:border-indigo-500 cursor-default"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
    </span>
  );
}

/** A thin bar for a share, 0 to 1, with words at both ends: the meters on the right. */
export const HubMeter: React.FC<{ share: number; left?: string; right?: string; tone?: 'indigo' | 'amber' | 'emerald' | 'rose' }> = ({
  share,
  left,
  right,
  tone = 'indigo',
}) => (
  <div className="rounded-xl border border-slate-800 bg-slate-800/25 px-4 py-3">
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
