import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Ear, Lock, Plus, Tag, X } from 'lucide-react';
import { addTag, PERFORMANCE_TAGS, removeTag, tagsInLine, type ExpressionLine } from '../services/expressionPrep';

/**
 * Voice expression Natural heard ahead of Dub (Mock A + chips): the chip in
 * Review's app bar, the line under Expression in the dub settings, and the
 * tags of Review's open line. See services/expressionPrep.ts.
 */

export interface ExpressionPrepView {
  /**
   * listening: heard in the background now; ready: every section heard;
   * waiting: some to hear, starting after the last edit settles; stopped: the
   * user cancelled; failed: a section could not be heard; no-audio: the
   * original isn't loaded to hear.
   */
  state: 'listening' | 'ready' | 'waiting' | 'stopped' | 'failed' | 'no-audio';
  /** Sections of the script heard, of all of them. */
  heard: number;
  total: number;
  /** Sections with a line not heard yet. */
  toHear: number;
  /** Some line was heard already: what is left to hear is lines changed since. */
  someHeard: boolean;
  error?: string;
  onStart: () => void;
  onCancel: () => void;
}

const parts = (n: number) => `${n} part${n === 1 ? '' : 's'}`;

/**
 * Review's app bar: one small round icon (no pill), only while there is
 * something to know. Ready shows nothing (the dub settings say so); hearing is
 * a ring that fills around the ear, a click stops it; changed lines, a stop or
 * a failure are an icon to click. Every word is in its tooltip.
 */
export const ExpressionPrepChip: React.FC<{ view: ExpressionPrepView }> = ({ view }) => {
  const dot = 'relative w-7 h-7 shrink-0 rounded-full flex items-center justify-center';
  if (view.state === 'ready') return null;
  if (view.state === 'listening') {
    const share = view.total > 0 ? view.heard / view.total : 0;
    // A ring of radius 12 in a 28 px box: its length, and how much of it is drawn.
    const ring = 2 * Math.PI * 12;
    return (
      <button
        type="button"
        onClick={view.onCancel}
        className={`${dot} group hover:bg-slate-800`}
        title={`Hearing the original for Expression: ${view.heard} of ${view.total} parts. Click to stop; what is heard is kept and Dub hears the rest.`}
        aria-label={`Hearing the original, ${view.heard} of ${view.total}. Stop`}
      >
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 28 28" aria-hidden="true">
          <circle cx="14" cy="14" r="12" fill="none" strokeWidth="2" className="stroke-slate-700" />
          <circle
            cx="14"
            cy="14"
            r="12"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            className="stroke-indigo-400 transition-[stroke-dashoffset] duration-300"
            strokeDasharray={ring}
            strokeDashoffset={ring * (1 - Math.max(0.06, share))}
          />
        </svg>
        <Ear className="w-3.5 h-3.5 text-indigo-300 animate-pulse group-hover:hidden" />
        <X className="w-3.5 h-3.5 text-slate-300 hidden group-hover:block" />
      </button>
    );
  }
  if (view.state === 'waiting') {
    return view.someHeard ? (
      <span className={`${dot} text-amber-300`} role="status" title={`${parts(view.toHear)} changed since heard: only those parts of the original are heard again, in a moment.`} aria-label={`${parts(view.toHear)} changed`}>
        <Ear className="w-3.5 h-3.5" />
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" aria-hidden="true" />
      </span>
    ) : (
      <span className={`${dot} text-slate-500`} role="status" title="Expression: the original is heard in the background in a moment, so Dub can voice at once." aria-label="Expression starting">
        <Ear className="w-3.5 h-3.5" />
      </span>
    );
  }
  if (view.state === 'no-audio') {
    return (
      <span className={`${dot} text-slate-600`} title="Expression waits: the original isn't loaded, so it can't be heard yet." aria-label="Expression waits for the original">
        <Ear className="w-3.5 h-3.5" />
      </span>
    );
  }
  if (view.state === 'failed') {
    return (
      <button type="button" onClick={view.onStart} className={`${dot} text-rose-300 hover:bg-rose-500/15`} title={`Expression stopped: ${view.error || 'a part of the original could not be heard.'} Click to try again.`} aria-label="Expression stopped. Try again">
        <AlertTriangle className="w-3.5 h-3.5" />
      </button>
    );
  }
  return (
    <button type="button" onClick={view.onStart} className={`${dot} text-indigo-300 hover:bg-indigo-500/15`} title={`Prepare expression: hear ${parts(view.toHear)} of the original now, so Dub can voice at once.`} aria-label="Prepare expression">
      <Ear className="w-3.5 h-3.5" />
      <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-indigo-400" aria-hidden="true" />
    </button>
  );
};

