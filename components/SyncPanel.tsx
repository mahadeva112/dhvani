import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, AudioWaveform, Check, ChevronRight, Copy, Download, Loader2, Lock, Mic, Play, RefreshCw, RotateCcw, TriangleAlert, X } from 'lucide-react';
import {
  LineSuggestion,
  SYNC_JOIN_PRESETS,
  SYNC_PRECISION_OPTIONS,
  SYNC_STEPS,
  SyncOptions,
  SyncPrecision,
  SyncProgress,
  SyncReport,
  SyncUnitReport,
  SyncVoicing,
} from '../services/syncService';
import type { DubProgress } from '../services/elevenLabsService';
import { isShort, MAX_TRIED, MeaningWarning } from './SyncPreviewPanel';
import { SyncAlignmentView } from './SyncAlignmentView';
import { joinPresetOf, readJoinSettings, SyncFitSource, SyncJoinSettingsPanel } from './SyncJoinSettings';

/**
 * Sync, in the Dub step: voices the script line by line, places each line in
 * step with the original, and shows how well each line landed. Two panels:
 * the settings rail (what to sync with, and the button) and the results
 * (what the dub will take, progress, then the report). See services/syncService.ts.
 */

const OPTIONS_KEY = 'dhvani_sync_options';


const formatClock = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

const formatOffset = (seconds: number) => `${seconds > 0 ? '+' : seconds < 0 ? '−' : '±'}${Math.abs(seconds).toFixed(2)} s`;

/**
 * The settings Sync starts with: each line voiced on its own, phrase
 * precision, Natural joins, no suggestions. Loudness is not one of them: the
 * Dub step's Even out loudness decides it for every dub.
 */
export const defaultSyncOptions = (): SyncOptions => ({
  voicing: 'lines',
  precision: 'phrase',
  preset: 'natural',
  join: readJoinSettings(null),
  suggest: false,
  suggestLonger: false,
  matchLoudness: false,
});

const isDefaultOptions = (options: SyncOptions) => {
  const defaults = defaultSyncOptions();
  return (
    options.voicing === defaults.voicing &&
    options.precision === defaults.precision &&
    options.preset === defaults.preset &&
    options.suggest === defaults.suggest &&
    options.suggestLonger === defaults.suggestLonger &&
    joinPresetOf(options.join) === 'natural'
  );
};

const readOptions = (): SyncOptions => {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}');
    // A saved preset is read as the preset is now, so a retuned preset reaches everyone who picked it.
    const preset = (Object.keys(SYNC_JOIN_PRESETS) as (keyof typeof SYNC_JOIN_PRESETS)[]).find((id) => id === saved.preset);
    const join = preset ? { ...SYNC_JOIN_PRESETS[preset] } : readJoinSettings(saved.join);
    return {
      voicing: saved.voicing === 'continuous' ? 'continuous' : 'lines',
      precision: SYNC_PRECISION_OPTIONS.some((o) => o.id === saved.precision) ? saved.precision : 'phrase',
      // A saved Custom stays Custom even when it happens to match a preset.
      preset: preset ?? (saved.preset === 'custom' ? 'custom' : joinPresetOf(join)),
      join,
      suggest: saved.suggest === true,
      suggestLonger: saved.suggestLonger === true,
      matchLoudness: saved.matchLoudness === true,
    };
  } catch {
    return defaultSyncOptions();
  }
};

/** The sync options, remembered across sessions. One copy serves both panels. */
export const useSyncOptions = () => {
  const [options, setOptions] = useState(readOptions);
  useEffect(() => {
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
    } catch {}
  }, [options]);
  return [options, setOptions] as const;
};

/** How far a sync has come, 0–1, for the progress bars. */
export const syncFraction = (progress: SyncProgress | null) =>
  !progress
    ? 0.02
    : progress.step === 2 && progress.unitsToVoice > 0
      ? (1 + progress.unitsVoiced / progress.unitsToVoice) / SYNC_STEPS.length
      : (progress.step - 1) / SYNC_STEPS.length;

/**
 * The sync's result in one badge: green only when every line is in sync,
 * amber with what is off otherwise, so "Synced" never reads as "in sync".
 */
