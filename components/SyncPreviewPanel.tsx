import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Pencil, RotateCcw, X } from 'lucide-react';
import { Playhead, TimelineRuler, TimelineScrollbar, TimelineTransport, TimelineZoomControls, useTimelineZoom, useWindowPlayheads, wheelScroll } from './TimelineControls';
import { useLiveTime } from './useLiveTime';
import { hueOf, shadeOf, tintOf, withAlpha } from './lineColors';
import { FitText, SqueezedWord } from './FitText';
import { WindowWaveform, usePeaks } from './WindowWaveform';
import { AudioSegment } from '../types';
import {
  LineSuggestion,
  MIN_TRIM_SECONDS,
  previewSync,
  SyncJoinSettings,
  SyncPrecision,
  SyncPreview,
  SyncPreviewUnit,
  TRIM_TOLERANCE,
  isShortSpeech,
  wantsChange,
} from '../services/syncService';
import type { EstimateMethod } from '../services/syncService';
import type { RateBasis } from '../services/voiceRate';
import { timeLine } from '../services/speechTiming';
import { reportError } from '../services/errorPopup';
import { PhoneticTextarea } from './review/PhoneticTextarea';
import { LINE_GAP_SECONDS, MAX_LINE_RATE, MIN_LINE_RATE, QUICK_RATE, RUSHED_RATE, SLOW_RATE, PART_GAP_SECONDS, PAUSE_MARK, estimatedWords, lanePartsOf, letterCount, lineTimeAt, partEnd, rateZone, roomEnd, sourceChunksOf, type LinePart, type SourceChunk } from '../services/linePlaces';

/**
 * Sync preview: before anything is voiced, which lines are likely to fit the
 * time the original gives them, drawn on the same Original / Dub timeline the
 * sync report uses, and the controls Review rewords lines with: a shorter
 * wording for a line likely too long, a fuller one for a line likely to end
 * while the original speaker is still talking. Lengths are estimated from characters and a
 * speaking rate, so every figure here says so. See server/lib/syncPreview.js.
 */

const formatClock = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

/** How a line is likely to fit, as the dot by its number on the dub lane. */
const STATUS_DOT: Record<SyncPreviewUnit['status'], string> = {
  fits: 'bg-emerald-400',
  tight: 'bg-amber-300',
  long: 'bg-amber-400',
  short: 'bg-sky-400',
};
/** Where a short line leaves the original speech unspoken: an empty, dashed box. */
const QUIET_BOX = 'border border-dashed border-sky-400/70 bg-sky-400/5';
/** The length the user trimmed a line to. */
const TRIM_BOX = 'border-2 border-dashed border-indigo-300/90';
/** Past a line's slot: striped red when it runs long, a softer amber while it is only tight. */
const OVER_LONG = 'bg-[repeating-linear-gradient(135deg,rgba(239,68,68,0.7)_0_5px,rgba(239,68,68,0.35)_5px_10px)]';
const OVER_TIGHT = 'bg-[repeating-linear-gradient(135deg,rgba(251,191,36,0.45)_0_5px,rgba(251,191,36,0.15)_5px_10px)]';
/** The same, faint, behind a Wave or Blocks line whose own end already turns red past its slot. */
const OVER_LONG_SOFT = 'bg-[repeating-linear-gradient(135deg,rgba(239,68,68,0.22)_0_5px,transparent_5px_10px)]';
const OVER_TIGHT_SOFT = 'bg-[repeating-linear-gradient(135deg,rgba(251,191,36,0.18)_0_5px,transparent_5px_10px)]';
/** The dub bar picked for trimming. */
const SELECTED_RING = '0 0 0 2px rgba(165,180,252,0.95)';
/** The line under the playhead. */
const NOW_RING = '0 0 0 2px rgba(255,255,255,0.8)';
/** How a line is likely to fit, as the colour of its Expert range. */
const STATUS_HEX: Record<SyncPreviewUnit['status'], string> = { fits: '#34d399', tight: '#fcd34d', long: '#fbbf24', short: '#38bdf8' };
/** How Review's lanes draw the lines: Wave, Blocks or Bars (a saved Rythmo, since dropped, opens as Wave). */
const PREVIEW_VIEW_KEY = 'dhvani_preview_view';
export type LaneView = 'wave' | 'blocks' | 'bars';
const LANE_VIEWS: LaneView[] = ['wave', 'blocks', 'bars'];
/** Zoomed out past this many pixels a second, Blocks draws each line as one bar: its words would be slivers. */
const BLOCKS_MIN_PX_PER_SECOND = 6;

export { estimatedWords };

/** What a dub line's part says: the whole line, or a cut line's own words. */
const partText = (u: SyncPreviewUnit, p: LinePart, parts: number) =>
  parts > 1
    ? estimatedWords(u)
        .slice(p.first, p.last + 1)
        .map((w) => w.text)
        .join(' ')
    : u.text;

/** A steady pseudo-random 0..1, so a line's wave keeps its shape from one render to the next. */
const wobble = (i: number, j: number) => {
  const x = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** A cut's colour on the dub lane: at the original's pause, at a mark the voice pauses at, or where it runs on. */
const CUT_TONES = {
  pause: { line: 'bg-cyan-300', top: 'border-t-cyan-300', bottom: 'border-b-cyan-300' },
  stop: { line: 'bg-slate-200', top: 'border-t-slate-200', bottom: 'border-b-slate-200' },
  runOn: { line: 'bg-amber-300', top: 'border-t-amber-300', bottom: 'border-b-amber-300' },
};
/** How a cut at the original's pause that isn't made shows on the dub lane, and what double-clicking it does. */
const PAUSE_MARK_LOOK: Record<'maybe' | 'later' | 'skipped', { tick: string; title: (seconds: number) => string }> = {
  maybe: {
    tick: 'border-amber-300/80',
    title: (s) => `The original pauses here (${s.toFixed(1)} s), but there is no comma or full stop: Sync cuts only if the voice pauses itself\nDouble-click to leave it out`,
  },
  later: {
    tick: 'border-slate-400/80',
    title: (s) => `The original pauses here (${s.toFixed(1)} s), but cut here the line would run later into the next one, so it stays whole\nDouble-click to leave it out`,
  },
  skipped: {
    tick: 'border-slate-500',
    title: (s) => `A cut at the original's pause (${s.toFixed(1)} s), turned off\nDouble-click to cut here again`,
  },
};
/** Wave bars sit about this many pixels apart, like a recording's waveform. */
const BAR_PX = 2;
/**
 * The closest the estimated Wave's bars come, in seconds (about 4 ms). The
 * timelines zoom in to single samples now, and every line's bars are built
 * at once: a bar per pixel there would be millions of them.
 */
const MIN_BAR_STEP = 2 ** -8;
/**
 * Seconds between two Wave bars at this zoom: a power of two, so zooming
 * redraws the bars only when their spacing doubles or halves.
 */
const barStepAt = (pxPerSecond: number) => (pxPerSecond > 0 ? Math.max(MIN_BAR_STEP, 2 ** Math.round(Math.log2(BAR_PX / pxPerSecond))) : 0.05);
/**
 * A line's Wave: thin bars, a group per estimated word, none in its pauses,
 * on a 1000 × 100 box mirrored about its middle. Drawn as one path of
 * vertical strokes, so the bars keep their width however the box is stretched.
 */
const wavePath = (words: { start: number; end: number }[], length: number, step: number) => {
  if (!words.length || length <= 0 || step <= 0) return '';
  const x = (t: number) => ((t / length) * 1000).toFixed(1);
  let d = '';
  words.forEach((w, i) => {
    const span = w.end - w.start;
    if (span <= 0) return;
    const n = Math.max(1, Math.floor(span / step));
    const peak = 0.65 + 0.35 * wobble(i, 1);
    for (let k = 0; k < n; k++) {
      const p = (k + 0.5) / n;
      // Up to the full height of the line, as the original's bars above fill theirs (ReviewWaveformPlayer).
      const h = Math.max(1, 46 * peak * Math.sin(Math.PI * p) ** 0.55 * (0.55 + 0.45 * wobble(i * 31 + k, 7)));
      d += `M${x(w.start + span * p)},${(50 - h).toFixed(1)}V${(50 + h).toFixed(1)}`;
    }
  });
  return d;
};
/**
 * Every Rythmo word's box, to the span holding its text. One observer fits
 * them all: a band can hold thousands of words, and fitting each on its own
 * (a style write, then a layout read) laid the page out once per word and
 * froze the window for seconds when the Dub step opened or zoomed.
 */
const rythmoText = new Map<Element, HTMLElement>();
let rythmoObserver: ResizeObserver | null = null;
const fitRythmoWords = (entries: ResizeObserverEntry[]) => {
  // All reads first, then all writes, so the page is laid out once. A scale
  // doesn't change the layout width scrollWidth reads, so it needn't be cleared.
  const fits: [HTMLElement, number][] = [];
  for (const { target } of entries) {
    const text = rythmoText.get(target);
    if (!text) continue;
    const room = (target as HTMLElement).clientWidth;
    const need = text.scrollWidth;
    if (room > 0 && need > 0) fits.push([text, Math.min(1.8, room / need)]);
  }
  for (const [text, scale] of fits) text.style.transform = `scaleX(${scale})`;
};

/**
 * A word on a Rythmo band, squeezed or stretched to the time it takes, as a
 * dubbing studio's band writes it: a squeezed word has to be said fast, a
 * stretched one has room. Never clipped, so a word stays readable.
 */
const RythmoWord: React.FC<{ text: string; left: string; width: string; late: boolean; className?: string }> = ({ text, left, width, late, className = '' }) => {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !inner.current) return;
    rythmoObserver ??= new ResizeObserver(fitRythmoWords);
    rythmoText.set(el, inner.current);
    // Observing reports the box once straight away, so a new word or new text is fitted too.
    rythmoObserver.observe(el);
    return () => {
      rythmoObserver?.unobserve(el);
      rythmoText.delete(el);
    };
  }, [text]);
  return (
    <span
      ref={box}
      aria-hidden="true"
      className={`absolute top-1/2 -translate-y-1/2 flex justify-center whitespace-nowrap pointer-events-none border-l border-slate-700/60 leading-none ${
        late ? 'text-rose-300' : 'text-slate-100'
      } ${className}`}
      style={{ left, width }}
    >
      <span ref={inner} className="inline-block origin-center">
        {text}
      </span>
    </span>
  );
};

/** Where the lips close: ▼ on the original, ▲ on the dub. */
const LipMark: React.FC<{ left: string; up?: boolean }> = ({ left, up }) => (
  <span
    aria-hidden="true"
    className={`absolute z-10 w-0 h-0 -ml-[4px] pointer-events-none border-x-[4px] border-x-transparent ${
      up ? 'bottom-0 border-b-[6px] border-b-amber-300' : 'top-0 border-t-[6px] border-t-amber-300'
    }`}
    style={{ left }}
  />
);

/**
 * When a line is short, as server/lib/syncDub.js decides it (isShortLine), so a
 * wording typed here is judged the way the preview and the sync judge it.
 */
export const isShort = isShortSpeech;

/** Which way a line's wording has to change: fewer words to fit its slot, or more to fill the original speech. */
export type RewriteDirection = 'shorter' | 'longer' | 'same';

/** What a wording of each direction is called. */
export const wordingKind = (direction: RewriteDirection) => (direction === 'longer' ? 'fuller' : direction === 'same' ? 'other' : 'shorter');

/** The most of a line a shorter wording should cut (server/lib/syncRewrite.js MAX_CUT_SHARE). */
const MAX_CUT_SHARE = 0.35;

/**
 * True when a long line would lose more than a third of itself to fit: fewer
 * words would change what it says, so its timing should change instead.
 */
export const deepCut = (unit: SyncPreviewUnit) =>
  directionFor(unit) === 'shorter' && unit.wantSeconds === undefined && unit.targetChars < unit.text.trim().length * (1 - MAX_CUT_SHARE);

/** Wordings a retake or a synced line is offered at once, in the Takes and Sync panels. */
export const LINE_OPTIONS = 2;
/** Wordings a line in Review is offered when the user asks: one, quick; Another asks for the next. */
const REVIEW_OPTIONS = 1;
/**
 * Earlier wordings sent back with a new request, so new ones read differently
 * and none comes back twice: a user may ask for a line as often as they like.
 */
export const MAX_TRIED = 30;

