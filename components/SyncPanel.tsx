import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  AudioWaveform,
  Bookmark,
  Check,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Combine,
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
import {
  FitCard,
  FitOnSyncToggle,
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
import { isOwnCustom, lengthPresetOf } from '../services/syncAutoFit';
import { CenteredPanel } from './CenteredPanel';
import { ToolWindow, toolPrimaryButton, toolSecondaryButton, toolTextButton } from './ToolWindow';

/**
 * Sync, in the Dub step: voices the script line by line, places each line in
 * step with the original, and shows how well each line landed. Two panels:
 * the settings rail (what to sync with, and the button) and the results
 * (what the dub will take, progress, then the report). See services/syncService.ts.
 */

const OPTIONS_KEY = 'dhvani_sync_options';

/** What Sync changed lines only does, on its buttons. */
const CHANGED_ONLY_HINT =
  'Voices and places only the changed lines. Every other line is locked where it is for this Sync, then let go again, so it does not move: a changed line that needs more room runs into the next line and is flagged, nothing is pushed. A line voiced differently (another voice or setting) is placed afresh.';


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

/** A saved Fit to this video, while the join is still what it left (and the preset is Custom). */
const fittedOf = (saved: unknown, preset: string | null, join: SyncJoinSettings): SyncOptions['fitted'] | null => {
  if (preset || !saved || typeof saved !== 'object') return null;
  const record = saved as { preset?: unknown; join?: unknown };
  const from = (Object.keys(SYNC_JOIN_PRESETS) as (keyof typeof SYNC_JOIN_PRESETS)[]).find((id) => id === record.preset);
  if (!from) return null;
  const fittedJoin = readJoinSettings(record.join);
  return (Object.keys(join) as (keyof SyncJoinSettings)[]).every((key) => fittedJoin[key] === join[key]) ? { preset: from, join: fittedJoin } : null;
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
      fitOnSync: saved.fitOnSync !== false,
      // Auto unless a length was picked by hand.
      ...(saved.lengthAuto === false && { lengthAuto: false }),
      // What Fit to this video left, kept while the join still is it: then Custom is Fit's, not the user's.
      ...(fittedOf(saved.fitted, preset ?? null, join) && { fitted: fittedOf(saved.fitted, preset ?? null, join)! }),
      ...(typeof saved.fitUndone === 'string' && { fitUndone: saved.fitUndone }),
    };
  } catch {
    return defaultSyncOptions();
  }
};

