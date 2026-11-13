import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlowArrow } from './FlowArrow';
import { ArrowDownToLine, Minus, Plus, Scissors, Search, Trash2, Undo2, WrapText } from 'lucide-react';
import type { EditedSubtitle } from '../types';
import {
  DEFAULT_MAX_CPS,
  type SubtitleLimits,
  type WordTime,
  isEditedSubtitle,
  mergeSubtitles,
  parseStampInput,
  splitSubtitle,
  stamp,
  subtitleStats,
  wordsBeforeCaret,
  wrapSubtitle,
} from '../services/subtitleEdits';
import { vlen } from '../services/subtitleCues';

/*
 * Export subtitles, edited by hand: one rounded card per subtitle, as tall as
 * its lines. Split, merge and wrap work the way Srutilekha's review editor
 * does: Enter splits where the cursor is, Shift+Enter starts a new line,
 * Ctrl+M merges with the next, and both halves of a split are wrapped again.
 */

/** Pixel height of one subtitle line in a card's text box. */
const LINE_PX = 24;

const MAX_CPS_KEY = 'dhvani_subtitle_max_cps';

const loadMaxCps = () => {
  try {
    const n = Number(localStorage.getItem(MAX_CPS_KEY));
    if (Number.isFinite(n) && n >= 5 && n <= 40) return n;
  } catch {}
  return DEFAULT_MAX_CPS;
};

/** A time field that accepts what is typed only when it reads as a time; Enter or leaving it applies it. */
const StampField: React.FC<{ value: number; label: string; onCommit: (seconds: number) => boolean }> = ({ value, label, onCommit }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const seconds = parseStampInput(draft);
    if (seconds !== null && onCommit(seconds)) {
      setDraft(null);
      setBad(false);
    } else setBad(true);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      title={bad ? 'Not a time that fits here. Type it as 00:01:02,500 or 62.5' : label}
      value={draft ?? stamp(value)}
      onChange={(e) => {
        setDraft(e.target.value);
        setBad(false);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(null);
          setBad(false);
        }
      }}
      onClick={(e) => e.stopPropagation()}
      className={`w-[6.6rem] h-6 px-1.5 rounded-md bg-slate-950 border font-mono text-[11px] tabular-nums text-slate-200 focus:outline-none focus:border-indigo-500 ${
        bad ? 'border-rose-500' : 'border-edge'
      }`}
    />
  );
};

const iconButton =
  'w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-default';

interface CardProps {
  cue: EditedSubtitle;
  index: number;
  last: boolean;
  active: boolean;
  /** Just made by a split: marked "new" for a moment. */
  fresh: boolean;
  limits: SubtitleLimits;
  focusNow: boolean;
  onFocused: () => void;
  /** Tells the list what is typed but not saved yet, so Merge under the card joins that. */
  onDraft: (text: string | null) => void;
  onPick: (seek: boolean) => void;
  onText: (text: string) => void;
  onTimes: (patch: Partial<EditedSubtitle>) => void;
  onSplit: (text: string, caret: number | null) => void;
  onMerge: (text: string) => void;
  onWrap: (text: string) => void;
  onDelete: () => void;
  onUndo: () => void;
}

