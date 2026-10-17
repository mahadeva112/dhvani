import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronRight, Loader2, RotateCcw, Ruler, X } from 'lucide-react';
import {
  fitJoinSettings,
  presetExtras,
  syncJoinPreset,
  SYNC_JOIN_PRESETS,
  SYNC_JOIN_PRESET_OPTIONS,
  SYNC_SCREEN_OPTIONS,
  SyncFit,
  SyncJoinPreset,
  SyncJoinSettings,
  SyncOptions,
  SyncScreen,
  type SpeakerFitRates,
} from '../services/syncService';
import type { presetSuggestion } from '../services/syncPresets';

type PresetSuggestion = NonNullable<ReturnType<typeof presetSuggestion>>;
import { AudioSegment } from '../types';
import { JOIN_SETTING_RANGES } from '../server/lib/syncSettings.js';

/**
 * How Sync joins its lines: a preset, and the settings it fills in, one
 * section each in the Sync settings window. Changing any setting
 * makes the preset Custom. The two settings that change the audio itself are
 * marked, and are off in every preset (see server/lib/syncSettings.js).
 */

const sectionLabel = 'text-[10.5px] uppercase tracking-wider font-semibold text-slate-500';

const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`;
const percent = (share: number) => `${Math.round(share * 100)}%`;

const LENGTH_PRESETS = Object.keys(SYNC_JOIN_PRESETS) as Exclude<SyncJoinPreset, 'custom'>[];

/** The length preset `join` matches exactly with `screen`, or Custom. */
export const joinPresetOf = (join: SyncJoinSettings, screen: SyncScreen = 'any'): SyncJoinPreset => {
  const keys = Object.keys(SYNC_JOIN_PRESETS.natural) as (keyof SyncJoinSettings)[];
  const match = LENGTH_PRESETS.find((id) => {
    const preset = syncJoinPreset(id, screen);
    return keys.every((key) => preset[key] === join[key]);
  });
  return match ?? 'custom';
};

const RANGES: Record<string, number[]> = JOIN_SETTING_RANGES;
/** A slider's ends: the range the server holds the setting to. */
const bounds = (key: keyof SyncJoinSettings) => ({ min: RANGES[key][0], max: RANGES[key][1] });

/** Saved join settings, filled in from Natural wherever one is missing or not a usable value. */
export const readJoinSettings = (saved: unknown): SyncJoinSettings => {
  const join: SyncJoinSettings = { ...SYNC_JOIN_PRESETS.natural };
  if (!saved || typeof saved !== 'object') return join;
  const record = saved as Record<string, unknown>;
  (Object.keys(join) as (keyof SyncJoinSettings)[]).forEach((key) => {
    const value = record[key];
    if (typeof join[key] === 'boolean' && typeof value === 'boolean') (join[key] as boolean) = value;
    if (typeof join[key] === 'number' && typeof value === 'number' && Number.isFinite(value)) {
      // The server's own ranges, so a saved value is kept inside the same limits Sync holds it to.
      const range = RANGES[key];
      (join[key] as number) = range ? Math.min(range[1], Math.max(range[0], value)) : value;
    }
  });
  return join;
};

const ChangesAudio = () => (
  <span className="px-1.5 py-px rounded-md bg-amber-500/15 text-amber-300 text-[10.5px] font-medium">Changes audio</span>
);

const UsesAlignment = () => (
  <span
    title="Uses ElevenLabs forced alignment: one request per line, and an ElevenLabs key"
    className="px-1.5 py-px rounded-md bg-indigo-500/15 text-indigo-300 text-[10.5px] font-medium"
  >
    Uses alignment
  </span>
);

type Badge = 'audio' | 'alignment';
const Badges: React.FC<{ badge?: Badge }> = ({ badge }) =>
  badge === 'audio' ? <ChangesAudio /> : badge === 'alignment' ? <UsesAlignment /> : null;

/** Puts one setting back to its default; shown only while it differs. */
const ResetOne: React.FC<{ show: boolean; label: string; onClick: () => void }> = ({ show, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={`Back to the default: ${label}`}
    aria-label={`Back to the default: ${label}`}
    tabIndex={show ? 0 : -1}
    className={`w-6 h-6 shrink-0 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer ${
      show ? '' : 'invisible'
    }`}
  >
    <RotateCcw className="w-3.5 h-3.5" />
  </button>
);

/** A setting's name and what it does, on the left of its row. */
const RowText: React.FC<{ htmlFor: string; label: React.ReactNode; hint?: React.ReactNode; badge?: Badge }> = ({ htmlFor, label, hint, badge }) => (
  <div className="min-w-0">
    <label htmlFor={htmlFor} className="flex flex-wrap items-center gap-1.5 text-[13px] text-slate-200 cursor-pointer">
      {label}
      <Badges badge={badge} />
    </label>
    {hint && <span className="block text-[11.5px] text-slate-400 mt-0.5">{hint}</span>}
  </div>
);

const rowClass = (disabled?: boolean) =>
  `grid gap-x-6 gap-y-2 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(15rem,21rem)] lg:items-center transition-opacity ${disabled ? 'opacity-45' : ''}`;

const Slider: React.FC<{
  id: string;
  label: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  hint?: React.ReactNode;
  disabled?: boolean;
  /** The default, marked on the track; the setting can be put back to it. */
  def?: number;
  badge?: Badge;
  onChange: (value: number) => void;
}> = ({ id, label, value, min, max, step, format, hint, disabled, def, badge, onChange }) => {
  const changed = def !== undefined && value !== def;
  const at = def === undefined ? 0 : Math.min(1, Math.max(0, (def - min) / (max - min || 1)));
  return (
    <div className={rowClass(disabled)}>
      <RowText htmlFor={id} label={label} hint={hint} badge={badge} />
      <div className="flex items-center gap-2.5">
        <span className="relative flex-1 flex items-center">
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full accent-indigo-500 cursor-pointer disabled:cursor-not-allowed"
          />
          {def !== undefined && (
            <span
              aria-hidden="true"
              title={`Default: ${format(def)}`}
              className="absolute -top-1 w-0.5 h-1.5 rounded-full bg-slate-500"
              style={{ left: `calc(${at * 100}% + ${(0.5 - at) * 14}px - 1px)` }}
            />
          )}
        </span>
        <span
          className={`min-w-[4.5rem] h-7 px-1.5 flex items-center justify-center rounded-md border bg-slate-950 tabular-nums text-[12px] ${
            changed ? 'border-amber-400/40 text-amber-200' : 'border-slate-700 text-slate-300'
          }`}
        >
          {format(value)}
        </span>
        <ResetOne show={changed && !disabled} label={def === undefined ? '' : format(def)} onClick={() => def !== undefined && onChange(def)} />
      </div>
    </div>
  );
};

const Toggle: React.FC<{
  label: React.ReactNode;
  hint?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  def?: boolean;
  badge?: Badge;
  onChange: (checked: boolean) => void;
}> = ({ label, hint, checked, disabled, def, badge, onChange }) => {
  const id = useId();
  const changed = def !== undefined && checked !== def;
  return (
    <div className={`flex items-start gap-4 py-3 transition-opacity ${disabled ? 'opacity-45' : ''}`}>
      <div className="flex-1 min-w-0">
        <RowText htmlFor={id} label={label} hint={hint} badge={badge} />
      </div>
      <div className="flex items-center gap-2.5 shrink-0 pt-0.5">
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed ${checked ? 'bg-indigo-500' : 'bg-slate-700'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-slate-100 transition-transform ${checked ? 'translate-x-4' : ''}`} />
        </button>
        <ResetOne show={changed && !disabled} label={def ? 'On' : 'Off'} onClick={() => def !== undefined && onChange(def)} />
      </div>
    </div>
  );
};

