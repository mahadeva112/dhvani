import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Pencil, Play, RotateCcw, X } from 'lucide-react';
import { TimelineScrollbar, TimelineTransport, wheelScroll } from './TimelineControls';
import { useLiveTime } from './useLiveTime';
import { AudioSegment } from '../types';
import { previewSync, SyncPrecision, SyncPreview, SyncPreviewUnit } from '../services/syncService';

/**
 * Sync preview: before anything is voiced, which lines are likely to fit the
 * time the original gives them, drawn on the same Original / Dub timeline the
 * sync report uses, and a shorter wording for the lines that are likely too
 * long. Lengths are estimated from characters and a speaking rate, so every
 * figure here says so. See server/lib/syncPreview.js.
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

/** Fetches the preview again whenever the script, the precision or the rate change. */
export const useSyncPreview = ({
  enabled,
  segments,
  precision,
  charsPerSecond,
  sourceDuration,
}: {
  enabled: boolean;
  segments: AudioSegment[];
  precision: SyncPrecision;
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
      previewSync({ segments, precision, charsPerSecond, sourceDuration }, { signal: controller.signal })
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
  }, [enabled, segments, precision, charsPerSecond, sourceDuration]);

  return { preview: enabled ? preview : null, error: enabled ? error : null, loading };
};

/** What the user has done with one likely-too-long line. */
type RowState =
  | { kind: 'idle' }
  | { kind: 'working'; tried: string[] }
  | { kind: 'draft'; text: string; suggested: boolean; tried: string[] }
  | { kind: 'error'; message: string; tried: string[] }
  | { kind: 'used'; text: string; before: Record<string, string> }
  | { kind: 'kept' };

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
  /** A shorter wording of a line, from the text model. */
  onSuggest: (unit: SyncPreviewUnit, avoid: string[]) => Promise<string | null>;
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
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [showTight, setShowTight] = useState(false);
  const setRow = (key: string, state: RowState) => setRows((r) => ({ ...r, [key]: state }));
  // A suggestion that comes back after its row changed is dropped.
  const requests = useRef<Record<string, number>>({});

  const units = preview?.units || [];
  // A line stays listed once it has been worked on, even when it now fits.
  const listed = units.filter((u) => u.status === 'long' || (rows[u.key] && rows[u.key].kind !== 'idle'));
  const tight = units.filter((u) => u.status === 'tight' && !listed.includes(u));
  const stillLong = units.filter((u) => u.status === 'long').length;
  const openLong = units.filter((u) => u.status === 'long' && rows[u.key]?.kind !== 'kept' && rows[u.key]?.kind !== 'used');

  const suggest = async (unit: SyncPreviewUnit) => {
    const current = rows[unit.key];
    const tried = current && 'tried' in current ? current.tried : [];
    const id = (requests.current[unit.key] || 0) + 1;
    requests.current[unit.key] = id;
    setRow(unit.key, { kind: 'working', tried });
    try {
      const line = await onSuggest(unit, tried);
      if (requests.current[unit.key] !== id) return;
      if (line) setRow(unit.key, { kind: 'draft', text: line, suggested: true, tried: [...tried, line] });
      else setRow(unit.key, { kind: 'error', message: 'No usable shorter wording came back. Try again, or edit it yourself.', tried });
    } catch (err: any) {
      if (requests.current[unit.key] !== id) return;
      setRow(unit.key, { kind: 'error', message: err?.message || 'The text model did not answer.', tried });
    }
  };
  const stop = (unit: SyncPreviewUnit) => {
    requests.current[unit.key] = (requests.current[unit.key] || 0) + 1;
    setRow(unit.key, { kind: 'idle' });
  };
  const suggestAll = () => openLong.filter((u) => !rows[u.key] || rows[u.key].kind === 'idle' || rows[u.key].kind === 'error').forEach(suggest);

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

  const { summary } = preview;
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

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          { label: 'Likely to fit', value: `${summary.fits} / ${summary.lines}` },
          { label: 'Tight, likely fit', value: String(summary.tight) },
          { label: 'Likely too long', value: String(summary.long), tone: summary.long > 0 ? 'text-amber-300' : 'text-emerald-300' },
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
              onClick={suggestAll}
              className="h-8 px-3 rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer shrink-0"
            >
              Suggest for all {openLong.length}
            </button>
          )}
        </div>

        {(listed.length > 0 || tight.length > 0) && (
          <ul className="mt-2 max-h-[36rem] overflow-y-auto custom-scrollbar divide-y divide-slate-800 border-y border-slate-800">
            {listed.map((unit) => (
              <PreviewRow
                key={unit.key}
                unit={unit}
                cps={preview.charsPerSecond}
                state={rows[unit.key] || { kind: 'idle' }}
                onSuggest={() => suggest(unit)}
                onStop={() => stop(unit)}
                onEdit={() => setRow(unit.key, { kind: 'draft', text: unit.text, suggested: false, tried: [] })}
                onDraft={(text) => {
                  const current = rows[unit.key];
                  setRow(unit.key, { kind: 'draft', text, suggested: false, tried: current && 'tried' in current ? current.tried : [] });
                }}
                onUse={(text) => setRow(unit.key, { kind: 'used', text, before: onUseLine(unit, text) })}
                onKeep={() => setRow(unit.key, { kind: 'kept' })}
                onUndo={() => {
                  const current = rows[unit.key];
                  if (current?.kind === 'used') onRestore(current.before);
                  setRow(unit.key, { kind: 'idle' });
                }}
                onListen={() => onListenOriginal(Math.max(0, unit.srcStart - 0.6))}
              />
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
                  unit={unit}
                  cps={preview.charsPerSecond}
                  state={{ kind: 'idle' }}
                  onSuggest={() => suggest(unit)}
                  onStop={() => stop(unit)}
                  onEdit={() => setRow(unit.key, { kind: 'draft', text: unit.text, suggested: false, tried: [] })}
                  onDraft={() => {}}
                  onUse={() => {}}
                  onKeep={() => setRow(unit.key, { kind: 'kept' })}
                  onUndo={() => {}}
                  onListen={() => onListenOriginal(Math.max(0, unit.srcStart - 0.6))}
                />
              ))}
          </ul>
        )}
      </div>
    </div>
  );
};

