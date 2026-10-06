import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Combine, Headphones, Languages, Loader2, Scissors, Undo2, X } from 'lucide-react';
import { AudioSegment } from '../../types';
import {
  PAUSE_SECONDS,
  cueTokens,
  joinCues,
  moveCut,
  moveDubBreak,
  nearestCut,
  splitCue,
  targetTextOf,
} from '../../services/cueEdit';

/** Seconds played either side of a cut by Hear. */
const HEAR_SECONDS = 1.2;
/** Structure edits that can be undone. */
const UNDO_LIMIT = 30;

const isTyping = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  return Boolean(node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT' || node.isContentEditable));
};

const seconds = (s: number) => `${s.toFixed(2)} s`;

interface CueEditingOptions {
  /** Off outside the Review editor, so the keys do nothing there. */
  enabled: boolean;
  segments: AudioSegment[];
  onReplaceSegments: (segments: AudioSegment[]) => void;
  /** Where the playhead is on the original's clock. */
  getPlayhead: () => number;
  /** Plays the original between two times. */
  onHear: (start: number, end: number) => void;
  /** Translates the given cues on their own; omitted hides Re-translate. */
  retranslate?: (cues: AudioSegment[]) => Promise<{ segments: AudioSegment[]; untranslatedCueIds: string[] }>;
}

export interface CueEditing {
  /** The word the next split starts the second cue with, picked in the Original text. */
  caret: { id: string | number; k: number } | null;
  pickWord: (id: string | number, k: number) => void;
  /** The cue left of the cut being worked on. */
  boundaryId: string | number | null;
  selectBoundary: (id: string | number | null) => void;
  splitAtCaret: () => void;
  splitAtPlayhead: () => void;
  /** Splits a cue at the caret when it's in that cue, else at the playhead when that's in it. */
  splitCueHere: (id: string | number) => void;
  join: (id: string | number) => void;
  nudge: (direction: -1 | 1) => void;
  setDubBreak: (k: number) => void;
  retranslateHalves: () => void;
  canRetranslate: boolean;
  retranslating: boolean;
  hear: () => void;
  undo: () => void;
  canUndo: boolean;
  notice: string | null;
  clear: () => void;
}

/**
 * Split, join and cut adjustments for the Review step, with their own undo.
 * Text edits keep the browser's undo; this one only steps back structure
 * changes, and only while nothing else has changed the cues since.
 */
