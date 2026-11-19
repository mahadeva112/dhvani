import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, CircleHelp, Scissors, Trash2, WrapText } from 'lucide-react';
import { PhoneticSpellings } from './review/PhoneticTextarea';
import { usePhoneticSwitch, usePhoneticTyping } from './review/usePhoneticTyping';
import { findIndicLanguageConfig } from '../services/indicTransliteration';
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
import { useWindowRows } from './useWindowRows';

/*
 * Export subtitles, edited by hand: one table row per subtitle, as tall as
 * its lines. Split, merge and wrap work the way Srutilekha's review editor
 * does: Enter splits where the cursor is, Shift+Enter starts a new line,
 * Ctrl+M merges with the next, and both halves of a split are wrapped again.
 */

/** Pixel height of one subtitle line in a card's text box. */
const LINE_PX = 24;

const MAX_CPS_KEY = 'dhvani_subtitle_max_cps';

/** The reading speed limit subtitles are marked against, kept for every project. */
export const loadMaxCps = () => {
  try {
    const n = Number(localStorage.getItem(MAX_CPS_KEY));
    if (Number.isFinite(n) && n >= 5 && n <= 40) return n;
  } catch {}
  return DEFAULT_MAX_CPS;
};

export const saveMaxCps = (n: number) => {
  const next = Math.min(40, Math.max(5, Math.round(n)));
  try {
    localStorage.setItem(MAX_CPS_KEY, String(next));
  } catch {}
  return next;
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
      title={bad ? 'Not a time that fits here. Type it as 00:01:02,500 or 62.5' : `${label} ${stamp(value)}`}
      value={draft ?? stamp(value).replace(/^00:/, '')}
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
      className={`w-full h-6 px-1 rounded-md border font-mono text-[11px] tabular-nums text-slate-300 focus:outline-none focus:bg-slate-950 focus:border-indigo-500 ${
        bad ? 'border-rose-500 bg-slate-950' : 'border-transparent bg-transparent hover:border-slate-700'
      }`}
    />
  );
};

/** The row's columns, shared by the header so they line up. */
const ROW_GRID = 'grid grid-cols-[1.5rem_4.6rem_4.6rem_minmax(0,1fr)_2.6rem_2.2rem_6rem] gap-x-1.5';

const iconButton =
  'w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-default';

interface CardProps {
  cue: EditedSubtitle;
  index: number;
  last: boolean;
  active: boolean;
  /** Just made by a split: marked "new" for a moment. */
  fresh: boolean;
  limits: SubtitleLimits;
  /** The subtitles' language: Roman letters typed become its script (Ctrl+G turns it off). */
  language: string;
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
  onRedo: () => void;
  /** Lets the list measure the row (only the rows in view are drawn). */
  rowRef?: (el: HTMLDivElement | null) => void;
}

