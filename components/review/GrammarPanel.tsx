import React, { useEffect, useRef, useState } from 'react';
import { Loader2, SpellCheck, X } from 'lucide-react';
import type { GrammarFix, GrammarState } from '../../services/grammarCheck';
import { diffWords } from '../../services/wordDiff';

export type GrammarScope = 'picked' | 'shown' | 'all';

/**
 * Review's Check grammar button: asks which lines to check, then starts. Never
 * runs by itself.
 */
export function GrammarCheckButton({
  picked,
  shown,
  total,
  busy,
  onStart,
}: {
  picked: number;
  /** Lines the current search or filter shows; offered only when it is fewer than all. */
  shown: number;
  total: number;
  busy: boolean;
  onStart: (scope: GrammarScope) => void;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<GrammarScope>('all');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setScope(picked > 0 ? 'picked' : shown < total ? 'shown' : 'all');
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
    // Picked once per opening: a later tick doesn't move the user's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const options: { id: GrammarScope; label: string; count: number }[] = [
    ...(picked > 0 ? [{ id: 'picked' as const, label: 'Picked lines only', count: picked }] : []),
    ...(shown < total ? [{ id: 'shown' as const, label: 'Lines shown now', count: shown }] : []),
    { id: 'all', label: 'All lines', count: total },
  ];
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        disabled={busy || total === 0}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="h-8 px-2.5 flex items-center gap-1.5 rounded-xl border border-edge text-xs font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-default"
        title="Check the dub lines' spelling, matras, agreement and punctuation. Runs only when you press it; nothing changes until you accept a fix."
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SpellCheck className="w-3.5 h-3.5" />}
        Check grammar
      </button>
      {open && (
        <div role="dialog" aria-label="Check grammar" className="absolute right-0 top-10 z-40 w-72 rounded-xl border border-slate-700 bg-slate-950 shadow-2xl p-3 text-[12.5px]">
          <div className="font-medium text-slate-100 mb-1.5">Check grammar on</div>
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 py-1.5 cursor-default text-slate-200">
              <input type="radio" name="grammar-scope" className="accent-indigo-500" checked={scope === o.id} onChange={() => setScope(o.id)} />
              <span>
                {o.label} <span className="text-slate-500 tabular-nums">· {o.count}</span>
              </span>
            </label>
          ))}
          <p className="mt-2 pt-2 border-t border-edge text-slate-400 leading-relaxed">
            Spelling, matras, gender and number agreement, punctuation. Meaning and word choice stay as they are. Only these lines' text goes to your text model.
          </p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onStart(scope);
              }}
              className="flex-1 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium cursor-default"
            >
              Check
            </button>
            <button type="button" onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg border border-edge text-slate-300 hover:bg-slate-800 cursor-default">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FixText({ from, to, fontSize }: { from: string; to: string; fontSize: number }) {
  return (
    <div className="leading-[1.7] break-words [overflow-wrap:anywhere] text-slate-100" style={{ fontSize }}>
      {diffWords(from, to).map((p, n) =>
        p.type === 'same' ? (
          <span key={n}>{p.text}</span>
        ) : p.type === 'del' ? (
          <del key={n} className="bg-rose-500/20 text-rose-300 rounded px-0.5">
            {p.text}
          </del>
        ) : (
          <ins key={n} className="no-underline bg-emerald-500/20 text-emerald-300 rounded px-0.5">
            {p.text}
          </ins>
        )
      )}
    </div>
  );
}

/**
 * The grammar check's results beside the cues: one card per fix, old words
 * struck out and new ones marked, Accept or Skip each. Enter accepts the
 * focused fix and Esc skips it; ↑ ↓ move between fixes.
 */
