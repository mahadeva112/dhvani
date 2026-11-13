import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Gauge, Mic, MoveHorizontal, Pause, Play, RotateCcw, SlidersHorizontal, Volume2, type LucideIcon } from 'lucide-react';
import { SelectedVoiceSummary } from './VoiceSelectorCard';
import { ResetDefaultsButton } from './ResetDefaultsButton';
import { applyJoinPreset, AUTO_LENGTH_HINT, describeChange, isAutoLength, joinPresetOf, pickAutoLength, pickLengthByHand, presetName } from './SyncJoinSettings';
import { isOwnCustom, lengthPresetOf } from '../services/syncAutoFit';
import { syncJoinPreset } from '../services/syncPresets';
import { SYNC_JOIN_PRESET_OPTIONS, SYNC_SCREEN_OPTIONS, type SyncFitMode, type SyncJoinPreset, type SyncJoinSettings, type SyncOptions, type SyncPrecision, type SyncScreen } from '../services/syncService';
import { DUB_AUDIO_QUALITIES, type DubAudioQuality } from '../services/dubAudioQuality';
import { DEFAULT_VOICE_SETTINGS, type ElevenLabsModel, type ElevenLabsVoiceSettings, type Voice, type VoiceExpression } from '../services/elevenLabsService';
import { JOIN_SETTING_RANGES } from '../server/lib/syncSettings.js';

/**
 * The Dub step before the first sync: every choice that changes the dub, on
 * one card, in three columns: Voice, Placement, then Pauses, Long lines and
 * Sound. A setting changed from its default carries an amber dot, and each
 * column can go back to its defaults. The finer settings of a switch (how far
 * a pause shrinks, the fastest read) open under it with ›. The full sync
 * settings window still holds the rest (gate levels, pads, gaps, fades).
 */

type LengthPreset = Exclude<SyncJoinPreset, 'custom'>;
const RANGES: Record<string, number[]> = JOIN_SETTING_RANGES;

const same = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b);

/** The length preset the join settings are closest to: what a custom set started from, most likely. */
const NEAREST_ORDER: LengthPreset[] = ['natural', 'long', 'short', 'vlong'];
const nearestPreset = (join: SyncJoinSettings, screen: SyncScreen): LengthPreset => {
  const off = (preset: LengthPreset) => {
    const base = syncJoinPreset(preset, screen);
    return (Object.keys(base) as (keyof SyncJoinSettings)[]).filter((key) => !same(join[key], base[key])).length;
  };
  return NEAREST_ORDER.reduce((best, preset) => (off(preset) < off(best) ? preset : best), 'natural' as LengthPreset);
};

const Dot: React.FC = () => <span aria-label="changed" title="Changed from the default" className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />;

const Row: React.FC<{
  name: React.ReactNode;
  note?: string;
  badge?: React.ReactNode;
  changed?: boolean;
  /** Indented under the setting it belongs to. */
  nested?: boolean;
  dim?: boolean;
  title?: string;
  /** The finer settings, opened under the row with ›. */
  fine?: React.ReactNode;
  fineChanged?: boolean;
  /** Under the row, full width: a small picture of the setting. */
  below?: React.ReactNode;
  children: React.ReactNode;
}> = ({ name, note, badge, changed, nested, dim, title, fine, fineChanged, below, children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={nested ? 'ml-3 pl-3 border-l border-edge' : ''}>
      <div className={`py-[7px] border-b border-edge/60 ${dim ? 'opacity-50' : ''}`} title={title}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="min-w-[9rem] flex-1">
            <div className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-100">
              {name}
              {changed && <Dot />}
              {badge}
              {fine && (
                <button
                  type="button"
                  onClick={() => setOpen((now) => !now)}
                  aria-expanded={open}
                  aria-label={open ? 'Hide the finer settings' : 'Show the finer settings'}
                  title={open ? 'Hide the finer settings' : 'Fine-tune'}
                  className={`inline-flex items-center gap-0.5 text-[11px] font-medium cursor-default ${fineChanged ? 'text-amber-300' : 'text-slate-500 hover:text-slate-200'}`}
                >
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                  {fineChanged && 'tuned'}
                </button>
              )}
            </div>
            {note && <div className="text-[11.5px] leading-snug text-slate-500">{note}</div>}
          </div>
          {children}
        </div>
        {below}
      </div>
      {fine && open && <div className="mt-1 mb-2 ml-3 pl-3 border-l border-indigo-500/40">{fine}</div>}
    </div>
  );
};

type Choice<T extends string> = { id: T; label: string; hint?: string; disabled?: boolean };

