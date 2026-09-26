import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { X, Mic, Play, Square, RefreshCw, AlertCircle } from 'lucide-react';
import {
  Voice,
  ElevenLabsModel,
  ElevenLabsUser,
  ElevenLabsVoiceSettings,
  DEFAULT_VOICE_SETTINGS,
  MIN_VOICE_SPEED,
  MAX_VOICE_SPEED,
  ALL_ELEVENLABS_MODELS,
  validateApiKey,
  getModels,
  getVoices,
  synthesizeSamplePreview,
  getVoiceSettings,
} from '../services/elevenLabsService';
import { VoiceSelectorCard } from './VoiceSelectorCard';

interface VoiceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Read-only here: the key is entered in API Settings, not in this modal. */
  elApiKey: string;
  elVoiceId: string;
  onElVoiceIdChange: (voiceId: string) => void;
  elModelId: string;
  onElModelIdChange: (modelId: string) => void;
  /** Null means the selected voice's own ElevenLabs settings are used. */
  elVoiceSettings?: ElevenLabsVoiceSettings | null;
  onElVoiceSettingsChange?: (settings: ElevenLabsVoiceSettings | null) => void;
  availableVoices: Voice[];
  isLoadingVoices: boolean;
  onRefreshVoices: () => void;
  /** Opens the API & translation engine dialog. Hidden when keys are env-managed. */
  onOpenApiSettings?: () => void;
  /** The dub language, so the voice library suggests voices that speak it. */
  targetLanguage?: string;
  /** A line of the current script to preview with; a stock line is used without one. */
  previewText?: string;
}

/** The models most dubs want, in the order they are offered; the rest fold away. */
const PRIMARY_MODELS = ['eleven_v3', 'eleven_multilingual_v2', 'eleven_flash_v2_5'];

/** One plain line per well-known model: what it is good at, and its catch. Cost comes from ElevenLabs, not from here. */
const MODEL_BLURBS: Record<string, string> = {
  eleven_v3: 'Most expressive, 70+ languages. Ignores the speed slider.',
  eleven_multilingual_v2: 'Steady and natural, 29 languages. Smoothest joins on long dubs.',
  eleven_flash_v2_5: 'Fastest, 32 languages. Less expressive.',
  eleven_turbo_v2_5: 'Quick and clear, 32 languages.',
  eleven_flash_v2: 'Fastest, English only.',
  eleven_turbo_v2: 'Quick, English only.',
  eleven_monolingual_v1: 'The original English model.',
  eleven_multilingual_v1: 'The first multilingual model.',
};

/** Speed is ignored by v3 and not accepted by the v1 models. */
const modelTakesSpeed = (modelId: string) => !/^eleven_v3/.test(modelId) && !/_v1$/.test(modelId);

/** Starting points for a custom mix; speaker boost is left as it is. */
const PRESETS: { id: string; label: string; values: Pick<ElevenLabsVoiceSettings, 'stability' | 'similarity_boost' | 'style' | 'speed'> }[] = [
  { id: 'calm', label: 'Calm narrator', values: { stability: 0.7, similarity_boost: 0.8, style: 0, speed: 0.95 } },
  { id: 'natural', label: 'Natural talk', values: { stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1 } },
  { id: 'lively', label: 'Lively', values: { stability: 0.3, similarity_boost: 0.75, style: 0.35, speed: 1.05 } },
];

const STOCK_PREVIEW: Record<string, string> = {
  Hindi: 'नमस्कार। चलिए, एक सीधे सवाल से शुरू करते हैं।',
  Tamil: 'வணக்கம். ஒரு எளிய கேள்வியுடன் தொடங்குவோம்.',
  Telugu: 'నమస్కారం. ఒక సులభమైన ప్రశ్నతో మొదలుపెడదాం.',
  Bengali: 'নমস্কার। একটা সহজ প্রশ্ন দিয়ে শুরু করি।',
  Marathi: 'नमस्कार. एका सोप्या प्रश्नाने सुरुवात करूया.',
};

const near = (a: number | undefined, b: number | undefined) => Math.abs((a ?? 0) - (b ?? 0)) < 0.001;

const initialOf = (name: string) => (name.trim().charAt(0) || '?').toUpperCase();