/** Fetches the preview again whenever the script, the precision or the rate change. */
export const useSyncPreview = ({
  enabled,
  segments,
  precision,
  join,
  charsPerSecond,
  speakerRates,
  placedShare,
  sourceDuration,
}: {
  enabled: boolean;
  segments: AudioSegment[];
  precision: SyncPrecision;
  join?: SyncJoinSettings;
  charsPerSecond: number;
  /** Characters a second of the speakers whose voices speak at their own rate. */
  speakerRates?: Record<string, number>;
  /** The share of a read the last sync left once it placed its lines (syncedPlacedShare); omitted before any sync. */
  placedShare?: number;
  sourceDuration: number;
}) => {
  // By value, so a new object with the same rates doesn't fetch again.
  const speakerRatesKey = JSON.stringify(speakerRates || {});
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The preview runs again on every pause in typing: one popup per run of failures, not one per keystroke.
  const failing = useRef(false);

  useEffect(() => {
    if (!enabled || segments.length === 0) return;
    const controller = new AbortController();
    // Typing in the script changes the segments on every key; wait for a pause.
    const timer = window.setTimeout(() => {
      setLoading(true);
      previewSync({ segments, precision, join, charsPerSecond, speakerRates: JSON.parse(speakerRatesKey), placedShare, sourceDuration }, { signal: controller.signal })
        .then((next) => {
          setPreview(next);
          setError(null);
          failing.current = false;
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(err?.message || 'The preview could not be worked out.');
          if (!failing.current) reportError(err, { title: 'The sync fit could not be worked out', safe: 'Nothing was voiced or changed. It is tried again as you edit.' });
          failing.current = true;
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, segments, precision, join, charsPerSecond, speakerRatesKey, placedShare, sourceDuration]);

  return { preview: enabled ? preview : null, error: enabled ? error : null, loading };
};

/** What the user has done with one line that is likely too long, or likely to end early. */
export type LineFixState =
  | { kind: 'idle' }
  /** `count`: how many wordings were asked for. */
  | { kind: 'working'; tried: string[]; count: number }
  /**
   * `issues`: what the meaning check found in the wording being edited, when
   * it is a suggestion the check did not pass. `options`: the wordings the
   * last request brought, to pick between; the text is the one picked, as edited.
   */
  | { kind: 'draft'; text: string; suggested: boolean; tried: string[]; issues?: string[]; options?: LineSuggestion[] }
  | { kind: 'error'; message: string; tried: string[] }
  | { kind: 'used'; text: string; before: Record<string, string>; tried: string[] }
  | { kind: 'kept'; tried: string[] };

/**
 * A line's way of being reworded: fewer words for a long line, more for one
 * that ends early, and for one that fits, other words of about its length.
 */
export const directionFor = (unit: SyncPreviewUnit): RewriteDirection =>
  // A line trimmed on the timeline goes toward its trim; any other, toward its slot or its speech.
  unit.wantSeconds !== undefined
    ? unit.estimate > unit.wantSeconds
      ? 'shorter'
      : 'longer'
    : unit.status === 'short'
      ? 'longer'
      : unit.status === 'long'
        ? 'shorter'
        : 'same';

/**
 * Rewording lines, one at a time or all at once, as Review offers it. Each line's direction comes from how it
 * compares with its source sentence (directionFor) and is kept once work on
 * the line starts: once a fuller wording is used the line is no longer short,
 * but it is still the line that was made fuller.
 */
export const useLineFixes = ({
  onSuggest,
  onCheck,
  onUseLine,
  onRestore,
}: {
  onSuggest: (unit: SyncPreviewUnit, avoid: string[], direction: RewriteDirection, count: number) => Promise<LineSuggestion[]>;
  /** The meaning check of a wording that came back `checking`, run behind it while the user already reads it. */
  onCheck?: (unit: SyncPreviewUnit, option: LineSuggestion, direction: RewriteDirection) => Promise<{ ok: boolean; issues: string[]; backTranslation?: string }>;
  onUseLine: (unit: SyncPreviewUnit, text: string) => Record<string, string>;
  onRestore: (before: Record<string, string>) => void;
}) => {
  const [rows, setRows] = useState<Record<string, LineFixState>>({});
  // A suggestion that comes back after its row changed is dropped.
  const requests = useRef<Record<string, number>>({});
  const directions = useRef<Record<string, RewriteDirection>>({});
  // A used line asked for again keeps what Undo goes back to: the script as it was before the first wording.
  const undoTo = useRef<Record<string, Record<string, string>>>({});
  const directionOf = (unit: SyncPreviewUnit): RewriteDirection => directions.current[unit.key] ?? directionFor(unit);
  const setRow = (unit: SyncPreviewUnit, state: LineFixState) => {
    if (state.kind === 'idle') delete directions.current[unit.key];
    else directions.current[unit.key] = directionOf(unit);
    setRows((r) => ({ ...r, [unit.key]: state }));
  };
  const stateOf = (unit: SyncPreviewUnit): LineFixState => rows[unit.key] || { kind: 'idle' };
  /** Worked on, so it stays listed even once it fits. */
  const worked = (u: SyncPreviewUnit) => stateOf(u).kind !== 'idle';
  /** Not settled yet: no wording used, and not kept as it is. */
  const open = (u: SyncPreviewUnit) => stateOf(u).kind !== 'kept' && stateOf(u).kind !== 'used';
  const notStarted = (u: SyncPreviewUnit) => stateOf(u).kind === 'idle' || stateOf(u).kind === 'error';

  /**
   * Asks for `count` wordings of a line: several when the user asks for that line, one each from Suggest for all.
   * `chosen`: the way the user picked (Shorter, Longer, Same length), in place of the one the line's fit decides.
   */
  /**
   * The meaning check of a quick wording, behind it: once it is back, the
   * wording carries what it says in English, or what the check found changed.
   * A check that fails to run marks the wording as not checked. Dropped when the
   * line was asked for again, or the wording is no longer being edited.
   */
  const checkBehind = async (unit: SyncPreviewUnit, option: LineSuggestion, direction: RewriteDirection, id: number) => {
    let result: { ok: boolean; issues: string[]; backTranslation?: string };
    try {
      result = await onCheck!(unit, option, direction);
    } catch {
      result = { ok: false, issues: ['The meaning could not be checked. Read it against the original before using it.'] };
    }
    if (requests.current[unit.key] !== id) return;
    const checked: LineSuggestion = {
      text: option.text,
      ...(option.over && { over: option.over }),
      ...(result.backTranslation && { backTranslation: result.backTranslation }),
      ...(!result.ok && { issues: result.issues }),
    };
    setRows((r) => {
      const row = r[unit.key];
      if (row?.kind !== 'draft' || !row.options) return r;
      const picked = row.suggested && row.text === option.text;
      return {
        ...r,
        [unit.key]: {
          ...row,
          options: row.options.map((o) => (o.text === option.text ? checked : o)),
          ...(picked && { issues: checked.issues }),
        },
      };
    });
  };
  const suggest = async (unit: SyncPreviewUnit, count = REVIEW_OPTIONS, chosen?: RewriteDirection) => {
    if (chosen) directions.current[unit.key] = chosen;
    const current = rows[unit.key];
    const tried = current && 'tried' in current ? current.tried : [];
    const direction = directionOf(unit);
    const id = (requests.current[unit.key] || 0) + 1;
    requests.current[unit.key] = id;
    setRow(unit, { kind: 'working', tried, count });
    try {
      const options = await onSuggest(unit, tried, direction, count);
      if (requests.current[unit.key] !== id) return;
      const [first] = options;
      if (first)
        setRow(unit, {
          kind: 'draft',
          text: first.text,
          suggested: true,
          tried: [...tried, ...options.map((o) => o.text)].slice(-MAX_TRIED),
          issues: first.issues,
          options,
        });
      if (first && onCheck) for (const option of options.filter((o) => o.checking)) void checkBehind(unit, option, direction, id);
      if (!first)
        setRow(unit, {
          kind: 'error',
          message: `No usable ${wordingKind(direction)} wording came back. Try again, or edit it yourself.`,
          tried,
        });
    } catch (err: any) {
      if (requests.current[unit.key] !== id) return;
      setRow(unit, { kind: 'error', message: 'No new wording.', tried });
      reportError(err, { title: 'No new wordings', safe: 'The line is unchanged — you can still edit it yourself.' });
    }
  };
  // A line too long to shorten without losing meaning is left for the user to ask for on its own.
  const suggestAll = (list: SyncPreviewUnit[]) => list.filter((unit) => notStarted(unit) && !deepCut(unit)).forEach((unit) => suggest(unit, 1));
  /** Forgets the work on a line, so its direction is decided again: after a new trim, say. */
  const reset = (unit: SyncPreviewUnit) => {
    requests.current[unit.key] = (requests.current[unit.key] || 0) + 1;
    delete undoTo.current[unit.key];
    setRow(unit, { kind: 'idle' });
  };
  /**
   * Leaves the wordings being asked for or edited: back to the wording used
   * before, when the line was asked for again after one, otherwise to nothing.
   */
  const leave = (unit: SyncPreviewUnit) => {
    requests.current[unit.key] = (requests.current[unit.key] || 0) + 1;
    const before = undoTo.current[unit.key];
    const current = rows[unit.key];
    if (before) setRow(unit, { kind: 'used', text: unit.text, before, tried: current && 'tried' in current ? current.tried : [] });
    else setRow(unit, { kind: 'idle' });
  };

  /** What a line's controls need; its direction decides how they read. */
  const controlsFor = (unit: SyncPreviewUnit) => ({
    direction: directionOf(unit),
    state: stateOf(unit),
    /** Wordings of the line, the way the user picked, or with none picked the way its fit decides. */
    onSuggest: (chosen?: RewriteDirection) => suggest(unit, REVIEW_OPTIONS, chosen),
    /**
     * New wordings for a line already settled, from the words it has now. Its
     * direction is the one picked, or worked out again: a long line made to fit is now reworded.
     */
    onSuggestAgain: (chosen?: RewriteDirection) => {
      const current = rows[unit.key];
      if (current?.kind === 'used') undoTo.current[unit.key] = current.before;
      delete directions.current[unit.key];
      suggest(unit, REVIEW_OPTIONS, chosen);
    },
    onStop: () => leave(unit),
    onEdit: () => setRow(unit, { kind: 'draft', text: unit.text, suggested: false, tried: [] }),
    onDraft: (text: string) => {
      const current = rows[unit.key];
      setRow(unit, {
        kind: 'draft',
        text,
        suggested: false,
        tried: current && 'tried' in current ? current.tried : [],
        options: current?.kind === 'draft' ? current.options : undefined,
      });
    },
    /** Takes one of the wordings offered into the draft, in place of what is there. */
    onPick: (option: LineSuggestion) => {
      const current = rows[unit.key];
      if (current?.kind !== 'draft') return;
      setRow(unit, { ...current, text: option.text, suggested: true, issues: option.issues });
    },
    onUse: (text: string) => {
      const current = rows[unit.key];
      const before = onUseLine(unit, text);
      // The first wording's script wins, so Undo goes back to the line as it was before any of them.
      const first = undoTo.current[unit.key];
      delete undoTo.current[unit.key];
      setRow(unit, { kind: 'used', text, before: first ? { ...before, ...first } : before, tried: current && 'tried' in current ? current.tried : [] });
    },
    onKeep: () => {
      const current = rows[unit.key];
      setRow(unit, { kind: 'kept', tried: current && 'tried' in current ? current.tried : [] });
    },
    onUndo: () => {
      const current = rows[unit.key];
      const before = current?.kind === 'used' ? current.before : undoTo.current[unit.key];
      if (before) onRestore(before);
      delete undoTo.current[unit.key];
      setRow(unit, { kind: 'idle' });
    },
  });

  return { directionOf, stateOf, worked, open, notStarted, suggestAll, controlsFor, reset };
};

/** Quick or Expert: how the preview times the dub lines. */
export const EstimateSwitch: React.FC<{ method: EstimateMethod; onChange: (method: EstimateMethod) => void }> = ({ method, onChange }) => (
  <div role="group" aria-label="Estimate" className="flex bg-slate-950 border border-edge rounded-xl p-0.5 gap-0.5">
    {[
      { id: 'quick' as const, label: 'Quick', hint: 'Characters at the voice’s rate: the estimate as it has always been' },
      { id: 'expert' as const, label: 'Expert', hint: 'Syllables at the voice’s rate, with pauses, a fast to slow range and where the lips close' },
    ].map((m) => (
      <button
        key={m.id}
        type="button"
        title={m.hint}
        aria-pressed={method === m.id}
        onClick={() => onChange(m.id)}
        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-default ${
          method === m.id ? (m.id === 'expert' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-100') : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        {m.label}
      </button>
    ))}
  </div>
);

/** How long the voice reads a line, after its placed length, when Sync closes it up by a tenth of a second or more. */
export const readNote = (unit: Pick<SyncPreviewUnit, 'read' | 'estimate'>) =>
  unit.read - unit.estimate >= 0.1 ? ` (read in ${unit.read.toFixed(1)} s, closed up by Sync)` : '';

/** What the preview's figures are worked out from, in a few words. */
/** Where an estimate's rate came from, after its value. */
export const RATE_BASIS_NOTE: Record<RateBasis, string> = {
  learned: "learned from this voice's Syncs",
  sync: 'from this dub',
  sample: "from your voice's sample read",
  typical: '(a typical rate)',
};

/**
 * What the preview's rate is and where it came from. `expertBasis` stands for
 * the Expert estimate, which may read at a pace learned from the voice's Syncs
 * (`learnedLines` lines of it) while the Quick one still reads at `basis`.
 */
export const estimateBasis = (preview: SyncPreview, basis: RateBasis, expertBasis: RateBasis = basis, learnedLines?: number) =>
  preview.method === 'expert' && preview.syllablesPerSecond
    ? `${preview.syllablesPerSecond.toFixed(1)} syllables/s ${
        expertBasis === 'learned' && learnedLines ? `and its pauses, learned from ${learnedLines} lines this voice said` : RATE_BASIS_NOTE[expertBasis]
      }`
    : `${preview.charsPerSecond.toFixed(1)} chars/s ${RATE_BASIS_NOTE[basis === 'learned' ? 'sync' : basis]}`;

/**
 * An Expert line up close: its words with their syllables, what to cut or
 * the room left, the lip closures, and its Rythmo band against its slot.
 */
export const ExpertLineDetail: React.FC<{ unit: SyncPreviewUnit }> = ({ unit }) => {
  const x = unit.expert;
  if (!x) return null;
  const span = Math.max(unit.slot, x.high) * 1.04;
  const pct = (t: number) => (t / span) * 100;
  const lipsMissed = x.sourceLips.length - x.lipsMatched;
  return (
    <div className="mt-2.5 flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {x.words.map((w, n) => (
          <span key={n} className="text-[13px] text-slate-200 bg-slate-900 border border-edge rounded-md px-1.5 py-0.5">
            {w.text}
            <sup className="ml-0.5 font-mono text-[9.5px] text-indigo-300">{w.syllables}</sup>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11.5px] tabular-nums text-slate-400">
        <span>
          {x.syllables} syllables at {x.rate.toFixed(1)}/s
        </span>
        <span>
          {x.low.toFixed(1)} to {x.high.toFixed(1)} s, fast to slow
        </span>
        {x.cut > 0 ? (
          <span className="text-amber-300">cut about {x.cut} syllable{x.cut === 1 ? '' : 's'}</span>
        ) : (
          <span className="text-emerald-300/90">room for about {x.room} more</span>
        )}
        {x.sourceLips.length > 0 ? (
          <span className={lipsMissed > 0 ? 'text-amber-300' : ''}>
            lips close {x.lipsMatched} of {x.sourceLips.length}
            {lipsMissed > 0 ? ': a word with p, b or m there would match the mouth' : ''}
          </span>
        ) : (
          <span>no word timings for the lips</span>
        )}
      </div>
      {/* The line's Rythmo band, against its slot */}
      <div className="relative h-12 rounded-lg bg-indigo-950/30 border border-edge overflow-hidden" aria-hidden="true">
        <span className="absolute top-1 bottom-1 left-0 rounded border border-dashed border-slate-600" style={{ width: `${pct(unit.slot)}%` }} />
        {unit.estimate > unit.slot && (
          <span
            className="absolute top-2 bottom-2 bg-rose-400/15 border-t-2 border-rose-400"
            style={{ left: `${pct(unit.slot)}%`, width: `${pct(unit.estimate - unit.slot)}%` }}
          />
        )}
        {x.sourceLips.map((t, n) => (
          <LipMark key={`s${n}`} left={`${pct(t - unit.srcStart)}%`} />
        ))}
        {x.words.map((w, n) => (
          <RythmoWord
            key={n}
            text={w.text}
            late={w.end > unit.slot + 0.02}
            className="text-[14px]"
            left={`${pct(w.start)}%`}
            width={`${Math.max(0.5, pct(w.end - w.start))}%`}
          />
        ))}
        {x.dubLips.map((t, n) => (
          <LipMark key={`d${n}`} up left={`${pct(t)}%`} />
        ))}
        <span className="absolute right-1.5 bottom-0.5 font-mono text-[9.5px] text-slate-500">slot {unit.slot.toFixed(1)} s</span>
      </div>
    </div>
  );
};

/**
 * The estimate for a wording: against the line's slot, and against the
 * original speech, which a fuller wording has to fill without running past.
 */
export const fitOf = (text: string, unit: SyncPreviewUnit, cps: number) => {
  // A line the Expert estimate timed is judged by it too, so a suggestion reads the same as the line.
  // Otherwise a wording takes the line's own estimate scaled by syllables, which is how long words take
  // to say: one syllable can be three or four characters in an Indian script (प्र, क्ष्म).
  const lineSyllables = timeLine(unit.text, 1).syllables;
  const seconds = unit.expert
    ? timeLine(text, unit.expert.rate, unit.expert.pauses).seconds
    : lineSyllables > 0 && unit.estimate > 0
      ? (unit.estimate * timeLine(text, 1).syllables) / lineSyllables
      : text.trim().length / cps;
  const over = seconds - unit.slot;
  const short = isShort(seconds, unit.spoken);
  return { seconds, over, fits: over <= 0, short, fills: over <= 0 && !short };
};

/** The small label a line carries: how far past its slot, how early it ends, or that it fits. */
export const linePill = (unit: SyncPreviewUnit, state: LineFixState) => ({
  text:
    state.kind === 'used'
      ? 'fits'
      : unit.status === 'long'
        ? `+${unit.overflow.toFixed(1)} s`
        : unit.status === 'short'
          ? `−${unit.underflow.toFixed(1)} s`
          : unit.status === 'tight'
            ? 'tight'
            : 'fits',
  tone:
    state.kind === 'used' || unit.status === 'fits'
      ? 'bg-emerald-500/15 text-emerald-300'
      : state.kind === 'kept'
        ? 'bg-slate-800 text-slate-300'
        : unit.status === 'short'
          ? 'bg-sky-500/15 text-sky-300'
          : unit.status === 'tight'
            ? 'bg-amber-500/10 text-amber-200'
            : 'bg-amber-500/15 text-amber-300',
});

/** One sentence on where a line stands, worded for the way it is being changed. */
export const lineNote = (unit: SyncPreviewUnit, state: LineFixState, direction: RewriteDirection) => {
  const longer = direction === 'longer';
  return {
    tone:
      state.kind === 'used'
        ? 'text-slate-400'
        : unit.status === 'long'
          ? 'text-amber-300'
          : unit.status === 'short'
            ? 'text-sky-300'
            : 'text-slate-400',
    text:
      state.kind === 'used'
        ? 'Put into the script. Sync voices this wording.'
        : state.kind === 'kept'
          ? longer
            ? `Kept. The dub goes quiet for about ${unit.underflow.toFixed(1)} s while the original speaker is still talking.`
            : 'Kept. Sync shortens the pauses inside it first; if it is still long, the next line starts late and shows in Worth a listen.'
          : longer
            ? `About ${unit.estimate.toFixed(1)} s of speech${readNote(unit)}; the original speaker talks for ${unit.spoken.toFixed(1)} s`
            : `About ${unit.estimate.toFixed(1)} s of speech${readNote(unit)} for a ${unit.slot.toFixed(1)} s slot`,
  };
};

/** Shown with a suggestion the meaning check did not pass, so the user reads it before using it. */
export const MeaningWarning: React.FC<{ issues: string[] }> = ({ issues }) => (
  <div role="note" className="mb-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11.5px] text-amber-300 leading-snug">
    <span className="font-semibold">Check the meaning before using this.</span> The closest wording the text model found may differ from the
    original line: {issues.slice(0, 3).join('; ')}.
  </div>
);

/**
 * A wording against the line it would replace, word by word: the new words
 * picked out, and the words it drops listed under it, struck through. Where
 * the two share no word, the wording is shown as it is.
 */
const WordingDiff: React.FC<{ from: string; to: string }> = ({ from, to }) => {
  const a = from.trim().split(/\s+/).filter(Boolean);
  const b = to.trim().split(/\s+/).filter(Boolean);
  // Longest common run of words, from the end, so both lines can be walked from the start.
  const common = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) common[i][j] = a[i] === b[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
  if (common[0][0] === 0) return <span className="block text-[13px] text-slate-100 leading-snug">{to}</span>;
  const words: { text: string; added: boolean }[] = [];
  const dropped: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      words.push({ text: b[j++], added: false });
      i++;
    } else if (common[i + 1][j] >= common[i][j + 1]) dropped.push(a[i++]);
    else words.push({ text: b[j++], added: true });
  }
  while (j < b.length) words.push({ text: b[j++], added: true });
  while (i < a.length) dropped.push(a[i++]);
  return (
    <>
      <span className="block text-[13px] text-slate-100 leading-snug">
        {words.map((w, n) => (
          <React.Fragment key={n}>
            {n > 0 && ' '}
            {w.added ? <span className="rounded-sm bg-sky-400/20 text-sky-100 px-0.5">{w.text}</span> : w.text}
          </React.Fragment>
        ))}
      </span>
      {dropped.length > 0 && (
        <span className="block mt-0.5 text-[11.5px] text-slate-500 line-through leading-snug" title="Words this wording drops">
          {dropped.join(' ')}
        </span>
      )}
    </>
  );
};

/** Why the line's own way is the one marked, for its button's tooltip. */
const suggestedReason = (unit: SyncPreviewUnit, direction: RewriteDirection) =>
  unit.wantSeconds !== undefined
    ? `toward your trim of ${unit.wantSeconds.toFixed(1)} s`
    : direction === 'shorter'
      ? 'this line runs past its slot'
      : direction === 'longer'
        ? 'this line ends before the original speaker stops'
        : 'this line fits';

const WORDING_CHOICES: { direction: RewriteDirection; label: string; title: string }[] = [
  { direction: 'shorter', label: 'Shorter', title: 'Shorter wordings of this line, same meaning' },
  { direction: 'longer', label: 'Longer', title: 'Longer, fuller wordings of this line, same meaning' },
  { direction: 'same', label: 'Same length', title: 'Other ways to say this line, about as long, same meaning' },
];

/**
 * Shorter, Longer and Same length for one line: nothing is asked for until one
 * is pressed, and only for this line. The way the line's fit points (directionFor)
 * is marked, never chosen for the user; a line too long to shorten without losing
 * meaning (deepCut) marks none.
 */
export const WordingButtons: React.FC<{
  unit: SyncPreviewUnit;
  onSuggest: (direction: RewriteDirection) => void;
  /** Smaller buttons, for the row under a settled line. */
  compact?: boolean;
  className?: string;
}> = ({ unit, onSuggest, compact = false, className = '' }) => {
  const natural = directionFor(unit);
  const marked = deepCut(unit) ? null : natural;
  return (
    <div role="group" aria-label="Ask for wordings of this line" className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {WORDING_CHOICES.map(({ direction, label, title }) => {
        const isMarked = direction === marked;
        return (
          <button
            key={direction}
            type="button"
            onClick={() => onSuggest(direction)}
            title={`${title}. Nothing changes until you use one.${isMarked ? ` Suggested: ${suggestedReason(unit, direction)}.` : ''}`}
            className={`${compact ? 'h-6 px-2' : 'h-7 px-2.5'} rounded-md border text-[11.5px] cursor-default transition-colors ${
              isMarked
                ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-200 hover:bg-indigo-500/20'
                : 'border-edge text-slate-300 hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
};

export interface LineFixControlsProps {
  unit: SyncPreviewUnit;
  cps: number;
  direction: RewriteDirection;
  state: LineFixState;
  /** Wordings the way picked, or with none picked the way the line's fit decides. */
  onSuggest: (chosen?: RewriteDirection) => void;
  /** New wordings for a line whose wording was used or kept. */
  onSuggestAgain: (chosen?: RewriteDirection) => void;
  onStop: () => void;
  onEdit: () => void;
  onDraft: (text: string) => void;
  onPick: (option: LineSuggestion) => void;
  onUse: (text: string) => void;
  onKeep: () => void;
  onUndo: () => void;
}

/**
 * How a line can be reworded, with its draft, Use, Keep and Undo. Asked for
 * one line, the text model offers several wordings to pick from; the one
 * picked goes into the draft to edit. They are all shorter, all fuller or,
 * for a line that fits, all about its length: the direction is decided from
 * the line's source sentence.
 */
export const LineFixControls: React.FC<LineFixControlsProps> = ({
  unit,
  cps,
  direction,
  state,
  onSuggest,
  onSuggestAgain,
  onStop,
  onEdit,
  onDraft,
  onPick,
  onUse,
  onKeep,
  onUndo,
}) => {
  const longer = direction === 'longer';
  const kind = wordingKind(direction);
  // A line the user may leave as it is: too long, ending early, or off its trim.
  const flagged = unit.status === 'long' || unit.status === 'short' || wantsChange(unit);
  const draftFit = state.kind === 'draft' ? fitOf(state.text, unit, cps) : null;
  const changed = state.kind === 'draft' && state.text.trim() !== '' && state.text.trim() !== unit.text.trim();
  const want = unit.wantSeconds;
  const draftBadge = !draftFit
    ? null
    : want !== undefined
      ? {
          good: draftFit.fits && Math.abs(draftFit.seconds - want) <= TRIM_TOLERANCE,
          text: `About ${draftFit.seconds.toFixed(1)} s · your trim ${want.toFixed(1)} s${draftFit.fits ? '' : ` · +${draftFit.over.toFixed(1)} s past its slot`}`,
        }
    : !draftFit.fits
      ? { good: false, text: `${direction === 'shorter' ? 'Still about' : 'About'} ${draftFit.seconds.toFixed(1)} s · +${draftFit.over.toFixed(1)} s past its slot` }
      : longer
        ? draftFit.short
          ? { good: false, text: `Still about ${draftFit.seconds.toFixed(1)} s of ${unit.spoken.toFixed(1)} s · ends early` }
          : { good: true, text: `Now about ${draftFit.seconds.toFixed(1)} s of ${unit.spoken.toFixed(1)} s · fills` }
        : { good: true, text: `Now about ${draftFit.seconds.toFixed(1)} s · fits` };

  return (
    <>
      {(state.kind === 'idle' || state.kind === 'error') && direction === 'shorter' && deepCut(unit) && (
        <p className="mt-2 text-[11.5px] text-amber-300 leading-snug">
          To fit, this line would lose more than a third of its words, and with them some of what it says. Give it more time instead: drag
          the end of its bar on the timeline, or join it with the line beside it.
        </p>
      )}
      {(state.kind === 'idle' || state.kind === 'error') && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {state.kind === 'error' && (
            <button
              type="button"
              onClick={() => onSuggest()}
              className="h-7 px-2.5 rounded-md border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-default"
            >
              Try again
            </button>
          )}
          <WordingButtons unit={unit} onSuggest={onSuggest} />
          <button
            type="button"
            onClick={onEdit}
            className="h-7 px-2.5 flex items-center gap-1 rounded-md border border-edge hover:bg-slate-800 text-xs text-slate-300 cursor-default"
          >
            <Pencil className="w-3 h-3" /> Edit it myself
          </button>
          {flagged && (
            <button type="button" onClick={onKeep} className="h-7 px-2 rounded-md text-[11.5px] text-slate-400 hover:text-slate-200 cursor-default">
              Keep as is
            </button>
          )}
          {state.kind === 'error' && <span className="text-[11.5px] text-rose-300">{state.message}</span>}
        </div>
      )}

      {state.kind === 'working' && (
        <div role="status" className="mt-2 flex flex-wrap items-center gap-2 min-h-7 text-xs text-slate-300">
          <Loader2 className="w-3.5 h-3.5 text-cyan-300 animate-spin" /> Asking the text model for{' '}
          {state.count > 1 ? `${state.count} ${kind} wordings` : `a${kind === 'other' ? 'n' : ''} ${kind} wording`}…
          <button type="button" onClick={onStop} className="ml-1 h-6 px-2 rounded-md border border-edge hover:bg-slate-800 text-[11.5px] text-slate-400 cursor-default">
            Stop
          </button>
        </div>
      )}

      {state.kind === 'draft' && draftBadge && (
        <div className="mt-2 rounded-lg border border-edge bg-slate-950/60 p-2.5">
          {state.options && state.options.length > 1 && (
            <div className="mb-2">
              <span className="block text-[10.5px] uppercase tracking-wide font-semibold text-slate-500 mb-1">
                {state.options.length} {kind} wordings · pick one, then edit it if you like
              </span>
              <div role="radiogroup" aria-label="Suggested wordings" className="flex flex-col gap-1">
                {state.options.map((option, i) => {
                  const picked = option.text === state.text;
                  const fit = fitOf(option.text, unit, cps);
                  const good = want !== undefined ? fit.fits && Math.abs(fit.seconds - want) <= TRIM_TOLERANCE : longer ? fit.fills : fit.fits;
                  return (
                    <button
                      key={option.text}
                      type="button"
                      role="radio"
                      aria-checked={picked}
                      onClick={() => onPick(option)}
                      className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-left cursor-default ${
                        picked ? 'border-indigo-500 bg-indigo-500/10' : 'border-edge hover:bg-slate-800/70'
                      }`}
                    >
                      <span
                        className={`shrink-0 mt-0.5 w-4 h-4 rounded-full border text-[9.5px] font-semibold flex items-center justify-center tabular-nums ${
                          picked ? 'border-indigo-400 bg-indigo-500 text-white' : 'border-slate-600 text-slate-400'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="flex-1 min-w-0">
                        <WordingDiff from={unit.text} to={option.text} />
                        {option.backTranslation && (
                          <span className="block mt-0.5 text-[11.5px] text-slate-500 leading-snug" title="This wording translated back into English, without the original line in view">
                            Says: {option.backTranslation}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 flex flex-col items-end gap-0.5">
                        <span
                          className={`text-[10.5px] font-semibold px-1.5 rounded tabular-nums ${
                            good ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          ≈{fit.seconds.toFixed(1)} s · {!fit.fits ? 'long' : good ? (longer ? 'fills' : 'fits') : want !== undefined ? 'off your trim' : 'ends early'}
                        </span>
                        {option.over && !fit.fits && (
                          <span className="text-[10.5px] text-amber-300" title="No wording fit its time; this one is closest. Trim a word or two.">
                            ~{option.over} syllable{option.over === 1 ? '' : 's'} long
                          </span>
                        )}
                        {option.issues && <span className="text-[10.5px] text-amber-300">check meaning</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <label className="block text-[10.5px] uppercase tracking-wide font-semibold text-slate-500 mb-1" htmlFor={`preview-line-${unit.key}`}>
            {state.options && state.options.length > 1
              ? state.suggested
                ? 'Picked wording'
                : 'Your wording'
              : state.suggested
                ? `Suggested ${kind === 'other' ? '' : `${kind} `}line`
                : 'Your wording'}
          </label>
          {state.suggested && state.issues && <MeaningWarning issues={state.issues} />}
          {state.suggested && state.options?.find((o) => o.text === state.text)?.checking && (
            <p role="status" className="mb-1 flex items-center gap-1.5 text-[11.5px] text-slate-500 leading-snug">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking the meaning against the original…
            </p>
          )}
          {state.suggested && (!state.options || state.options.length < 2) && state.options?.find((o) => o.text === state.text)?.backTranslation && (
            <p className="mb-1 text-[11.5px] text-slate-500 leading-snug" title="This wording translated back into English, without the original line in view">
              Says: {state.options.find((o) => o.text === state.text)?.backTranslation}
            </p>
          )}
          <PhoneticTextarea
            id={`preview-line-${unit.key}`}
            value={state.text}
            onChange={onDraft}
            rows={2}
            className="w-full resize-y bg-slate-900 border border-edge rounded-md px-2 py-1.5 text-[13px] text-slate-100 leading-snug focus:outline-none focus:border-indigo-500"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onUse(state.text.trim())}
              disabled={!changed}
              className="h-7 px-2.5 flex items-center gap-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-default"
              title="Put this wording into the script"
            >
              <Check className="w-3.5 h-3.5" /> Use this line
            </button>
            <button
              type="button"
              onClick={() => onSuggest()}
              className="h-7 px-2 rounded-md border border-edge hover:bg-slate-800 text-[11.5px] text-slate-300 cursor-default"
            >
              {state.options && state.options.length > 0 ? 'Another' : 'Suggest one'}
            </button>
            <button
              type="button"
              onClick={flagged ? onKeep : onUndo}
              className="h-7 px-2 flex items-center gap-1 rounded-md text-[11.5px] text-slate-400 hover:text-slate-200 cursor-default"
            >
              <X className="w-3 h-3" /> {flagged ? 'Keep as is' : 'Cancel'}
            </button>
            <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
              {state.text.trim().length} / {unit.text.trim().length} characters
            </span>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-md tabular-nums ${
                draftBadge.good ? 'bg-emerald-500/15 text-emerald-300' : longer && draftFit?.fits ? 'bg-sky-500/15 text-sky-300' : 'bg-amber-500/15 text-amber-300'
              }`}
            >
              {draftBadge.text}
            </span>
          </div>
        </div>
      )}

      {(state.kind === 'used' || state.kind === 'kept') && (
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`text-[11.5px] font-semibold px-2 py-0.5 rounded-md ${
              state.kind === 'used' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-300'
            }`}
          >
            {state.kind === 'used'
              ? longer
                ? `About ${fitOf(state.text, unit, cps).seconds.toFixed(1)} s of ${unit.spoken.toFixed(1)} s of original speech`
                : `About ${fitOf(state.text, unit, cps).seconds.toFixed(1)} s for a ${unit.slot.toFixed(1)} s slot`
              : 'Kept'}
          </span>
          <WordingButtons unit={unit} onSuggest={onSuggestAgain} compact />
          <button
            type="button"
            onClick={onUndo}
            className="h-6 px-2 flex items-center gap-1 rounded-md border border-edge hover:bg-slate-800 text-[11.5px] text-slate-300 cursor-default"
          >
            <RotateCcw className="w-3 h-3" /> Undo
          </button>
        </div>
      )}
    </>
  );
};

/** How the dub lane draws its lines, remembered across sessions: Wave until another is picked. */
export const useLaneView = () => {
  const [view, setView] = useState<LaneView>(() => {
    try {
      const saved = localStorage.getItem(PREVIEW_VIEW_KEY);
      return LANE_VIEWS.find((v) => v === saved) ?? 'wave';
    } catch {
      return 'wave';
    }
  });
  const change = (next: LaneView) => {
    setView(next);
    try {
      localStorage.setItem(PREVIEW_VIEW_KEY, next);
    } catch {
      /* Storage off: the view lasts until the app closes. */
    }
  };
  return [view, change] as const;
};

/** How Review's lanes draw the lines, the original's above and the dub's below. */
export const LaneViewSwitch: React.FC<{ view: LaneView; onChange: (view: LaneView) => void }> = ({ view, onChange }) => {
  const shown = view;
  return (
  <div role="group" aria-label="Lane view" className="flex bg-slate-950 border border-edge rounded-xl p-0.5 gap-0.5">
    {[
      { id: 'wave' as const, label: 'Wave', hint: "The original's audio above; below, each dub line as a wave: a swell for each word, flat where the voice is likely to pause. A guess from the text; nothing is voiced yet." },
      { id: 'blocks' as const, label: 'Blocks', hint: "Each word as a box: the original's where it is said, the dub's as wide as it is likely to take, red past the line's slot." },
      { id: 'bars' as const, label: 'Bars', hint: 'Each line as a bar with its words in it: the original line above, the dub script below.' },
    ].map((v) => (
      <button
        key={v.id}
        type="button"
        title={v.hint}
        aria-pressed={shown === v.id}
        onClick={() => onChange(v.id)}
        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-default ${shown === v.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
      >
        {v.label}
      </button>
    ))}
  </div>
  );
};

/** A gap between the original's words this long is a pause (server/lib/sourcePauses.js). */
const SOURCE_PAUSE_SECONDS = 0.15;

/**
 * A line's pauses: a cyan tick on top where the original speaker pauses (from
 * the cues' word timings), an amber one below where the dub has a mark the
 * original talks straight through, which Match source pauses cuts. An Expert
 * line places the dub's mark at its word; a Quick one at its share of the
 * line's characters. Lines without word timings show none.
 */
const LinePauseTicks: React.FC<{ unit: SyncPreviewUnit; pct: (t: number) => number; segments: AudioSegment[] }> = ({ unit, pct, segments }) => {
  const ids = new Set(unit.cueIds.map(String));
  const words = segments
    .filter((seg) => ids.has(String(seg.id)))
    .flatMap((seg) => seg.words || [])
    .filter((w) => /[\p{L}\p{N}]/u.test(String(w.text ?? '')) && Number.isFinite(w.start) && Number.isFinite(w.end))
    .sort((a, b) => a.start - b.start);
  const source = words.slice(1).flatMap((w, i) => (w.start - words[i].end >= SOURCE_PAUSE_SECONDS ? [(words[i].end + w.start) / 2] : []));
  const bare = (t: string) => t.replace(/[^\p{L}\p{N}\p{M}]/gu, '');
  const dub = (unit.unpausedMarks || []).flatMap(({ after, mark }) => {
    // On the dub's clock: where the line, or its part, was placed.
    if (unit.expert) {
      const word = unit.expert.words.find((w) => bare(w.text) === bare(after));
      return word ? [lineTimeAt(unit, word.end)] : [];
    }
    const at = unit.text.indexOf(`${after}${mark}`);
    return at >= 0 && unit.text.length > 0 ? [lineTimeAt(unit, unit.estimate * ((at + after.length) / unit.text.length))] : [];
  });
  return (
    <>
      {source.map((t, n) => (
        <span key={`s${n}`} aria-hidden="true" title="The original pauses here" className="absolute top-0 w-0 h-0 -ml-[4px] border-x-[4px] border-x-transparent border-t-[6px] border-t-cyan-300 pointer-events-none" style={{ left: `${pct(t)}%` }} />
      ))}
      {dub.map((t, n) => (
        <span key={`d${n}`} aria-hidden="true" title="The dub may pause here, where the original runs straight on; Sync cuts it" className="absolute bottom-0 w-0 h-0 -ml-[4px] border-x-[4px] border-x-transparent border-b-[7px] border-b-amber-400 pointer-events-none" style={{ left: `${pct(t)}%` }} />
      ))}
    </>
  );
};

/** What a cue says in the original language. */
const sourceTextOf = (seg: AudioSegment) => (seg.textSource ?? seg.originalText ?? seg.text ?? '').trim();
const SPOKEN = /[\p{L}\p{N}]/u;

/**
 * The original's lane in Blocks and Bars (Review's Wave shows its audio
 * instead): what the original says, on its own clock, each line in the colour
 * its dub has below. Blocks (in the waveform's place): a box per word where it
 * is said (its measured word timings), the word squeezed inside. Bars (a row
 * under the waveform): a bar per chunk, cut where Sync cuts the dub
 * (sourceChunksOf), exactly as long as its words, the pause between two
 * marked with its length; its words inside, broken between words, smaller
 * only when they must be. A line without word timings is one bar; a cue in no
 * line is a grey bar.
 */
export const SourceLineLane: React.FC<{
  units: SyncPreviewUnit[];
  segments: AudioSegment[];
  windowStart: number;
  windowSeconds: number;
  look: 'blocks' | 'bars';
  /** Line numbers in the bars (the Line numbers layer). */
  numbers?: boolean;
}> = ({ units, segments, windowStart, windowSeconds, look, numbers = false }) => {
  const pct = (t: number) => ((t - windowStart) / windowSeconds) * 100;
  const probe = useRef<HTMLSpanElement>(null);
  const [laneWidth, setLaneWidth] = useState(0);
  useLayoutEffect(() => {
    const lane = probe.current?.parentElement;
    if (!lane) return;
    setLaneWidth(lane.clientWidth);
    const observer = new ResizeObserver(() => setLaneWidth(lane.clientWidth));
    observer.observe(lane);
    return () => observer.disconnect();
  }, []);
  const pxPerSecond = windowSeconds > 0 ? laneWidth / windowSeconds : 0;
  const blocks = look === 'blocks' && pxPerSecond >= BLOCKS_MIN_PX_PER_SECOND;
  // Each line's text and words, and the cues no line holds, worked out once per set of lines.
  const lines = useMemo(() => {
    const byId = new Map(segments.map((seg) => [String(seg.id), seg]));
    const held = new Set<string>();
    const drawn = units.map((u) => {
      const cues = u.cueIds.map((id) => byId.get(String(id))).filter((seg): seg is AudioSegment => Boolean(seg));
      cues.forEach((seg) => held.add(String(seg.id)));
      const words = cues
        .flatMap((seg) => seg.words || [])
        .filter((w) => SPOKEN.test(String(w.text ?? '')) && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
        .map((w) => ({ text: String(w.text).trim(), start: w.start, end: w.end }));
      const text = u.sourceText?.trim() || cues.map(sourceTextOf).filter(Boolean).join(' ');
      // Bars: in chunks, cut where Sync cuts the dub, each as long as its words.
      const chunks: SourceChunk[] = look === 'bars' ? sourceChunksOf(u, cues) : [{ from: u.srcStart, to: u.srcEnd, text }];
      return { key: u.key, index: u.index as number | null, from: Math.min(u.srcStart, chunks[0].from), to: Math.max(u.srcEnd, chunks[chunks.length - 1].to), text, words, chunks };
    });
    const loose = segments
      .filter((seg) => !held.has(String(seg.id)) && sourceTextOf(seg))
      .map((seg) => ({
        key: `cue-${seg.id}`,
        index: null,
        from: seg.startTime,
        to: seg.endTime,
        text: sourceTextOf(seg),
        words: [] as { text: string; start: number; end: number }[],
        chunks: [{ from: seg.startTime, to: seg.endTime, text: sourceTextOf(seg) }],
      }));
    return [...drawn, ...loose];
  }, [units, segments, look]);
  const end = windowStart + windowSeconds;
  return (
    <>
      <span ref={probe} aria-hidden="true" className="hidden" />
      {lines
        .filter((l) => l.to >= windowStart && l.from <= end && l.to > l.from)
        .map((l) => {
          const hue = l.index === null ? '#64748b' : hueOf(l.index);
          if (blocks && l.words.length)
            return (
              <React.Fragment key={l.key}>
                {l.words.map((w, n) => (
                  <span
                    key={n}
                    aria-hidden="true"
                    className="absolute top-1.5 bottom-1.5 flex items-center justify-center overflow-hidden rounded-[3px] border leading-none text-slate-50 pointer-events-none"
                    style={{
                      left: `${pct(w.start)}%`,
                      width: `calc(${Math.max(0.1, pct(w.end) - pct(w.start))}% - 1px)`,
                      background: withAlpha(hue, 0.24),
                      borderColor: withAlpha(hue, 0.85),
                    }}
                  >
                    <SqueezedWord text={w.text} boxPx={(w.end - w.start) * pxPerSecond - 1} />
                  </span>
                ))}
              </React.Fragment>
            );
          // A bar per chunk, as long as its words; between two, the pause Sync cuts at and how long it is.
          return (
            <React.Fragment key={l.key}>
              {l.chunks.map((c, n) => {
                const next = l.chunks[n + 1];
                return (
                  <React.Fragment key={n}>
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 bottom-1.5 rounded border pointer-events-none"
                      style={{ left: `${pct(c.from)}%`, width: `${Math.max(0.3, pct(c.to) - pct(c.from))}%`, background: withAlpha(hue, 0.22), borderColor: hue }}
                    >
                      <FitText fitKey={`${c.text}|${numbers}|${n}`}>
                        <span className="text-slate-50">
                          {numbers && l.index !== null && n === 0 && (
                            <span className="font-mono font-semibold" style={{ color: hue }}>
                              {l.index + 1}{' '}
                            </span>
                          )}
                          {c.text}
                        </span>
                        <span className="block font-mono text-[0.85em] tabular-nums whitespace-nowrap" style={{ color: hue }}>
                          {(c.to - c.from).toFixed(2)} s
                        </span>
                      </FitText>
                    </span>
                    {next && (
                      <span
                        title={`The original pauses ${(next.from - c.to).toFixed(2)} s here; Sync cuts the dub line here`}
                        className="absolute inset-y-0 flex items-center justify-center pointer-events-none"
                        style={{ left: `${pct(c.to)}%`, width: `${Math.max(0.1, pct(next.from) - pct(c.to))}%` }}
                      >
                        <span className="absolute inset-y-1 left-1/2 border-l border-dashed border-cyan-400/60" />
                        {(next.from - c.to) * pxPerSecond >= 18 && (
                          <span className="relative bg-slate-950 px-px font-mono text-[9.5px] leading-none tabular-nums text-cyan-300">{(next.from - c.to).toFixed(1)}</span>
                        )}
                      </span>
                    )}
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })}
    </>
  );
};

/** A line being edited is never narrower than this on the lane, in pixels, so there is room to type. */
const EDITOR_MIN_PX = 160;
/** The smallest the words being typed get while they fit the bar; past it the box scrolls. */
const EDITOR_MIN_FONT_PX = 9;

/**
 * A dub line's words typed in its bar (Bars), with phonetic typing: Roman
 * letters become the dub language's script as each word ends. Its length is
 * guessed again on every key, from its letters against the line's estimate,
 * and drawn behind it against the line's room (red past it); the real
 * estimate comes once it is saved. Enter or leaving the box saves, Esc
 * puts the line back.
 */
const BarLineEditor: React.FC<{
  unit: SyncPreviewUnit;
  text: string;
  onChange: (text: string) => void;
  onDone: (save: boolean) => void;
  start: number;
  room: number;
  pct: (t: number) => number;
}> = ({ unit, text, onChange, onDone, start, room, pct }) => {
  const area = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(save);
  };
  const hue = hueOf(unit.index);
  const was = letterCount(unit.text);
  const now = letterCount(text);
  // The line's own estimate, scaled by its letters: a guess until it is saved and worked out again.
  const seconds = was > 0 ? (unit.estimate * now) / was : now * 0.08;
  const end = start + seconds;
  const slot = room - start;
  const over = end - room;
  useEffect(() => {
    // Two frames on: the click that picked the line moves focus to its cue in the list a frame later (pickReviewLine).
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const el = area.current;
        if (!el) return;
        el.focus({ preventScroll: true });
        el.setSelectionRange(el.value.length, el.value.length);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  // The words fit the bar as they are typed: smaller only when they must be.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    let size = 13;
    el.style.fontSize = `${size}px`;
    while (size > EDITOR_MIN_FONT_PX && el.scrollHeight > el.clientHeight + 1) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  }, [text]);
  return (
    <>
      {/* The line's guessed length behind the box: its colour inside its room, red past it */}
      <span
        aria-hidden="true"
        className="absolute top-1.5 bottom-1.5 rounded-l pointer-events-none"
        style={{ left: `${pct(start)}%`, width: `${Math.max(0, pct(Math.min(end, room)) - pct(start))}%`, background: withAlpha(hue, 0.3) }}
      />
      {over > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-1.5 bottom-1.5 rounded-r pointer-events-none bg-rose-500/35"
          style={{ left: `${pct(room)}%`, width: `${pct(end) - pct(room)}%` }}
        />
      )}
      <span
        className="absolute z-30 top-1 bottom-1 flex flex-col rounded border-2 border-indigo-300 bg-slate-950/40"
        style={{ left: `${pct(start)}%`, width: `${Math.max(pct(end), pct(room)) - pct(start)}%`, minWidth: EDITOR_MIN_PX }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <PhoneticTextarea
          ref={area}
          aria-label={`Line ${unit.index + 1}: the dub's words`}
          value={text}
          onChange={onChange}
          spellCheck={false}
          className="flex-1 min-h-0 w-full resize-none overflow-y-auto bg-transparent px-1.5 pt-0.5 leading-[1.15] text-slate-50 focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              e.stopPropagation();
              finish(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              finish(false);
            }
          }}
          onBlur={(e) => {
            // Focus going to the spellings list stays in the edit; anywhere else saves.
            if (e.relatedTarget instanceof Node && e.currentTarget.parentElement?.contains(e.relatedTarget)) return;
            finish(true);
          }}
        />
        <span className="shrink-0 overflow-hidden whitespace-nowrap px-1.5 pb-px font-mono text-[9.5px] leading-[12px] tabular-nums" style={{ color: over > 0 ? '#fda4af' : hue }}>
          ≈{seconds.toFixed(1)} s{over > 0 ? ` · +${over.toFixed(1)} s` : ''} / {slot.toFixed(1)} s · Enter saves · Esc puts it back
        </span>
      </span>
    </>
  );
};

/** Zoomed out past this, a dub lane leaves out the lips' marks, which would crowd its lines. Review draws 2.5 views at once (ReviewWaveformPlayer's BUFFER_PAD), so this is 20 s on view there. */
const LIP_MARK_SECONDS = 50;
/** Zoomed out past this, a pause row says to zoom in instead of crowding its ticks (30 s on view in Review, which draws 2.5 views). */
const PAUSE_ROW_SECONDS = 75;

/**
 * The pause row of a track view, on the dub lane's clock: every line's pauses
 * (LinePauseTicks) in a row of their own, so they never cover a line.
 */
export const PauseTicksLane: React.FC<{ units: SyncPreviewUnit[]; segments: AudioSegment[]; windowStart: number; windowSeconds: number }> = ({ units, segments, windowStart, windowSeconds }) => {
  if (windowSeconds > PAUSE_ROW_SECONDS)
    return <span className="absolute left-2 inset-y-0 flex items-center text-[10.5px] text-slate-500 pointer-events-none">Zoom in to see each pause</span>;
  const pct = (t: number) => ((t - windowStart) / windowSeconds) * 100;
  return (
    <>
      {units
        .filter((u) => Math.max(u.srcEnd, u.srcStart + u.estimate) >= windowStart && u.srcStart <= windowStart + windowSeconds)
        .map((u) => (
          <LinePauseTicks key={u.key} unit={u} pct={pct} segments={segments} />
        ))}
    </>
  );
};

/** A part of a line being dragged on the dub lane: the line, the part (LinePart.index), and where its first word would be heard; null is where Sync puts it. */
export interface PlaceDrag {
  key: string;
  part: number;
  start: number | null;
}

/** A line being stretched on the dub lane: its speed now, and where its first word is heard when its left edge is dragged. */
export interface StretchDraft {
  key: string;
  rate: number;
  start?: number | null;
}

/** A stretch's colour by how it sounds: none when natural, amber when quick or dragged, red when rushed. */
export const RATE_TONE = { natural: null, quick: '#fbbf24', rushed: '#fb7185', slow: '#fbbf24' } as const;
const rateText = (rate: number) => `${rate.toFixed(2)}×`;

/** A dragged start this close to a snap point, in pixels, lands on it. */
const SNAP_PX = 8;
/** Pointed this close to a pause in the dub, in pixels, a cut goes there. */
const PAUSE_CUT_PX = 16;
/** Pointed this close to the gap between two words, in pixels, the knife is out: a click cuts there. */
const KNIFE_PX = 9;
/** The knife's colour: cyan where the original speaker pauses, else amber. */
const KNIFE_TONE = { pause: '#67e8f9', word: '#fcd34d' } as const;

/** A gap between two words of a part, where it can be cut. */
interface CutGap {
  /** The word before it, by index into the line's estimated words. */
  k: number;
  /** Where it falls on the timeline, and how far into the line. */
  t: number;
  into: number;
  /** Letters of the line said before it (as DubPlace cuts count them). */
  letters: number;
  /** The word before it ends with a comma or full stop. */
  punct: boolean;
  /** How long the original speaker pauses there, when they do (a pause Sync doesn't cut at now). */
  srcPause: number | null;
}
/** Where the pointer would cut a line: the gap, its part, and whether a click cuts there (the knife is out). */
interface CutPick extends CutGap {
  key: string;
  part: number;
  armed: boolean;
}

/** Every gap between two words of part `p`, where it could be cut. */
const gapsOf = (u: SyncPreviewUnit, p: LinePart): CutGap[] => {
  const words = estimatedWords(u);
  const gaps: CutGap[] = [];
  let letters = words.slice(0, p.first).reduce((sum, w) => sum + letterCount(w.text), 0);
  for (let k = p.first; k < p.last && k + 1 < words.length; k++) {
    letters += letterCount(words[k].text);
    const into = (words[k].end + words[k + 1].start) / 2;
    const mark = u.pauseMarks?.find((m) => m.letters === letters && m.state !== 'cut');
    gaps.push({ k, t: p.start + into - p.from, into, letters, punct: PAUSE_MARK.test(words[k].text), srcPause: mark ? mark.seconds : null });
  }
  return gaps;
};

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable));
};

/**
 * The dub lane of a sync preview: each line where Sync will start it, as long
 * as it is likely to last once placed, in the line's colour; past its room the
 * rest is striped (red when it runs long). With Rythmo, an Expert line's words
 * sit where they are likely said. A picked line gets a handle to drag its end
 * to the length it should take (a trim). Positions are on the window from
 * `windowStart`, `windowSeconds` wide; `drag` and `setDrag` hold a trim in
 * progress, so the caller can spell it out. Pauses have a row of their own
 * (PauseTicksLane); an Expert line's lip closures show once zoomed in.
 *
 * Given onPlace and onCut, a line can be placed by hand (services/linePlaces.ts):
 * dragged to where its first word should be heard, snapping to the original's
 * words and stopping at the lines either side; cut with S between the two words
 * nearest the pointer (at a pause when one is close) into parts placed on their
 * own; joined again with a double-click on the cut; put back where Sync puts it
 * with Backspace. A placed part shows a flag, and a dashed outline where Sync
 * would have put it.
 */
export const DubEstimateLane: React.FC<{
  units: SyncPreviewUnit[];
  windowStart: number;
  windowSeconds: number;
  selectedKey?: string | null;
  currentKey?: string | null;
  onSelect?: (unit: SyncPreviewUnit) => void;
  onTrim?: (unit: SyncPreviewUnit, seconds: number) => void;
  rythmo?: boolean;
  /** How a line is drawn when it isn't a Rythmo band: a bar, a wave of its words, or a box per word. */
  look?: 'bars' | 'wave' | 'blocks';
  drag?: { key: string; seconds: number } | null;
  setDrag?: (drag: { key: string; seconds: number } | null) => void;
  onDragStart?: () => void;
  /** Puts the part of a line after `letters` letters (LinePart.letters) where its first word is heard, or back where Sync puts it with null. */
  onPlace?: (unit: SyncPreviewUnit, letters: number, start: number | null) => void;
  /** Cuts a line after `letters` letters, or joins it there again. */
  onCut?: (unit: SyncPreviewUnit, letters: number, on: boolean) => void;
  /** Turns a cut at the original's pause (SyncPreviewUnit.pauseMarks) off, or back on, by its letters. */
  onSkipPause?: (unit: SyncPreviewUnit, letters: number, skip: boolean) => void;
  /** A part being dragged, held by the caller so the fit follows it. */
  placeDrag?: PlaceDrag | null;
  setPlaceDrag?: (drag: PlaceDrag | null) => void;
  /** Where the original's words start: a dragged part snaps to them. */
  snapTimes?: number[];
  /**
   * Stretches a line by its edges: read at `rate` times as fast (pitch kept),
   * its first word moved to `start` when its left edge was dragged. 1 takes
   * the stretch off. Without it the edges don't stretch.
   */
  onStretch?: (unit: SyncPreviewUnit, rate: number, start?: number | null) => void;
  /** A stretch being dragged, held by the caller so the fit follows it. */
  stretchDraft?: StretchDraft | null;
  setStretchDraft?: (draft: StretchDraft | null) => void;
  /**
   * What the lane shows besides the lines: every line's fit (else only the
   * picked line's), line numbers, and its marks (cuts, pauses, flags, rings).
   * With `pauses` off the lines are told apart by their colour alone.
   */
  layers?: { fit: boolean; numbers: boolean; pauses?: boolean };
  /** Where a stretched line's speed shows: on the line always (On line), or only while it is dragged (Card, which has it below). */
  rateMarks?: 'always' | 'drag';
  /**
   * Bars: a double-click on a line types its words in the bar (phonetic
   * typing), called with the new words once saved. Without it a double-click
   * zooms to the line, as in the other views.
   */
  onEditLine?: (unit: SyncPreviewUnit, text: string) => void;
  /**
   * Where the rest of a line would go if it were cut after `letters` letters:
   * the new part's first and last word on the timeline, drawn as an outline
   * while the knife is out.
   */
  cutGhost?: (unit: SyncPreviewUnit, letters: number) => { start: number; end: number } | null;
}> = ({
  units,
  windowStart,
  windowSeconds: WINDOW_SECONDS,
  selectedKey,
  currentKey,
  onSelect,
  onTrim,
  rythmo = false,
  look = 'bars',
  drag = null,
  setDrag,
  onDragStart,
  onPlace,
  onCut,
  onSkipPause,
  placeDrag = null,
  setPlaceDrag,
  snapTimes = [],
  onStretch,
  stretchDraft = null,
  setStretchDraft,
  layers = { fit: true, numbers: true },
  rateMarks = 'always',
  onEditLine,
  cutGhost,
}) => {
  /** The line whose words are being typed in its bar, and what they are so far. */
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
  const editable = Boolean(onEditLine) && look === 'bars';
  /** Colour alone: no rings, cut notches, pause ticks, flags or read ranges, until the Pauses layer is on. */
  const quiet = layers.pauses === false;
  /** A line's speed is marked on it: stretched (On line), or being stretched now. */
  const marksRate = (u: SyncPreviewUnit) => stretchDraft?.key === u.key || (rateMarks === 'always' && Math.abs((u.rate ?? 1) - 1) >= 0.005);
  const pct = (t: number) => ((t - windowStart) / WINDOW_SECONDS) * 100;
  // Blocks write a word in its box only where it fits, and Wave spaces its bars in pixels, so the lane's width is needed.
  const probe = useRef<HTMLSpanElement>(null);
  const [laneWidth, setLaneWidth] = useState(0);
  const measured = look === 'blocks' || look === 'wave';
  useLayoutEffect(() => {
    const lane = probe.current?.parentElement;
    if (!measured || !lane) return;
    setLaneWidth(lane.clientWidth);
    const observer = new ResizeObserver(() => setLaneWidth(lane.clientWidth));
    observer.observe(lane);
    return () => observer.disconnect();
  }, [measured]);
  const pxPerSecond = WINDOW_SECONDS > 0 ? laneWidth / WINDOW_SECONDS : 0;
  const barStep = barStepAt(pxPerSecond);
  // Each line's estimated words, and its wave, worked out once per set of lines (and per bar spacing).
  // Bars need the words too: a cut line's part writes only its own in its bar.
  const shapes = useMemo(
    () =>
      new Map(
        units.map((u) => {
          const words = estimatedWords(u);
          return [u.key, { words, path: look === 'wave' ? wavePath(words, u.estimate, barStep) : '' }] as const;
        })
      ),
    [units, look, barStep]
  );
  const gradientId = useId().replace(/[^\w-]/g, '');
  const end = windowStart + WINDOW_SECONDS * 2;
  const partsOf = useMemo(() => new Map(units.map((u) => [u.key, lanePartsOf(u)])), [units]);
  const lastEnd = (u: SyncPreviewUnit) => {
    const parts = partsOf.get(u.key) ?? lanePartsOf(u);
    return partEnd(parts[parts.length - 1]);
  };
  const visible = units.filter((u) => {
    const parts = partsOf.get(u.key) ?? [];
    return Math.max(u.srcEnd, lastEnd(u)) >= windowStart && Math.min(u.srcStart, parts[0]?.start ?? u.srcStart) <= end;
  });
  /** Seconds on the timeline under `clientX` on the lane. */
  const timeAt = (clientX: number, lane: Element) => {
    const r = lane.getBoundingClientRect();
    return windowStart + ((clientX - r.left) / Math.max(1, r.width)) * WINDOW_SECONDS;
  };
  /** A trim from where the pointer is over the dub lane, held to the line's slot, snapping to the end of the original speech. */
  const trimAt = (u: SyncPreviewUnit, clientX: number, lane: Element) => {
    const seconds = timeAt(clientX, lane) - (u.dubStart ?? u.srcStart);
    const snapped = Math.abs(seconds - u.spoken) <= 0.15 ? u.spoken : Math.round(seconds * 10) / 10;
    return Math.max(MIN_TRIM_SECONDS, Math.min(u.slot, snapped));
  };

  // ---- Placing by hand ----
  /** The lines and window as last drawn, for the key handler and a drag in progress. */
  const latest = useRef({ units, partsOf, windowStart, WINDOW_SECONDS });
  latest.current = { units, partsOf, windowStart, WINDOW_SECONDS };
  /** Where a part may start: after the part before it (by the same speaker) ends, before the next one starts. */
  const rangeOf = (u: SyncPreviewUnit, p: LinePart) => {
    let lo = 0;
    let hi = Infinity;
    for (const o of units) {
      if (u.speaker && o.speaker && o.speaker !== u.speaker) continue;
      for (const q of partsOf.get(o.key) ?? []) {
        if (o.key === u.key && q.index === p.index) continue;
        const own = o.key === u.key;
        const before = own ? q.index < p.index : o.index < u.index;
        if (before) lo = Math.max(lo, partEnd(q) + (own ? PART_GAP_SECONDS : LINE_GAP_SECONDS));
        // A later part of the same line isn't run into; a later line's start is, as a long line runs into it.
        else hi = Math.min(hi, own ? q.start - PART_GAP_SECONDS - (p.to - p.from) : q.start - LINE_GAP_SECONDS);
      }
    }
    return { lo: Math.min(lo, p.auto), hi: Math.max(hi, p.auto) };
  };
  /** Where a part dragged to `wanted` lands: on an original word or its own Sync place when close, inside its range. Null is Sync's place. */
  const placeAt = (u: SyncPreviewUnit, p: LinePart, wanted: number, lane: Element) => {
    const reach = SNAP_PX / Math.max(1, lane.getBoundingClientRect().width / WINDOW_SECONDS);
    let t = wanted;
    let snapped: number | null = null;
    for (const s of [p.auto, ...snapTimes]) {
      if (Math.abs(s - wanted) < reach && (snapped === null || Math.abs(s - wanted) < Math.abs(snapped - wanted))) snapped = s;
    }
    if (snapped !== null) t = snapped;
    const { lo, hi } = rangeOf(u, p);
    const held = Math.min(hi, Math.max(lo, t));
    if (held !== t) snapped = null;
    return { start: Math.abs(held - p.auto) < 0.01 ? null : Math.round(held * 1000) / 1000, snapped };
  };
  /**
   * Where part `p` would be cut with the pointer at `clientX`: between the two
   * words nearest it, or at a pause close by unless the pointer is right on a
   * gap. Armed (the knife is out, a click cuts) only that close to the gap.
   */
  const cutAt = (u: SyncPreviewUnit, p: LinePart, clientX: number, lane: Element): CutPick | null => {
    if (p.last <= p.first) return null;
    const r = lane.getBoundingClientRect();
    const pxs = r.width / Math.max(0.001, WINDOW_SECONDS);
    const x = clientX - r.left;
    let best: { gap: CutGap; d: number } | null = null;
    let pause: { gap: CutGap; d: number } | null = null;
    for (const gap of gapsOf(u, p)) {
      const d = Math.abs((gap.t - windowStart) * pxs - x);
      if (!best || d < best.d) best = { gap, d };
      if ((gap.punct || gap.srcPause !== null) && d < PAUSE_CUT_PX && (!pause || d < pause.d)) pause = { gap, d };
    }
    const pick = pause && best && best.d > KNIFE_PX / 2 ? pause : best;
    if (!pick) return null;
    return { ...pick.gap, key: u.key, part: p.index, armed: pick.d <= KNIFE_PX };
  };

  /** A press on a part: dragged past a few pixels it moves; let go where it was, it was a click. */
  const press = useRef<{ key: string; part: number; letters: number; x0: number; grab: number; moved: boolean; start: number | null } | null>(null);
  const clickHandled = useRef(false);
  const [guide, setGuide] = useState<number | null>(null);
  /** The part under the pointer, for S and Backspace, and where S would cut it. */
  const hover = useRef<{ key: string; part: number; clientX: number; lane: Element } | null>(null);
  const [cutPreview, setCutPreview] = useState<CutPick | null>(null);
  /** When the last click cut a line: the double-click it makes doesn't zoom or edit too. */
  const lastCut = useRef(0);
  const knifeOut = cutPreview?.armed && !placeDrag && !stretchDraft ? cutPreview : null;
  const knifeTone = knifeOut ? (knifeOut.srcPause !== null ? KNIFE_TONE.pause : KNIFE_TONE.word) : KNIFE_TONE.word;
  // Where the rest of the line goes if cut where the knife is: worked out once per gap.
  const ghostUnit = knifeOut ? units.find((x) => x.key === knifeOut.key) : undefined;
  const ghost = useMemo(
    () => (knifeOut && ghostUnit && cutGhost ? cutGhost(ghostUnit, knifeOut.letters) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [knifeOut?.key, knifeOut?.letters, ghostUnit, cutGhost]
  );
  const hovered = () => {
    const h = hover.current;
    if (!h) return null;
    const u = latest.current.units.find((x) => x.key === h.key);
    const p = u ? latest.current.partsOf.get(u.key)?.find((q) => q.index === h.part) : undefined;
    return u && p ? { u, p, h } : null;
  };
  useEffect(() => {
    if (!onCut && !onPlace) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      const at = hovered();
      if (!at) return;
      // Over a dub line these keys are the line's: they don't reach Review's own S (split a cue at the playhead).
      // By the key's place too, so S still cuts with a Bangla or Hindi keyboard on.
      if (onCut && (e.key.toLowerCase() === 's' || e.code === 'KeyS')) {
        const cut = cutAt(at.u, at.p, at.h.clientX, at.h.lane);
        if (!cut) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        onCut(at.u, cut.letters, true);
        lastCut.current = Date.now();
        setCutPreview(null);
      } else if (onPlace && (e.key === 'Backspace' || e.key === 'Delete') && at.p.placed) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onPlace(at.u, at.p.letters, null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const lineNumber = (u: SyncPreviewUnit, width: number, dot?: string) => {
    const rate = u.rate ?? 1;
    const stretched = marksRate(u);
    if (width <= 3.2 || (!layers.numbers && !stretched)) return null;
    const tone = RATE_TONE[rateZone(rate)];
    return (
      <span
        className="absolute z-10 left-1 top-1 flex items-center gap-1 rounded bg-slate-950/85 px-1 font-mono text-[9.5px] font-semibold leading-[14px] pointer-events-none"
        style={{ color: hueOf(u.index) }}
      >
        {layers.numbers && dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
        {layers.numbers && u.index + 1}
        {stretched && <span className="tabular-nums" style={{ color: tone ?? '#e2e8f0' }}>{rateText(rate)}</span>}
      </span>
    );
  };

  // ---- Stretching by the edges ----
  /** A press on a line's edge: its side, and the line as it was when the drag began. */
  const stretchPress = useRef<{ key: string; side: 'L' | 'R'; rate: number; speech: number; gaps: number; start: number; end: number; lo: number; moved: boolean; x0: number } | null>(null);
  const stretchTo = (u: SyncPreviewUnit, clientX: number, lane: Element): StretchDraft | null => {
    const held = stretchPress.current;
    if (!held) return null;
    const t = timeAt(clientX, lane);
    // A left edge never jumps right on its own: it stops at the line before, or where it already is.
    const start = held.side === 'L' ? Math.max(held.lo, Math.min(held.end - 0.1, t)) : held.start;
    const end = held.side === 'R' ? Math.max(held.start + 0.1, t) : held.end;
    // Only the words stretch: the gaps between a cut line's parts stay as they are.
    const speech = Math.max(0.05, end - start - held.gaps);
    const rate = Math.round(Math.min(MAX_LINE_RATE, Math.max(MIN_LINE_RATE, (held.rate * held.speech) / speech)) * 100) / 100;
    return { key: u.key, rate, ...(held.side === 'L' && { start: Math.round(start * 1000) / 1000 }) };
  };
  const stretchEdge = (u: SyncPreviewUnit, parts: LinePart[], side: 'L' | 'R') => {
    if (!onStretch || !setStretchDraft) return null;
    const start = parts[0].start;
    const end = partEnd(parts[parts.length - 1]);
    const rate = u.rate ?? 1;
    const live = stretchDraft?.key === u.key;
    return (
      <span
        key={`edge-${side}`}
        title={`Drag to stretch the line: faster or slower, the words and the pitch stay (now ${rateText(rate)})\nDouble-click: back to 1×`}
        className="absolute z-20 top-1.5 bottom-1.5 w-2.5 -ml-[5px] cursor-ew-resize touch-none group/edge"
        style={{ left: `${pct(side === 'L' ? start : end)}%` }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          stretchPress.current = null;
          setStretchDraft(null);
          onStretch(u, 1);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.stopPropagation();
          const speech = parts.reduce((sum, p) => sum + (p.to - p.from), 0);
          stretchPress.current = { key: u.key, side, rate, speech, gaps: Math.max(0, end - start - speech), start, end, lo: Math.min(rangeOf(u, parts[0]).lo, start), moved: false, x0: e.clientX };
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // A pointer that is already gone: the press ends with it.
          }
        }}
        onPointerMove={(e) => {
          const held = stretchPress.current;
          const lane = e.currentTarget.parentElement;
          if (!held || held.key !== u.key || held.side !== side || !lane) return;
          if (!held.moved && Math.abs(e.clientX - held.x0) < 3) return;
          if (!held.moved) onDragStart?.();
          held.moved = true;
          const next = stretchTo(u, e.clientX, lane);
          if (next) setStretchDraft(next);
        }}
        onPointerUp={(e) => {
          const held = stretchPress.current;
          const lane = e.currentTarget.parentElement;
          // Worked out while the press is still held: stretchTo reads it.
          const next = held?.moved && lane ? stretchTo(u, e.clientX, lane) : null;
          stretchPress.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          setStretchDraft(null);
          if (next) onStretch(u, next.rate, side === 'L' ? next.start : undefined);
        }}
        onPointerCancel={() => {
          stretchPress.current = null;
          setStretchDraft(null);
        }}
      >
        <span
          className={`absolute inset-y-[18%] left-1/2 -ml-[1.5px] w-[3px] rounded-full bg-slate-100 transition-opacity ${
            live || u.key === selectedKey ? 'opacity-90' : 'opacity-0 group-hover/edge:opacity-90'
          }`}
        />
      </span>
    );
  };
  return (
    <>
      {measured && <span ref={probe} aria-hidden="true" className="hidden" />}
      {visible.map((u) => {
        const over = u.estimate - u.slot;
        const hue = hueOf(u.index);
        const selected = u.key === selectedKey;
        const parts = partsOf.get(u.key) ?? lanePartsOf(u);
        const cut = parts.length > 1;
        const start = parts[0].start;
        const finish = lastEnd(u);
        const room = roomEnd(u);
        const trim = cut ? undefined : drag?.key === u.key ? drag.seconds : u.wantSeconds;
        const handleAt = trim ?? Math.min(u.estimate, u.slot);
        const title = `${u.text}\nAbout ${u.estimate.toFixed(1)} s${readNote(u)}${
          u.expert ? ` (${u.expert.low.toFixed(1)} to ${u.expert.high.toFixed(1)} s, ${u.expert.syllables} syllables)` : ''
        } · slot ${u.slot.toFixed(1)} s${over > 0 ? ` · +${over.toFixed(1)} s` : ''}${
          u.wantSeconds !== undefined ? ` · your trim ${u.wantSeconds.toFixed(1)} s` : ''
        }${onSelect ? '\nClick to pick this line' : ''}${onPlace ? ' · drag to move it' : ''}${onCut ? '\nPoint between two words: where the knife shows, a click (or S) cuts it there' : ''}`;
        const words = rythmo && !cut ? u.expert?.words : undefined;
        const shape = words ? undefined : shapes?.get(u.key);
        // Its fit is drawn with the Fit layer on, and always on the line picked or being stretched.
        const showFit = layers.fit || selected || stretchDraft?.key === u.key;
        const drawn = words ? 'rythmo' : !shape || look === 'bars' || (look === 'blocks' && pxPerSecond < BLOCKS_MIN_PX_PER_SECOND) ? 'bars' : look;
        if (editable && editing?.key === u.key)
          return (
            <BarLineEditor
              key={u.key}
              unit={u}
              text={editing.text}
              onChange={(text) => setEditing({ key: u.key, text })}
              onDone={(save) => {
                const text = editing.text.replace(/\s+/g, ' ').trim();
                setEditing(null);
                if (save && text && text !== u.text.trim()) onEditLine?.(u, text);
              }}
              start={start}
              room={room}
              pct={pct}
            />
          );
        return (
          <React.Fragment key={u.key}>
            {/* The line's room: from where it starts to where the next phrase starts, less a breath. Amber at its end when the line nearly fills it. */}
            {showFit && (
              <span
                aria-hidden="true"
                className="absolute top-0.5 bottom-0.5 rounded-md border border-dashed pointer-events-none"
                style={{
                  left: `${pct(start)}%`,
                  width: `${Math.max(0.3, pct(Math.max(room, start)) - pct(start))}%`,
                  borderColor: withAlpha(hue, 0.5),
                  background: withAlpha(hue, 0.05),
                  ...(u.status === 'tight' && { borderRightColor: STATUS_HEX.tight, borderRightStyle: 'solid', borderRightWidth: 2 }),
                }}
              />
            )}
            {parts.map((p) => {
              const length = p.to - p.from;
              const width = pct(p.start + length) - pct(p.start);
              const dragging = placeDrag?.key === u.key && placeDrag.part === p.index;
              const partWords = shape?.words.slice(p.first, p.last + 1).map((w) => ({ ...w, start: w.start - p.from, end: w.end - p.from })) ?? [];
              const path = drawn === 'wave' ? (cut ? wavePath(partWords, length, barStep) : shape?.path ?? '') : '';
              // Past this share of the part it runs over the line's room, and turns red.
              const inSlot = length > 0 ? Math.min(1, Math.max(0, (room - p.start) / length)) : 1;
              /** The knife is out over this part: a click cuts where it shows. */
              const knifeHere = knifeOut?.key === u.key && knifeOut.part === p.index ? knifeOut : null;
              const pick =
                onSelect || onCut
                  ? (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (clickHandled.current) {
                        clickHandled.current = false;
                        return;
                      }
                      if (knifeHere && onCut) {
                        onCut(u, knifeHere.letters, true);
                        lastCut.current = Date.now();
                        setCutPreview(null);
                        return;
                      }
                      onSelect?.(u);
                    }
                  : undefined;
              return (
                <React.Fragment key={`${u.key}-${p.index}`}>
                  {/* Where Sync would put a placed part: while dragging, on the picked line, or with the Fit layer */}
                  {(dragging || (p.placed && (layers.fit || (selected && !quiet)))) && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 bottom-1.5 rounded border border-dashed pointer-events-none"
                      style={{ left: `${pct(p.auto)}%`, width: `${Math.max(0.3, pct(p.auto + length) - pct(p.auto))}%`, borderColor: withAlpha(hue, 0.6) }}
                    />
                  )}
                  <span
                    title={`${title}${p.placed ? `\nPlaced by you, ${signedSeconds(p.start - p.auto)} from where Sync puts it · Backspace puts it back` : ''}${
                      editable ? '\nDouble-click to edit its words' : ''
                    }`}
                    onClick={pick}
                    onDoubleClick={(e) => {
                      // The double-click of a quick cut is only that cut: it doesn't zoom or open the words too.
                      if (Date.now() - lastCut.current < 600) {
                        e.stopPropagation();
                        return;
                      }
                      if (!editable) return;
                      // Here a double-click types in the bar instead of zooming to the line.
                      e.stopPropagation();
                      press.current = null;
                      setPlaceDrag?.(null);
                      setEditing({ key: u.key, text: u.text });
                    }}
                    onPointerDown={
                      onPlace && setPlaceDrag
                        ? (e) => {
                            if (e.button !== 0) return;
                            const lane = e.currentTarget.parentElement;
                            if (!lane) return;
                            press.current = { key: u.key, part: p.index, letters: p.letters, x0: e.clientX, grab: timeAt(e.clientX, lane) - p.start, moved: false, start: null };
                            try {
                              e.currentTarget.setPointerCapture(e.pointerId);
                            } catch {
                              // A pointer that is already gone: the press ends with it.
                            }
                          }
                        : undefined
                    }
                    onPointerMove={(e) => {
                      const lane = e.currentTarget.parentElement;
                      if (!lane) return;
                      const held = press.current;
                      if (held && held.key === u.key && held.part === p.index && setPlaceDrag) {
                        if (!held.moved && Math.abs(e.clientX - held.x0) < 3) return;
                        if (!held.moved) onDragStart?.();
                        held.moved = true;
                        const at = placeAt(u, p, timeAt(e.clientX, lane) - held.grab, lane);
                        held.start = at.start;
                        setGuide(at.snapped);
                        setPlaceDrag({ key: u.key, part: p.index, start: at.start });
                        return;
                      }
                      hover.current = { key: u.key, part: p.index, clientX: e.clientX, lane };
                      if (!onCut) return;
                      const next = cutAt(u, p, e.clientX, lane);
                      setCutPreview((was) =>
                        was && next && was.key === next.key && was.part === next.part && was.k === next.k && was.armed === next.armed && was.t === next.t ? was : next
                      );
                    }}
                    onPointerUp={(e) => {
                      const held = press.current;
                      press.current = null;
                      if (!held) return;
                      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                      if (held.moved) {
                        // The click that follows a drag doesn't pick the line too.
                        clickHandled.current = true;
                        onPlace?.(u, held.letters, held.start);
                      }
                      setPlaceDrag?.(null);
                      setGuide(null);
                    }}
                    onPointerCancel={() => {
                      press.current = null;
                      setPlaceDrag?.(null);
                      setGuide(null);
                    }}
                    onPointerLeave={() => {
                      if (press.current) return;
                      hover.current = null;
                      setCutPreview(null);
                    }}
                    className={`absolute top-1.5 bottom-1.5 border border-dashed touch-none cursor-default ${drawn === 'wave' ? 'rounded-[3px] overflow-hidden' : 'rounded'}`}
                    style={{
                      left: `${pct(p.start)}%`,
                      width: `${Math.max(0.3, width)}%`,
                      // Wave: a solid clip body under a pale wave, as Edit timing draws a clip.
                      background: drawn === 'wave' ? shadeOf(hue, 0.5) : drawn === 'bars' || drawn === 'rythmo' ? withAlpha(hue, words ? 0.1 : 0.28) : 'transparent',
                      borderColor: drawn === 'wave' ? shadeOf(hue, 0.3) : drawn === 'bars' || drawn === 'rythmo' ? hue : 'transparent',
                      boxShadow: quiet ? undefined : selected ? SELECTED_RING : u.key === currentKey ? NOW_RING : undefined,
                    }}
                  >
                    {/* Wave: thin bars, a group per estimated word, red past the line's room */}
                    {drawn === 'wave' && path && (
                      <svg aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1000 100" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id={`${gradientId}-${u.index}-${p.index}`} gradientUnits="userSpaceOnUse" x1="0" x2="1000" y1="0" y2="0">
                            <stop offset={showFit ? inSlot : 1} stopColor={tintOf(hue, 0.82)} />
                            <stop offset={showFit ? inSlot : 1} stopColor="#fda4af" />
                          </linearGradient>
                        </defs>
                        {/* Centre line and half-height guides, as on an Edit timing clip */}
                        <line x1="0" x2="1000" y1="50" y2="50" stroke={tintOf(hue, 0.6, 0.45)} vectorEffect="non-scaling-stroke" />
                        <line x1="0" x2="1000" y1="25" y2="25" stroke={tintOf(hue, 0.6, 0.22)} vectorEffect="non-scaling-stroke" />
                        <line x1="0" x2="1000" y1="75" y2="75" stroke={tintOf(hue, 0.6, 0.22)} vectorEffect="non-scaling-stroke" />
                        <path
                          d={path}
                          fill="none"
                          stroke={`url(#${gradientId}-${u.index}-${p.index})`}
                          strokeOpacity={0.95}
                          strokeWidth={1.3}
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                    )}
                    {/* Blocks: a box per estimated word, its text squeezed inside */}
                    {drawn === 'blocks' &&
                      length > 0 &&
                      partWords.map((w, n) => {
                        const late = p.start + w.end > room + 0.02;
                        const k = p.first + n;
                        const beside = knifeHere && (k === knifeHere.k || k === knifeHere.k + 1);
                        return (
                          <span
                            key={n}
                            aria-hidden="true"
                            className="absolute top-0 bottom-0 flex items-center justify-center overflow-hidden rounded-[3px] border text-[11px] leading-none whitespace-nowrap pointer-events-none transition-transform duration-150"
                            style={{
                              left: `${(w.start / length) * 100}%`,
                              width: `calc(${((w.end - w.start) / length) * 100}% - 1px)`,
                              background: late ? 'rgba(244,63,94,0.25)' : withAlpha(hue, 0.24),
                              borderColor: late ? '#fb7185' : withAlpha(hue, 0.85),
                              color: late ? '#fecdd3' : '#f1f5f9',
                              // Where the knife is out, the words either side part a little and are underlined in its colour.
                              ...(knifeHere && { transform: `translateX(${k <= knifeHere.k ? -2 : 2}px)` }),
                              ...(beside && { boxShadow: `inset 0 -2px 0 ${knifeTone}` }),
                            }}
                          >
                            <SqueezedWord text={w.text} boxPx={(w.end - w.start) * pxPerSecond - 1} />
                          </span>
                        );
                      })}
                    {/* Bars: the dub script inside the bar, broken between words, smaller only when it must */}
                    {drawn === 'bars' && (
                      <FitText
                        className="z-[5]"
                        fitKey={`${partText(u, p, parts.length)}|${u.index}|${layers.numbers}|${over > 0 && showFit}|${marksRate(u) ? u.rate : 1}|${knifeHere?.k ?? ''}`}
                      >
                        <span className="text-slate-50">
                          {layers.numbers && p.index === 0 && (
                            <span className="font-mono font-semibold" style={{ color: hue }}>
                              {u.index + 1}{' '}
                            </span>
                          )}
                          {knifeHere
                            ? // The knife is out: the bar's words show where it cuts, the two either side underlined.
                              (shape?.words ?? []).slice(p.first, p.last + 1).map((w, n) => {
                                const k = p.first + n;
                                return (
                                  <React.Fragment key={n}>
                                    {n > 0 &&
                                      (k - 1 === knifeHere.k ? (
                                        <span className="font-semibold" style={{ color: knifeTone }}>
                                          {' '}┊{' '}
                                        </span>
                                      ) : (
                                        ' '
                                      ))}
                                    <span
                                      style={
                                        k === knifeHere.k || k === knifeHere.k + 1
                                          ? { textDecoration: `underline 2px ${knifeTone}`, textUnderlineOffset: '3px' }
                                          : undefined
                                      }
                                    >
                                      {w.text}
                                    </span>
                                  </React.Fragment>
                                );
                              })
                            : partText(u, p, parts.length)}
                        </span>
                        {/* Each chunk its own length; the last says too how far the line runs past its room */}
                        <span
                          className="block font-mono text-[0.85em] tabular-nums whitespace-nowrap"
                          style={{ color: over > 0 && showFit && p.index === parts.length - 1 ? '#fda4af' : hue }}
                        >
                          ≈{(parts.length > 1 ? length : u.estimate).toFixed(1)} s{over > 0 && showFit && p.index === parts.length - 1 ? ` · +${over.toFixed(1)} s` : ''}
                          {/* Its speed beside its length, never over its words */}
                          {p.index === 0 && marksRate(u) && (
                            <span style={{ color: RATE_TONE[rateZone(u.rate ?? 1)] ?? '#e2e8f0' }}> · {rateText(u.rate ?? 1)}</span>
                          )}
                        </span>
                      </FitText>
                    )}
                    {!words && p.index === 0 && drawn !== 'bars' && lineNumber(u, width, STATUS_DOT[u.status])}
                    {!words && drawn === 'wave' && p.index === parts.length - 1 && width > 9 && (!quiet || layers.numbers) && (
                      <span className="absolute right-1.5 bottom-1 font-mono text-[9.5px] tabular-nums pointer-events-none" style={{ color: hue }}>
                        {u.expert ? '' : '≈'}
                        {u.estimate.toFixed(1)} s
                      </span>
                    )}
                    {/* Placed by hand: a flag at its start, and while dragged how far it is from Sync's place */}
                    {p.placed && !dragging && !quiet && (
                      <span aria-hidden="true" className="absolute -top-px -left-px w-0 h-0 border-t-[7px] border-r-[7px] border-t-indigo-200 border-r-transparent pointer-events-none" />
                    )}
                    {dragging && (
                      <span className="absolute z-20 left-1 top-0.5 rounded bg-slate-100 px-1 font-mono text-[9.5px] leading-[13px] text-slate-950 tabular-nums pointer-events-none whitespace-nowrap">
                        {p.placed ? signedSeconds(p.start - p.auto) : 'Sync places it'}
                      </span>
                    )}
                  </span>
                  {/* A cut: notches top and bottom, white at a pause, amber where the voice runs on, cyan at the original's pause */}
                  {p.index > 0 &&
                    !quiet &&
                    (() => {
                      const tone = p.byPause ? CUT_TONES.pause : p.atPause ? CUT_TONES.stop : CUT_TONES.runOn;
                      const mark = p.byPause ? u.pauseMarks?.find((m) => m.letters === p.letters) : undefined;
                      return (
                        <span
                          title={
                            p.byPause
                              ? `Cut at the original's pause${mark ? ` (${mark.seconds.toFixed(1)} s)` : ''}: this part starts where the speaker starts again\nDouble-click to leave the line uncut here · drag the part to place it yourself`
                              : `${p.atPause ? 'Cut at a pause' : "Cut where the voice doesn't pause: it may stop mid-sentence"}\nDouble-click to join the parts again`
                          }
                          className="absolute z-10 top-0 bottom-0 w-3 -ml-1.5 cursor-default"
                          style={{ left: `${pct((partEnd(parts[p.index - 1]) + p.start) / 2)}%` }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            if (p.byPause) onSkipPause?.(u, p.letters, true);
                            else onCut?.(u, p.letters, false);
                          }}
                        >
                          {/* A clear split through the wave, like a razor cut, with a solid line in it */}
                          <span className="absolute top-0 bottom-0 left-1/2 -ml-[2px] w-[4px] bg-slate-950" />
                          <span className={`absolute top-0 bottom-0 left-1/2 -ml-px w-[2px] ${tone.line}`} />
                          <span className={`absolute top-0 left-1/2 -ml-[5px] w-0 h-0 border-x-[5px] border-x-transparent border-t-[7px] ${tone.top}`} />
                          <span className={`absolute bottom-0 left-1/2 -ml-[5px] w-0 h-0 border-x-[5px] border-x-transparent border-b-[7px] ${tone.bottom}`} />
                        </span>
                      );
                    })()}
                </React.Fragment>
              );
            })}
            {/* The original's pauses the line isn't cut at: left to the voice, kept whole so it runs no later, or turned off */}
            {!quiet &&
              u.pauseMarks
              ?.filter((m) => m.state !== 'cut')
              .map((m) => {
                const markLook = PAUSE_MARK_LOOK[m.state as keyof typeof PAUSE_MARK_LOOK];
                return (
                  <span
                    key={`pause-${m.letters}`}
                    title={markLook.title(m.seconds)}
                    className="absolute z-10 top-0 bottom-0 w-3 -ml-1.5 cursor-default"
                    style={{ left: `${pct(m.t)}%` }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      onSkipPause?.(u, m.letters, m.state !== 'skipped');
                    }}
                  >
                    <span className={`absolute top-1 bottom-1 left-1/2 -ml-px w-0 border-l-2 border-dashed ${markLook.tick}`} />
                  </span>
                );
              })}
            {/* Rythmo: each word where it is likely said, red once past the line's room */}
            {words?.map((w, n) => (
              <RythmoWord
                key={n}
                text={w.text}
                late={start + w.end > room + 0.02}
                className="text-[12px]"
                left={`${pct(start + w.start)}%`}
                width={`${Math.max(0.2, pct(start + w.end) - pct(start + w.start))}%`}
              />
            ))}
            {/* Expert: a fast to a slow read, in the colour of how it fits */}
            {u.expert && !words && !cut && (!quiet || showFit) && (
              <span
                aria-hidden="true"
                className="absolute bottom-[7px] h-[2px] rounded-full pointer-events-none"
                style={{
                  left: `${pct(start + u.expert.low)}%`,
                  width: `${Math.max(0.2, pct(start + u.expert.high) - pct(start + u.expert.low))}%`,
                  background: STATUS_HEX[u.status],
                }}
              />
            )}
            {WINDOW_SECONDS <= LIP_MARK_SECONDS && (!quiet || showFit) && u.expert?.dubLips.map((t, n) => <LipMark key={`lip-${n}`} up left={`${pct(lineTimeAt(u, t))}%`} />)}
            {over > 0 && showFit && u.status === 'long' && (drawn === 'wave' || drawn === 'blocks') && (
              // Wave and Blocks: the time past the room striped red, ending in a red edge.
              <span
                title={title}
                className={`absolute top-1.5 bottom-1.5 rounded-r border-r-2 border-rose-400 pointer-events-none ${OVER_LONG_SOFT}`}
                style={{ left: `${pct(room)}%`, width: `${Math.max(0.3, pct(finish) - pct(room))}%` }}
              />
            )}
            {over > 0 && showFit && u.status === 'long' && drawn !== 'bars' && (
              // How much too long, only on a line that runs past its room (Bars write it in the bar).
              <span
                aria-hidden="true"
                className="absolute z-10 top-1 h-4 px-1.5 rounded-full border border-rose-400/80 bg-slate-950/95 font-mono text-[10px] leading-[14px] text-rose-300 whitespace-nowrap pointer-events-none"
                style={{ left: `calc(${pct(finish)}% + 4px)` }}
              >
                +{over.toFixed(1)} s
              </span>
            )}
            {over > 0 && showFit && u.status !== 'long' && (drawn === 'wave' || drawn === 'blocks') && (
              // Wave and Blocks: a tight line's time past the room as a line under it.
              <span
                title={title}
                className="absolute bottom-0.5 h-[3px] rounded-full pointer-events-none bg-amber-300/80"
                style={{ left: `${pct(room)}%`, width: `${Math.max(0.3, pct(finish) - pct(room))}%` }}
              />
            )}
            {over > 0 && showFit && drawn !== 'wave' && drawn !== 'blocks' && (
              <span
                title={title}
                className={`absolute top-1.5 bottom-1.5 rounded-r pointer-events-none ${u.status === 'long' ? OVER_LONG : OVER_TIGHT}`}
                style={{ left: `${pct(room)}%`, width: `${Math.max(0.3, pct(finish) - pct(room))}%` }}
              />
            )}
            {/* Stretched: a line under it, in the colour of how the speed sounds */}
            {marksRate(u) && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 h-[2px] rounded-full pointer-events-none"
                style={{
                  left: `${pct(start)}%`,
                  width: `${Math.max(0.3, pct(finish) - pct(start))}%`,
                  background: RATE_TONE[rateZone(u.rate ?? 1)] ?? withAlpha(hue, 0.55),
                }}
              />
            )}
            {stretchEdge(u, parts, 'L')}
            {stretchEdge(u, parts, 'R')}
            {u.status === 'short' && showFit && (
              <span
                title={`${u.text}\nEnds about ${u.underflow.toFixed(1)} s before the original speaker stops`}
                className={`absolute top-1.5 bottom-1.5 rounded-r ${QUIET_BOX}`}
                style={{ left: `${pct(finish)}%`, width: `${Math.max(0.3, pct(Math.max(finish, u.srcEnd)) - pct(finish))}%` }}
              />
            )}
            {/* Pointed at: a dot at every gap the line can be cut at, cyan where the original speaker pauses */}
            {cutPreview?.key === u.key &&
              !placeDrag &&
              !stretchDraft &&
              (() => {
                const p = parts.find((q) => q.index === cutPreview.part);
                if (!p) return null;
                return gapsOf(u, p).map((g) => {
                  const on = knifeOut?.key === u.key && knifeOut.k === g.k;
                  const size = on ? 8 : g.srcPause !== null ? 6 : g.punct ? 5 : 4;
                  return (
                    <span
                      key={`gap-${g.k}`}
                      aria-hidden="true"
                      className={`absolute z-20 bottom-[3px] rounded-full pointer-events-none cut-dot ${g.srcPause !== null && !on ? 'cut-dot-pause' : ''}`}
                      style={{
                        left: `calc(${pct(g.t)}% - ${size / 2}px)`,
                        width: size,
                        height: size,
                        background: on ? knifeTone : g.srcPause !== null ? KNIFE_TONE.pause : g.punct ? '#cbd5e1' : '#64748b',
                        boxShadow: on ? `0 0 0 1.5px rgb(2 6 23 / 0.9), 0 0 8px ${knifeTone}` : '0 0 0 1.5px rgb(2 6 23 / 0.85)',
                      }}
                    />
                  );
                });
              })()}
            {/* Near a gap but not on it: a faint line where S would cut */}
            {cutPreview?.key === u.key && !cutPreview.armed && !placeDrag && !stretchDraft && (
              <span
                aria-hidden="true"
                className={`absolute z-10 top-0.5 bottom-0.5 w-0 border-l border-dashed pointer-events-none ${cutPreview.punct || cutPreview.srcPause !== null ? 'border-slate-300/70' : 'border-amber-300/60'}`}
                style={{ left: `${pct(cutPreview.t)}%` }}
              />
            )}
            {/* The knife is out: where the rest of the line would go, the cut itself, and what it cuts between */}
            {knifeOut?.key === u.key && ghost && (
              <span
                aria-hidden="true"
                className="absolute z-10 top-1 bottom-1 rounded border border-dashed pointer-events-none cut-dot"
                style={{
                  left: `${pct(ghost.start)}%`,
                  width: `${Math.max(0.3, pct(ghost.end) - pct(ghost.start))}%`,
                  borderColor: withAlpha(knifeTone, 0.85),
                  background: withAlpha(knifeTone, 0.07),
                }}
              />
            )}
            {knifeOut?.key === u.key &&
              (() => {
                const words = shapes.get(u.key)?.words ?? estimatedWords(u);
                const at = pct(knifeOut.t);
                return (
                  <>
                    {/* Just a light line where it cuts */}
                    <span
                      aria-hidden="true"
                      className="absolute z-20 top-0.5 bottom-0.5 w-px -ml-px rounded-full pointer-events-none"
                      style={{ left: `${at}%`, background: withAlpha(knifeTone, 0.8), boxShadow: `0 0 3px ${withAlpha(knifeTone, 0.35)}` }}
                    />
                    <span
                      aria-hidden="true"
                      className="absolute z-30 top-0.5 rounded-md bg-slate-100 px-1.5 text-[10.5px] leading-[15px] text-slate-950 whitespace-nowrap pointer-events-none shadow-lg"
                      style={{ left: `${at}%`, transform: at > 62 ? 'translateX(calc(-100% - 11px))' : 'translateX(11px)' }}
                    >
                      {words[knifeOut.k]?.text} <span className="font-semibold" style={{ color: knifeOut.srcPause !== null ? '#0891b2' : '#b45309' }}>┊</span> {words[knifeOut.k + 1]?.text}
                      <span className="font-mono text-slate-500"> · {knifeOut.into.toFixed(1)} s in</span>
                      {knifeOut.srcPause !== null && <span className="font-mono text-cyan-700"> · original pauses {knifeOut.srcPause.toFixed(1)} s</span>}
                      <span className="text-slate-500"> · click to cut</span>
                    </span>
                  </>
                );
              })()}
            {trim !== undefined && (
              <span
                aria-hidden="true"
                className={`absolute top-0.5 bottom-0.5 rounded pointer-events-none ${TRIM_BOX}`}
                style={{ left: `${pct(start)}%`, width: `${Math.max(0.3, pct(start + trim) - pct(start))}%` }}
              />
            )}
            {selected && !cut && onTrim && setDrag && (
              <span
                role="slider"
                tabIndex={0}
                aria-label="Trim out: the length this line should take"
                aria-valuemin={MIN_TRIM_SECONDS}
                aria-valuemax={Math.round(u.slot * 10) / 10}
                aria-valuenow={Math.round(handleAt * 10) / 10}
                aria-valuetext={`${handleAt.toFixed(1)} seconds`}
                title="Drag to the length this line should take"
                className="absolute z-10 top-0 bottom-0 w-2 -ml-1 rounded-sm bg-indigo-300 hover:bg-indigo-200 cursor-ew-resize touch-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                style={{ left: `${pct(start + handleAt)}%` }}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  try {
                    e.currentTarget.setPointerCapture(e.pointerId);
                  } catch {
                    // A pointer that is already gone: the drag still follows moves over the handle.
                  }
                  onDragStart?.();
                  setDrag({ key: u.key, seconds: handleAt });
                }}
                onPointerMove={(e) => {
                  if (drag?.key !== u.key || !e.currentTarget.parentElement) return;
                  setDrag({ key: u.key, seconds: trimAt(u, e.clientX, e.currentTarget.parentElement) });
                }}
                onPointerUp={(e) => {
                  if (drag?.key !== u.key) return;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                  onTrim(u, drag.seconds);
                  setDrag(null);
                }}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => {
                  const step = e.key === 'ArrowRight' ? 0.1 : e.key === 'ArrowLeft' ? -0.1 : 0;
                  if (!step) return;
                  e.preventDefault();
                  onTrim(u, Math.max(MIN_TRIM_SECONDS, Math.min(u.slot, Math.round((handleAt + step) * 10) / 10)));
                }}
              />
            )}
          </React.Fragment>
        );
      })}
      {/* Snapped while dragging: the original's word, or Sync's own place, it landed on */}
      {guide !== null && placeDrag && (
        <span aria-hidden="true" className="absolute z-20 top-0 bottom-0 w-px bg-amber-200 pointer-events-none" style={{ left: `${pct(guide)}%` }} />
      )}
    </>
  );
};