export function useCueEditing({ enabled, segments, onReplaceSegments, getPlayhead, onHear, retranslate }: CueEditingOptions): CueEditing {
  const [caret, setCaret] = useState<CueEditing['caret']>(null);
  const [boundaryId, setBoundaryId] = useState<string | number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [retranslating, setRetranslating] = useState(false);
  const history = useRef<{ before: AudioSegment[]; after: AudioSegment[]; boundary: string | number | null }[]>([]);
  const latest = useRef(segments);
  latest.current = segments;

  const indexOf = (id: string | number | null) => (id === null ? -1 : segments.findIndex((seg) => String(seg.id) === String(id)));
  const boundaryIndex = indexOf(boundaryId);
  const hasBoundary = boundaryIndex >= 0 && boundaryIndex < segments.length - 1;

  const commit = (next: AudioSegment[], boundary: string | number | null) => {
    history.current.push({ before: segments, after: next, boundary: boundaryId });
    if (history.current.length > UNDO_LIMIT) history.current.shift();
    onReplaceSegments(next);
    setBoundaryId(boundary);
    setCaret(null);
  };

  const splitAt = (id: string | number, k: number) => {
    const i = indexOf(id);
    if (i < 0) return;
    const result = splitCue(segments[i], k, `${segments[i].id}-${Date.now().toString(36)}`);
    if (!result) {
      setNotice('Pick a word after the first one: the cue is split before it.');
      return;
    }
    const next = [...segments];
    next.splice(i, 1, result.first, result.second);
    commit(next, result.first.id);
    const n = i + 1;
    const check = result.clean ? '' : ' Check where the dub text broke.';
    setNotice(
      !result.measured
        ? `Split #${n}. This cue has no word timings, so the cut's time is estimated from word lengths.${check}`
        : result.pause >= PAUSE_SECONDS
          ? `Split #${n} where the speaker pauses ${seconds(result.pause)}.${check}`
          : `Split #${n} mid-phrase, with no pause: Sync still voices both cues as one line.${check}`
    );
  };

  const splitAtPlayhead = () => {
    const t = getPlayhead();
    const seg = segments.find((s) => t > s.startTime && t < s.endTime);
    if (!seg) {
      setNotice('Put the playhead inside a cue to split it, or click a word in the Original text.');
      return;
    }
    const { tokens } = cueTokens(seg);
    if (tokens.length < 2) {
      setNotice('This cue has a single word, so there is nowhere to split it.');
      return;
    }
    splitAt(seg.id, nearestCut(tokens, t));
  };

  const splitAtCaret = () => {
    if (caret) splitAt(caret.id, caret.k);
  };

  const splitCueHere = (id: string | number) => {
    if (caret && String(caret.id) === String(id)) return splitAt(id, caret.k);
    const seg = segments[indexOf(id)];
    const t = getPlayhead();
    if (seg && t > seg.startTime && t < seg.endTime) return splitAtPlayhead();
    setNotice('Click the word the second cue should start with, or play to the point and press S.');
  };

  const join = (id: string | number) => {
    const i = indexOf(id);
    if (i < 0 || i >= segments.length - 1) return;
    const next = [...segments];
    next.splice(i, 2, joinCues(segments[i], segments[i + 1]));
    commit(next, null);
    setNotice(`Joined #${i + 1} and #${i + 2}.`);
  };

  const nudge = (direction: -1 | 1) => {
    if (!hasBoundary) return;
    const a = segments[boundaryIndex];
    const b = segments[boundaryIndex + 1];
    const moved = moveCut(a, b, cueTokens(a).tokens.length + direction);
    if (!moved) return;
    const next = [...segments];
    next.splice(boundaryIndex, 2, ...moved);
    commit(next, a.id);
    setNotice(`Cut moved one word ${direction < 0 ? 'left' : 'right'}. Each cue kept its dub text.`);
  };

  const setDubBreak = (k: number) => {
    if (!hasBoundary) return;
    const next = [...segments];
    next.splice(boundaryIndex, 2, ...moveDubBreak(segments[boundaryIndex], segments[boundaryIndex + 1], k));
    commit(next, segments[boundaryIndex].id);
    setNotice(null);
  };

  const retranslateHalves = async () => {
    if (!hasBoundary || !retranslate || retranslating) return;
    const pair = [segments[boundaryIndex], segments[boundaryIndex + 1]];
    setRetranslating(true);
    setNotice('Translating each half on its own…');
    try {
      const { segments: done, untranslatedCueIds } = await retranslate(pair);
      if (untranslatedCueIds.length === pair.length) {
        setNotice('The translation came back empty. The dub text is as it was.');
        return;
      }
      const byId = new Map(done.map((seg) => [String(seg.id), seg]));
      // Applied to the cues as they are now, in case anything changed while it ran.
      const current = latest.current;
      const next = current.map((seg) => {
        const fresh = byId.get(String(seg.id));
        return fresh ? { ...seg, textTarget: targetTextOf(fresh), targetText: targetTextOf(fresh) } : seg;
      });
      history.current.push({ before: current, after: next, boundary: pair[0].id });
      onReplaceSegments(next);
      setNotice('Both halves re-translated.');
    } catch (err: any) {
      setNotice(`Couldn't re-translate: ${err?.message || err}. The dub text is as it was.`);
    } finally {
      setRetranslating(false);
    }
  };

  const hear = () => {
    if (!hasBoundary) return;
    const cut = (segments[boundaryIndex].endTime + segments[boundaryIndex + 1].startTime) / 2;
    onHear(Math.max(0, cut - HEAR_SECONDS), cut + HEAR_SECONDS);
  };

  const last = history.current[history.current.length - 1];
  const canUndo = Boolean(last && last.after === segments);
  const undo = () => {
    const step = history.current[history.current.length - 1];
    if (!step || step.after !== latest.current) return;
    history.current.pop();
    onReplaceSegments(step.before);
    setBoundaryId(step.boundary);
    setCaret(null);
    setNotice('Undone.');
  };

  const clear = useCallback(() => {
    setCaret(null);
    setBoundaryId(null);
    setNotice(null);
  }, []);

  const pickWord = (id: string | number, k: number) => {
    setCaret({ id, k });
    setNotice(k === 0 ? 'That is the first word. Pick a later one to split before it.' : null);
  };

  const editing: CueEditing = {
    caret,
    pickWord,
    boundaryId: hasBoundary ? boundaryId : null,
    selectBoundary: (id) => {
      setBoundaryId(id);
      setNotice(null);
    },
    splitAtCaret,
    splitAtPlayhead,
    splitCueHere,
    join,
    nudge,
    setDubBreak,
    retranslateHalves,
    canRetranslate: Boolean(retranslate),
    retranslating,
    hear,
    undo,
    canUndo,
    notice,
    clear,
  };

  // The keys read the latest state through a ref, so the listener is added once.
  const keys = useRef(editing);
  keys.current = editing;
  const getPlayheadRef = useRef(getPlayhead);
  getPlayheadRef.current = getPlayhead;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const ed = keys.current;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && key === 'z') {
        if (!ed.canUndo) return;
        ed.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (!ed.caret) return;
        ed.splitAtCaret();
      } else if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (ed.boundaryId === null) return;
        ed.nudge(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      } else if (key === 's') {
        if (ed.caret) ed.splitAtCaret();
        else ed.splitAtPlayhead();
      } else if (key === 'm') {
        if (ed.boundaryId !== null) ed.join(ed.boundaryId);
        else {
          const t = getPlayheadRef.current();
          const seg = latest.current.find((s) => t >= s.startTime && t <= s.endTime);
          if (!seg) return;
          ed.join(seg.id);
        }
      } else if (key === 'h') {
        if (ed.boundaryId === null) return;
        ed.hear();
      } else if (e.key === 'Escape') {
        if (ed.boundaryId === null && !ed.caret && !ed.notice) return;
        ed.clear();
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  return editing;
}