/**
 * Under Expression in the dub settings: what Dub will find. With `onSeeTags`,
 * once a line is heard, "See tags" opens Review on the first tagged line (the
 * tags are seen and changed there only).
 */
export const ExpressionPrepNote: React.FC<{ view: ExpressionPrepView; onSeeTags?: () => void }> = ({ view, onSeeTags }) => {
  const seeTags =
    onSeeTags && (view.state === 'ready' || view.someHeard) ? (
      <button
        type="button"
        onClick={onSeeTags}
        className="ml-2 inline-flex items-center gap-1 h-5 px-1.5 rounded border border-edge text-slate-300 hover:text-slate-100 hover:border-slate-500 hover:bg-slate-800/60 align-middle"
        title="Open Review on the first tagged line: each tag shows as a chip you can remove or add to."
      >
        <Tag className="w-3 h-3" /> See tags
      </button>
    ) : null;
  if (view.state === 'ready')
    return (
      <span className="inline-flex items-center gap-1.5 text-emerald-300">
        <Check className="w-3.5 h-3.5" /> Heard and saved · Dub starts voicing at once
        {seeTags}
      </span>
    );
  if (view.state === 'listening')
    return (
      <span className="text-indigo-300">
        Hearing the original · <span className="font-mono tabular-nums">{view.heard}/{view.total}</span> parts
        {seeTags}
      </span>
    );
  if (view.someHeard)
    return (
      <span className="text-amber-300">
        {view.toHear === view.total ? `Changed lines are heard again` : `${parts(view.toHear)} to hear again; the other ${view.total - view.toHear} are kept`}
        {seeTags}
      </span>
    );
  return <span className="text-slate-400">Not heard yet · heard when you press Dub, or now from Review</span>;
};

/** The open line's tags on Review: each as a chip with ×, and + tag. */
export const ExpressionTagChips: React.FC<{
  /** The line as written. */
  text: string;
  entry: ExpressionLine | null;
  listening: boolean;
  onChange: (tagged: string) => void;
}> = ({ text, entry, listening, onChange }) => {
  const [picking, setPicking] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!picking) return;
    const close = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setPicking(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [picking]);
  if (!text.trim()) return null;
  const tagged = entry?.text ?? text;
  const tags = entry ? tagsInLine(entry.text) : [];

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
      {tags.map((t, i) => (
        <span
          key={`${i}-${t.tag}`}
          className={`inline-flex items-center gap-1.5 h-6 pl-2 pr-1 rounded-md border ${
            entry?.mine ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-indigo-500/10 text-indigo-200 border-indigo-500/25'
          }`}
        >
          <span className="font-mono">[{t.tag}]</span>
          {t.before && <span className="text-slate-500">before “{t.before}”</span>}
          <button
            type="button"
            onClick={() => onChange(removeTag(tagged, i))}
            className="w-4 h-4 rounded flex items-center justify-center text-slate-500 hover:text-rose-300 hover:bg-slate-800"
            title="Remove this tag. Your change is kept when the line is heard again."
            aria-label={`Remove tag ${t.tag}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      {!entry && <span className="text-slate-500">{listening ? 'Expression: being heard…' : 'Expression: not heard yet'}</span>}
      {entry && tags.length === 0 && <span className="text-slate-500">Expression: said as written, no tags</span>}
      <div className="relative" ref={menu}>
        <button
          type="button"
          onClick={() => setPicking((p) => !p)}
          className="h-6 px-2 rounded-md border border-dashed border-edge text-slate-500 hover:text-slate-300 hover:border-slate-600 inline-flex items-center gap-1"
          title="Add a delivery tag at the start of this line"
        >
          <Plus className="w-3 h-3" /> tag
        </button>
        {picking && (
          <div className="absolute z-30 left-0 top-7 w-56 max-h-64 overflow-y-auto rounded-lg border border-edge bg-slate-900 p-1 shadow-xl">
            {PERFORMANCE_TAGS.map((tag: string) => (
              <button
                key={tag}
                type="button"
                onClick={() => {
                  setPicking(false);
                  onChange(addTag(tagged, tag));
                }}
                className="w-full text-left px-2 py-1 rounded font-mono text-[11.5px] text-slate-300 hover:bg-slate-800"
              >
                [{tag}]
              </button>
            ))}
          </div>
        )}
      </div>
      {entry?.mine && (
        <span className="inline-flex items-center gap-1 text-emerald-300/80" title="You changed this line's tags; hearing it again keeps them.">
          <Lock className="w-3 h-3" /> Your tags
        </span>
      )}
    </div>
  );
};
