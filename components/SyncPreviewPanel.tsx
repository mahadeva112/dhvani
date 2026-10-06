import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Pencil, Play, RotateCcw, X } from 'lucide-react';
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
import { timeLine } from '../services/speechTiming';

/**
 * Sync preview: before anything is voiced, which lines are likely to fit the
 * time the original gives them, drawn on the same Original / Dub timeline the
 * sync report uses, a shorter wording for the lines that are likely too
 * long, and a fuller one for the lines likely to end while the original
 * speaker is still talking. Lengths are estimated from characters and a
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
/** The dub bar picked for trimming. */
const SELECTED_RING = '0 0 0 2px rgba(165,180,252,0.95)';
/** The line under the playhead. */
const NOW_RING = '0 0 0 2px rgba(255,255,255,0.8)';
/** How a line is likely to fit, as the colour of its Expert range. */
const STATUS_HEX: Record<SyncPreviewUnit['status'], string> = { fits: '#34d399', tight: '#fcd34d', long: '#fbbf24', short: '#38bdf8' };
/** Bars or Rythmo, for the Expert estimate's dub lane. */
const PREVIEW_VIEW_KEY = 'dhvani_preview_view';
/**
 * A word on a Rythmo band, squeezed or stretched to the time it takes, as a
 * dubbing studio's band writes it: a squeezed word has to be said fast, a
 * stretched one has room. Never clipped, so a word stays readable.
 */
