import React from 'react';
import { FlowArrow } from './FlowArrow';
import { Loader2 } from 'lucide-react';
import { wantsChange } from '../services/syncService';
import type { SyncPreview, SyncPreviewUnit } from '../services/syncService';
import type { RateBasis } from '../services/voiceRate';

/**
 * A script's sync fit, in Review and in the Dub step: how long each dub line
 * is estimated to take against the time its source sentence gives it
 * (server/lib/syncPreview.js). Which way a line should change is decided
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

/** A line to fix in a few words, for its row while the row is closed. */
export const fitNote = (unit: SyncPreviewUnit) =>
  unit.wantSeconds !== undefined
    ? `Trimmed to ${unit.wantSeconds.toFixed(1)} s, the words don't fit it yet`
    : unit.status === 'long'
      ? `About ${unit.overflow.toFixed(1)} s too long`
      : unit.status === 'short'
        ? `Ends about ${unit.underflow.toFixed(1)} s early`
        : fitLabel(unit);

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
    ? `Runs about ${unit.overflow.toFixed(1)} s into the next line${
        unit.read - unit.estimate >= 0.1 ? `, even once Sync closes it up (read in ${unit.read.toFixed(1)} s, placed in about ${unit.estimate.toFixed(1)} s)` : ''
      }. Aim for about ${unit.targetChars} characters (now ${unit.text.length})${
        unit.expert && unit.expert.cut > 0 ? `, about ${unit.expert.cut} syllable${unit.expert.cut === 1 ? '' : 's'} fewer` : ''
      }.`
    : unit.status === 'short'
      ? `Ends about ${unit.underflow.toFixed(1)} s before the original speaker stops. Aim for about ${unit.targetChars} characters (now ${unit.text.length}).`
      : unit.status === 'tight'
        ? unit.read - unit.estimate >= 0.1
          ? `Fits, just, once Sync closes it up: read in ${unit.read.toFixed(1)} s, placed in about ${unit.estimate.toFixed(1)} s.`
          : 'Fits, just. Sync can shorten the pauses inside it.'
        : '';

/**
 * The marks in a line where the voice may pause and the original speaker
 * doesn't. Sync cuts such a pause anyway (Match source pauses); without the
 * mark the line also reads the way the original was said.
 */
export const pauseAdvice = (unit: SyncPreviewUnit) => {
  const marks = unit.unpausedMarks ?? [];
  if (marks.length === 0) return '';
  const where = marks
    .slice(0, 3)
    .map(({ mark, after }) => `“${after}${mark}”`)
    .join(', ');
  return `The original runs straight on at ${where}${marks.length > 3 ? ` and ${marks.length - 3} more` : ''}: the voice may pause there.`;
};

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
      title={`${unit.text}\nAbout ${unit.estimate.toFixed(1)} s of speech${unit.read - unit.estimate >= 0.1 ? ` once placed (read in ${unit.read.toFixed(1)} s)` : ''} · slot ${unit.slot.toFixed(1)} s · original speech ${unit.spoken.toFixed(1)} s`}
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

const RATE_BASIS_LABELS: Record<RateBasis, string> = {
  learned: "learned from your voice's Syncs",
  sync: 'from your last sync',
  sample: "from your voice's sample read",
  typical: 'typical rate, rough',
};

const RATE_BASIS_TITLES: Record<RateBasis, string> = {
  learned: "Estimated at your voice's pace and pauses, learned free from the words of every Sync it voiced in this language.",
  sync: 'Estimated at the speaking rate measured from your last sync. Sync measures the real clips.',
  sample: 'Estimated at the speaking rate your voice read its sample at in this language. Sync measures the real clips.',
  typical: "A typical rate. Once your voice has read its sample, or after the first sync, the estimate uses your own voice.",
};

