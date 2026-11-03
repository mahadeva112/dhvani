import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Pause, Play, SlidersHorizontal } from 'lucide-react';
import { SelectedVoiceSummary } from './VoiceSelectorCard';
import { ResetDefaultsButton } from './ResetDefaultsButton';
import { applyJoinPreset, describeChange, joinPresetOf, presetName } from './SyncJoinSettings';
import { SYNC_JOIN_PRESET_OPTIONS, SYNC_SCREEN_OPTIONS, type SyncFitMode, type SyncJoinPreset, type SyncJoinSettings, type SyncOptions, type SyncPrecision, type SyncScreen } from '../services/syncService';
import { DUB_AUDIO_QUALITIES, type DubAudioQuality } from '../services/dubAudioQuality';
import type { ElevenLabsModel, ElevenLabsVoiceSettings, Voice, VoiceExpression } from '../services/elevenLabsService';

/**
 * The Dub step before the first sync: every choice that changes the dub, on
 * one card. Simple shows the few that change it most; Pro shows every one,
 * Voice on the left and Sync on the right. The full sync settings window
 * still holds the rest (gate levels, pads, gaps, fades).
 */

export type DubSettingsView = 'simple' | 'pro';
const VIEW_KEY = 'dhvani_dub_settings_view';

const readView = (): DubSettingsView => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'pro' ? 'pro' : 'simple';
  } catch {
    return 'simple';
  }
};

/** Pro packs its rows closer, so both columns fit the window. */
const DenseContext = createContext(false);