export const SyncVerdictBadge: React.FC<{ report: SyncReport }> = ({ report }) => {
  const { inSync, lines, exceeded, maxError } = report.summary;
  if (inSync === lines) {
    return (
      <span className="flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
        <Check className="w-3 h-3" /> Synced · all {lines} lines in sync
      </span>
    );
  }
  const off = [
    exceeded > 0 ? `${exceeded} line${exceeded === 1 ? '' : 's'} too long` : `${inSync} of ${lines} in sync`,
    `worst line off by ${maxError.toFixed(1)} s`,
  ];
  return (
    <span className="flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-400/12 text-amber-300">
      <TriangleAlert className="w-3 h-3" /> Synced · {off.join(' · ')}
    </span>
  );
};

/** Why a line is worth a listen, or null when it landed cleanly. */
const reviewReason = (unit: SyncUnitReport, tolerance: number): string | null => {
  if (unit.silent) return 'The voice returned no audio for this line';
  if (unit.cutOff)
    return `The voice stops before the last word is finished${unit.retakes ? `, in all ${unit.retakes + 1} takes` : ''}: retake it or reword the line`;
  if (unit.exceeded && unit.deepCut)
    return `Runs ${unit.exceededBy.toFixed(2)} s longer than the original line had. Fewer words would cut over a third of it and lose what it says: give it more time in Edit timing, or join it with the line beside it`;
  if (unit.exceeded) return `Runs ${unit.exceededBy.toFixed(2)} s longer than the original line had`;
  if (unit.short)
    return `Ends ${unit.shortBy.toFixed(1)} s before the original speaker stops: ${unit.speech.toFixed(1)} s said, ${(unit.srcEnd - unit.srcStart).toFixed(1)} s spoken`;
  if (unit.overrun !== null && unit.overrun > tolerance) return `Runs ${unit.overrun.toFixed(2)} s into the next line`;
  if (unit.tightJoin && unit.joinAfter !== null)
    return `Only ${Math.max(0, Math.round(unit.joinAfter * 1000))} ms before the next line starts: it may sound cut off`;
  if (unit.late && unit.offset !== null) return `Starts ${unit.offset.toFixed(2)} s late: the line before it runs long`;
  if (unit.offset !== null && Math.abs(unit.offset) > tolerance) return unit.offset > 0 ? 'Starts late: the line before it runs long' : 'Starts early to make room';
  return null;
};

/** What the preview still expects, under the Sync button: lines likely too long, and lines likely to end early. */
const previewNote = (long: number, short: number) => {
  const lines = (n: number) => (n === 1 ? '1 line is' : `${n} lines are`);
  if (long > 0 && short > 0) return `${lines(long)} still likely too long, ${short} end early.`;
  if (long > 0) return `${lines(long)} still likely too long.`;
  return `${lines(short)} likely to end early.`;
};

/** The two ways to voice a dub, as the settings offer them. */
const VOICING_OPTIONS: { id: SyncVoicing; label: string; detail: string }[] = [
  { id: 'lines', label: 'Line by line', detail: 'Each line is voiced for its own slot. The best timing; a retake matches the lines around it.' },
  {
    id: 'continuous',
    label: 'One continuous read',
    detail: 'The script is read in one take, then each line is cut from it and placed. The most natural flow, for narration. One voice only.',
  },
];

const sectionLabel ='text-[10.5px] uppercase tracking-wider font-semibold text-slate-500';
const downloadRow =
  'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-left text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';