/** How a stretch sounds, in words. */
const RATE_WORDS = { natural: 'Natural', quick: 'A little quick', rushed: 'Rushed', slow: 'Slow, it drags' } as const;
/** The speed meter's bands, 0.5× to 2×: dragged, natural, quick, rushed. */
const METER_BANDS: [number, number, string][] = [
  [MIN_LINE_RATE, SLOW_RATE, 'bg-amber-900/70'],
  [SLOW_RATE, QUICK_RATE, 'bg-slate-700'],
  [QUICK_RATE, RUSHED_RATE, 'bg-amber-700/80'],
  [RUSHED_RATE, MAX_LINE_RATE, 'bg-rose-800/80'],
];
const meterAt = (rate: number) => ((Math.min(MAX_LINE_RATE, Math.max(MIN_LINE_RATE, rate)) - MIN_LINE_RATE) / (MAX_LINE_RATE - MIN_LINE_RATE)) * 100;

/**
 * The picked line's card under Review's lanes: its words, a meter of how long
 * the dub likely runs against its room (the white tick is where the original
 * speaker stops), how it fits in words, and what fixes it: another wording,
 * a speed that fits, Back to 1× once stretched, and Open line. Its wordings,
 * once asked for, are worked on right here. In Card view the speed meter
 * shows here too, and the lane keeps no speed marks.
 */
