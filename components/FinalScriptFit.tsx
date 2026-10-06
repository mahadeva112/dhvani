import React from 'react';
import { Loader2 } from 'lucide-react';
import { wantsChange } from '../services/syncService';
import type { SyncPreview, SyncPreviewUnit } from '../services/syncService';

/**
 * The Final dub script's sync fit: how long each dub line is estimated to take
 * against the time its source sentence gives it, from the same preview Sync
 * shows (server/lib/syncPreview.js). Which way a line should change is decided
 * from its source sentence, so a line offers a shorter wording or a fuller
 * one, never both; see useLineFixes in SyncPreviewPanel.
 */

/**
 * A line that needs a new wording: too long for its slot, or ending while the
 * speaker still talks. A line trimmed on the timeline needs one only while it
 * is off its trim: the trim is what the user asked for.
 */
export const needsFix = (unit: SyncPreviewUnit) =>
  unit.wantSeconds !== undefined ? wantsChange(unit) : unit.status === 'long' || unit.status === 'short';

const LABEL_TONE: Record<SyncPreviewUnit['status'], string> = {
  fits: 'bg-emerald-500/15 text-emerald-300',
  tight: 'bg-amber-500/10 text-amber-200',
  long: 'bg-amber-500/15 text-amber-300',
  short: 'bg-sky-500/15 text-sky-300',
};

const FILL_TONE: Record<SyncPreviewUnit['status'], string> = {
  fits: 'bg-emerald-400/80',
  tight: 'bg-emerald-400/80',
  long: 'bg-amber-400/90',
  short: 'bg-sky-400/80',
};

/** What a line's badge says, in seconds. */
export const fitLabel = (unit: SyncPreviewUnit) =>
  unit.status === 'long'
    ? `+${unit.overflow.toFixed(1)} s over`
    : unit.status === 'short'
      ? `Ends ${unit.underflow.toFixed(1)} s early`
      : unit.status === 'tight'
        ? 'Tight'
        : 'Fits';

/** The sentence under a line not worked on yet: what is wrong, and the length to aim for. */
export const fitAdvice = (unit: SyncPreviewUnit) =>
  unit.wantSeconds !== undefined
    ? `Trimmed to ${unit.wantSeconds.toFixed(1)} s ≈ ${unit.targetChars} characters (now ${unit.text.length}, about ${unit.estimate.toFixed(1)} s).${
        wantsChange(unit) ? '' : ' Matches your trim.'
      }`
    : unit.status === 'long'
    ? `Runs about ${unit.overflow.toFixed(1)} s into the next line. Aim for about ${unit.targetChars} characters (now ${unit.text.length})${
        unit.expert && unit.expert.cut > 0 ? `, about ${unit.expert.cut} syllable${unit.expert.cut === 1 ? '' : 's'} fewer` : ''
      }.`
    : unit.status === 'short'
      ? `Ends about ${unit.underflow.toFixed(1)} s before the original speaker stops. Aim for about ${unit.targetChars} characters (now ${unit.text.length}).`
      : unit.status === 'tight'
        ? 'Fits, just. Sync can shorten the pauses inside it.'
        : '';

/**
 * One line's estimate: a bar for the dub, a tick where its slot ends, and for
 * a line that ends early a dashed box for the original speech it leaves silent.
 */
