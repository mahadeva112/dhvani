import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Ruler, X } from 'lucide-react';
import {
  fitJoinSettings,
  SYNC_JOIN_PRESETS,
  SYNC_JOIN_PRESET_OPTIONS,
  SyncFit,
  SyncJoinPreset,
  SyncJoinSettings,
  SyncOptions,
  type SpeakerFitRates,
} from '../services/syncService';
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

/** The preset `join` matches exactly, or Custom. */
export const joinPresetOf = (join: SyncJoinSettings): SyncJoinPreset => {
  const keys = Object.keys(SYNC_JOIN_PRESETS.natural) as (keyof SyncJoinSettings)[];
  const match = (Object.keys(SYNC_JOIN_PRESETS) as Exclude<SyncJoinPreset, 'custom'>[]).find((id) =>
    keys.every((key) => SYNC_JOIN_PRESETS[id][key] === join[key])
  );
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
  <span className="ml-1.5 px-1.5 py-px rounded-md bg-amber-500/15 text-amber-300 text-[10.5px] font-medium align-middle">Changes audio</span>
);

const Slider: React.FC<{
  id: string;
  label: React.ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}> = ({ id, label, value, min, max, step, format, hint, disabled, onChange }) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-[13px] text-slate-200">
      <span>{label}</span>
      <span className="tabular-nums text-indigo-300 text-[12.5px]">{format(value)}</span>
    </label>
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
    {hint && <span className="text-[11.5px] text-slate-400">{hint}</span>}
  </div>
);

const Toggle: React.FC<{ label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }> = ({
  label,
  hint,
  checked,
  disabled,
  onChange,
}) => (
  <label className="flex items-start gap-2.5 cursor-pointer">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-indigo-500" />
    <span>
      <span className="block text-[13px] text-slate-200">{label}</span>
      {hint && <span className="block text-[11.5px] text-slate-400 mt-0.5">{hint}</span>}
    </span>
  </label>
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
  fit: ['maxLateStart'],
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
      return `${options.timingProtection === 'strict' ? 'Strict' : 'Flagged'} when it starts over ${ms(join.maxLateStart)} late`;
    case 'grouping':
      return `Cues under ${ms(join.unitGap)} apart are one line, usually up to ${join.maxUnit} s`;
    case 'review':
      return `Flags joins under ${ms(join.flagJoin)}`;
  }
};

/** True when a section's settings differ from Natural, the default. */
export const joinSectionChanged = (section: SyncJoinSection, options: SyncOptions) =>
  SECTION_KEYS[section].some((key) => options.join[key] !== SYNC_JOIN_PRESETS.natural[key]) ||
  (section === 'fit' && options.timingProtection === 'strict');

/** True while a section still holds a value Fit to this video set. */
export const joinSectionMeasured = (section: SyncJoinSection, fitted: Partial<SyncJoinSettings>, join: SyncJoinSettings) =>
  section in GROUP_KEYS && GROUP_KEYS[section as keyof typeof GROUP_KEYS].some((key) => key in fitted && fitted[key] === join[key]);