export const LineFitCard: React.FC<{
  unit: SyncPreviewUnit | null;
  cps: number;
  /** Which cues the line is, as the list numbers them ("8–10"). */
  cues?: string;
  fix: Omit<LineFixControlsProps, 'unit' | 'cps'> | null;
  onStretch: (unit: SyncPreviewUnit, rate: number) => void;
  onOpen?: (unit: SyncPreviewUnit) => void;
  /** Card view: the speed meter, always. */
  showSpeed?: boolean;
}> = ({ unit, cps, cues, fix, onStretch, onOpen, showSpeed = false }) => {
  if (!unit) {
    return (
      <div className="mx-3.5 mb-2.5 rounded-xl border border-edge/70 px-3 py-2 text-[12px] text-slate-500">
        Pick a dub line to see how it fits its room, and fix it here.
      </div>
    );
  }
  const hue = hueOf(unit.index);
  const rate = unit.rate ?? 1;
  const zone = rateZone(rate);
  const tone = RATE_TONE[zone];
  const stretched = Math.abs(rate - 1) >= 0.005;
  const over = unit.estimate - unit.slot;
  const words = Math.max(1, unit.text.trim().split(/\s+/).filter(Boolean).length);
  const overWords = Math.max(1, Math.round(over / Math.max(0.05, unit.estimate / words)));
  const round2 = (r: number) => Math.round(r * 100) / 100;
  // The speed it would fit its room at, or fill the original's speech at when it ends early.
  const fitRate = unit.slot > 0 ? round2(rate * (unit.estimate / unit.slot)) : null;
  const fillRate = unit.spoken > 0 ? round2(rate * (unit.estimate / unit.spoken)) : null;
  const speedFix =
    (unit.status === 'long' || unit.status === 'tight') && fitRate && fitRate > rate + 0.005 && fitRate <= MAX_LINE_RATE
      ? fitRate
      : unit.status === 'short' && fillRate && fillRate < rate - 0.005 && fillRate >= MIN_LINE_RATE
        ? fillRate
        : null;
  const wording = unit.status === 'long' || unit.status === 'tight' || zone === 'rushed' ? 'shorter' : unit.status === 'short' || zone === 'slow' ? 'longer' : null;
  const started = fix && fix.state.kind !== 'idle';
  // The meter: the room, the dub as far as it runs (red past the room) and where the speaker stops.
  const scale = Math.max(unit.slot, unit.estimate, unit.spoken) * 1.04 || 1;
  const at = (s: number) => `${(Math.max(0, s) / scale) * 100}%`;
  const fill = Math.min(unit.estimate, unit.slot);
  const message =
    unit.status === 'long' ? (
      <>
        <b className="text-rose-300 font-semibold">{over.toFixed(1)} s too long</b>
        <span className="text-slate-400"> · about {overWords} word{overWords === 1 ? '' : 's'} over</span>
      </>
    ) : unit.status === 'tight' ? (
      <>
        <b className="text-amber-300 font-semibold">Tight</b>
        <span className="text-slate-400">
          {' '}
          · fills {Math.round((unit.estimate / Math.max(0.01, unit.slot)) * 100)}% of its room
          {over > 0 ? `, ${over.toFixed(1)} s over` : `, ${(-over).toFixed(1)} s to spare`}
        </span>
      </>
    ) : unit.status === 'short' ? (
      <>
        <b className="text-sky-300 font-semibold">Ends early</b>
        <span className="text-slate-400"> · {unit.underflow.toFixed(1)} s before the speaker stops</span>
      </>
    ) : (
      <>
        <b className="text-emerald-300 font-semibold">Fits</b>
        <span className="text-slate-400"> · {Math.max(0, -over).toFixed(1)} s to spare</span>
      </>
    );
  const btn = 'h-7 px-2.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 text-[12px] text-slate-200 hover:bg-slate-800 whitespace-nowrap cursor-default';
  return (
    <div className="mx-3.5 mb-2.5 rounded-xl border px-3 py-2" style={{ borderColor: withAlpha(hue, 0.35), background: withAlpha(hue, 0.05) }}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2 text-[11.5px] text-slate-500 whitespace-nowrap">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: hue }} />
          <span className="font-mono font-semibold" style={{ color: hue }}>
            Line {unit.index + 1}
          </span>
          {cues && <span className="font-mono">cues {cues}</span>}
        </div>
        <p className="min-w-[14rem] flex-1 text-[14px] text-slate-100 leading-snug line-clamp-2" lang="und">
          {unit.text}
        </p>
        <div
          className="w-52 shrink-0"
          title={`About ${unit.estimate.toFixed(1)} s, a guess from the text · room ${unit.slot.toFixed(1)} s · the original speaker talks ${unit.spoken.toFixed(1)} s (white tick)`}
        >
          <div className="relative h-2.5 rounded-full bg-slate-800 border border-slate-700">
            <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: at(fill), background: hue, opacity: 0.85 }} />
            {over > 0 && (
              <span className={`absolute inset-y-0 rounded-r-full ${unit.status === 'long' ? 'bg-rose-400' : 'bg-amber-300'}`} style={{ left: at(unit.slot), width: at(over) }} />
            )}
            <span className="absolute -top-1 -bottom-1 w-px bg-white/80" style={{ left: at(unit.spoken) }} />
            <span className="absolute -top-1.5 -bottom-1.5 w-0.5 -ml-px rounded-full bg-slate-300" style={{ left: at(unit.slot) }} />
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10.5px] text-slate-400 tabular-nums">
            <span>dub ≈ {unit.estimate.toFixed(1)} s</span>
            <span>room {unit.slot.toFixed(1)} s</span>
          </div>
        </div>
        <div className="text-[12.5px] min-w-[12rem]">
          <div>{message}</div>
          {(stretched || showSpeed) && (
            <div className="mt-0.5 flex items-center gap-2 text-[11.5px]">
              <span className="font-mono tabular-nums" style={{ color: tone ?? '#e2e8f0' }}>
                Read at {rate.toFixed(2)}×
              </span>
              <span style={{ color: tone ?? '#4ade80' }}>{RATE_WORDS[zone]}</span>
            </div>
          )}
          {showSpeed && (
            <div className="relative mt-1 w-44" title="0.5× to 2×: natural up to 1.15×, a little quick to 1.3×, rushed past it; slower than 0.85× drags">
              <div className="flex h-1.5 rounded-full overflow-hidden">
                {METER_BANDS.map(([a, b, cls]) => (
                  <span key={a} className={cls} style={{ width: `${((b - a) / (MAX_LINE_RATE - MIN_LINE_RATE)) * 100}%` }} />
                ))}
              </div>
              <span className="absolute -top-1 w-[3px] h-3.5 -ml-[1.5px] rounded-full bg-slate-100" style={{ left: `${meterAt(rate)}%` }} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!started && wording && fix && (
            <button
              type="button"
              onClick={() => fix.onSuggest(wording)}
              className={btn}
              title={wording === 'shorter' ? 'Wordings with fewer words, same meaning' : 'Fuller wordings, same meaning'}
            >
              {wording === 'shorter' ? '↓ Shorter wording' : '↑ Longer wording'}
            </button>
          )}
          {speedFix && (
            <button
              type="button"
              onClick={() => onStretch(unit, speedFix)}
              className={btn}
              title={`Read it at ${speedFix.toFixed(2)}× (pitch kept) so it ${unit.status === 'short' ? 'fills the original speech' : 'fits its room'}: ${RATE_WORDS[rateZone(speedFix)].toLowerCase()}`}
            >
              <span style={{ color: RATE_TONE[rateZone(speedFix)] ?? undefined }}>Read {speedFix.toFixed(2)}×</span>
            </button>
          )}
          {stretched && (
            <button type="button" onClick={() => onStretch(unit, 1)} className={btn}>
              Back to 1×
            </button>
          )}
          {onOpen && (
            <button type="button" onClick={() => onOpen(unit)} className={btn} title="Open its last cue in the list, ready to type">
              Open line
            </button>
          )}
        </div>
      </div>
      {fix && started && (
        <div className="mt-2 pt-2 border-t border-edge/70">
          <LineFixControls unit={unit} cps={cps} {...fix} />
        </div>
      )}
    </div>
  );
};