const Key = ({ children }: { children: React.ReactNode }) => (
  <kbd className="ml-1 px-1 rounded border border-slate-700 font-mono text-[10px] text-slate-400">{children}</kbd>
);

const barButton =
  'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-slate-800 text-xs text-slate-300 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer';

/**
 * The strip under the waveform: Split and Undo, what the last edit did, and,
 * while a cut is selected, the tools for that cut. It never blocks playback.
 */
export function CueEditBar({ editing, segments, cueNumber }: { editing: CueEditing; segments: AudioSegment[]; cueNumber: (id: string | number) => number }) {
  const i = editing.boundaryId === null ? -1 : segments.findIndex((seg) => String(seg.id) === String(editing.boundaryId));
  const a = i >= 0 ? segments[i] : null;
  const b = i >= 0 ? segments[i + 1] : null;

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => (editing.caret ? editing.splitAtCaret() : editing.splitAtPlayhead())}
          className={barButton}
          title={editing.caret ? 'Split before the word you picked (S or Ctrl+Enter)' : 'Split the cue at the playhead, at the nearest word gap (S)'}
        >
          <Scissors className="w-3.5 h-3.5" />
          Split
          <Key>S</Key>
        </button>
        {editing.canUndo && (
          <button type="button" onClick={editing.undo} className={barButton} title="Undo the last split or join (Ctrl+Z)">
            <Undo2 className="w-3.5 h-3.5" />
            Undo
            <Key>Ctrl Z</Key>
          </button>
        )}
        <span className="text-slate-400 min-w-0 flex-1" aria-live="polite">
          {editing.notice ??
            (editing.caret
              ? `Split before the picked word in #${cueNumber(editing.caret.id)} with S or Ctrl+Enter.`
              : 'Play to where a cue should end and press S, or click a word in Original. M joins a cue with the next.')}
        </span>
      </div>

      {a && b && <CutTools editing={editing} a={a} b={b} n={cueNumber(a.id)} />}
    </div>
  );
}