export function GrammarPanel({
  running,
  error,
  checked,
  unread,
  fixes,
  states,
  currentText,
  cueLabel,
  fontSize,
  onAccept,
  onSkip,
  onUndo,
  onJump,
  onStop,
  onClose,
}: {
  running: boolean;
  error: string | null;
  checked: number;
  unread: number;
  fixes: GrammarFix[];
  states: Record<string, GrammarState>;
  /** The cue's dub text now, to tell a fix whose line was edited since the check. */
  currentText: (id: string) => string | null;
  cueLabel: (id: string) => string;
  fontSize: number;
  onAccept: (fixes: GrammarFix[]) => void;
  onSkip: (ids: string[]) => void;
  onUndo: (fix: GrammarFix) => void;
  onJump: (id: string) => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const stale = (f: GrammarFix) => currentText(f.id) !== f.text;
  const open = fixes.filter((f) => (states[f.id] ?? 'open') === 'open');
  const usable = open.filter((f) => !stale(f));
  const [focus, setFocus] = useState<string | null>(null);
  const focused = open.find((f) => f.id === focus) ?? open[0] ?? null;
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) list.current?.querySelector(`[data-fix="${CSS.escape(focused.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focused?.id]);
  const after = (id: string) => {
    const at = open.findIndex((f) => f.id === id);
    setFocus((open[at + 1] ?? open[at - 1])?.id ?? null);
  };
  const move = (step: number) => {
    if (!open.length) return;
    const at = focused ? open.findIndex((f) => f.id === focused.id) : -1;
    const next = open[(at + step + open.length) % open.length];
    setFocus(next.id);
    onJump(next.id);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('button') && e.key === 'Enter') return;
    if (!focused) return;
    if (e.key === 'Enter' && !stale(focused)) {
      e.preventDefault();
      after(focused.id);
      onAccept([focused]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      after(focused.id);
      onSkip([focused.id]);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e.key === 'ArrowDown' ? 1 : -1);
    }
  };
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-slate-900 outline-none" tabIndex={-1} onKeyDown={onKey} aria-label="Grammar">
      <div className="flex items-center gap-2 px-4 sm:px-5 pt-4 pb-3 border-b border-edge">
        <SpellCheck className="w-4 h-4 text-slate-400" />
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-semibold text-slate-100">Grammar</h2>
          <p className="text-[11.5px] text-slate-400 tabular-nums">
            {running
              ? `Checking ${checked} line${checked === 1 ? '' : 's'}…`
              : error
                ? 'The check stopped.'
                : `${fixes.length} of ${checked} line${checked === 1 ? '' : 's'} need a fix · ${open.length} left`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-edge text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-default"
          title="Close the grammar check. Accepted fixes stay."
          aria-label="Close the grammar check"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div ref={list} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-2.5">
        {running && (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="flex-1">Your text model is reading the lines.</span>
            <button type="button" onClick={onStop} className="underline hover:text-slate-200 cursor-default">
              Stop
            </button>
          </div>
        )}
        {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>}
        {!running && !error && unread > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
            {unread} line{unread === 1 ? ' was' : 's were'} not checked: the text model's answer could not be read. Check again to try them.
          </div>
        )}
        {!running && !error && fixes.length === 0 && <div className="px-1 py-2 text-xs text-slate-400">No grammar problems found.</div>}
        {fixes.map((f) => {
          const state = states[f.id] ?? 'open';
          if (state !== 'open') {
            return (
              <div key={f.id} className="rounded-xl border border-edge px-3 py-2 text-xs text-slate-500 flex items-center gap-2">
                <span className="font-mono tabular-nums">{cueLabel(f.id)}</span>
                <span className="flex-1">{state === 'accepted' ? 'Accepted' : 'Skipped'}</span>
                <button type="button" onClick={() => onUndo(f)} className="underline hover:text-slate-200 cursor-default">
                  Undo
                </button>
              </div>
            );
          }
          const old = stale(f);
          const on = focused?.id === f.id;
          return (
            <div
              key={f.id}
              data-fix={f.id}
              onClick={() => {
                setFocus(f.id);
                onJump(f.id);
              }}
              className={`rounded-xl border px-3 py-2.5 bg-slate-950/60 cursor-default ${on ? 'border-indigo-400/70' : 'border-edge hover:border-slate-600'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">{cueLabel(f.id)}</span>
                <span className="text-[10.5px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-300">{f.kind}</span>
              </div>
              <FixText from={f.text} to={f.fixed} fontSize={fontSize} />
              {f.why && <p className="text-[11.5px] text-slate-400 mt-1">{f.why}</p>}
              {old && <p className="text-[11.5px] text-amber-300 mt-1">The line was edited after the check, so this fix can't be put in.</p>}
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  disabled={old}
                  onClick={(e) => {
                    e.stopPropagation();
                    after(f.id);
                    onAccept([f]);
                  }}
                  className="px-3 py-1 rounded-lg bg-emerald-500/90 hover:bg-emerald-400 text-slate-950 text-xs font-medium disabled:opacity-40 cursor-default"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    after(f.id);
                    onSkip([f.id]);
                  }}
                  className="px-3 py-1 rounded-lg border border-edge text-slate-300 hover:bg-slate-800 text-xs cursor-default"
                >
                  Skip
                </button>
                {on && <span className="self-center text-[11px] text-slate-500 ml-auto">Enter · Esc · ↑↓</span>}
              </div>
            </div>
          );
        })}
      </div>

      {open.length > 0 && (
        <div className="px-4 py-3 border-t border-edge flex gap-2">
          <button
            type="button"
            disabled={usable.length === 0}
            onClick={() => onAccept(usable)}
            className="flex-1 py-1.5 rounded-lg border border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/10 text-xs disabled:opacity-40 cursor-default"
          >
            Accept all left ({usable.length})
          </button>
          <button
            type="button"
            onClick={() => onSkip(open.map((f) => f.id))}
            className="px-3 py-1.5 rounded-lg border border-edge text-slate-300 hover:bg-slate-800 text-xs cursor-default"
          >
            Skip all
          </button>
        </div>
      )}
    </div>
  );
}