/**
 * The row under Review's dub lane: under each line stretched past what sounds
 * natural, a button for another wording, Shorter when it is rushed (faster
 * than RUSHED_RATE) and Longer when it drags (slower than SLOW_RATE). Nothing
 * is asked for until the button is pressed. × hides it for the line at that
 * speed; a new stretch or new words bring it back.
 */
export const WordingSuggestRow: React.FC<{
  units: SyncPreviewUnit[];
  windowStart: number;
  windowSeconds: number;
  busy: (unit: SyncPreviewUnit) => boolean;
  onSuggest: (unit: SyncPreviewUnit, direction: 'shorter' | 'longer') => void;
}> = ({ units, windowStart, windowSeconds, busy, onSuggest }) => {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const pct = (t: number) => ((t - windowStart) / windowSeconds) * 100;
  return (
    <>
      {units.map((u) => {
        const zone = rateZone(u.rate ?? 1);
        if (zone !== 'rushed' && zone !== 'slow') return null;
        const id = `${u.key}|${u.text}|${(u.rate ?? 1).toFixed(2)}`;
        if (hidden.has(id)) return null;
        const at = lanePartsOf(u)[0].start;
        if (at < windowStart - windowSeconds * 0.1 || at > windowStart + windowSeconds) return null;
        const shorter = zone === 'rushed';
        const working = busy(u);
        return (
          <span
            key={u.key}
            className={`absolute top-1 h-5 flex items-center rounded-full border text-[11px] leading-none whitespace-nowrap ${
              shorter ? 'border-rose-500/60 bg-rose-950/80 text-rose-200' : 'border-amber-500/60 bg-amber-950/80 text-amber-200'
            }`}
            style={{ left: `max(0px, ${pct(at)}%)` }}
          >
            <button
              type="button"
              disabled={working}
              onClick={() => onSuggest(u, shorter ? 'shorter' : 'longer')}
              title={`Line ${u.index + 1} is read at ${(u.rate ?? 1).toFixed(2)}×: ${
                shorter ? 'faster than sounds natural. Ask for a shorter wording' : 'slower than sounds natural. Ask for a longer wording'
              } (it opens in the list below)`}
              className="h-full pl-2 pr-1.5 flex items-center gap-1 cursor-default disabled:opacity-70"
            >
              {working ? <Loader2 className="w-3 h-3 animate-spin" /> : <span aria-hidden="true">{shorter ? '↓' : '↑'}</span>}
              {working ? 'Asking…' : shorter ? 'Shorter wording' : 'Longer wording'}
            </button>
            <button
              type="button"
              aria-label="Keep this speed"
              title="Keep this speed: hide the suggestion"
              onClick={() => setHidden((was) => new Set(was).add(id))}
              className="h-full pr-1.5 pl-0.5 flex items-center opacity-70 hover:opacity-100 cursor-default"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        );
      })}
    </>
  );
};