const RythmoWord: React.FC<{ text: string; left: string; width: string; late: boolean; className?: string }> = ({ text, left, width, late, className = '' }) => {
  const box = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      if (!box.current || !inner.current) return;
      inner.current.style.transform = '';
      const room = box.current.clientWidth;
      const need = inner.current.scrollWidth;
      if (room > 0 && need > 0) inner.current.style.transform = `scaleX(${Math.min(1.8, room / need)})`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    if (box.current) observer.observe(box.current);
    return () => observer.disconnect();
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
export type RewriteDirection = 'shorter' | 'longer';

/** Wordings a line is offered when the user asks for that line; Suggest for all asks for one each. */
export const LINE_OPTIONS = 3;
/** Earlier wordings sent back with a new request, so new ones read differently. */
const MAX_TRIED = 6;

/** Fetches the preview again whenever the script, the precision or the rate change. */
export const useSyncPreview = ({
  enabled,
  segments,
  precision,
  join,
  charsPerSecond,
  sourceDuration,
}: {
  enabled: boolean;
  segments: AudioSegment[];
  precision: SyncPrecision;
  join?: SyncJoinSettings;
  charsPerSecond: number;
  sourceDuration: number;
}) => {
  const [preview, setPreview] = useState<SyncPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || segments.length === 0) return;
    const controller = new AbortController();
    // Typing in the script changes the segments on every key; wait for a pause.
    const timer = window.setTimeout(() => {
      setLoading(true);
      previewSync({ segments, precision, join, charsPerSecond, sourceDuration }, { signal: controller.signal })
        .then((next) => {
          setPreview(next);
          setError(null);
        })
        .catch((err) => {
          if (!controller.signal.aborted) setError(err?.message || 'The preview could not be worked out.');
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, segments, precision, join, charsPerSecond, sourceDuration]);

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
  | { kind: 'used'; text: string; before: Record<string, string> }
  | { kind: 'kept' };

/** A line's way of being reworded: fewer words for a long line, more for one that ends early. */
export const directionFor = (unit: SyncPreviewUnit): RewriteDirection =>
  // A line trimmed on the timeline goes toward its trim; any other, toward its slot or its speech.
  unit.wantSeconds !== undefined
    ? unit.estimate > unit.wantSeconds
      ? 'shorter'
      : 'longer'
    : unit.status === 'short'
      ? 'longer'
      : 'shorter';

/**
 * Rewording lines, one at a time or all at once, as the Sync preview and the
 * Final dub script both offer it. Each line's direction comes from how it
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
          message: `No usable ${direction === 'longer' ? 'fuller' : 'shorter'} wording came back. Try again, or edit it yourself.`,
          tried,
        });
    } catch (err: any) {
      if (requests.current[unit.key] !== id) return;
      setRow(unit, { kind: 'error', message: err?.message || 'The text model did not answer.', tried });
    }
  };
  const suggestAll = (list: SyncPreviewUnit[]) => list.filter(notStarted).forEach((unit) => suggest(unit, 1));
  /** Forgets the work on a line, so its direction is decided again: after a new trim, say. */
  const reset = (unit: SyncPreviewUnit) => {
    requests.current[unit.key] = (requests.current[unit.key] || 0) + 1;
    setRow(unit, { kind: 'idle' });
  };

  /** What a line's controls need; its direction decides how they read. */
  const controlsFor = (unit: SyncPreviewUnit) => ({
    direction: directionOf(unit),
    state: stateOf(unit),
    onSuggest: () => suggest(unit),
    onStop: () => {
      requests.current[unit.key] = (requests.current[unit.key] || 0) + 1;
      setRow(unit, { kind: 'idle' });
    },
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
    onUse: (text: string) => setRow(unit, { kind: 'used', text, before: onUseLine(unit, text) }),
    onKeep: () => setRow(unit, { kind: 'kept' }),
    onUndo: () => {
      const current = rows[unit.key];
      if (current?.kind === 'used') onRestore(current.before);
      setRow(unit, { kind: 'idle' });
    },
  });

  return { directionOf, stateOf, worked, open, notStarted, suggestAll, controlsFor, reset };
};

export interface SyncPreviewPanelProps {
  preview: SyncPreview | null;
  loading: boolean;
  error: string | null;
  /** True when the rate was measured from the Final dub, false when it is a typical rate. */
  rateMeasured: boolean;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  /** The exact playback position, read every frame while playing, so the playhead moves smoothly. */
  getLiveTime?: () => number | null;
  onSeek: (time: number) => void;
  /** Plays the original from `time`. */
  onListenOriginal: (time: number) => void;
  /** Shorter (or, for a line that ends early, fuller) wordings of a line, from the text model. */
  onSuggest: (unit: SyncPreviewUnit, avoid: string[], direction: RewriteDirection, count: number) => Promise<LineSuggestion[]>;
  /** Puts a wording into the script; returns the cues' texts before, for Undo. */
  onUseLine: (unit: SyncPreviewUnit, text: string) => Record<string, string>;
  /** Puts cue texts back, for Undo. */
  onRestore: (before: Record<string, string>) => void;
  /** See PreviewTimeline: shown in place of the playhead while an unsynced dub is heard. */
  offClockNote?: React.ReactNode;
  /** The original, for the timeline's waveform. */
  sourceBuffer?: AudioBuffer | null;
  /** Switches between the Quick and the Expert estimate. */
  onMethodChange?: (method: EstimateMethod) => void;
}

export const SyncPreviewPanel: React.FC<SyncPreviewPanelProps> = ({
  preview,
  loading,
  error,
  rateMeasured,
  currentTime,
  isPlaying,
  onTogglePlay,
  getLiveTime,
  onSeek,
  onListenOriginal,
  onSuggest,
  onUseLine,
  onRestore,
  offClockNote,
  sourceBuffer,
  onMethodChange,
}) => {
  const [showTight, setShowTight] = useState(false);
  const fixes = useLineFixes({ onSuggest, onUseLine, onRestore });
  const { directionOf, worked, open, suggestAll } = fixes;

  const units = preview?.units || [];
  // A line stays listed once it has been worked on, even when it now fits.
  const listed = units.filter((u) => directionOf(u) === 'shorter' && (u.status === 'long' || wantsChange(u) || worked(u)));
  const listedShort = units.filter((u) => directionOf(u) === 'longer' && (u.status === 'short' || wantsChange(u) || worked(u)));
  const tight = units.filter((u) => u.status === 'tight' && !listed.includes(u));
  const stillLong = units.filter((u) => u.status === 'long').length;
  const stillShort = units.filter((u) => u.status === 'short').length;
  const openLong = units.filter((u) => u.status === 'long' && open(u));
  const openShort = units.filter((u) => u.status === 'short' && open(u));

  /** What every row needs; its direction decides how it reads. */
  const rowProps = (unit: SyncPreviewUnit) => ({
    unit,
    cps: preview?.charsPerSecond ?? 1,
    ...fixes.controlsFor(unit),
    onListen: () => onListenOriginal(Math.max(0, unit.srcStart - 0.6)),
  });

  if (error && !preview) {
    return <p className="text-xs text-amber-300">The preview could not be worked out: {error}</p>;
  }
  if (!preview) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-400" role="status">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Working out the preview…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-slate-700 bg-slate-950/60 px-3.5 py-2.5">
        <span className="text-[11px] font-bold tracking-wider uppercase text-indigo-300">Preview</span>
        <span className="flex-1 min-w-[16rem] text-[12.5px] text-slate-300">
          {rateMeasured ? 'An estimate' : 'A rough estimate'} from the text {preview.method === 'expert' ? 'in syllables' : 'length'}. Nothing is voiced and
          no ElevenLabs characters are used until you press Sync.
        </span>
        {onMethodChange && <EstimateSwitch method={preview.method ?? 'quick'} onChange={onMethodChange} />}
        <span
          className="font-mono text-[11.5px] text-slate-400 tabular-nums"
          title={rateMeasured ? 'Measured from your Final dub' : 'A typical rate. Make the Final dub first for an estimate from your own voice.'}
        >
          {estimateBasis(preview, rateMeasured)}
        </span>
        {loading && <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" aria-label="Updating" />}
      </div>

      <PreviewCards preview={preview} />

      <PreviewTimeline
        units={units}
        reportedTime={currentTime}
        getLiveTime={getLiveTime}
        onSeek={onSeek}
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        offClockNote={offClockNote}
        sourceBuffer={sourceBuffer}
      />

      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[13.5px] font-semibold text-slate-100">Shorten before you sync</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {stillLong === 0
                ? 'No line is likely to run past the time the original gives it.'
                : `${stillLong === 1 ? '1 line is' : `${stillLong} lines are`} likely too long for the time the original gives ${
                    stillLong === 1 ? 'it' : 'them'
                  }. Shortening now saves a second sync. Suggestions use your text model, not ElevenLabs.`}
            </p>
          </div>
          {openLong.length > 1 && (
            <button
              type="button"
              onClick={() => suggestAll(openLong)}
              className="h-8 px-3 rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer shrink-0"
            >
              Suggest for all {openLong.length}
            </button>
          )}
        </div>

        {(listed.length > 0 || tight.length > 0) && (
          <ul className="mt-2 max-h-[36rem] overflow-y-auto custom-scrollbar divide-y divide-slate-800 border-y border-slate-800">
            {listed.map((unit) => (
              <PreviewRow key={unit.key} {...rowProps(unit)} />
            ))}
            {tight.length > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => setShowTight((v) => !v)}
                  aria-expanded={showTight}
                  className="group w-full flex items-center gap-3 py-3 text-left text-[12.5px] text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  <span className="shrink-0 flex items-center gap-1.5 font-mono text-[11px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-200 tabular-nums">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-300/80" />
                    {tight.length} tight
                  </span>
                  <span className="flex-1 min-w-0">Likely to fit, just. Sync can shorten the pauses inside them.</span>
                  <span className="shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-lg border border-slate-800 group-hover:bg-slate-800 text-xs text-slate-300">
                    {showTight ? 'Hide' : 'Show'}
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTight ? 'rotate-180' : ''}`} />
                  </span>
                </button>
              </li>
            )}
            {showTight &&
              tight.map((unit) => (
                <PreviewRow
                  key={unit.key}
                  {...rowProps(unit)}
                  state={{ kind: 'idle' }}
                  onDraft={() => {}}
                  onPick={() => {}}
                  onUse={() => {}}
                  onUndo={() => {}}
                />
              ))}
          </ul>
        )}
      </div>

      {listedShort.length > 0 && (
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-semibold text-slate-100">Fill out lines that end early</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {stillShort === 0
                  ? 'No line is likely to end well before the original speaker stops.'
                  : `${stillShort === 1 ? '1 line is' : `${stillShort} lines are`} likely to end well before the original speaker stops, so the dub goes quiet while the speaker is still talking on screen. A fuller wording with the same meaning closes the gap. Suggestions use your text model, not ElevenLabs.`}
              </p>
            </div>
            {openShort.length > 1 && (
              <button
                type="button"
                onClick={() => suggestAll(openShort)}
                className="h-8 px-3 rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer shrink-0"
              >
                Suggest for all {openShort.length}
              </button>
            )}
          </div>
          <ul className="mt-2 max-h-[36rem] overflow-y-auto custom-scrollbar divide-y divide-slate-800 border-y border-slate-800">
            {listedShort.map((unit) => (
              <PreviewRow key={unit.key} {...rowProps(unit)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
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
        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
          method === m.id ? (m.id === 'expert' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-100') : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        {m.label}
      </button>
    ))}
  </div>
);

/** What the preview's figures are worked out from, in a few words. */
export const estimateBasis = (preview: SyncPreview, rateMeasured: boolean) =>
  preview.method === 'expert' && preview.syllablesPerSecond
    ? `${preview.syllablesPerSecond.toFixed(1)} syllables/s · ${rateMeasured ? 'from this dub' : 'typical rate'}`
    : `${preview.charsPerSecond.toFixed(1)} chars/s · ${rateMeasured ? 'from this dub' : 'typical rate'}`;

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

/** The preview's five counts, as the Sync step and the Final dub both show them. */
export const PreviewCards: React.FC<{ preview: SyncPreview }> = ({ preview: { summary } }) => (
  <div className={`grid grid-cols-2 sm:grid-cols-3 ${summary.lips ? 'xl:grid-cols-6' : 'xl:grid-cols-5'} gap-3`}>
    {[
      { label: 'Likely to fit', value: `${summary.fits} / ${summary.lines}` },
      { label: 'Tight, likely fit', value: String(summary.tight) },
      { label: 'Likely too long', value: String(summary.long), tone: summary.long > 0 ? 'text-amber-300' : 'text-emerald-300' },
      { label: 'Ends early, est.', value: String(summary.short), tone: summary.short > 0 ? 'text-sky-300' : 'text-slate-100' },
      {
        label: 'Longest overrun, est.',
        value: summary.long > 0 ? `+${summary.maxOverflow.toFixed(1)} s` : 'none',
        tone: summary.long > 0 ? 'text-amber-300' : 'text-slate-100',
      },
      ...(summary.lips
        ? [
            summary.lips.total > 0
              ? {
                  label: 'Lip closures matched',
                  value: `${summary.lips.matched} / ${summary.lips.total}`,
                  tone: summary.lips.matched < summary.lips.total ? 'text-amber-300' : 'text-emerald-300',
                }
              : { label: 'Lip closures', value: 'no timings', tone: 'text-slate-500' },
          ]
        : []),
    ].map((m) => (
      <div key={m.label} className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2.5">
        <span className="block text-[11.5px] text-slate-400">{m.label}</span>
        <span className={`block text-xl font-semibold tabular-nums ${m.tone || 'text-slate-100'}`}>{m.value}</span>
      </div>
    ))}
  </div>
);

/**
 * The estimate for a wording: against the line's slot, and against the
 * original speech, which a fuller wording has to fill without running past.
 */
export const fitOf = (text: string, unit: SyncPreviewUnit, cps: number) => {
  // A line the Expert estimate timed is judged by it too, so a suggestion reads the same as the line.
  const seconds = unit.expert ? timeLine(text, unit.expert.rate).seconds : text.trim().length / cps;
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
            ? `About ${unit.estimate.toFixed(1)} s of speech; the original speaker talks for ${unit.spoken.toFixed(1)} s`
            : `About ${unit.estimate.toFixed(1)} s of speech for a ${unit.slot.toFixed(1)} s slot`,
  };
};

/** Shown with a suggestion the meaning check did not pass, so the user reads it before using it. */
export const MeaningWarning: React.FC<{ issues: string[] }> = ({ issues }) => (
  <div role="note" className="mb-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11.5px] text-amber-300 leading-snug">
    <span className="font-semibold">Check the meaning before using this.</span> The closest wording the text model found may differ from the
    original line: {issues.slice(0, 3).join('; ')}.
  </div>
);

export interface LineFixControlsProps {
  unit: SyncPreviewUnit;
  cps: number;
  direction: RewriteDirection;
  state: LineFixState;
  onSuggest: () => void;
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
 * picked goes into the draft to edit. They are all shorter or all fuller,
 * never both: the direction is decided from the line's source sentence.
 */
export const LineFixControls: React.FC<LineFixControlsProps> = ({
  unit,
  cps,
  direction,
  state,
  onSuggest,
  onStop,
  onEdit,
  onDraft,
  onPick,
  onUse,
  onKeep,
  onUndo,
}) => {
  const longer = direction === 'longer';
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
      ? { good: false, text: `${longer ? 'About' : 'Still about'} ${draftFit.seconds.toFixed(1)} s · +${draftFit.over.toFixed(1)} s past its slot` }
      : longer
        ? draftFit.short
          ? { good: false, text: `Still about ${draftFit.seconds.toFixed(1)} s of ${unit.spoken.toFixed(1)} s · ends early` }
          : { good: true, text: `Now about ${draftFit.seconds.toFixed(1)} s of ${unit.spoken.toFixed(1)} s · fills` }
        : { good: true, text: `Now about ${draftFit.seconds.toFixed(1)} s · fits` };

  return (
    <>
      {(state.kind === 'idle' || state.kind === 'error') && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onSuggest}
            className="h-7 px-2.5 rounded-md border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer"
          >
            {state.kind === 'error'
              ? 'Try again'
              : want !== undefined
                ? `Suggest ${want.toFixed(1)} s lines`
                : longer
                  ? 'Suggest fuller lines'
                  : 'Suggest shorter lines'}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="h-7 px-2.5 flex items-center gap-1 rounded-md border border-slate-800 hover:bg-slate-800 text-xs text-slate-300 cursor-pointer"
          >
            <Pencil className="w-3 h-3" /> Edit it myself
          </button>
          {flagged && (
            <button type="button" onClick={onKeep} className="h-7 px-2 rounded-md text-[11.5px] text-slate-400 hover:text-slate-200 cursor-pointer">
              Keep as is
            </button>
          )}
          {state.kind === 'error' && <span className="text-[11.5px] text-rose-300">{state.message}</span>}
        </div>
      )}

      {state.kind === 'working' && (
        <div role="status" className="mt-2 flex items-center gap-2 h-7 text-xs text-slate-300">
          <Loader2 className="w-3.5 h-3.5 text-cyan-300 animate-spin" /> Asking the text model for{' '}
          {state.count > 1 ? `${state.count} ${longer ? 'fuller' : 'shorter'} wordings` : `a ${longer ? 'fuller' : 'shorter'} wording`}…
          <button type="button" onClick={onStop} className="ml-1 h-6 px-2 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-400 cursor-pointer">
            Stop
          </button>
        </div>
      )}

      {state.kind === 'draft' && draftBadge && (
        <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          {state.options && state.options.length > 1 && (
            <div className="mb-2">
              <span className="block text-[10.5px] uppercase tracking-wide font-semibold text-slate-500 mb-1">
                {state.options.length} {longer ? 'fuller' : 'shorter'} wordings · pick one, then edit it if you like
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
                      className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-left cursor-pointer ${
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
                      <span className="flex-1 min-w-0 text-[13px] text-slate-100 leading-snug">{option.text}</span>
                      <span className="shrink-0 flex flex-col items-end gap-0.5">
                        <span
                          className={`text-[10.5px] font-semibold px-1.5 rounded tabular-nums ${
                            good ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          ≈{fit.seconds.toFixed(1)} s
                        </span>
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
                ? longer
                  ? 'Suggested fuller line'
                  : 'Suggested shorter line'
                : 'Your wording'}
          </label>
          {state.suggested && state.issues && <MeaningWarning issues={state.issues} />}
          <textarea
            id={`preview-line-${unit.key}`}
            value={state.text}
            onChange={(e) => onDraft(e.target.value)}
            rows={2}
            className="w-full resize-y bg-slate-900 border border-slate-800 rounded-md px-2 py-1.5 text-[13px] text-slate-100 leading-snug focus:outline-none focus:border-indigo-500"
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onUse(state.text.trim())}
              disabled={!changed}
              className="h-7 px-2.5 flex items-center gap-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer"
              title="Put this wording into the script"
            >
              <Check className="w-3.5 h-3.5" /> Use this line
            </button>
            <button
              type="button"
              onClick={onSuggest}
              className="h-7 px-2 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-300 cursor-pointer"
            >
              {state.options && state.options.length > 0 ? `${LINE_OPTIONS} more` : `Suggest ${LINE_OPTIONS}`}
            </button>
            <button
              type="button"
              onClick={flagged ? onKeep : onUndo}
              className="h-7 px-2 flex items-center gap-1 rounded-md text-[11.5px] text-slate-400 hover:text-slate-200 cursor-pointer"
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
            onClick={onUndo}
            className="h-6 px-2 flex items-center gap-1 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-300 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Undo
          </button>
        </div>
      )}
    </>
  );
};