/** The line-join preset: picking one fills in every join setting; changing any setting makes it Custom. */
export const JoinPresetPicker: React.FC<{
  options: SyncOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<SyncOptions>>;
  disabled?: boolean;
}> = ({ options, onOptionsChange, disabled }) => {
  const pickPreset = (preset: SyncJoinPreset) =>
    onOptionsChange((o) => (preset === 'custom' ? { ...o, preset } : { ...o, preset, join: { ...SYNC_JOIN_PRESETS[preset] } }));
  const hint = SYNC_JOIN_PRESET_OPTIONS.find((p) => p.id === options.preset)?.hint;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="sync-join-preset" className={sectionLabel}>
        Line joins
      </label>
      <select
        id="sync-join-preset"
        value={options.preset}
        onChange={(e) => pickPreset(e.target.value as SyncJoinPreset)}
        disabled={disabled}
        className="h-9 bg-slate-950 border border-slate-800 rounded-lg px-2 text-[13px] text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:cursor-not-allowed"
      >
        {SYNC_JOIN_PRESET_OPTIONS.map((p) => (
          <option key={p.id} value={p.id} className="bg-slate-900">
            {p.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-[11.5px] text-slate-400">{hint}</span>}
    </div>
  );
};

/** The settings of one join section. Changing any of them makes the preset Custom. */
export const SyncJoinSectionControls: React.FC<{
  section: SyncJoinSection;
  options: SyncOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<SyncOptions>>;
  disabled?: boolean;
}> = ({ section, options, onOptionsChange, disabled }) => {
  const { join } = options;
  const strict = options.timingProtection === 'strict';
  const set = <K extends keyof SyncJoinSettings>(key: K, value: SyncJoinSettings[K]) =>
    onOptionsChange((o) => {
      const next = { ...o.join, [key]: value };
      return { ...o, join: next, preset: joinPresetOf(next) };
    });

  const db = (value: number) => `${Math.round(value)} dB`;
  const chunksOff = disabled || !join.chunkSync;

  switch (section) {
    case 'chunks':
      return (
        <div className="flex flex-col gap-4">
          <Toggle
            label="Place each line as chunks"
            hint="Splits each dub line where it goes quiet, as REAPER's Dynamic split does, and places every chunk on the original's words, as Samanvaya does. The voice is never stretched; only silence between chunks is left out. Off: each line is placed whole."
            checked={join.chunkSync}
            disabled={disabled}
            onChange={(v) => set('chunkSync', v)}
          />
          <Toggle
            label="Check splits against word timing"
            hint="Times each line's words with ElevenLabs forced alignment, one request per line, so no split falls inside a word. A line whose words can't be timed is placed whole."
            checked={join.checkCutWords}
            disabled={chunksOff}
            onChange={(v) => set('checkCutWords', v)}
          />
          <Toggle
            label="Read a line that still runs long faster"
            hint="When a line has more words than time even with every pause shrunk, it is voiced again with the voice's own speed raised just enough to fit. The voice reads faster; the audio is never stretched. Only those lines are voiced again. Eleven v3 and v4 ignore the speed setting, so their lines are not voiced again."
            checked={join.speedFit}
            disabled={chunksOff}
            onChange={(v) => set('speedFit', v)}
          />
          <Slider id="sync-max-voice-speed" label="Fastest read" value={join.maxVoiceSpeed} {...bounds('maxVoiceSpeed')} step={0.01}
            format={(v) => `${v.toFixed(2)}×`} disabled={chunksOff || !join.speedFit}
            onChange={(v) => set('maxVoiceSpeed', v)} hint="Of the voice's own speed. Past about 1.15× a read starts to sound hurried." />
          <span className={sectionLabel}>Split, as REAPER Dynamic split</span>
          <Slider id="sync-gate-open" label="Threshold" value={join.gateOpenDb} {...bounds('gateOpenDb')} step={1} format={db} disabled={chunksOff}
            onChange={(v) => set('gateOpenDb', v)} hint="A chunk starts when the voice rises above this." />
          <Slider id="sync-gate-hysteresis" label="Hysteresis" value={join.gateHysteresisDb} {...bounds('gateHysteresisDb')} step={1} format={db} disabled={chunksOff}
            onChange={(v) => set('gateHysteresisDb', v)} hint={`It ends only when the voice falls below ${Math.round(join.gateOpenDb + join.gateHysteresisDb)} dB, so a word's dying sound stays in.`} />
          <Slider id="sync-min-slice" label="Min slice length" value={join.minSliceLength} {...bounds('minSliceLength')} step={0.01} format={ms} disabled={chunksOff}
            onChange={(v) => set('minSliceLength', v)} />
          <Slider id="sync-min-silence" label="Min silence length" value={join.minSilenceLength} {...bounds('minSilenceLength')} step={0.01} format={ms} disabled={chunksOff}
            onChange={(v) => set('minSilenceLength', v)} hint="A shorter silence doesn't split." />
          <Slider id="sync-lead-pad" label="Leading pad" value={join.leadPad} {...bounds('leadPad')} step={0.005} format={ms} disabled={chunksOff}
            onChange={(v) => set('leadPad', v)} />
          <Slider id="sync-trail-pad" label="Trailing pad" value={join.trailPad} {...bounds('trailPad')} step={0.005} format={ms} disabled={chunksOff}
            onChange={(v) => set('trailPad', v)} />
          <span className={sectionLabel}>Pauses between chunks</span>
          <Slider id="sync-chunk-share" label="Shrink a pause to" value={join.chunkGapShare} {...bounds('chunkGapShare')} step={0.05} format={percent} disabled={chunksOff}
            onChange={(v) => set('chunkGapShare', v)} hint="Of what the voice left, at least. A pause also grows where the original pauses longer." />
          <Toggle
            label="Shrink in punctuation order"
            hint="Pauses between words first, then at commas, and a sentence end's only when the line still doesn't fit."
            checked={join.punctuationPriority}
            disabled={chunksOff}
            onChange={(v) => set('punctuationPriority', v)}
          />
          <Slider id="sync-word-gap" label="Shortest pause between words" value={join.wordGap} {...bounds('wordGap')} step={0.01} format={ms} disabled={chunksOff}
            onChange={(v) => set('wordGap', v)} />
          <Slider id="sync-comma-gap" label="Shortest pause at a comma" value={join.commaGap} {...bounds('commaGap')} step={0.01} format={ms} disabled={chunksOff}
            onChange={(v) => set('commaGap', v)} />
          <Slider id="sync-stop-gap" label="Shortest pause at a sentence end" value={join.stopGap} {...bounds('stopGap')} step={0.01} format={ms} disabled={chunksOff}
            onChange={(v) => set('stopGap', v)} />
          <Slider id="sync-max-chunk-gap" label="Longest a chunk need wait" value={join.maxChunkGap} {...bounds('maxChunkGap')} step={0.05} format={ms} disabled={chunksOff}
            onChange={(v) => set('maxChunkGap', v)} />
        </div>
      );
    case 'gaps':
      return (
        <div className="flex flex-col gap-4">
          <Toggle label="Protect long pauses" checked={join.preserveLongPauses} disabled={disabled}
            onChange={(v) => set('preserveLongPauses', v)} hint="Keeps long breaks between source lines clear and preserves long silence inside the dub. A line too long to finish before a protected break is flagged in the results." />
          <Slider id="sync-protected-pause" label="Protect pauses at least" value={join.protectedPause} {...bounds('protectedPause')} step={0.1}
            format={(v) => `${v.toFixed(1)} s`} disabled={disabled || !join.preserveLongPauses} onChange={(v) => set('protectedPause', v)}
            hint="Protects breaks by duration. It does not detect scene cuts in the video." />
          <Slider
            id="sync-min-gap"
            label="Minimum gap"
            value={join.minGap}
            {...bounds('minGap')}
            step={0.01}
            format={ms}
            disabled={disabled}
            onChange={(v) => set('minGap', v)}
            hint="The least silence between one line's tail and the next line, however little the original speaker paused."
          />
          <Slider
            id="sync-speaker-gap"
            label="Gap at a speaker change"
            value={join.speakerGap}
            {...bounds('speakerGap')}
            step={0.01}
            format={ms}
            disabled={disabled}
            onChange={(v) => set('speakerGap', v)}
          />
          <Slider
            id="sync-gap-share"
            label="Keep of the original pause"
            value={join.gapShare}
            {...bounds('gapShare')}
            step={0.05}
            format={percent}
            disabled={disabled}
            onChange={(v) => set('gapShare', v)}
            hint="Up to 0.6 s. A longer original pause lends the rest of its time to a line that runs long."
          />
          <Toggle
            label="Keep breaths clear"
            hint="A breath before a line's first word never plays over the end of the line before."
            checked={join.breathClear}
            disabled={disabled}
            onChange={(v) => set('breathClear', v)}
          />
          <Toggle
            label="Reduce or remove breaths — changes audio"
            hint="Reduces detected breaths before, between and after words. Use 100% to silence them."
            checked={join.removeBreaths}
            disabled={disabled}
            onChange={(v) => set('removeBreaths', v)}
          />
          <Slider id="sync-breath-reduction" label="Breath reduction" value={join.breathReduction} {...bounds('breathReduction')} step={0.05} format={percent}
            disabled={disabled || !join.removeBreaths} onChange={(v) => set('breathReduction', v)} hint="0% keeps breaths; 100% removes detected breaths. Lower values keep a softer breath." />
        </div>
      );
    case 'pauses':
      return (
        <div className="flex flex-col gap-4">
          {join.chunkSync && (
            <p className="text-[12px] text-slate-400 rounded-lg border border-slate-800 px-2.5 py-1.5">
              Chunk sync is on: pauses are shrunk between chunks instead (see Chunk sync). These apply when it is off.
            </p>
          )}
          <Toggle
            label="Pause only where the original pauses"
            hint="A pause the original speaker never made is cut down to a word gap, even when the line fits. Needs the original's word timestamps."
            checked={join.matchSourcePauses}
            disabled={disabled}
            onChange={(v) => set('matchSourcePauses', v)}
          />
          <Slider
            id="sync-unmatched-pause"
            label="Cut such a pause to"
            value={join.unmatchedPause}
            {...bounds('unmatchedPause')}
            step={0.01}
            format={ms}
            disabled={disabled || !join.matchSourcePauses}
            onChange={(v) => set('unmatchedPause', v)}
          />
          <Toggle
            label="Shorten pauses when a line runs long"
            hint="Only silence between words is taken out."
            checked={join.shortenPauses}
            disabled={disabled}
            onChange={(v) => set('shortenPauses', v)}
          />
          <Slider
            id="sync-min-inner-pause"
            label="Shortest pause kept"
            value={join.minInnerPause}
            {...bounds('minInnerPause')}
            step={0.01}
            format={ms}
            disabled={disabled || !join.shortenPauses}
            onChange={(v) => set('minInnerPause', v)}
          />
          <Slider
            id="sync-max-pause-take"
            label="Most taken from one pause"
            value={join.maxPauseTake}
            {...bounds('maxPauseTake')}
            step={0.05}
            format={percent}
            disabled={disabled || !join.shortenPauses}
            onChange={(v) => set('maxPauseTake', v)}
          />
          <Toggle
            label="Tighten silences when a line still runs long"
            hint="Measures each line's own room tone, then takes silence from its end and from its pauses, longest first, until it fits. Words are never cut."
            checked={join.tightenSilences}
            disabled={disabled}
            onChange={(v) => set('tightenSilences', v)}
          />
          <Slider
            id="sync-tight-min-pause"
            label="Shortest pause left"
            value={join.tightMinPause}
            {...bounds('tightMinPause')}
            step={0.01}
            format={ms}
            disabled={disabled || !join.tightenSilences}
            onChange={(v) => set('tightMinPause', v)}
          />
          <Slider
            id="sync-tight-margin"
            label="Silence kept around words"
            value={join.tightMargin}
            {...bounds('tightMargin')}
            step={0.01}
            format={ms}
            disabled={disabled || !join.tightenSilences}
            onChange={(v) => set('tightMargin', v)}
            hint="Left before and after every sound, so a word's start and its dying sound stay whole."
          />
          <Toggle
            label="Check cuts against word timing"
            hint="Times the words of each line it tightens with ElevenLabs forced alignment, and keeps every cut clear of them. One request per tightened line; a line whose words can't be timed is left as it is."
            checked={join.checkCutWords}
            disabled={disabled || !join.tightenSilences}
            onChange={(v) => set('checkCutWords', v)}
          />
          <Slider
            id="sync-splice-crossfade"
            label={
              <>
                Splice crossfade
                <ChangesAudio />
              </>
            }
            value={join.spliceCrossfade}
            {...bounds('spliceCrossfade')}
            step={0.001}
            format={(v) => (v === 0 ? 'Off' : ms(v))}
            disabled={disabled || (!join.shortenPauses && !join.matchSourcePauses)}
            onChange={(v) => set('spliceCrossfade', v)}
            hint="Smooths room tone where a pause is shortened. Off keeps every sample as voiced."
          />
        </div>
      );
    case 'edges':
      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="sync-tail-floor" className="text-[13px] text-slate-200">
              Tail ends below
            </label>
            <select
              id="sync-tail-floor"
              value={join.tailFloorDb}
              onChange={(e) => set('tailFloorDb', Number(e.target.value))}
              disabled={disabled}
              className="h-9 bg-slate-950 border border-slate-800 rounded-lg px-2 text-[13px] text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:cursor-not-allowed"
            >
              {![-60, -70, -80].includes(join.tailFloorDb) && <option value={join.tailFloorDb}>{join.tailFloorDb} dB, custom</option>}
              <option value={-60} className="bg-slate-900">
                -60 dB, shortest tail
              </option>
              <option value={-70} className="bg-slate-900">
                -70 dB, keeps the full decay
              </option>
              <option value={-80} className="bg-slate-900">
                -80 dB, longest tail
              </option>
            </select>
          </div>
          <Slider
            id="sync-tail-hold"
            label="Tail hold"
            value={join.tailHold}
            {...bounds('tailHold')}
            step={0.005}
            format={ms}
            disabled={disabled}
            onChange={(v) => set('tailHold', v)}
            hint="Extra silence kept after the last word before the line counts as finished."
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="sync-edge-fade" className="text-[13px] text-slate-200">
              Fade for a line that stops abruptly
              <ChangesAudio />
            </label>
            <select
              id="sync-edge-fade"
              value={join.edgeFade}
              onChange={(e) => set('edgeFade', Number(e.target.value))}
              disabled={disabled}
              className="h-9 bg-slate-950 border border-slate-800 rounded-lg px-2 text-[13px] text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:cursor-not-allowed"
            >
              {![0, 0.01, 0.02].includes(join.edgeFade) && <option value={join.edgeFade}>{ms(join.edgeFade)}, custom</option>}
              <option value={0} className="bg-slate-900">
                Off, 3 ms micro-fade only where needed
              </option>
              <option value={0.01} className="bg-slate-900">
                10 ms
              </option>
              <option value={0.02} className="bg-slate-900">
                20 ms
              </option>
            </select>
          </div>
        </div>
      );
    case 'fit':
      return (
        <div className="flex flex-col gap-4">
          <ol className="flex flex-col gap-1.5 text-[12.5px] text-slate-300">
            {['Shorten the pauses inside it, then tighten its silences', 'Move the lines around it, never over each other', 'Flag it with a shorter wording, never squeeze it'].map(
              (step, n) => (
                <li key={step} className="flex items-center gap-2 rounded-lg border border-slate-800 px-2.5 py-1.5">
                  <span className="w-[18px] h-[18px] shrink-0 rounded-full bg-indigo-500/20 text-indigo-300 text-[10.5px] flex items-center justify-center">{n + 1}</span>
                  {step}
                </li>
              )
            )}
          </ol>
          <Slider
            id="sync-max-late"
            label="Latest a line may start"
            value={join.maxLateStart}
            {...bounds('maxLateStart')}
            step={0.01}
            format={ms}
            disabled={disabled}
            onChange={(v) => set('maxLateStart', v)}
            hint={
              strict
                ? 'Strict keeps every line within this of its original line.'
                : 'A line pushed later than this after its original line is listed for review.'
            }
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="sync-timing-protection" className="text-[13px] text-slate-200">
              Timing protection
            </label>
            <select
              id="sync-timing-protection"
              value={strict ? 'strict' : 'warn'}
              disabled={disabled}
              // Not a line-join setting: changing it keeps the preset.
              onChange={(e) => onOptionsChange((o) => ({ ...o, timingProtection: e.target.value === 'strict' ? 'strict' : 'warn' }))}
              className="h-9 bg-slate-950 border border-slate-800 rounded-lg px-2 text-[13px] text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:cursor-not-allowed"
            >
              <option value="warn" className="bg-slate-900">
                Warn: list lines that start later than this
              </option>
              <option value="strict" className="bg-slate-900">
                Strict: keep every line within this
              </option>
            </select>
            <span className="text-[11.5px] text-slate-400">
              With Strict, a line that still can't fit is placed as early as it can go and flagged, never left out. Locked lines keep their
              place unless the lines before them need the room, and are flagged when they move.
            </span>
          </div>
        </div>
      );
    case 'grouping':
      return (
        <div className="flex flex-col gap-4">
          <Slider
            id="sync-unit-gap"
            label="Join cues closer than"
            value={join.unitGap}
            {...bounds('unitGap')}
            step={0.05}
            format={ms}
            disabled={disabled}
            onChange={(v) => set('unitGap', v)}
            hint="Cues this close, by the same speaker, are voiced as one line so the voice flows across them."
          />
          <Slider
            id="sync-max-unit"
            label="Longest joined line"
            value={join.maxUnit}
            {...bounds('maxUnit')}
            step={1}
            format={(v) => `${v} s`}
            disabled={disabled}
            onChange={(v) => set('maxUnit', v)}
            hint="An unfinished sentence may stay together for up to 30 s, even past this limit."
          />
        </div>
      );
    case 'review':
      return (
        <Slider
          id="sync-flag-join"
          label="Flag joins tighter than"
          value={join.flagJoin}
          {...bounds('flagJoin')}
          step={0.01}
          format={(v) => (v === 0 ? 'Off' : ms(v))}
          disabled={disabled}
          onChange={(v) => set('flagJoin', v)}
          hint="Silence between one line's last word and the next line's first."
        />
      );
  }
};