export interface SyncSettingsPanelProps {
  options: SyncOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<SyncOptions>>;
  /** True once this dub has been synced: the button reads Sync again. */
  synced: boolean;
  /** True when there is a dub for the sync to replace. */
  hasDub: boolean;
  isSyncing: boolean;
  isCancelling: boolean;
  /** Why the last sync failed. */
  error?: string | null;
  /** Set when Sync can't run right now, with the reason shown under the button. */
  blockedReason?: string | null;
  /** Lines reworded or retaken since the last sync. */
  pendingCount?: number;
  /** Before a sync: the preview is on screen, and how many lines it expects to run long or end early. */
  previewShown?: boolean;
  previewLongCount?: number;
  previewShortCount?: number;
  onSync: () => void;
  onCancel: () => void;
  /** Back to Review. */
  onBack: () => void;
  /** What a dub costs, under the button before the first sync. */
  costNote?: string;
  /** Files and tools at the foot of the rail: the script, the other studios. */
  extras?: React.ReactNode;
  /** Saves the synced dub; absent before the first sync. */
  onDownloadWav?: () => void;
  /** Opens the voice changer on the synced dub; absent before the first sync. */
  onOpenVoiceChanger?: () => void;
  /** The subtitles section: downloads and settings, built by the step. */
  subtitles?: React.ReactNode;
  /** Several speakers: a continuous read needs one voice, so each line is voiced on its own. */
  multiSpeaker?: boolean;
  /** What Fit to this video measures from; the card is left out without it. */
  fitSource?: SyncFitSource;
}

