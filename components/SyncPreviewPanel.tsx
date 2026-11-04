import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Pencil, RefreshCw, RotateCcw, X } from 'lucide-react';
import { TimelineRuler, TimelineScrollbar, TimelineTransport, TimelineZoomControls, useTimelineZoom, useWindowPlayheads, wheelScroll } from './TimelineControls';
import { useLiveTime } from './useLiveTime';
import { hueOf, withAlpha } from './lineColors';
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
import { LINE_GAP_SECONDS, PART_GAP_SECONDS, PAUSE_MARK, estimatedWords, lanePartsOf, letterCount, lineTimeAt, partEnd, roomEnd, type LinePart } from '../services/linePlaces';

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
/** How the dub lane draws its lines: Wave, Blocks, Bars, or (Expert only) Rythmo. */
const PREVIEW_VIEW_KEY = 'dhvani_preview_view';
export type LaneView = 'wave' | 'blocks' | 'bars' | 'rythmo';
const LANE_VIEWS: LaneView[] = ['wave', 'blocks', 'bars', 'rythmo'];
/** Zoomed out past this many pixels a second, Blocks draws each line as one bar: its words would be slivers. */
const BLOCKS_MIN_PX_PER_SECOND = 6;

export { estimatedWords };

/** A steady pseudo-random 0..1, so a line's wave keeps its shape from one render to the next. */
const wobble = (i: number, j: number) => {
  const x = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Wave bars sit about this many pixels apart, like a recording's waveform. */
const BAR_PX = 3.2;
/**
 * Seconds between two Wave bars at this zoom: a power of two, so zooming
 * redraws the bars only when their spacing doubles or halves.
 */
const barStepAt = (pxPerSecond: number) => (pxPerSecond > 0 ? 2 ** Math.round(Math.log2(BAR_PX / pxPerSecond)) : 0.05);
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
      const h = Math.max(2, 46 * peak * Math.sin(Math.PI * p) ** 0.55 * (0.55 + 0.45 * wobble(i * 31 + k, 7)));
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

/** Wordings a line is offered when the user asks for that line; Suggest for all asks for one each. */
export const LINE_OPTIONS = 2;
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
  onUseLine,
  onRestore,
}: {
  onSuggest: (unit: SyncPreviewUnit, avoid: string[], direction: RewriteDirection, count: number) => Promise<LineSuggestion[]>;
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

  /** Asks for `count` wordings of a line: several when the user asks for that line, one each from Suggest for all. */
  const suggest = async (unit: SyncPreviewUnit, count = LINE_OPTIONS) => {
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
      else
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
    onSuggest: () => suggest(unit),
    /**
     * New wordings for a line already settled, from the words it has now. Its
     * direction is worked out again: a long line made to fit is now reworded.
     */
    onSuggestAgain: () => {
      const current = rows[unit.key];
      if (current?.kind === 'used') undoTo.current[unit.key] = current.before;
      delete directions.current[unit.key];
      suggest(unit);
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
  <div role="group" aria-label="Estimate" className="flex bg-slate-950 border border-slate-800 rounded-xl p-0.5 gap-0.5">
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
  sync: 'from this dub',
  sample: "from your voice's sample read",
  typical: '(a typical rate)',
};

export const estimateBasis = (preview: SyncPreview, basis: RateBasis) =>
  preview.method === 'expert' && preview.syllablesPerSecond
    ? `${preview.syllablesPerSecond.toFixed(1)} syllables/s ${RATE_BASIS_NOTE[basis]}`
    : `${preview.charsPerSecond.toFixed(1)} chars/s ${RATE_BASIS_NOTE[basis]}`;

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
          <span key={n} className="text-[13px] text-slate-200 bg-slate-900 border border-slate-800 rounded-md px-1.5 py-0.5">
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
      <div className="relative h-12 rounded-lg bg-indigo-950/30 border border-slate-800 overflow-hidden" aria-hidden="true">
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
    ? timeLine(text, unit.expert.rate).seconds
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

export interface LineFixControlsProps {
  unit: SyncPreviewUnit;
  cps: number;
  direction: RewriteDirection;
  state: LineFixState;
  onSuggest: () => void;
  /** New wordings for a line whose wording was used or kept. */
  onSuggestAgain: () => void;
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
          <button
            type="button"
            onClick={onSuggest}
            className="h-7 px-2.5 rounded-md border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-default"
          >
            {state.kind === 'error'
              ? 'Try again'
              : want !== undefined
                ? `Suggest ${want.toFixed(1)} s lines`
                : direction === 'shorter' && deepCut(unit)
                  ? 'Suggest shorter anyway'
                  : `Suggest ${kind} wordings`}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="h-7 px-2.5 flex items-center gap-1 rounded-md border border-slate-800 hover:bg-slate-800 text-xs text-slate-300 cursor-default"
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
        <div role="status" className="mt-2 flex items-center gap-2 h-7 text-xs text-slate-300">
          <Loader2 className="w-3.5 h-3.5 text-cyan-300 animate-spin" /> Asking the text model for{' '}
          {state.count > 1 ? `${state.count} ${kind} wordings` : `a${kind === 'other' ? 'n' : ''} ${kind} wording`}…
          <button type="button" onClick={onStop} className="ml-1 h-6 px-2 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-400 cursor-default">
            Stop
          </button>
        </div>
      )}

      {state.kind === 'draft' && draftBadge && (
        <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
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
                        picked ? 'border-indigo-500 bg-indigo-500/10' : 'border-slate-800 hover:bg-slate-800/70'
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
            className="w-full resize-y bg-slate-900 border border-slate-800 rounded-md px-2 py-1.5 text-[13px] text-slate-100 leading-snug focus:outline-none focus:border-indigo-500"
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
              onClick={onSuggest}
              className="h-7 px-2 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-300 cursor-default"
            >
              {state.options && state.options.length > 0 ? `${LINE_OPTIONS} more` : `Suggest ${LINE_OPTIONS}`}
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
          <button
            type="button"
            onClick={onSuggestAgain}
            className="h-6 px-2 flex items-center gap-1 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-300 cursor-default"
            title="Ask for new wordings of this line as it reads now. Undo still goes back to the line as it was."
          >
            <RefreshCw className="w-3 h-3" /> Suggest again
          </button>
          <button
            type="button"
            onClick={onUndo}
            className="h-6 px-2 flex items-center gap-1 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-300 cursor-default"
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

/** How the dub lane draws its lines. Rythmo needs the Expert estimate's timed words; without them it shows as Wave. */
export const LaneViewSwitch: React.FC<{ view: LaneView; onChange: (view: LaneView) => void; rythmo?: boolean }> = ({ view, onChange, rythmo = false }) => {
  const shown = view === 'rythmo' && !rythmo ? 'wave' : view;
  return (
  <div role="group" aria-label="Dub lane" className="flex bg-slate-950 border border-slate-800 rounded-xl p-0.5 gap-0.5">
    {[
      { id: 'wave' as const, label: 'Wave', hint: 'Each line as a wave: a swell for each word, flat where the voice is likely to pause. A guess from the text; nothing is voiced yet.' },
      { id: 'blocks' as const, label: 'Blocks', hint: 'Each word as a box as wide as the time it is likely to take, red past the line\'s slot. Zoom in to read the words.' },
      { id: 'bars' as const, label: 'Bars', hint: 'Each line as a bar' },
      ...(rythmo ? [{ id: 'rythmo' as const, label: 'Rythmo', hint: 'The dub text on the timeline, each word as wide as the time it takes. Zoom in to read short lines.' }] : []),
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

/** Zoomed out past this, a dub lane leaves out the lips' marks, which would crowd its lines. */
const LIP_MARK_SECONDS = 20;
/** Zoomed out past this, a pause row says to zoom in instead of crowding its ticks. */
const PAUSE_ROW_SECONDS = 30;

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

/** A dragged start this close to a snap point, in pixels, lands on it. */
const SNAP_PX = 8;
/** Pointed this close to a pause in the dub, in pixels, a cut goes there. */
const PAUSE_CUT_PX = 16;

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
  /** A part being dragged, held by the caller so the fit follows it. */
  placeDrag?: PlaceDrag | null;
  setPlaceDrag?: (drag: PlaceDrag | null) => void;
  /** Where the original's words start: a dragged part snaps to them. */
  snapTimes?: number[];
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
  placeDrag = null,
  setPlaceDrag,
  snapTimes = [],
}) => {
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
  const shapes = useMemo(
    () =>
      look === 'bars'
        ? null
        : new Map(
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
  /** Where S would cut part `p` with the pointer at `clientX`: between the two words nearest it, at a pause when one is close. */
  const cutAt = (u: SyncPreviewUnit, p: LinePart, clientX: number, lane: Element) => {
    if (p.last <= p.first) return null;
    const words = estimatedWords(u);
    const r = lane.getBoundingClientRect();
    const pxs = r.width / Math.max(0.001, WINDOW_SECONDS);
    const x = clientX - r.left;
    let best: { k: number; t: number; d: number } | null = null;
    let pause: { k: number; t: number; d: number } | null = null;
    for (let k = p.first; k < p.last && k + 1 < words.length; k++) {
      const t = p.start + (words[k].end + words[k + 1].start) / 2 - p.from;
      const d = Math.abs((t - windowStart) * pxs - x);
      if (!best || d < best.d) best = { k, t, d };
      if (PAUSE_MARK.test(words[k].text) && d < PAUSE_CUT_PX && (!pause || d < pause.d)) pause = { k, t, d };
    }
    const pick = pause ?? best;
    if (!pick) return null;
    const letters = words.slice(0, pick.k + 1).reduce((sum, w) => sum + letterCount(w.text), 0);
    return { key: u.key, t: pick.t, letters, atPause: PAUSE_MARK.test(words[pick.k].text) };
  };

  /** A press on a part: dragged past a few pixels it moves; let go where it was, it was a click. */
  const press = useRef<{ key: string; part: number; letters: number; x0: number; grab: number; moved: boolean; start: number | null } | null>(null);
  const clickHandled = useRef(false);
  const [guide, setGuide] = useState<number | null>(null);
  /** The part under the pointer, for S and Backspace, and where S would cut it. */
  const hover = useRef<{ key: string; part: number; clientX: number; lane: Element } | null>(null);
  const [cutPreview, setCutPreview] = useState<{ key: string; t: number; atPause: boolean } | null>(null);
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

  const lineNumber = (u: SyncPreviewUnit, width: number, dot?: string) =>
    width > 3.2 ? (
      <span
        className="absolute z-10 left-1 top-1 flex items-center gap-1 rounded bg-slate-950/85 px-1 font-mono text-[9.5px] font-semibold leading-[14px] pointer-events-none"
        style={{ color: hueOf(u.index) }}
      >
        {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
        {u.index + 1}
      </span>
    ) : null;
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
        }${onSelect ? '\nClick to pick this line' : ''}${onPlace ? ' · drag to move it' : ''}${onCut ? ' · S cuts it between two words' : ''}`;
        const words = rythmo && !cut ? u.expert?.words : undefined;
        const shape = words ? undefined : shapes?.get(u.key);
        const drawn = words ? 'rythmo' : !shape || (look === 'blocks' && pxPerSecond < BLOCKS_MIN_PX_PER_SECOND) ? 'bars' : look;
        return (
          <React.Fragment key={u.key}>
            {parts.map((p) => {
              const length = p.to - p.from;
              const width = pct(p.start + length) - pct(p.start);
              const dragging = placeDrag?.key === u.key && placeDrag.part === p.index;
              const partWords = shape?.words.slice(p.first, p.last + 1).map((w) => ({ ...w, start: w.start - p.from, end: w.end - p.from })) ?? [];
              const path = drawn === 'wave' ? (cut ? wavePath(partWords, length, barStep) : shape?.path ?? '') : '';
              // Past this share of the part it runs over the line's room, and turns red.
              const inSlot = length > 0 ? Math.min(1, Math.max(0, (room - p.start) / length)) : 1;
              const pick = onSelect
                ? (e: React.MouseEvent) => {
                    e.stopPropagation();
                    if (clickHandled.current) {
                      clickHandled.current = false;
                      return;
                    }
                    onSelect(u);
                  }
                : undefined;
              return (
                <React.Fragment key={`${u.key}-${p.index}`}>
                  {(p.placed || dragging) && (
                    <span
                      aria-hidden="true"
                      className="absolute top-1.5 bottom-1.5 rounded border border-dashed pointer-events-none"
                      style={{ left: `${pct(p.auto)}%`, width: `${Math.max(0.3, pct(p.auto + length) - pct(p.auto))}%`, borderColor: withAlpha(hue, 0.6) }}
                    />
                  )}
                  <span
                    title={`${title}${p.placed ? `\nPlaced by you, ${signedSeconds(p.start - p.auto)} from where Sync puts it · Backspace puts it back` : ''}`}
                    onClick={pick}
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
                      setCutPreview((was) => (was?.key === next?.key && was?.t === next?.t ? was : next));
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
                    className="absolute top-1.5 bottom-1.5 rounded border border-dashed touch-none cursor-default"
                    style={{
                      left: `${pct(p.start)}%`,
                      width: `${Math.max(0.3, width)}%`,
                      background: drawn === 'bars' || drawn === 'rythmo' ? withAlpha(hue, words ? 0.1 : 0.28) : 'transparent',
                      borderColor: drawn === 'bars' || drawn === 'rythmo' ? hue : 'transparent',
                      boxShadow: selected ? SELECTED_RING : u.key === currentKey ? NOW_RING : undefined,
                    }}
                  >
                    {/* Wave: thin bars, a group per estimated word, red past the line's room */}
                    {drawn === 'wave' && path && (
                      <svg aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1000 100" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id={`${gradientId}-${u.index}-${p.index}`} gradientUnits="userSpaceOnUse" x1="0" x2="1000" y1="0" y2="0">
                            <stop offset={inSlot} stopColor={hue} />
                            <stop offset={inSlot} stopColor="#fb7185" />
                          </linearGradient>
                        </defs>
                        <line x1="0" x2="1000" y1="50" y2="50" stroke={hue} strokeOpacity={0.35} vectorEffect="non-scaling-stroke" />
                        <path
                          d={path}
                          fill="none"
                          stroke={`url(#${gradientId}-${u.index}-${p.index})`}
                          strokeOpacity={0.95}
                          strokeWidth={1.7}
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      </svg>
                    )}
                    {/* Blocks: a box per estimated word, its text inside where it fits */}
                    {drawn === 'blocks' &&
                      length > 0 &&
                      partWords.map((w, n) => {
                        const late = p.start + w.end > room + 0.02;
                        const fits = (w.end - w.start) * pxPerSecond >= w.text.length * 5 + 6;
                        return (
                          <span
                            key={n}
                            aria-hidden="true"
                            className="absolute top-0 bottom-0 flex items-center justify-center overflow-hidden rounded-[3px] border text-[11px] leading-none whitespace-nowrap pointer-events-none"
                            style={{
                              left: `${(w.start / length) * 100}%`,
                              width: `calc(${((w.end - w.start) / length) * 100}% - 1px)`,
                              background: late ? 'rgba(244,63,94,0.25)' : withAlpha(hue, 0.24),
                              borderColor: late ? '#fb7185' : withAlpha(hue, 0.85),
                              color: late ? '#fecdd3' : '#f1f5f9',
                            }}
                          >
                            {fits ? w.text : null}
                          </span>
                        );
                      })}
                    {!words && p.index === 0 && lineNumber(u, width, STATUS_DOT[u.status])}
                    {!words && drawn !== 'blocks' && p.index === parts.length - 1 && width > 9 && (
                      <span className="absolute right-1.5 bottom-1 font-mono text-[9.5px] tabular-nums pointer-events-none" style={{ color: hue }}>
                        {u.expert ? '' : '≈'}
                        {u.estimate.toFixed(1)} s
                      </span>
                    )}
                    {/* Placed by hand: a flag at its start, and while dragged how far it is from Sync's place */}
                    {p.placed && !dragging && (
                      <span aria-hidden="true" className="absolute -top-px -left-px w-0 h-0 border-t-[7px] border-r-[7px] border-t-indigo-200 border-r-transparent pointer-events-none" />
                    )}
                    {dragging && (
                      <span className="absolute z-20 left-1 top-0.5 rounded bg-slate-100 px-1 font-mono text-[9.5px] leading-[13px] text-slate-950 tabular-nums pointer-events-none whitespace-nowrap">
                        {p.placed ? signedSeconds(p.start - p.auto) : 'Sync places it'}
                      </span>
                    )}
                  </span>
                  {/* A cut: notches top and bottom, white at a pause, amber where the voice runs on */}
                  {p.index > 0 && (
                    <span
                      title={`${
                        p.atPause ? 'Cut at a pause' : "Cut where the voice doesn't pause: it may stop mid-sentence"
                      }\nDouble-click to join the parts again`}
                      className="absolute z-10 top-0 bottom-0 w-3 -ml-1.5 cursor-default"
                      style={{ left: `${pct((partEnd(parts[p.index - 1]) + p.start) / 2)}%` }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        onCut?.(u, p.letters, false);
                      }}
                    >
                      {/* A clear split through the wave, like a razor cut, with a solid line in it */}
                      <span className="absolute top-0 bottom-0 left-1/2 -ml-[2px] w-[4px] bg-slate-950" />
                      <span className={`absolute top-0 bottom-0 left-1/2 -ml-px w-[2px] ${p.atPause ? 'bg-slate-200' : 'bg-amber-300'}`} />
                      <span className={`absolute top-0 left-1/2 -ml-[5px] w-0 h-0 border-x-[5px] border-x-transparent border-t-[7px] ${p.atPause ? 'border-t-slate-200' : 'border-t-amber-300'}`} />
                      <span className={`absolute bottom-0 left-1/2 -ml-[5px] w-0 h-0 border-x-[5px] border-x-transparent border-b-[7px] ${p.atPause ? 'border-b-slate-200' : 'border-b-amber-300'}`} />
                    </span>
                  )}
                </React.Fragment>
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
            {u.expert && !words && !cut && (
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
            {WINDOW_SECONDS <= LIP_MARK_SECONDS && u.expert?.dubLips.map((t, n) => <LipMark key={`lip-${n}`} up left={`${pct(lineTimeAt(u, t))}%`} />)}
            {over > 0 && (
              <span
                title={title}
                className={`absolute top-1.5 bottom-1.5 rounded-r pointer-events-none ${
                  drawn === 'wave' || drawn === 'blocks' ? (u.status === 'long' ? OVER_LONG_SOFT : OVER_TIGHT_SOFT) : u.status === 'long' ? OVER_LONG : OVER_TIGHT
                }`}
                style={{ left: `${pct(room)}%`, width: `${Math.max(0.3, pct(finish) - pct(room))}%` }}
              />
            )}
            {u.status === 'short' && (
              <span
                title={`${u.text}\nEnds about ${u.underflow.toFixed(1)} s before the original speaker stops`}
                className={`absolute top-1.5 bottom-1.5 rounded-r ${QUIET_BOX}`}
                style={{ left: `${pct(finish)}%`, width: `${Math.max(0.3, pct(Math.max(finish, u.srcEnd)) - pct(finish))}%` }}
              />
            )}
            <span aria-hidden="true" className="absolute top-0.5 bottom-0.5 w-px bg-slate-600 pointer-events-none" style={{ left: `${pct(room)}%` }} />
            {cutPreview?.key === u.key && !placeDrag && (
              <span
                aria-hidden="true"
                className={`absolute z-10 top-0.5 bottom-0.5 w-0 border-l border-dashed pointer-events-none ${cutPreview.atPause ? 'border-slate-100' : 'border-amber-300'}`}
                style={{ left: `${pct(cutPreview.t)}%` }}
              />
            )}
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
    <span ref={playheadRef(index)} className="absolute top-0 bottom-0 w-0.5 -ml-px bg-slate-100 pointer-events-none" />
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {expert && (
          <div role="group" aria-label="Dub lane" className="flex bg-slate-950 border border-slate-800 rounded-xl p-0.5 gap-0.5">
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
        <TimelineRuler zoom={zoom} onSeek={(t) => onSeek(Math.max(0, Math.min(total, t)))} />
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
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-[12px] text-slate-300">{offClockNote}</div>
      ) : (
        <div className="min-h-[2.75rem] rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-[12px]" aria-live="polite">
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