function SubtitleCard({
  cue,
  index,
  last,
  active,
  fresh,
  limits,
  focusNow,
  onFocused,
  onDraft,
  onPick,
  onText,
  onTimes,
  onSplit,
  onMerge,
  onWrap,
  onDelete,
  onUndo,
}: CardProps) {
  const [draft, setDraftState] = useState<string | null>(null);
  // Read on blur: a box removed by its own split must not save its old text over the split.
  const draftRef = useRef<string | null>(null);
  const setDraft = (value: string | null) => {
    draftRef.current = value;
    setDraftState(value);
    onDraft(value);
  };
  const text = draft ?? cue.text;
  const ta = useRef<HTMLTextAreaElement>(null);
  /** The cursor was put in the text, so a Split button press knows where. */
  const caretSet = useRef(false);
  const stats = subtitleStats({ ...cue, text }, limits);
  const lines = text.split('\n');
  const n = String(index + 1).padStart(2, '0');

  useEffect(() => {
    if (!focusNow || !ta.current) return;
    ta.current.focus();
    ta.current.setSelectionRange(0, 0);
    caretSet.current = true;
    onFocused();
  }, [focusNow, onFocused]);

  const commit = () => {
    const typed = draftRef.current;
    if (typed !== null && typed !== cue.text) onText(typed);
    setDraft(null);
  };
  // The buttons work on what is typed, saved or not.
  const take = () => {
    const now = text;
    setDraft(null);
    return now;
  };

  const cpsColour = stats.overCps ? 'text-rose-300' : limits.maxCps > 0 && stats.cps > limits.maxCps * 0.8 ? 'text-amber-300' : 'text-emerald-300';
  const cpsFill = stats.overCps ? 'bg-rose-400' : limits.maxCps > 0 && stats.cps > limits.maxCps * 0.8 ? 'bg-amber-400' : 'bg-emerald-400';

  return (
    <div
      data-start={cue.start}
      data-end={cue.end}
      onClick={() => onPick(true)}
      className={`rounded-xl border px-3 pt-2 pb-2.5 cursor-default transition-[color,background-color,border-color,box-shadow] duration-700 ${
        fresh ? 'ring-2 ring-indigo-400/70' : 'ring-0 ring-transparent'
      } ${
        active
          ? 'border-indigo-500/70 bg-indigo-500/[0.08]'
          : stats.issue
            ? 'border-amber-500/40 bg-slate-900'
            : 'border-slate-700/70 bg-slate-900 hover:border-slate-600'
      } ${text.trim() ? '' : 'opacity-50'}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-2">
        <span
          className={`px-1.5 rounded-full bg-slate-800 font-mono text-[11px] tabular-nums ${stats.issue ? 'text-amber-300' : 'text-slate-400'}`}
          title={stats.issue ? 'Needs attention' : undefined}
        >
          {n}
        </span>
        {fresh && <span className="px-1.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10.5px] font-medium">new</span>}
        <span className="flex items-center gap-1 text-slate-500 text-[11px]">
          <StampField
            value={cue.start}
            label={`Subtitle ${n} start`}
            onCommit={(start) => {
              if (start >= cue.end) return false;
              onTimes({ start });
              return true;
            }}
          />
          <FlowArrow />
          <StampField
            value={cue.end}
            label={`Subtitle ${n} end`}
            onCommit={(end) => {
              if (end <= cue.start) return false;
              onTimes({ end });
              return true;
            }}
          />
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] tabular-nums" title={`${stats.cps.toFixed(1)} characters a second`}>
          <span className={cpsColour}>{Math.round(stats.cps)} cps</span>
          {limits.maxCps > 0 && (
            <span className="w-10 h-1 rounded-full bg-slate-800 overflow-hidden" aria-hidden="true">
              <span className={`block h-full rounded-full ${cpsFill}`} style={{ width: `${Math.min(100, (stats.cps / limits.maxCps) * 100)}%` }} />
            </span>
          )}
        </span>
        {stats.overLines && (
          <span className="px-1.5 rounded-full bg-amber-500/15 text-amber-300 text-[11px]">▲ {lines.length} lines</span>
        )}
        {stats.longLine && (
          <span className="px-1.5 rounded-full bg-amber-500/15 text-amber-300 text-[11px]">line over {limits.maxChars}</span>
        )}
        {cue.estimated && (
          <span className="px-1.5 rounded-full bg-slate-800 text-slate-400 text-[11px]" title="Split with no measured word times, so the cut is shared out by word length">
            estimated time
          </span>
        )}
        <span className="flex-1" />
        <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onWrap(take())}
            className={iconButton}
            title={`Wrap again to ${limits.maxChars} characters × ${limits.maxLines} ${limits.maxLines === 1 ? 'line' : 'lines'}`}
            aria-label={`Wrap subtitle ${n} again`}
          >
            <WrapText className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const caret = caretSet.current && ta.current ? ta.current.selectionStart : null;
              onSplit(take(), caret);
            }}
            className={iconButton}
            title="New subtitle from where the cursor is (Enter)"
            aria-label={`Split subtitle ${n}`}
          >
            <Scissors className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onDelete}
            className={`${iconButton} hover:text-rose-300`}
            title="Remove this subtitle (Ctrl+Delete)"
            aria-label={`Remove subtitle ${n}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_3.25rem] gap-2 items-start">
        <textarea
          ref={ta}
          aria-label={`Subtitle ${n} text`}
          spellCheck={false}
          wrap="off"
          rows={lines.length}
          value={text}
          style={{ height: lines.length * LINE_PX + 14 }}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => onPick(false)}
          onSelect={() => (caretSet.current = true)}
          onBlur={commit}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            const el = e.currentTarget;
            const key = e.key.toLowerCase();
            if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSplit(take(), el.selectionStart);
            } else if ((e.ctrlKey || e.metaKey) && key === 'm') {
              e.preventDefault();
              if (!last) onMerge(take());
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'Delete') {
              e.preventDefault();
              onDelete();
            } else if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey && draft === null) {
              // Nothing typed since the last change: undo the list, not the box.
              e.preventDefault();
              onUndo();
            } else if (e.key === 'Escape' && draft !== null) {
              e.stopPropagation();
              setDraft(null);
            }
          }}
          className="w-full resize-none px-2.5 py-1.5 rounded-lg bg-slate-950 border border-edge text-[15px] leading-6 text-slate-100 whitespace-pre overflow-x-auto overflow-y-hidden focus:outline-none focus:border-indigo-500"
        />
        <span className="pt-[7px] font-mono text-[11px] leading-6 tabular-nums text-right" aria-label="Characters on each line">
          {lines.map((line, j) => {
            const chars = vlen(line.trim());
            const over = chars > limits.maxChars || j >= limits.maxLines;
            return (
              <span key={j} className={`block ${over ? 'text-rose-300' : 'text-slate-500'}`}>
                {chars}/{limits.maxChars}
              </span>
            );
          })}
        </span>
      </div>
    </div>
  );
}