/** Seconds with their sign, for how far a part was moved. */
const signedSeconds = (d: number) => `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} s`;

/**
 * The report's timeline, before a sync: the original's waveform and lines
 * above, the dub lines where Sync will start them below, outlined in dashes
 * because their length is an estimate. Each line has its own colour, as in the
 * sync report (lineColors.ts), and a dot by its number for how it is likely to
 * fit. The part of a line estimated to run past its slot has an amber strip
 * under it; the part of the original speech a short line leaves silent is a
 * dashed box; a thin mark shows where each slot ends.
 *
 * Given onSelect and onTrim, a dub bar can be picked and its end dragged to
 * the length the user wants the line to take: a trim. Only the length counts;
 * Sync still starts the line where its sentence starts, so there is no
 * trim-in handle. A trim never runs past the next line's start.
 */
export const PreviewTimeline: React.FC<{
  units: SyncPreviewUnit[];
  reportedTime: number;
  getLiveTime?: () => number | null;
  onSeek: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  selectedKey?: string | null;
  onSelect?: (unit: SyncPreviewUnit) => void;
  /** Sets a line's trimmed length, in seconds. */
  onTrim?: (unit: SyncPreviewUnit, seconds: number) => void;
  /** For the readout while trimming: characters the trimmed length holds. */
  charsPerSecond?: number;
  /**
   * Shown instead of the playhead when what is heard is not on this
   * timeline's clock (an unsynced dub): the reason, and how to hear the original.
   */
  offClockNote?: React.ReactNode;
  /** The line under the playhead as it changes, or null between lines. */
  onCurrentLine?: (unit: SyncPreviewUnit | null) => void;
  /** The original, for the Original lane's waveform. */
  sourceBuffer?: AudioBuffer | null;
}> = ({ units, reportedTime, getLiveTime, onSeek, isPlaying, onTogglePlay, selectedKey, onSelect, onTrim, charsPerSecond, offClockNote, onCurrentLine, sourceBuffer }) => {
  const [drag, setDrag] = useState<{ key: string; seconds: number } | null>(null);
  // Expert lines can also be drawn as a Rythmo band: their words, each as wide as the time it takes.
  const expert = units.some((u) => u.expert);
  const [view, setView] = useState<'bars' | 'rythmo'>(() => {
    try {
      return localStorage.getItem(PREVIEW_VIEW_KEY) === 'rythmo' ? 'rythmo' : 'bars';
    } catch {
      return 'bars';
    }
  });
  const changeView = (next: 'bars' | 'rythmo') => {
    setView(next);
    try {
      localStorage.setItem(PREVIEW_VIEW_KEY, next);
    } catch {
      /* Storage off: the view lasts until the app closes. */
    }
  };
  const rythmo = expert && view === 'rythmo';
  // The clocks show tenths; the playheads move every frame through playheadRef.
  const currentTime = useLiveTime(reportedTime, isPlaying, getLiveTime, 0.1);
  const total = Math.max(0, ...units.map((u) => Math.max(u.srcEnd, u.srcStart + u.estimate)));
  // Opens on the whole dub; zooming in shows a window of it, as in the report's timeline.
  const zoom = useTimelineZoom(total, currentTime);
  const { windowStart, windowSeconds: WINDOW_SECONDS, ahead, follow, setFollow, scrollTo } = zoom;
  const playheadRef = useWindowPlayheads({
    reportedTime,
    isPlaying,
    getLiveTime,
    windowStart,
    windowSeconds: WINDOW_SECONDS,
    follow,
    onFollow: zoom.followTo,
    glideTo: zoom.glideTo,
    hidden: Boolean(offClockNote),
  });

  /*
   * The line under the playhead: from its start until the next line's, or
   * until its own dub would end if that is later. Picked out on both lanes
   * and spelled out below them, so the playhead and its line always agree.
   */
  const current = useMemo(() => {
    if (offClockNote) return null;
    let found: SyncPreviewUnit | null = null;
    for (const u of units) {
      if (u.srcStart > currentTime) break;
      const until = Math.max(u.nextStart ?? -Infinity, u.srcEnd, u.srcStart + u.estimate);
      if (currentTime < until) found = u;
    }
    return found;
  }, [units, currentTime, offClockNote]);
  const onCurrentLineRef = useRef(onCurrentLine);
  onCurrentLineRef.current = onCurrentLine;
  useEffect(() => {
    onCurrentLineRef.current?.(current);
  }, [current]);

  // Gliding, `ahead` more is drawn past the right edge, for the timeline to move into.
  const end = windowStart + WINDOW_SECONDS + ahead;
  const pct = (t: number) => ((t - windowStart) / WINDOW_SECONDS) * 100;
  const visible = useMemo(
    () => units.filter((u) => Math.max(u.srcEnd, u.srcStart + u.estimate) >= windowStart && u.srcStart <= end),
    [units, windowStart, end]
  );
  const onWheel = wheelScroll(WINDOW_SECONDS, (seconds) => scrollTo(zoom.viewStart() + seconds));
  const markers = useMemo(
    () =>
      units
        .filter((u) => u.status !== 'fits')
        .map((u) => ({ time: u.srcStart, tone: u.status === 'long' ? ('warn' as const) : ('soft' as const) })),
    [units]
  );
  const seekAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setFollow(true);
    onSeek(zoom.viewStart() + ((e.clientX - r.left) / r.width) * WINDOW_SECONDS);
  };
  const dragged = drag ? units.find((u) => u.key === drag.key) : undefined;
  const sourcePeaks = usePeaks(sourceBuffer);
  const sourceSpans = useMemo(() => units.map((u) => ({ from: u.srcStart, to: u.srcEnd, color: hueOf(u.index) })), [units]);
  /** The line's number in its colour, on a dark pill so it reads over the waveform; on the dub, with a dot for how it fits. */
  const lineNumber = (u: SyncPreviewUnit, seconds: number, dot?: string) =>
    pct(u.srcStart + seconds) - pct(u.srcStart) > 3.2 ? (
      <span
        className="absolute z-10 left-1 top-1 flex items-center gap-1 rounded bg-slate-950/85 px-1 font-mono text-[9.5px] font-semibold leading-[14px] pointer-events-none"
        style={{ color: hueOf(u.index) }}
      >
        {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
        {u.index + 1}
      </span>
    ) : null;
  const playhead = (index: number) => (
    <Playhead ref={playheadRef(index)} />
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {expert && (
          <div role="group" aria-label="Dub lane" className="flex bg-slate-950 border border-edge rounded-xl p-0.5 gap-0.5">
            {[
              { id: 'bars' as const, label: 'Bars', hint: 'Each line as a bar, with a fast to slow read under it' },
              { id: 'rythmo' as const, label: 'Rythmo', hint: 'The dub text on the timeline, each word as wide as the time it takes. Zoom in to read short lines.' },
            ].map((v) => (
              <button
                key={v.id}
                type="button"
                title={v.hint}
                aria-pressed={view === v.id}
                onClick={() => changeView(v.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-default ${
                  view === v.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <TimelineZoomControls zoom={zoom} />
        </div>
      </div>
      <div ref={zoom.lanesRef} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-center" style={{ overflowX: 'clip' }}>
        <span />
        <div className="relative">
          <TimelineRuler zoom={zoom} onSeek={(t) => onSeek(Math.max(0, Math.min(total, t)))} />
          {/* The playhead's head, on the ruler as in DaVinci Resolve */}
          <Playhead ref={playheadRef(2)} cap />
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="w-2 h-2 rounded-sm bg-cyan-400" /> Original
        </span>
        <div className="relative h-11 rounded-lg bg-slate-950/60 overflow-hidden cursor-default" onClick={seekAt} onWheel={onWheel}>
          <div ref={zoom.strip} className="absolute inset-0">
          {visible.map((u) => (
            <span
              key={u.key}
              title={u.sourceText}
              className={`absolute top-1.5 bottom-1.5 rounded ${u.key === current?.key ? 'ring-2 ring-white/80' : ''}`}
              style={{ left: `${pct(u.srcStart)}%`, width: `${Math.max(0.3, pct(u.srcEnd) - pct(u.srcStart))}%`, background: withAlpha(hueOf(u.index), 0.12) }}
            >
              {lineNumber(u, u.srcEnd - u.srcStart)}
            </span>
          ))}
          {/* Over the lines, in each line's colour */}
          <div className="absolute top-0 bottom-0 left-0" style={{ width: `${((WINDOW_SECONDS + ahead) / WINDOW_SECONDS) * 100}%` }}>
            <WindowWaveform data={sourcePeaks} from={windowStart} span={WINDOW_SECONDS + ahead} spans={sourceSpans} className="text-slate-400/30" />
          </div>
          {expert &&
            visible.flatMap((u) =>
              (u.expert?.sourceLips || []).filter((t) => t >= windowStart && t <= end).map((t, n) => <LipMark key={`${u.key}-${n}`} left={`${pct(t)}%`} />)
            )}
          </div>
          {playhead(0)}
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="w-2 h-2 rounded-sm border border-dashed border-indigo-300" /> {rythmo ? 'Rythmo' : 'Dub, est.'}
        </span>
        <div className="relative h-11 rounded-lg bg-slate-950/60 overflow-hidden cursor-default" onClick={seekAt} onWheel={onWheel}>
          <div ref={zoom.strip} className="absolute inset-0">
          <DubEstimateLane
            units={visible}
            windowStart={windowStart}
            windowSeconds={WINDOW_SECONDS}
            selectedKey={selectedKey}
            currentKey={current?.key}
            onSelect={onSelect}
            onTrim={onTrim}
            rythmo={rythmo}
            drag={drag}
            setDrag={setDrag}
            onDragStart={() => setFollow(false)}
          />
          </div>
          {playhead(1)}
        </div>
        {drag && dragged && (
          <>
            <span />
            <p role="status" className="font-mono text-[11.5px] text-indigo-200 tabular-nums">
              Trim out: {drag.seconds.toFixed(1)} s
              {dragged.expert
                ? ` ≈ ${Math.round(drag.seconds * dragged.expert.rate)} syllables`
                : charsPerSecond
                  ? ` ≈ ${Math.round(drag.seconds * charsPerSecond)} characters`
                  : ''}{' '}
              · now about {dragged.estimate.toFixed(1)} s
              {Math.abs(drag.seconds - dragged.spoken) < 0.01 ? ' · matches the original speech' : ''}
            </p>
          </>
        )}
        <span />
        <TimelineScrollbar
          total={total}
          windowStart={zoom.viewStart()}
          windowSeconds={WINDOW_SECONDS}
          currentTime={currentTime}
          markers={markers}
          onScroll={scrollTo}
        />
      </div>
      {offClockNote ? (
        <div className="rounded-xl border border-edge bg-slate-950/60 px-3 py-2 text-[12px] text-slate-300">{offClockNote}</div>
      ) : (
        <div className="min-h-[2.75rem] rounded-xl border border-edge bg-slate-950/60 px-3 py-1.5 text-[12px]" aria-live="polite">
          {current ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 font-mono tabular-nums">
                <span className="font-semibold text-slate-100">Now #{current.index + 1}</span>
                <span className="text-cyan-300">
                  Original {formatClock(current.srcStart)}–{formatClock(current.srcEnd)}
                </span>
                <span className={current.status === 'long' ? 'text-amber-300' : current.status === 'short' ? 'text-sky-300' : 'text-slate-400'}>
                  dub ≈ {current.estimate.toFixed(1)} s in a {current.slot.toFixed(1)} s slot
                </span>
              </div>
              <p className="text-slate-300 truncate">{current.text}</p>
            </>
          ) : (
            <span className="text-slate-500">{isPlaying ? 'Between lines' : 'Press play: the line under the playhead shows here.'}</span>
          )}
        </div>
      )}
      <TimelineTransport
        isPlaying={isPlaying}
        onTogglePlay={() => {
          setFollow(true);
          onTogglePlay();
        }}
        currentTime={currentTime}
        total={total}
      >
        <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm border border-dashed border-indigo-300 bg-indigo-300/15" /> Estimated length, in the line's colour</span>
        <span className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT.fits}`} /> Likely fits</span>
        <span className="flex items-center gap-1.5"><span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT.tight}`} /> Tight</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-[3px] rounded-full bg-amber-400" /> Runs past its slot</span>
        <span className="flex items-center gap-1.5"><span className={`w-3 h-2.5 rounded-sm ${QUIET_BOX}`} /> Speaker still talking, dub quiet</span>
        <span className="flex items-center gap-1.5"><span className="w-px h-3 bg-slate-500" /> Next line starts</span>
        {expert && !rythmo && (
          <span className="flex items-center gap-1.5"><span className="w-3 h-[2px] rounded-full bg-emerald-400" /> Fast to slow read</span>
        )}
        {rythmo && (
          <span className="flex items-center gap-1.5"><span className="text-rose-300 text-[11px] leading-none">अ</span> Words past the slot</span>
        )}
        {expert && (
          <span className="flex items-center gap-1.5">
            <span className="w-0 h-0 border-x-[4px] border-x-transparent border-t-[6px] border-t-amber-300" />
            <span className="w-0 h-0 border-x-[4px] border-x-transparent border-b-[6px] border-b-amber-300" /> Lips close (p, b, m): original, dub
          </span>
        )}
        {onTrim && (
          <span className="flex items-center gap-1.5"><span className={`w-3 h-2.5 rounded-sm ${TRIM_BOX}`} /> Your trim</span>
        )}
      </TimelineTransport>
    </div>
  );
};
