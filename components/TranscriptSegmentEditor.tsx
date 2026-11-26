import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AudioWaveform, Check, ClockAlert, FoldVertical, Headphones, Pencil, RotateCcw, Trash2, Undo2, Users } from 'lucide-react';
import type { AudioSegment } from '../types';
import {
  cutNearTime,
  mergeBlocker,
  mergeSegments,
  planSplit,
  resetSegments,
  sameCuts,
  sourceOf,
  splitSegment,
  textWords,
  transcriptText,
} from '../services/transcriptSegments';
import { withSourceWords } from '../services/transcriptEdit';
import { Select } from './Select';
import { scrollWithin } from './scrollWithin';
import { useWindowRows } from './useWindowRows';

/** Seconds played either side of a cut by Hear. */
const HEAR_SECONDS = 1.5;

/** 64.25 -> "1:04.25" */
export const formatSplitTime = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(2).padStart(5, '0')}`;
};

/** "1:04.25", "64.25" or "1:04" -> seconds; NaN when it isn't a time. */
export const parseSplitTime = (value: string): number => {
  const match = value.trim().match(/^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/);
  if (!match) return NaN;
  const seconds = Number(match[2].replace(',', '.'));
  if (match[1] !== undefined && seconds >= 60) return NaN;
  return Number(match[1] ?? 0) * 60 + seconds;
};

interface PendingSplit {
  id: string | number;
  k: number;
  min: number;
  max: number;
  estimate: number;
  value: string;
  error: string | null;
  /** The time was taken from the playhead rather than guessed. */
  fromPlayhead?: boolean;
}

interface TranscriptSegmentEditorProps {
  segments: AudioSegment[];
  /** The segments as transcribed, kept from the first change; null before any. */
  transcriptCuts?: AudioSegment[] | null;
  onApply: (segments: AudioSegment[]) => void;
  onCancel: () => void;
  /** Plays the original between two times. */
  onHear?: (start: number, end: number) => void;
  formatTime: (seconds: number) => string;
  /** Where the playhead is on the original's clock, for S. */
  getPlayhead?: () => number;
  /** A split at this time, made as the editor opens (S pressed on the transcript). */
  initialSplitTime?: number | null;
}

/**
 * The transcript's one editor, before it is translated: type in a line, split
 * it between two words, join it with the next, change who speaks it, or remove
 * it. Changes are made on a copy with their own undo, and reach the project
 * only on Save, as one Undo step, so the transcript and everything after it
 * always share one cut.
 */
export const TranscriptSegmentEditor: React.FC<TranscriptSegmentEditorProps> = ({
  segments,
  transcriptCuts,
  onApply,
  onCancel,
  onHear,
  formatTime,
  getPlayhead,
  initialSplitTime = null,
}) => {
  const [draft, setDraft] = useState(segments);
  const [past, setPast] = useState<AudioSegment[][]>([]);
  const [pending, setPending] = useState<PendingSplit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  /** The line being typed in, and its text so far. */
  const [typing, setTyping] = useState<{ id: string; text: string } | null>(null);
  /** The undo depth at the first change to the words; null while only cuts changed, so the text check still applies. */
  const [wordsChangedAt, setWordsChangedAt] = useState<number | null>(null);
  /** The gap pointed at: the line above it and the one below light up together. */
  const [seamAt, setSeamAt] = useState<number | null>(null);
  const counter = useRef(0);
  /** The segment a split or S just worked on, scrolled into view so the change is seen. */
  const [shownId, setShownId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // A 2-hour transcript has thousands of segments: only those in view are drawn.
  const listRef = useRef<HTMLOListElement>(null);
  const rows = useWindowRows({
    scroller: listRef,
    count: draft.length,
    // A line of words, its padding and the line under it; a long one wraps to more.
    estimate: (i) => 25 + Math.ceil(Math.max(1, sourceOf(draft[i]).length) / 90) * 25,
    keyOf: (i) => String(draft[i].id),
    data: draft,
  });
  useEffect(() => {
    if (shownId === null) return;
    const el = rootRef.current?.querySelector(`[data-seg-id="${CSS.escape(shownId)}"]`);
    if (el) return scrollWithin(el);
    rows.scrollToRow(draft.findIndex((seg) => String(seg.id) === shownId), 'center');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownId, draft, pending]);

  const original = useMemo(() => transcriptText(segments), [segments]);
  const resetBase = transcriptCuts && transcriptCuts.length ? transcriptCuts : segments;
  const canReset = !sameCuts(resetSegments(resetBase, draft), draft);
  const changes = past.length;

  const speakers = useMemo(() => {
    const names: string[] = [];
    for (const seg of draft) {
      const name = (seg.speaker || '').trim();
      if (name && !names.includes(name)) names.push(name);
    }
    return names;
  }, [draft]);

  const commit = (next: AudioSegment[], touched: (string | number)[], message: string | null, wordsChange = false) => {
    if (wordsChange && wordsChangedAt === null) setWordsChangedAt(past.length);
    setPast((p) => [...p, draft]);
    setDraft(next);
    setPending(null);
    setNotice(message);
    setChangedIds((ids) => new Set([...ids, ...touched.map(String)]));
    if (touched.length) setShownId(String(touched[touched.length - 1]));
  };

  const newId = (base: string | number) => {
    const taken = new Set(draft.map((s) => String(s.id)));
    let id: string;
    do id = `${base}-${Date.now().toString(36)}${(counter.current++).toString(36)}`;
    while (taken.has(id));
    return id;
  };

  const doSplit = (index: number, k: number, at?: number) => {
    const seg = draft[index];
    const result = splitSegment(seg, k, newId(seg.id), at);
    if (!result) return;
    const next = [...draft];
    next.splice(index, 1, result.first, result.second);
    const n = String(index + 1).padStart(2, '0');
    const at2 = formatTime(result.first.endTime);
    const pause = result.second.startTime - result.first.endTime;
    commit(
      next,
      [result.first.id, result.second.id],
      !result.measured
        ? `Split ${n} at ${at2}, an estimated time you confirmed. It stays marked as estimated.`
        : pause >= 0.3
          ? `Split ${n} at ${at2}, where the speaker pauses ${pause.toFixed(2)} s. Timed from the audio.`
          : `Split ${n} at ${at2}, mid-phrase with no pause. Timed from the audio.`
    );
  };

  const askSplit = (index: number, k: number) => {
    const seg = draft[index];
    const plan = planSplit(seg, k);
    if (plan.kind === 'refused') {
      setNotice(
        plan.reason === 'timing'
          ? `Segment ${String(index + 1).padStart(2, '0')} has timing to check first, so it can't be split. Its text is kept as it is.`
          : 'Pick a gap between two words.'
      );
      return;
    }
    if (plan.kind === 'measured') return doSplit(index, k);
    setNotice(null);
    setPending({ id: seg.id, k, min: plan.min, max: plan.max, estimate: plan.estimate, value: formatSplitTime(plan.estimate), error: null });
  };

  /** S: splits the segment under the playhead at the word gap nearest it. */
  const splitAtTime = (time: number) => {
    const index = draft.findIndex((s) => time > s.startTime && time < s.endTime);
    if (index < 0) return setNotice('Put the playhead inside a segment to split it: click the waveform, or play to the point.');
    const k = cutNearTime(draft[index], time);
    if (k === null) return setNotice(`Segment ${String(index + 1).padStart(2, '0')} has a single word, so there is nowhere to split it.`);
    const plan = planSplit(draft[index], k);
    // No word timings: the playhead is the time to confirm, still marked as estimated.
    if (plan.kind === 'estimated') {
      const at = Math.min(plan.max, Math.max(plan.min, time));
      setNotice(null);
      setShownId(String(draft[index].id));
      return setPending({ id: draft[index].id, k, min: plan.min, max: plan.max, estimate: at, value: formatSplitTime(at), error: null, fromPlayhead: true });
    }
    askSplit(index, k);
  };

  const initialSplitDone = useRef(false);
  useEffect(() => {
    if (initialSplitDone.current || initialSplitTime === null) return;
    initialSplitDone.current = true;
    splitAtTime(initialSplitTime);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmPending = () => {
    if (!pending) return;
    const index = draft.findIndex((s) => String(s.id) === String(pending.id));
    const at = parseSplitTime(pending.value);
    if (!Number.isFinite(at)) return setPending({ ...pending, error: 'Enter a time like 1:04.25.' });
    if (at < pending.min || at > pending.max) {
      return setPending({ ...pending, error: `Pick a time between ${formatSplitTime(pending.min)} and ${formatSplitTime(pending.max)}.` });
    }
    doSplit(index, pending.k, at);
  };

  const merge = (index: number) => {
    const a = draft[index];
    const b = draft[index + 1];
    const blocked = mergeBlocker(a, b);
    if (blocked) return setNotice(`${blocked} Change one speaker first to merge them.`);
    const next = [...draft];
    next.splice(index, 2, mergeSegments(a, b));
    setSeamAt(null);
    commit(next, [a.id], `Joined ${String(index + 1).padStart(2, '0')} and ${String(index + 2).padStart(2, '0')}.`);
  };

  /** New words for a line; emptied out, the line is removed, as a line with no words can't be dubbed. */
  const saveWords = (id: string, text: string) => {
    setTyping(null);
    const index = draft.findIndex((s) => String(s.id) === id);
    if (index < 0) return;
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return remove(index);
    const seg = draft[index];
    if (clean === sourceOf(seg).replace(/\s+/g, ' ').trim()) return;
    const next = [...draft];
    next[index] = withSourceWords(seg, clean);
    commit(next, [seg.id], `Changed the words of ${String(index + 1).padStart(2, '0')}.`, true);
  };

  const remove = (index: number) => {
    const next = [...draft];
    next.splice(index, 1);
    commit(next, [], `Removed ${String(index + 1).padStart(2, '0')}. Its time is left empty.`, true);
  };

  const changeSpeaker = (index: number, speaker: string) => {
    const seg = draft[index];
    if ((seg.speaker || '').trim() === speaker) return;
    const next = [...draft];
    next[index] = { ...seg, speaker };
    commit(next, [seg.id], `${String(index + 1).padStart(2, '0')} is now ${speaker}.`);
  };

  const undo = () => {
    if (!past.length) return;
    setDraft(past[past.length - 1]);
    if (wordsChangedAt !== null && past.length - 1 <= wordsChangedAt) setWordsChangedAt(null);
    setPast((p) => p.slice(0, -1));
    setPending(null);
    setNotice('Undone.');
  };

  const reset = () => {
    const back = resetSegments(resetBase, draft);
    commit(back, [], 'Back to the lines from transcription. Save to keep it.', transcriptText(back) !== original);
    setChangedIds(new Set());
  };

  const apply = () => {
    if (!changes) return onCancel();
    // With only splits and joins, only whitespace at the new boundaries may differ; anything else is refused.
    if (wordsChangedAt === null && transcriptText(draft) !== original) {
      setNotice("These changes would alter the transcript's text, so they weren't applied.");
      return;
    }
    onApply(draft);
  };

  const cancel = () => {
    if (changes && !window.confirm(`Discard ${changes} transcript ${changes === 1 ? 'change' : 'changes'}?`)) return;
    onCancel();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (getPlayhead && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        splitAtTime(getPlayhead());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toolButton =
    'h-7 px-2 flex items-center gap-1 rounded-lg border border-edge hover:bg-slate-800 text-[11.5px] text-slate-200 disabled:opacity-40 disabled:hover:bg-transparent cursor-default';

  return (
    <div ref={rootRef} className="flex-1 min-h-0 flex flex-col">
      <div className="shrink-0 flex items-center gap-2 px-4 h-12 border-b border-indigo-500/40 bg-indigo-500/[0.08] whitespace-nowrap">
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-indigo-200">
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          Editing
        </span>
        <span
          className="min-w-0 truncate text-[11.5px] text-slate-400"
          title={`Double-click a line to type in it. Click between two words to split${getPlayhead ? ', or press S at the playhead' : ''}. Point between two lines to join them.`}
        >
          Double-click to type · click between words to split{getPlayhead ? ' (or S)' : ''} · point between two lines to join
        </span>
        <span className="ml-auto text-[11.5px] text-slate-400 tabular-nums">
          {draft.length} lines{changes ? ` · ${changes} ${changes === 1 ? 'change' : 'changes'}` : ''}
        </span>
        <button type="button" onClick={undo} disabled={!changes} className={toolButton} title="Undo (Ctrl Z)">
          <Undo2 className="w-3.5 h-3.5" />
          Undo
        </button>
        <button type="button" onClick={reset} disabled={!canReset} className={toolButton} title="Back to the lines from transcription">
          <RotateCcw className="w-3.5 h-3.5" />
          Reset
        </button>
        <button type="button" onClick={cancel} className="h-7 px-2.5 rounded-lg border border-edge text-[11.5px] text-slate-300 hover:bg-slate-800 cursor-default">
          Cancel
        </button>
        <button
          type="button"
          onClick={apply}
          className="h-7 px-3 flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-[11.5px] font-semibold text-white cursor-default"
          title="Keeps every change as one Undo step"
        >
          <Check className="w-3.5 h-3.5" />
          {changes ? 'Save changes' : 'Done'}
        </button>
      </div>
      <ol ref={listRef} aria-label="Segments" className="relative flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar">
        <li ref={rows.spacerRef} aria-hidden="true" style={{ height: rows.padTop }} />
        {draft.slice(rows.start, rows.end).map((seg, k) => {
          const i = rows.start + k;
          const words = textWords(sourceOf(seg));
          const changed = changedIds.has(String(seg.id));
          const estimated = seg.timingSource === 'derived';
          const n = String(i + 1).padStart(2, '0');
          const isPending = pending && String(pending.id) === String(seg.id);
          const paired = seamAt !== null && (i === seamAt || i === seamAt + 1);
          const isTyping = typing !== null && typing.id === String(seg.id);
          const prev = i > 0 ? draft[i - 1] : null;
          const blocked = prev ? mergeBlocker(prev, seg) : null;
          const prevN = String(i).padStart(2, '0');
          return (
            // One item a line, its Join with the one above on its top edge and its split time under it, so the list can measure it.
            <li key={seg.id} ref={rows.rowRef(i)} data-seg-id={String(seg.id)} className="relative">
              {prev && (
                <div
                  className="group/seam absolute inset-x-0 -top-2 h-4 z-10"
                  onMouseEnter={() => !blocked && setSeamAt(i - 1)}
                  onMouseLeave={() => setSeamAt((at) => (at === i - 1 ? null : at))}
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-[5px] -ml-[3px] w-1.5 h-1.5 rounded-full bg-slate-700 group-hover/seam:opacity-0 group-focus-within/seam:opacity-0"
                  />
                  <span
                    aria-hidden="true"
                    className={`absolute left-4 right-4 top-[7px] h-0.5 rounded-full opacity-0 group-hover/seam:opacity-100 group-focus-within/seam:opacity-100 ${blocked ? 'bg-slate-700' : 'bg-indigo-400'}`}
                  />
                  {blocked ? (
                    <span className="absolute left-1/2 -translate-x-1/2 -top-1 h-6 px-2.5 flex items-center gap-1.5 rounded-full border border-edge bg-slate-900 text-[11px] text-slate-400 whitespace-nowrap opacity-0 group-hover/seam:opacity-100 pointer-events-none">
                      <Users className="w-3 h-3" aria-hidden="true" />
                      Different speakers — change one to join
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => merge(i - 1)}
                      onFocus={() => setSeamAt(i - 1)}
                      onBlur={() => setSeamAt((at) => (at === i - 1 ? null : at))}
                      aria-label={`Join ${prevN} and ${n}`}
                      className="absolute left-1/2 -translate-x-1/2 -top-1 h-6 px-3 flex items-center gap-1.5 rounded-full bg-indigo-500 hover:bg-indigo-400 text-white text-[11.5px] font-semibold whitespace-nowrap shadow-lg shadow-black/50 opacity-0 group-hover/seam:opacity-100 focus-visible:opacity-100 focus-visible:outline-none cursor-default"
                    >
                      <FoldVertical className="w-3.5 h-3.5" aria-hidden="true" />
                      Join {prevN} + {n}
                      <span className="font-mono font-normal text-[10.5px] text-indigo-100/80 tabular-nums">
                        {formatTime(prev.startTime)}–{formatTime(seg.endTime)}
                      </span>
                    </button>
                  )}
                </div>
              )}
                <div
                  className={`group grid grid-cols-[2rem_7.5rem_minmax(0,1fr)_auto] gap-2.5 items-baseline px-4 py-3 border-b border-edge/70 transition-colors ${
                    paired ? 'bg-indigo-500/10 shadow-[inset_3px_0_0_#7b86ec]' : changed ? 'bg-indigo-500/[0.07]' : ''
                  }`}
                >
                  <span className="font-mono text-[11px] text-slate-500 tabular-nums">{n}</span>
                  <span className={`font-mono text-[11px] tabular-nums ${estimated ? 'text-amber-300' : 'text-slate-400'}`}>
                    {formatTime(seg.startTime)}–{formatTime(seg.endTime)}
                    {estimated && <span className="block text-[9.5px] font-sans font-semibold text-amber-300/80">estimated</span>}
                  </span>
                  {isTyping ? (
                    <textarea
                      autoFocus
                      rows={Math.max(1, Math.ceil(typing!.text.length / 80))}
                      value={typing!.text}
                      aria-label={`Words of ${n}`}
                      onChange={(e) => setTyping({ id: String(seg.id), text: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          saveWords(String(seg.id), typing!.text);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setTyping(null);
                        }
                      }}
                      onBlur={() => saveWords(String(seg.id), typing!.text)}
                      className="w-full resize-none bg-slate-950 border border-indigo-500 rounded-lg px-2 py-1 text-[13px] leading-[1.7] text-slate-100 focus:outline-none"
                    />
                  ) : (
                    <span
                      className="text-[13px] leading-[1.9] text-slate-200 break-words"
                      onDoubleClick={(e) => {
                        if ((e.target as HTMLElement).closest('button, select')) return;
                        setTyping({ id: String(seg.id), text: sourceOf(seg) });
                      }}
                    >
                      {speakers.length > 1 && (
                        <span className="inline-block align-middle mr-2 w-[7.5rem]">
                          <Select
                            value={(seg.speaker || '').trim()}
                            onChange={(v) => changeSpeaker(i, v)}
                            ariaLabel={`Who speaks ${n}`}
                            size="sm"
                            className="w-full"
                            placeholder="No speaker"
                            options={speakers.map((name) => ({ value: name, label: name }))}
                          />
                        </span>
                      )}
                      {words.length === 0 ? (
                        <span className="italic text-slate-600">No speech</span>
                      ) : (
                        words.map((w, k) => (
                          <React.Fragment key={k}>
                            {k > 0 && (
                              <button
                                type="button"
                                onClick={() => askSplit(i, k)}
                                aria-label={`Split ${n} before “${w.text}”`}
                                title="Split here"
                                // Holds the space itself, so the text reads and copies as written.
                                className={`whitespace-pre px-px rounded-[3px] cursor-col-resize focus:outline-none hover:bg-indigo-500/55 focus-visible:bg-indigo-500/55 ${
                                  isPending && pending!.k === k ? 'bg-amber-400/70' : ''
                                }`}
                              >
                                {' '}
                              </button>
                            )}
                            {w.text}
                          </React.Fragment>
                        ))
                      )}
                    </span>
                  )}
                  <span className="self-center flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                    {onHear && (
                      <button
                        type="button"
                        onClick={() => onHear(seg.startTime, seg.endTime)}
                        title="Hear this line"
                        aria-label={`Hear ${n}`}
                        className="w-7 h-7 grid place-items-center rounded-md text-slate-500 hover:text-slate-100 hover:bg-slate-800 cursor-default"
                      >
                        <Headphones className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setTyping({ id: String(seg.id), text: sourceOf(seg) })}
                      title="Type in this line"
                      aria-label={`Type in ${n}`}
                      className="w-7 h-7 grid place-items-center rounded-md text-slate-500 hover:text-slate-100 hover:bg-slate-800 cursor-default"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      title="Remove this line. Its time is left empty."
                      aria-label={`Remove ${n}`}
                      className="w-7 h-7 grid place-items-center rounded-md text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 cursor-default"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
              {isPending && (
                <div className="px-4 py-3 border-b border-amber-500/30 bg-amber-500/[0.07]">
                  <div className="sm:ml-[10.75rem] flex flex-col gap-2">
                    <div className="flex items-center gap-2 text-[12.5px] font-semibold text-amber-200">
                      <ClockAlert className="w-4 h-4" aria-hidden="true" />
                      Segment {n} has no word timings that match its text
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="split-at" className="text-[12px] text-slate-300">
                        Split at
                      </label>
                      <input
                        id="split-at"
                        autoFocus
                        value={pending!.value}
                        aria-invalid={Boolean(pending!.error)}
                        aria-describedby="split-at-help"
                        onChange={(e) => setPending({ ...pending!, value: e.target.value, error: null })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') confirmPending();
                          if (e.key === 'Escape') setPending(null);
                        }}
                        className="w-24 h-8 px-2 rounded-lg bg-slate-950 border border-amber-500/40 focus:border-amber-400 outline-none font-mono text-[12px] text-slate-100"
                      />
                      <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">Estimated</span>
                      {onHear && (
                        <button
                          type="button"
                          onClick={() => {
                            const at = parseSplitTime(pending!.value);
                            const t = Number.isFinite(at) ? at : pending!.estimate;
                            onHear(Math.max(seg.startTime, t - HEAR_SECONDS), Math.min(seg.endTime, t + HEAR_SECONDS));
                          }}
                          className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-[12px] text-slate-200 cursor-default"
                        >
                          <Headphones className="w-3.5 h-3.5" />
                          Hear
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={confirmPending}
                        className="h-8 px-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 text-[12px] font-semibold cursor-default"
                      >
                        Use this time
                      </button>
                      <button type="button" onClick={() => setPending(null)} className="h-8 px-2 text-[12px] text-slate-400 hover:text-slate-100 cursor-default">
                        Cancel
                      </button>
                    </div>
                    {pending!.error ? (
                      <p id="split-at-help" className="text-[11.5px] text-rose-300">
                        {pending!.error}
                      </p>
                    ) : (
                      <p id="split-at-help" className="text-[11.5px] text-slate-400 leading-snug">
                        {pending!.fromPlayhead ? 'Taken from the playhead' : 'Guessed from word lengths'}, between {formatSplitTime(pending!.min)} and{' '}
                        {formatSplitTime(pending!.max)}. Listen and adjust before you use it. It stays marked as estimated.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
        <li aria-hidden="true" style={{ height: rows.padBottom }} />
      </ol>

      {notice && (
        <div role="status" className="flex items-center gap-2 px-4 py-2.5 border-t border-edge bg-slate-950/60 text-[12px] text-slate-300">
          <AudioWaveform className="w-4 h-4 text-cyan-300 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{notice}</span>
        </div>
      )}
    </div>
  );
};