/** A setting picked from a short list, laid out as a row like the sliders. */
const SelectRow: React.FC<{
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  badge?: Badge;
  value: string | number;
  disabled?: boolean;
  /** Shown while the value differs from the default, to put it back. */
  reset?: { show: boolean; label: string; onClick: () => void };
  onChange: (value: string) => void;
  children: React.ReactNode;
}> = ({ id, label, hint, badge, value, disabled, reset, onChange, children }) => (
  <div className={rowClass(disabled)}>
    <RowText htmlFor={id} label={label} hint={hint} badge={badge} />
    <div className="flex items-center gap-2.5">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex-1 min-w-0 h-9 bg-slate-950 border border-slate-700 rounded-lg px-2 text-[13px] text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:cursor-not-allowed"
      >
        {children}
      </select>
      <ResetOne show={Boolean(reset?.show) && !disabled} label={reset?.label ?? ''} onClick={() => reset?.onClick()} />
    </div>
  </div>
);

/** A titled group of settings in a section. An advanced group starts folded. */
export const SettingsCard: React.FC<{ title: string; advanced?: boolean; changed?: boolean; children: React.ReactNode }> = ({
  title,
  advanced,
  changed,
  children,
}) =>
  advanced ? (
    <details className="group rounded-xl border border-slate-800 bg-slate-800/20">
      <summary className="flex items-center gap-2 px-4 py-2.5 list-none cursor-pointer text-[12px] font-semibold text-slate-300 hover:text-slate-100 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
        {title}
        <span className="font-normal text-slate-500">· advanced</span>
        {changed && <span title="Changed from the default" className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
      </summary>
      <div className="px-4 border-t border-slate-800 divide-y divide-slate-800/70">{children}</div>
    </details>
  ) : (
    <div className="rounded-xl border border-slate-800 bg-slate-800/20">
      <div className="px-4 py-2.5 border-b border-slate-800 text-[12px] font-semibold text-slate-300">{title}</div>
      <div className="px-4 divide-y divide-slate-800/70">{children}</div>
    </div>
  );

/** What Fit to this video measures from: the cues, and the dub's speaking rate. */
export interface SyncFitSource {
  speakerRates?: SpeakerFitRates;
  segments: AudioSegment[];
  charsPerSecond: number;
  /** True when the rate was measured from this dub (or a sample read of its voice), not a typical one. */
  rateMeasured: boolean;
  /** True when that rate came from a sample read of the voice, not from the dub. */
  rateSample?: boolean;
}

const FIT_LABELS: Partial<Record<keyof SyncJoinSettings, string>> = {
  unitGap: 'Join cues closer than',
  minGap: 'Minimum gap',
  speakerGap: 'Gap at a speaker change',
  gapShare: 'Keep of the original pause',
  shortenPauses: 'Shorten pauses',
  maxPauseTake: 'Most taken from one pause',
  flagJoin: 'Flag joins tighter than',
};

const fitValue = (key: keyof SyncJoinSettings, value: number | boolean) =>
  typeof value === 'boolean' ? (value ? 'On' : 'Off') : key === 'gapShare' || key === 'maxPauseTake' ? percent(value) : ms(value);

/** The join settings each group holds, to mark a group whose settings Fit to this video set. */
const GROUP_KEYS: Record<'gaps' | 'pauses' | 'grouping' | 'review', (keyof SyncJoinSettings)[]> = {
  gaps: ['minGap', 'speakerGap', 'gapShare'],
  pauses: ['shortenPauses', 'maxPauseTake'],
  grouping: ['unitGap'],
  review: ['flagJoin'],
};

/**
 * Fit to this video: measures the speaker's pauses and the dub's length, and
 * lists what it would change, each with its reason. Nothing changes until
 * Apply.
 */
export const FitCard: React.FC<{
  source: SyncFitSource;
  join: SyncJoinSettings;
  disabled?: boolean;
  onApply: (changes: Partial<SyncJoinSettings>) => void;
}> = ({ source, join, disabled, onApply }) => {
  const [fit, setFit] = useState<SyncFit | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    revision.current++; setFit(null); setError(null); setMeasuring(false);
    return () => { revision.current++; };
  }, [source.segments, source.charsPerSecond, source.rateMeasured, source.rateSample, source.speakerRates, join]);

  const measure = async () => {
    const requestRevision = revision.current;
    setMeasuring(true);
    setError(null);
    try {
      const result = await fitJoinSettings({ ...source, join });
      if (revision.current === requestRevision) setFit(result);
    } catch (err) {
      if (revision.current === requestRevision) setError(err instanceof Error ? err.message : "Couldn't measure this video.");
    } finally {
      if (revision.current === requestRevision) setMeasuring(false);
    }
  };

  if (!fit) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Ruler className="w-4 h-4 mt-0.5 shrink-0 text-indigo-300" />
          <span>
            <span className="block text-[13px] font-medium text-slate-200">Fit to this video</span>
            <span className="block text-[11.5px] text-slate-400 mt-0.5">
              Measures the original speaker's pauses and how much longer the dub runs, and sets the gaps, grouping and pauses to match. Nothing changes
              until you apply.
            </span>
          </span>
        </div>
        <button
          type="button"
          onClick={measure}
          disabled={disabled || measuring || source.segments.length === 0}
          className="self-start flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-700 text-[12.5px] text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {measuring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ruler className="w-3.5 h-3.5" />}
          {measuring ? 'Measuring…' : 'Measure the original'}
        </button>
        {error && <span className="text-[11.5px] text-rose-300">{error}</span>}
      </div>
    );
  }

  const { changes, measured, note } = fit;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-200">
          {changes.length === 0 ? 'Nothing to change' : `Measured: ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}`}
        </span>
        <span className="text-[11.5px] text-slate-500 shrink-0">
          {measured.lines} lines · {measured.speakers} {measured.speakers === 1 ? 'speaker' : 'speakers'}
        </span>
      </div>
      {note && <span className="text-[11.5px] text-slate-400">{note}</span>}
      {measured.rateBasis && <span className="text-[11.5px] text-indigo-300">Rate basis: {measured.rateBasis} · {measured.measuredLines ?? 0} lines use previous dub rates · {measured.estimatedLines ?? 0} use a typical rate. Fit remains a duration estimate.</span>}
      {!note && changes.length === 0 && <span className="text-[11.5px] text-slate-400">Your settings already match how this video is spoken.</span>}
      {changes.length > 0 && (
        <ul className="flex flex-col">
          {changes.map((change) => (
            <li key={change.key} className="flex items-start justify-between gap-2 py-1.5 border-t border-slate-800">
              <span className="min-w-0">
                <span className="block text-[12.5px] text-slate-200">{FIT_LABELS[change.key] ?? change.key}</span>
                <span className="block text-[11.5px] text-slate-400">{change.reason}</span>
              </span>
              <span className="shrink-0 tabular-nums text-[12px] text-indigo-300">
                {fitValue(change.key, change.from)} → {fitValue(change.key, change.to)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <span className="text-[11px] text-slate-500">Line edges, breaths and the settings that change the audio stay as they are.</span>
      <div className="flex gap-2">
        {changes.length > 0 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onApply(Object.fromEntries(changes.map((c) => [c.key, c.to])) as Partial<SyncJoinSettings>);
              setFit(null);
            }}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-[12.5px] font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" /> Apply
          </button>
        )}
        <button
          type="button"
          onClick={() => setFit(null)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-700 text-[12.5px] text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" /> {changes.length > 0 ? 'Keep current' : 'Close'}
        </button>
      </div>
    </div>
  );
};

/** The groups of join settings, each a section of the Sync settings window. */
export type SyncJoinSection = 'chunks' | 'gaps' | 'pauses' | 'edges' | 'fit' | 'grouping' | 'review';

export const JOIN_SECTIONS: { id: SyncJoinSection; title: string }[] = [
  { id: 'chunks', title: 'Chunk sync' },
  { id: 'gaps', title: 'Gaps between lines' },
  { id: 'pauses', title: 'Pauses inside a line' },
  { id: 'edges', title: 'Line edges' },
  { id: 'fit', title: "When a line doesn't fit" },
  { id: 'grouping', title: 'Grouping' },
  { id: 'review', title: 'Review' },
];

/** The join settings each section holds, to mark a section changed from the default. */
const SECTION_KEYS: Record<SyncJoinSection, (keyof SyncJoinSettings)[]> = {
  chunks: ['chunkSync', 'speedFit', 'maxVoiceSpeed', 'gateOpenDb', 'gateHysteresisDb', 'minSliceLength', 'minSilenceLength', 'leadPad', 'trailPad', 'chunkGapShare', 'wordGap', 'commaGap', 'stopGap', 'maxChunkGap', 'punctuationPriority'],
  gaps: ['preserveLongPauses', 'protectedPause', 'minGap', 'speakerGap', 'gapShare', 'breathClear', 'removeBreaths', 'breathReduction'],
  pauses: ['matchSourcePauses', 'unmatchedPause', 'shortenPauses', 'minInnerPause', 'maxPauseTake', 'tightenSilences', 'tightMinPause', 'tightMargin', 'checkCutWords', 'spliceCrossfade'],
  edges: ['tailFloorDb', 'tailHold', 'edgeFade'],
  fit: ['maxLateStart', 'anchorWeight', 'endByVideo', 'endSlack'],
  grouping: ['unitGap', 'maxUnit'],
  review: ['flagJoin'],
};

/** A section's settings in one line, for the section list and the closed rail. */
export const joinSectionSummary = (section: SyncJoinSection, options: SyncOptions): string => {
  const { join } = options;
  switch (section) {
    case 'chunks':
      return join.chunkSync
        ? `Split below ${join.gateOpenDb} dB · pauses to ${percent(join.chunkGapShare)}${join.punctuationPriority ? ' · words, then commas, then sentence ends' : ''}${join.speedFit ? ` · long lines read up to ${join.maxVoiceSpeed.toFixed(2)}×` : ''}`
        : 'Off: each line is placed whole';
    case 'gaps':
      return `${ms(join.minGap)} at least · ${ms(join.speakerGap)} at a new speaker`;
    case 'pauses':
      return [
        join.matchSourcePauses && `Only where the original pauses`,
        join.shortenPauses ? `${join.matchSourcePauses ? 's' : 'S'}hortened to ${ms(join.minInnerPause)} at least when long` : !join.matchSourcePauses && 'Never shortened',
        join.tightenSilences && 'silences tightened when still long',
      ].filter(Boolean).join(' · ');
    case 'edges':
      return `Tail to ${join.tailFloorDb} dB, held ${ms(join.tailHold)}`;
    case 'fit':
      return [
        `${options.timingProtection === 'strict' ? 'Strict' : 'Flagged'} when it starts over ${ms(join.maxLateStart)} late`,
        join.endByVideo && 'ends with the original',
      ].filter(Boolean).join(' · ');
    case 'grouping':
      return `Cues under ${ms(join.unitGap)} apart are one line, usually up to ${join.maxUnit} s`;
    case 'review':
      return `Flags joins under ${ms(join.flagJoin)}`;
  }
};

/** True while a section still holds a value Fit to this video set. */
export const joinSectionMeasured = (section: SyncJoinSection, fitted: Partial<SyncJoinSettings>, join: SyncJoinSettings) =>
  section in GROUP_KEYS && GROUP_KEYS[section as keyof typeof GROUP_KEYS].some((key) => key in fitted && fitted[key] === join[key]);

/** How many of a section's settings differ from Natural, the default. */
export const joinSectionChangedCount = (section: SyncJoinSection, options: SyncOptions) =>
  SECTION_KEYS[section].filter((key) => options.join[key] !== SYNC_JOIN_PRESETS.natural[key]).length +
  (section === 'fit' && options.timingProtection === 'strict' ? 1 : 0);

/** A section's settings put back to Natural, the default; the others stay as they are. */
export const resetJoinSection = (section: SyncJoinSection, options: SyncOptions): SyncOptions => {
  const join = { ...options.join };
  SECTION_KEYS[section].forEach((key) => {
    (join as Record<string, unknown>)[key] = SYNC_JOIN_PRESETS.natural[key];
  });
  return {
    ...options,
    join,
    preset: joinPresetOf(join, options.screen),
    ...(section === 'fit' ? { timingProtection: 'warn' as const } : {}),
  };
};

/** What each section is for, under its title, and the words a search of the window finds it by. */
export const JOIN_SECTION_INFO: Record<SyncJoinSection, { description: string; terms: string }> = {
  chunks: {
    description: "Splits each dub line where it goes quiet and places every chunk on the original's words. The voice is never stretched.",
    terms: 'chunks split word timing alignment read faster fastest speed pauses comma sentence threshold hysteresis slice silence pad reaper samanvaya',
  },
  gaps: {
    description: 'The silence between one line and the next, long pauses that stay clear, and what happens to breaths there.',
    terms: 'minimum gap speaker change original pause protect long pauses breaths breath reduction',
  },
  pauses: {
    description: 'Pauses the original never made are cut, and when a line runs long its silence is taken out. Words are never cut.',
    terms: 'pause original shorten shortest kept tighten silences room tone around words cut word timing alignment splice crossfade',
  },
  edges: {
    description: 'Where a line counts as finished, so the next one can start, and a fade for a line that stops abruptly.',
    terms: 'tail decay hold fade abrupt edge',
  },
  fit: {
    description: 'What Sync does with a line too long for its time, and how late it may start before it is flagged or held.',
    terms: 'late start latest strict warn timing protection locked',
  },
  grouping: {
    description: 'Close cues by the same speaker are voiced as one line, so the voice flows across them.',
    terms: 'join cues group longest joined line unit',
  },
  review: {
    description: 'What is listed under Worth a listen after a sync.',
    terms: 'flag joins tight review',
  },
};

/** A length preset with what is on screen, as one choice: its join settings and the options it sets with them. */
export const applyJoinPreset = (o: SyncOptions, preset: SyncJoinPreset, screen: SyncScreen): SyncOptions =>
  preset === 'custom' ? { ...o, preset, screen } : { ...o, preset, screen, join: syncJoinPreset(preset, screen), ...presetExtras(preset, screen) };

/** A length preset's name, without "(recommended)". */
export const presetName = (preset: SyncJoinPreset) => (SYNC_JOIN_PRESET_OPTIONS.find((p) => p.id === preset)?.label ?? 'Custom').replace(' (recommended)', '');

/** "25% longer", "8% shorter", "about as long". */
export const describeChange = (change: number) =>
  Math.abs(change) < 0.01 ? 'about as long' : `${Math.round(Math.abs(change) * 100)}% ${change > 0 ? 'longer' : 'shorter'}`;

/** A preset's name with what is on screen: "Long dub · Narration". */
export const joinPresetLabel = (options: Pick<SyncOptions, 'preset' | 'screen'>) =>
  [
    (SYNC_JOIN_PRESET_OPTIONS.find((p) => p.id === options.preset)?.label ?? 'Custom').replace(' (recommended)', ''),
    options.screen && options.screen !== 'any' && SYNC_SCREEN_OPTIONS.find((s) => s.id === options.screen)?.label,
  ]
    .filter(Boolean)
    .join(' · ');

/** What a preset sets, in words, for the table under the picker. */
const presetRows = (join: SyncJoinSettings, options: SyncOptions): [string, string][] => [
  ['Shrink a pause to', join.chunkGapShare >= 1 ? 'Kept as voiced' : percent(join.chunkGapShare)],
  ['Shortest pause · word / comma / sentence end', `${Math.round(join.wordGap * 1000)} / ${Math.round(join.commaGap * 1000)} / ${ms(join.stopGap)}`],
  ['Longest a chunk need wait', `${join.maxChunkGap} s`],
  ['Read a long line faster', join.speedFit ? `Up to ${join.maxVoiceSpeed.toFixed(2)}×` : 'Off'],
  ['The dub ends with the original', join.endByVideo ? `Yes, within ${join.endSlack} s` : 'No'],
  ['Every paragraph starts on time', join.preserveLongPauses ? `After pauses over ${join.protectedPause} s` : 'No'],
  ['Lines after a long pause or a new speaker', join.anchorWeight > 3 ? 'Pull hard to start on time' : 'Pull a little harder'],
  ['A line starting late', options.timingProtection === 'strict' ? `Held within ${ms(join.maxLateStart)} (Strict)` : `Flagged past ${ms(join.maxLateStart)}`],
  ['Wordings suggested', [options.suggest && 'shorter', options.suggestLonger && 'fuller'].filter(Boolean).join(' and ') || 'None'],
];

/** One row of choices, as Basics lays its pickers out. */
const ChoiceRow: React.FC<{
  label: string;
  choices: { id: string; label: string; sub: string; hint: string }[];
  value: string;
  /** The choice the last sync suggests, marked under its name. */
  suggested?: string;
  disabled?: boolean;
  onPick: (id: string) => void;
}> = ({ label, choices, value, suggested, disabled, onPick }) => (
  <div role="radiogroup" aria-label={label} className="grid gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
    {choices.map((choice) => {
      const on = value === choice.id;
      return (
        <button
          key={choice.id}
          type="button"
          role="radio"
          aria-checked={on}
          disabled={disabled}
          title={choice.hint || undefined}
          onClick={() => onPick(choice.id)}
          className={`rounded-lg px-2 py-2 text-center transition-colors cursor-pointer disabled:cursor-not-allowed ${
            on ? 'bg-slate-800 text-slate-100 ring-1 ring-slate-600' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
          }`}
        >
          <span className="block text-[12.5px] font-medium">{choice.label.replace(' (recommended)', '')}</span>
          {choice.id === suggested ? (
            <span className="block text-[11px] text-emerald-300 truncate">suits this dub</span>
          ) : (
            <span className="block text-[11px] text-slate-500 truncate">{choice.id === 'natural' ? 'about even · recommended' : choice.sub}</span>
          )}
        </button>
      );
    })}
  </div>
);

/**
 * The line-join presets: one by how long the dub runs against the original,
 * and on top of it, what is on screen. Picking either fills in every join
 * setting; changing any setting makes it Custom.
 */
export const JoinPresetPicker: React.FC<{
  options: SyncOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<SyncOptions>>;
  disabled?: boolean;
  /** Lists only the sections changed from the default, from the note under Custom. */
  onShowChanged?: () => void;
  /** The length preset the last sync suits, and how much longer (+) or shorter its dub ran. */
  suggestion?: PresetSuggestion | null;
}> = ({ options, onOptionsChange, disabled, onShowChanged, suggestion }) => {
  const screen = options.screen ?? 'any';
  const pickLength = (preset: string) => onOptionsChange((o) => applyJoinPreset(o, preset as SyncJoinPreset, o.screen ?? 'any'));
  const pickScreen = (next: string) =>
    onOptionsChange((o) => (o.preset === 'custom' ? { ...o, screen: next as SyncScreen } : applyJoinPreset(o, o.preset, next as SyncScreen)));
  const hint = [SYNC_JOIN_PRESET_OPTIONS.find((p) => p.id === options.preset)?.hint, SYNC_SCREEN_OPTIONS.find((s) => s.id === screen)?.hint].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1.5">
        <span className="text-[11.5px] text-slate-400">By how long the dub runs</span>
        <ChoiceRow
          label="Line joins by the dub's length"
          choices={SYNC_JOIN_PRESET_OPTIONS}
          value={options.preset}
          suggested={suggestion?.preset}
          disabled={disabled}
          onPick={pickLength}
        />
      </div>
      {suggestion && suggestion.preset !== options.preset && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-amber-400/35 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100">
          <Ruler className="w-3.5 h-3.5 text-amber-300 shrink-0" />
          <span>
            In the last sync the dub ran {describeChange(suggestion.change)} than the original.{' '}
            <span className="font-semibold">{presetName(suggestion.preset)}</span> suits it better.
          </span>
          <span className="flex-1" />
          <button
            type="button"
            disabled={disabled}
            onClick={() => pickLength(suggestion.preset)}
            className="shrink-0 h-7 px-3 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Use {presetName(suggestion.preset)}
          </button>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11.5px] text-slate-400">
          By what is on screen <span className="text-slate-500">· adds to the length preset</span>
        </span>
        <ChoiceRow label="Line joins by what is on screen" choices={SYNC_SCREEN_OPTIONS} value={screen} disabled={disabled} onPick={pickScreen} />
      </div>
      {hint && (
        <span className="text-[11.5px] text-slate-400">
          {hint}
          {options.preset === 'custom' && onShowChanged && (
            <>
              {' '}
              <button type="button" onClick={onShowChanged} className="text-indigo-300 hover:text-indigo-200 underline underline-offset-2 cursor-pointer">
                Show what changed
              </button>
            </>
          )}
        </span>
      )}
      <details className="rounded-lg border border-slate-800 bg-slate-950/40">
        <summary className="px-3 py-2 text-[12px] text-slate-300 cursor-pointer select-none">
          What <span className="font-semibold text-slate-100">{joinPresetLabel(options)}</span> sets
        </summary>
        <table className="w-full text-[12px]">
          <tbody>
            {presetRows(options.join, options).map(([what, value]) => (
              <tr key={what} className="border-t border-slate-800/80">
                <td className="px-3 py-1.5 text-slate-400">{what}</td>
                <td className="px-3 py-1.5 text-right text-slate-100">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
};

/** One on/off setting, laid out as the join sections lay theirs out. */
export const SettingToggle = Toggle;

/** The settings of one join section, in titled groups. Changing any of them makes the preset Custom. */
export const SyncJoinSectionControls: React.FC<{
  section: SyncJoinSection;
  options: SyncOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<SyncOptions>>;
  disabled?: boolean;
}> = ({ section, options, onOptionsChange, disabled }) => {
  const { join } = options;
  const D = SYNC_JOIN_PRESETS.natural;
  const strict = options.timingProtection === 'strict';
  const set = <K extends keyof SyncJoinSettings>(key: K, value: SyncJoinSettings[K]) =>
    onOptionsChange((o) => {
      const next = { ...o.join, [key]: value };
      return { ...o, join: next, preset: joinPresetOf(next, o.screen) };
    });
  const changed = (...keys: (keyof SyncJoinSettings)[]) => keys.some((key) => join[key] !== D[key]);

  const db = (value: number) => `${Math.round(value)} dB`;
  const chunksOff = disabled || !join.chunkSync;
  const wrap = (children: React.ReactNode) => <div className="flex flex-col gap-3">{children}</div>;

  switch (section) {
    case 'chunks':
      return wrap(
        <>
          <SettingsCard title="Chunks">
            <Toggle
              label="Place each line as chunks"
              hint="Splits each dub line where it goes quiet, as REAPER's Dynamic split does, and places every chunk on the original's words, as Samanvaya does. The voice is never stretched; only silence between chunks is left out. Off: each line is placed whole."
              checked={join.chunkSync}
              disabled={disabled}
              def={D.chunkSync}
              onChange={(v) => set('chunkSync', v)}
            />
            <Toggle
              label="Check splits against word timing"
              hint="Times each line's words with ElevenLabs forced alignment, one request per line, so no split falls inside a word. A line whose words can't be timed is placed whole."
              checked={join.checkCutWords}
              disabled={chunksOff}
              def={D.checkCutWords}
              badge="alignment"
              onChange={(v) => set('checkCutWords', v)}
            />
          </SettingsCard>
          <SettingsCard title="A line that still runs long">
            <Toggle
              label="Read a line that still runs long faster"
              hint="When a line has more words than time even with every pause shrunk, it is voiced again with the voice's own speed raised just enough to fit. The voice reads faster; the audio is never stretched. Only those lines are voiced again. Eleven v3 and v4 ignore the speed setting, so their lines are not voiced again."
              checked={join.speedFit}
              disabled={chunksOff}
              def={D.speedFit}
              onChange={(v) => set('speedFit', v)}
            />
            <Slider id="sync-max-voice-speed" label="Fastest read" value={join.maxVoiceSpeed} {...bounds('maxVoiceSpeed')} step={0.01}
              format={(v) => `${v.toFixed(2)}×`} disabled={chunksOff || !join.speedFit} def={D.maxVoiceSpeed}
              onChange={(v) => set('maxVoiceSpeed', v)} hint="Of the voice's own speed. Past about 1.15× a read starts to sound hurried." />
          </SettingsCard>
          <SettingsCard title="Pauses between chunks">
            <Slider id="sync-chunk-share" label="Shrink a pause to" value={join.chunkGapShare} {...bounds('chunkGapShare')} step={0.05} format={percent} disabled={chunksOff}
              def={D.chunkGapShare} onChange={(v) => set('chunkGapShare', v)} hint="Of what the voice left, at least. A pause also grows where the original pauses longer." />
            <Toggle
              label="Shrink in punctuation order"
              hint="Pauses between words first, then at commas, and a sentence end's only when the line still doesn't fit."
              checked={join.punctuationPriority}
              disabled={chunksOff}
              def={D.punctuationPriority}
              onChange={(v) => set('punctuationPriority', v)}
            />
            <Slider id="sync-word-gap" label="Shortest pause between words" value={join.wordGap} {...bounds('wordGap')} step={0.01} format={ms} disabled={chunksOff}
              def={D.wordGap} onChange={(v) => set('wordGap', v)} />
            <Slider id="sync-comma-gap" label="Shortest pause at a comma" value={join.commaGap} {...bounds('commaGap')} step={0.01} format={ms} disabled={chunksOff}
              def={D.commaGap} onChange={(v) => set('commaGap', v)} />
            <Slider id="sync-stop-gap" label="Shortest pause at a sentence end" value={join.stopGap} {...bounds('stopGap')} step={0.01} format={ms} disabled={chunksOff}
              def={D.stopGap} onChange={(v) => set('stopGap', v)} />
            <Slider id="sync-max-chunk-gap" label="Longest a chunk need wait" value={join.maxChunkGap} {...bounds('maxChunkGap')} step={0.05} format={ms} disabled={chunksOff}
              def={D.maxChunkGap} onChange={(v) => set('maxChunkGap', v)} />
          </SettingsCard>
          <SettingsCard title="Split, as REAPER Dynamic split" advanced changed={changed('gateOpenDb', 'gateHysteresisDb', 'minSliceLength', 'minSilenceLength', 'leadPad', 'trailPad')}>
            <Slider id="sync-gate-open" label="Threshold" value={join.gateOpenDb} {...bounds('gateOpenDb')} step={1} format={db} disabled={chunksOff}
              def={D.gateOpenDb} onChange={(v) => set('gateOpenDb', v)} hint="A chunk starts when the voice rises above this." />
            <Slider id="sync-gate-hysteresis" label="Hysteresis" value={join.gateHysteresisDb} {...bounds('gateHysteresisDb')} step={1} format={db} disabled={chunksOff}
              def={D.gateHysteresisDb} onChange={(v) => set('gateHysteresisDb', v)} hint={`It ends only when the voice falls below ${Math.round(join.gateOpenDb + join.gateHysteresisDb)} dB, so a word's dying sound stays in.`} />
            <Slider id="sync-min-slice" label="Min slice length" value={join.minSliceLength} {...bounds('minSliceLength')} step={0.01} format={ms} disabled={chunksOff}
              def={D.minSliceLength} onChange={(v) => set('minSliceLength', v)} />
            <Slider id="sync-min-silence" label="Min silence length" value={join.minSilenceLength} {...bounds('minSilenceLength')} step={0.01} format={ms} disabled={chunksOff}
              def={D.minSilenceLength} onChange={(v) => set('minSilenceLength', v)} hint="A shorter silence doesn't split." />
            <Slider id="sync-lead-pad" label="Leading pad" value={join.leadPad} {...bounds('leadPad')} step={0.005} format={ms} disabled={chunksOff}
              def={D.leadPad} onChange={(v) => set('leadPad', v)} />
            <Slider id="sync-trail-pad" label="Trailing pad" value={join.trailPad} {...bounds('trailPad')} step={0.005} format={ms} disabled={chunksOff}
              def={D.trailPad} onChange={(v) => set('trailPad', v)} />
          </SettingsCard>
        </>
      );
    case 'gaps':
      return wrap(
        <>
          <SettingsCard title="Gaps">
            <Slider id="sync-min-gap" label="Minimum gap" value={join.minGap} {...bounds('minGap')} step={0.01} format={ms} disabled={disabled}
              def={D.minGap} onChange={(v) => set('minGap', v)}
              hint="The least silence between one line's tail and the next line, however little the original speaker paused." />
            <Slider id="sync-speaker-gap" label="Gap at a speaker change" value={join.speakerGap} {...bounds('speakerGap')} step={0.01} format={ms} disabled={disabled}
              def={D.speakerGap} onChange={(v) => set('speakerGap', v)} />
            <Slider id="sync-gap-share" label="Keep of the original pause" value={join.gapShare} {...bounds('gapShare')} step={0.05} format={percent} disabled={disabled}
              def={D.gapShare} onChange={(v) => set('gapShare', v)}
              hint="Up to 0.6 s. A longer original pause lends the rest of its time to a line that runs long." />
          </SettingsCard>
          <SettingsCard title="Long pauses">
            <Toggle label="Protect long pauses" checked={join.preserveLongPauses} disabled={disabled} def={D.preserveLongPauses}
              onChange={(v) => set('preserveLongPauses', v)} hint="Keeps long breaks between source lines clear and preserves long silence inside the dub. A line too long to finish before a protected break is flagged in the results." />
            <Slider id="sync-protected-pause" label="Protect pauses at least" value={join.protectedPause} {...bounds('protectedPause')} step={0.1}
              format={(v) => `${v.toFixed(1)} s`} disabled={disabled || !join.preserveLongPauses} def={D.protectedPause} onChange={(v) => set('protectedPause', v)}
              hint="Protects breaks by duration. It does not detect scene cuts in the video." />
          </SettingsCard>
          <SettingsCard title="Breaths">
            <Toggle
              label="Keep breaths clear"
              hint="A breath before a line's first word never plays over the end of the line before."
              checked={join.breathClear}
              disabled={disabled}
              def={D.breathClear}
              onChange={(v) => set('breathClear', v)}
            />
            <Toggle
              label="Reduce or remove breaths"
              hint="Reduces detected breaths before, between and after words. Use 100% to silence them."
              checked={join.removeBreaths}
              disabled={disabled}
              def={D.removeBreaths}
              badge="audio"
              onChange={(v) => set('removeBreaths', v)}
            />
            <Slider id="sync-breath-reduction" label="Breath reduction" value={join.breathReduction} {...bounds('breathReduction')} step={0.05} format={percent}
              disabled={disabled || !join.removeBreaths} def={D.breathReduction} onChange={(v) => set('breathReduction', v)} hint="0% keeps breaths; 100% removes detected breaths. Lower values keep a softer breath." />
          </SettingsCard>
        </>
      );
    case 'pauses':
      return wrap(
        <>
          {join.chunkSync && (
            <p className="text-[12px] text-indigo-200 rounded-lg bg-indigo-500/10 border border-indigo-500/25 px-3 py-2">
              Chunk sync is on: pauses are shrunk between chunks instead (see Chunk sync). These apply when it is off.
            </p>
          )}
          <SettingsCard title="Match the original">
            <Toggle
              label="Pause only where the original pauses"
              hint="A pause the original speaker never made is cut down to a word gap, even when the line fits. Needs the original's word timestamps."
              checked={join.matchSourcePauses}
              disabled={disabled}
              def={D.matchSourcePauses}
              onChange={(v) => set('matchSourcePauses', v)}
            />
            <Slider id="sync-unmatched-pause" label="Cut such a pause to" value={join.unmatchedPause} {...bounds('unmatchedPause')} step={0.01} format={ms}
              disabled={disabled || !join.matchSourcePauses} def={D.unmatchedPause} onChange={(v) => set('unmatchedPause', v)} />
          </SettingsCard>
          <SettingsCard title="When a line runs long">
            <Toggle
              label="Shorten pauses when a line runs long"
              hint="Only silence between words is taken out."
              checked={join.shortenPauses}
              disabled={disabled}
              def={D.shortenPauses}
              onChange={(v) => set('shortenPauses', v)}
            />
            <Slider id="sync-min-inner-pause" label="Shortest pause kept" value={join.minInnerPause} {...bounds('minInnerPause')} step={0.01} format={ms}
              disabled={disabled || !join.shortenPauses} def={D.minInnerPause} onChange={(v) => set('minInnerPause', v)} />
            <Slider id="sync-max-pause-take" label="Most taken from one pause" value={join.maxPauseTake} {...bounds('maxPauseTake')} step={0.05} format={percent}
              disabled={disabled || !join.shortenPauses} def={D.maxPauseTake} onChange={(v) => set('maxPauseTake', v)} />
          </SettingsCard>
          <SettingsCard title="Tighten silences">
            <Toggle
              label="Tighten silences when a line still runs long"
              hint="Measures each line's own room tone, then takes silence from its end and from its pauses, longest first, until it fits. Words are never cut."
              checked={join.tightenSilences}
              disabled={disabled}
              def={D.tightenSilences}
              onChange={(v) => set('tightenSilences', v)}
            />
            <Slider id="sync-tight-min-pause" label="Shortest pause left" value={join.tightMinPause} {...bounds('tightMinPause')} step={0.01} format={ms}
              disabled={disabled || !join.tightenSilences} def={D.tightMinPause} onChange={(v) => set('tightMinPause', v)} />
            <Slider id="sync-tight-margin" label="Silence kept around words" value={join.tightMargin} {...bounds('tightMargin')} step={0.01} format={ms}
              disabled={disabled || !join.tightenSilences} def={D.tightMargin} onChange={(v) => set('tightMargin', v)}
              hint="Left before and after every sound, so a word's start and its dying sound stay whole." />
            <Toggle
              label="Check cuts against word timing"
              hint="Times the words of each line it tightens with ElevenLabs forced alignment, and keeps every cut clear of them. One request per tightened line; a line whose words can't be timed is left as it is."
              checked={join.checkCutWords}
              disabled={disabled || !join.tightenSilences}
              def={D.checkCutWords}
              badge="alignment"
              onChange={(v) => set('checkCutWords', v)}
            />
          </SettingsCard>
          <SettingsCard title="Splices">
            <Slider id="sync-splice-crossfade" label="Splice crossfade" badge="audio" value={join.spliceCrossfade} {...bounds('spliceCrossfade')} step={0.001}
              format={(v) => (v === 0 ? 'Off' : ms(v))} disabled={disabled || (!join.shortenPauses && !join.matchSourcePauses)} def={D.spliceCrossfade}
              onChange={(v) => set('spliceCrossfade', v)} hint="Smooths room tone where a pause is shortened. Off keeps every sample as voiced." />
          </SettingsCard>
        </>
      );
    case 'edges':
      return wrap(
        <SettingsCard title="Where a line ends">
          <SelectRow
            id="sync-tail-floor"
            label="Tail ends below"
            value={join.tailFloorDb}
            disabled={disabled}
            reset={{ show: join.tailFloorDb !== D.tailFloorDb, label: `${D.tailFloorDb} dB`, onClick: () => set('tailFloorDb', D.tailFloorDb) }}
            onChange={(v) => set('tailFloorDb', Number(v))}
          >
            {![-60, -70, -80].includes(join.tailFloorDb) && <option value={join.tailFloorDb}>{join.tailFloorDb} dB, custom</option>}
            <option value={-60} className="bg-slate-900">-60 dB, shortest tail</option>
            <option value={-70} className="bg-slate-900">-70 dB, keeps the full decay</option>
            <option value={-80} className="bg-slate-900">-80 dB, longest tail</option>
          </SelectRow>
          <Slider id="sync-tail-hold" label="Tail hold" value={join.tailHold} {...bounds('tailHold')} step={0.005} format={ms} disabled={disabled}
            def={D.tailHold} onChange={(v) => set('tailHold', v)} hint="Extra silence kept after the last word before the line counts as finished." />
          <SelectRow
            id="sync-edge-fade"
            label="Fade for a line that stops abruptly"
            badge="audio"
            value={join.edgeFade}
            disabled={disabled}
            reset={{ show: join.edgeFade !== D.edgeFade, label: D.edgeFade === 0 ? 'Off' : ms(D.edgeFade), onClick: () => set('edgeFade', D.edgeFade) }}
            onChange={(v) => set('edgeFade', Number(v))}
          >
            {![0, 0.01, 0.02].includes(join.edgeFade) && <option value={join.edgeFade}>{ms(join.edgeFade)}, custom</option>}
            <option value={0} className="bg-slate-900">Off, 3 ms micro-fade only where needed</option>
            <option value={0.01} className="bg-slate-900">10 ms</option>
            <option value={0.02} className="bg-slate-900">20 ms</option>
          </SelectRow>
        </SettingsCard>
      );
    case 'fit':
      return wrap(
        <>
          <SettingsCard title="What Sync tries, in order">
            <ol className="flex flex-col gap-1.5 py-3 text-[12.5px] text-slate-300">
              {['Shorten the pauses inside it, then tighten its silences', 'Move the lines around it, never over each other', 'Flag it with a shorter wording, never squeeze it'].map(
                (step, n) => (
                  <li key={step} className="flex items-center gap-2.5">
                    <span className="w-5 h-5 shrink-0 rounded-full bg-indigo-500/20 text-indigo-300 text-[10.5px] flex items-center justify-center">{n + 1}</span>
                    {step}
                  </li>
                )
              )}
            </ol>
          </SettingsCard>
          <SettingsCard title="Late starts">
            <Slider id="sync-max-late" label="Latest a line may start" value={join.maxLateStart} {...bounds('maxLateStart')} step={0.01} format={ms} disabled={disabled}
              def={D.maxLateStart} onChange={(v) => set('maxLateStart', v)}
              hint={strict ? 'Strict keeps every line within this of its original line.' : 'A line pushed later than this after its original line is listed for review.'} />
            <SelectRow
              id="sync-timing-protection"
              label="Timing protection"
              hint="With Strict, a line that still can't fit is placed as early as it can go and flagged, never left out. Locked lines keep their place unless the lines before them need the room, and are flagged when they move."
              value={strict ? 'strict' : 'warn'}
              disabled={disabled}
              reset={{ show: strict, label: 'Warn', onClick: () => onOptionsChange((o) => ({ ...o, timingProtection: 'warn' })) }}
              // Not a line-join setting: changing it keeps the preset.
              onChange={(v) => onOptionsChange((o) => ({ ...o, timingProtection: v === 'strict' ? 'strict' : 'warn' }))}
            >
              <option value="warn" className="bg-slate-900">Warn: list lines that start later than this</option>
              <option value="strict" className="bg-slate-900">Strict: keep every line within this</option>
            </SelectRow>
          </SettingsCard>
          <SettingsCard title="Anchors and the end">
            <Slider id="sync-anchor-weight" label="Lines that must start on time" value={join.anchorWeight} {...bounds('anchorWeight')} step={1}
              format={(v) => `${v}× pull`} disabled={disabled} def={D.anchorWeight} onChange={(v) => set('anchorWeight', v)}
              hint="How much harder a line after a long pause, or by a new speaker, pulls to start with its original. The lines around it take up the difference." />
            <Toggle
              label="The dub ends with the original"
              hint="The last line ends by the original's end, so a long dub's extra time is shared across every line instead of piling up at the end. If it still can't, the last line is flagged."
              checked={join.endByVideo}
              disabled={disabled}
              def={D.endByVideo}
              onChange={(v) => set('endByVideo', v)}
            />
            <Slider id="sync-end-slack" label="May run past the end by" value={join.endSlack} {...bounds('endSlack')} step={0.1}
              format={(v) => `${v.toFixed(1)} s`} disabled={disabled || !join.endByVideo} def={D.endSlack} onChange={(v) => set('endSlack', v)} />
          </SettingsCard>
        </>
      );
    case 'grouping':
      return wrap(
        <SettingsCard title="Joining cues">
          <Slider id="sync-unit-gap" label="Join cues closer than" value={join.unitGap} {...bounds('unitGap')} step={0.05} format={ms} disabled={disabled}
            def={D.unitGap} onChange={(v) => set('unitGap', v)} hint="Cues this close, by the same speaker, are voiced as one line so the voice flows across them." />
          <Slider id="sync-max-unit" label="Longest joined line" value={join.maxUnit} {...bounds('maxUnit')} step={1} format={(v) => `${v} s`} disabled={disabled}
            def={D.maxUnit} onChange={(v) => set('maxUnit', v)} hint="An unfinished sentence may stay together for up to 30 s, even past this limit." />
        </SettingsCard>
      );
    case 'review':
      return wrap(
        <SettingsCard title="Flags">
          <Slider id="sync-flag-join" label="Flag joins tighter than" value={join.flagJoin} {...bounds('flagJoin')} step={0.01} format={(v) => (v === 0 ? 'Off' : ms(v))}
            disabled={disabled} def={D.flagJoin} onChange={(v) => set('flagJoin', v)} hint="Silence between one line's last word and the next line's first." />
        </SettingsCard>
      );
  }
};