/** The estimate for a wording, against the line's slot. */
const fitOf = (text: string, unit: SyncPreviewUnit, cps: number) => {
  const seconds = text.trim().length / cps;
  const over = seconds - unit.slot;
  return { seconds, over, fits: over <= 0 };
};

const PreviewRow: React.FC<{
  unit: SyncPreviewUnit;
  cps: number;
  state: RowState;
  onSuggest: () => void;
  onStop: () => void;
  onEdit: () => void;
  onDraft: (text: string) => void;
  onUse: (text: string) => void;
  onKeep: () => void;
  onUndo: () => void;
  onListen: () => void;
}> = ({ unit, cps, state, onSuggest, onStop, onEdit, onDraft, onUse, onKeep, onUndo, onListen }) => {
  const long = unit.status === 'long';
  const pill =
    state.kind === 'used' ? 'fits' : unit.status === 'long' ? `+${unit.overflow.toFixed(1)} s` : unit.status === 'tight' ? 'tight' : 'fits';
  const pillTone =
    state.kind === 'used' || unit.status === 'fits'
      ? 'bg-emerald-500/15 text-emerald-300'
      : state.kind === 'kept'
        ? 'bg-slate-800 text-slate-300'
        : unit.status === 'tight'
          ? 'bg-amber-500/10 text-amber-200'
          : 'bg-amber-500/15 text-amber-300';
  const draftFit = state.kind === 'draft' ? fitOf(state.text, unit, cps) : null;
  const changed = state.kind === 'draft' && state.text.trim() !== '' && state.text.trim() !== unit.text.trim();

  return (
    <li className="flex items-start gap-3 py-3">
      <span className={`shrink-0 mt-0.5 font-mono text-[11px] px-2 py-0.5 rounded-md tabular-nums ${pillTone}`}>{pill}</span>
      <span className="shrink-0 mt-0.5 font-mono text-[11.5px] text-slate-500 tabular-nums w-14">{formatClock(unit.srcStart)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] text-slate-100 leading-snug">{unit.text}</p>
        {unit.sourceText && <p className="text-[12px] text-slate-500 leading-snug mt-0.5">{unit.sourceText}</p>}
        <p className={`text-[11.5px] mt-1 ${state.kind === 'used' ? 'text-slate-400' : long ? 'text-amber-300' : 'text-slate-400'}`}>
          {state.kind === 'used'
            ? 'Put into the script. Sync voices this wording.'
            : state.kind === 'kept'
              ? 'Kept. Sync shortens the pauses inside it first; if it is still long, the next line starts late and shows in Worth a listen.'
              : `About ${unit.estimate.toFixed(1)} s of speech for a ${unit.slot.toFixed(1)} s slot`}
        </p>

        {(state.kind === 'idle' || state.kind === 'error') && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onSuggest}
              className="h-7 px-2.5 rounded-md border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer"
            >
              {state.kind === 'error' ? 'Try again' : 'Suggest a shorter line'}
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="h-7 px-2.5 flex items-center gap-1 rounded-md border border-slate-800 hover:bg-slate-800 text-xs text-slate-300 cursor-pointer"
            >
              <Pencil className="w-3 h-3" /> Edit it myself
            </button>
            {long && (
              <button type="button" onClick={onKeep} className="h-7 px-2 rounded-md text-[11.5px] text-slate-400 hover:text-slate-200 cursor-pointer">
                Keep as is
              </button>
            )}
            {state.kind === 'error' && <span className="text-[11.5px] text-rose-300">{state.message}</span>}
          </div>
        )}

        {state.kind === 'working' && (
          <div role="status" className="mt-2 flex items-center gap-2 h-7 text-xs text-slate-300">
            <Loader2 className="w-3.5 h-3.5 text-cyan-300 animate-spin" /> Asking the text model for a shorter wording…
            <button type="button" onClick={onStop} className="ml-1 h-6 px-2 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-400 cursor-pointer">
              Stop
            </button>
          </div>
        )}

        {state.kind === 'draft' && draftFit && (
          <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <label className="block text-[10.5px] uppercase tracking-wide font-semibold text-slate-500 mb-1" htmlFor={`preview-line-${unit.key}`}>
              {state.suggested ? 'Suggested shorter line' : 'Your wording'}
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
                onClick={long ? onKeep : onUndo}
                className="h-7 px-2 flex items-center gap-1 rounded-md text-[11.5px] text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3 h-3" /> {long ? 'Keep as is' : 'Cancel'}
              </button>
              <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
                {state.text.trim().length} / {unit.text.trim().length} characters
              </span>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-md tabular-nums ${
                  draftFit.fits ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                }`}
              >
                {draftFit.fits
                  ? `Now about ${draftFit.seconds.toFixed(1)} s · fits`
                  : `Still about ${draftFit.seconds.toFixed(1)} s · +${draftFit.over.toFixed(1)} s`}
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
              {state.kind === 'used' ? `About ${fitOf(state.text, unit, cps).seconds.toFixed(1)} s for a ${unit.slot.toFixed(1)} s slot` : 'Kept'}
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
 * estimate. The part of a line estimated to run past its slot is yellow; a
 * thin mark shows where each slot ends.
 */
const PreviewTimeline: React.FC<{
  units: SyncPreviewUnit[];
  reportedTime: number;
  getLiveTime?: () => number | null;
  onSeek: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
}> = ({ units, reportedTime, getLiveTime, onSeek, isPlaying, onTogglePlay }) => {
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
            const title = `${u.text}\nAbout ${u.estimate.toFixed(1)} s · slot ${u.slot.toFixed(1)} s${over > 0 ? ` · +${over.toFixed(1)} s` : ''}`;
            return (
              <React.Fragment key={u.key}>
                <span
                  title={title}
                  className={`absolute top-1.5 bottom-1.5 ${over > 0 ? 'rounded-l' : 'rounded'}`}
                  style={{
                    left: `${pct(u.srcStart)}%`,
                    width: `${Math.max(0.3, pct(u.srcStart + fit) - pct(u.srcStart))}%`,
                    background: HATCH_FIT,
                    boxShadow: u.status === 'tight' ? TIGHT_EDGE : undefined,
                  }}
                />
                {over > 0 && (
                  <span
                    title={title}
                    className="absolute top-1.5 bottom-1.5 rounded-r"
                    style={{ left: `${pct(u.srcStart + u.slot)}%`, width: `${Math.max(0.3, pct(u.srcStart + u.estimate) - pct(u.srcStart + u.slot))}%`, background: HATCH_OVER }}
                  />
                )}
                <span
                  aria-hidden="true"
                  className="absolute top-0.5 bottom-0.5 w-px bg-slate-600 pointer-events-none"
                  style={{ left: `${pct(u.srcStart + u.slot)}%` }}
                />
              </React.Fragment>
            );
          })}
          {playhead}
        </div>
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
        <span className="flex items-center gap-1.5"><span className="w-px h-3 bg-slate-500" /> Next line starts</span>
      </TimelineTransport>
    </div>
  );
};