/** The Dub step's settings rail: what to sync with, the Dub & sync button, and the files. */
export const SyncSettingsPanel: React.FC<SyncSettingsPanelProps> = ({
  options,
  onOptionsChange,
  synced,
  hasDub,
  isSyncing,
  isCancelling,
  error,
  blockedReason,
  pendingCount = 0,
  previewShown = false,
  previewLongCount = 0,
  previewShortCount = 0,
  onSync,
  onCancel,
  onBack,
  costNote,
  extras,
  onDownloadWav,
  onOpenVoiceChanger,
  subtitles,
  multiSpeaker = false,
  fitSource,
}) => (
  <aside aria-label="Sync settings" className="flex flex-col bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden lg:sticky lg:top-4">
    <div className="flex items-center justify-between px-4 sm:px-5 pt-4">
      <h2 className="text-[15px] font-semibold text-slate-100">Sync settings</h2>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer">
        <ArrowLeft className="w-3 h-3" /> Review
      </button>
    </div>

    <div className={`px-4 sm:px-5 py-4 flex flex-col gap-3.5 ${isSyncing ? 'opacity-60' : ''}`}>
      <fieldset className="flex flex-col gap-1.5" disabled={isSyncing}>
        <legend className={`${sectionLabel} mb-1.5`}>How to voice</legend>
        {VOICING_OPTIONS.map((o) => {
          const off = o.id === 'continuous' && multiSpeaker;
          return (
            <label key={o.id} className={`flex items-start gap-2.5 ${off ? 'opacity-50 cursor-default' : 'cursor-pointer'}`}>
              <input
                type="radio"
                name="sync-voicing"
                checked={multiSpeaker ? o.id === 'lines' : options.voicing === o.id}
                disabled={off}
                onChange={() => onOptionsChange((opts) => ({ ...opts, voicing: o.id }))}
                className="mt-0.5 accent-indigo-500"
              />
              <span>
                <span className="block text-[13px] text-slate-200">
                  {o.label}
                  {o.id === 'lines' && <span className="text-slate-500"> (default)</span>}
                </span>
                <span className="block text-[11.5px] text-slate-400 mt-0.5">
                  {off ? 'For a dub in one voice. With several speakers each line is voiced on its own.' : o.detail}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="sync-precision" className={sectionLabel}>
          Precision
        </label>
        <select
          id="sync-precision"
          value={options.precision}
          onChange={(e) => onOptionsChange((o) => ({ ...o, precision: e.target.value as SyncPrecision }))}
          disabled={isSyncing}
          className="h-9 bg-slate-950 border border-slate-800 rounded-lg px-2 text-[13px] text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:cursor-not-allowed"
        >
          {SYNC_PRECISION_OPTIONS.map((o) => (
            <option key={o.id} value={o.id} className="bg-slate-900">
              {o.label}
            </option>
          ))}
        </select>
        {previewShown && <span className="text-[11.5px] text-slate-400">The preview updates when you change this.</span>}
      </div>
      <SyncJoinSettingsPanel options={options} onOptionsChange={onOptionsChange} disabled={isSyncing} fitSource={fitSource} />
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={options.suggest}
          disabled={isSyncing}
          onChange={(e) => onOptionsChange((o) => ({ ...o, suggest: e.target.checked }))}
          className="mt-0.5 accent-indigo-500"
        />
        <span>
          <span className="block text-[13px] text-slate-200">Suggest shorter lines</span>
          <span className="block text-[11.5px] text-slate-400 mt-0.5">For lines too long for the time the original line had. Your script is never changed.</span>
        </span>
      </label>
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={options.suggestLonger}
          disabled={isSyncing}
          onChange={(e) => onOptionsChange((o) => ({ ...o, suggestLonger: e.target.checked }))}
          className="mt-0.5 accent-indigo-500"
        />
        <span>
          <span className="block text-[13px] text-slate-200">Suggest fuller lines</span>
          <span className="block text-[11.5px] text-slate-400 mt-0.5">
            For lines that end well before the original speaker stops. Same meaning, said in full. Your script is never changed.
          </span>
        </span>
      </label>
      <button
        type="button"
        onClick={() => onOptionsChange(defaultSyncOptions())}
        disabled={isSyncing || isDefaultOptions(options)}
        title={isDefaultOptions(options) ? 'Already on the default settings' : 'Line by line, phrase precision, Natural line joins, no suggestions'}
        className="self-start flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-700 text-[12.5px] text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
      </button>
    </div>

    {synced && (onDownloadWav || onOpenVoiceChanger) && (
      <div className="px-4 sm:px-5 pb-4 flex flex-col gap-2">
        <span className={sectionLabel}>Synced dub</span>
        {onDownloadWav && (
          <button type="button" onClick={onDownloadWav} disabled={isSyncing} className={downloadRow}>
            <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300">WAV</span>
            <span className="flex-1 text-[13px]">Synced dub</span>
            <Download className="w-4 h-4 text-slate-500" />
          </button>
        )}
        {onOpenVoiceChanger && (
          <button type="button" onClick={onOpenVoiceChanger} disabled={isSyncing} className={downloadRow}>
            <AudioWaveform className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px]">Change the voice</span>
              <span className="block text-[11.5px] text-slate-500 truncate">Keeps the timing; Sync again re-voices it</span>
            </span>
            <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
          </button>
        )}
      </div>
    )}

    {subtitles && (
      <div className="px-4 sm:px-5 pb-4 flex flex-col gap-2">
        <span className={sectionLabel}>Subtitles</span>
        {subtitles}
      </div>
    )}

    {extras && (
      <div className="px-4 sm:px-5 pb-4 flex flex-col gap-2">
        <span className={sectionLabel}>Script and tools</span>
        {extras}
      </div>
    )}

    <div className="mt-auto px-4 sm:px-5 py-4 border-t border-slate-800 bg-slate-950/60 flex flex-col gap-2">
      {isSyncing ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={isCancelling}
          className="h-11 flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-sm font-medium text-slate-200 disabled:opacity-50 cursor-pointer"
        >
          <X className="w-4 h-4" /> {isCancelling ? 'Cancelling…' : 'Cancel sync'}
        </button>
      ) : (
        <button
          type="button"
          onClick={onSync}
          disabled={Boolean(blockedReason)}
          className="h-11 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer active:translate-y-px"
        >
          {synced ? <RefreshCw className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
          {synced ? 'Sync again' : 'Dub & sync'}
        </button>
      )}
      {blockedReason && !isSyncing ? (
        <p className="text-center text-[11.5px] text-amber-300">{blockedReason}</p>
      ) : error && !isSyncing ? (
        <p role="alert" className="text-center text-[11.5px] text-rose-300">
          Dub failed: {error}
        </p>
      ) : (
        <p className="text-center text-[11.5px] text-slate-500">
          {isSyncing
            ? 'You can move to another step while this runs.'
            : synced && pendingCount > 0
              ? `Voices only the ${pendingCount === 1 ? 'changed line' : `${pendingCount} changed lines`} again.`
              : synced
                ? 'Places every line again with these settings; a new voice or voice setting voices them again.'
                : [
                    previewShown && (previewLongCount > 0 || previewShortCount > 0)
                      ? `${previewNote(previewLongCount, previewShortCount)} You can dub anyway.`
                      : options.voicing === 'continuous' && !multiSpeaker
                        ? 'Reads the script in one take, then cuts each line from it and places it on the original.'
                        : hasDub
                          ? 'Voices every line again and places it on the original.'
                          : 'Voices every line and places it on the original.',
                    costNote,
                  ]
                    .filter(Boolean)
                    .join(' ')}
        </p>
      )}
    </div>
  </aside>
);

export interface SyncResultsPanelProps {
  report: SyncReport | null;
  /** Lines changed by hand in Edit timing; the report and the dub include them. */
  handEdits?: number;
  progress: SyncProgress | null;
  isSyncing: boolean;
  isCancelling: boolean;
  /** Lines and length of the dub, for the not-yet-synced summary. */
  lineCount: number;
  duration: number;
  blockedReason?: string | null;
  /** Runs Sync with the current settings (the rail holds them). */
  onSync: () => void;
  /** Shown before the first sync, in place of the plain summary: the sync preview. */
  preview?: React.ReactNode;
  currentTime: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  /** The exact playback position, read every frame while playing, so the playhead moves smoothly. */
  getLiveTime?: () => number | null;
  onSeek: (time: number) => void;
  /** Plays source and dub together from `time`. */
  onListen: (time: number) => void;
  /** Keys of lines reworded or retaken since this report: the next Sync voices them again. */
  pendingLines?: string[];
  /** Puts a new wording of a line into the script. */
  onApplyLine?: (unit: SyncUnitReport, text: string) => void;
  /** Asks for a new take of a line. */
  onRetakeLine?: (unit: SyncUnitReport) => void;
  /**
   * Another wording of a line that is too long (shorter) or ends early (fuller),
   * different from `avoid`; null when the text model had nothing usable.
   */
  onSuggestLine?: (unit: SyncUnitReport, avoid: string[]) => Promise<LineSuggestion | null>;
  /** The original and the synced dub, drawn behind the lines of the alignment view. */
  sourceBuffer?: AudioBuffer | null;
  dubBuffer?: AudioBuffer | null;
  /** One continuous read: its progress while the script is voiced in one take, before the lines are placed. */
  reading?: DubProgress | null;
}

/** The Dub step's main panel: what the dub will take, its progress, then how every line landed. */
export const SyncResultsPanel: React.FC<SyncResultsPanelProps> = ({
  report,
  handEdits = 0,
  progress,
  isSyncing,
  isCancelling,
  lineCount,
  duration,
  blockedReason,
  onSync,
  preview,
  currentTime,
  isPlaying,
  onTogglePlay,
  getLiveTime,
  onSeek,
  onListen,
  pendingLines = [],
  onApplyLine,
  onRetakeLine,
  onSuggestLine,
  sourceBuffer,
  dubBuffer,
  reading = null,
}) => {
  const review = useMemo(() => {
    if (!report) return [];
    return report.units
      .map((unit) => ({ unit, reason: reviewReason(unit, report.tolerance) }))
      .filter((row): row is { unit: SyncUnitReport; reason: string } => Boolean(row.reason))
      .sort(
        (a, b) =>
          Number(b.unit.exceeded) - Number(a.unit.exceeded) ||
          Number(b.unit.short) - Number(a.unit.short) ||
          Number(a.unit.inSync) - Number(b.unit.inSync) ||
          b.unit.shortBy - a.unit.shortBy ||
          b.unit.exceededBy - a.unit.exceededBy ||
          Math.abs(b.unit.offset ?? 99) - Math.abs(a.unit.offset ?? 99)
      );
  }, [report]);
  /** Every line, in order, instead of only those worth a listen: any line can be retaken. */
  const [showAll, setShowAll] = useState(false);
  const rows = useMemo(
    () =>
      showAll && report
        ? report.units.map((unit) => ({ unit, reason: reviewReason(unit, report.tolerance) ?? 'In sync' }))
        : review,
    [showAll, report, review]
  );

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
  const fraction = syncFraction(progress);
  const idle = !report && !isSyncing;
  const precisionLabel = report ? SYNC_PRECISION_OPTIONS.find((o) => o.id === report.precision)?.label : undefined;

  return (
    <section aria-label="Sync" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-4 min-w-0">
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[15px] font-semibold text-slate-100">{report || isSyncing ? 'Synced dub' : 'Dub, in sync with the original'}</h2>
          {report && !isSyncing && <SyncVerdictBadge report={report} />}
          {isSyncing && (
            <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">
              {isCancelling ? 'Cancelling…' : 'In progress'}
            </span>
          )}
          {idle && (
            <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full border border-slate-700 text-slate-400">Not dubbed yet</span>
          )}
          {report && !isSyncing && handEdits > 0 && (
            <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-400/12 text-amber-300">
              {handEdits} hand edit{handEdits === 1 ? '' : 's'}
            </span>
          )}
          {report && !isSyncing && precisionLabel && <span className="text-xs text-slate-500">{precisionLabel}</span>}
        </div>
        <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
          <Lock className="w-3 h-3 shrink-0" />
          Each line is placed to start where the original line starts; a line longer than its original pushes the ones after it later. The audio is never stretched: no time-stretch, no volume change and no fades. Lines are only moved and the silence inside them shortened.
          {handEdits > 0 && ' Your hand edits in Edit timing are in this dub: there, only the speed, level and fades you set change a line, and Sync again keeps every locked line where you put it.'}
        </p>
      </div>

      {idle && preview}

      {idle && !preview && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-5 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-4">
          <div className="flex flex-wrap gap-x-8 gap-y-3 flex-1">
            {[
              { value: lineCount.toLocaleString(), label: 'cues to place' },
              { value: formatClock(duration), label: 'length' },
            ].map((f) => (
              <div key={f.label}>
                <span className="block text-[22px] font-semibold tabular-nums leading-tight text-slate-100">{f.value}</span>
                <span className="text-xs text-slate-400">{f.label}</span>
              </div>
            ))}
          </div>
          <p className="sm:max-w-[16rem] text-[12.5px] text-slate-400">
            {blockedReason || 'Pick the settings on the right, then press Sync.'}
          </p>
        </div>
      )}

      {isSyncing && reading && (
        <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-3" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-[12.5px] text-slate-100">
            <Loader2 className="w-3.5 h-3.5 text-cyan-300 animate-spin shrink-0" />
            {reading.phase === 'listening'
              ? 'Listening to the original to match its delivery…'
              : reading.phase === 'joining'
                ? 'Read in one take. Putting the passages together…'
                : 'Reading the script in one take…'}
            {reading.totalChars > 0 && (
              <span className="ml-auto font-mono text-[11px] text-slate-500 tabular-nums">
                {Math.round(Math.min(1, reading.charsDone / reading.totalChars) * 100)}%
              </span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-cyan-400/80 transition-[width] duration-500"
              style={{ width: `${Math.max(2, reading.totalChars > 0 ? Math.min(100, (reading.charsDone / reading.totalChars) * 100) : 2)}%` }}
            />
          </div>
          <p className="text-[11.5px] text-slate-500">Then each line is cut from the read and placed on the original.</p>
        </div>
      )}

      {isSyncing && (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-[width] duration-500"
              style={{ width: `${Math.max(2, fraction * 100)}%` }}
            />
          </div>
          <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
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
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
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
              {
                label: 'Lines that end early',
                value: String(report.summary.short ?? 0),
                tone: (report.summary.short ?? 0) > 0 ? 'text-sky-300' : 'text-slate-100',
              },
            ].map((m) => (
              <div key={m.label} className="rounded-xl bg-slate-950/60 border border-slate-800 px-3.5 py-2.5">
                <span className="block text-[11.5px] text-slate-400">{m.label}</span>
                <span className={`block text-xl font-semibold tabular-nums ${m.tone || 'text-slate-100'}`}>{m.value}</span>
              </div>
            ))}
          </div>

          <SyncAlignmentView
            report={report}
            reportedTime={currentTime}
            getLiveTime={getLiveTime}
            onSeek={onSeek}
            isPlaying={isPlaying}
            onTogglePlay={onTogglePlay}
            sourceBuffer={sourceBuffer}
            dubBuffer={dubBuffer}
          />

          {(report.summary.fromDub ?? 0) > 0 && (
            <p className="text-xs text-slate-400">
              {report.summary.fromDub === report.summary.lines
                ? `All ${report.summary.lines} lines were cut from the continuous read, so they keep its flow.`
                : `${report.summary.fromDub} of ${report.summary.lines} lines were cut from the continuous read, so they keep its flow. The other ${
                    report.summary.lines - (report.summary.fromDub ?? 0)
                  } were voiced on their own: their words changed after the read, or you asked for a retake.`}
            </p>
          )}
          {(report.summary.meaningRejected ?? 0) > 0 && (
            <p className="text-xs text-slate-400">
              {report.summary.meaningRejected === 1 ? '1 suggestion was' : `${report.summary.meaningRejected} suggestions were`} held back: every
              wording the text model offered changed the meaning of the original line. Edit {report.summary.meaningRejected === 1 ? 'that line' : 'those lines'}{' '}
              yourself, or press Suggest one to try again.
            </p>
          )}
          {report.summary.suggestionError && (
            <p className="text-xs text-amber-300">
              No new wording could be suggested for {Math.max(1, (report.summary.suggestionsAsked ?? report.summary.exceeded) - report.summary.suggested)} of
              the lines that run long or end early. The text model said: {report.summary.suggestionError}
            </p>
          )}

          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[13.5px] font-semibold text-slate-100">{showAll ? 'Every line' : 'Worth a listen'}</h3>
              <button
                type="button"
                onClick={() => setShowAll((on) => !on)}
                aria-pressed={showAll}
                className="text-xs text-indigo-300 hover:text-indigo-200 cursor-pointer"
                title={showAll ? 'Show only the lines worth a listen' : 'List every line, to listen to or retake any of them'}
              >
                {showAll ? 'Only lines worth a listen' : `Show all ${report.units.length} lines`}
              </button>
              <span className="flex-1" />
              <span className="text-xs text-slate-500">
                {review.length === 0
                  ? 'Every line landed within tolerance.'
                  : `${review.filter((r) => !r.unit.inSync).length} outside tolerance · ${report.summary.exceeded} too long for their slot${
                      report.summary.short ? ` · ${report.summary.short} end early` : ''
                    }${report.summary.tightJoins ? ` · ${report.summary.tightJoins} tight ${report.summary.tightJoins === 1 ? 'join' : 'joins'}` : ''}${
                      report.summary.cutOff ? ` · ${report.summary.cutOff} cut off` : ''
                    }`}
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
                  onClick={onSync}
                  disabled={Boolean(blockedReason)}
                  className="h-8 px-3.5 flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:bg-slate-800 disabled:text-slate-500 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Sync again
                </button>
              </div>
            )}
            {rows.length > 0 && (
              <ul className="mt-2 max-h-[36rem] overflow-y-auto custom-scrollbar divide-y divide-slate-800 border-y border-slate-800">
                {rows.map(({ unit, reason }) => (
                  <ReviewRow
                    key={unit.index}
                    unit={unit}
                    reason={reason}
                    pending={pendingLines.includes(unit.key)}
                    onListen={onListen}
                    onApply={onApplyLine}
                    onRetake={onRetakeLine}
                    onSuggest={onSuggestLine}
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
 * into the script, and a line that ends early a fuller one; any line can be
 * retaken. Neither is heard until the next
 * Sync, so the row shows it is waiting for one.
 */
const ReviewRow: React.FC<{
  unit: SyncUnitReport;
  reason: string;
  pending: boolean;
  onListen: (time: number) => void;
  onApply?: (unit: SyncUnitReport, text: string) => void;
  onRetake?: (unit: SyncUnitReport) => void;
  onSuggest?: (unit: SyncUnitReport, avoid: string[]) => Promise<LineSuggestion | null>;
}> = ({ unit, reason, pending, onListen, onApply, onRetake, onSuggest }) => {
  const [draft, setDraft] = useState(unit.suggestion || unit.text);
  const [suggested, setSuggested] = useState(Boolean(unit.suggestion));
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  // What the meaning check found in the shown suggestion, when it did not pass it.
  const [issues, setIssues] = useState<string[] | null>(null);
  // The shown suggestion translated back into English, without the original line in view.
  const [says, setSays] = useState<string | null>(null);
  // Wordings already offered for this line, so another try reads differently.
  const tried = useRef<string[]>([]);
  useEffect(() => {
    setDraft(unit.suggestion || unit.text);
    setSuggested(Boolean(unit.suggestion));
    setIssues(null);
    setSays(null);
    tried.current = unit.suggestion ? [unit.suggestion] : [];
  }, [unit.suggestion, unit.text]);
  const changed = draft.trim() !== '' && draft.trim() !== unit.text.trim();
  const fuller = unit.short && !unit.exceeded;
  // The line's own voiced rate, to estimate how long a new wording takes.
  const spoken = unit.srcEnd - unit.srcStart;
  const draftSeconds = unit.text.trim().length > 0 ? (draft.trim().length * unit.speech) / unit.text.trim().length : 0;
  const tryAnother = async () => {
    if (!onSuggest || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      const line = await onSuggest(unit, tried.current);
      if (line) {
        tried.current = [...tried.current, line.text].slice(-MAX_TRIED);
        setDraft(line.text);
        setSuggested(true);
        setIssues(line.issues ?? null);
        setSays(line.backTranslation ?? null);
      } else setAskError(`No usable ${fuller ? 'fuller' : 'shorter'} wording came back. Try again, or edit it yourself.`);
    } catch (err: any) {
      setAskError(err?.message || 'The text model did not answer.');
    } finally {
      setAsking(false);
    }
  };
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
        <p className={`text-[11.5px] mt-1 ${unit.exceeded ? 'text-amber-300' : unit.short ? 'text-sky-300' : 'text-slate-400'}`}>{reason}</p>

        {pending ? (
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11.5px] font-medium px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300">
            <RefreshCw className="w-3 h-3" /> Changed. Sync again to hear it.
          </p>
        ) : (
          (unit.exceeded || unit.short) &&
          onApply && (
            <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
              <label className="block text-[10.5px] uppercase tracking-wide font-semibold text-slate-500 mb-1" htmlFor={`sync-line-${unit.key}`}>
                {suggested
                  ? fuller
                    ? 'Suggested fuller line'
                    : 'Suggested shorter line'
                  : draft.trim() !== unit.text.trim()
                    ? 'Your wording'
                    : fuller
                      ? 'Make this line fuller'
                      : 'Shorten this line'}
              </label>
              {suggested && issues && <MeaningWarning issues={issues} />}
              {suggested && says && (
                <p className="mb-1 text-[11.5px] text-slate-500 leading-snug" title="This wording translated back into English, without the original line in view">
                  Says: {says}
                </p>
              )}
              <textarea
                id={`sync-line-${unit.key}`}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setSuggested(false);
                  setIssues(null);
                }}
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
                {onSuggest && unit.targetChars != null && (
                  <button
                    type="button"
                    onClick={tryAnother}
                    disabled={asking}
                    className="h-7 px-2 flex items-center gap-1 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-300 disabled:opacity-60 cursor-pointer"
                  >
                    {asking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    {asking ? 'Asking…' : suggested ? 'Try another' : 'Suggest one'}
                  </button>
                )}
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {draft.trim().length} / {unit.text.trim().length} characters
                </span>
                {fuller && draftSeconds > 0 && (
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-md tabular-nums ${
                      isShort(draftSeconds, spoken) ? 'bg-sky-500/15 text-sky-300' : 'bg-emerald-500/15 text-emerald-300'
                    }`}
                    title="Estimated from how fast this voice said the line"
                  >
                    about {draftSeconds.toFixed(1)} s of {spoken.toFixed(1)} s · {isShort(draftSeconds, spoken) ? 'still ends early' : 'fills'}
                  </span>
                )}
              </div>
              {askError && <p className="mt-1.5 text-[11.5px] text-rose-300">{askError}</p>}
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