const Seg = <T extends string>({
  label,
  value,
  choices,
  onPick,
  disabled,
  suggested,
}: {
  label: string;
  value: T | null;
  choices: Choice<T>[];
  onPick: (id: T) => void;
  disabled?: boolean;
  /** Marked with a dot: what this dub is likely to suit. */
  suggested?: T | null;
}) => (
  <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 gap-0.5 p-[3px] rounded-[11px] bg-slate-950 border border-edge">
    {choices.map((c) => {
      const on = c.id === value;
      return (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={on}
          disabled={disabled || c.disabled}
          title={c.hint}
          onClick={() => onPick(c.id)}
          className={`relative rounded-lg px-2.5 py-[3px] text-xs font-semibold whitespace-nowrap transition-colors cursor-default disabled:cursor-not-allowed ${
            on ? 'bg-slate-800 text-white shadow-[0_2px_8px_rgba(0,0,0,.35)]' : c.disabled ? 'text-slate-600' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          {c.label}
          {suggested === c.id && !on && <span aria-hidden className="absolute top-[3px] right-[3px] w-[5px] h-[5px] rounded-full bg-amber-400" />}
        </button>
      );
    })}
  </div>
);

const Switch: React.FC<{ label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }> = ({ label, on, onChange, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!on)}
    className={`relative w-[34px] h-5 rounded-full shrink-0 transition-colors cursor-default disabled:opacity-50 ${on ? 'bg-indigo-500' : 'bg-slate-700'}`}
  >
    <span className={`absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white transition-all ${on ? 'left-[17px]' : 'left-[3px]'}`} />
  </button>
);

/** A slider with its value, a tick where the default sits, and a way back to it. */
const Slider: React.FC<{
  label: string;
  value: number;
  def: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
  ends?: readonly [string, string];
  /** Off when the default is not what the setting is measured against (the voice's own settings). */
  marked?: boolean;
}> = ({ label, value, def, min, max, step, format, onChange, disabled, ends, marked = true }) => {
  const changed = marked && !same(value, def);
  const at = (v: number) => Math.min(1, Math.max(0, (v - min) / (max - min || 1)));
  return (
    <div className={`grid grid-cols-[8.5rem_minmax(0,1fr)_3.75rem_1.25rem] items-center gap-2.5 py-1 ${disabled ? 'opacity-45' : ''}`} title={ends ? `${ends[0]} ↔ ${ends[1]}` : undefined}>
      <span className="flex items-center gap-1.5 min-w-0 text-[12.5px] font-semibold text-slate-200">
        <span className="truncate">{label}</span>
        {changed && <Dot />}
      </span>
      <span className="relative flex items-center">
        {marked && (
          <span
            aria-hidden
            title={`Default ${format(def)}`}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-px w-0.5 h-3 rounded-sm bg-slate-600 pointer-events-none"
            style={{ left: `calc(8px + (100% - 16px) * ${at(def)})` }}
          />
        )}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="relative w-full accent-indigo-500 cursor-default disabled:opacity-60"
        />
      </span>
      <span className="font-mono text-xs text-slate-300 tabular-nums text-right">{format(value)}</span>
      {changed && !disabled ? (
        <button
          type="button"
          onClick={() => onChange(def)}
          aria-label={`Back to the default: ${format(def)}`}
          title={`Back to the default: ${format(def)}`}
          className="w-5 h-5 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-slate-800 cursor-default"
        >
          <RotateCcw className="w-3 h-3" />
        </button>
      ) : (
        <span />
      )}
    </div>
  );
};

const Cap: React.FC<{ icon: LucideIcon; children: React.ReactNode; changed?: number; onReset?: () => void; disabled?: boolean }> = ({
  icon: Icon,
  children,
  changed = 0,
  onReset,
  disabled,
}) => (
  <div className="flex items-center gap-2 mt-4 mb-1">
    <span className="w-6 h-6 rounded-md bg-slate-800 text-slate-300 flex items-center justify-center shrink-0">
      <Icon className="w-3.5 h-3.5" />
    </span>
    <span className="flex-1 text-[11px] uppercase tracking-[.09em] font-semibold text-slate-400">{children}</span>
    {changed > 0 && onReset && (
      <button type="button" onClick={onReset} disabled={disabled} className="text-[11px] text-amber-300/90 hover:text-amber-200 cursor-default disabled:opacity-50" title="Back to the defaults">
        {changed} changed · reset
      </button>
    )}
  </div>
);

const SubCap: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div className="flex items-center gap-2 mt-3 mb-0.5">
    <span className="flex-1 text-[10.5px] uppercase tracking-[.09em] font-semibold text-slate-500">{children}</span>
    {action}
  </div>
);

const LENGTH_CHOICES: Choice<LengthPreset | 'auto'>[] = [
  { id: 'auto', label: 'Auto', hint: AUTO_LENGTH_HINT },
  { id: 'short', label: 'Short' },
  { id: 'natural', label: 'Natural' },
  { id: 'long', label: 'Long' },
  { id: 'vlong', label: 'Very long' },
].map((c) => ({ ...c, hint: c.hint ?? SYNC_JOIN_PRESET_OPTIONS.find((p) => p.id === c.id)?.hint })) as Choice<LengthPreset | 'auto'>[];

const SCREEN_CHOICES: Choice<SyncScreen>[] = SYNC_SCREEN_OPTIONS.map((s) => ({ id: s.id, label: s.label, hint: s.hint || undefined }));

const PRECISION_CHOICES: Choice<SyncPrecision>[] = [
  { id: 'loose', label: 'Loose', hint: 'Lines start within ±300 ms of the original.' },
  { id: 'phrase', label: 'Phrase', hint: 'Lines start within ±150 ms of the original.' },
  { id: 'lipsync', label: 'Close-up', hint: 'Lines start within ±80 ms of the original, for faces on screen.' },
];
const PRECISION_MS: Record<SyncPrecision, number> = { loose: 300, phrase: 150, lipsync: 80 };

const FIT_CHOICES: Choice<SyncFitMode>[] = [
  { id: 'off', label: 'Off' },
  { id: 'ask', label: 'Ask', hint: 'Offered to choose in Review after the dub.' },
  { id: 'auto', label: 'Auto', hint: 'Used at once, during the sync.' },
];

const QUALITY_SHORT: Record<DubAudioQuality, string> = { pcm_48000: 'WAV 48 kHz', mp3_44100_192: 'MP3 192', mp3_44100_128: 'MP3 128' };
const EXPRESSION_LABEL: Record<VoiceExpression, string> = { off: 'Off', neutral: 'Neutral', natural: 'Natural', expressive: 'Expressive' };

const ms = (v: number) => `${Math.round(v * 1000)} ms`;
const percent = (v: number) => `${Math.round(v * 100)}%`;

/** The finer settings each switch opens, as the full sync settings window names them. */
type FineKey = 'chunkGapShare' | 'maxChunkGap' | 'unmatchedPause' | 'sourceCutMinPause' | 'sourceCutMaxInsert' | 'tightMinPause' | 'tightMargin' | 'maxVoiceSpeed' | 'maxRevoice' | 'breathReduction';
const FINE: Record<FineKey, { label: string; step: number; format: (v: number) => string }> = {
  chunkGapShare: { label: 'Shrink a pause to', step: 0.05, format: percent },
  maxChunkGap: { label: 'Longest a chunk waits', step: 0.05, format: ms },
  unmatchedPause: { label: 'Cut such a pause to', step: 0.01, format: ms },
  sourceCutMinPause: { label: "Original's pauses from", step: 0.05, format: ms },
  sourceCutMaxInsert: { label: 'Most silence a cut adds', step: 0.05, format: ms },
  tightMinPause: { label: 'Shortest pause left', step: 0.01, format: ms },
  tightMargin: { label: 'Silence around words', step: 0.01, format: ms },
  maxVoiceSpeed: { label: 'Fastest read', step: 0.01, format: (v) => `${v.toFixed(2)}×` },
  maxRevoice: { label: 'Lines voiced again, at most', step: 1, format: (v) => `${Math.round(v)}` },
  breathReduction: { label: 'Breath reduction', step: 0.05, format: percent },
};

/** What each Expression does, under its name. */
const expressionNote = (value: VoiceExpression, takesCues: boolean, cartesia: boolean, notTagged: string) =>
  value === 'off'
    ? "The script as written, in the voice's own settings. Nothing added."
    : value === 'natural'
      ? cartesia
        ? 'Follows how the original speaker spoke: each line gets one mild emotion.'
        : 'Follows how the original speaker spoke: their pace and pauses, with calm tags only.'
      : value === 'expressive'
        ? cartesia
          ? 'The voice takes its emotion from the words. Can sound dramatic.'
          : 'Adds emotion tags guessed from the script. Can sound dramatic.'
        : takesCues
          ? 'Calm and steady in the speaker\'s own voice. No tags, one tone throughout.'
          : `Calm and steady in the speaker's own voice. ${notTagged}`;

/** How wide the window is that each line may start in, against the loosest. */
const TimingPicture: React.FC<{ ms: number }> = ({ ms: window }) => {
  const half = (window / 300) * 50;
  return (
    <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-slate-500" aria-hidden>
      <span className="relative flex-1 h-3 rounded bg-slate-950 border border-edge overflow-hidden">
        <span className="absolute inset-y-0 bg-indigo-500/25 border-x border-indigo-400/60 transition-all" style={{ left: `${50 - half}%`, right: `${50 - half}%` }} />
        <span className="absolute inset-y-0 left-1/2 w-px bg-slate-200" />
      </span>
      <span className="font-mono tabular-nums w-14 text-right">±{window} ms</span>
    </div>
  );
};

const SLIDERS = [
  { key: 'stability', label: 'Stability' },
  { key: 'similarity_boost', label: 'Similarity' },
  { key: 'style', label: 'Style exaggeration' },
] as const;

export interface DubSettingsCardProps {
  disabled?: boolean;
  multiSpeaker?: boolean;
  /** With several speakers: who voices whom, above the main voice. */
  cast?: React.ReactNode;
  voiceId: string;
  availableVoices: Voice[];
  /** Under the voice's name: how fast it reads, when measured. */
  voiceRateNote?: string | null;
  onChangeVoice: () => void;
  favourites?: { id: string; name?: string }[];
  onPickVoice?: (id: string) => void;
  /** ElevenLabs: the model, and the models to choose from. Otherwise `modelName` is shown as it is. */
  modelId?: string;
  models?: ElevenLabsModel[];
  onModelChange?: (id: string) => void;
  modelName: string;
  expression?: {
    value: VoiceExpression;
    onChange: (value: VoiceExpression) => void;
    /** Natural and Expressive can be picked: a model that performs tags, one voice. */
    takesCues: boolean;
    cartesia: boolean;
    /** Why Natural and Expressive can't be picked. */
    notTagged: string;
  };
  voiceSettings?: {
    shown: ElevenLabsVoiceSettings;
    /** True once the user has moved a slider: the voice's own settings are no longer used. */
    custom: boolean;
    isDefault: boolean;
    stabilityEnds: [string, string];
    onChange: (settings: ElevenLabsVoiceSettings | null) => void;
    onDefaults: () => void;
  };
  loudness?: { value: boolean; onChange: (on: boolean) => void };
  quality?: { value: DubAudioQuality; onChange: (q: DubAudioQuality) => void; notice?: string | null };
  /** With several speakers: how loud the mix peaks. */
  mixPeak?: React.ReactNode;
  options: SyncOptions;
  onOptionsChange: React.Dispatch<React.SetStateAction<SyncOptions>>;
  /** The length preset this dub likely suits, and by how much it runs longer (+) or shorter. */
  suggestion?: { preset: LengthPreset; change: number } | null;
  /** The suggestion comes from the estimate, not a sync. */
  suggestionEstimated?: boolean;
  /** The model reads faster by a pace direction (Eleven v3 and v4), not a speed. */
  paceDirection?: boolean;
  onOpenAllSettings: () => void;
}

export const DubSettingsCard: React.FC<DubSettingsCardProps> = ({
  disabled = false,
  multiSpeaker = false,
  cast,
  voiceId,
  availableVoices,
  voiceRateNote,
  onChangeVoice,
  favourites = [],
  onPickVoice,
  modelId,
  models = [],
  onModelChange,
  modelName,
  expression,
  voiceSettings,
  loudness,
  quality,
  mixPeak,
  options,
  onOptionsChange,
  suggestion,
  suggestionEstimated = false,
  paceDirection = false,
  onOpenAllSettings,
}) => {
  // The voice's own sample, played from here.
  const sampleUrl = availableVoices.find((v) => v.voice_id === voiceId)?.preview_url;
  const sample = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    sample.current?.pause();
    setPlaying(false);
  }, [voiceId]);
  useEffect(() => () => sample.current?.pause(), []);
  const toggleSample = () => {
    if (!sampleUrl) return;
    if (playing) {
      sample.current?.pause();
      setPlaying(false);
      return;
    }
    if (!sample.current || sample.current.src !== sampleUrl) {
      sample.current?.pause();
      sample.current = new Audio(sampleUrl);
      sample.current.onended = () => setPlaying(false);
    }
    sample.current.currentTime = 0;
    sample.current.play().then(() => setPlaying(true), () => setPlaying(false));
  };

  const { join } = options;
  const screen = options.screen ?? 'any';
  // Settings Fit to this video left count as the length they started from, fitted; the user's own as the length they are closest to.
  const fittedFrom = options.preset === 'custom' && !isOwnCustom(options) ? lengthPresetOf(options) : null;
  const ownCustom = options.preset === 'custom' && !fittedFrom;
  const lengthNow: LengthPreset = options.preset !== 'custom' ? options.preset : fittedFrom ?? nearestPreset(join, screen);
  // What a join setting counts as changed from: the length's own value, or the fit's.
  const base: SyncJoinSettings = fittedFrom && options.fitted ? options.fitted.join : syncJoinPreset(lengthNow, screen);
  const joinChanged = (key: keyof SyncJoinSettings) => !same(join[key], base[key]);

  const setJoinValues = (values: Partial<SyncJoinSettings>) =>
    onOptionsChange((o) => {
      const next = { ...o.join, ...values };
      return { ...o, join: next, preset: joinPresetOf(next, o.screen) };
    });
  const setJoin = <K extends keyof SyncJoinSettings>(key: K, value: SyncJoinSettings[K]) => setJoinValues({ [key]: value } as Partial<SyncJoinSettings>);
  const resetJoin = (keys: (keyof SyncJoinSettings)[]) =>
    setJoinValues(Object.fromEntries(keys.filter(joinChanged).map((key) => [key, base[key]])) as Partial<SyncJoinSettings>);
  // Auto (the default): Sync picks the length when pressed. A length picked here stays.
  const autoLength = isAutoLength(options);
  const pickLength = (preset: LengthPreset | 'auto') => onOptionsChange((o) => (preset === 'auto' ? pickAutoLength(o) : pickLengthByHand(o, preset)));
  const pickScreen = (next: SyncScreen) =>
    onOptionsChange((o) => (o.preset === 'custom' ? { ...o, screen: next } : applyJoinPreset(o, o.preset, next)));

  const suggested = !autoLength && suggestion && suggestion.preset !== lengthNow ? suggestion.preset : null;
  const lengthName = presetName(lengthNow).replace(' dub', '');
  // What Auto is likely to pick, from the same estimate; before voicing, Sync's fit never picks Short (services/syncAutoFit.ts).
  const autoNote = suggestion
    ? `Sync picks it when you press Dub & sync. The dub reads ${describeChange(suggestion.change)} than the original${suggestionEstimated ? ', est.' : ''}: ${
        suggestion.preset === 'short' ? 'likely Natural, then Short once the lines are voiced.' : `likely ${presetName(suggestion.preset).replace(' dub', '')}.`
      }`
    : `Sync picks it when you press Dub & sync. Now ${lengthName}.`;
  const lengthNote = autoLength
    ? autoNote
    : fittedFrom
    ? `${lengthName}, fitted to this video. Picking a length replaces the fit.`
    : ownCustom
      ? `${lengthName}, with your own changes. Picking a length replaces them.`
      : suggestion
        ? `The dub reads ${describeChange(suggestion.change)} than the original${suggestionEstimated ? ', est.' : '.'}`
        : (SYNC_JOIN_PRESET_OPTIONS.find((p) => p.id === options.preset)?.hint ?? '');

  // What counts as changed, column by column.
  const sliderMarked = Boolean(voiceSettings?.custom);
  const voiceSettingChanged = (key: (typeof SLIDERS)[number]['key']) =>
    Boolean(voiceSettings?.custom) && !same(voiceSettings!.shown[key] ?? 0, DEFAULT_VOICE_SETTINGS[key] ?? 0);
  const boostChanged = Boolean(voiceSettings?.custom) && (voiceSettings!.shown.use_speaker_boost !== false) !== (DEFAULT_VOICE_SETTINGS.use_speaker_boost !== false);
  const expressionNow: VoiceExpression | null = expression ? (expression.takesCues || expression.value === 'off' ? expression.value : 'neutral') : null;
  const voiceChanged = [expressionNow !== null && expressionNow !== 'off', ...SLIDERS.map((s) => voiceSettingChanged(s.key)), boostChanged].filter(Boolean).length;
  const resetVoice = () => {
    if (expression && expression.value !== 'off') expression.onChange('off');
    if (voiceSettings?.custom) voiceSettings.onChange(null);
  };

  const PLACE_KEYS: (keyof SyncJoinSettings)[] = ['chunkSync', 'joinSpokenChunks', 'chunkGapShare', 'maxChunkGap'];
  const voicingChanged = !multiSpeaker && options.voicing !== 'lines';
  const precisionChanged = options.precision !== 'phrase';
  const placeChanged = [voicingChanged, precisionChanged, ...PLACE_KEYS.map(joinChanged)].filter(Boolean).length;
  const resetPlace = () => {
    resetJoin(PLACE_KEYS);
    if (voicingChanged || precisionChanged) onOptionsChange((o) => ({ ...o, voicing: 'lines', precision: 'phrase' }));
  };

  const PAUSE_KEYS: (keyof SyncJoinSettings)[] = ['matchSourcePauses', 'unmatchedPause', 'cutAtSourcePauses', 'sourceCutMinPause', 'sourceCutMaxInsert', 'tightenSilences', 'tightMinPause', 'tightMargin'];
  const LONG_KEYS: (keyof SyncJoinSettings)[] = ['speedFit', 'maxVoiceSpeed', 'bestTakes', 'maxRevoice'];
  const SOUND_KEYS: (keyof SyncJoinSettings)[] = ['removeBreaths', 'breathReduction'];
  const pauseChanged = PAUSE_KEYS.filter(joinChanged).length;
  const longChanged = LONG_KEYS.filter(joinChanged).length;
  const loudnessChanged = Boolean(loudness && !loudness.value);
  const soundChanged = SOUND_KEYS.filter(joinChanged).length + (loudnessChanged ? 1 : 0);
  const resetSound = () => {
    resetJoin(SOUND_KEYS);
    if (loudnessChanged) loudness!.onChange(true);
  };

  const totalChanged = voiceChanged + placeChanged + pauseChanged + longChanged + soundChanged;
  const anythingToReset = totalChanged > 0 || options.preset !== 'natural' || screen !== 'any' || options.lengthAuto === false;
  const resetAll = () => {
    onOptionsChange((o) => ({ ...applyJoinPreset(o, 'natural', 'any'), voicing: 'lines', precision: 'phrase', lengthAuto: true, fitOnSync: true }));
    resetVoice();
    if (loudnessChanged) loudness!.onChange(true);
  };

  /** A finer setting's slider, measured against the length's own value. */
  const fine = (key: FineKey, off = false) => (
    <Slider
      key={key}
      label={FINE[key].label}
      value={join[key] as number}
      def={base[key] as number}
      min={RANGES[key]?.[0] ?? 0}
      max={RANGES[key]?.[1] ?? 1}
      step={FINE[key].step}
      format={FINE[key].format}
      onChange={(v) => setJoin(key, v)}
      disabled={disabled || off}
    />
  );
  const fineChanged = (...keys: FineKey[]) => keys.some(joinChanged);

  const voiceName = availableVoices.find((v) => v.voice_id === voiceId)?.name?.split(/\s+[-–—|]\s+/)[0] ?? null;
  const chips: [string, string][] = [
    ['Voice', [voiceName, modelName, expressionNow && expressionNow !== 'off' ? EXPRESSION_LABEL[expressionNow] : null].filter(Boolean).join(' · ')],
    ['Length', autoLength ? 'Auto' : fittedFrom ? `${lengthName}, fitted` : ownCustom ? `${lengthName}, changed` : lengthName],
    ...(screen !== 'any' ? ([['On screen', SYNC_SCREEN_OPTIONS.find((s) => s.id === screen)?.label ?? screen]] as [string, string][]) : []),
    ['Timing', `±${PRECISION_MS[options.precision]} ms`],
    ['Chunks', join.chunkSync ? 'On' : 'Off'],
    ...(quality ? ([['File', QUALITY_SHORT[quality.value]]] as [string, string][]) : []),
  ];

  const fitNote = paceDirection
    ? `A calm, quicker pace direction, up to ${join.maxVoiceSpeed.toFixed(2)}×`
    : `Read at up to ${join.maxVoiceSpeed.toFixed(2)}× speed`;

  return (
    <section aria-label="Dub settings" className="@container flex-1 flex flex-col min-h-0 bg-slate-900/90 border border-edge rounded-2xl overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-3 border-b border-edge">
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-slate-100">Dub settings</h2>
          <p className="text-xs text-slate-400">Every setting Dub &amp; sync uses. Changes apply to the next Dub &amp; sync.</p>
        </div>
        {totalChanged > 0 ? (
          <span className="hidden @md:inline-flex items-center gap-1.5 text-[12px] text-amber-300 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            {totalChanged} changed
          </span>
        ) : (
          !anythingToReset && <span className="hidden @md:inline text-[12px] text-slate-500 shrink-0">All defaults</span>
        )}
        {anythingToReset && (
          <button
            type="button"
            onClick={resetAll}
            disabled={disabled}
            title="Natural length, line by line, Phrase timing, the default switches, Expression off and the voice's own settings. The voice, model and file stay."
            className="h-8 px-3 flex items-center gap-1.5 rounded-[10px] border border-slate-700 text-[12.5px] font-semibold text-slate-300 hover:bg-slate-800 shrink-0 cursor-default disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset all
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-5 py-2 border-b border-edge bg-slate-950/40">
        {chips.map(([name, value]) => (
          <span key={name} className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-slate-800/70 text-[11.5px] max-w-full">
            <span className="text-slate-500">{name}</span>
            <span className="text-slate-200 font-medium truncate">{value}</span>
          </span>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 grid grid-cols-1 content-start gap-x-7 @3xl:grid-cols-2 @6xl:grid-cols-3">
        {/* Voice */}
        <div className="min-w-0">
          <Cap icon={Mic} changed={voiceChanged} onReset={resetVoice} disabled={disabled}>
            Voice
          </Cap>
          {cast && <div className="pt-1">{cast}</div>}
          <div className="flex items-center gap-3 py-2.5 border-b border-edge/60">
            <div className="min-w-0 flex-1">
              {multiSpeaker && <span className="block mb-1 text-[10.5px] uppercase tracking-[.09em] font-semibold text-slate-500">Main voice</span>}
              <SelectedVoiceSummary voiceId={voiceId} availableVoices={availableVoices} />
              {voiceRateNote && <span className="block mt-0.5 text-[11.5px] text-slate-500 tabular-nums">{voiceRateNote}</span>}
            </div>
            {sampleUrl && (
              <button
                type="button"
                onClick={toggleSample}
                aria-label={playing ? 'Stop the sample' : "Play the voice's sample"}
                title={playing ? 'Stop the sample' : "Play the voice's sample"}
                className="w-8 h-8 rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center justify-center shrink-0 cursor-default"
              >
                {playing ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-px" />}
              </button>
            )}
            <button
              type="button"
              onClick={onChangeVoice}
              disabled={disabled}
              className="h-8 px-3 rounded-[10px] border border-slate-700 text-[12.5px] font-semibold text-slate-200 hover:bg-slate-800 shrink-0 cursor-default disabled:opacity-50"
            >
              Change
            </button>
          </div>
          {favourites.length > 1 && onPickVoice && (
            <div className="flex flex-wrap items-center gap-1.5 pt-2 pb-1">
              {favourites.slice(0, 4).map((fav) => {
                const on = fav.id === voiceId;
                const name = (fav.name || fav.id).split(/\s+[-–—|]\s+/)[0];
                return (
                  <button
                    key={fav.id}
                    type="button"
                    aria-pressed={on}
                    disabled={disabled}
                    onClick={() => onPickVoice(fav.id)}
                    title={fav.name}
                    className={`px-2.5 py-0.5 rounded-full border text-[11.5px] truncate max-w-[9rem] cursor-default ${
                      on ? 'border-indigo-500 bg-indigo-500/15 text-slate-100' : 'border-slate-700 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          )}
          <Row name="Model" note={paceDirection ? 'Reads tags; the speed setting is ignored, so a faster read is a pace direction.' : undefined}>
            {modelId && onModelChange && models.length > 0 ? (
              <select
                value={modelId}
                onChange={(e) => onModelChange(e.target.value)}
                disabled={disabled}
                aria-label="Model"
                className="max-w-[14rem] h-8 bg-slate-950 border border-edge hover:border-slate-600 rounded-[10px] px-2.5 text-[12.5px] font-semibold text-slate-100 truncate focus:outline-none focus:border-indigo-500 cursor-default disabled:opacity-60"
              >
                {!models.some((m) => m.model_id === modelId) && <option value={modelId} className="bg-slate-900">{modelName}</option>}
                {models.map((m) => (
                  <option key={m.model_id} value={m.model_id} className="bg-slate-900">
                    {m.name}
                    {m.token_cost_factor && m.token_cost_factor !== 1 ? ` · ${m.token_cost_factor}× credits` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[12.5px] font-semibold text-slate-200 truncate">{modelName}</span>
            )}
          </Row>
          {expression && expressionNow && (
            <Row name="Expression" changed={expressionNow !== 'off'} note={expressionNote(expressionNow, expression.takesCues, expression.cartesia, expression.notTagged)}>
              <Seg
                label="Expression"
                value={expressionNow}
                choices={[
                  { id: 'off', label: 'Off' },
                  { id: 'neutral', label: 'Neutral' },
                  { id: 'natural', label: 'Natural', disabled: !expression.takesCues, hint: expression.takesCues ? undefined : expression.notTagged },
                  { id: 'expressive', label: 'Expressive', disabled: !expression.takesCues, hint: expression.takesCues ? undefined : expression.notTagged },
                ]}
                onPick={expression.onChange}
                disabled={disabled}
              />
            </Row>
          )}
          {voiceSettings && (
            <>
              <SubCap action={<ResetDefaultsButton onClick={voiceSettings.onDefaults} disabled={disabled || voiceSettings.isDefault} />}>Voice settings</SubCap>
              {SLIDERS.map((s) => (
                <Slider
                  key={s.key}
                  label={s.label}
                  value={voiceSettings.shown[s.key] ?? 0}
                  def={DEFAULT_VOICE_SETTINGS[s.key] ?? 0}
                  min={0}
                  max={1}
                  step={0.05}
                  format={(v) => v.toFixed(2)}
                  onChange={(v) => voiceSettings.onChange({ ...voiceSettings.shown, [s.key]: v })}
                  disabled={disabled}
                  ends={s.key === 'stability' ? voiceSettings.stabilityEnds : s.key === 'similarity_boost' ? ['Low', 'High'] : ['None', 'Exaggerated']}
                  marked={sliderMarked}
                />
              ))}
              <Row name="Speaker boost" changed={boostChanged} note={voiceSettings.custom ? 'Your settings, used from the next sync.' : "The voice's own ElevenLabs settings."}>
                {voiceSettings.custom && (
                  <button type="button" onClick={() => voiceSettings.onChange(null)} disabled={disabled} className="text-xs text-indigo-300 hover:text-indigo-200 cursor-default">
                    Use the voice's own
                  </button>
                )}
                <Switch
                  label="Speaker boost"
                  on={voiceSettings.shown.use_speaker_boost !== false}
                  onChange={(on) => voiceSettings.onChange({ ...voiceSettings.shown, use_speaker_boost: on })}
                  disabled={disabled}
                />
              </Row>
            </>
          )}
        </div>

        {/* Placement */}
        <div className="min-w-0">
          <Cap icon={MoveHorizontal} changed={placeChanged} onReset={resetPlace} disabled={disabled}>
            Placement
          </Cap>
          <Row
            name="Dub length"
            badge={suggested && <span className="text-[10.5px] font-semibold text-amber-300 whitespace-nowrap">● {presetName(suggested).replace(' dub', '')} suggested</span>}
            note={lengthNote}
          >
            <Seg label="Dub length" value={autoLength ? 'auto' : lengthNow} choices={LENGTH_CHOICES} onPick={pickLength} disabled={disabled} suggested={suggested} />
          </Row>
          <Row name="On screen" note={SYNC_SCREEN_OPTIONS.find((s) => s.id === screen)?.hint || 'No extra rule on top of the length.'}>
            <Seg label="On screen" value={screen} choices={SCREEN_CHOICES} onPick={pickScreen} disabled={disabled} />
          </Row>
          <Row
            name="How to voice"
            changed={voicingChanged}
            note={
              options.voicing === 'continuous' && !multiSpeaker
                ? 'Read in one take, then each line is cut from it: the most natural flow, for narration.'
                : 'Each line for its own slot: the best timing.'
            }
          >
            <Seg
              label="How to voice"
              value={multiSpeaker ? 'lines' : options.voicing}
              choices={[
                { id: 'lines', label: 'Line by line' },
                { id: 'continuous', label: 'One read', disabled: multiSpeaker, hint: multiSpeaker ? 'One continuous read is for a dub in one voice.' : undefined },
              ]}
              onPick={(voicing) => onOptionsChange((o) => ({ ...o, voicing }))}
              disabled={disabled}
            />
          </Row>
          <Row name="Timing" changed={precisionChanged} note={`Each line starts within ±${PRECISION_MS[options.precision]} ms of the original.`} below={<TimingPicture ms={PRECISION_MS[options.precision]} />}>
            <Seg label="Timing" value={options.precision} choices={PRECISION_CHOICES} onPick={(precision) => onOptionsChange((o) => ({ ...o, precision }))} disabled={disabled} />
          </Row>
          <Row
            name="Chunk sync"
            changed={joinChanged('chunkSync')}
            note="Splits each line where it goes quiet and places every chunk on the original's words"
            fine={<>{fine('chunkGapShare', !join.chunkSync)}{fine('maxChunkGap', !join.chunkSync)}</>}
            fineChanged={fineChanged('chunkGapShare', 'maxChunkGap')}
          >
            <Switch label="Chunk sync" on={join.chunkSync} onChange={(on) => setJoin('chunkSync', on)} disabled={disabled} />
          </Row>
          <Row name="Close up chunks" nested dim={!join.chunkSync} changed={joinChanged('joinSpokenChunks')} note="Chunks the original says in one go play back to back">
            <Switch label="Close up chunks" on={join.joinSpokenChunks} onChange={(on) => setJoin('joinSpokenChunks', on)} disabled={disabled || !join.chunkSync} />
          </Row>
        </div>

        {/* Pauses, long lines, sound */}
        <div className="min-w-0">
          <Cap icon={Pause} changed={pauseChanged} onReset={() => resetJoin(PAUSE_KEYS)} disabled={disabled}>
            Pauses
          </Cap>
          <Row
            name="Match source pauses"
            changed={joinChanged('matchSourcePauses')}
            note="Pause only where the original speaker paused"
            fine={fine('unmatchedPause', !join.matchSourcePauses)}
            fineChanged={fineChanged('unmatchedPause')}
          >
            <Switch label="Match source pauses" on={join.matchSourcePauses} onChange={(on) => setJoin('matchSourcePauses', on)} disabled={disabled} />
          </Row>
          <Row
            name="Cut at the original's pauses"
            dim={!join.chunkSync}
            changed={joinChanged('cutAtSourcePauses')}
            note={join.chunkSync ? 'Where the voice read on, each part starts where the speaker starts again' : 'Needs Chunk sync'}
            fine={<>{fine('sourceCutMinPause', !join.chunkSync || !join.cutAtSourcePauses)}{fine('sourceCutMaxInsert', !join.chunkSync || !join.cutAtSourcePauses)}</>}
            fineChanged={fineChanged('sourceCutMinPause', 'sourceCutMaxInsert')}
          >
            <Switch label="Cut at the original's pauses" on={join.cutAtSourcePauses} onChange={(on) => setJoin('cutAtSourcePauses', on)} disabled={disabled || !join.chunkSync} />
          </Row>
          <Row
            name="Tighten silences"
            changed={joinChanged('tightenSilences')}
            note="A long line loses room-tone silence; words are never cut"
            fine={<>{fine('tightMinPause', !join.tightenSilences)}{fine('tightMargin', !join.tightenSilences)}</>}
            fineChanged={fineChanged('tightMinPause', 'tightMargin')}
          >
            <Switch label="Tighten silences" on={join.tightenSilences} onChange={(on) => setJoin('tightenSilences', on)} disabled={disabled} />
          </Row>

          <Cap icon={Gauge} changed={longChanged} onReset={() => resetJoin(LONG_KEYS)} disabled={disabled}>
            Long lines
          </Cap>
          <Row name="Read faster" changed={joinChanged('speedFit')} note={fitNote} fine={fine('maxVoiceSpeed', join.speedFit === 'off')} fineChanged={fineChanged('maxVoiceSpeed')}>
            <Seg label="Read faster" value={join.speedFit} choices={FIT_CHOICES} onPick={(mode) => setJoin('speedFit', mode)} disabled={disabled} />
          </Row>
          <Row
            name="Best of three takes"
            changed={joinChanged('bestTakes')}
            note="Voiced twice more; the take that fits best is kept"
            fine={fine('maxRevoice', join.bestTakes === 'off' && join.speedFit === 'off')}
            fineChanged={fineChanged('maxRevoice')}
          >
            <Seg label="Best of three takes" value={join.bestTakes} choices={FIT_CHOICES} onPick={(mode) => setJoin('bestTakes', mode)} disabled={disabled} />
          </Row>

          <Cap icon={Volume2} changed={soundChanged} onReset={resetSound} disabled={disabled}>
            Sound
          </Cap>
          {loudness && (
            <Row
              name={multiSpeaker ? 'Even out speakers' : 'Even out loudness'}
              changed={loudnessChanged}
              note={multiSpeaker ? 'One level per speaker, each keeping its dynamics' : 'Every line at one level'}
            >
              <Switch label={multiSpeaker ? 'Even out speakers' : 'Even out loudness'} on={loudness.value} onChange={loudness.onChange} disabled={disabled} />
            </Row>
          )}
          <Row
            name="Remove breaths"
            changed={joinChanged('removeBreaths')}
            note="Silences the breaths before, between and after the words"
            fine={fine('breathReduction', !join.removeBreaths)}
            fineChanged={fineChanged('breathReduction')}
          >
            <Switch label="Remove breaths" on={join.removeBreaths} onChange={(on) => setJoin('removeBreaths', on)} disabled={disabled} />
          </Row>
          {quality && (
            <Row name="File" note={quality.notice || DUB_AUDIO_QUALITIES.find((q) => q.id === quality.value)?.hint}>
              <Seg
                label="Audio quality"
                value={quality.value}
                choices={DUB_AUDIO_QUALITIES.map((q) => ({ id: q.id, label: QUALITY_SHORT[q.id], hint: q.hint }))}
                onPick={quality.onChange}
                disabled={disabled}
              />
            </Row>
          )}
          {mixPeak && <div className="py-2">{mixPeak}</div>}
        </div>
      </div>

      <div className="flex items-center gap-3 px-5 py-2.5 border-t border-edge text-xs text-slate-500">
        <span className="min-w-0 flex-1 truncate">Gate levels, pads, gaps and fades are in All sync settings.</span>
        <button
          type="button"
          onClick={onOpenAllSettings}
          aria-haspopup="dialog"
          className="h-8 px-3 flex items-center gap-1.5 rounded-[10px] border border-slate-700 text-[12.5px] font-semibold text-slate-200 hover:bg-slate-800 shrink-0 cursor-default"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" /> All sync settings
        </button>
      </div>
    </section>
  );
};