/** Keeps sync options for the next project, the way a project without its own reads them. */
export const rememberSyncOptions = (options: SyncOptions) => {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  } catch {}
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
  // A change made somewhere else, such as Tools and settings, reaches a panel that is open.
  const seen = useRef(saved);
  useEffect(() => {
    if (saved === seen.current) return;
    seen.current = saved;
    if (!saved || pending.current || JSON.stringify(saved) === JSON.stringify(current.current)) return;
    setSlot({ id: projectId, options: readOptions(saved) });
  }, [saved, projectId]);
  const setOptions: React.Dispatch<React.SetStateAction<SyncOptions>> = useCallback((update) => {
    const next = typeof update === 'function' ? update(current.current) : update;
    current.current = next;
    setSlot({ id: projectId, options: next });
    rememberSyncOptions(next);
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
  /** Moves the player to a time: where a line with no audio is. */
  onGoTo?: (time: number) => void;
  /** What the mix of the speakers leaves to look at; nothing when it is fine. */
  mixWarnings?: string[];
  /** At the right end: subtitles, the script, Save the dub. */
  actions?: React.ReactNode;
  /** One part alone: the badge and counts with no bar around them, or the bar with only its notices. */
  part?: 'status' | 'notices';
}> = ({ report, handEdits = 0, presetNow, presetSuggestion, onUsePreset, onGoTo, mixWarnings = [], actions, part }) => {
  // Lines the voice returned no audio for: they have no clip on the lanes, so this bar is where they show.
  const silentLines = useMemo(() => report.units.filter((unit) => unit.silent), [report]);
  const stepAt = useRef<Record<string, number>>({});
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
  const suits = Boolean(presetSuggestion) && presetNow.split(' · ')[0].replace(/, fitted$/, '') === presetName(presetSuggestion!.preset);
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
      ? `Long lines push the ones after them, so the dub drifts up to ${maxLate.toFixed(2)} s late. Shorten the long lines in their retake window, then sync again.`
      : allInSync
        ? 'Every line starts where the original line does.'
        : '',
    offerPreset ? `${presetName(offerPreset.preset)} suits it better than ${presetNow}.` : suits && lengthOff ? `${presetNow} suits this dub.` : kept ? `Kept ${presetNow}.` : '',
    reviews.join(' · '),
  ]
    .filter(Boolean)
    .join(' ');
  // Lines to look at, each counted once, by what is wrong with it.
  const offTiming = report.units.filter((u) => !u.silent && !u.exceeded && !u.short && !u.inSync);
  const toCheck = report.units.filter((u) => u.silent || u.exceeded || u.short || !u.inSync).length;
  /** Moves the player to the next line of a kind, round and round. */
  const stepTo = (key: string, units: SyncUnitReport[]) =>
    onGoTo && units.length > 0
      ? () => {
          const n = stepAt.current[key] ?? 0;
          stepAt.current[key] = n + 1;
          onGoTo(units[n % units.length].srcStart);
        }
      : undefined;
  const longLines = report.units.filter((u) => u.exceeded);
  const earlyLines = report.units.filter((u) => u.short && !u.exceeded);
  const goTitle = (what: string) => `${what} Click to go to ${onGoTo ? 'the next one' : 'them'}.`;
  const counts = [
    { label: 'Off timing', n: offTiming.length, go: stepTo('off', offTiming), title: goTitle('Lines that start early or late.') },
    { label: 'No audio', n: silentLines.length, go: stepTo('silent', silentLines), title: goTitle('The voice returned no audio for these lines, so the dub is silent there.') },
  ].filter((c) => c.n > 0);
  const precision = SYNC_PRECISION_OPTIONS.find((o) => o.id === report.precision)?.label;
  const stats: { label: string; value: React.ReactNode; tone?: string }[] = [
    {
      label: 'In sync',
      value: (
        <>
          {inSync}
          <span className="text-[12px] text-slate-500"> / {lines}</span>
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
  // 'status': the badge, what the sync came to and its numbers, to sit on the row over the timeline.
  const status = (
    <>
      {/* One badge, then only the kinds of line there are to check. The whole report is the badge's tooltip. */}
      <span
        title={[headline + '.', detail, `${inSync} of ${lines} lines in sync · 90% start within ${p90Error.toFixed(2)} s · worst line ${maxError.toFixed(2)} s`]
          .filter(Boolean)
          .join(' ')}
        className={`shrink-0 flex items-center gap-1.5 h-7 px-3 rounded-full text-[12px] font-semibold ${
          toCheck === 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-400/12 text-amber-300'
        }`}
      >
        {toCheck === 0 ? <Check className="w-3.5 h-3.5" /> : <span className="w-2 h-2 rounded-full bg-amber-400" />}
        {toCheck === 0 ? 'In sync' : `${toCheck} to check`}
      </span>
      {counts.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-slate-300">
          {counts.map((c, i) => (
            <React.Fragment key={c.label}>
              {i > 0 && <span className="text-slate-600">·</span>}
              {c.go ? (
                <button type="button" onClick={c.go} title={c.title} className="hover:text-white hover:underline underline-offset-2 cursor-default">
                  {c.label} <span className="font-semibold tabular-nums text-amber-300">{c.n}</span>
                </button>
              ) : (
                <span title={c.title}>
                  {c.label} <span className="font-semibold tabular-nums text-amber-300">{c.n}</span>
                </span>
              )}
            </React.Fragment>
          ))}
        </span>
      )}
      <div className="min-w-0">
        <h2 className={`text-[13.5px] font-semibold leading-snug ${allInSync ? 'text-slate-100' : 'text-amber-50'}`}>{headline}</h2>
        {detail && <p className="text-[11px] text-slate-400 leading-snug">{detail}</p>}
      </div>
      <dl className="flex flex-wrap gap-y-1.5">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col px-3 border-l border-edge">
            <dt className="text-[10.5px] text-slate-400 whitespace-nowrap">{s.label}</dt>
            <dd className={`text-[15px] font-semibold tabular-nums leading-tight ${s.tone || 'text-slate-100'}`}>{s.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
  if (part === 'status') return status;
  // 'notices': a bar only while there is something to say: a length that suits another preset, or the mix.
  if (part === 'notices' && !offerPreset && mixWarnings.length === 0) return null;
  return (
    <section
      aria-label="Sync result"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-edge bg-slate-900/90 px-4 py-2"
    >
      {part !== 'notices' && status}
      {part === 'notices' && offerPreset && (
        <p className="min-w-[14rem] flex-1 text-[12.5px] text-slate-200">
          {presetName(offerPreset.preset)} suits this dub's length better than {presetNow}.
        </p>
      )}
      {mixWarnings.length > 0 && (
        <ul className="basis-full flex flex-col gap-1">
          {mixWarnings.map((text) => (
            <li key={text} className="flex items-start gap-2 text-[12px] text-amber-200">
              <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}
      {offerPreset && (
        <div className="flex items-center gap-2">
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
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </section>
  );
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
  'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-edge bg-slate-950/60 hover:bg-slate-800 text-left text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-default';

/** A file in the Save the dub window: its format, what it is, and the save mark. */
const saveRow =
  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-edge bg-slate-950/60 hover:bg-slate-800 hover:border-slate-600 text-left transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-default';

/** A button on the player's row, once synced: Voice, the settings, Cancel. */
const syncAction =
  'h-8 px-3 flex items-center gap-1.5 rounded-lg border border-slate-700 text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 whitespace-nowrap transition-colors disabled:opacity-40 cursor-default';

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
  /** Sync from scratch, once synced: every line voiced anew, nothing kept from the dub before (asks first). */
  onSyncFromScratch?: () => void;
  /** Syncs only the changed lines: every other line is locked where it is for that Sync. */
  onSyncChangedOnly?: () => void;
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
  /** Saves the synced dub with the tracks of outside audio mixed in, as WAV or MP3; absent without tracks. */
  onDownloadWithTracks?: (format: 'wav' | 'mp3') => Promise<void>;
  /** A dub of several speakers: each speaker's own track, the same length as the dub. */
  stems?: { speaker: string; color?: string }[];
  onDownloadStem?: (speaker: string) => void;
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
  /**
   * 'bar' before the first sync: "Ready to dub" as one row under the Dub
   * settings card, with `summary` (the fit and what is left to look at), the
   * tools in a menu, and the button. The settings themselves sit on the card.
   */
  variant?: 'bar' | 'save' | 'sync';
  /** 'sync': opens the Voice and delivery window; `voiceWarn` is what there is to look at in it, if anything. */
  onOpenVoice?: () => void;
  voiceWarn?: string | null;
  /** 'save': more files, at the foot of the Save the dub window. */
  saveExtras?: React.ReactNode;
  summary?: React.ReactNode;
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
 * It opens in the middle of the screen like the other tool windows: a grouped
 * list of sections on the left, each with what it is set to and an amber dot
 * when changed, and the chosen one on the right. Changes apply as they are
 * made, so the preview follows them.
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
      const preset = joinPresetOf(next, o.screen);
      // Applied onto a preset (not the user's own Custom), it stays Fit's: Sync may fit it again.
      return { ...o, join: next, preset, fitted: preset === 'custom' && !isOwnCustom(o) ? { preset: lengthPresetOf(o), join: next } : undefined };
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

  const body = (() => {
    switch (current.id) {
      case 'basics':
        return (
          <div className="flex flex-col gap-4">
            {fitSource && (
              <FitCard
                source={fitSource}
                join={options.join}
                disabled={isSyncing}
                onApply={applyFit}
                suggestion={presetSuggestion}
                fitOnSync={options.fitOnSync !== false}
              />
            )}
            <FitOnSyncToggle on={options.fitOnSync !== false} disabled={isSyncing} onChange={(on) => onOptionsChange((o) => ({ ...o, fitOnSync: on }))} />
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
                        checked ? 'border-indigo-500/70 bg-indigo-500/10' : 'border-edge bg-slate-800/20 hover:border-slate-700'
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
                <div role="radiogroup" aria-label="Precision" className="flex gap-1 p-1 rounded-xl bg-slate-950 border border-edge">
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

  const findSetting = (
    <label className="hidden sm:flex items-center gap-2 h-[34px] w-56 px-2.5 rounded-[10px] border border-slate-700 bg-slate-950 text-slate-500 focus-within:border-indigo-500">
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
  );

  // Dub & sync sits at the far right on the Dub step; Done is the window's last word everywhere else.
  const syncShown = !isSyncing && Boolean(onSync);
  const footer = (
    <>
      <button
        type="button"
        onClick={() => onOptionsChange(defaultSyncOptions())}
        disabled={isSyncing || isDefaultOptions(options)}
        title={isDefaultOptions(options) ? 'Already on the default settings' : 'Line by line, phrase precision, Natural line joins, no suggestions'}
        className={toolTextButton}
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
      <button type="button" onClick={onClose} className={syncShown ? toolSecondaryButton : toolPrimaryButton}>
        Done
      </button>
      {syncShown && onSync && (
        <button
          type="button"
          onClick={() => {
            onClose();
            onSync();
          }}
          disabled={Boolean(blockedReason)}
          className={toolPrimaryButton}
        >
          {synced ? <RefreshCw className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
          {synced ? 'Sync again' : 'Dub & sync'}
        </button>
      )}
    </>
  );

  // On the page itself, not in the rail: the sticky rail would keep it under the timeline's markers.
  return createPortal(
    <ToolWindow
      onClose={onClose}
      title="Sync settings"
      titleId="sync-settings-title"
      subtitle={isSyncing ? 'Locked while the dub syncs.' : 'How each line is placed. Changes apply as you make them, for the next sync.'}
      icon={SlidersHorizontal}
      tone="violet"
      widthClassName="max-w-[66rem]"
      // A set height, so the window does not jump from one section to the next.
      heightClassName="h-[min(46rem,100%)]"
      headerExtra={findSetting}
      footer={footer}
      bodyScrolls={false}
    >
      <div className="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav
          aria-label="Sync settings sections"
          // Each row grows into the room the window has, up to a comfortable height, and shrinks back to its content when it is short.
          className="shrink-0 flex md:flex-col gap-0.5 p-2 md:px-2.5 md:py-2 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto [scrollbar-width:thin] border-b md:border-b-0 md:border-r border-edge bg-slate-950/40"
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
    </ToolWindow>,
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
/**
 * Ready to dub's script and tools under one button, so the card stays one
 * window high: they open over the card, above the button. A click in a menu
 * one of them opens (Save script's, in a portal) leaves them open.
 */
const ReadyTools: React.FC<{ children: React.ReactNode; bar?: boolean }> = ({ children, bar = false }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (box.current?.contains(target) || target?.closest?.('[role="menu"], [role="dialog"]')) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      {open && (
        <div
          className={`absolute bottom-full mb-2 z-30 flex flex-col gap-1.5 p-2.5 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl shadow-black/60 ${
            bar ? 'right-0 w-80' : 'inset-x-0'
          }`}
        >
          {children}
        </div>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className={`flex items-center justify-center gap-1.5 text-[12.5px] font-medium text-slate-300 hover:text-slate-100 hover:bg-slate-800 cursor-default ${
          bar ? 'h-9 px-3 rounded-xl border border-slate-700 whitespace-nowrap' : 'w-full h-8 rounded-lg'
        }`}
      >
        Script and tools <ChevronUp className={`w-3.5 h-3.5 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>
    </div>
  );
};

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
  onSyncFromScratch,
  onSyncChangedOnly,
  onCancel,
  onBack,
  costNote,
  extras,
  onDownloadWav,
  onDownloadMp3,
  onDownloadWithTracks,
  stems = [],
  onDownloadStem,
  onOpenVoiceChanger,
  subtitles,
  multiSpeaker = false,
  fitSource,
  lineCount,
  openRequest = 0,
  presetSuggestion,
  variant = 'bar',
  onOpenVoice,
  voiceWarn = null,
  saveExtras,
  summary,
}) => {
  const bar = variant === 'bar';
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingMp3, setSavingMp3] = useState(false);
  /** The menu under Sync again's arrow, and where on the window it opened. */
  const syncMenu = useRef<HTMLDetailsElement>(null);
  const [syncMenuPlace, setSyncMenuPlace] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  useEffect(() => {
    if (!syncMenuPlace) return;
    const shut = (e: Event) => {
      if (e.type === 'mousedown' && syncMenu.current?.contains(e.target as Node)) return;
      syncMenu.current?.removeAttribute('open');
    };
    window.addEventListener('mousedown', shut);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('resize', shut);
    return () => {
      window.removeEventListener('mousedown', shut);
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('resize', shut);
    };
  }, [syncMenuPlace]);
  /** The Save the dub window: every file the dub can be saved as, with what each is. */
  const [saveOpen, setSaveOpen] = useState(false);
  /** Which Dub + tracks file is being mixed, if one is. */
  const [mixingTracks, setMixingTracks] = useState<'wav' | 'mp3' | null>(null);
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

  const footNote = waitingFor
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
              .join(' ');

  const settingsWindow = settingsOpen && (
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
  );

  if (bar) {
    // Before the first sync: one row under the Dub settings card.
    const barNote =
      blockedReason && !isSyncing
        ? blockedReason
        : interrupted && !isSyncing
          ? 'The last dub stopped before it finished. The lines it voiced are kept: resuming voices only the rest.'
          : footNote;
    return (
      <section aria-label="Ready to dub" className="shrink-0 flex flex-wrap items-center gap-x-5 gap-y-2.5 px-4 py-2.5 bg-slate-900/90 border border-edge rounded-2xl">
        {summary}
        <div className="flex-1 min-w-[1rem]" />
        <div className="flex items-center gap-2.5 min-w-0 ml-auto">
          {/* The usual note is the button's tooltip; only what stops or changes the dub is spelled out. */}
          {(blockedReason || interrupted) && !isSyncing && (
            <span className="max-w-[18rem] text-[11.5px] leading-snug text-right text-amber-300" title={barNote}>
              {barNote}
            </span>
          )}
          <button
            type="button"
            onClick={onBack}
            className="h-9 px-2.5 flex items-center gap-1 rounded-xl text-[12.5px] text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-default"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Review
          </button>
          {extras && <ReadyTools bar>{extras}</ReadyTools>}
          {isSyncing ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="h-10 px-5 flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-[13px] font-medium text-slate-200 disabled:opacity-50 cursor-default"
            >
              <X className="w-4 h-4" /> {waitingFor ? 'Take out of the line' : isCancelling ? 'Cancelling…' : 'Cancel sync'}
            </button>
          ) : (
            <button
              type="button"
              onClick={onSync}
              disabled={Boolean(blockedReason)}
              title={barNote}
              className="h-10 px-6 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[13.5px] font-semibold whitespace-nowrap transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-default active:translate-y-px"
            >
              {interrupted ? <RefreshCw className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
              {interrupted ? 'Resume dub' : 'Dub & sync'}
            </button>
          )}
        </div>
        {settingsWindow}
      </section>
    );
  }

  if (variant === 'save') {
    // Once synced, in the status bar: what the dub is saved as. Subtitles and the script come as buttons before it.
    return (
      <>
        {subtitles}
        {extras}
        {(onDownloadWav || onDownloadMp3) && (
          <button
            type="button"
            onClick={() => setSaveOpen(true)}
            disabled={isSyncing}
            aria-haspopup="dialog"
            className="h-9 px-4 flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold whitespace-nowrap transition-colors disabled:bg-slate-800 disabled:text-slate-500 cursor-default active:translate-y-px"
          >
            <Download className="w-4 h-4" /> Save the dub
          </button>
        )}
    <CenteredPanel open={saveOpen && !isSyncing} onClose={() => setSaveOpen(false)} label="Save the dub" className="max-w-[30rem]">
      <header className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-edge">
        <span className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300">
          <Download className="w-[18px] h-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-slate-100">Save the dub</h2>
          <p className="text-[12px] text-slate-400">Pick a file. Each one saves on its own.</p>
        </span>
        <button
          type="button"
          onClick={() => setSaveOpen(false)}
          aria-label="Close"
          className="w-8 h-8 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-default"
        >
          <X className="w-4 h-4" />
        </button>
      </header>
      <div className="px-5 py-4 flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className={sectionLabel}>The dub</span>
          {onDownloadWav && (
            <button type="button" onClick={onDownloadWav} className={saveRow}>
              <span className="shrink-0 w-10 text-center font-mono text-[10.5px] py-0.5 rounded-md bg-slate-800 text-slate-300">WAV</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] text-slate-100">Synced dub</span>
                <span className="block text-[11.5px] text-slate-400 leading-snug">The dub itself, as Sync made it.</span>
              </span>
              <Download className="w-4 h-4 text-slate-500 shrink-0" />
            </button>
          )}
          {onDownloadMp3 && (
            <button
              type="button"
              onClick={() => {
                setSavingMp3(true);
                onDownloadMp3().finally(() => setSavingMp3(false));
              }}
              disabled={savingMp3}
              className={saveRow}
            >
              <span className="shrink-0 w-10 text-center font-mono text-[10.5px] py-0.5 rounded-md bg-slate-800 text-slate-300">MP3</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] text-slate-100">{savingMp3 ? 'Making the MP3…' : 'Synced dub'}</span>
                <span className="block text-[11.5px] text-slate-400 leading-snug">A smaller copy at 320 kbps, at the dub's own sample rate. The dub itself stays WAV.</span>
              </span>
              {savingMp3 ? <Loader2 className="w-4 h-4 text-slate-500 animate-spin shrink-0" /> : <Download className="w-4 h-4 text-slate-500 shrink-0" />}
            </button>
          )}
        </div>
        {onDownloadWithTracks && (
          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>With the tracks you added</span>
            {(['wav', 'mp3'] as const).map((format) => (
              <button
                key={format}
                type="button"
                onClick={() => {
                  setMixingTracks(format);
                  onDownloadWithTracks(format).finally(() => setMixingTracks(null));
                }}
                disabled={mixingTracks !== null}
                className={saveRow}
              >
                <span className="shrink-0 w-10 text-center font-mono text-[10.5px] py-0.5 rounded-md bg-slate-800 text-slate-300">{format.toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] text-slate-100">
                    {mixingTracks === format ? (format === 'mp3' ? 'Making the MP3…' : 'Mixing the tracks in…') : 'Dub + tracks'}
                  </span>
                  <span className="block text-[11.5px] text-slate-400 leading-snug">
                    {format === 'wav'
                      ? 'The dub with your Edit timing tracks mixed in, as a 32-bit float WAV so nothing clips. Muted or soloed tracks are still in it.'
                      : "The same mix at 320 kbps. An MP3 can't hold peaks above 0 dB: if the mix goes over, it clips there and the WAV does not."}
                  </span>
                </span>
                {mixingTracks === format ? <Loader2 className="w-4 h-4 text-slate-500 animate-spin shrink-0" /> : <Download className="w-4 h-4 text-slate-500 shrink-0" />}
              </button>
            ))}
          </div>
        )}
        {onDownloadStem && stems.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className={sectionLabel}>Each speaker alone</span>
            <p className="-mt-1 text-[11.5px] text-slate-400 leading-snug">Every track is the same length as the dub, so they line up at 0:00 in an editor.</p>
            {stems.map((stem) => (
              <button key={stem.speaker} type="button" onClick={() => onDownloadStem(stem.speaker)} className={saveRow}>
                <span className="shrink-0 w-10 text-center font-mono text-[10.5px] py-0.5 rounded-md bg-slate-800 text-slate-300">WAV</span>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stem.color ?? '#64748b' }} />
                <span className="min-w-0 flex-1 text-[13.5px] text-slate-100 truncate">{stem.speaker}</span>
                <Download className="w-4 h-4 text-slate-500 shrink-0" />
              </button>
            ))}
          </div>
        )}
        {saveExtras && <div className="flex flex-col gap-2">{saveExtras}</div>}
      </div>
    </CenteredPanel>
      </>
    );
  }

  // Once synced, on the player's row: the voice, the settings and Sync again, for the next Sync.
  const syncNote =
    blockedReason && !isSyncing
      ? blockedReason
      : interrupted && !isSyncing
        ? 'The last dub stopped before it finished. The lines it voiced are kept: resuming voices only the rest.'
        : footNote;
  const hot = !blockedReason && (pendingCount > 0 || interrupted);
  // The menu under Sync again's arrow: placed on the window when it opens, shut by a click anywhere else or a scroll.
  const closeMenu = (e: React.MouseEvent) => (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
  const menuItem = 'w-full flex items-start gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-slate-800 cursor-default';
  const showChangedOnly = synced && pendingCount > 0 && !interrupted && !blockedReason && onSyncChangedOnly;
  const showFromScratch = synced && !interrupted && !blockedReason && onSyncFromScratch;
  return (
    <>
      {(blockedReason || interrupted) && !isSyncing && (
        <span className="max-w-[16rem] truncate text-[11.5px] text-amber-300" title={syncNote}>
          {syncNote}
        </span>
      )}
      {onOpenVoice && (
        <button
          type="button"
          onClick={onOpenVoice}
          aria-haspopup="dialog"
          title={voiceWarn || 'Voice and delivery: the voices, model, expression and audio quality the next Sync uses'}
          className={`relative ${syncAction}`}
        >
          <Mic className="w-3.5 h-3.5" /> Voice
          {voiceWarn && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
        </button>
      )}
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        aria-haspopup="dialog"
        aria-label="Sync settings"
        title={`Sync settings: ${chips.join(' · ')}${changed ? ` · ${changed} changed from the defaults` : ''}`}
        className={`relative ${syncAction}`}
      >
        <Settings2 className="w-3.5 h-3.5" />
        {changed > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
      </button>
      {isSyncing ? (
        <button type="button" onClick={onCancel} disabled={isCancelling} className={syncAction}>
          <X className="w-3.5 h-3.5" /> {waitingFor ? 'Take out of the line' : isCancelling ? 'Cancelling…' : 'Cancel sync'}
        </button>
      ) : (
        <div className="flex">
          <button
            type="button"
            onClick={onSync}
            disabled={Boolean(blockedReason)}
            title={syncNote}
            className={`h-8 px-3 flex items-center gap-1.5 text-xs font-medium whitespace-nowrap transition-colors disabled:opacity-40 cursor-default ${
              showChangedOnly || showFromScratch ? 'rounded-l-lg' : 'rounded-lg'
            } ${
              hot
                ? 'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-600'
                : 'border border-slate-700 text-slate-200 hover:text-white hover:bg-slate-800'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {interrupted ? 'Resume dub' : 'Sync again'}
            {synced && pendingCount > 0 && !interrupted && <span className="tabular-nums opacity-90">· {pendingCount} changed</span>}
          </button>
          {(showChangedOnly || showFromScratch) && (
            <details
              ref={syncMenu}
              onToggle={(e) => {
                const box = e.currentTarget;
                if (!box.open) return setSyncMenuPlace(null);
                // Beside the button, held inside the card it is in (the timeline's, marked data-menu-bounds): above the button when the card has no room below.
                const button = box.getBoundingClientRect();
                const card = box.closest('[data-menu-bounds]')?.getBoundingClientRect();
                const width = 288;
                const height = 140;
                const minLeft = Math.max(8, (card?.left ?? 0) + 8);
                const maxRight = Math.min(window.innerWidth - 8, (card?.right ?? window.innerWidth) - 8);
                const floor = Math.min(window.innerHeight - 8, (card?.bottom ?? window.innerHeight) - 8);
                const left = Math.max(minLeft, Math.min(button.right - width, maxRight - width));
                setSyncMenuPlace(button.bottom + 6 + height <= floor ? { left, top: button.bottom + 6 } : { left, bottom: window.innerHeight - button.top + 6 });
              }}
            >
              <summary
                aria-label="Other ways to sync"
                title="Other ways to sync"
                className={`list-none h-8 w-7 flex items-center justify-center rounded-r-lg border border-l-0 cursor-default [&::-webkit-details-marker]:hidden ${
                  hot ? 'border-indigo-600 bg-indigo-600 hover:bg-indigo-500 text-white' : 'border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </summary>
              <div
                style={{ position: 'fixed', left: syncMenuPlace?.left ?? 8, top: syncMenuPlace?.top, bottom: syncMenuPlace?.bottom, visibility: syncMenuPlace ? 'visible' : 'hidden' }}
                className="z-[70] w-72 max-w-[calc(100vw-1rem)] p-1 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60"
              >
                {showChangedOnly && (
                  <button
                    type="button"
                    onClick={(e) => {
                      closeMenu(e);
                      onSyncChangedOnly!();
                    }}
                    title={CHANGED_ONLY_HINT}
                    className={menuItem}
                  >
                    <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-300" />
                    <span>
                      <span className="block text-[12.5px] font-medium text-slate-100">
                        Sync {pendingCount === 1 ? 'the changed line' : `the ${pendingCount} changed lines`} only
                      </span>
                      <span className="block text-[11px] text-slate-400 leading-snug">Every other line stays where it is.</span>
                    </span>
                  </button>
                )}
                {showFromScratch && (
                  <button
                    type="button"
                    onClick={(e) => {
                      closeMenu(e);
                      onSyncFromScratch!();
                    }}
                    className={menuItem}
                  >
                    <RotateCcw className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-300" />
                    <span>
                      <span className="block text-[12.5px] font-medium text-slate-100">Sync from scratch…</span>
                      <span className="block text-[11px] text-slate-400 leading-snug">
                        Voices every line again: hand edits, locks and picked takes go. Asks first.
                      </span>
                    </span>
                  </button>
                )}
              </div>
            </details>
          )}
        </div>
      )}
      {settingsWindow}
    </>
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
  /** Syncs only the changed lines: every other line is locked where it is for that Sync. */
  onSyncChangedOnly?: () => void;
  /** The original and the synced dub, drawn behind the lines of the alignment view. */
  sourceBuffer?: AudioBuffer | null;
  dubBuffer?: AudioBuffer | null;
  /** One continuous read: its progress while the script is voiced in one take, before the lines are placed. */
  reading?: DubProgress | null;
}

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
  onSyncChangedOnly,
  sourceBuffer,
  dubBuffer,
  reading = null,
}) => {
  /** Lines Sync made a new take for (a better fit, or one read faster): to choose, to take back, or why it was not used. */
  const offers = useMemo(
    () => (report ? report.units.filter((unit) => (unit.takeFit || unit.takeRejected) && !pendingLines.includes(unit.key)) : []),
    [report, pendingLines]
  );

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
  // Once synced, the status bar and the player say how it went: this panel is only what is left to act on or know.
  const nothingToShow =
    Boolean(report) &&
    !isSyncing &&
    offers.length === 0 &&
    pendingLines.length === 0 &&
    report!.summary.wordTimingMeasured === undefined &&
    !(report!.summary.fromDub ?? 0) &&
    !(report!.summary.meaningRejected ?? 0) &&
    !report!.summary.suggestionError;
  if (nothingToShow) return null;

  return (
    <section aria-label="Sync" className={`bg-slate-900/90 border border-edge rounded-2xl p-4 sm:p-5 flex flex-col gap-4 min-w-0`}>
      {/* Once synced, the result is the status bar over the player; this heading is for before and during a sync. */}
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
            : 'Each line is placed near its original timing; a long line can move the lines around it. Sync does not stretch the voice.'} Breath reduction, loudness matching and fades follow the options you choose. A line that cannot meet Strict timing or a protected pause is flagged, never left out.
          {handEdits > 0 && ' Your hand edits in Edit timing are in this dub: there, only the speed, level and fades you set change a line, and Sync again keeps every locked line where you put it.'}
        </p>
      </div>
      )}

      {idle && preview}

      {idle && !preview && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-5 rounded-xl border border-edge bg-slate-950/60 px-4 py-4">
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
        <div className="flex flex-col gap-2 rounded-xl border border-edge bg-slate-950/40 px-3.5 py-3" role="status" aria-live="polite">
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
        <div className="flex items-center gap-2 rounded-xl border border-edge bg-slate-950/40 px-3.5 py-3 text-[12.5px] text-slate-300" role="status" aria-live="polite">
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
              wording the text model offered changed the meaning of the original line. Reword {report.summary.meaningRejected === 1 ? 'that line' : 'those lines'}{' '}
              yourself in the retake window.
            </p>
          )}
          {report.summary.suggestionError && (
            <p className="text-xs text-amber-300">
              No new wording could be suggested for {Math.max(1, (report.summary.suggestionsAsked ?? report.summary.exceeded) - report.summary.suggested)} of
              the lines that run long or end early. The text model said: {report.summary.suggestionError}
            </p>
          )}

            {pendingLines.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-500/40 bg-indigo-950/30 px-3.5 py-2.5">
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
                {onSyncChangedOnly && (
                  <button
                    type="button"
                    onClick={onSyncChangedOnly}
                    disabled={Boolean(blockedReason)}
                    title={CHANGED_ONLY_HINT}
                    className="h-8 px-3 flex items-center gap-1.5 rounded-lg border border-indigo-500/50 text-xs text-indigo-100 hover:bg-indigo-500/15 disabled:opacity-40 cursor-default"
                  >
                    <Lock className="w-3.5 h-3.5" /> Changed only
                  </button>
                )}
              </div>
            )}
          {offers.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold text-slate-100">New takes from Sync</h3>
              <ul className="divide-y divide-slate-800">
                {offers.map((unit) => (
                  <li key={unit.key} className="py-2.5">
                    <p className="text-[13px] text-slate-100 leading-snug">
                      <span className="font-mono text-[11.5px] text-slate-500 tabular-nums mr-2">{formatClock(unit.srcStart)}</span>
                      {unit.text}
                    </p>
                    <TakeOffer unit={unit} pending={false} onListen={onListen} onUse={onUseTake} onKeep={onKeepTake} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
};

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


