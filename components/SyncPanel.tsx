import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  AudioWaveform,
  Bookmark,
  Check,
  ChevronRight,
  Combine,
  Copy,
  Download,
  Flag,
  ListMusic,
  Loader2,
  Lock,
  Mic,
  MoveHorizontal,
  Layers,
  Pause,
  PencilLine,
  Play,
  RefreshCw,
  RotateCcw,
  Ruler,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  TrendingDown,
  TriangleAlert,
  X,
} from 'lucide-react';
import {
  LineSuggestion,
  SYNC_JOIN_PRESETS,
  SYNC_SCREEN_OPTIONS,
  syncJoinPreset,
  type SyncScreen,
  type SyncJoinPreset,
  SYNC_PRECISION_OPTIONS,
  SYNC_STEPS,
  SyncOptions,
  SyncJoinSettings,
  SyncPrecision,
  SyncProgress,
  SyncReport,
  SyncUnitReport,
  SyncVoicing,
} from '../services/syncService';
import type { DubProgress } from '../services/elevenLabsService';
import { apiGetAudio } from '../services/apiClient';
import type { presetSuggestion } from '../services/syncPresets';
import { isShort, MAX_TRIED, MeaningWarning } from './SyncPreviewPanel';
import { timeLine } from '../services/speechTiming';
import {
  FitCard,
  JOIN_SECTION_INFO,
  JOIN_SECTIONS,
  joinPresetOf,
  joinPresetLabel,
  JoinPresetPicker,
  presetName,
  describeChange,
  joinSectionChangedCount,
  joinSectionMeasured,
  joinSectionSummary,
  readJoinSettings,
  resetJoinSection,
  SettingsCard,
  SettingToggle,
  SyncFitSource,
  SyncJoinSection,
  SyncJoinSectionControls,
} from './SyncJoinSettings';
import { SyncSettingsDiagram } from './SyncSettingsDiagram';
import { SyncPresetLibrary } from './SyncPresetLibrary';
import { reportError } from '../services/errorPopup';

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
  verifyWords: false,
  timingProtection: 'warn',
  voicing: 'lines',
  precision: 'phrase',
  preset: 'natural',
  screen: 'any',
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
    (options.screen ?? 'any') === 'any' &&
    options.suggest === defaults.suggest &&
    options.suggestLonger === defaults.suggestLonger &&
    !options.verifyWords && options.timingProtection !== 'strict' &&
    joinPresetOf(options.join, options.screen) === 'natural'
  );
};