const PreviewRow: React.FC<LineFixControlsProps & { onListen: () => void }> = ({ onListen, ...controls }) => {
  const { unit, state, direction } = controls;
  const pill = linePill(unit, state);
  const note = lineNote(unit, state, direction);
  return (
    <li className="flex items-start gap-3 py-3">
      <span aria-hidden="true" className="shrink-0 w-1 self-stretch rounded-full" style={{ background: hueOf(unit.index) }} />
      <span className={`shrink-0 mt-0.5 font-mono text-[11px] px-2 py-0.5 rounded-md tabular-nums ${pill.tone}`}>{pill.text}</span>
      <span className="shrink-0 mt-0.5 font-mono text-[11.5px] text-slate-500 tabular-nums w-14">{formatClock(unit.srcStart)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] text-slate-100 leading-snug">{unit.text}</p>
        {unit.sourceText && <p className="text-[12px] text-slate-500 leading-snug mt-0.5">{unit.sourceText}</p>}
        <p className={`text-[11.5px] mt-1 ${note.tone}`}>{note.text}</p>
        <LineFixControls {...controls} />
      </div>
      <button
        type="button"
        onClick={onListen}
        className="shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs text-slate-200 cursor-pointer"
        title="Play the original line"
      >
        <Play className="w-3 h-3 fill-current" /> Original
      </button>
    </li>
  );
};

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
  const { windowStart, windowSeconds: WINDOW_SECONDS, follow, setFollow, scrollTo } = zoom;
  const playheadRef = useWindowPlayheads({
    reportedTime,
    isPlaying,
    getLiveTime,
    windowStart,
    windowSeconds: WINDOW_SECONDS,
    follow,
    onFollow: zoom.followTo,
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

  const end = windowStart + WINDOW_SECONDS;
  const pct = (t: number) => ((t - windowStart) / WINDOW_SECONDS) * 100;
  const visible = useMemo(
    () => units.filter((u) => Math.max(u.srcEnd, u.srcStart + u.estimate) >= windowStart && u.srcStart <= end),
    [units, windowStart, end]
  );
  const onWheel = wheelScroll(WINDOW_SECONDS, (seconds) => scrollTo(windowStart + seconds));
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
    onSeek(windowStart + ((e.clientX - r.left) / r.width) * WINDOW_SECONDS);
  };
  /** A trim from where the pointer is over the dub lane, held to the line's slot, snapping to the end of the original speech. */
  const trimAt = (u: SyncPreviewUnit, clientX: number, lane: Element) => {
    const r = lane.getBoundingClientRect();
    const seconds = windowStart + ((clientX - r.left) / r.width) * WINDOW_SECONDS - u.srcStart;
    const snapped = Math.abs(seconds - u.spoken) <= 0.15 ? u.spoken : Math.round(seconds * 10) / 10;
    return Math.max(MIN_TRIM_SECONDS, Math.min(u.slot, snapped));
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
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
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
      <div ref={zoom.lanesRef} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-center">
        <span />
        <TimelineRuler zoom={zoom} />
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="w-2 h-2 rounded-sm bg-cyan-400" /> Original
        </span>
        <div className="relative h-11 rounded-lg bg-slate-950/60 overflow-hidden cursor-pointer" onClick={seekAt} onWheel={onWheel}>
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
          <WindowWaveform data={sourcePeaks} from={windowStart} span={WINDOW_SECONDS} spans={sourceSpans} className="text-slate-400/30" />
          {expert &&
            visible.flatMap((u) =>
              (u.expert?.sourceLips || []).filter((t) => t >= windowStart && t <= end).map((t, n) => <LipMark key={`${u.key}-${n}`} left={`${pct(t)}%`} />)
            )}
          {playhead(0)}
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="w-2 h-2 rounded-sm border border-dashed border-indigo-300" /> {rythmo ? 'Rythmo' : 'Dub, est.'}
        </span>
        <div className="relative h-11 rounded-lg bg-slate-950/60 overflow-hidden cursor-pointer" onClick={seekAt} onWheel={onWheel}>
          {visible.map((u) => {
            const over = u.estimate - u.slot;
            const hue = hueOf(u.index);
            const selected = u.key === selectedKey;
            const trim = drag?.key === u.key ? drag.seconds : u.wantSeconds;
            const handleAt = trim ?? Math.min(u.estimate, u.slot);
            const title = `${u.text}\nAbout ${u.estimate.toFixed(1)} s${
              u.expert ? ` (${u.expert.low.toFixed(1)} to ${u.expert.high.toFixed(1)} s, ${u.expert.syllables} syllables)` : ''
            } · slot ${u.slot.toFixed(1)} s${over > 0 ? ` · +${over.toFixed(1)} s` : ''}${
              u.wantSeconds !== undefined ? ` · your trim ${u.wantSeconds.toFixed(1)} s` : ''
            }${onSelect ? '\nClick to pick this line' : ''}`;
            const words = rythmo ? u.expert?.words : undefined;
            const pick = onSelect
              ? (e: React.MouseEvent) => {
                  e.stopPropagation();
                  onSelect(u);
                }
              : undefined;
            return (
              <React.Fragment key={u.key}>
                <span
                  title={title}
                  onClick={pick}
                  className="absolute top-1.5 bottom-1.5 rounded border border-dashed"
                  style={{
                    left: `${pct(u.srcStart)}%`,
                    width: `${Math.max(0.3, pct(u.srcStart + u.estimate) - pct(u.srcStart))}%`,
                    background: withAlpha(hue, words ? 0.06 : 0.14),
                    borderColor: withAlpha(hue, 0.75),
                    boxShadow: selected ? SELECTED_RING : u.key === current?.key ? NOW_RING : undefined,
                  }}
                >
                  {!words && lineNumber(u, u.estimate, STATUS_DOT[u.status])}
                  {!words && pct(u.srcStart + u.estimate) - pct(u.srcStart) > 9 && (
                    <span className="absolute right-1.5 bottom-1 font-mono text-[9.5px] tabular-nums pointer-events-none" style={{ color: hue }}>
                      {u.expert ? '' : '≈'}
                      {u.estimate.toFixed(1)} s
                    </span>
                  )}
                </span>
                {/* Rythmo: each word where it is likely said, red once past the line's slot */}
                {words?.map((w, n) => (
                  <RythmoWord
                    key={n}
                    text={w.text}
                    late={w.end > u.slot + 0.02}
                    className="text-[12px]"
                    left={`${pct(u.srcStart + w.start)}%`}
                    width={`${Math.max(0.2, pct(u.srcStart + w.end) - pct(u.srcStart + w.start))}%`}
                  />
                ))}
                {/* Expert: a fast to a slow read, in the colour of how it fits */}
                {u.expert && !words && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-[7px] h-[2px] rounded-full pointer-events-none"
                    style={{
                      left: `${pct(u.srcStart + u.expert.low)}%`,
                      width: `${Math.max(0.2, pct(u.srcStart + u.expert.high) - pct(u.srcStart + u.expert.low))}%`,
                      background: STATUS_HEX[u.status],
                    }}
                  />
                )}
                {u.expert?.dubLips.map((t, n) => <LipMark key={`lip-${n}`} up left={`${pct(u.srcStart + t)}%`} />)}
                {over > 0 && (
                  <span
                    title={title}
                    className="absolute bottom-0.5 h-[3px] rounded-full bg-amber-400 pointer-events-none"
                    style={{ left: `${pct(u.srcStart + u.slot)}%`, width: `${Math.max(0.3, pct(u.srcStart + u.estimate) - pct(u.srcStart + u.slot))}%` }}
                  />
                )}
                {u.status === 'short' && (
                  <span
                    title={`${u.text}\nEnds about ${u.underflow.toFixed(1)} s before the original speaker stops`}
                    className={`absolute top-1.5 bottom-1.5 rounded-r ${QUIET_BOX}`}
                    style={{ left: `${pct(u.srcStart + u.estimate)}%`, width: `${Math.max(0.3, pct(u.srcEnd) - pct(u.srcStart + u.estimate))}%` }}
                  />
                )}
                <span
                  aria-hidden="true"
                  className="absolute top-0.5 bottom-0.5 w-px bg-slate-600 pointer-events-none"
                  style={{ left: `${pct(u.srcStart + u.slot)}%` }}
                />
                {trim !== undefined && (
                  <span
                    aria-hidden="true"
                    className={`absolute top-0.5 bottom-0.5 rounded pointer-events-none ${TRIM_BOX}`}
                    style={{ left: `${pct(u.srcStart)}%`, width: `${Math.max(0.3, pct(u.srcStart + trim) - pct(u.srcStart))}%` }}
                  />
                )}
                {selected && onTrim && (
                  <span
                    role="slider"
                    tabIndex={0}
                    aria-label="Trim out: the length this line should take"
                    aria-valuemin={MIN_TRIM_SECONDS}
                    aria-valuemax={Math.round(u.slot * 10) / 10}
                    aria-valuenow={Math.round(handleAt * 10) / 10}
                    aria-valuetext={`${handleAt.toFixed(1)} seconds`}
                    title="Drag to the length this line should take"
                    className="absolute top-0 bottom-0 w-2 -ml-1 rounded-sm bg-indigo-300 hover:bg-indigo-200 cursor-ew-resize touch-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    style={{ left: `${pct(u.srcStart + handleAt)}%` }}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        // A pointer that is already gone: the drag still follows moves over the handle.
                      }
                      setFollow(false);
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
          windowStart={windowStart}
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
        windowStart={windowStart}
        windowSeconds={WINDOW_SECONDS}
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