function CutTools({ editing, a, b, n }: { editing: CueEditing; a: AudioSegment; b: AudioSegment; n: number }) {
  const { tokens, measured } = cueTokens(a);
  const lastWord = tokens[tokens.length - 1]?.text ?? '';
  const pause = Math.max(0, b.startTime - a.endTime);
  const firstDub = targetTextOf(a).split(/\s+/).filter(Boolean);
  const dub = [...firstDub, ...targetTextOf(b).split(/\s+/).filter(Boolean)];

  return (
    <div className="mt-2 pt-2 border-t border-slate-800 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-slate-200">
          Cut #{n} | #{n + 1}
        </span>
        <span className="text-slate-500">
          after “{lastWord}” ·{' '}
          {!measured ? 'no word timings, time estimated' : pause >= PAUSE_SECONDS ? `pause ${seconds(pause)}` : 'no pause, voiced as one line'}
        </span>
        <span className="flex-1" />
        <button type="button" onClick={() => editing.nudge(-1)} className={barButton} title="Move the cut one word left (Alt+←)" aria-label="Move the cut one word left">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => editing.nudge(1)} className={barButton} title="Move the cut one word right (Alt+→)" aria-label="Move the cut one word right">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={editing.hear} className={barButton} title="Play the original either side of the cut (H)">
          <Headphones className="w-3.5 h-3.5" />
          Hear
          <Key>H</Key>
        </button>
        <button type="button" onClick={() => editing.join(a.id)} className={barButton} title="Join the two cues again (M)">
          <Combine className="w-3.5 h-3.5" />
          Join
          <Key>M</Key>
        </button>
        <button
          type="button"
          onClick={() => editing.selectBoundary(null)}
          className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
          title="Close (Esc)"
          aria-label="Close the cut tools"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <span className="text-slate-500 pt-1">Dub</span>
        {dub.length === 0 ? (
          <span className="text-slate-500 pt-1">No dub text yet.</span>
        ) : (
          <p className="flex-1 min-w-0 leading-7 text-sm text-slate-200" aria-label="Click between two words to move where the dub text breaks">
            {dub.map((word, j) => (
              <React.Fragment key={j}>
                {j > 0 && (
                  <button
                    type="button"
                    onClick={() => editing.setDubBreak(j)}
                    className={`inline-block align-middle h-5 rounded-sm cursor-pointer ${
                      j === firstDub.length ? 'w-[3px] mx-1 bg-indigo-400' : 'w-2.5 hover:bg-indigo-500/30'
                    }`}
                    title={j === firstDub.length ? 'The dub text breaks here' : 'Break the dub text here'}
                    aria-label={`Break the dub text before “${word}”`}
                  />
                )}
                <span className={`px-0.5 rounded ${j < firstDub.length ? 'bg-indigo-500/15' : 'bg-violet-500/15'}`}>{word}</span>
              </React.Fragment>
            ))}
          </p>
        )}
        {editing.canRetranslate && (
          <button type="button" onClick={editing.retranslateHalves} disabled={editing.retranslating} className={barButton} title="Translate each half on its own, with the project's prompt">
            {editing.retranslating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Languages className="w-3.5 h-3.5" />}
            Re-translate halves
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A cue's original text as words that can be clicked: the click puts the
 * split caret before that word and moves the playhead to it. Falls back to
 * plain text when the words don't line up with the cue's timed words.
 */
export function PickableWords({
  segment,
  text,
  caretK,
  onPick,
}: {
  segment: AudioSegment;
  text: string;
  caretK: number | null;
  onPick: (k: number, start: number) => void;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const { tokens } = cueTokens(segment);
  if (words.length < 2 || words.length !== tokens.length) return <>{text}</>;
  return (
    <>
      {words.map((word, k) => (
        <React.Fragment key={k}>
          {k > 0 && ' '}
          {caretK === k && <span className="inline-block w-0.5 h-[1.1em] align-text-bottom bg-indigo-400 mr-0.5 animate-pulse" aria-hidden="true" />}
          <span
            onClick={() => onPick(k, tokens[k].start)}
            className="cursor-text rounded hover:bg-slate-800/80"
            title="Split before this word: click, then S"
          >
            {word}
          </span>
        </React.Fragment>
      ))}
    </>
  );
}