type Filter = 'all' | 'issue' | 'edited';

export interface SubtitleEditorProps {
  cues: EditedSubtitle[];
  maxChars: number;
  maxLines: number;
  /** Measured word times the subtitles were cut on, for splits that land on a word. */
  words: WordTime[];
  activeRow: number;
  onPick: (index: number, seek: boolean) => void;
  /** Saves a new list; the caller keeps the undo history. */
  onChange: (cues: EditedSubtitle[]) => void;
  onUndo: () => void;
  canUndo: boolean;
  listRef: React.Ref<HTMLDivElement>;
}

export function SubtitleEditor({ cues, maxChars, maxLines, words, activeRow, onPick, onChange, onUndo, canUndo, listRef }: SubtitleEditorProps) {
  const [maxCps, setMaxCps] = useState(loadMaxCps);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  /** What each card has typed but not saved, by subtitle index. */
  const drafts = useRef(new Map<number, string>());
  const limits: SubtitleLimits = { maxChars, maxLines, maxCps };

  const changeMaxCps = (n: number) => {
    const next = Math.min(40, Math.max(5, n));
    setMaxCps(next);
    try {
      localStorage.setItem(MAX_CPS_KEY, String(next));
    } catch {}
  };

  const stats = useMemo(() => cues.map((cue) => subtitleStats(cue, limits)), [cues, maxChars, maxLines, maxCps]);
  const counts = {
    all: cues.length,
    issue: stats.filter((s) => s.issue).length,
    edited: cues.filter(isEditedSubtitle).length,
  };
  const q = query.trim().toLowerCase();
  const shown = cues
    .map((cue, i) => i)
    .filter((i) => (filter === 'issue' ? stats[i].issue : filter === 'edited' ? isEditedSubtitle(cues[i]) : true))
    .filter((i) => !q || cues[i].text.toLowerCase().includes(q));

  useEffect(() => {
    if (fresh === null) return;
    const t = window.setTimeout(() => setFresh(null), 1600);
    return () => window.clearTimeout(t);
  }, [fresh]);

  const replace = (i: number, count: number, ...items: EditedSubtitle[]) => {
    // Indices move with the list, so a mark or draft left on one would land on another.
    setFresh(null);
    drafts.current.clear();
    const next = [...cues];
    next.splice(i, count, ...items);
    onChange(next);
  };

  const split = (i: number, text: string, caret: number | null) => {
    const cue = { ...cues[i], text };
    const n = String(i + 1).padStart(2, '0');
    if (caret === null) return setNotice('Click in the text where the subtitle should split, then press Enter.');
    const before = wordsBeforeCaret(text, caret);
    const total = text.split(/\s+/).filter(Boolean).length;
    if (total < 2) return setNotice(`Subtitle ${n} has a single word, so there is nowhere to split it.`);
    if (before === 0 || before >= total) return setNotice('Put the cursor between two words, then press Enter.');
    const r = splitSubtitle(cue, before, limits, words);
    if (!r) return;
    replace(i, 1, r.first, r.second);
    setFresh(i + 1);
    setFocusAt(i + 1);
    onPick(i + 1, false);
    setNotice(
      r.estimated
        ? `Split ${n} after “${r.lastWord}”. ${String(i + 2).padStart(2, '0')} is a new subtitle; it has no measured word times, so its start at ${stamp(r.second.start)} is estimated.`
        : `Split ${n} after “${r.lastWord}”. ${String(i + 2).padStart(2, '0')} is a new subtitle from ${stamp(r.second.start)}, where the word is said${r.pause >= 0.25 ? ` (pause ${r.pause.toFixed(2)} s)` : ''}.`
    );
  };

  const merge = (i: number, text: string) => {
    if (i >= cues.length - 1) return;
    const below = { ...cues[i + 1], text: drafts.current.get(i + 1) ?? cues[i + 1].text };
    replace(i, 2, mergeSubtitles({ ...cues[i], text }, below, limits));
    setFocusAt(i);
    onPick(i, false);
    setNotice(`Merged ${String(i + 2).padStart(2, '0')} into ${String(i + 1).padStart(2, '0')}, wrapped again to ${maxChars} characters × ${maxLines}. Undo splits them again.`);
  };

  const chip = (on: boolean, warn = false) =>
    `h-7 px-2.5 rounded-full border text-[11.5px] font-medium tabular-nums transition-colors cursor-default ${
      on
        ? warn
          ? 'border-amber-500/60 bg-amber-500/15 text-amber-200'
          : 'border-indigo-500/60 bg-indigo-500/15 text-indigo-300'
        : 'border-edge text-slate-400 hover:text-slate-200 hover:border-slate-700'
    }`;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ['all', 'All'],
            ['issue', 'Needs attention'],
            ['edited', 'Edited'],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={chip(filter === key, key === 'issue' && counts.issue > 0)}>
            {label} {counts[key]}
          </button>
        ))}
        <span className="flex-1" />
        <span className="flex items-center h-7 rounded-lg border border-edge bg-slate-950/60 overflow-hidden text-[11.5px]" title="Subtitles faster than this are marked: characters a second">
          <button type="button" onClick={() => changeMaxCps(maxCps - 1)} className="w-6 h-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-default" aria-label="Lower the reading speed limit">
            <Minus className="w-3 h-3 mx-auto" />
          </button>
          <span className="px-1 text-slate-300 tabular-nums">≤ {maxCps} cps</span>
          <button type="button" onClick={() => changeMaxCps(maxCps + 1)} className="w-6 h-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-default" aria-label="Raise the reading speed limit">
            <Plus className="w-3 h-3 mx-auto" />
          </button>
        </span>
        <span className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find"
            aria-label="Find in subtitles"
            className="w-32 h-7 pl-7 pr-2 rounded-lg bg-slate-950/60 border border-edge text-[12px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </span>
        <button
          type="button"
          onClick={() => {
            onUndo();
            setNotice(null);
          }}
          disabled={!canUndo}
          title="Undo the last split, merge or edit (Ctrl+Z)"
          className="h-7 px-2.5 flex items-center gap-1.5 rounded-lg border border-edge hover:bg-slate-800 text-[11.5px] text-slate-300 disabled:opacity-40 disabled:pointer-events-none cursor-default"
        >
          <Undo2 className="w-3.5 h-3.5" /> Undo
        </button>
      </div>
      <p className="text-[11.5px] text-slate-400 -mt-1" aria-live="polite">
        {notice ?? 'Enter starts a new subtitle from the cursor. Shift+Enter starts a new line. Merge ↓ (Ctrl+M) joins the one below.'}
      </p>

      <div ref={listRef} className="relative flex-1 min-h-[12rem] max-h-[22rem] md:max-h-none overflow-y-auto custom-scrollbar rounded-xl border border-edge bg-slate-950/50 p-2 flex flex-col">
        {cues.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">Every subtitle was removed. Back to automatic cuts them again.</p>
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">No subtitles match.</p>
        ) : (
          shown.map((i, k) => (
            <React.Fragment key={`${i}:${cues[i].start}:${cues[i].end}`}>
            <SubtitleCard
              cue={cues[i]}
              index={i}
              last={i === cues.length - 1}
              active={i === activeRow}
              fresh={fresh === i}
              limits={limits}
              focusNow={focusAt === i}
              onFocused={() => setFocusAt(null)}
              onDraft={(text) => {
                if (text === null) drafts.current.delete(i);
                else drafts.current.set(i, text);
              }}
              onPick={(seek) => onPick(i, seek)}
              onText={(text) => replace(i, 1, { ...cues[i], text })}
              onTimes={(patch) => replace(i, 1, { ...cues[i], ...patch })}
              onSplit={(text, caret) => split(i, text, caret)}
              onMerge={(text) => merge(i, text)}
              onWrap={(text) => {
                replace(i, 1, wrapSubtitle({ ...cues[i], text }, limits));
                setNotice(`Subtitle ${String(i + 1).padStart(2, '0')} wrapped again.`);
              }}
              onDelete={() => {
                replace(i, 1);
                setNotice(`Removed subtitle ${String(i + 1).padStart(2, '0')}. Undo brings it back.`);
              }}
              onUndo={onUndo}
            />
            {k < shown.length - 1 &&
              (shown[k + 1] === i + 1 ? (
                // Merge sits between the two it joins, so it is plain which ones.
                <div className="group relative h-8 shrink-0 flex items-center justify-center">
                  <span className="absolute inset-x-3 top-1/2 border-t border-dashed border-transparent group-hover:border-slate-600 transition-colors" aria-hidden="true" />
                  {/* No preventDefault here: the box being typed in saves on blur first, wherever it is in the list. */}
                  <button
                    type="button"
                    onClick={() => merge(i, drafts.current.get(i) ?? cues[i].text)}
                    title={`Merge ${String(i + 2).padStart(2, '0')} into ${String(i + 1).padStart(2, '0')} (Ctrl+M)`}
                    aria-label={`Merge subtitle ${String(i + 2).padStart(2, '0')} into ${String(i + 1).padStart(2, '0')}`}
                    className="relative h-6 px-2.5 flex items-center gap-1 rounded-full border border-edge bg-slate-900 text-[11px] text-slate-400 hover:text-indigo-200 hover:border-indigo-500/60 hover:bg-indigo-500/15 cursor-default"
                  >
                    <ArrowDownToLine className="w-3 h-3" aria-hidden="true" />
                    Merge ↓
                  </button>
                </div>
              ) : (
                <div className="h-2 shrink-0" aria-hidden="true" />
              ))}
            </React.Fragment>
          ))
        )}
      </div>
    </>
  );
}
