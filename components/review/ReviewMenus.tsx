import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Download, Keyboard, Loader2, Minus, MoreHorizontal, MoreVertical, Plus } from 'lucide-react';

/** Closes a small menu on a click outside it or on Escape. */
function useAwayClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    window.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc, true);
    };
  }, [open, close]);
  return ref;
}

const menuPanel = 'absolute top-full z-50 mt-1.5 rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-xl shadow-black/50';

export interface ShowOption<T extends string> {
  id: T;
  label: string;
  count: number;
  /** Tailwind background for the option's dot; none for All. */
  dot?: string;
  /** A rule above this option. */
  divided?: boolean;
}

/** Review's one filter: which lines the list shows, each choice with how many lines it holds. */
export function ShowLinesMenu<T extends string>({ value, options, onChange }: { value: T; options: ShowOption<T>[]; onChange: (id: T) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useAwayClose(open, () => setOpen(false));
  const current = options.find((o) => o.id === value) ?? options[0];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className={`h-8 px-3 rounded-xl border border-edge flex items-center gap-2 text-[13px] whitespace-nowrap cursor-default ${
          value !== options[0].id ? 'bg-slate-100 text-slate-900 border-slate-100' : 'bg-slate-950 text-slate-200 hover:bg-slate-800'
        }`}
      >
        <span className={value !== options[0].id ? 'text-slate-600' : 'text-slate-400'}>Show</span>
        {current.label}
        <span className={`font-mono text-[12px] tabular-nums ${value !== options[0].id ? 'text-slate-600' : 'text-slate-400'}`}>{current.count}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-70" />
      </button>
      {open && (
        <div className={`${menuPanel} left-0 w-64`} role="menu">
          {options.map((o) => (
            <React.Fragment key={o.id}>
              {o.divided && <div className="my-1 border-t border-edge" />}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={o.id === value}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13px] text-left cursor-default ${
                  o.id === value ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:bg-slate-800/70'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${o.dot || 'bg-transparent'}`} />
                <span className="flex-1">{o.label}</span>
                <span className="font-mono text-[12px] text-slate-400 tabular-nums">{o.count}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/** Two to four choices side by side, the one in use lit. */
function Choice<T extends string | number>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <span role="group" aria-label={label} className="inline-flex rounded-lg border border-edge overflow-hidden shrink-0">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
          className={`px-2.5 py-1 text-[12.5px] cursor-default ${o.id === value ? 'bg-slate-100 text-slate-950 font-medium' : 'text-slate-300 hover:bg-slate-800'}`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="flex items-center justify-between gap-3 px-1.5 py-1.5">
    <span className="text-[13px] text-slate-300" title={hint}>
      {label}
    </span>
    {children}
  </div>
);

/**
 * Review's ⋯: how the list looks. Line details, text size, passages, the
 * estimate and the lanes, and the phonetic keyboard, out of the toolbar.
 */
export function ReviewViewMenu(props: {
  detailed: boolean;
  onDetailed: (on: boolean) => void;
  fontPx: number;
  fontMin: number;
  fontMax: number;
  fontDefault: number;
  onFontPx: (px: number) => void;
  groupByPassage: boolean;
  onGroupByPassage: (on: boolean) => void;
  passagePause: number;
  passagePauses: readonly number[];
  onPassagePause: (pause: number) => void;
  passageCount: number;
  foldedCount: number;
  onUnfoldAll: () => void;
  /** The Quick | Expert switch, as the Dub step shows it. */
  estimate?: React.ReactNode;
  /** The Wave | Blocks | Bars switch. */
  lanes?: React.ReactNode;
  onOpenKeyboard?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useAwayClose(open, () => setOpen(false));
  const p = props;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title="View: line details, text size, passages, estimate, lanes, keyboard"
        aria-label="View options"
        className={`w-8 h-8 flex items-center justify-center rounded-xl border border-edge cursor-default ${open ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:text-slate-100 hover:bg-slate-800'}`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className={`${menuPanel} right-0 w-[21rem] max-w-[calc(100vw-2rem)] p-2`}>
          <Row label="Line details">
            <Choice
              label="Line details"
              value={p.detailed ? 'detailed' : 'simple'}
              onChange={(v) => p.onDetailed(v === 'detailed')}
              options={[
                { id: 'simple', label: 'Simple' },
                { id: 'detailed', label: 'Detailed' },
              ]}
            />
          </Row>
          <p className="px-1.5 -mt-0.5 pb-1 text-[12px] text-slate-400 leading-snug">
            Simple shows counts and the fit only on the line you are in. Detailed shows them on every line.
          </p>
          <Row label="Text size">
            <span className="inline-flex items-center h-7 rounded-lg border border-edge">
              <button
                type="button"
                onClick={() => p.onFontPx(Math.max(p.fontMin, p.fontPx - 1))}
                disabled={p.fontPx <= p.fontMin}
                className="w-8 h-full flex items-center justify-center text-slate-300 hover:text-slate-100 disabled:opacity-30 cursor-default"
                aria-label="Smaller text"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => p.onFontPx(p.fontDefault)}
                className="min-w-[2.75rem] h-full font-mono text-[12px] text-slate-200 tabular-nums cursor-default"
                title={`Reset to ${p.fontDefault}px`}
              >
                {p.fontPx}px
              </button>
              <button
                type="button"
                onClick={() => p.onFontPx(Math.min(p.fontMax, p.fontPx + 1))}
                disabled={p.fontPx >= p.fontMax}
                className="w-8 h-full flex items-center justify-center text-slate-300 hover:text-slate-100 disabled:opacity-30 cursor-default"
                aria-label="Larger text"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </span>
          </Row>
          <div className="my-1.5 border-t border-edge" />
          <Row label="Group rows">
            <Choice
              label="Group rows"
              value={p.groupByPassage ? 'on' : 'off'}
              onChange={(v) => p.onGroupByPassage(v === 'on')}
              options={[
                { id: 'off', label: 'Off' },
                { id: 'on', label: 'By passage' },
              ]}
            />
          </Row>
          {p.groupByPassage && (
            <>
              <Row label="New passage at pauses over" hint="A new passage starts where the original speaker pauses this long, or the speaker changes">
                <Choice label="Pause that starts a passage" value={p.passagePause} onChange={p.onPassagePause} options={p.passagePauses.map((s) => ({ id: s, label: `${s}s` }))} />
              </Row>
              <div className="flex items-center justify-between px-1.5 pb-1 text-[12px] text-slate-400">
                <span className="tabular-nums">
                  {p.passageCount} {p.passageCount === 1 ? 'passage' : 'passages'}
                  {p.foldedCount > 0 && `, ${p.foldedCount} folded`}
                </span>
                {p.foldedCount > 0 && (
                  <button type="button" onClick={p.onUnfoldAll} className="text-slate-200 underline underline-offset-2 cursor-default">
                    Show all passages
                  </button>
                )}
              </div>
            </>
          )}
          {(p.estimate || p.lanes) && <div className="my-1.5 border-t border-edge" />}
          {p.estimate && <Row label="Estimate">{p.estimate}</Row>}
          {p.lanes && <Row label="Lanes">{p.lanes}</Row>}
          {p.onOpenKeyboard && (
            <>
              <div className="my-1.5 border-t border-edge" />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  p.onOpenKeyboard?.();
                }}
                className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-[13px] text-slate-300 hover:text-slate-100 hover:bg-slate-800/70 cursor-default"
              >
                <Keyboard className="w-4 h-4 text-slate-400" /> Indic phonetic keyboard
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The Script view's Word button: a click asks how big the file's paragraphs
 * are, and the pick saves the file. The size last used is ticked and kept.
 */
export function WordSaveMenu<T extends string>({
  sizes,
  current,
  saving,
  onSave,
  title,
}: {
  sizes: { id: T; label: string; hint: string }[];
  current: T;
  saving: boolean;
  onSave: (size: T) => void;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useAwayClose(open, () => setOpen(false));
  // Full first: it is the default, the whole script with a paragraph per speaker turn.
  const ordered = [...sizes].sort((a, b) => Number(b.id === 'full') - Number(a.id === 'full'));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={saving}
        aria-haspopup="true"
        aria-expanded={open}
        title={title}
        className={`h-6 px-2 rounded-md border border-edge flex items-center gap-1 font-medium transition-colors cursor-default disabled:opacity-50 ${
          open ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
        Word
        <ChevronDown className="w-3 h-3 opacity-70" />
      </button>
      {open && (
        <div className={`${menuPanel} left-0 w-80`} role="menu">
          <div className="px-2.5 pt-1 pb-1.5 text-[12px] text-slate-400">Save as Word, paragraphs:</div>
          {ordered.map((size) => (
            <button
              key={size.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSave(size.id);
              }}
              className="w-full flex items-start gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-slate-800 cursor-default"
            >
              <Check className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${size.id === current ? 'text-indigo-300' : 'text-transparent'}`} />
              <span className="min-w-0">
                <span className="block text-[13px] text-slate-100">{size.label}</span>
                <span className="block text-[12px] text-slate-400 leading-snug">{size.hint[0].toUpperCase() + size.hint.slice(1)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface CueMenuItem {
  label: string;
  /** The key that does the same, shown beside it. */
  keys?: string;
  onClick: () => void;
}

/** A cue's ⋯: its less used actions (split, the cut, join), each with its key. */
export function CueRowMenu({ items, label, className = '' }: { items: CueMenuItem[]; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useAwayClose(open, () => setOpen(false));
  return (
    <div ref={ref} className={`relative ${open ? '' : className}`}>
      <button
        type="button"
        onClick={(e) => {
          // Near the bottom of the list it opens upward, so the list never clips it.
          const box = (e.currentTarget.closest('.overflow-y-auto') as HTMLElement | null)?.getBoundingClientRect();
          const at = e.currentTarget.getBoundingClientRect();
          setUp(at.bottom + 40 * items.length + 24 > (box?.bottom ?? window.innerHeight));
          setOpen((v) => !v);
        }}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={label}
        title="More: split, the cut, join"
        className={`w-7 h-7 flex items-center justify-center rounded-md cursor-default ${open ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'}`}
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className={`absolute right-0 z-50 w-72 rounded-xl border border-slate-700 bg-slate-900 p-1.5 shadow-xl shadow-black/50 ${up ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="w-full flex items-center justify-between gap-3 px-2.5 py-1.5 rounded-lg text-[13px] text-left text-slate-200 hover:bg-slate-800 cursor-default"
            >
              {item.label}
              {item.keys && <span className="font-mono text-[11.5px] px-1.5 rounded border border-slate-700 text-slate-400">{item.keys}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