/** Counts, the rate the estimate is made at, the filter, and one button for every open line. */
export const ScriptFitStrip: React.FC<{
  preview: SyncPreview | null;
  loading: boolean;
  error: string | null;
  /** Where the speaking rate came from: the last sync, the voice's sample read, or a typical rate. */
  rateBasis: RateBasis;
  /** All lines or only those to fix; left out where the page filters on its own. */
  filter?: ScriptFitFilter;
  onFilter?: (filter: ScriptFitFilter) => void;
  /** Open lines with no suggestion yet, each to be worded the way it needs; left out where lines aren't reworded. */
  toFix?: { shorter: number; longer: number };
  onFixAll?: () => void;
  /** Shown beside the rate: the Quick or Expert switch. */
  estimate?: React.ReactNode;
  /** How the estimate was made, in a sentence, for the rate's tooltip. */
  basis?: string;
  /** Lines that need a new wording, and the way to list only them. */
  fixCount?: number;
  onShowFix?: () => void;
}> = ({ preview, loading, error, rateBasis, filter, onFilter, toFix, onFixAll, estimate, basis, fixCount: linesToFix = 0, onShowFix }) => {
  if (!preview) {
    return (
      <div className="px-4 py-2.5 border-b border-edge bg-slate-950/40 text-[13px]" role="status">
        {error ? (
          <span className="text-amber-300">The sync fit could not be worked out.</span>
        ) : (
          <span className="flex items-center gap-2 text-slate-400">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Timing each line against its source sentence…
          </span>
        )}
      </div>
    );
  }
  const { summary } = preview;
  const fixCount = toFix ? toFix.shorter + toFix.longer : 0;
  // Counted from the lines themselves, so every count in Review (filter, strip, passages) is the same count.
  const count = (status: SyncPreviewUnit['status']) => preview.units.filter((u) => u.status === status).length;
  const counts = { fits: count('fits'), tight: count('tight'), long: count('long'), short: count('short') };
  const part = (n: number, label: string, tone: string) => (
    <span className={n > 0 && tone ? tone : 'text-slate-300'}>
      <b className="font-mono font-semibold tabular-nums">{n}</b> {label}
    </span>
  );
  const dot = <span className="text-slate-600">·</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-4 py-2.5 border-b border-edge bg-slate-950/40 text-[13px]">
      <span className="font-medium text-slate-300">Sync fit</span>
      <span className="text-slate-400 tabular-nums">
        {preview.units.length} {preview.units.length === 1 ? 'line' : 'lines'}:
      </span>
      {part(counts.fits, 'fit', '')}
      {dot}
      {part(counts.tight, 'tight', 'text-amber-300')}
      {dot}
      {part(counts.long, 'too long', 'text-rose-300')}
      {dot}
      {part(counts.short, counts.short === 1 ? 'ends early' : 'end early', 'text-sky-300')}
      {counts.long > 0 && <span className="font-mono text-[12.5px] text-slate-400 tabular-nums">longest +{summary.maxOverflow.toFixed(1)} s</span>}
      {summary.lips && summary.lips.total > 0 && (
        <span className="font-mono text-[12.5px] text-slate-400 tabular-nums" title="Lines whose lip closings land where the original's do">
          lips {summary.lips.matched} / {summary.lips.total}
        </span>
      )}
      <span
        className="text-[12.5px] text-slate-400 underline decoration-dotted decoration-slate-600 underline-offset-4 cursor-help"
        title={[
          `${
            preview.method === 'expert' && preview.syllablesPerSecond
              ? `Expert · ${preview.syllablesPerSecond.toFixed(1)} syllables/s`
              : `Quick · ${preview.charsPerSecond.toFixed(1)} chars/s`
          } · ${RATE_BASIS_LABELS[rateBasis]}.`,
          basis,
          RATE_BASIS_TITLES[rateBasis],
        ]
          .filter(Boolean)
          .join('\n')}
      >
        {preview.method === 'expert' ? 'Expert' : 'Quick'} estimate
      </span>
      {estimate}
      {loading && <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" aria-label="Updating" />}
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {filter && onFilter && (
        <span role="group" aria-label="Show lines" className="flex bg-slate-950 border border-edge rounded-lg p-0.5 gap-0.5">
          {[
            { id: 'all' as const, label: 'All lines' },
            { id: 'fix' as const, label: 'Lines to fix' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => onFilter(f.id)}
              className={`px-2 py-0.5 rounded-md text-[11.5px] font-medium transition-colors cursor-default ${
                filter === f.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </span>
        )}
        {toFix && onFixAll && fixCount > 1 && (
          <button
            type="button"
            onClick={onFixAll}
            className="h-7 px-2.5 rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-default"
            title="Asks your text model, not ElevenLabs, for each line the way it needs"
          >
            Suggest for all {fixCount}
            <span className="text-slate-400 font-normal">
              {' '}
              ({[toFix.shorter && `${toFix.shorter} shorter`, toFix.longer && `${toFix.longer} fuller`].filter(Boolean).join(', ')})
            </span>
          </button>
        )}
        {onShowFix && linesToFix > 0 && (
          <button
            type="button"
            onClick={onShowFix}
            className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-lg border border-slate-600 hover:bg-slate-800 text-[12.5px] font-medium text-slate-100 cursor-default"
          >
            Show {linesToFix} to fix <FlowArrow className="text-slate-300" />
          </button>
        )}
      </span>
    </div>
  );
};
