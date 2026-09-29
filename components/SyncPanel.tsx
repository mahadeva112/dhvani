import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Loader2, Lock, Mic, Play, RefreshCw, Scissors, X } from 'lucide-react';
import {
  SYNC_PRECISION_OPTIONS,
  SYNC_STEPS,
  SyncOptions,
  SyncPrecision,
  SyncProgress,
  SyncReport,
  SyncUnitReport,
} from '../services/syncService';

/**
 * Sync: makes a dub that plays in step with the original, line by line, and
 * shows how well each line landed. See services/syncService.ts.
 */

const OPTIONS_KEY = 'dhvani_sync_options';

/** Seconds of the timeline shown at once. */
const WINDOW_SECONDS = 30;

const formatClock = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

const formatOffset = (seconds: number) => `${seconds > 0 ? '+' : seconds < 0 ? '−' : '±'}${Math.abs(seconds).toFixed(2)} s`;

const readOptions = (): SyncOptions => {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}');
    return {
      precision: SYNC_PRECISION_OPTIONS.some((o) => o.id === saved.precision) ? saved.precision : 'phrase',
      suggest: saved.suggest !== false,
      matchLoudness: saved.matchLoudness === true,
    };
  } catch {
    return { precision: 'phrase', suggest: true, matchLoudness: false };
  }
};

/** Why a line is worth a listen, or null when it landed cleanly. */
const reviewReason = (unit: SyncUnitReport, tolerance: number): string | null => {
  if (unit.silent) return 'The voice returned no audio for this line';
  if (unit.exceeded) return `Runs ${unit.exceededBy.toFixed(2)} s longer than the original line had`;
  if (unit.overrun !== null && unit.overrun > tolerance) return `Runs ${unit.overrun.toFixed(2)} s into the next line`;
  if (unit.offset !== null && Math.abs(unit.offset) > tolerance) return unit.offset > 0 ? 'Starts late: the line before it runs long' : 'Starts early to make room';
  return null;
};

export interface SyncPanelProps {
  report: SyncReport | null;
  progress: SyncProgress | null;
  isSyncing: boolean;
  isCancelling: boolean;
  /** Why the last sync failed. */
  error?: string | null;
  /** Set when Sync can't run right now, with the reason shown instead of the button. */
  blockedReason?: string | null;
  onSync: (options: SyncOptions) => void;
  onCancel: () => void;
  currentTime: number;
  onSeek: (time: number) => void;
  /** Plays source and dub together from `time`. */
  onListen: (time: number) => void;
  /** Keys of lines reworded or retaken since this report: the next Sync voices them again. */
  pendingLines?: string[];
  /** Puts a new wording of a line into the script. */
  onApplyLine?: (unit: SyncUnitReport, text: string) => void;
  /** Asks for a new take of a line. */
  onRetakeLine?: (unit: SyncUnitReport) => void;
}