export const VoiceSettingsModal: React.FC<VoiceSettingsModalProps> = ({
  isOpen,
  onClose,
  elApiKey,
  elVoiceId,
  onElVoiceIdChange,
  elModelId,
  onElModelIdChange,
  elVoiceSettings = null,
  onElVoiceSettingsChange,
  availableVoices,
  isLoadingVoices,
  onRefreshVoices,
  onOpenApiSettings,
  targetLanguage = 'Hindi',
  previewText,
}) => {
  const [validationStatus, setValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [userInfo, setUserInfo] = useState<ElevenLabsUser | null>(null);
  const [modelsList, setModelsList] = useState<ElevenLabsModel[]>(ALL_ELEVENLABS_MODELS);
  const [realtimeVoices, setRealtimeVoices] = useState<Voice[]>([]);
  const [showAllModels, setShowAllModels] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Preview: 'sample' is the voice's stock clip, 'line' is the line below spoken with these settings.
  const [playing, setPlaying] = useState<'sample' | 'line' | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [tryText, setTryText] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // A fresh line each time the window opens: the current script's, or a stock one.
  useEffect(() => {
    if (isOpen) setTryText(previewText?.trim() || STOCK_PREVIEW[targetLanguage] || 'Hello, this is how your dub will sound.');
  }, [isOpen, previewText, targetLanguage]);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlaying(null);
  }, []);
  useEffect(() => {
    if (!isOpen) stopAudio();
  }, [isOpen, stopAudio]);

  /*
   * The selected voice's own ElevenLabs settings. They are what a dub uses
   * until the sliders are moved, so the sliders show them rather than a
   * generic default.
   */
  const [voiceOwnSettings, setVoiceOwnSettings] = useState<ElevenLabsVoiceSettings | null>(null);
  useEffect(() => {
    if (!isOpen || !elVoiceId) return;
    let cancelled = false;
    setVoiceOwnSettings(null);
    getVoiceSettings(elApiKey, elVoiceId)
      .then((settings) => !cancelled && setVoiceOwnSettings(settings))
      .catch(() => !cancelled && setVoiceOwnSettings(null));
    return () => {
      cancelled = true;
    };
  }, [isOpen, elApiKey, elVoiceId]);

  const usingVoiceOwnSettings = !elVoiceSettings;
  const shownSettings = elVoiceSettings || voiceOwnSettings || DEFAULT_VOICE_SETTINGS;

  // Checks the key and loads the live voice and model lists.
  const handleValidateApiKey = useCallback(
    async (keyToValidate: string) => {
      const cleanKey = keyToValidate.trim();
      if (!cleanKey) {
        setValidationStatus('idle');
        return;
      }
      setValidationStatus('validating');
      setValidationError(null);
      try {
        const result = await validateApiKey(cleanKey);
        if (!result.isValid || !result.user) {
          setValidationStatus('invalid');
          setValidationError(result.error || 'ElevenLabs did not accept the key.');
          setUserInfo(null);
          return;
        }
        setValidationStatus('valid');
        setUserInfo(result.user);
        const [voices, models] = await Promise.all([getVoices(cleanKey), getModels(cleanKey)]);
        setRealtimeVoices(voices);
        if (models && models.length > 0) setModelsList(models);
        // A voice missing from the list is reported, not swapped: opening settings never changes the voice.
      } catch (err: any) {
        setValidationStatus('invalid');
        setValidationError(err?.message || 'Could not reach ElevenLabs.');
        setUserInfo(null);
      }
    },
    []
  );

  useEffect(() => {
    if (isOpen && elApiKey && elApiKey.trim().length > 10 && validationStatus === 'idle') {
      handleValidateApiKey(elApiKey);
    }
  }, [isOpen, elApiKey, handleValidateApiKey, validationStatus]);

  const voices = realtimeVoices.length > 0 ? realtimeVoices : availableVoices;
  const selectedVoice = useMemo(() => voices.find((v) => v.voice_id === elVoiceId) || null, [voices, elVoiceId]);
  const voicesLoaded = voices.length > 0;
  const voiceFullName = (
    selectedVoice?.name || (voicesLoaded ? 'Not in your voice library' : 'Loading voices…')
  ).trim();
  const [voiceName, ...taglineParts] = voiceFullName.split(/\s+[-–—|]\s+/);
  const voiceTagline =
    taglineParts.join(' – ') ||
    [selectedVoice?.labels?.use_case, selectedVoice?.labels?.description].filter(Boolean).join(' · ');
  const voiceTags = [
    selectedVoice?.labels?.accent,
    selectedVoice?.labels?.gender,
    selectedVoice?.labels?.age,
  ]
    .filter(Boolean)
    .map((t) => String(t).replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));

  const ttsModels = useMemo(() => {
    const list = modelsList.filter((m) => m.can_do_text_to_speech !== false);
    // The chosen model always shows, even when it is not one of the usual three.
    const primary = PRIMARY_MODELS.map((id) => list.find((m) => m.model_id === id)).filter(Boolean) as ElevenLabsModel[];
    const rest = list.filter((m) => !PRIMARY_MODELS.includes(m.model_id));
    return { primary, rest };
  }, [modelsList]);
  const selectedIsExtra = ttsModels.rest.some((m) => m.model_id === elModelId);
  const shownModels = showAllModels || selectedIsExtra ? [...ttsModels.primary, ...ttsModels.rest] : ttsModels.primary;

  const takesSpeed = modelTakesSpeed(elModelId);
  const activePreset = usingVoiceOwnSettings
    ? null
    : PRESETS.find(
        (p) =>
          near(p.values.stability, shownSettings.stability) &&
          near(p.values.similarity_boost, shownSettings.similarity_boost) &&
          near(p.values.style, shownSettings.style) &&
          near(p.values.speed, shownSettings.speed ?? 1)
      )?.id ?? null;

  const update = (patch: Partial<ElevenLabsVoiceSettings>) =>
    onElVoiceSettingsChange?.({ ...DEFAULT_VOICE_SETTINGS, ...shownSettings, ...patch });

  const playSample = () => {
    if (playing === 'sample') return stopAudio();
    stopAudio();
    if (!selectedVoice?.preview_url) return;
    const audio = new Audio(selectedVoice.preview_url);
    audioRef.current = audio;
    setPlaying('sample');
    audio.onended = () => setPlaying(null);
    audio.play().catch(() => setPlaying(null));
  };

  const playLine = async () => {
    if (playing === 'line') return stopAudio();
    stopAudio();
    if (!tryText.trim() || isSynthesizing) return;
    setIsSynthesizing(true);
    setPreviewError(null);
    try {
      // Spoken with the settings shown, so moving a slider and listening again compares them.
      const blob = await synthesizeSamplePreview(elApiKey, elVoiceId, tryText.trim(), elModelId, elVoiceSettings);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      setPlaying('line');
      audio.onended = () => {
        setPlaying(null);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch (e: any) {
      setPlaying(null);
      setPreviewError(e?.message || 'The preview could not be made.');
    } finally {
      setIsSynthesizing(false);
    }
  };

  if (!isOpen) return null;

  const slider = (
    label: string,
    hint: string,
    value: number,
    onChange: (v: number) => void,
    ends: [string, string],
    opts: { min?: number; max?: number; word?: string; format?: (v: number) => string; disabled?: boolean; note?: string } = {}
  ) => (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-slate-100">{label}</span>
        <span className="font-mono text-xs text-slate-100 tabular-nums">
          {(opts.format || ((v: number) => v.toFixed(2)))(value)}
          {opts.word && <span className="font-sans text-slate-400 ml-1.5">{opts.word}</span>}
        </span>
      </div>
      <p className={`text-[11.5px] mt-0.5 mb-2 ${opts.note ? 'text-amber-300' : 'text-slate-400'}`}>{opts.note || hint}</p>
      <input
        type="range"
        min={opts.min ?? 0}
        max={opts.max ?? 1}
        step={0.05}
        value={value}
        disabled={opts.disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={label}
        className="w-full accent-indigo-500 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
      />
      <div className="flex justify-between text-[10.5px] text-slate-500 mt-0.5">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  );

  const stability = shownSettings.stability ?? 0.5;
  const style = shownSettings.style ?? 0;

  return (
    <div
      id="voice-settings-modal"
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-settings-title"
        className="w-full max-w-[58rem] min-h-full sm:min-h-0 sm:my-auto sm:max-h-[calc(100vh-3rem)] flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3.5 px-5 sm:px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-slate-100 text-slate-950 flex items-center justify-center shrink-0" aria-hidden="true">
            <Mic className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="voice-settings-title" className="text-lg font-semibold text-slate-100 leading-tight">
              Voice settings
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5">How the dub sounds. Changes apply to the next dub.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid md:grid-cols-[20rem_minmax(0,1fr)]">
          {/* Left: who speaks, and with which model */}
          <div className="px-5 py-5 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950/40 flex flex-col gap-5 min-w-0">
            <div className="flex flex-col gap-2">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Voice</span>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-900 border border-slate-800">
                <span className="w-[42px] h-[42px] rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white font-semibold flex items-center justify-center shrink-0">
                  {initialOf(voiceName)}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-100 truncate" title={voiceFullName}>
                    {voiceName}
                  </span>
                  {voiceTagline && <span className="block text-xs text-slate-400 truncate">{voiceTagline}</span>}
                  {!selectedVoice && voicesLoaded && (
                    <span className="block text-xs text-amber-300">It may still dub; choose one from your library to be sure.</span>
                  )}
                  {voiceTags.length > 0 && (
                    <span className="flex flex-wrap gap-1 mt-1.5">
                      {voiceTags.map((t) => (
                        <span key={t} className="text-[10px] font-medium px-1.5 py-px rounded-md bg-slate-950 border border-slate-800 text-slate-400">
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={playSample}
                  disabled={!selectedVoice?.preview_url}
                  className="h-[34px] flex items-center justify-center gap-1.5 rounded-[9px] border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title="The voice's own sample from ElevenLabs"
                >
                  {playing === 'sample' ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                  {playing === 'sample' ? 'Stop' : 'Sample'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsPickerOpen(true)}
                  className="h-[34px] rounded-[9px] border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-pointer"
                >
                  Change voice
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="flex items-center justify-between text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                Model
                <a
                  href="https://elevenlabs.io/docs/models"
                  target="_blank"
                  rel="noreferrer"
                  className="normal-case tracking-normal text-[11.5px] font-medium text-indigo-400 hover:text-indigo-300"
                >
                  Compare
                </a>
              </span>
              <div role="radiogroup" aria-label="Speech model" className="flex flex-col gap-1.5">
                {shownModels.map((m) => {
                  const on = m.model_id === elModelId;
                  const half = (m.token_cost_factor ?? 1) < 1;
                  return (
                    <button
                      key={m.model_id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => onElModelIdChange(m.model_id)}
                      className={`flex items-start gap-2.5 p-2.5 rounded-[11px] border text-left transition-colors cursor-pointer ${
                        on ? 'border-indigo-500 bg-slate-900 ring-4 ring-indigo-500/10' : 'border-slate-800 bg-slate-900 hover:bg-slate-800/60'
                      }`}
                    >
                      <span
                        className={`w-[15px] h-[15px] mt-0.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${
                          on ? 'border-indigo-400' : 'border-slate-600'
                        }`}
                      >
                        {on && <span className="w-[7px] h-[7px] rounded-full bg-indigo-400" />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-100">
                          {m.name}
                          <span
                            className={`font-mono text-[10px] font-medium px-1 rounded border ${
                              half ? 'text-emerald-300 border-emerald-500/35' : 'text-slate-400 border-slate-700'
                            }`}
                            title={half ? 'Uses half the characters' : 'Standard character cost'}
                          >
                            {half ? '½×' : `${m.token_cost_factor ?? 1}×`}
                          </span>
                        </span>
                        <span className="block text-[11.5px] text-slate-400 mt-0.5 leading-snug line-clamp-2">
                          {MODEL_BLURBS[m.model_id] || m.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {ttsModels.rest.length > 0 && !selectedIsExtra && (
                <button
                  type="button"
                  onClick={() => setShowAllModels((v) => !v)}
                  className="self-start text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  {showAllModels ? 'Show fewer models' : `Show ${ttsModels.rest.length} more models`}
                </button>
              )}
            </div>

            <div className="md:mt-auto flex items-center gap-2 text-xs text-slate-400">
              <span
                className={`w-[7px] h-[7px] rounded-full shrink-0 ${
                  validationStatus === 'valid'
                    ? 'bg-emerald-400'
                    : validationStatus === 'invalid'
                      ? 'bg-rose-400'
                      : 'bg-slate-500 animate-pulse'
                }`}
              />
              <span className="min-w-0 truncate" title={validationError || undefined}>
                {validationStatus === 'valid'
                  ? `ElevenLabs connected${userInfo?.subscription.tier ? ` · ${userInfo.subscription.tier}` : ''}`
                  : validationStatus === 'invalid'
                    ? validationError || 'ElevenLabs is not connected'
                    : 'Checking ElevenLabs…'}
              </span>
              {validationStatus === 'invalid' ? (
                <button
                  type="button"
                  onClick={() => {
                    handleValidateApiKey(elApiKey);
                    onRefreshVoices();
                  }}
                  className="ml-auto flex items-center gap-1 text-indigo-400 hover:text-indigo-300 shrink-0 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" /> Re-check
                </button>
              ) : (
                onOpenApiSettings && (
                  <button type="button" onClick={onOpenApiSettings} className="ml-auto text-indigo-400 hover:text-indigo-300 shrink-0 cursor-pointer">
                    Manage key
                  </button>
                )
              )}
            </div>
          </div>

          {/* Right: how it is delivered */}
          <div className="px-5 sm:px-6 py-5 flex flex-col gap-5 min-w-0">
            <div className="flex flex-col gap-2">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Delivery</span>
              <div role="radiogroup" aria-label="Delivery settings" className="grid sm:grid-cols-2 gap-2">
                {[
                  {
                    own: true,
                    title: `${selectedVoice ? `${voiceName}'s` : "The voice's"} own settings`,
                    blurb: 'Sounds as the voice does on the ElevenLabs website. Recommended.',
                  },
                  {
                    own: false,
                    title: 'Custom',
                    blurb: 'Your own mix for this voice. Picking another voice goes back to its own settings.',
                  },
                ].map((o) => {
                  const on = usingVoiceOwnSettings === o.own;
                  return (
                    <button
                      key={o.title}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={!onElVoiceSettingsChange}
                      onClick={() =>
                        o.own ? onElVoiceSettingsChange?.(null) : usingVoiceOwnSettings && update({})
                      }
                      className={`flex items-start gap-2.5 p-3 rounded-[11px] border text-left transition-colors cursor-pointer ${
                        on ? 'border-indigo-500 bg-indigo-950/40 ring-4 ring-indigo-500/10' : 'border-slate-800 hover:bg-slate-800/40'
                      }`}
                    >
                      <span
                        className={`w-[15px] h-[15px] mt-0.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${
                          on ? 'border-indigo-400' : 'border-slate-600'
                        }`}
                      >
                        {on && <span className="w-[7px] h-[7px] rounded-full bg-indigo-400" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-slate-100">{o.title}</span>
                        <span className="block text-[11.5px] text-slate-400 mt-0.5 leading-snug">{o.blurb}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {usingVoiceOwnSettings ? (
              <p className="text-[12.5px] text-slate-400 px-3 py-2.5 rounded-[11px] border border-slate-800">
                {voiceOwnSettings
                  ? `Using the saved settings: stability ${(voiceOwnSettings.stability ?? 0.5).toFixed(2)}, similarity ${(
                      voiceOwnSettings.similarity_boost ?? 0.75
                    ).toFixed(2)}, style ${(voiceOwnSettings.style ?? 0).toFixed(2)}, speaker boost ${
                      voiceOwnSettings.use_speaker_boost === false ? 'off' : 'on'
                    }.`
                  : 'Loading the voice’s saved settings…'}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <div role="group" aria-label="Starting points" className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={activePreset === p.id}
                      onClick={() => update(p.values)}
                      className={`px-3 py-1.5 rounded-full border text-xs font-medium transition-colors cursor-pointer ${
                        activePreset === p.id
                          ? 'bg-slate-100 text-slate-900 border-slate-100'
                          : 'border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {slider(
                  'Stability',
                  'Lower lets the delivery move with the words; higher keeps it even.',
                  stability,
                  (v) => update({ stability: v }),
                  ['Expressive', 'Even'],
                  { word: stability < 0.35 ? 'Expressive' : stability > 0.7 ? 'Even' : 'Natural' }
                )}
                {slider(
                  'Similarity',
                  'How closely it holds to the original voice.',
                  shownSettings.similarity_boost ?? 0.75,
                  (v) => update({ similarity_boost: v }),
                  ['Looser', 'Closer']
                )}
                {slider(
                  'Style',
                  'Adds the voice’s character. Above 0 can sound theatrical.',
                  style,
                  (v) => update({ style: v }),
                  ['Plain', 'Dramatic'],
                  { word: style === 0 ? 'Plain' : style < 0.4 ? 'Some character' : 'Dramatic' }
                )}
                {slider(
                  'Speed',
                  'Slower gives the voice room; faster helps a line fit its slot.',
                  shownSettings.speed ?? 1,
                  (v) => update({ speed: v }),
                  [`${MIN_VOICE_SPEED.toFixed(2)}× slower`, `${MAX_VOICE_SPEED.toFixed(2)}× faster`],
                  {
                    min: MIN_VOICE_SPEED,
                    max: MAX_VOICE_SPEED,
                    format: (v) => `${v.toFixed(2)}×`,
                    disabled: !takesSpeed,
                    note: takesSpeed
                      ? undefined
                      : /^eleven_v3/.test(elModelId)
                        ? 'Eleven v3 ignores speed. Shorten the lines in Review instead.'
                        : 'This model does not take a speed setting.',
                  }
                )}

                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-slate-100">Speaker boost</span>
                    <span className="block text-[11.5px] text-slate-400">Sharpens the likeness a little; takes slightly longer.</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shownSettings.use_speaker_boost !== false}
                    aria-label="Speaker boost"
                    onClick={() => update({ use_speaker_boost: shownSettings.use_speaker_boost === false })}
                    className={`relative w-[34px] h-5 rounded-full shrink-0 transition-colors cursor-pointer ${
                      shownSettings.use_speaker_boost !== false ? 'bg-indigo-500' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white transition-all ${
                        shownSettings.use_speaker_boost !== false ? 'left-[17px]' : 'left-[3px]'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* Try it */}
            <div className="flex flex-col gap-2">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Try it</span>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 flex flex-col gap-2.5">
                <textarea
                  id="voice-settings-try"
                  rows={2}
                  value={tryText}
                  onChange={(e) => setTryText(e.target.value)}
                  aria-label="Line to preview"
                  className="w-full resize-none bg-transparent outline-none text-[15px] leading-relaxed text-slate-100"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={playLine}
                    disabled={!tryText.trim() || validationStatus === 'invalid'}
                    className="flex items-center gap-2 h-9 pl-1.5 pr-3.5 rounded-full bg-slate-100 hover:bg-white text-slate-950 text-[12.5px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span className="w-6 h-6 rounded-full bg-slate-950 text-slate-100 flex items-center justify-center">
                      {isSynthesizing ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : playing === 'line' ? (
                        <Square className="w-2.5 h-2.5 fill-current" />
                      ) : (
                        <Play className="w-2.5 h-2.5 fill-current ml-px" />
                      )}
                    </span>
                    {isSynthesizing ? 'Making it…' : playing === 'line' ? 'Stop' : 'Hear it'}
                  </button>
                  <span className="flex items-center gap-[2px] h-5 flex-1 min-w-[5rem]" aria-hidden="true">
                    {Array.from({ length: 30 }, (_, i) => (
                      <span
                        key={i}
                        className={`w-[3px] rounded-sm ${playing === 'line' ? 'bg-indigo-400 animate-pulse' : 'bg-slate-700'}`}
                        style={{ height: `${5 + Math.abs(Math.sin(i * 1.3)) * 15}px`, animationDelay: `${(i * 37) % 600}ms` }}
                      />
                    ))}
                  </span>
                  <span className="font-mono text-[11.5px] text-slate-500 tabular-nums">{tryText.length} characters</span>
                </div>
                {previewError && (
                  <p className="flex items-start gap-1.5 text-xs text-rose-300">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {previewError}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-3 px-5 sm:px-6 py-3.5 border-t border-slate-800 shrink-0">
          <span className="flex-1 min-w-[12rem] text-xs text-slate-400">Saved on this computer. Applies to the next dub.</span>
          {onElVoiceSettingsChange && (
            <button
              type="button"
              onClick={() => onElVoiceSettingsChange(null)}
              disabled={usingVoiceOwnSettings}
              className="text-[12.5px] text-slate-400 hover:text-slate-200 disabled:opacity-40 disabled:cursor-default px-1 cursor-pointer"
            >
              Reset to voice’s own
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-[38px] px-5 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13.5px] font-semibold cursor-pointer"
          >
            Done
          </button>
        </div>
      </section>

      {/* The full voice library, the same one Step 1 and Step 3 use */}
      {isPickerOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a voice"
          onClick={(e) => e.target === e.currentTarget && setIsPickerOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setIsPickerOpen(false)}
        >
          <div className="w-full max-w-5xl flex flex-col gap-3">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setIsPickerOpen(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" /> Done
              </button>
            </div>
            <VoiceSelectorCard
              elVoiceId={elVoiceId}
              onElVoiceIdChange={onElVoiceIdChange}
              availableVoices={voices}
              targetLanguage={targetLanguage}
              className="h-[78vh]"
            />
          </div>
        </div>
      )}
    </div>
  );
};