function SubtitleCard({
  cue,
  index,
  last,
  active,
  fresh,
  limits,
  language,
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
  onRedo,
  rowRef,
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
  const phonetic = usePhoneticTyping(language);
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
  const flags = [
    stats.overLines && `${lines.length} lines, over ${limits.maxLines}`,
    stats.longLine && `a line over ${limits.maxChars} characters`,
    stats.overCps && `faster than ${limits.maxCps} characters a second`,
    cue.estimated && 'time estimated: split with no measured word times, so the cut is shared out by word length',
  ].filter(Boolean);

  // One row a subtitle, like a subtitle editor's table: # · In · Out · text · characters · cps · tools.
  return (
    <div
      ref={rowRef}
      data-start={cue.start}
      data-end={cue.end}
      onClick={() => onPick(true)}
      className={`group ${ROW_GRID} items-start px-1.5 py-[3px] border-b border-slate-800/80 cursor-default transition-[background-color,box-shadow] duration-700 ${
        fresh ? 'ring-2 ring-inset ring-indigo-400/70' : ''
      } ${active ? 'bg-indigo-500/[0.10] shadow-[inset_2px_0_0_#818cf8]' : 'hover:bg-slate-800/40'} ${text.trim() ? '' : 'opacity-50'}`}
    >
      <span
        className={`pt-1 font-mono text-[10.5px] leading-6 tabular-nums ${stats.issue ? 'text-amber-300' : active ? 'text-indigo-300' : 'text-slate-500'}`}
        title={flags.length ? `Needs attention: ${flags.join('; ')}` : fresh ? 'New subtitle' : undefined}
      >
        {n}
        {cue.estimated && <span className="text-slate-500" aria-label="time estimated">~</span>}
      </span>
      <span className="pt-[3px]">
        <StampField
          value={cue.start}
          label={`Subtitle ${n} start`}
          onCommit={(start) => {
            if (start >= cue.end) return false;
            onTimes({ start });
            return true;
          }}
        />
      </span>
      <span className="pt-[3px]">
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
      <textarea
        ref={ta}
        aria-label={`Subtitle ${n} text`}
        spellCheck={false}
        wrap="off"
        rows={lines.length}
        value={text}
        style={{ height: lines.length * LINE_PX + 8 }}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => onPick(false)}
        onSelect={() => (caretSet.current = true)}
        onBlur={() => {
          phonetic.dismiss();
          commit();
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyUp={(e) => phonetic.onKeyUp(e)}
        onKeyDown={(e) => {
          const el = e.currentTarget;
          const key = e.key.toLowerCase();
          const plainEnter = e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && !e.nativeEvent.isComposing;
          // Enter splits here, so the word before it is put in the script first, not ended with a new line.
          if (!plainEnter && phonetic.onKeyDown(e, setDraft)) {
            // Esc closes the spellings, not the window.
            if (e.key === 'Escape') e.stopPropagation();
            return;
          }
          if (plainEnter) {
            e.preventDefault();
            const done = phonetic.finishWord(el);
            if (done) {
              setDraft(null);
              onSplit(done.value, done.caret);
            } else onSplit(take(), el.selectionStart);
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
          } else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey)) && draft === null) {
            e.preventDefault();
            onRedo();
          } else if (e.key === 'Escape' && draft !== null) {
            e.stopPropagation();
            setDraft(null);
          }
        }}
        className="w-full min-w-0 resize-none px-2 py-[3px] rounded-md bg-transparent border border-transparent hover:border-slate-700 text-[15px] leading-6 text-slate-100 whitespace-pre overflow-x-auto overflow-y-hidden [scrollbar-width:none] focus:outline-none focus:bg-slate-950 focus:border-indigo-500"
      />
      <span className="pt-1 font-mono text-[10.5px] leading-6 tabular-nums text-right" aria-label="Characters on each line">
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
      <span className={`pt-1 text-[11px] leading-6 tabular-nums text-right ${cpsColour}`} title={`${stats.cps.toFixed(1)} characters a second`}>
        {Math.round(stats.cps)}
      </span>
      {/* Tools keep their place, shown on the picked row or under the mouse, so nothing moves. */}
      <span
        className={`pt-[3px] flex items-center transition-opacity ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}
        onClick={(e) => e.stopPropagation()}
      >
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
          onClick={() => onMerge(take())}
          disabled={last}
          className={`${iconButton} text-indigo-300 disabled:opacity-30 disabled:pointer-events-none`}
          title={`Merge ${String(index + 2).padStart(2, '0')} into ${n} (Ctrl+M)`}
          aria-label={`Merge subtitle ${String(index + 2).padStart(2, '0')} into ${n}`}
        >
          <ArrowDownToLine className="w-3.5 h-3.5" />
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
      <PhoneticSpellings phonetic={phonetic} area={ta} onChange={setDraft} lang={language} />
    </div>
  );
}

type Filter = 'all' | 'issue' | 'edited';

/** A row's key: a subtitle split, merged or retimed is a new row. */
const rowKey = (cue: EditedSubtitle | undefined, i: number) => `${i}:${cue?.start}:${cue?.end}`;

export interface SubtitleEditorProps {
  cues: EditedSubtitle[];
  maxChars: number;
  maxLines: number;
  /** Reading speed limit, characters a second: faster subtitles are marked. Set in the settings panel. */
  maxCps: number;
  /** The subtitles' language: Roman letters typed in a card become its script. */
  language?: string;
  /** Measured word times the subtitles were cut on, for splits that land on a word. */
  words: WordTime[];
  activeRow: number;
  onPick: (index: number, seek: boolean) => void;
  /** Saves a new list; the caller keeps the undo history. */
  onChange: (cues: EditedSubtitle[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  listRef: React.Ref<HTMLDivElement>;
}

export function SubtitleEditor({ cues, maxChars, maxLines, maxCps, language = '', words, activeRow, onPick, onChange, onUndo, onRedo, listRef }: SubtitleEditorProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);
  /** What each card has typed but not saved, by subtitle index. */
  const drafts = useRef(new Map<number, string>());
  const limits: SubtitleLimits = { maxChars, maxLines, maxCps };
  const phoneticOn = usePhoneticSwitch();
  /** English subtitles have no script to type into, so the switch is not shown. */
  const canPhonetic = !!findIndicLanguageConfig(language);


  const stats = useMemo(() => cues.map((cue) => subtitleStats(cue, limits)), [cues, maxChars, maxLines, maxCps]);
  const counts = {
    all: cues.length,
    issue: stats.filter((s) => s.issue).length,
    edited: cues.filter(isEditedSubtitle).length,
  };
  const shown = useMemo(
    () => cues.map((cue, i) => i).filter((i) => (filter === 'issue' ? stats[i].issue : filter === 'edited' ? isEditedSubtitle(cues[i]) : true)),
    [cues, stats, filter]
  );

  // A 2-hour project has thousands of subtitles: only those in view are drawn.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setListEl = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      if (typeof listRef === 'function') listRef(el);
      else if (listRef) (listRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [listRef]
  );
  const rows = useWindowRows({
    scroller: scrollRef,
    count: shown.length,
    // A row is as tall as its text box: its lines, plus padding and the line under it.
    estimate: (p) => Math.max(1, cues[shown[p]]?.text.split('\n').length ?? 1) * LINE_PX + 15,
    keyOf: (p) => rowKey(cues[shown[p]], shown[p]),
    data: shown,
  });
  // The subtitle being heard or picked, when it is not drawn, is scrolled to; one drawn is kept in view by the window.
  useEffect(() => {
    const p = shown.indexOf(activeRow);
    if (p >= 0 && !rows.isDrawn(p)) rows.scrollToRow(p, 'center');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRow]);
  useEffect(() => {
    if (focusAt === null) return;
    const p = shown.indexOf(focusAt);
    if (p >= 0 && !rows.isDrawn(p)) rows.scrollToRow(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAt]);

  const [showHelp, setShowHelp] = useState(false);
  const helpRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!showHelp) return;
    const away = (e: MouseEvent) => {
      if (!helpRef.current?.contains(e.target as Node)) setShowHelp(false);
    };
    // Esc closes the shortcuts, not the window.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setShowHelp(false);
    };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('keydown', esc, true);
    };
  }, [showHelp]);

  // Undo and redo from anywhere in the window; a text or time box being typed in keeps its own.
  const keys = useRef({ onUndo, onRedo });
  keys.current = { onUndo, onRedo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        keys.current.onUndo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        keys.current.onRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      {/* Filters only when there is something to filter; Undo, Redo and phonetic typing are keys, so no buttons. */}
      {(counts.issue > 0 || counts.edited > 0 || filter !== 'all') && (
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', 'All'],
              ['issue', 'Needs attention'],
              ['edited', 'Edited'],
            ] as [Filter, string][]
          )
            .filter(([key]) => key === 'all' || key === filter || counts[key] > 0)
            .map(([key, label]) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={chip(filter === key, key === 'issue' && counts.issue > 0)}>
                {label} {counts[key]}
              </button>
            ))}
        </div>
      )}
      {/* What a split, merge or removal did; the keys live behind the ? in the list header. */}
      <p className="text-[11px] text-slate-400 -mt-1 empty:hidden" aria-live="polite">
        {notice}
      </p>

      <div ref={setListEl} className="relative flex-1 min-h-[12rem] max-h-[22rem] md:max-h-none overflow-y-auto custom-scrollbar rounded-xl border border-edge bg-slate-950/50 flex flex-col">
        {cues.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">Every subtitle was removed. Back to automatic cuts them again.</p>
        ) : shown.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">No subtitles match.</p>
        ) : (
          <>
          <div className={`${ROW_GRID} sticky top-0 z-10 items-center px-1.5 py-0.5 border-b border-slate-800 bg-slate-950/95 text-[10px] uppercase tracking-wide text-slate-500`}>
            <span aria-hidden="true">#</span>
            <span className="px-1" aria-hidden="true">In</span>
            <span className="px-1" aria-hidden="true">Out</span>
            <span className="px-2" aria-hidden="true">Text</span>
            <span className="text-right" aria-hidden="true">Chars</span>
            <span className="text-right" aria-hidden="true">cps</span>
            {/* The keys, out of the way until asked for */}
            <span ref={helpRef} className="relative flex justify-end normal-case tracking-normal">
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                aria-expanded={showHelp}
                aria-haspopup="dialog"
                aria-label="Keyboard shortcuts"
                title="Keyboard shortcuts"
                className={`w-6 h-6 inline-flex items-center justify-center rounded-md cursor-default ${
                  showHelp ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <CircleHelp className="w-3.5 h-3.5" />
              </button>
              {showHelp && (
                <div
                  role="dialog"
                  aria-label="Keyboard shortcuts"
                  className="absolute right-0 top-full mt-1 z-30 w-64 p-3 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 text-[11.5px] text-slate-300 grid gap-1.5"
                >
                  {(
                    [
                      [['Enter'], 'Split at the cursor'],
                      [['Shift', 'Enter'], 'New line'],
                      [['Ctrl', 'M'], 'Merge the one below'],
                      [['Ctrl', 'Del'], 'Remove the subtitle'],
                      [['Ctrl', 'Z'], 'Undo'],
                      [['Ctrl', 'Y'], 'Redo'],
                      ...(canPhonetic
                        ? ([
                            [['Ctrl', 'G'], `Phonetic typing ${phoneticOn ? 'on' : 'off'}`],
                            [['1–5'], 'Pick a spelling'],
                          ] as [string[], string][])
                        : []),
                    ] as [string[], string][]
                  ).map(([keys, label]) => (
                    <span key={label} className="flex items-center gap-1.5">
                      {keys.map((k) => (
                        <kbd key={k} className="font-mono text-[10px] px-1.5 rounded border border-slate-700 text-slate-400">
                          {k}
                        </kbd>
                      ))}
                      {label}
                    </span>
                  ))}
                </div>
              )}
            </span>
          </div>
          <div ref={rows.spacerRef} aria-hidden="true" className="shrink-0" style={{ height: rows.padTop }} />
          {shown.slice(rows.start, rows.end).map((i, k) => (
            <React.Fragment key={rowKey(cues[i], i)}>
            <SubtitleCard
              rowRef={rows.rowRef(rows.start + k)}
              cue={cues[i]}
              index={i}
              last={i === cues.length - 1}
              active={i === activeRow}
              fresh={fresh === i}
              limits={limits}
              language={language}
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
              onRedo={onRedo}
            />
            </React.Fragment>
          ))}
          <div aria-hidden="true" className="shrink-0" style={{ height: rows.padBottom }} />
          </>
        )}
      </div>
    </>
  );
}
