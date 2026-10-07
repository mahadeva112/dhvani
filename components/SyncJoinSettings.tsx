import React, { useState } from 'react';
import { Check, ChevronDown, Loader2, Ruler, X } from 'lucide-react';
import {
  fitJoinSettings,
  SYNC_JOIN_PRESETS,
  SYNC_JOIN_PRESET_OPTIONS,
  SyncFit,
  SyncJoinPreset,
  SyncJoinSettings,
  SyncOptions,
} from '../services/syncService';
import { AudioSegment } from '../types';

/**
 * How Sync joins its lines: a preset, and under it every setting the preset
 * fills in, in groups that stay closed until opened. Changing any setting
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

/** Saved join settings, filled in from Natural wherever one is missing or not a usable value. */
export const readJoinSettings = (saved: unknown): SyncJoinSettings => {
  const join: SyncJoinSettings = { ...SYNC_JOIN_PRESETS.natural };
  if (!saved || typeof saved !== 'object') return join;
  const record = saved as Record<string, unknown>;
  (Object.keys(join) as (keyof SyncJoinSettings)[]).forEach((key) => {
    const value = record[key];
    if (typeof join[key] === 'boolean' && typeof value === 'boolean') (join[key] as boolean) = value;
    if (typeof join[key] === 'number' && typeof value === 'number' && Number.isFinite(value)) (join[key] as number) = value;
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

const Group: React.FC<{ title: string; summary: string; measured?: boolean; children: React.ReactNode }> = ({ title, summary, measured, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 py-2.5 text-left cursor-pointer"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-[13px] font-medium text-slate-200">
            {title}
            {measured && (
              <span
                title="Set by Fit to this video"
                className="ml-1.5 px-1.5 py-px rounded-md bg-indigo-500/15 text-indigo-300 text-[10.5px] font-medium align-middle"
              >
                measured
              </span>
            )}
          </span>
          {!open && <span className="block text-[11.5px] text-slate-500 truncate">{summary}</span>}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="pb-3.5 flex flex-col gap-3">{children}</div>}
    </div>
  );
};

/** What Fit to this video measures from: the cues, and the dub's speaking rate. */
export interface SyncFitSource {
  segments: AudioSegment[];
  charsPerSecond: number;
  /** True when the rate was measured from this dub, not a typical one. */
  rateMeasured: boolean;
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
const FitCard: React.FC<{
  source: SyncFitSource;
  join: SyncJoinSettings;
  disabled?: boolean;
  onApply: (changes: Partial<SyncJoinSettings>) => void;
}> = ({ source, join, disabled, onApply }) => {
  const [fit, setFit] = useState<SyncFit | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const measure = async () => {
    setMeasuring(true);
    setError(null);
    try {
      setFit(await fitJoinSettings({ ...source, join }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't measure this video.");
    } finally {
      setMeasuring(false);
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

/** The preset picker and the join settings under it, for the Sync settings rail. */
export const SyncJoinSettingsPanel: React.FC<{
  options: SyncOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<SyncOptions>>;
  disabled?: boolean;
  /** What Fit to this video measures from; no card without it. */
  fitSource?: SyncFitSource;
}> = ({ options, onOptionsChange, disabled, fitSource }) => {
  const { join } = options;
  /** The values Fit to this video set; a group is marked while any of its settings still holds one. */
  const [fitted, setFitted] = useState<Partial<SyncJoinSettings>>({});
  const measured = (group: keyof typeof GROUP_KEYS) => GROUP_KEYS[group].some((key) => key in fitted && fitted[key] === join[key]);
  const applyFit = (changes: Partial<SyncJoinSettings>) => {
    setFitted(changes);
    onOptionsChange((o) => {
      const next = { ...o.join, ...changes };
      return { ...o, join: next, preset: joinPresetOf(next) };
    });
  };
  const set = <K extends keyof SyncJoinSettings>(key: K, value: SyncJoinSettings[K]) =>
    onOptionsChange((o) => {
      const next = { ...o.join, [key]: value };
      return { ...o, join: next, preset: joinPresetOf(next) };
    });
  const pickPreset = (preset: SyncJoinPreset) =>
    onOptionsChange((o) => (preset === 'custom' ? { ...o, preset } : { ...o, preset, join: { ...SYNC_JOIN_PRESETS[preset] } }));
  const hint = SYNC_JOIN_PRESET_OPTIONS.find((p) => p.id === options.preset)?.hint;

  return (
    <div className="flex flex-col gap-3">
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

      {fitSource && <FitCard source={fitSource} join={join} disabled={disabled} onApply={applyFit} />}

      <div className="flex flex-col">
        <Group title="Gaps between lines" measured={measured('gaps')} summary={`${ms(join.minGap)} at least · ${ms(join.speakerGap)} at a new speaker`}>
          <Slider
            id="sync-min-gap"
            label="Minimum gap"
            value={join.minGap}
            min={0.04}
            max={0.4}
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
            min={0.04}
            max={0.6}
            step={0.01}
            format={ms}
            disabled={disabled}
            onChange={(v) => set('speakerGap', v)}
          />
          <Slider
            id="sync-gap-share"
            label="Keep of the original pause"
            value={join.gapShare}
            min={0}
            max={1}
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
            label="Remove breaths"
            hint="Silences the breaths the voice takes before, between and after words, so there are none to cut by hand. Words are never touched."
            checked={join.removeBreaths}
            disabled={disabled}
            onChange={(v) => set('removeBreaths', v)}
          />
        </Group>

        <Group
          title="Pauses inside a line"
          measured={measured('pauses')}
          summary={join.shortenPauses ? `Shortened to ${ms(join.minInnerPause)} at least, ${percent(join.maxPauseTake)} at most` : 'Never shortened'}
        >
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
            min={0.08}
            max={0.5}
            step={0.01}
            format={ms}
            disabled={disabled || !join.shortenPauses}
            onChange={(v) => set('minInnerPause', v)}
          />
          <Slider
            id="sync-max-pause-take"
            label="Most taken from one pause"
            value={join.maxPauseTake}
            min={0.05}
            max={1}
            step={0.05}
            format={percent}
            disabled={disabled || !join.shortenPauses}
            onChange={(v) => set('maxPauseTake', v)}
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
            min={0}
            max={0.02}
            step={0.001}
            format={(v) => (v === 0 ? 'Off' : ms(v))}
            disabled={disabled || !join.shortenPauses}
            onChange={(v) => set('spliceCrossfade', v)}
            hint="Smooths room tone where a pause is shortened. Off keeps every sample as voiced."
          />
        </Group>

        <Group title="Line edges" summary={`Tail to ${join.tailFloorDb} dB, held ${ms(join.tailHold)}`}>
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
            min={0}
            max={0.15}
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
        </Group>

        <Group title="When a line doesn't fit" summary={`Flagged when it starts over ${ms(join.maxLateStart)} late`}>
          <ol className="flex flex-col gap-1.5 text-[12.5px] text-slate-300">
            {['Shorten the pauses inside it', 'Move the lines around it, never over each other', 'Flag it with a shorter wording, never squeeze it'].map(
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
            min={0.05}
            max={0.8}
            step={0.01}
            format={ms}
            disabled={disabled}
            onChange={(v) => set('maxLateStart', v)}
            hint="A line pushed later than this after its original line is listed for review."
          />
        </Group>

        <Group title="Grouping" measured={measured('grouping')} summary={`Cues under ${ms(join.unitGap)} apart are one line, ${join.maxUnit} s at most`}>
          <Slider
            id="sync-unit-gap"
            label="Join cues closer than"
            value={join.unitGap}
            min={0}
            max={1}
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
            min={4}
            max={20}
            step={1}
            format={(v) => `${v} s`}
            disabled={disabled}
            onChange={(v) => set('maxUnit', v)}
          />
        </Group>

        <Group title="Review" measured={measured('review')} summary={`Flags joins under ${ms(join.flagJoin)}`}>
          <Slider
            id="sync-flag-join"
            label="Flag joins tighter than"
            value={join.flagJoin}
            min={0}
            max={0.4}
            step={0.01}
            format={(v) => (v === 0 ? 'Off' : ms(v))}
            disabled={disabled}
            onChange={(v) => set('flagJoin', v)}
            hint="Silence between one line's last word and the next line's first."
          />
        </Group>
      </div>
    </div>
  );
};