export const SyncPanel: React.FC<SyncPanelProps> = ({
  report,
  progress,
  isSyncing,
  isCancelling,
  error,
  blockedReason,
  onSync,
  onCancel,
  currentTime,
  onSeek,
  onListen,
  pendingLines = [],
  onApplyLine,
  onRetakeLine,
}) => {
  const [options, setOptions] = useState(readOptions);
  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    } catch {}
  }, [options]);

  const review = useMemo(() => {
    if (!report) return [];
    return report.units
      .map((unit) => ({ unit, reason: reviewReason(unit, report.tolerance) }))
      .filter((row): row is { unit: SyncUnitReport; reason: string } => Boolean(row.reason))
      .sort(
        (a, b) =>
          Number(b.unit.exceeded) - Number(a.unit.exceeded) ||
          Number(a.unit.inSync) - Number(b.unit.inSync) ||
          b.unit.exceededBy - a.unit.exceededBy ||
          Math.abs(b.unit.offset ?? 99) - Math.abs(a.unit.offset ?? 99)
      );
  }, [report]);

  const step = progress?.step ?? 1;
  const stepDetail = (phase: string) => {
    if (!progress) return '';
    if (phase === 'voicing' && progress.unitCount > 0) {
      return progress.unitsToVoice === 0 && step > 2
        ? 'reused'
        : `${Math.min(progress.unitsVoiced, progress.unitsToVoice)} / ${progress.unitsToVoice}`;
    }
    if (phase === 'suggesting' && progress.suggestionsTotal > 0) return `${progress.suggestionsDone} / ${progress.suggestionsTotal}`;
    if (phase === 'units' && progress.unitCount > 0) return `${progress.unitCount} lines`;
    return '';
  };
  const fraction = !progress
    ? 0.02
    : progress.step === 2 && progress.unitsToVoice > 0
      ? (1 + progress.unitsVoiced / progress.unitsToVoice) / SYNC_STEPS.length
      : (progress.step - 1) / SYNC_STEPS.length;

  return (
    <section aria-label="Sync" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[15px] font-semibold text-slate-100">Sync to the original</h2>
            {report && !isSyncing && (
              <span className="flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                <Check className="w-3 h-3" /> Synced
              </span>
            )}
            {isSyncing && (
              <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">
                {isCancelling ? 'Cancelling…' : 'In progress'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
            <Lock className="w-3 h-3 shrink-0" />
            Each line starts where the original line starts. The voice is never changed: no speed change, no volume change and no fades. Lines are only moved, and the silence inside them shortened.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={options.precision}
            onChange={(e) => setOptions((o) => ({ ...o, precision: e.target.value as SyncPrecision }))}
            disabled={isSyncing}
            aria-label="Sync precision"
            className="h-8 bg-slate-950 border border-slate-800 rounded-lg px-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50"
          >
            {SYNC_PRECISION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id} className="bg-slate-900">
                {o.label}
              </option>
            ))}
          </select>
          <label
            className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer"
            title="Lines too long for the time the original line had get a shorter wording suggested. Your script is never changed."
          >
            <input
              type="checkbox"
              checked={options.suggest}
              disabled={isSyncing}
              onChange={(e) => setOptions((o) => ({ ...o, suggest: e.target.checked }))}
              className="accent-indigo-500"
            />
            Suggest shorter lines
          </label>
          <label
            className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer"
            title="Bring every line to the same loudness. Off, each line keeps exactly the level it was voiced at."
          >
            <input
              type="checkbox"
              checked={options.matchLoudness}
              disabled={isSyncing}
              onChange={(e) => setOptions((o) => ({ ...o, matchLoudness: e.target.checked }))}
              className="accent-indigo-500"
            />
            Even out loudness
          </label>
          {isSyncing ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="h-9 px-3.5 flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-sm font-medium text-slate-200 disabled:opacity-50 cursor-pointer"
            >
              <X className="w-4 h-4" /> {isCancelling ? 'Cancelling…' : 'Cancel'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSync(options)}
              disabled={Boolean(blockedReason)}
              title={blockedReason || undefined}
              className="h-9 px-4 flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer active:translate-y-px"
            >
              {report ? <RefreshCw className="w-4 h-4" /> : <Scissors className="w-4 h-4" />}
              {report ? 'Sync again' : 'Sync'}
            </button>
          )}
        </div>
      </div>
      {blockedReason && !isSyncing && <p className="-mt-2 text-xs text-amber-300">{blockedReason}</p>}
      {error && !isSyncing && (
        <p role="alert" className="-mt-2 text-xs text-rose-300">
          Sync failed: {error}
        </p>
      )}

      {isSyncing && (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-[width] duration-500"
              style={{ width: `${Math.max(2, fraction * 100)}%` }}
            />
          </div>
          <ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-1.5">
            {SYNC_STEPS.map((s, i) => {
              const state = i + 1 < step ? 'done' : i + 1 === step ? 'active' : 'todo';
              return (
                <li
                  key={s.phase}
                  className={`flex items-center gap-2 text-[12.5px] ${
                    state === 'active' ? 'text-slate-100' : state === 'done' ? 'text-slate-400' : 'text-slate-600'
                  }`}
                >
                  {state === 'done' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : state === 'active' ? (
                    <Loader2 className="w-3.5 h-3.5 text-cyan-300 animate-spin shrink-0" />
                  ) : (
                    <span className="w-3.5 h-3.5 rounded-full border border-slate-700 shrink-0" />
                  )}
                  <span className="truncate">{s.label}</span>
                  {state !== 'todo' && stepDetail(s.phase) && (
                    <span className="ml-auto font-mono text-[11px] text-slate-500 tabular-nums">{stepDetail(s.phase)}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {report && !isSyncing && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                label: 'Lines in sync',
                value: `${report.summary.inSync} / ${report.summary.lines}`,
                tone: report.summary.inSync === report.summary.lines ? 'text-emerald-300' : 'text-slate-100',
              },
              { label: 'Start error, 90% of lines', value: `${report.summary.p90Error.toFixed(2)} s` },
              {
                label: 'Worst line',
                value: `${report.summary.maxError.toFixed(2)} s`,
                tone: report.summary.maxError > report.tolerance ? 'text-amber-300' : 'text-slate-100',
              },
              {
                label: 'Lines too long',
                value: String(report.summary.exceeded),
                tone: report.summary.exceeded > 0 ? 'text-amber-300' : 'text-slate-100',
              },
            ].map((m) => (
              <div key={m.label} className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2.5">
                <span className="block text-[11.5px] text-slate-400">{m.label}</span>
                <span className={`block text-xl font-semibold tabular-nums ${m.tone || 'text-slate-100'}`}>{m.value}</span>
              </div>
            ))}
          </div>

          <SyncTimeline report={report} currentTime={currentTime} onSeek={onSeek} />

          {report.summary.suggestionError && (
            <p className="text-xs text-amber-300">
              No shorter line could be suggested for {report.summary.exceeded - report.summary.suggested} of the lines that run long. The
              text model said: {report.summary.suggestionError}
            </p>
          )}

          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[13.5px] font-semibold text-slate-100">Worth a listen</h3>
              <span className="text-xs text-slate-500">
                {review.length === 0
                  ? 'Every line landed within tolerance.'
                  : `${review.filter((r) => !r.unit.inSync).length} outside tolerance · ${report.summary.exceeded} too long for their slot`}
              </span>
            </div>
            {pendingLines.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-500/40 bg-indigo-950/30 px-3.5 py-2.5">
                <span className="flex-1 min-w-0 text-[12.5px] text-slate-200">
                  {pendingLines.length === 1 ? '1 line changed.' : `${pendingLines.length} lines changed.`} Sync again voices only{' '}
                  {pendingLines.length === 1 ? 'that line' : 'those lines'} and places everything again; every other line is reused.
                </span>
                <button
                  type="button"
                  onClick={() => onSync(options)}
                  disabled={Boolean(blockedReason)}
                  className="h-8 px-3.5 flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:bg-slate-800 disabled:text-slate-500 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Sync again
                </button>
              </div>
            )}
            {review.length > 0 && (
              <ul className="mt-2 max-h-[28rem] overflow-y-auto custom-scrollbar divide-y divide-slate-800 border-y border-slate-800">
                {review.map(({ unit, reason }) => (
                  <ReviewRow
                    key={unit.index}
                    unit={unit}
                    reason={reason}
                    pending={pendingLines.includes(unit.key)}
                    onListen={onListen}
                    onApply={onApplyLine}
                    onRetake={onRetakeLine}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
};

/**
 * One line worth a listen: the dub line over the original line, why it was
 * flagged, and what the user can do about it. A line too long for its slot
 * gets an editable shorter wording (the suggestion, when there is one) to put
 * into the script; any line can be retaken. Neither is heard until the next
 * Sync, so the row shows it is waiting for one.
 */
const ReviewRow: React.FC<{
  unit: SyncUnitReport;
  reason: string;
  pending: boolean;
  onListen: (time: number) => void;
  onApply?: (unit: SyncUnitReport, text: string) => void;
  onRetake?: (unit: SyncUnitReport) => void;
}> = ({ unit, reason, pending, onListen, onApply, onRetake }) => {
  const [draft, setDraft] = useState(unit.suggestion || unit.text);
  const [copied, setCopied] = useState(false);
  useEffect(() => setDraft(unit.suggestion || unit.text), [unit.suggestion, unit.text]);
  const changed = draft.trim() !== '' && draft.trim() !== unit.text.trim();
  const copy = () =>
    navigator.clipboard
      ?.writeText(draft)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});

  return (
    <li className="flex items-start gap-3 py-3">
      <span
        className={`shrink-0 mt-0.5 font-mono text-[11px] px-2 py-0.5 rounded-md tabular-nums ${
          unit.inSync ? 'bg-slate-800 text-slate-300' : 'bg-amber-500/15 text-amber-300'
        }`}
      >
        {unit.offset === null ? 'silent' : formatOffset(unit.offset)}
      </span>
      <span className="shrink-0 mt-0.5 font-mono text-[11.5px] text-slate-500 tabular-nums w-14">{formatClock(unit.srcStart)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] text-slate-100 leading-snug">{unit.text}</p>
        {unit.sourceText && <p className="text-[12px] text-slate-500 leading-snug mt-0.5">{unit.sourceText}</p>}
        <p className={`text-[11.5px] mt-1 ${unit.exceeded ? 'text-amber-300' : 'text-slate-400'}`}>{reason}</p>

        {pending ? (
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300">
            <RefreshCw className="w-3 h-3" /> Changed. Sync again to hear it.
          </p>
        ) : (
          unit.exceeded &&
          onApply && (
            <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
              <label className="block text-[10.5px] uppercase tracking-wide font-semibold text-slate-500 mb-1" htmlFor={`sync-line-${unit.key}`}>
                {unit.suggestion ? 'Suggested shorter line' : 'Shorten this line'}
              </label>
              <textarea
                id={`sync-line-${unit.key}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                className="w-full resize-y bg-slate-900 border border-slate-800 rounded-md px-2 py-1.5 text-[13px] text-slate-100 leading-snug focus:outline-none focus:border-indigo-500"
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onApply(unit, draft)}
                  disabled={!changed}
                  className="h-7 px-2.5 flex items-center gap-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer"
                  title="Put this wording into the script. Sync again to voice it."
                >
                  <Check className="w-3.5 h-3.5" /> Use this line
                </button>
                <button
                  type="button"
                  onClick={copy}
                  className="h-7 px-2 flex items-center gap-1 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-300 cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {draft.trim().length} / {unit.text.trim().length} characters
                </span>
              </div>
            </div>
          )
        )}
      </div>
      <div className="shrink-0 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => onListen(Math.max(0, unit.srcStart - 0.6))}
          className="flex items-center gap-1 h-7 px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs text-slate-200 cursor-pointer"
        >
          <Play className="w-3 h-3 fill-current" /> Listen
        </button>
        {onRetake && !unit.silent && (
          <button
            type="button"
            onClick={() => onRetake(unit)}
            disabled={pending}
            className="flex items-center gap-1 h-7 px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            title="Voice this line again for a new take. Sync again to hear it."
          >
            <Mic className="w-3 h-3" /> Retake
          </button>
        )}
      </div>
    </li>
  );
};

/** The original's lines above the dub's, over a 30-second window that follows the playhead. */
const SyncTimeline: React.FC<{ report: SyncReport; currentTime: number; onSeek: (time: number) => void }> = ({
  report,
  currentTime,
  onSeek,
}) => {
  const total = Math.max(report.duration, ...report.units.map((u) => u.srcEnd));
  const [windowStart, setWindowStart] = useState(0);
  const [follow, setFollow] = useState(true);

  // Follow playback: page the window forward when the playhead leaves it.
  useEffect(() => {
    if (!follow) return;
    if (currentTime < windowStart || currentTime > windowStart + WINDOW_SECONDS) {
      setWindowStart(Math.max(0, Math.min(total - WINDOW_SECONDS, currentTime - 2)));
    }
  }, [currentTime, follow, windowStart, total]);

  const end = windowStart + WINDOW_SECONDS;
  const pct = (t: number) => ((t - windowStart) / WINDOW_SECONDS) * 100;
  const visible = report.units.filter((u) => u.srcEnd >= windowStart && u.srcStart <= end);
  const page = (dir: number) => {
    setFollow(false);
    setWindowStart((s) => Math.max(0, Math.min(Math.max(0, total - WINDOW_SECONDS), s + dir * WINDOW_SECONDS * 0.8)));
  };
  const seekAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setFollow(true);
    onSeek(windowStart + ((e.clientX - r.left) / r.width) * WINDOW_SECONDS);
  };

  const lane = (kind: 'source' | 'dub') => (
    <div className="relative h-9 rounded-lg bg-slate-950/60 overflow-hidden cursor-pointer" onClick={seekAt}>
      {visible.map((u) => {
        const from = kind === 'source' ? u.srcStart : u.placedStart;
        const to = kind === 'source' ? u.srcEnd : u.placedEnd;
        if (from === null || to === null) return null;
        const flagged = kind === 'dub' && !u.inSync;
        return (
          <span
            key={u.index}
            title={kind === 'dub' ? `${u.text}${u.offset !== null ? ` (${formatOffset(u.offset)})` : ''}` : u.sourceText}
            className={`absolute top-1.5 bottom-1.5 rounded ${
              kind === 'source'
                ? 'bg-cyan-400/35'
                : flagged
                  ? 'bg-amber-400/40 ring-1 ring-amber-400'
                  : u.exceeded
                    ? 'bg-indigo-400/50 outline-1 outline-dashed outline-amber-300'
                    : 'bg-indigo-400/50'
            }`}
            style={{ left: `${pct(from)}%`, width: `${Math.max(0.3, pct(to) - pct(from))}%` }}
          />
        );
      })}
      {currentTime >= windowStart && currentTime <= end && (
        <span className="absolute top-0 bottom-0 w-0.5 bg-slate-100 pointer-events-none" style={{ left: `${pct(currentTime)}%` }} />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-center">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="w-2 h-2 rounded-sm bg-cyan-400" /> Original
        </span>
        {lane('source')}
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="w-2 h-2 rounded-sm bg-indigo-400" /> Dub
        </span>
        {lane('dub')}
      </div>
      <div className="pl-[5.25rem] flex items-center gap-3 text-[11px] text-slate-500">
        <button type="button" onClick={() => page(-1)} aria-label="Earlier" className="w-6 h-6 rounded-md hover:bg-slate-800 flex items-center justify-center cursor-pointer">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="font-mono tabular-nums">
          {formatClock(windowStart)} – {formatClock(Math.min(end, total))}
        </span>
        <button type="button" onClick={() => page(1)} aria-label="Later" className="w-6 h-6 rounded-md hover:bg-slate-800 flex items-center justify-center cursor-pointer">
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <span className="ml-auto flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm outline-1 outline-dashed outline-amber-300" /> Too long</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm ring-1 ring-amber-400 bg-amber-400/40" /> Outside tolerance</span>
        </span>
      </div>
    </div>
  );
};
