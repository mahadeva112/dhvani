import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Pencil, Play, RotateCcw, X } from 'lucide-react';
import { TimelineScrollbar, TimelineTransport, wheelScroll } from './TimelineControls';
import { useLiveTime } from './useLiveTime';
import { AudioSegment } from '../types';
import {
  MIN_TRIM_SECONDS,
  previewSync,
  SyncJoinSettings,
  SyncPrecision,
  SyncPreview,
  SyncPreviewUnit,
  TRIM_TOLERANCE,
  wantsChange,
} from '../services/syncService';

/**
 * Sync preview: before anything is voiced, which lines are likely to fit the
 * time the original gives them, drawn on the same Original / Dub timeline the
 * sync report uses, a shorter wording for the lines that are likely too
 * long, and a fuller one for the lines likely to end while the original
 * speaker is still talking. Lengths are estimated from characters and a
 * speaking rate, so every figure here says so. See server/lib/syncPreview.js.
 */

/** Seconds of the timeline shown at once, as in the report's timeline. */
const WINDOW_SECONDS = 30;

const formatClock = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

const HATCH_FIT = 'repeating-linear-gradient(135deg, rgba(129,140,248,0.55) 0 6px, rgba(129,140,248,0.25) 6px 12px)';
const HATCH_OVER = 'repeating-linear-gradient(135deg, rgba(251,191,36,0.75) 0 6px, rgba(251,191,36,0.4) 6px 12px)';
const HATCH_FIT_SWATCH = 'repeating-linear-gradient(135deg, #818cf8 0 2px, rgba(129,140,248,0.3) 2px 4px)';
/** A tight line gets an amber edge along its bottom: it fits, only just. */
const TIGHT_EDGE = 'inset 0 -3px 0 rgba(252,211,77,0.9)';
const HATCH_OVER_SWATCH = 'repeating-linear-gradient(135deg, #fbbf24 0 2px, rgba(251,191,36,0.4) 2px 4px)';
/** Where a short line leaves the original speech unspoken: an empty, dashed box. */
const QUIET_BOX = 'border border-dashed border-sky-400/70 bg-sky-400/5';
/** The length the user trimmed a line to. */
const TRIM_BOX = 'border-2 border-dashed border-indigo-300/90';
/** The dub bar picked for trimming. */
const SELECTED_RING = '0 0 0 2px rgba(165,180,252,0.95)';

/**
 * When a line is short, as server/lib/syncDub.js decides it (isShortLine), so a
 * wording typed here is judged the way the preview and the sync judge it.
 */
const SHORT_SHARE = 0.6;
const MIN_SHORT_GAP = 1;
export const isShort = (seconds: number, spoken: number) => seconds < spoken * SHORT_SHARE && spoken - seconds >= MIN_SHORT_GAP;