export const FitMeter: React.FC<{ unit: SyncPreviewUnit; className?: string }> = ({ unit, className = '' }) => {
  const scale = Math.max(unit.slot, unit.estimate, unit.spoken, 0.1);
  const pct = (seconds: number) => `${Math.min(100, (seconds / scale) * 100)}%`;
  const short = unit.status === 'short';
  return (
    <div
      className={`flex flex-col items-start sm:items-end gap-1 ${className}`}
      title={`${unit.text}\nAbout ${unit.estimate.toFixed(1)} s of speech · slot ${unit.slot.toFixed(1)} s · original speech ${unit.spoken.toFixed(1)} s`}
    >
      <span className={`font-mono text-[11px] px-2 py-0.5 rounded-md tabular-nums ${LABEL_TONE[unit.status]}`}>{fitLabel(unit)}</span>
      <span className="relative block w-full max-w-[9rem] h-1.5 rounded-full bg-slate-800 my-0.5" aria-hidden="true">
        {short && (
          <span className="absolute inset-y-0 left-0 rounded-full border border-dashed border-sky-400/70" style={{ width: pct(unit.spoken) }} />
        )}
        <span className={`absolute inset-y-0 left-0 rounded-full ${FILL_TONE[unit.status]}`} style={{ width: pct(unit.estimate) }} />
        <span className="absolute -top-1 -bottom-1 w-px bg-slate-400" style={{ left: pct(unit.slot) }} />
        {unit.wantSeconds !== undefined && (
          <span className="absolute -top-1.5 -bottom-1.5 w-0.5 rounded-full bg-indigo-300" style={{ left: pct(unit.wantSeconds) }} />
        )}
      </span>
      <span className="font-mono text-[10.5px] text-slate-500 tabular-nums">
        {unit.estimate.toFixed(1)} s / {short ? `${unit.spoken.toFixed(1)} s spoken` : `${unit.slot.toFixed(1)} s slot`}
      </span>
      {unit.wantSeconds !== undefined && (
        <span className="font-mono text-[10.5px] text-indigo-300 tabular-nums">your trim {unit.wantSeconds.toFixed(1)} s</span>
      )}
    </div>
  );
};

export type ScriptFitFilter = 'all' | 'fix';

/** Counts, the rate the estimate is made at, the filter, and one button for every open line. */
export const ScriptFitStrip: React.FC<{
  preview: SyncPreview | null;
  loading: boolean;
  error: string | null;
  rateMeasured: boolean;
  filter: ScriptFitFilter;
  onFilter: (filter: ScriptFitFilter) => void;
  /** Open lines with no suggestion yet, each to be worded the way it needs. */
  toFix: { shorter: number; longer: number };
  onFixAll: () => void;
}> = ({ preview, loading, error, rateMeasured, filter, onFilter, toFix, onFixAll }) => {
  if (!preview) {
    return (
      <div className="px-4 py-2 border-b border-slate-800 bg-slate-950/40 text-xs" role="status">
        {error ? (
          <span className="text-amber-300">The sync fit could not be worked out: {error}</span>
        ) : (
          <span className="flex items-center gap-2 text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Timing each line against its source sentence…
          </span>
        )}
      </div>
    );
  }
  const { summary } = preview;
  const fixCount = toFix.shorter + toFix.longer;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 border-b border-slate-800 bg-slate-950/40">
      <span className="text-[11px] font-bold tracking-wider uppercase text-indigo-300">Sync fit</span>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 tabular-nums">
          {summary.fits - summary.short + summary.tight} fit
        </span>
        {summary.long > 0 && (
          <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-300 tabular-nums">{summary.long} too long</span>
        )}
        {summary.short > 0 && (
          <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-300 tabular-nums">{summary.short} end early</span>
        )}
      </span>
      <span
        className="font-mono text-[11px] text-slate-500 tabular-nums"
        title={
          rateMeasured
            ? 'Estimated from the text length at the speaking rate measured from your Final dub. Sync measures the real clips.'
            : 'A typical rate. Make the dub first for an estimate from your own voice.'
        }
      >
        {preview.method === 'expert' && preview.syllablesPerSecond
          ? `Expert · ${preview.syllablesPerSecond.toFixed(1)} syllables/s`
          : `est. at ${preview.charsPerSecond.toFixed(1)} chars/s`}{' '}
        · {rateMeasured ? 'from this dub' : 'typical rate, rough'}
      </span>
      {loading && <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" aria-label="Updating" />}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        <span role="group" aria-label="Show lines" className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 gap-0.5">
          {[
            { id: 'all' as const, label: 'All lines' },
            { id: 'fix' as const, label: 'Lines to fix' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => onFilter(f.id)}
              className={`px-2 py-0.5 rounded-md text-[11.5px] font-medium transition-colors cursor-pointer ${
                filter === f.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </span>
        {fixCount > 1 && (
          <button
            type="button"
            onClick={onFixAll}
            className="h-7 px-2.5 rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer"
            title="Asks your text model, not ElevenLabs, for each line the way it needs"
          >
            Suggest for all {fixCount}
            <span className="text-slate-400 font-normal">
              {' '}
              ({[toFix.shorter && `${toFix.shorter} shorter`, toFix.longer && `${toFix.longer} fuller`].filter(Boolean).join(', ')})
            </span>
          </button>
        )}
      </span>
    </div>
  );
};
