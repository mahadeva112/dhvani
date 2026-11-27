import React, { useEffect, useRef, useState } from 'react';
import { Download, Keyboard, ListFilter, Loader2, Minus, MoreHorizontal, MoreVertical, Plus } from 'lucide-react';
import { togglePhonetic, usePhoneticSwitch } from './usePhoneticTyping';

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

/**
 * Review's toolbar is icons only (Mock B, 2026-11-27): each says what it is in
 * a tip under it on hover. Put it inside a `group relative` box with the button.
 */
export function ToolTip({ title, detail, keys, align = 'center' }: { title: React.ReactNode; detail?: React.ReactNode; keys?: string; align?: 'center' | 'right' }) {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute top-full mt-1.5 z-50 flex flex-col items-start gap-0.5 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11.5px] text-slate-300 shadow-xl shadow-black/50 invisible opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-hover:delay-200 group-focus-within:visible group-focus-within:opacity-100 ${
        align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span className="font-semibold text-slate-100">{title}</span>
        {keys && <span className="font-mono text-[10px] text-slate-400 border border-slate-600 rounded px-1">{keys}</span>}
      </span>
      {detail && <span className="text-[11px] text-slate-400">{detail}</span>}
    </span>
  );
}

/** A toolbar icon button: grey, lit while on or open. */
export const toolIcon = (on: boolean) =>
  `relative w-[30px] h-7 rounded-[9px] flex items-center justify-center transition-colors cursor-default disabled:opacity-40 ${
    on ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-100'
  }`;

/** A count in the corner of a toolbar icon: how many the choice on it shows. */
export const ToolCount: React.FC<{ n: number }> = ({ n }) => (
  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-slate-600 text-slate-50 text-[9px] font-mono font-semibold leading-[14px] text-center tabular-nums">
    {n}
  </span>
);

/** Something to look at behind a toolbar icon (labels to check): one small amber dot. */
export const ToolDot: React.FC = () => <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500/80" aria-hidden="true" />;

export interface ShowOption<T extends string> {
  id: T;
  label: string;
  count: number;
  /** Tailwind background for the option's dot; none for All. */
  dot?: string;
  /** A rule above this option. */
  divided?: boolean;
}

/**
 * Review's one filter: which lines the list shows, each choice with how many
 * lines it holds. The button is an icon: the lines' fit as a small grey bar,
 * a count in its corner while a choice other than All is on; the rest is in
 * its tip and its menu.
 */
export function ShowLinesMenu<T extends string>({
  value,
  options,
  onChange,
  bar,
  loading = false,
  footer,
}: {
  value: T;
  options: ShowOption<T>[];
  onChange: (id: T) => void;
  /** The colour bar on the button, once the fit is worked out. */
  bar?: React.ReactNode;
  /** The fit is being worked out: a spinner on the button in place of the bar. */
  loading?: boolean;
  /** Under the choices: how the fit was estimated, and what to do about it. */
  footer?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useAwayClose(open, () => setOpen(false));
  const current = options.find((o) => o.id === value) ?? options[0];
  const filtered = value !== options[0].id;
  // The other problem choices with lines in them, for the tip.
  const others = options.slice(1).filter((o) => o.id !== value && o.count > 0 && o.dot);
  return (
    <div ref={ref} className="group relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Show: ${current.label}, ${current.count}`}
        className={toolIcon(open || filtered)}
      >
        {bar ?? (loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="Working out the fit" /> : <ListFilter className="w-4 h-4" />)}
        {filtered && <ToolCount n={current.count} />}
      </button>
      {!open && (
        <ToolTip
          title="Show"
          detail={
            <>
              <span className="text-slate-200">
                {current.label} · {current.count}
              </span>
              {others.length > 0 && <span className="block">{others.map((o) => `${o.label} ${o.count}`).join(' · ')}</span>}
            </>
          }
        />
      )}
      {open && (
        <div className={`${menuPanel} right-0 w-72`} role="menu">
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
          {footer && (
            <>
              <div className="my-1 border-t border-edge" />
              {footer}
            </>
          )}
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
 * estimate and the lanes, phonetic typing (no badge over the script since
 * 2026-11-27) and the keyboard, and the Word file (Cues and Script views).
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
  /** The dub language's own name, for the phonetic typing switch; none hides the switch. */
  phoneticName?: string;
  /** Cues and Script views: save the script as a Word file, in its paragraphs. */
  onSaveWord?: () => void;
  savingWord?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useAwayClose(open, () => setOpen(false));
  const phoneticOn = usePhoneticSwitch();
  const p = props;
  return (
    <div ref={ref} className="group relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label="More: view options"
        className={toolIcon(open)}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {!open && <ToolTip align="right" title="More" detail={`${p.onSaveWord ? 'Word file, ' : ''}text size, passages${p.phoneticName ? ', phonetic typing' : ''}`} />}
      {open && (
        <div className={`${menuPanel} right-0 w-[21rem] max-w-[calc(100vw-2rem)] p-2`}>
          {p.onSaveWord && (
            <>
              <button
                type="button"
                disabled={p.savingWord}
                onClick={() => {
                  setOpen(false);
                  p.onSaveWord?.();
                }}
                title="The script in this view's paragraphs, the original on the left, the dub on the right"
                className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-[13px] text-slate-300 hover:text-slate-100 hover:bg-slate-800/70 disabled:opacity-50 cursor-default"
              >
                {p.savingWord ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <Download className="w-4 h-4 text-slate-400" />} Save as Word
              </button>
              <div className="my-1.5 border-t border-edge" />
            </>
          )}
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
          {(p.phoneticName || p.onOpenKeyboard) && <div className="my-1.5 border-t border-edge" />}
          {p.phoneticName && (
            <button
              type="button"
              role="switch"
              aria-checked={phoneticOn}
              onClick={togglePhonetic}
              title={`Type Roman letters and get ${p.phoneticName} as you go`}
              className="w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-[13px] text-slate-300 hover:text-slate-100 hover:bg-slate-800/70 cursor-default"
            >
              <Keyboard className="w-4 h-4 text-slate-400" />
              <span className="flex-1 text-left">
                Phonetic typing <span className="text-slate-500">· {p.phoneticName}</span>
              </span>
              <span className="font-mono text-[10.5px] text-slate-500 border border-slate-700 rounded px-1">Ctrl G</span>
              <span className={`relative w-7 h-4 rounded-full transition-colors ${phoneticOn ? 'bg-indigo-500' : 'bg-slate-700'}`}>
                <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-slate-100 transition-all ${phoneticOn ? 'left-[14px]' : 'left-0.5'}`} />
              </span>
            </button>
          )}
          {p.onOpenKeyboard && (
            <>
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