/** Which way a line's wording has to change: fewer words to fit its slot, or more to fill the original speech. */
export type RewriteDirection = 'shorter' | 'longer';

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
  | { kind: 'working'; tried: string[] }
  | { kind: 'draft'; text: string; suggested: boolean; tried: string[] }
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
  onSuggest: (unit: SyncPreviewUnit, avoid: string[], direction: RewriteDirection) => Promise<string | null>;
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

  const suggest = async (unit: SyncPreviewUnit) => {
    const current = rows[unit.key];
    const tried = current && 'tried' in current ? current.tried : [];
    const direction = directionOf(unit);
    const id = (requests.current[unit.key] || 0) + 1;
    requests.current[unit.key] = id;
    setRow(unit, { kind: 'working', tried });
    try {
      const line = await onSuggest(unit, tried, direction);
      if (requests.current[unit.key] !== id) return;
      if (line) setRow(unit, { kind: 'draft', text: line, suggested: true, tried: [...tried, line] });
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
  const suggestAll = (list: SyncPreviewUnit[]) => list.filter(notStarted).forEach(suggest);
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
      setRow(unit, { kind: 'draft', text, suggested: false, tried: current && 'tried' in current ? current.tried : [] });
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
  /** A shorter (or, for a line that ends early, fuller) wording of a line, from the text model. */
  onSuggest: (unit: SyncPreviewUnit, avoid: string[], direction: RewriteDirection) => Promise<string | null>;
  /** Puts a wording into the script; returns the cues' texts before, for Undo. */
  onUseLine: (unit: SyncPreviewUnit, text: string) => Record<string, string>;
  /** Puts cue texts back, for Undo. */
  onRestore: (before: Record<string, string>) => void;
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
          {rateMeasured ? 'An estimate' : 'A rough estimate'} from the text length. Nothing is voiced and no ElevenLabs characters are used until
          you press Sync.
        </span>
        <span
          className="font-mono text-[11.5px] text-slate-400 tabular-nums"
          title={
            rateMeasured
              ? 'Characters a second, measured from your Final dub'
              : 'A typical rate. Make the Final dub first for an estimate from your own voice.'
          }
        >
          {preview.charsPerSecond.toFixed(1)} chars/s · {rateMeasured ? 'from Final dub' : 'typical rate'}
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
                <PreviewRow key={unit.key} {...rowProps(unit)} state={{ kind: 'idle' }} onDraft={() => {}} onUse={() => {}} onUndo={() => {}} />
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

/** The preview's five counts, as the Sync step and the Final dub both show them. */
export const PreviewCards: React.FC<{ preview: SyncPreview }> = ({ preview: { summary } }) => (
  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
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
  const seconds = text.trim().length / cps;
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

export interface LineFixControlsProps {
  unit: SyncPreviewUnit;
  cps: number;
  direction: RewriteDirection;
  state: LineFixState;
  onSuggest: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDraft: (text: string) => void;
  onUse: (text: string) => void;
  onKeep: () => void;
  onUndo: () => void;
}

/**
 * How a line can be reworded, with its draft, Use, Keep and Undo. The one
 * suggestion is a shorter line or a fuller one, never both: the direction is
 * decided from the line's source sentence.
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
                ? `Suggest a ${want.toFixed(1)} s line`
                : longer
                  ? 'Suggest a fuller line'
                  : 'Suggest a shorter line'}
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
          <Loader2 className="w-3.5 h-3.5 text-cyan-300 animate-spin" /> Asking the text model for a {longer ? 'fuller' : 'shorter'} wording…
          <button type="button" onClick={onStop} className="ml-1 h-6 px-2 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-400 cursor-pointer">
            Stop
          </button>
        </div>
      )}

      {state.kind === 'draft' && draftBadge && (
        <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
          <label className="block text-[10.5px] uppercase tracking-wide font-semibold text-slate-500 mb-1" htmlFor={`preview-line-${unit.key}`}>
            {state.suggested ? (longer ? 'Suggested fuller line' : 'Suggested shorter line') : 'Your wording'}
          </label>
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
              {state.suggested ? 'Try another' : 'Suggest one'}
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
 * The report's timeline, before a sync: the original's lines above, the dub
 * lines where Sync will start them below, striped because their length is an
 * estimate. The part of a line estimated to run past its slot is yellow; the
 * part of the original speech a short line leaves silent is a dashed box; a
 * thin mark shows where each slot ends.
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
}> = ({ units, reportedTime, getLiveTime, onSeek, isPlaying, onTogglePlay, selectedKey, onSelect, onTrim, charsPerSecond }) => {
  const [drag, setDrag] = useState<{ key: string; seconds: number } | null>(null);
  // Every frame while playing; this timeline is small, so re-rendering it is cheap.
  const currentTime = useLiveTime(reportedTime, isPlaying, getLiveTime);
  const total = Math.max(WINDOW_SECONDS, ...units.map((u) => Math.max(u.srcEnd, u.srcStart + u.estimate)));
  const [windowStart, setWindowStart] = useState(0);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (!follow) return;
    if (currentTime < windowStart || currentTime > windowStart + WINDOW_SECONDS) {
      setWindowStart(Math.max(0, Math.min(total - WINDOW_SECONDS, currentTime - 2)));
    }
  }, [currentTime, follow, windowStart, total]);

  const end = windowStart + WINDOW_SECONDS;
  const pct = (t: number) => ((t - windowStart) / WINDOW_SECONDS) * 100;
  const visible = useMemo(
    () => units.filter((u) => Math.max(u.srcEnd, u.srcStart + u.estimate) >= windowStart && u.srcStart <= end),
    [units, windowStart, end]
  );
  // Scrolling by hand stops the window following playback until play is pressed or a lane clicked.
  const scrollTo = (start: number) => {
    setFollow(false);
    setWindowStart(Math.max(0, Math.min(Math.max(0, total - WINDOW_SECONDS), start)));
  };
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
  const playhead = currentTime >= windowStart && currentTime <= end && (
    <span className="absolute top-0 bottom-0 w-0.5 bg-slate-100 pointer-events-none" style={{ left: `${pct(currentTime)}%` }} />
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-center">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="w-2 h-2 rounded-sm bg-cyan-400" /> Original
        </span>
        <div className="relative h-9 rounded-lg bg-slate-950/60 overflow-hidden cursor-pointer" onClick={seekAt} onWheel={onWheel}>
          {visible.map((u) => (
            <span
              key={u.key}
              title={u.sourceText}
              className="absolute top-1.5 bottom-1.5 rounded bg-cyan-400/35"
              style={{ left: `${pct(u.srcStart)}%`, width: `${Math.max(0.3, pct(u.srcEnd) - pct(u.srcStart))}%` }}
            />
          ))}
          {playhead}
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="w-2 h-2 rounded-sm" style={{ background: HATCH_FIT_SWATCH }} /> Dub, est.
        </span>
        <div className="relative h-9 rounded-lg bg-slate-950/60 overflow-hidden cursor-pointer" onClick={seekAt} onWheel={onWheel}>
          {visible.map((u) => {
            const fit = Math.min(u.estimate, u.slot);
            const over = u.estimate - u.slot;
            const selected = u.key === selectedKey;
            const trim = drag?.key === u.key ? drag.seconds : u.wantSeconds;
            const handleAt = trim ?? Math.min(u.estimate, u.slot);
            const title = `${u.text}\nAbout ${u.estimate.toFixed(1)} s · slot ${u.slot.toFixed(1)} s${over > 0 ? ` · +${over.toFixed(1)} s` : ''}${
              u.wantSeconds !== undefined ? ` · your trim ${u.wantSeconds.toFixed(1)} s` : ''
            }${onSelect ? '\nClick to pick this line' : ''}`;
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
                  className={`absolute top-1.5 bottom-1.5 ${over > 0 ? 'rounded-l' : 'rounded'}`}
                  style={{
                    left: `${pct(u.srcStart)}%`,
                    width: `${Math.max(0.3, pct(u.srcStart + fit) - pct(u.srcStart))}%`,
                    background: HATCH_FIT,
                    boxShadow: [u.status === 'tight' ? TIGHT_EDGE : '', selected ? SELECTED_RING : ''].filter(Boolean).join(', ') || undefined,
                  }}
                />
                {over > 0 && (
                  <span
                    title={title}
                    className="absolute top-1.5 bottom-1.5 rounded-r"
                    style={{ left: `${pct(u.srcStart + u.slot)}%`, width: `${Math.max(0.3, pct(u.srcStart + u.estimate) - pct(u.srcStart + u.slot))}%`, background: HATCH_OVER }}
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
          {playhead}
        </div>
        {drag && dragged && (
          <>
            <span />
            <p role="status" className="font-mono text-[11.5px] text-indigo-200 tabular-nums">
              Trim out: {drag.seconds.toFixed(1)} s
              {charsPerSecond ? ` ≈ ${Math.round(drag.seconds * charsPerSecond)} characters` : ''} · now about {dragged.estimate.toFixed(1)} s
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
        <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm" style={{ background: HATCH_FIT_SWATCH }} /> Likely fits</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm" style={{ background: HATCH_FIT_SWATCH, boxShadow: 'inset 0 -2px 0 #fcd34d' }} /> Tight</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm" style={{ background: HATCH_OVER_SWATCH }} /> Runs past its slot</span>
        <span className="flex items-center gap-1.5"><span className={`w-3 h-2.5 rounded-sm ${QUIET_BOX}`} /> Speaker still talking, dub quiet</span>
        <span className="flex items-center gap-1.5"><span className="w-px h-3 bg-slate-500" /> Next line starts</span>
        {onTrim && (
          <span className="flex items-center gap-1.5"><span className={`w-3 h-2.5 rounded-sm ${TRIM_BOX}`} /> Your trim</span>
        )}
      </TimelineTransport>
    </div>
  );
};