const Row: React.FC<{ name: React.ReactNode; note?: string; badge?: React.ReactNode; title?: string; children: React.ReactNode }> = ({
  name,
  note,
  badge,
  title,
  children,
}) => {
  const dense = useContext(DenseContext);
  return (
    <div className={`flex items-center gap-4 border-b border-slate-800/70 last:border-b-0 ${dense ? 'py-1' : 'py-3.5'}`} title={title}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-100">
          {name}
          {badge}
        </div>
        {note && (
          <div className={`${dense ? 'text-[11.5px]' : 'text-xs'} text-slate-500 truncate`} title={note}>
            {note}
          </div>
        )}
      </div>
      {children}
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
}) => {
  const dense = useContext(DenseContext);
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 gap-0.5 p-[3px] rounded-[11px] bg-slate-950 border border-slate-800">
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
            className={`relative rounded-lg font-semibold whitespace-nowrap transition-colors cursor-default disabled:cursor-not-allowed ${
              dense ? 'px-2.5 py-[3px] text-xs' : 'px-3 py-[5px] text-[12.5px]'
            } ${on ? 'bg-slate-800 text-white shadow-[0_2px_8px_rgba(0,0,0,.35)]' : c.disabled ? 'text-slate-600' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {c.label}
            {suggested === c.id && !on && <span aria-hidden className="absolute top-[3px] right-[3px] w-[5px] h-[5px] rounded-full bg-amber-400" />}
          </button>
        );
      })}
    </div>
  );
};

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

const Cap: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div className="flex items-center gap-2 mt-3 mb-0.5">
    <span className="flex-1 text-[10.5px] uppercase tracking-[.09em] font-semibold text-slate-500">{children}</span>
    {action}
  </div>
);

const LENGTH_CHOICES: Choice<Exclude<SyncJoinPreset, 'custom'>>[] = [
  { id: 'short', label: 'Short' },
  { id: 'natural', label: 'Natural' },
  { id: 'long', label: 'Long' },
  { id: 'vlong', label: 'Very long' },
].map((c) => ({ ...c, hint: SYNC_JOIN_PRESET_OPTIONS.find((p) => p.id === c.id)?.hint })) as Choice<Exclude<SyncJoinPreset, 'custom'>>[];

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
  suggestion?: { preset: Exclude<SyncJoinPreset, 'custom'>; change: number } | null;
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
  const [view, setView] = useState<DubSettingsView>(readView);
  const pro = view === 'pro';
  const pickView = (next: DubSettingsView) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // The view is a convenience; it just isn't remembered.
    }
  };

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
  const setJoin = <K extends keyof SyncJoinSettings>(key: K, value: SyncJoinSettings[K]) =>
    onOptionsChange((o) => {
      const next = { ...o.join, [key]: value };
      return { ...o, join: next, preset: joinPresetOf(next, o.screen) };
    });
  const pickLength = (preset: SyncJoinPreset) => onOptionsChange((o) => applyJoinPreset(o, preset, o.screen ?? 'any'));
  const pickScreen = (screen: SyncScreen) =>
    onOptionsChange((o) => (o.preset === 'custom' ? { ...o, screen } : applyJoinPreset(o, o.preset, screen)));

  const suggested = suggestion && suggestion.preset !== options.preset ? suggestion.preset : null;
  const lengthNote =
    options.preset === 'custom'
      ? 'Custom: your own settings. Picking a length replaces them.'
      : suggestion
        ? `The dub reads ${describeChange(suggestion.change)} than the original${suggestionEstimated ? ', est.' : '.'}`
        : (SYNC_JOIN_PRESET_OPTIONS.find((p) => p.id === options.preset)?.hint ?? '');
  const lengthRow = (
    <Row
      name="Dub length"
      badge={suggested && <span className="text-[10.5px] font-semibold text-amber-300">● {presetName(suggested).replace(' dub', '')} suggested</span>}
      note={lengthNote}
    >
      <Seg
        label="Dub length"
        value={options.preset === 'custom' ? null : options.preset}
        choices={LENGTH_CHOICES}
        onPick={pickLength}
        disabled={disabled}
        suggested={suggested}
      />
    </Row>
  );
  const voicingRow = (
    <Row
      name="How to voice"
      note={
        options.voicing === 'continuous'
          ? 'Read in one take, then each line is cut from it: the most natural flow, for narration.'
          : 'Each line for its own slot: the best timing.'
      }
    >
      <Seg
        label="How to voice"
        value={options.voicing}
        choices={[
          { id: 'lines', label: 'Line by line' },
          { id: 'continuous', label: 'One read', disabled: multiSpeaker, hint: multiSpeaker ? 'One continuous read is for a dub in one voice.' : undefined },
        ]}
        onPick={(voicing) => onOptionsChange((o) => ({ ...o, voicing }))}
        disabled={disabled}
      />
    </Row>
  );
  const timingRow = (
    <Row name="Timing" note={`Each line starts within ±${PRECISION_MS[options.precision]} ms of the original.`}>
      <Seg label="Timing" value={options.precision} choices={PRECISION_CHOICES} onPick={(precision) => onOptionsChange((o) => ({ ...o, precision }))} disabled={disabled} />
    </Row>
  );
  const qualityRow = quality && (
    <Row
      name="File"
      note={quality.notice || DUB_AUDIO_QUALITIES.find((q) => q.id === quality.value)?.hint}
    >
      <Seg
        label="Audio quality"
        value={quality.value}
        choices={DUB_AUDIO_QUALITIES.map((q) => ({ id: q.id, label: QUALITY_SHORT[q.id], hint: q.hint }))}
        onPick={quality.onChange}
        disabled={disabled}
      />
    </Row>
  );

  const voiceBlock = (
    <>
      {cast && <div className="pt-3">{cast}</div>}
      <div className={`flex items-center gap-3 border-b border-slate-800/70 ${pro ? 'pt-3 pb-2.5' : 'pt-4 pb-3.5'}`}>
        <div className="min-w-0 flex-1">
          {multiSpeaker && <span className="block mb-1 text-[10.5px] uppercase tracking-[.09em] font-semibold text-slate-500">Main voice</span>}
          <SelectedVoiceSummary voiceId={voiceId} availableVoices={availableVoices} />
        </div>
        {voiceRateNote && <span className="hidden @md:inline text-[11.5px] text-slate-500 tabular-nums shrink-0">{voiceRateNote}</span>}
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
            className="max-w-[14rem] h-8 bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-[10px] px-2.5 text-[12.5px] font-semibold text-slate-100 truncate focus:outline-none focus:border-indigo-500 cursor-default disabled:opacity-60"
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
      {expression &&
        (() => {
          const current: VoiceExpression = expression.takesCues || expression.value === 'off' ? expression.value : 'neutral';
          return (
            <Row name="Expression" note={`${expressionNote(current, expression.takesCues, expression.cartesia, expression.notTagged)}`}>
              <Seg
                label="Expression"
                value={current}
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
          );
        })()}
    </>
  );

  const sliders = voiceSettings && (
    <>
      <Cap action={<ResetDefaultsButton onClick={voiceSettings.onDefaults} disabled={disabled || voiceSettings.isDefault} />}>Voice settings</Cap>
      {(
        [
          { key: 'stability', label: 'Stability', ends: voiceSettings.stabilityEnds },
          { key: 'similarity_boost', label: 'Similarity', ends: ['Low', 'High'] },
          { key: 'style', label: 'Style exaggeration', ends: ['None', 'Exaggerated'] },
        ] as const
      ).map((s) => {
        const value = voiceSettings.shown[s.key] ?? 0;
        return (
          <div key={s.key} className="grid grid-cols-[9rem_minmax(0,1fr)_2.5rem] items-center gap-3 py-1" title={`${s.ends[0]} ↔ ${s.ends[1]}`}>
            <span className="text-[12.5px] font-semibold text-slate-100">{s.label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={value}
              disabled={disabled}
              aria-label={s.label}
              onChange={(e) => voiceSettings.onChange({ ...voiceSettings.shown, [s.key]: parseFloat(e.target.value) })}
              className="w-full accent-indigo-500 cursor-default disabled:opacity-60"
            />
            <span className="font-mono text-xs text-slate-300 tabular-nums text-right">{value.toFixed(2)}</span>
          </div>
        );
      })}
      <Row name="Speaker boost" note={voiceSettings.custom ? 'Your settings, used from the next sync.' : "The voice's own ElevenLabs settings."}>
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
  );

  const fitNote = paceDirection
    ? `A calm, quicker pace direction, up to ${join.maxVoiceSpeed.toFixed(2)}×`
    : `Read at up to ${join.maxVoiceSpeed.toFixed(2)}× speed`;

  const onByDefault = [
    join.removeBreaths && 'breaths removed',
    loudness?.value && (multiSpeaker ? 'speakers evened out' : 'loudness evened out'),
    join.chunkSync && 'chunk sync',
    join.matchSourcePauses && "pauses matched to the original's",
    join.tightenSilences && 'silences tightened',
  ].filter(Boolean) as string[];

  return (
    <DenseContext.Provider value={pro}>
      <section aria-label="Dub settings" className="@container flex flex-col min-h-0 h-full bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-4 px-5 py-3.5 border-b border-slate-800">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-slate-100">Dub settings</h2>
            <p className="text-xs text-slate-400">
              {pro ? 'Every setting Dub & sync uses. Gate levels, pads and fades are in All sync settings.' : 'The choices that change the dub most. Pro shows every setting.'}
            </p>
          </div>
          <div role="radiogroup" aria-label="Settings view" className="flex p-[3px] gap-0.5 rounded-[11px] bg-slate-950 border border-slate-800">
            {(['simple', 'pro'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => pickView(v)}
                className={`px-3.5 py-1 rounded-lg text-[12.5px] font-semibold cursor-default ${view === v ? 'bg-slate-800 text-white shadow-[0_2px_8px_rgba(0,0,0,.35)]' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {v === 'simple' ? 'Simple' : 'Pro'}
              </button>
            ))}
          </div>
        </div>

        <div className={`flex-1 min-h-0 overflow-y-auto px-5 pb-3 grid grid-cols-1 gap-x-9 ${pro ? '@3xl:grid-cols-2' : ''}`}>
          {pro ? (
            <>
              <div className="min-w-0 flex flex-col justify-between">
                <div>
                  {voiceBlock}
                  {sliders}
                </div>
                <div>
                  <Cap>Sound</Cap>
                  {loudness && (
                    <Row name={multiSpeaker ? 'Even out speakers' : 'Even out loudness'} note={multiSpeaker ? 'One level per speaker, each keeping its dynamics' : 'Every line at one level'}>
                      <Switch label={multiSpeaker ? 'Even out speakers' : 'Even out loudness'} on={loudness.value} onChange={loudness.onChange} disabled={disabled} />
                    </Row>
                  )}
                  <Row name="Remove breaths" note="Silences the breaths before, between and after the words">
                    <Switch label="Remove breaths" on={join.removeBreaths} onChange={(on) => setJoin('removeBreaths', on)} disabled={disabled} />
                  </Row>
                  {qualityRow}
                  {mixPeak && <div className="py-2">{mixPeak}</div>}
                </div>
              </div>
              <div className="min-w-0 flex flex-col justify-between">
                <div>
                  <Cap>Placement</Cap>
                  {lengthRow}
                  <Row name="On screen" note={SYNC_SCREEN_OPTIONS.find((s) => s.id === (options.screen ?? 'any'))?.hint || 'No extra rule on top of the length.'}>
                    <Seg label="On screen" value={options.screen ?? 'any'} choices={SCREEN_CHOICES} onPick={pickScreen} disabled={disabled} />
                  </Row>
                  {voicingRow}
                  {timingRow}
                  <Row name="Chunk sync" note="Splits each line where it goes quiet and places every chunk on the original's words">
                    <Switch label="Chunk sync" on={join.chunkSync} onChange={(on) => setJoin('chunkSync', on)} disabled={disabled} />
                  </Row>
                  <Row name="Close up chunks" note="Chunks the original says in one go play back to back">
                    <Switch label="Close up chunks" on={join.joinSpokenChunks} onChange={(on) => setJoin('joinSpokenChunks', on)} disabled={disabled || !join.chunkSync} />
                  </Row>
                </div>
                <div>
                  <Cap>Pauses and long lines</Cap>
                  <Row name="Match source pauses" note="Pause only where the original speaker paused">
                    <Switch label="Match source pauses" on={join.matchSourcePauses} onChange={(on) => setJoin('matchSourcePauses', on)} disabled={disabled} />
                  </Row>
                  <Row name="Tighten silences" note="A long line loses room-tone silence; words are never cut">
                    <Switch label="Tighten silences" on={join.tightenSilences} onChange={(on) => setJoin('tightenSilences', on)} disabled={disabled} />
                  </Row>
                  <Row name="Read faster" note={fitNote}>
                    <Seg label="Read faster" value={join.speedFit} choices={FIT_CHOICES} onPick={(mode) => setJoin('speedFit', mode)} disabled={disabled} />
                  </Row>
                  <Row name="Best of three takes" note="Voiced twice more; the take that fits best is kept">
                    <Seg label="Best of three takes" value={join.bestTakes} choices={FIT_CHOICES} onPick={(mode) => setJoin('bestTakes', mode)} disabled={disabled} />
                  </Row>
                </div>
              </div>
            </>
          ) : (
            <div className="min-w-0">
              {voiceBlock}
              {lengthRow}
              {voicingRow}
              {timingRow}
              {qualityRow}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-5 py-3 border-t border-slate-800 text-xs text-slate-500">
          <span className="min-w-0 flex-1 truncate">
            {pro || onByDefault.length === 0
              ? 'Changes here apply to the next Dub & sync.'
              : `On: ${onByDefault.join(', ')}.`}
          </span>
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
    </DenseContext.Provider>
  );
};