export const readOptions = (value?: unknown): SyncOptions => {
  try {
    const saved = (value ?? JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}')) as Partial<SyncOptions>;
    // A saved preset is read as the preset is now, so a retuned preset reaches everyone who picked it.
    // Tight became Long dub, and Close-up Natural with faces on screen.
    const savedPreset = String(saved.preset ?? '');
    const renamed = savedPreset === 'tight' ? 'long' : savedPreset === 'lipsync' ? 'natural' : savedPreset;
    const screen: SyncScreen = savedPreset === 'lipsync' ? 'camera' : SYNC_SCREEN_OPTIONS.some((s) => s.id === saved.screen) ? (saved.screen as SyncScreen) : 'any';
    const preset = (Object.keys(SYNC_JOIN_PRESETS) as (keyof typeof SYNC_JOIN_PRESETS)[]).find((id) => id === renamed);
    const join = preset ? syncJoinPreset(preset, screen) : readJoinSettings(saved.join);
    return {
      verifyWords: saved.verifyWords === true,
      timingProtection: saved.timingProtection === 'strict' || savedPreset === 'lipsync' ? 'strict' : 'warn',
      voicing: saved.voicing === 'continuous' ? 'continuous' : 'lines',
      precision: SYNC_PRECISION_OPTIONS.some((o) => o.id === saved.precision) ? saved.precision : 'phrase',
      // A saved Custom stays Custom even when it happens to match a preset.
      preset: preset ?? (saved.preset === 'custom' ? 'custom' : joinPresetOf(join, screen)),
      screen,
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
export const useSyncOptions = (projectId?: string, saved?: SyncOptions, onSave?: (projectId: string, options: SyncOptions) => void) => {
  const [slot, setSlot] = useState(() => ({ id: projectId, options: readOptions(saved) }));
  const options = useMemo(() => slot.id === projectId ? slot.options : readOptions(saved), [slot, projectId, saved]);
  const current = useRef(options);
  current.current = options;
  const save = useRef(onSave);
  save.current = onSave;
  // Saved to the project a moment after the last change, so dragging a slider writes the project once, not on every step.
  const pending = useRef<{ id: string; options: SyncOptions; timer: ReturnType<typeof setTimeout> } | null>(null);
  const flush = useCallback(() => {
    const due = pending.current;
    if (!due) return;
    clearTimeout(due.timer);
    pending.current = null;
    save.current?.(due.id, due.options);
  }, []);
  // Leaving a project, or the page, saves what is still waiting to its own project.
  useEffect(() => flush, [projectId, flush]);
  useEffect(() => {
    if (slot.id !== projectId) setSlot({ id: projectId, options });
  }, [slot.id, projectId, options]);
  useEffect(() => {
    if (projectId && !saved && !pending.current) save.current?.(projectId, options);
  }, [projectId, saved, options]);
  const setOptions: React.Dispatch<React.SetStateAction<SyncOptions>> = useCallback((update) => {
    const next = typeof update === 'function' ? update(current.current) : update;
    current.current = next;
    setSlot({ id: projectId, options: next });
    try {
      localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
    } catch {}
    if (!projectId) return;
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { id: projectId, options: next, timer: setTimeout(flush, 500) };
  }, [projectId, flush]);
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
  const conflicts = report.summary.timingConflicts ?? 0;
  if (inSync === lines && !(conflicts || report.summary.boundaryMismatches || report.summary.wordTimingUnavailable || report.summary.endMismatches)) {
    return (
      <span className="flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
        <Check className="w-3 h-3" /> Synced · all {lines} lines in sync
      </span>
    );
  }
  const off = [
    ...(conflicts ? [`${conflicts} line${conflicts === 1 ? '' : 's'} need timing review`] : []),
    ...(report.summary.boundaryMismatches ? [`${report.summary.boundaryMismatches} cue boundaries need review`] : []),
    ...(report.summary.endMismatches ? [`${report.summary.endMismatches} line endings need review`] : []),
    ...(report.summary.wordTimingUnavailable ? [`${report.summary.wordTimingUnavailable} word checks unavailable`] : []),
    exceeded > 0 ? `${exceeded} line${exceeded === 1 ? '' : 's'} too long` : `${inSync} of ${lines} in sync`,
    `worst line off by ${maxError.toFixed(1)} s`,
  ];
  return (
    <span className="flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-400/12 text-amber-300">
      <TriangleAlert className="w-3 h-3" /> Synced · {off.join(' · ')}
    </span>
  );
};

/**
 * The sync's result across the top of the Dub step, in one slim bar: whether
 * the dub needs a fix and why, its numbers, and, when another length preset
 * suits the dub better, Sync again with it or Keep the one used.
 */
export const SyncStatusBar: React.FC<{
  report: SyncReport;
  /** Lines changed by hand in Edit timing. */
  handEdits?: number;
  /** The line joins the dub was synced with ("Natural"). */
  presetNow: string;
  presetSuggestion?: PresetSuggestion | null;
  onUsePreset?: (preset: Exclude<SyncJoinPreset, 'custom'>) => void;
}> = ({ report, handEdits = 0, presetNow, presetSuggestion, onUsePreset }) => {
  const { inSync, lines, exceeded, maxError, p90Error } = report.summary;
  const short = report.summary.short ?? 0;
  const conflicts = report.summary.timingConflicts ?? 0;
  const reviews = [
    ...(conflicts ? [`${conflicts} line${conflicts === 1 ? '' : 's'} need timing review`] : []),
    ...(report.summary.boundaryMismatches ? [`${report.summary.boundaryMismatches} cue boundaries need review`] : []),
    ...(report.summary.endMismatches ? [`${report.summary.endMismatches} line endings need review`] : []),
    ...(report.summary.wordTimingUnavailable ? [`${report.summary.wordTimingUnavailable} word checks unavailable`] : []),
  ];
  const allInSync = inSync === lines && reviews.length === 0;
  const [kept, setKept] = useState(false);
  useEffect(() => setKept(false), [presetSuggestion?.preset, presetSuggestion?.change]);
  const lengthOff = presetSuggestion && Math.abs(presetSuggestion.change) >= 0.03 ? presetSuggestion : null;
  const suits = Boolean(presetSuggestion) && presetNow.split(' · ')[0] === presetName(presetSuggestion!.preset);
  const offerPreset = lengthOff && !suits && !kept ? lengthOff : null;
  // How late the dub drifts: the latest start of any line.
  const maxLate = Math.max(0, ...report.units.map((u) => u.offset ?? 0));

  const headline = lengthOff
    ? `The dub runs ${describeChange(lengthOff.change)} than the original`
    : allInSync
      ? `All ${lines} lines are in sync`
      : exceeded > 0
        ? `${exceeded} line${exceeded === 1 ? ' is' : 's are'} too long for their slot`
        : `${lines - inSync} of ${lines} lines are off their timing`;
  const detail = [
    exceeded > 0 && maxLate > report.tolerance
      ? `Long lines push the ones after them, so the dub drifts up to ${maxLate.toFixed(2)} s late. Shorten the long lines below, then sync again.`
      : allInSync
        ? 'Every line starts where the original line does.'
        : '',
    offerPreset ? `${presetName(offerPreset.preset)} suits it better than ${presetNow}.` : suits && lengthOff ? `${presetNow} suits this dub.` : kept ? `Kept ${presetNow}.` : '',
    reviews.join(' · '),
  ]
    .filter(Boolean)
    .join(' ');
  const precision = SYNC_PRECISION_OPTIONS.find((o) => o.id === report.precision)?.label;
  const stats: { label: string; value: React.ReactNode; tone?: string }[] = [
    {
      label: 'In sync',
      value: (
        <>
          {inSync}
          <span className="text-[13px] text-slate-500"> / {lines}</span>
        </>
      ),
      tone: allInSync ? 'text-emerald-300' : undefined,
    },
    { label: '90% start within', value: `${p90Error.toFixed(2)} s` },
    { label: 'Worst line', value: `${maxError.toFixed(2)} s`, tone: maxError > report.tolerance ? 'text-amber-300' : undefined },
    { label: 'Too long', value: exceeded, tone: exceeded > 0 ? 'text-amber-300' : undefined },
    ...(short > 0 ? [{ label: 'End early', value: short, tone: 'text-sky-300' }] : []),
    ...(handEdits > 0 ? [{ label: 'Hand edits', value: handEdits }] : []),
    // New takes of lines too long: shown once a sync has tried any.
    ...(['faster', 'take'] as const).flatMap((kind) => {
      const fits = report.units.filter((unit) => unit.takeFit?.kind === kind);
      if (fits.length === 0) return [];
      const toChoose = fits.filter((unit) => !unit.takeFit?.used).length;
      return [
        {
          label: `${kind === 'faster' ? 'Read faster' : 'Best of 3 takes'}${toChoose > 0 ? ` · ${toChoose} to choose` : ''}`,
          value: fits.length,
          tone: toChoose > 0 ? 'text-amber-300' : 'text-indigo-200',
        },
      ];
    }),
    ...(precision ? [{ label: 'Precision', value: precision.replace(' (', ' ').replace(')', '') }] : []),
  ];

  return (
    <section
      aria-label="Sync result"
      className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-4 sm:px-5 py-3"
    >
      <span
        className={`shrink-0 flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] font-semibold ${
          allInSync ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-400/12 text-amber-300'
        }`}
      >
        {allInSync ? <Check className="w-3.5 h-3.5" /> : <span className="w-2 h-2 rounded-full bg-amber-400" />}
        {allInSync ? 'In sync' : 'Needs a fix'}
      </span>
      <div
        className="min-w-[16rem] flex-1 basis-[18rem]"
        title={`${
          report.summary.chunkSync
            ? `Each line is split where it goes quiet into ${report.summary.chunks ?? 0} chunks in all, and every chunk is placed on the original's words.`
            : "Each line is placed near its original timing; a long line can move the lines around it."
        } Sync does not stretch the voice. A line that cannot meet its timing is flagged below, never left out.${
          handEdits > 0 ? ' Your hand edits in Edit timing are in this dub, and Sync again keeps every locked line where you put it.' : ''
        }`}
      >
        <h2 className={`text-[15px] font-semibold leading-snug ${allInSync ? 'text-slate-100' : 'text-amber-50'}`}>{headline}</h2>
        {detail && <p className="text-[11.5px] text-slate-400 leading-snug">{detail}</p>}
      </div>
      <dl className="flex flex-wrap gap-y-2">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col px-3.5 border-l border-slate-800">
            <dt className="text-[11px] text-slate-400 whitespace-nowrap">{s.label}</dt>
            <dd className={`text-[17px] font-semibold tabular-nums leading-tight ${s.tone || 'text-slate-100'}`}>{s.value}</dd>
          </div>
        ))}
      </dl>
      {offerPreset && (
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setKept(true)}
            className="h-9 px-3 rounded-lg text-[12.5px] text-slate-300 hover:text-white hover:bg-slate-800 cursor-default"
          >
            Keep {presetNow}
          </button>
          {onUsePreset && (
            <button
              type="button"
              onClick={() => onUsePreset(offerPreset.preset)}
              className="h-9 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 text-[13px] font-semibold flex items-center gap-1.5 cursor-default active:translate-y-px"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Sync again with {presetName(offerPreset.preset)}
            </button>
          )}
        </div>
      )}
    </section>
  );
};

/** Why a line is worth a listen, or null when it landed cleanly. */
const reviewReason = (unit: SyncUnitReport, tolerance: number): string | null => {
  if (unit.silent) return 'The voice returned no audio for this line';
  if (unit.timingConflict) return unit.timingConflict;
  if (unit.cutOff)
    return `The voice stops before the last word is finished${unit.retakes ? `, in all ${unit.retakes + 1} takes` : ''}: retake it or reword the line`;
  if (unit.exceeded && unit.deepCut)
    return `Runs ${unit.exceededBy.toFixed(2)} s longer than the original line had. Fewer words would cut over a third of it and lose what it says: give it more time in Edit timing, or join it with the line beside it`;
  if (unit.exceeded && unit.cutCheckError)
    return `Runs ${unit.exceededBy.toFixed(2)} s longer than the original line had. Its silences were not tightened, as its words could not be timed: ${unit.cutCheckError}`;
  if (unit.exceeded && unit.speedFitUnsupported)
    return `Runs ${unit.exceededBy.toFixed(2)} s longer than the original line had. Its voice's model takes neither a speed nor a pace direction, so it couldn't be read faster: shorten it, or voice the dub with Multilingual v2`;
  if (unit.exceeded && unit.speedFit)
    return `Runs ${unit.exceededBy.toFixed(2)} s longer than the original line had, even read ${unit.speedFit.toFixed(2)}× faster: shorten it`;
  if (unit.exceeded) return `Runs ${unit.exceededBy.toFixed(2)} s longer than the original line had`;
  if (unit.short)
    return `Ends ${unit.shortBy.toFixed(1)} s before the original speaker stops: ${unit.speech.toFixed(1)} s said, ${(unit.srcEnd - unit.srcStart).toFixed(1)} s spoken`;
  if (unit.overrun !== null && unit.overrun > tolerance) return `Runs ${unit.overrun.toFixed(2)} s into the next line`;
  if (unit.tightJoin && unit.joinAfter !== null)
    return `Only ${Math.max(0, Math.round(unit.joinAfter * 1000))} ms before the next line starts: it may sound cut off`;
  if (unit.late && unit.offset !== null) return `Starts ${unit.offset.toFixed(2)} s late: the line before it runs long`;
  if (unit.offset !== null && Math.abs(unit.offset) > tolerance) return unit.offset > 0 ? 'Starts late: the line before it runs long' : 'Starts early to make room';
  if (unit.takeFit?.used) return `A new take was put in to fit (${unit.takeFit.saved.toFixed(2)} s shorter): listen to it, or use the first take`;
  if (unit.wordTiming?.status === 'unavailable') return `Word timing not verified: ${unit.wordTiming.reason || 'check again after Sync'}`;
  if (unit.wordTiming?.boundaryMismatch) return `An internal cue boundary is off by ${(unit.wordTiming.boundaryMaxError ?? 0).toFixed(2)} s: review this phrase's pacing`;
  if (unit.wordTiming?.endMismatch) return `The measured last word ends ${Math.abs(unit.wordTiming.endError ?? 0).toFixed(2)} s ${(unit.wordTiming.endError ?? 0) < 0 ? 'before' : 'after'} the source line: review its wording or take`;
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
  'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-left text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-default';

type PresetSuggestion = NonNullable<ReturnType<typeof presetSuggestion>>;

export interface SyncSettingsPanelProps {
  options: SyncOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<SyncOptions>>;
  /** The length preset the last sync suits, shown on the Line joins picker. */
  presetSuggestion?: PresetSuggestion | null;
  /** True once this dub has been synced: the button reads Sync again. */
  synced: boolean;
  /** True when there is a dub for the sync to replace. */
  hasDub: boolean;
  isSyncing: boolean;
  /** Set while this dub waits for another project's to finish: that project's name. `isSyncing` is true meanwhile. */
  waitingFor?: string | null;
  isCancelling: boolean;
  /** A dub was running when Dhvani closed: the button resumes it. */
  interrupted?: boolean;
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
  /** Saves the synced dub as MP3; absent before the first sync. */
  onDownloadMp3?: () => Promise<void>;
  /** Opens the voice changer on the synced dub; absent before the first sync. */
  onOpenVoiceChanger?: () => void;
  /** The subtitles section: downloads and settings, built by the step. */
  subtitles?: React.ReactNode;
  /** Several speakers: a continuous read needs one voice, so each line is voiced on its own. */
  multiSpeaker?: boolean;
  /** What Fit to this video measures from; the card is left out without it. */
  fitSource?: SyncFitSource;
  /** Raised by Sync settings in the header's Tools and settings menu: each new value opens the window. */
  openRequest?: number;
  /** Lines the sync voices, from the last sync or the preview: what Verify actual word timing sends, one request each. */
  lineCount?: number;
}

/** The sections of the Sync settings window, in the order its list shows them. */
type SettingsSection = 'basics' | SyncJoinSection | 'suggestions' | 'checks' | 'presets';

const voicingLabel = (options: SyncOptions, multiSpeaker: boolean) =>
  VOICING_OPTIONS.find((o) => o.id === (multiSpeaker ? 'lines' : options.voicing))?.label ?? 'Line by line';
const precisionLabelOf = (options: SyncOptions) => SYNC_PRECISION_OPTIONS.find((o) => o.id === options.precision)?.label ?? options.precision;
const presetLabelOf = joinPresetLabel;

/** Every section of the window, with its one-line summary, what it is for, and how many of its settings differ from the default. */
const settingsSections = (options: SyncOptions, multiSpeaker: boolean) => {
  const suggestions = [options.suggest && 'shorter', options.suggestLonger && 'fuller'].filter(Boolean);
  const basicsChanged = [(!multiSpeaker && options.voicing !== 'lines'), options.precision !== 'phrase', options.preset !== 'natural'].filter(Boolean).length;
  return [
    {
      id: 'basics' as SettingsSection,
      group: 'Setup',
      icon: Settings2,
      title: 'Basics',
      summary: `${voicingLabel(options, multiSpeaker)} · ${precisionLabelOf(options)} · ${presetLabelOf(options)}`,
      description: 'How the dub is voiced, how close the timing has to be, and the line joins to start from.',
      terms: 'voice voicing line by line continuous read narration precision phrase close-up loose line joins preset natural tight fit measure original',
      changedCount: basicsChanged,
    },
    {
      id: 'presets' as SettingsSection,
      group: 'Setup',
      icon: Bookmark,
      title: 'My sync presets',
      summary: 'Save, apply, import and export',
      description: 'Save the settings you like, apply them to another dub, or share them as a file.',
      terms: 'preset save apply import export file',
      changedCount: 0,
    },
    ...JOIN_SECTIONS.map((s) => ({
      id: s.id as SettingsSection,
      group: s.id === 'fit' || s.id === 'review' ? 'Fit and review' : 'Placement',
      icon: JOIN_SECTION_ICONS[s.id],
      title: s.title,
      summary: joinSectionSummary(s.id, options),
      description: JOIN_SECTION_INFO[s.id].description,
      terms: JOIN_SECTION_INFO[s.id].terms,
      changedCount: joinSectionChangedCount(s.id, options),
    })),
    {
      id: 'suggestions' as SettingsSection,
      group: 'Fit and review',
      icon: PencilLine,
      title: 'Suggestions',
      summary: suggestions.length ? `Suggests ${suggestions.join(' and ')} lines` : 'Off',
      description: 'Other wordings offered in Review for lines that run long or end early. Your script is never changed.',
      terms: 'suggest shorter fuller wording reword',
      changedCount: [options.suggest, options.suggestLonger].filter(Boolean).length,
    },
    {
      id: 'checks' as SettingsSection,
      group: 'Fit and review',
      icon: ShieldCheck,
      title: 'Extra checks',
      summary: options.verifyWords ? 'Verifies actual word timing' : 'Off',
      description: 'Checks only: the dub comes out the same with them on or off.',
      terms: 'verify word timing alignment elevenlabs check',
      changedCount: options.verifyWords ? 1 : 0,
    },
  ]
    // The order the list shows them in: setup, how lines are placed, then what happens when they don't fit.
    .sort((a, b) => SECTION_ORDER.indexOf(a.id) - SECTION_ORDER.indexOf(b.id));
};

const SECTION_ORDER: SettingsSection[] = ['basics', 'presets', 'chunks', 'gaps', 'pauses', 'long', 'edges', 'grouping', 'fit', 'review', 'suggestions', 'checks'];

const JOIN_SECTION_ICONS: Record<SyncJoinSection, typeof Settings2> = {
  chunks: AudioWaveform,
  long: Layers,
  gaps: MoveHorizontal,
  pauses: Pause,
  edges: TrendingDown,
  fit: Timer,
  grouping: Combine,
  review: Flag,
};

/** "Phrase (±150 ms)" as a name and its detail, for the two-line buttons. */
const splitLabel = (label: string) => {
  const match = /^(.*?)\s*\((.*)\)$/.exec(label);
  return match ? { name: match[1], detail: match[2] } : { name: label, detail: '' };
};

/**
 * Every sync setting, in a window of its own opened from the Dub step's rail.
 * It fills the screen: a grouped list of sections on the left, every one in
 * view, the chosen one on the right, and what the sync will use in a row of
 * chips along the top. Changes apply as they are made, so the preview follows them.
 */
const SyncSettingsWindow: React.FC<{
  options: SyncOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<SyncOptions>>;
  multiSpeaker: boolean;
  isSyncing: boolean;
  synced: boolean;
  blockedReason?: string | null;
  previewShown: boolean;
  lineCount?: number;
  fitSource?: SyncFitSource;
  /** The values Fit to this video set, kept by the rail so they outlast the window. */
  fitted: Partial<SyncJoinSettings>;
  onFitted: (changes: Partial<SyncJoinSettings>) => void;
  /** Absent when the window is opened away from the Dub step: there is nothing to sync from there. */
  onSync?: () => void;
  onClose: () => void;
  presetSuggestion?: PresetSuggestion | null;
}> = ({ options, onOptionsChange, multiSpeaker, isSyncing, synced, blockedReason, previewShown, lineCount, fitSource, fitted, onFitted, onSync, onClose, presetSuggestion }) => {
  const [section, setSection] = useState<SettingsSection>('basics');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const sections = settingsSections(options, multiSpeaker);
  const changedSections = sections.filter((s) => s.changedCount > 0).length;
  const needle = query.trim().toLowerCase();
  const listed = sections.filter(
    (s) =>
      (!onlyChanged || s.changedCount > 0 || s.id === section) &&
      (!needle || `${s.title} ${s.summary} ${s.description} ${s.terms}`.toLowerCase().includes(needle))
  );
  // A search that leaves the open section out opens the first section it finds.
  const current = (needle && !listed.some((s) => s.id === section) ? listed[0] : undefined) ?? sections.find((s) => s.id === section) ?? sections[0];
  const measured = (id: SettingsSection) => id !== 'basics' && id !== 'suggestions' && id !== 'checks' && id !== 'presets' && joinSectionMeasured(id, fitted, options.join);
  const fittedNow = JOIN_SECTIONS.some((s) => joinSectionMeasured(s.id, fitted, options.join));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (document.activeElement === searchRef.current && searchRef.current?.value) setQuery('');
        else onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const applyFit = (changes: Partial<SyncJoinSettings>) => {
    onFitted(changes);
    onOptionsChange((o) => {
      const next = { ...o.join, ...changes };
      return { ...o, join: next, preset: joinPresetOf(next, o.screen) };
    });
  };

  const open = (id: SettingsSection) => {
    setQuery('');
    setSection(id);
  };

  const resetSection = () => {
    switch (current.id) {
      case 'basics':
        return onOptionsChange((o) => ({ ...o, voicing: 'lines', precision: 'phrase' }));
      case 'suggestions':
        return onOptionsChange((o) => ({ ...o, suggest: false, suggestLonger: false }));
      case 'checks':
        return onOptionsChange((o) => ({ ...o, verifyWords: false }));
      case 'presets':
        return;
      default:
        return onOptionsChange((o) => resetJoinSection(current.id as SyncJoinSection, o));
    }
  };
  // Basics puts back the voicing and precision; the line joins are reset in their own sections or by Natural.
  const resettable =
    current.id === 'basics'
      ? [(!multiSpeaker && options.voicing !== 'lines'), options.precision !== 'phrase'].filter(Boolean).length
      : current.changedCount;

  const chips: { label: string; value: string; to: SettingsSection; changed: boolean }[] = [
    { label: 'Voice', value: voicingLabel(options, multiSpeaker), to: 'basics', changed: !multiSpeaker && options.voicing !== 'lines' },
    { label: 'Precision', value: precisionLabelOf(options), to: 'basics', changed: options.precision !== 'phrase' },
    { label: 'Line joins', value: presetLabelOf(options), to: 'basics', changed: options.preset !== 'natural' || (options.screen ?? 'any') !== 'any' },
    { label: 'Chunk sync', value: options.join.chunkSync ? 'On' : 'Off', to: 'chunks', changed: options.join.chunkSync !== SYNC_JOIN_PRESETS.natural.chunkSync },
    { label: 'Late lines', value: options.timingProtection === 'strict' ? 'Strict' : 'Flagged', to: 'fit', changed: options.timingProtection === 'strict' },
    {
      label: 'Suggestions',
      value: options.suggest || options.suggestLonger ? 'On' : 'Off',
      to: 'suggestions',
      changed: options.suggest || options.suggestLonger,
    },
    { label: 'Word check', value: options.verifyWords ? 'On' : 'Off', to: 'checks', changed: Boolean(options.verifyWords) },
  ];

  const body = (() => {
    switch (current.id) {
      case 'basics':
        return (
          <div className="flex flex-col gap-4">
            {fitSource && <FitCard source={fitSource} join={options.join} disabled={isSyncing} onApply={applyFit} suggestion={presetSuggestion} />}
            <fieldset className="flex flex-col gap-2" disabled={isSyncing}>
              <legend className={`${sectionLabel} mb-2`}>How to voice</legend>
              <div className="grid lg:grid-cols-2 gap-3">
                {VOICING_OPTIONS.map((o) => {
                  const off = o.id === 'continuous' && multiSpeaker;
                  const checked = multiSpeaker ? o.id === 'lines' : options.voicing === o.id;
                  const Icon = o.id === 'lines' ? ListMusic : AudioWaveform;
                  return (
                    <label
                      key={o.id}
                      className={`flex items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                        checked ? 'border-indigo-500/70 bg-indigo-500/10' : 'border-slate-800 bg-slate-800/20 hover:border-slate-700'
                      } ${off ? 'opacity-50 cursor-default' : 'cursor-default'}`}
                    >
                      <input
                        type="radio"
                        name="sync-voicing"
                        checked={checked}
                        disabled={off}
                        onChange={() => onOptionsChange((opts) => ({ ...opts, voicing: o.id }))}
                        className="sr-only"
                      />
                      <span
                        className={`w-9 h-9 shrink-0 rounded-[10px] flex items-center justify-center ${checked ? 'bg-indigo-500/20 text-indigo-300' : 'bg-slate-950 text-slate-400'}`}
                      >
                        <Icon className="w-[18px] h-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-[13.5px] font-medium text-slate-100">
                          {o.label}
                          {o.id === 'lines' && <span className="font-normal text-slate-500">default</span>}
                          {checked && <Check className="w-4 h-4 ml-auto text-indigo-300" />}
                        </span>
                        <span className="block text-[11.5px] text-slate-400 mt-0.5">
                          {off ? 'For a dub in one voice. With several speakers each line is voiced on its own.' : o.detail}
                        </span>
                        <span className="flex flex-wrap gap-1.5 mt-2">
                          {(o.id === 'lines' ? ['Any number of voices', 'Best timing'] : ['One voice only', 'Most natural flow']).map((tag) => (
                            <span key={tag} className="px-1.5 py-px rounded-md bg-slate-800 text-[10.5px] text-slate-400">
                              {tag}
                            </span>
                          ))}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <SettingsCard title="Precision">
              <div className="py-3 flex flex-col gap-2">
                <div role="radiogroup" aria-label="Precision" className="flex gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800">
                  {(['loose', 'phrase', 'lipsync'] as SyncPrecision[])
                    .map((id) => SYNC_PRECISION_OPTIONS.find((o) => o.id === id))
                    .filter((o): o is (typeof SYNC_PRECISION_OPTIONS)[number] => Boolean(o))
                    .map((o) => {
                      const { name, detail } = splitLabel(o.label);
                      const on = options.precision === o.id;
                      return (
                        <button
                          key={o.id}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          disabled={isSyncing}
                          onClick={() => onOptionsChange((opts) => ({ ...opts, precision: o.id }))}
                          className={`flex-1 rounded-lg px-2 py-2 text-center transition-colors cursor-default disabled:cursor-not-allowed ${
                            on ? 'bg-slate-800 text-slate-100 ring-1 ring-slate-600' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                          }`}
                        >
                          <span className="block text-[12.5px] font-medium">{name}</span>
                          <span className="block text-[11px] text-slate-500 tabular-nums">
                            {detail}
                            {o.id === 'phrase' ? ' · default' : ''}
                          </span>
                        </button>
                      );
                    })}
                </div>
                {previewShown && <span className="text-[11.5px] text-slate-400">The preview updates when you change this.</span>}
              </div>
            </SettingsCard>
            <SettingsCard title="Line joins">
              <div className="py-3">
                <JoinPresetPicker options={options} onOptionsChange={onOptionsChange} disabled={isSyncing} onShowChanged={() => setOnlyChanged(true)} suggestion={presetSuggestion} />
              </div>
            </SettingsCard>
            {/* The same settings as their own section, here too: what Sync does once pauses can't make a line fit. */}
            <div className="flex flex-col gap-1.5">
              <span className={sectionLabel}>When a line still runs long</span>
              <SyncJoinSectionControls section="long" options={options} onOptionsChange={onOptionsChange} disabled={isSyncing} />
            </div>
          </div>
        );
      case 'suggestions':
        return (
          <SettingsCard title="Suggest">
            <SettingToggle
              label="Suggest shorter lines"
              hint="For lines too long for the time the original line had. Your script is never changed."
              checked={options.suggest}
              disabled={isSyncing}
              onChange={(v) => onOptionsChange((o) => ({ ...o, suggest: v }))}
            />
            <SettingToggle
              label="Suggest fuller lines"
              hint="For lines that end well before the original speaker stops. Same meaning, said in full. Your script is never changed."
              checked={options.suggestLonger}
              disabled={isSyncing}
              onChange={(v) => onOptionsChange((o) => ({ ...o, suggestLonger: v }))}
            />
          </SettingsCard>
        );
      case 'checks':
        return (
          <SettingsCard title="Word timing">
            <SettingToggle
              label="Verify actual word timing"
              hint={
                <>
                  Only checks: the dub comes out the same with it on or off. Uses ElevenLabs alignment for each line, including Cartesia dubs. Adds
                  requests and processing time; requires an ElevenLabs key. Checks spoken timing and cue boundaries, not mouth movements.
                  {lineCount ? (
                    <span className={`block mt-1 ${options.verifyWords ? 'text-indigo-300' : 'text-slate-500'}`}>
                      About {lineCount} alignment request{lineCount === 1 ? '' : 's'} for this dub, one per line.
                    </span>
                  ) : null}
                </>
              }
              checked={Boolean(options.verifyWords)}
              disabled={isSyncing}
              onChange={(v) => onOptionsChange((o) => ({ ...o, verifyWords: v }))}
            />
          </SettingsCard>
        );
      case 'presets':
        return <SyncPresetLibrary options={options} onChange={onOptionsChange} normalize={readOptions} disabled={isSyncing} />;
      default:
        return (
          <div className="flex flex-col gap-3">
            {current.id !== 'long' && <SyncSettingsDiagram section={current.id as SyncJoinSection} options={options} />}
            <SyncJoinSectionControls section={current.id as SyncJoinSection} options={options} onOptionsChange={onOptionsChange} disabled={isSyncing} />
          </div>
        );
    }
  })();

  // On the page itself, not in the rail: the sticky rail would keep it under the timeline's markers.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-settings-title"
        className="w-full max-w-[90rem] h-full flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
      >
        <div className="flex items-center gap-3.5 px-4 sm:px-5 py-3 border-b border-slate-800 shrink-0">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0" aria-hidden="true">
            <SlidersHorizontal className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="sync-settings-title" className="text-lg font-semibold text-slate-100 leading-tight">
              Sync settings
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5 truncate">
              {isSyncing ? 'Locked while the dub syncs.' : 'How each line is placed. Changes apply as you make them, for the next sync.'}
            </p>
          </div>
          <label className="hidden sm:flex items-center gap-2 h-9 w-64 px-2.5 rounded-lg border border-slate-700 bg-slate-950 text-slate-500 focus-within:border-indigo-500">
            <Search className="w-4 h-4 shrink-0" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a setting"
              aria-label="Find a setting"
              className="flex-1 min-w-0 bg-transparent text-[13px] text-slate-200 placeholder:text-slate-500 focus:outline-none"
            />
            {!query && <span className="text-[10.5px] px-1 rounded border border-slate-700">Ctrl F</span>}
          </label>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-default"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="shrink-0 flex items-center gap-2 px-4 sm:px-5 py-2.5 border-b border-slate-800 bg-slate-950/40 overflow-x-auto [scrollbar-width:none]">
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => open(chip.to)}
              title={`Open ${sections.find((s) => s.id === chip.to)?.title}`}
              className={`shrink-0 flex items-center gap-1.5 h-7 px-2.5 rounded-lg border bg-slate-900 text-[12px] text-slate-400 hover:text-slate-200 hover:border-slate-600 transition-colors cursor-default ${
                chip.changed ? 'border-amber-400/35' : 'border-slate-700/80'
              }`}
            >
              {chip.label} <span className="text-slate-100 font-medium">{chip.value}</span>
              {chip.changed && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </button>
          ))}
          {fittedNow && (
            <span title="Set by Fit to this video" className="shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-lg bg-indigo-500/15 text-[12px] text-indigo-300">
              <Ruler className="w-3.5 h-3.5" /> Fitted
            </span>
          )}
          <span className="flex-1" />
          {fitSource && current.id !== 'basics' && (
            <button
              type="button"
              onClick={() => open('basics')}
              className="shrink-0 flex items-center gap-1.5 h-7 px-3 rounded-lg border border-indigo-500/45 bg-indigo-500/10 text-[12px] text-indigo-200 hover:bg-indigo-500/20 transition-colors cursor-default"
            >
              <Ruler className="w-3.5 h-3.5" /> Fit to this video
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)]">
          <nav
            aria-label="Sync settings sections"
            // Each row grows into the room the window has, up to a comfortable height, and shrinks back to its content when it is short.
            className="shrink-0 flex md:flex-col gap-0.5 p-2 md:px-2.5 md:py-2 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto [scrollbar-width:thin] border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950/40"
          >
            {onlyChanged && (
              <div className="hidden md:flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-amber-400/10 text-[11.5px] text-amber-200 shrink-0">
                Changed sections only
                <button type="button" onClick={() => setOnlyChanged(false)} className="text-amber-100 underline underline-offset-2 cursor-default">
                  Show all
                </button>
              </div>
            )}
            {listed.length === 0 && <p className="px-2 py-6 text-center text-[12px] text-slate-500">No setting matches “{query.trim()}”.</p>}
            {listed.map((s, n) => {
              const Icon = s.icon;
              const on = current.id === s.id;
              return (
                <React.Fragment key={s.id}>
                  {(n === 0 || listed[n - 1].group !== s.group) && (
                    <span className="hidden md:flex md:grow md:max-h-9 items-end px-2 pt-1.5 pb-0.5 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">{s.group}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => open(s.id)}
                    aria-current={on ? 'true' : undefined}
                    className={`shrink-0 md:w-full md:grow md:max-h-[3.5rem] flex items-center gap-2.5 text-left rounded-lg px-2 py-[3px] border transition-colors cursor-default ${
                      on ? 'bg-slate-800 border-slate-700 text-slate-100' : 'border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                    }`}
                  >
                    <span
                      className={`hidden md:flex w-6 h-6 shrink-0 rounded-md items-center justify-center ${on ? 'bg-indigo-500/15 text-indigo-300' : 'bg-slate-900 text-slate-500'}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium whitespace-nowrap md:truncate leading-tight">{s.title}</span>
                      <span className="hidden md:block text-[11px] text-slate-500 truncate leading-tight mt-0.5">{s.summary}</span>
                    </span>
                    {measured(s.id) && (
                      <span title="Set by Fit to this video" className="hidden lg:inline px-1.5 py-px rounded-md bg-indigo-500/15 text-indigo-300 text-[10px] font-medium">
                        measured
                      </span>
                    )}
                    {s.changedCount > 0 && (
                      <span title={`${s.changedCount} changed from the default`} className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    )}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-7 py-5">
            <div className="max-w-[64rem]">
              <div className="flex items-start gap-3 mb-4">
                <div className="min-w-0 flex-1">
                  <h3 className="text-[17px] font-semibold text-slate-100">{current.title}</h3>
                  <p className="text-[12.5px] text-slate-400 mt-0.5">{current.description}</p>
                  <p className="text-[11.5px] text-slate-500 mt-1">{current.summary}</p>
                </div>
                {resettable > 0 && (
                  <button
                    type="button"
                    onClick={resetSection}
                    disabled={isSyncing}
                    className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-700 text-[12px] text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-default"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> {current.id === 'basics' ? 'Reset voicing and precision' : `Reset this section (${resettable})`}
                  </button>
                )}
              </div>
              <div className={isSyncing ? 'opacity-60' : ''}>{body}</div>
            </div>
          </div>
        </div>

        <div className="shrink-0 flex flex-wrap items-center gap-2 px-4 sm:px-5 py-3 border-t border-slate-800 bg-slate-950/60">
          <button
            type="button"
            onClick={() => onOptionsChange(defaultSyncOptions())}
            disabled={isSyncing || isDefaultOptions(options)}
            title={isDefaultOptions(options) ? 'Already on the default settings' : 'Line by line, phrase precision, Natural line joins, no suggestions'}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-800 text-[12.5px] text-slate-300 hover:bg-slate-800 hover:text-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-default"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset all to defaults
          </button>
          <button
            type="button"
            onClick={() => setOnlyChanged(changedSections > 0 && !onlyChanged)}
            className={`hidden sm:flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[12px] transition-colors cursor-default ${
              changedSections ? 'bg-amber-400/10 text-amber-200 hover:bg-amber-400/15' : 'text-slate-500'
            }`}
          >
            {changedSections ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {changedSections} {changedSections === 1 ? 'section' : 'sections'} changed{onlyChanged ? ' · show all' : ''}
              </>
            ) : (
              'All on the defaults'
            )}
          </button>
          {blockedReason && !isSyncing && <span className="text-[11.5px] text-amber-300">{blockedReason}</span>}
          <span className="flex-1" />
          {previewShown && <span className="hidden lg:inline text-[11.5px] text-slate-500">The preview follows your changes.</span>}
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-lg border border-slate-700 text-[13px] text-slate-200 hover:bg-slate-800 transition-colors cursor-default"
          >
            Done
          </button>
          {!isSyncing && onSync && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onSync();
              }}
              disabled={Boolean(blockedReason)}
              className="h-9 flex items-center gap-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-default"
            >
              {synced ? <RefreshCw className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
              {synced ? 'Sync again' : 'Dub & sync'}
            </button>
          )}
        </div>
      </section>
    </div>,
    document.body
  );
};

/**
 * The Sync settings window on its own, for the header's Tools and settings
 * menu away from the Dub step: the same window and settings, for this
 * project or, before there is one, for the next. Fit to this video and the
 * Sync button stay in the Dub step, where there is a dub to measure and sync.
 */
export const SyncSettingsDialog: React.FC<{
  options: SyncOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<SyncOptions>>;
  multiSpeaker?: boolean;
  isSyncing?: boolean;
  onClose: () => void;
}> = ({ options, onOptionsChange, multiSpeaker = false, isSyncing = false, onClose }) => {
  const [fitted, setFitted] = useState<Partial<SyncJoinSettings>>({});
  return (
    <SyncSettingsWindow
      options={options}
      onOptionsChange={onOptionsChange}
      multiSpeaker={multiSpeaker}
      isSyncing={isSyncing}
      synced={false}
      previewShown={false}
      fitted={fitted}
      onFitted={setFitted}
      onClose={onClose}
    />
  );
};

/** The Dub step's rail: what the sync will use, in brief, with every setting a click away; the Dub & sync button; and the files. */
export const SyncSettingsPanel: React.FC<SyncSettingsPanelProps> = ({
  options,
  onOptionsChange,
  synced,
  hasDub,
  isSyncing,
  waitingFor = null,
  isCancelling,
  interrupted = false,
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
  onDownloadMp3,
  onOpenVoiceChanger,
  subtitles,
  multiSpeaker = false,
  fitSource,
  lineCount,
  openRequest = 0,
  presetSuggestion,
}) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingMp3, setSavingMp3] = useState(false);
  // Only a request made while the rail is on screen opens it, not one left from before the Dub step.
  const seenOpenRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest === seenOpenRequest.current) return;
    seenOpenRequest.current = openRequest;
    setSettingsOpen(true);
  }, [openRequest]);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  /** The values Fit to this video set; a section is marked measured while it still holds one. */
  const [fitted, setFitted] = useState<Partial<SyncJoinSettings>>({});
  const changed = settingsSections(options, multiSpeaker).filter((s) => s.changedCount > 0).length;
  const fittedNow = JOIN_SECTIONS.some((s) => joinSectionMeasured(s.id, fitted, options.join));
  const chips = [
    voicingLabel(options, multiSpeaker),
    precisionLabelOf(options),
    `Joins: ${presetLabelOf(options)}`,
    ...(options.timingProtection === 'strict' ? ['Strict timing'] : []),
    ...(options.suggest || options.suggestLonger ? ['Suggestions on'] : []),
    ...(options.verifyWords ? ['Verifies word timing'] : []),
  ];

  return (
  <aside aria-label="Sync settings" className="flex flex-col bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden lg:sticky lg:top-4">
    <div className="flex items-center justify-between px-4 sm:px-5 pt-4">
      <h2 className="text-[15px] font-semibold text-slate-100">Sync settings</h2>
      <button type="button" onClick={onBack} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 cursor-default">
        <ArrowLeft className="w-3 h-3" /> Review
      </button>
    </div>

    <div className="px-4 sm:px-5 py-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3.5">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span key={chip} className="px-2 py-0.5 rounded-md border border-slate-700/80 text-[11.5px] text-slate-300">
              {chip}
            </span>
          ))}
          {fittedNow && (
            <span title="Set by Fit to this video" className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/15 text-[11.5px] text-indigo-300">
              <Ruler className="w-3 h-3" /> Fitted
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-haspopup="dialog"
          className="h-9 flex items-center justify-center gap-2 rounded-lg border border-slate-700 text-[13px] font-medium text-slate-200 hover:bg-slate-800 hover:border-slate-600 transition-colors cursor-default"
        >
          <SlidersHorizontal className="w-4 h-4" /> Open sync settings
          <span className={`ml-1 px-1.5 py-px rounded-md text-[10.5px] font-medium ${changed ? 'bg-amber-400/15 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>
            {changed ? `${changed} changed` : 'Defaults'}
          </span>
        </button>
        {previewShown && <span className="text-[11.5px] text-slate-500 text-center">The preview follows any change you make.</span>}
      </div>
    </div>

    {settingsOpen && (
      <SyncSettingsWindow
        options={options}
        onOptionsChange={onOptionsChange}
        multiSpeaker={multiSpeaker}
        isSyncing={isSyncing}
        synced={synced}
        blockedReason={blockedReason}
        previewShown={previewShown}
        lineCount={lineCount}
        fitSource={fitSource}
        fitted={fitted}
        onFitted={setFitted}
        onSync={onSync}
        onClose={closeSettings}
        presetSuggestion={presetSuggestion}
      />
    )}

    {synced && (onDownloadWav || onDownloadMp3 || onOpenVoiceChanger) && (
      <div className="px-4 sm:px-5 pb-4 flex flex-col gap-2">
        <span className={sectionLabel}>Synced dub</span>
        {onDownloadWav && (
          <button type="button" onClick={onDownloadWav} disabled={isSyncing} className={downloadRow}>
            <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300">WAV</span>
            <span className="flex-1 text-[13px]">Synced dub</span>
            <Download className="w-4 h-4 text-slate-500" />
          </button>
        )}
        {onDownloadMp3 && (
          <button
            type="button"
            onClick={() => {
              setSavingMp3(true);
              onDownloadMp3().finally(() => setSavingMp3(false));
            }}
            disabled={isSyncing || savingMp3}
            className={downloadRow}
            title="An MP3 copy at 320 kbps, at the dub's own sample rate. The dub itself stays WAV."
          >
            <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-300">MP3</span>
            <span className="flex-1 text-[13px]">{savingMp3 ? 'Making the MP3…' : 'Synced dub'}</span>
            {savingMp3 ? (
              <Loader2 className="w-4 h-4 text-slate-500 animate-spin" />
            ) : (
              <Download className="w-4 h-4 text-slate-500" />
            )}
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
          className="h-11 flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-sm font-medium text-slate-200 disabled:opacity-50 cursor-default"
        >
          <X className="w-4 h-4" /> {waitingFor ? 'Take out of the line' : isCancelling ? 'Cancelling…' : 'Cancel sync'}
        </button>
      ) : (
        <button
          type="button"
          onClick={onSync}
          disabled={Boolean(blockedReason)}
          className="h-11 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-default active:translate-y-px"
        >
          {synced || interrupted ? <RefreshCw className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
          {interrupted ? 'Resume dub' : synced ? 'Sync again' : 'Dub & sync'}
        </button>
      )}
      {blockedReason && !isSyncing ? (
        <p className="text-center text-[11.5px] text-amber-300">{blockedReason}</p>
      ) : interrupted && !isSyncing ? (
        <p role="status" className="text-center text-[11.5px] text-amber-300">
          The last dub stopped before it finished.{' '}
          <span className="text-slate-400">The lines it voiced are kept: with the same voice and settings, resuming voices only the rest.</span>
        </p>
      ) : (
        <p className="text-center text-[11.5px] text-slate-500">
          {waitingFor
            ? `Waits for “${waitingFor}” to finish dubbing, then starts on its own with the voice set now.`
            : isSyncing
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
};

export interface SyncResultsPanelProps {
  report: SyncReport | null;
  /** The line joins the dub was synced with ("Natural"), and the preset its length suits better, with Use to sync with it. */
  presetNow?: string;
  presetSuggestion?: PresetSuggestion | null;
  onUsePreset?: (preset: Exclude<SyncJoinPreset, 'custom'>) => void;
  /** Uses the take Sync offered for a line that ran long, or keeps the take it has (see TakeOffer). */
  onUseTake?: (unit: SyncUnitReport) => void;
  onKeepTake?: (unit: SyncUnitReport) => void;
  /** Lines changed by hand in Edit timing; the report and the dub include them. */
  handEdits?: number;
  progress: SyncProgress | null;
  isSyncing: boolean;
  /** Set while this dub waits for another project's to finish: that project's name. */
  waitingFor?: string | null;
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
  /** Asks for a new take of every line in `units` at once. */
  onRetakeLines?: (units: SyncUnitReport[]) => void;
  /**
   * The takes panel of a line (TakesPanel), shown under its row: new takes
   * voiced at once and one picked. With it, a row's Retake opens the panel
   * instead of waiting for the next Sync.
   */
  renderTakes?: (unit: SyncUnitReport, close: () => void) => React.ReactNode;
  /** Keys of lines locked in Edit timing: Sync keeps their take, so they aren't retaken. */
  lockedKeys?: string[];
  /**
   * Other wordings of a line that is too long (shorter) or ends early (fuller),
   * different from `avoid`, each of a different kind; empty when the text model had nothing usable.
   */
  onSuggestLine?: (unit: SyncUnitReport, avoid: string[]) => Promise<LineSuggestion[]>;
  /** The original and the synced dub, drawn behind the lines of the alignment view. */
  sourceBuffer?: AudioBuffer | null;
  dubBuffer?: AudioBuffer | null;
  /** One continuous read: its progress while the script is voiced in one take, before the lines are placed. */
  reading?: DubProgress | null;
  /** Keys of lines changed by hand in Edit timing, for the Hand edits tab. */
  editedKeys?: string[];
  /**
   * A line picked in the player to work on here: the list shows it, scrolls to
   * it, and opens its takes or puts the cursor in its wording. `n` changes on
   * every pick, so picking the same line again does it again.
   */
  focusLine?: { key: string; mode: 'takes' | 'words'; n: number } | null;
}

/** Which lines the list shows: those worth a listen, one kind of them, or every line. */
type LineFilter = 'review' | 'long' | 'early' | 'edited' | 'all';

/** Takes voiced of a retaken line, the best fitting one kept (RETAKE_TAKES in server/lib/syncDub.js). */
const RETAKE_TAKES = 3;

/** The Dub step's main panel: what the dub will take, its progress, then how every line landed. */
export const SyncResultsPanel: React.FC<SyncResultsPanelProps> = ({
  report,
  presetNow,
  presetSuggestion,
  onUsePreset,
  onUseTake,
  onKeepTake,
  handEdits = 0,
  progress,
  isSyncing,
  waitingFor = null,
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
  onRetakeLines,
  renderTakes,
  lockedKeys = [],
  onSuggestLine,
  sourceBuffer,
  dubBuffer,
  reading = null,
  editedKeys = [],
  focusLine = null,
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
  /** Worth a listen by default; Every line lists them all in order, since any line can be retaken. */
  const [filter, setFilter] = useState<LineFilter>('review');
  const showAll = filter === 'all';
  const allRows = useMemo(
    () => (report ? report.units.map((unit) => ({ unit, reason: reviewReason(unit, report.tolerance) ?? 'In sync' })) : []),
    [report]
  );
  const rows = useMemo(() => {
    if (filter === 'all') return allRows;
    if (filter === 'long') return review.filter((row) => row.unit.exceeded);
    if (filter === 'early') return review.filter((row) => row.unit.short && !row.unit.exceeded);
    if (filter === 'edited') return allRows.filter((row) => editedKeys.includes(row.unit.key));
    return review;
  }, [filter, allRows, review, editedKeys]);
  const tabs: { id: LineFilter; label: string; count: number }[] = [
    { id: 'review', label: 'Worth a listen', count: review.length },
    { id: 'long', label: 'Too long', count: review.filter((row) => row.unit.exceeded).length },
    { id: 'early', label: 'End early', count: review.filter((row) => row.unit.short && !row.unit.exceeded).length },
    { id: 'edited', label: 'Hand edits', count: allRows.filter((row) => editedKeys.includes(row.unit.key)).length },
    { id: 'all', label: 'Every line', count: allRows.length },
  ];
  // A tab with nothing in it is left out, except the one open and the first and last.
  const shownTabs = tabs.filter((tab) => tab.count > 0 || tab.id === filter || tab.id === 'review' || tab.id === 'all');
  /** The listed lines a retake would voice again: not silent, not already waiting for Sync, not locked. */
  const retakeable = useMemo(
    () => rows.map((row) => row.unit).filter((unit) => !unit.silent && !pendingLines.includes(unit.key) && !lockedKeys.includes(unit.key)),
    [rows, pendingLines, lockedKeys]
  );
  /** The retake of every listed line waits for a yes: it costs RETAKE_TAKES voicings of each. */
  const [confirmRetake, setConfirmRetake] = useState(false);
  useEffect(() => setConfirmRetake(false), [filter, report]);
  const retakeChars = retakeable.reduce((sum, unit) => sum + unit.text.length, 0);
  /** The line whose takes are open under its row. */
  const [takesKey, setTakesKey] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // A line picked in the player: show it in the list, bring it into view, then open its takes or its wording.
  useEffect(() => {
    if (!focusLine || !report) return;
    const listed = rows.some((row) => row.unit.key === focusLine.key);
    if (!listed) setFilter(review.some((row) => row.unit.key === focusLine.key) ? 'review' : 'all');
    if (focusLine.mode === 'takes' && renderTakes) setTakesKey(focusLine.key);
    // After the list has rendered with the line in it.
    const timer = window.setTimeout(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-line-key="${CSS.escape(focusLine.key)}"]`);
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (focusLine.mode === 'words') row?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(timer);
    // Only a new pick moves the list, not the list changing under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLine?.n]);

  const step = progress?.step ?? 1;
  const stepDetail = (phase: string) => {
    if (!progress) return '';
    if (phase === 'placing' && progress.wordChecksTotal) return `word checks ${progress.wordChecksDone ?? 0} / ${progress.wordChecksTotal}`;
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
    <section aria-label="Sync" className="lg:flex-1 bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-4 min-w-0">
      {/* Once synced, the result is the status bar over the player and the lines are the panel; this heading is for before and during a sync. */}
      {!(report && !isSyncing) && (
      <div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[15px] font-semibold text-slate-100">{report || isSyncing ? 'Synced dub' : 'Dub, in sync with the original'}</h2>
          {report && !isSyncing && <SyncVerdictBadge report={report} />}
          {isSyncing && (
            <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">
              {waitingFor ? 'Waiting' : isCancelling ? 'Cancelling…' : 'In progress'}
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
          {report?.summary.chunkSync
            ? `Each line is split where it goes quiet into ${report.summary.chunks ?? 0} chunks in all, and every chunk is placed on the original's words; pauses shrink between words first, sentence ends last. Sync does not stretch the voice.`
            : 'Each line is placed near its original timing; a long line can move the lines around it. Sync does not stretch the voice.'} Breath reduction, loudness matching and fades follow the options you choose. A line that cannot meet Strict timing or a protected pause is flagged below, never left out.
          {handEdits > 0 && ' Your hand edits in Edit timing are in this dub: there, only the speed, level and fades you set change a line, and Sync again keeps every locked line where you put it.'}
        </p>
      </div>
      )}

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

      {waitingFor && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/40 px-3.5 py-3 text-[12.5px] text-slate-300" role="status" aria-live="polite">
          <Timer className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span>
            In line: “{waitingFor}” is dubbing. This dub starts on its own when that one finishes. You can keep working on any project meanwhile.
          </span>
        </div>
      )}

      {isSyncing && !waitingFor && (
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
          {report.summary.wordTimingMeasured !== undefined && (
            <p className="text-xs text-slate-400">Actual word timing: {report.summary.wordTimingMeasured} measured · {report.summary.wordTimingUnavailable ?? 0} unavailable · {report.summary.boundaryMismatches ?? 0} internal cue mismatches · {report.summary.endMismatches ?? 0} line endings to review. Single-cue lines have no internal boundary comparison. This does not verify visual lip-sync.</p>
          )}

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
              yourself, or press Suggest 3 to try again.
            </p>
          )}
          {report.summary.suggestionError && (
            <p className="text-xs text-amber-300">
              No new wording could be suggested for {Math.max(1, (report.summary.suggestionsAsked ?? report.summary.exceeded) - report.summary.suggested)} of
              the lines that run long or end early. The text model said: {report.summary.suggestionError}
            </p>
          )}

          <div className="flex flex-col lg:flex-1 lg:min-h-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-slate-100 mr-1">Lines</h3>
              <div role="tablist" aria-label="Which lines" className="flex flex-wrap gap-0.5 p-0.5 rounded-xl bg-slate-950 border border-slate-800">
                {shownTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={filter === tab.id}
                    onClick={() => setFilter(tab.id)}
                    title={tab.id === 'all' ? 'Every line, to listen to or retake any of them' : undefined}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium tabular-nums transition-colors cursor-default ${
                      filter === tab.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label} · {tab.count}
                  </button>
                ))}
              </div>
              {onRetakeLines && retakeable.length > 1 && (
                <button
                  type="button"
                  onClick={() => setConfirmRetake(true)}
                  aria-expanded={confirmRetake}
                  className="flex items-center gap-1 text-xs text-indigo-300 hover:text-indigo-200 cursor-default"
                  title={`Voices ${showAll ? 'every line' : 'every line listed here'} again, three takes each, and keeps the take of each that fits its slot best`}
                >
                  <Mic className="w-3 h-3" /> {showAll ? `Retake all ${retakeable.length}` : `Retake these ${retakeable.length}`}
                </button>
              )}
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
            {confirmRetake && onRetakeLines && retakeable.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-950/20 px-3.5 py-2.5" role="alertdialog" aria-label="Retake lines">
                <span className="flex-1 min-w-[16rem] text-[12.5px] text-slate-200">
                  Retake {retakeable.length} lines? Each is voiced {RETAKE_TAKES} times and the take that fits its slot best is kept: about{' '}
                  {(retakeChars * RETAKE_TAKES).toLocaleString()} characters of voicing ({RETAKE_TAKES} × {retakeChars.toLocaleString()}).
                  {lockedKeys.some((key) => rows.some((row) => row.unit.key === key)) && ' Lines locked in Edit timing keep their take.'}
                  {(report.summary.fromDub ?? 0) > 0 && ' Retaken lines are voiced on their own, not cut from the continuous read.'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onRetakeLines(retakeable);
                    setConfirmRetake(false);
                  }}
                  className="h-8 px-3.5 flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold cursor-default"
                >
                  <Mic className="w-3.5 h-3.5" /> Retake {retakeable.length} lines
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRetake(false)}
                  className="h-8 px-3 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-200 cursor-default"
                >
                  Cancel
                </button>
              </div>
            )}
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
                  className="h-8 px-3.5 flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:bg-slate-800 disabled:text-slate-500 cursor-default"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Sync again
                </button>
              </div>
            )}
            {rows.length > 0 && (
              // On wide screens the list takes the height the page row has (the rail sets it) and scrolls inside it.
              <div className="mt-2 relative lg:flex-1 lg:min-h-[28rem]">
              <ul
                ref={listRef}
                className="max-h-[36rem] lg:max-h-none lg:absolute lg:inset-0 overflow-y-auto custom-scrollbar divide-y divide-slate-800 border-y border-slate-800"
              >
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
                    takesOpen={takesKey === unit.key}
                    onToggleTakes={renderTakes && (() => setTakesKey((key) => (key === unit.key ? null : unit.key)))}
                    takes={renderTakes && takesKey === unit.key ? renderTakes(unit, () => setTakesKey(null)) : null}
                    onUseTake={onUseTake}
                    onKeepTake={onKeepTake}
                  />
                ))}
              </ul>
              </div>
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
/** What a new take of a line is: "Take 2 of 3", "Read 1.12× faster", "Read with a calm pace". */
const takeWhat = (fit: NonNullable<SyncUnitReport['takeFit']>) =>
  fit.kind === 'take' ? `Take ${fit.take ?? 2} of 3` : fit.speed ? `Read ${fit.speed.toFixed(2)}× faster` : 'Read with a calm, faster pace';

/**
 * A new take Sync made for a line that ran long: offered beside the one in
 * the dub (Ask) to listen to and choose, or put in already (Auto) with the
 * first take a click away; or why none was usable. The words are the same.
 */
const TakeOffer: React.FC<{
  unit: SyncUnitReport;
  pending: boolean;
  onListen: (time: number) => void;
  onUse?: (unit: SyncUnitReport) => void;
  onKeep?: (unit: SyncUnitReport) => void;
}> = ({ unit, pending, onListen, onUse, onKeep }) => {
  const fit = unit.takeFit;
  const [playing, setPlaying] = useState(false);
  const audio = useRef<{ url: string; element: HTMLAudioElement } | null>(null);
  useEffect(() => () => {
    audio.current?.element.pause();
    if (audio.current) URL.revokeObjectURL(audio.current.url);
  }, []);
  if (pending) return null;
  const audioId = fit ? fit.audioId : unit.takeRejectedAudioId;
  const playNew = async () => {
    try {
      if (!audio.current) {
        if (!audioId) throw new Error('The new take is no longer on the server. Sync again to hear it.');
        const blob = await apiGetAudio(`/sync/audio/${encodeURIComponent(audioId)}`);
        const url = URL.createObjectURL(blob);
        const element = new Audio(url);
        element.onended = () => setPlaying(false);
        audio.current = { url, element };
      }
      audio.current.element.currentTime = 0;
      await audio.current.element.play();
      setPlaying(true);
    } catch (err: any) {
      reportError(err, { title: 'The new take could not be played' });
    }
  };
  const button = 'h-7 px-2.5 rounded-lg border text-[12px] flex items-center gap-1.5 cursor-default';
  const toggleNew = () => (playing ? (audio.current?.element.pause(), setPlaying(false)) : void playNew());
  if (!fit) {
    if (!unit.takeRejected) return null;
    return (
      <div className="mt-2 rounded-lg border border-amber-400/30 bg-amber-950/20 px-3 py-2 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-amber-300">New take not used</span>
        <span className="text-[11.5px] text-slate-400">{unit.takeRejected} The first take stays.</span>
        <span className="flex-1" />
        {unit.takeRejectedAudioId && (
          <button type="button" onClick={toggleNew} className={`${button} border-slate-700 text-slate-300 hover:bg-slate-800`}>
            {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />} Listen to it anyway
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-lg border border-indigo-500/30 bg-indigo-500/[0.07] px-3 py-2 flex flex-wrap items-center gap-2">
      <span className="text-[12px] font-semibold text-indigo-200">
        {fit.used ? (fit.kind === 'take' ? 'Better-fitting take used' : 'Read faster to fit') : fit.kind === 'take' ? 'Better-fitting take ready' : 'Faster take ready'}
      </span>
      <span className="text-[11.5px] text-slate-400">
        {takeWhat(fit)} · −{fit.saved.toFixed(2)} s · same words, same voice
      </span>
      <span className="flex-1" />
      {fit.used ? (
        onKeep && (
          <button type="button" onClick={() => onKeep(unit)} className={`${button} border-slate-700 text-slate-300 hover:bg-slate-800`}>
            Use the first take
          </button>
        )
      ) : (
        <>
          <button type="button" onClick={() => onListen(Math.max(0, (unit.placedStart ?? unit.srcStart) - 0.3))} className={`${button} border-slate-700 text-slate-200 hover:bg-slate-800`}>
            <Play className="w-3 h-3" /> Old
          </button>
          <button
            type="button"
            onClick={toggleNew}
            className={`${button} border-indigo-500/50 text-indigo-200 hover:bg-indigo-500/15`}
          >
            {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />} New
          </button>
          {onUse && (
            <button type="button" onClick={() => onUse(unit)} className={`${button} border-transparent bg-indigo-500 hover:bg-indigo-400 text-white font-medium`}>
              Use new
            </button>
          )}
          {onKeep && (
            <button type="button" onClick={() => onKeep(unit)} className={`${button} border-slate-700 text-slate-300 hover:bg-slate-800`}>
              Keep old
            </button>
          )}
        </>
      )}
    </div>
  );
};

/**
 * A line's length against the original's, as two bars on one scale: the
 * original line (grey) over the dub line, amber when it runs long and sky when
 * it ends early, with how much.
 */
const LengthBars: React.FC<{ unit: SyncUnitReport }> = ({ unit }) => {
  if (unit.placedStart === null || unit.placedEnd === null) return null;
  const original = Math.max(0, unit.srcEnd - unit.srcStart);
  const dub = Math.max(0, unit.placedEnd - unit.placedStart);
  const scale = Math.max(original, dub) || 1;
  const tone = unit.exceeded ? 'bg-amber-400' : unit.short ? 'bg-sky-400' : 'bg-indigo-400/70';
  const label = unit.exceeded ? `+${unit.exceededBy.toFixed(1)} s` : unit.short ? `−${unit.shortBy.toFixed(1)} s` : null;
  return (
    <span
      className="shrink-0 hidden sm:flex items-center gap-2 mt-1"
      title={`Original line ${original.toFixed(1)} s · dub line ${dub.toFixed(1)} s`}
    >
      <span className="w-28 flex flex-col gap-[3px]" aria-hidden="true">
        <span className="h-[5px] rounded-full bg-slate-600" style={{ width: `${(original / scale) * 100}%` }} />
        <span className={`h-[5px] rounded-full ${tone}`} style={{ width: `${(dub / scale) * 100}%` }} />
      </span>
      <span className={`w-12 font-mono text-[11.5px] tabular-nums ${unit.exceeded ? 'text-amber-300' : 'text-sky-300'}`}>{label}</span>
    </span>
  );
};

const ReviewRow: React.FC<{
  unit: SyncUnitReport;
  reason: string;
  pending: boolean;
  onListen: (time: number) => void;
  onApply?: (unit: SyncUnitReport, text: string) => void;
  onRetake?: (unit: SyncUnitReport) => void;
  onSuggest?: (unit: SyncUnitReport, avoid: string[]) => Promise<LineSuggestion[]>;
  /** The takes panel: a toggle in the row, and the panel under it while open. */
  takesOpen?: boolean;
  onToggleTakes?: () => void;
  takes?: React.ReactNode;
  onUseTake?: (unit: SyncUnitReport) => void;
  onKeepTake?: (unit: SyncUnitReport) => void;
}> = ({ unit, reason, pending, onListen, onApply, onRetake, onSuggest, takesOpen = false, onToggleTakes, takes, onUseTake, onKeepTake }) => {
  const [draft, setDraft] = useState(unit.suggestion || unit.text);
  const [suggested, setSuggested] = useState(Boolean(unit.suggestion));
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  // What the meaning check found in the shown suggestion, when it did not pass it.
  const [issues, setIssues] = useState<string[] | null>(null);
  // The shown suggestion translated back into English, without the original line in view.
  const [says, setSays] = useState<string | null>(null);
  // Syllables the shown shorter suggestion still runs past its target, when no wording fit.
  const [over, setOver] = useState<number | null>(unit.suggestionOver ?? null);
  // The wordings the last request brought, best fit first, to pick from.
  const [options, setOptions] = useState<LineSuggestion[]>([]);
  // Wordings already offered for this line, so another try reads differently.
  const tried = useRef<string[]>([]);
  useEffect(() => {
    setDraft(unit.suggestion || unit.text);
    setSuggested(Boolean(unit.suggestion));
    setIssues(null);
    setSays(null);
    setOver(unit.suggestionOver ?? null);
    setOptions([]);
    tried.current = unit.suggestion ? [unit.suggestion] : [];
  }, [unit.suggestion, unit.suggestionOver, unit.text]);
  const changed = draft.trim() !== '' && draft.trim() !== unit.text.trim();
  const fuller = unit.short && !unit.exceeded;
  // The line's own voiced rate, to estimate how long a new wording takes: in syllables, which is how
  // long a line takes to say (one syllable can be three or four characters in an Indian script).
  const spoken = unit.srcEnd - unit.srcStart;
  const lineSyllables = useMemo(() => timeLine(unit.text, 1).syllables, [unit.text]);
  const bySyllables = lineSyllables > 0;
  const secondsOf = (text: string) =>
    bySyllables
      ? (timeLine(text, 1).syllables * unit.speech) / lineSyllables
      : unit.text.trim().length > 0
        ? (text.trim().length * unit.speech) / unit.text.trim().length
        : 0;
  const draftSyllables = timeLine(draft, 1).syllables;
  const draftSeconds = secondsOf(draft);
  // What a shorter wording has to fit in: the line's speech, less what it ran past its slot.
  const room = Math.max(0, unit.speech - unit.exceededBy);
  /** Whether a wording, as estimated, does what this line needs: fits its time, or fills the original speech. */
  const fitsLine = (seconds: number) => (fuller ? !isShort(seconds, spoken) : seconds <= room);
  const pick = (line: LineSuggestion) => {
    setDraft(line.text);
    setSuggested(true);
    setIssues(line.issues ?? null);
    setSays(line.backTranslation ?? null);
    setOver(line.over ?? null);
  };
  const tryAnother = async () => {
    if (!onSuggest || asking) return;
    setAsking(true);
    setAskError(null);
    try {
      const lines = await onSuggest(unit, tried.current);
      if (lines.length > 0) {
        tried.current = [...tried.current, ...lines.map((l) => l.text)].slice(-MAX_TRIED);
        // Best fit first: wordings that keep the meaning and do what the line needs, then the closest of the rest.
        const rank = (l: LineSuggestion) => (l.issues ? 2 : fitsLine(secondsOf(l.text)) ? 0 : 1);
        const sorted = [...lines].sort((a, b) => rank(a) - rank(b) || (fuller ? 0 : secondsOf(a.text) - secondsOf(b.text)));
        setOptions(sorted);
        pick(sorted[0]);
      } else setAskError(`No usable ${fuller ? 'fuller' : 'shorter'} wording came back. Try again, or edit it yourself.`);
    } catch (err: any) {
      setAskError(null);
      reportError(err, { title: 'No new wordings', safe: 'The line is unchanged — you can still edit it yourself.' });
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
    <li className="py-3" data-line-key={unit.key}>
      <div className="flex items-start gap-3">
      <span
        className={`shrink-0 mt-0.5 font-mono text-[11px] px-2 py-0.5 rounded-md tabular-nums ${
          unit.inSync ? 'bg-slate-800 text-slate-300' : 'bg-amber-500/15 text-amber-300'
        }`}
      >
        {unit.offset === null ? 'silent' : formatOffset(unit.offset)}
      </span>
      <span className="shrink-0 mt-0.5 font-mono text-[11.5px] text-slate-500 tabular-nums w-14">{formatClock(unit.srcStart)}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <p className="flex-1 min-w-0 text-[13.5px] text-slate-100 leading-snug">{unit.text}</p>
          <LengthBars unit={unit} />
        </div>
        {unit.sourceText && <p className="text-[12px] text-slate-500 leading-snug mt-0.5">{unit.sourceText}</p>}
        <p className={`text-[11.5px] mt-1 ${unit.exceeded ? 'text-amber-300' : unit.short ? 'text-sky-300' : 'text-slate-400'}`}>{reason}</p>
        {unit.speedFit && !unit.takeFit && <p className="text-[11.5px] mt-1 text-indigo-300">Read {unit.speedFit.toFixed(2)}× faster to fit: its words ran longer than the original line had, even with every pause shrunk</p>}
        <TakeOffer unit={unit} pending={pending} onListen={onListen} onUse={onUseTake} onKeep={onKeepTake} />
        {unit.wordTiming?.status === 'measured' && <p className="text-[11.5px] mt-1 text-indigo-300">Measured words · start {formatOffset(unit.wordTiming.startError ?? 0)} · end {formatOffset(unit.wordTiming.endError ?? 0)}{unit.wordTiming.boundaryMaxError != null && ` · internal boundary ${unit.wordTiming.boundaryMaxError.toFixed(2)} s`}</p>}

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
              {options.length > 1 && (
                <div role="radiogroup" aria-label="Suggested wordings" className="mb-2 flex flex-col gap-1">
                  {options.map((option, i) => {
                    const picked = suggested && option.text === draft;
                    const seconds = secondsOf(option.text);
                    const good = !option.issues && fitsLine(seconds);
                    return (
                      <button
                        key={option.text}
                        type="button"
                        role="radio"
                        aria-checked={picked}
                        onClick={() => pick(option)}
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
                          <span className="block text-[13px] text-slate-100 leading-snug">{option.text}</span>
                          {option.backTranslation && <span className="block mt-0.5 text-[11.5px] text-slate-500 leading-snug">Says: {option.backTranslation}</span>}
                        </span>
                        <span className="shrink-0 flex flex-col items-end gap-0.5">
                          <span
                            className={`text-[10.5px] font-semibold px-1.5 rounded tabular-nums ${good ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}
                            title="Estimated from how fast this voice said the line"
                          >
                            ≈{seconds.toFixed(1)} s · {fitsLine(seconds) ? (fuller ? 'fills' : 'fits') : fuller ? 'ends early' : 'long'}
                          </span>
                          {bySyllables && <span className="text-[10.5px] text-slate-500 tabular-nums">{timeLine(option.text, 1).syllables} syllables</span>}
                          {option.issues && <span className="text-[10.5px] text-amber-300">check meaning</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {suggested && issues && <MeaningWarning issues={issues} />}
              {/* The server aims a little under the slot, so a wording it marks long may still fit as estimated here: only say so when both agree. */}
              {suggested && !fuller && over != null && over > 0 && !fitsLine(draftSeconds) && (
                <p className="mb-1 text-[11.5px] text-amber-300 leading-snug">
                  Still about {over} syllable{over === 1 ? '' : 's'} long: no wording fit, so this is the closest. Trim a word or two.
                </p>
              )}
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
                  setOver(null);
                }}
                rows={2}
                className="w-full resize-y bg-slate-900 border border-slate-800 rounded-md px-2 py-1.5 text-[13px] text-slate-100 leading-snug focus:outline-none focus:border-indigo-500"
              />
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onApply(unit, draft)}
                  disabled={!changed}
                  className="h-7 px-2.5 flex items-center gap-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-default"
                  title="Put this wording into the script. Sync again to voice it."
                >
                  <Check className="w-3.5 h-3.5" /> Use this line
                </button>
                <button
                  type="button"
                  onClick={copy}
                  className="h-7 px-2 flex items-center gap-1 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-300 cursor-default"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                {onSuggest && unit.targetChars != null && (
                  <button
                    type="button"
                    onClick={tryAnother}
                    disabled={asking}
                    className="h-7 px-2 flex items-center gap-1 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-300 disabled:opacity-60 cursor-default"
                  >
                    {asking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    {asking ? 'Asking…' : suggested ? '3 more' : 'Suggest 3'}
                  </button>
                )}
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {bySyllables ? `${draftSyllables} / ${lineSyllables} syllables` : `${draft.trim().length} / ${unit.text.trim().length} characters`}
                </span>
                {!fuller && unit.exceeded && draftSeconds > 0 && (
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-md tabular-nums ${
                      draftSeconds <= room ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
                    }`}
                    title="Estimated from how fast this voice said the line"
                  >
                    about {draftSeconds.toFixed(1)} s of {room.toFixed(1)} s · {draftSeconds <= room ? 'fits' : 'still long'}
                  </span>
                )}
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
          className="flex items-center gap-1 h-7 px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs text-slate-200 cursor-default"
        >
          <Play className="w-3 h-3 fill-current" /> Listen
        </button>
        {onToggleTakes && !unit.silent ? (
          <button
            type="button"
            onClick={onToggleTakes}
            aria-expanded={takesOpen}
            className={`flex items-center gap-1 h-7 px-2.5 rounded-lg border text-xs cursor-default ${
              takesOpen ? 'border-indigo-400/70 bg-indigo-500/15 text-indigo-100' : 'border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-slate-200'
            }`}
            title="Voice new takes of this line now, hear them side by side and pick one"
          >
            <Mic className="w-3 h-3" /> Takes
          </button>
        ) : onRetake && !unit.silent && (
          <button
            type="button"
            onClick={() => onRetake(unit)}
            disabled={pending}
            className="flex items-center gap-1 h-7 px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-default"
            title="Voices this line three times and keeps the take that fits its slot best (three voicings of the line). Sync again to hear it."
          >
            <Mic className="w-3 h-3" /> Retake
          </button>
        )}
      </div>
      </div>
      {takes && <div className="mt-3">{takes}</div>}
    </li>
  );
};

