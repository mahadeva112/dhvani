import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Play,
  Square,
  RefreshCw,
  Download,
  Check,
  AlertCircle,
  Film,
  Trash2,
  Speech,
  AudioLines,
  Columns2,
  Dices,
  FileText,
  Lock,
  Unlock,
} from 'lucide-react';
import {
  synthesizeSpeech,
  getModels,
  getVoiceSettings,
  getDubProgress,
  cancelDub,
  Voice,
  ElevenLabsModel,
  ElevenLabsVoiceSettings,
  DubProgress,
  DEFAULT_VOICE_SETTINGS,
  ALL_ELEVENLABS_MODELS,
  MIN_VOICE_SPEED,
  MAX_VOICE_SPEED,
  ELEVEN_V3_AUDIO_TAGS,
  DEFAULT_ELEVENLABS_MODEL,
  performsAudioTags,
  modelTakesSpeed,
  isElevenLabsDefault,
} from '../services/elevenLabsService';
import { ResetDefaultsButton } from './ResetDefaultsButton';
import {
  synthesizeWithCartesia,
  isCartesiaVoice,
  CARTESIA_MODELS,
  CARTESIA_EMOTIONS,
  MIN_CARTESIA_SPEED,
  MAX_CARTESIA_SPEED,
} from '../services/cartesiaService';
import { audioFileExtension, createWavBlobFromPcm, decodeAudioBlobUrl } from '../services/audioService';
import { POPULAR_ELEVENLABS_VOICES, VoiceSelectorCard, VoiceEngine, VOICE_ENGINE_LABELS } from './VoiceSelectorCard';
import { MiniWaveform } from './MediaStrip';
import { DEFAULT_LANGUAGES } from './ProHeader';

/**
 * Text to speech studio.
 *
 * A standalone place to voice any text with either engine, outside the dub
 * pipeline: pick a voice and model, tune the delivery, and keep every take
 * side by side so ElevenLabs and Cartesia can be compared on the same line.
 */

const DRAFT_KEY = 'dhvani_tts_studio_draft';
const PREFS_KEY = 'dhvani_tts_studio_prefs';
const DEFAULT_ELEVENLABS_VOICE = '21m00Tcm4TlvDq8ikWAM';
/** Takes kept in the list; the oldest finished ones go first. */
const MAX_TAKES = 12;
/** Rough speaking rate, for the length estimate before anything is generated. */
const CHARS_PER_SECOND = 14;

const OUTPUT_FORMATS: { id: string; label: string; hint?: string }[] = [
  { id: 'mp3_44100_128', label: 'MP3 · 44.1 kHz · 128 kbps' },
  { id: 'mp3_44100_192', label: 'MP3 · 44.1 kHz · 192 kbps', hint: 'ElevenLabs Creator plan or above' },
  { id: 'pcm_44100', label: 'WAV · 44.1 kHz', hint: 'ElevenLabs Pro plan or above' },
  { id: 'pcm_24000', label: 'WAV · 24 kHz' },
];

const LANGUAGES = [{ code: 'English', label: 'English' }, ...DEFAULT_LANGUAGES];

interface StudioPrefs {
  engine: VoiceEngine;
  language: string;
  outputFormat: string;
  voices: Partial<Record<VoiceEngine, string>>;
  el: {
    modelId: string;
    useOwnSettings: boolean;
    settings: ElevenLabsVoiceSettings;
    expressive: boolean;
    seedLocked: boolean;
    seed: number;
  };
  cartesia: { modelId: string; speed: number; volume: number; emotion: string };
}

type TakeStatus = 'running' | 'done' | 'failed' | 'cancelled';

interface Take {
  id: string;
  engine: VoiceEngine;
  voiceName: string;
  modelLabel: string;
  text: string;
  format: string;
  seed?: number;
  status: TakeStatus;
  progress?: DubProgress | null;
  error?: string;
  blob?: Blob;
  url?: string;
  buffer?: AudioBuffer;
  createdAt: number;
}

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `tts-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

/** 125 -> "2:05" */
const formatLength = (seconds: number) => {
  const t = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const shortName = (name?: string) => (name || '').trim().split(/\s+[-–—|]\s+/)[0];

const readPrefs = (fallbackModel: string): StudioPrefs => {
  const base: StudioPrefs = {
    engine: 'elevenlabs',
    language: 'Hindi',
    outputFormat: 'mp3_44100_128',
    voices: {},
    el: {
      modelId: fallbackModel || DEFAULT_ELEVENLABS_MODEL,
      useOwnSettings: true,
      settings: { ...DEFAULT_VOICE_SETTINGS },
      expressive: false,
      seedLocked: false,
      seed: randomSeed(),
    },
    cartesia: { modelId: CARTESIA_MODELS[0].id, speed: 1, volume: 1, emotion: '' },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (!saved) return base;
    return {
      ...base,
      ...saved,
      el: { ...base.el, ...saved.el, settings: { ...base.el.settings, ...saved.el?.settings } },
      cartesia: { ...base.cartesia, ...saved.cartesia },
      voices: { ...saved.voices },
    };
  } catch {
    return base;
  }
};

const primaryButton =
  'h-[42px] px-[18px] flex items-center gap-2 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13.5px] font-semibold whitespace-nowrap transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer';

const secondaryButton =
  'h-[42px] px-4 flex items-center gap-2 rounded-[10px] border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-[13px] font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';

const smallButton =
  'h-7 px-2 flex items-center gap-1.5 rounded-[8px] border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[11.5px] font-medium text-slate-300 transition-colors disabled:opacity-40 cursor-pointer';

const field =
  'w-full h-10 bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-[10px] px-3 text-[13px] text-slate-100 placeholder-slate-500 focus:outline-none';

interface TextToSpeechModalProps {
  isOpen: boolean;
  onClose: () => void;
  elApiKey: string;
  availableVoices: Voice[];
  /** The dub's voice, used as the starting voice for its engine. */
  selectedVoiceId: string;
  /** The dub's ElevenLabs model, used until the studio has its own. */
  elModelId: string;
  /** True when a Cartesia key is set up. */
  cartesiaAvailable?: boolean;
  targetLanguage?: string;
  /** The project's dub script, offered as text to start from. */
  projectScript?: string;
  /** Makes a take the project's finished dub. Absent when no project is open. */
  onSetDubbedMaster?: (audioBlob: Blob, audioBuffer: AudioBuffer) => void;
  /** Called after a take finishes, e.g. to refresh the credit counter. */
  onGenerated?: () => void;
}

export const TextToSpeechModal: React.FC<TextToSpeechModalProps> = ({
  isOpen,
  onClose,
  elApiKey,
  availableVoices,
  selectedVoiceId,
  elModelId,
  cartesiaAvailable = false,
  targetLanguage = 'Hindi',
  projectScript,
  onSetDubbedMaster,
  onGenerated,
}) => {
  const [prefs, setPrefs] = useState<StudioPrefs>(() => {
    const saved = readPrefs(elModelId);
    const hadPrefs = (() => {
      try {
        return Boolean(localStorage.getItem(PREFS_KEY));
      } catch {
        return false;
      }
    })();
    if (!hadPrefs) saved.language = targetLanguage;
    // The dub's voice seeds its engine until the studio has its own pick.
    const dubEngine: VoiceEngine = isCartesiaVoice(selectedVoiceId) ? 'cartesia' : 'elevenlabs';
    if (selectedVoiceId && !saved.voices[dubEngine]) saved.voices = { ...saved.voices, [dubEngine]: selectedVoiceId };
    if (!hadPrefs) saved.engine = dubEngine;
    return saved;
  });
  const [text, setText] = useState<string>(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) || '';
    } catch {
      return '';
    }
  });
  const [models, setModels] = useState<ElevenLabsModel[]>(ALL_ELEVENLABS_MODELS);
  const [ownSettings, setOwnSettings] = useState<ElevenLabsVoiceSettings | null>(null);
  const [takes, setTakes] = useState<Take[]>([]);
  const [playingTakeId, setPlayingTakeId] = useState<string | null>(null);
  const [auditioning, setAuditioning] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const auditionRef = useRef<HTMLAudioElement | null>(null);
  /** What cancelling a running take needs, by take id. */
  const runsRef = useRef(new Map<string, { jobId: string; controller: AbortController }>());
  const urlsRef = useRef(new Set<string>());

  // Cartesia falls back to ElevenLabs when its key is removed.
  const engine: VoiceEngine = prefs.engine === 'cartesia' && !cartesiaAvailable ? 'elevenlabs' : prefs.engine;

  const persist = useCallback((next: StudioPrefs) => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {}
  }, []);
  const updatePrefs = useCallback(
    (patch: (p: StudioPrefs) => StudioPrefs) =>
      setPrefs((prev) => {
        const next = patch(prev);
        persist(next);
        return next;
      }),
    [persist]
  );
  const setEl = (patch: Partial<StudioPrefs['el']>) => updatePrefs((p) => ({ ...p, el: { ...p.el, ...patch } }));
  const setCartesia = (patch: Partial<StudioPrefs['cartesia']>) =>
    updatePrefs((p) => ({ ...p, cartesia: { ...p.cartesia, ...patch } }));

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, text);
    } catch {}
  }, [text]);

  // The live model list, once per opening.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    getModels(elApiKey).then((list) => {
      if (!cancelled && list.length) setModels(list.filter((m) => m.can_do_text_to_speech !== false));
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, elApiKey]);

  const engineVoices = useMemo(
    () => availableVoices.filter((v) => (engine === 'cartesia') === isCartesiaVoice(v.voice_id)),
    [availableVoices, engine]
  );

  /** The voice for an engine: the studio's pick, else the first one available. */
  const voiceIdFor = useCallback(
    (e: VoiceEngine): string => {
      const picked = prefs.voices[e];
      if (picked) return picked;
      if (e === 'elevenlabs') return DEFAULT_ELEVENLABS_VOICE;
      return availableVoices.find((v) => isCartesiaVoice(v.voice_id))?.voice_id || '';
    },
    [prefs.voices, availableVoices]
  );
  const voiceId = voiceIdFor(engine);

  const describeVoice = useCallback(
    (id: string) => {
      const live = availableVoices.find((v) => v.voice_id === id);
      const builtIn = POPULAR_ELEVENLABS_VOICES.find((v) => v.id === id);
      const full = (live?.name || builtIn?.name || '').trim();
      const meta = [live?.labels?.accent || builtIn?.accent, live?.labels?.gender || builtIn?.gender]
        .filter(Boolean)
        .map((t) => String(t).replace(/[_-]+/g, ' '))
        .join(' · ');
      return { name: shortName(full) || (id ? 'Unknown voice' : 'Choose a voice'), full, meta, preview: live?.preview_url || builtIn?.previewUrl };
    },
    [availableVoices]
  );
  const voice = describeVoice(voiceId);

  // The voice's own ElevenLabs settings, shown when they are in use and used as the start for custom ones.
  useEffect(() => {
    if (!isOpen || engine !== 'elevenlabs' || !voiceId) return;
    let cancelled = false;
    setOwnSettings(null);
    getVoiceSettings(elApiKey, voiceId)
      .then((s) => !cancelled && setOwnSettings(s))
      .catch(() => !cancelled && setOwnSettings({ ...DEFAULT_VOICE_SETTINGS }));
    return () => {
      cancelled = true;
    };
  }, [isOpen, engine, voiceId, elApiKey]);

  // Stop audio and release object URLs when the studio goes away.
  useEffect(
    () => () => {
      playerRef.current?.pause();
      auditionRef.current?.pause();
      runsRef.current.forEach((run) => run.controller.abort());
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    []
  );

  const elModel = models.find((m) => m.model_id === prefs.el.modelId) ||
    ALL_ELEVENLABS_MODELS.find((m) => m.model_id === prefs.el.modelId);
  const takesTags = performsAudioTags(prefs.el.modelId);
  const isV3 = /^eleven_v3/.test(prefs.el.modelId);
  const speedApplies = modelTakesSpeed(prefs.el.modelId);
  const cartesiaModel = CARTESIA_MODELS.find((m) => m.id === prefs.cartesia.modelId);
  const cartesiaControls = /^sonic-3/.test(prefs.cartesia.modelId);

  const chars = text.trim().length;
  const estimatedSeconds = chars / CHARS_PER_SECOND;
  const creditsFor = (e: VoiceEngine) =>
    Math.ceil(chars * (e === 'elevenlabs' ? elModel?.token_cost_factor ?? 1 : 1));

  const running = takes.some((t) => t.status === 'running');

  const updateTake = (id: string, patch: Partial<Take>) =>
    setTakes((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  /** Voices the current text on one engine with that engine's settings, as a new take. */
  const runTake = async (e: VoiceEngine) => {
    const script = text.trim();
    const takeVoiceId = voiceIdFor(e);
    if (!script) {
      setErrorMessage('Type or paste some text to voice first.');
      return;
    }
    if (!takeVoiceId) {
      setErrorMessage(`Choose a ${VOICE_ENGINE_LABELS[e]} voice first.`);
      return;
    }
    setErrorMessage(null);

    const id = newId();
    const jobId = newId();
    const controller = new AbortController();
    runsRef.current.set(id, { jobId, controller });

    const format = prefs.outputFormat;
    const seed = e === 'elevenlabs' ? (prefs.el.seedLocked ? prefs.el.seed : randomSeed()) : undefined;
    const modelLabel =
      e === 'elevenlabs'
        ? elModel?.name || prefs.el.modelId
        : cartesiaModel?.name || prefs.cartesia.modelId;

    setTakes((prev) => {
      const next: Take[] = [
        {
          id,
          engine: e,
          voiceName: describeVoice(takeVoiceId).name,
          modelLabel,
          text: script,
          format,
          seed,
          status: 'running',
          progress: null,
          createdAt: Date.now(),
        },
        ...prev,
      ];
      // Drop the oldest finished takes past the cap; running ones are never dropped.
      while (next.length > MAX_TAKES) {
        const index = next.map((t) => t.status).lastIndexOf('done');
        const drop = index >= 0 ? index : next.findIndex((t, i) => i > 0 && t.status !== 'running');
        if (drop < 0) break;
        const [removed] = next.splice(drop, 1);
        if (removed.url) {
          URL.revokeObjectURL(removed.url);
          urlsRef.current.delete(removed.url);
        }
      }
      return next;
    });

    const poll = window.setInterval(() => {
      getDubProgress(jobId)
        .then((progress) => updateTake(id, { progress }))
        // The job only exists once the request reaches the server.
        .catch(() => {});
    }, 700);

    try {
      let blob: Blob;
      if (e === 'elevenlabs') {
        const settings = prefs.el.useOwnSettings
          ? null
          : { ...prefs.el.settings, ...(speedApplies ? {} : { speed: undefined }) };
        blob = await synthesizeSpeech(elApiKey, takeVoiceId, script, prefs.el.modelId, format, settings, {
          expressive: prefs.el.expressive && takesTags,
          audioTags: takesTags,
          language: prefs.language,
          seed,
          jobId,
          signal: controller.signal,
        });
      } else {
        blob = await synthesizeWithCartesia(takeVoiceId, script, {
          outputFormat: format,
          language: prefs.language,
          modelId: prefs.cartesia.modelId,
          ...(cartesiaControls
            ? {
                speed: prefs.cartesia.speed,
                volume: prefs.cartesia.volume,
                emotion: prefs.cartesia.emotion || undefined,
              }
            : {}),
          jobId,
          signal: controller.signal,
        });
      }

      // Raw PCM gets a WAV header so it plays, decodes and downloads like any file. A joined script
      // already comes back as WAV; a second header would play as a click at the start.
      const pcmRate = /^pcm_(\d+)$/.exec(format)?.[1];
      if (pcmRate) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const isWav = String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF';
        blob = isWav ? new Blob([bytes], { type: 'audio/wav' }) : createWavBlobFromPcm(bytes, Number(pcmRate), 1);
      }

      const url = URL.createObjectURL(blob);
      urlsRef.current.add(url);
      updateTake(id, { status: 'done', blob, url, progress: null });
      decodeAudioBlobUrl(url)
        .then((buffer) => updateTake(id, { buffer }))
        .catch(() => {});
      onGenerated?.();
    } catch (err: any) {
      if (controller.signal.aborted || err?.code === 'cancelled') {
        updateTake(id, { status: 'cancelled', progress: null });
      } else {
        updateTake(id, { status: 'failed', error: err?.message || 'Speech generation failed.', progress: null });
      }
    } finally {
      window.clearInterval(poll);
      runsRef.current.delete(id);
    }
  };

  const cancelTake = (id: string) => {
    const run = runsRef.current.get(id);
    if (!run) return;
    cancelDub(run.jobId)
      .catch(() => {})
      .finally(() => run.controller.abort());
  };

  const removeTake = (id: string) => {
    cancelTake(id);
    if (playingTakeId === id) {
      playerRef.current?.pause();
      setPlayingTakeId(null);
    }
    setTakes((prev) => {
      const take = prev.find((t) => t.id === id);
      if (take?.url) {
        URL.revokeObjectURL(take.url);
        urlsRef.current.delete(take.url);
      }
      return prev.filter((t) => t.id !== id);
    });
  };

  const togglePlay = (take: Take) => {
    const player = playerRef.current;
    if (!player || !take.url) return;
    if (playingTakeId === take.id) {
      player.pause();
      setPlayingTakeId(null);
      return;
    }
    auditionRef.current?.pause();
    setAuditioning(false);
    player.src = take.url;
    player.onended = () => setPlayingTakeId(null);
    player.play().catch(() => setPlayingTakeId(null));
    setPlayingTakeId(take.id);
  };

  const toggleAudition = () => {
    if (auditioning) {
      auditionRef.current?.pause();
      setAuditioning(false);
      return;
    }
    if (!voice.preview) return;
    playerRef.current?.pause();
    setPlayingTakeId(null);
    if (!auditionRef.current) auditionRef.current = new Audio();
    auditionRef.current.src = voice.preview;
    auditionRef.current.onended = () => setAuditioning(false);
    auditionRef.current.play().catch(() => setAuditioning(false));
    setAuditioning(true);
  };

  const downloadTake = (take: Take) => {
    if (!take.blob) return;
    const ext = audioFileExtension(take.blob);
    const slug = take.voiceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'voice';
    const a = document.createElement('a');
    a.href = take.url || URL.createObjectURL(take.blob);
    a.download = `dhvani_tts_${take.engine}_${slug}_${new Date(take.createdAt).toISOString().replace(/[:.]/g, '-')}.${ext}`;
    a.click();
  };

  const insertTag = (tag: string) => {
    const el = textareaRef.current;
    const insert = `[${tag}] `;
    if (!el) {
      setText((t) => `${t}${insert}`);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + insert + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + insert.length, start + insert.length);
    });
  };

  const selectVoice = (id: string) => {
    const e: VoiceEngine = isCartesiaVoice(id) ? 'cartesia' : 'elevenlabs';
    updatePrefs((p) => ({ ...p, voices: { ...p.voices, [e]: id } }));
    auditionRef.current?.pause();
    setAuditioning(false);
  };

  if (!isOpen) return null;

  const canGenerate = chars > 0 && Boolean(voiceId);
  const canCompare = cartesiaAvailable && chars > 0 && Boolean(voiceIdFor('elevenlabs')) && Boolean(voiceIdFor('cartesia'));
  const activeSettings = prefs.el.useOwnSettings ? ownSettings : prefs.el.settings;
  const formatHint = OUTPUT_FORMATS.find((f) => f.id === prefs.outputFormat)?.hint;

  const slider = (
    label: string,
    hint: string,
    value: number,
    onChange: (v: number) => void,
    { min = 0, max = 1, step = 0.05, ends, disabled = false, suffix = '' }: {
      min?: number;
      max?: number;
      step?: number;
      ends: [string, string];
      disabled?: boolean;
      suffix?: string;
    }
  ) => (
    <div className={disabled ? 'opacity-45' : ''}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-slate-100">{label}</span>
        <span className="font-mono text-xs text-slate-100 tabular-nums">
          {value.toFixed(2)}
          {suffix}
        </span>
      </div>
      <p className="text-[11.5px] text-slate-400 mt-0.5 mb-2">{hint}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(ev) => onChange(parseFloat(ev.target.value))}
        aria-label={label}
        className="w-full accent-indigo-500 cursor-pointer disabled:cursor-not-allowed"
      />
      <div className="flex justify-between text-[10.5px] text-slate-500 mt-0.5">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </div>
    </div>
  );

  const toggle = (label: string, hint: string, on: boolean, onChange: (v: boolean) => void, disabled = false) => (
    <div className={`flex items-center gap-3 ${disabled ? 'opacity-45' : ''}`}>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-slate-100">{label}</span>
        <span className="block text-[11.5px] text-slate-400">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative w-[34px] h-5 rounded-full shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed ${on ? 'bg-indigo-500' : 'bg-slate-700'}`}
      >
        <span className={`absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white transition-all ${on ? 'left-[17px]' : 'left-[3px]'}`} />
      </button>
    </div>
  );

  const progressOf = (take: Take) => {
    const p = take.progress;
    if (!p) return { fraction: null as number | null, label: 'Sending to ' + VOICE_ENGINE_LABELS[take.engine] + '…' };
    if (p.phase === 'preparing') return { fraction: null, label: 'Preparing the script…' };
    if (p.phase === 'joining') return { fraction: 1, label: 'Joining passages…' };
    const fraction = p.totalChars ? p.charsDone / p.totalChars : null;
    const passages = p.passageCount > 1 ? `Passage ${Math.min(p.passagesDone + 1, p.passageCount)} of ${p.passageCount}` : 'Voicing';
    const seconds = p.secondsGenerated ? ` · ${formatLength(p.secondsGenerated)} of audio` : '';
    return { fraction, label: `${passages}${seconds}` };
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="tts-studio-title"
        className="w-full max-w-[68rem] min-h-full sm:min-h-0 sm:my-auto sm:max-h-[calc(100vh-3rem)] flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
        onClick={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape' && !isPickerOpen) onClose();
        }}
      >
        <audio ref={playerRef} />

        {/* Header with the engine switch */}
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3 px-5 sm:px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-slate-100 text-slate-950 flex items-center justify-center shrink-0" aria-hidden="true">
            <Speech className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="tts-studio-title" className="text-lg font-semibold text-slate-100 leading-tight">
              Text to speech
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5">Voice any text with ElevenLabs or Cartesia, and compare the takes.</p>
          </div>
          <div
            role="radiogroup"
            aria-label="Engine"
            className="order-3 sm:order-none w-full sm:w-auto flex p-[3px] gap-0.5 rounded-[11px] bg-slate-950/60 border border-slate-800"
          >
            {(['elevenlabs', 'cartesia'] as const).map((e) => {
              const disabled = e === 'cartesia' && !cartesiaAvailable;
              return (
                <button
                  key={e}
                  type="button"
                  role="radio"
                  aria-checked={engine === e}
                  disabled={disabled}
                  title={disabled ? 'Add a Cartesia key in API settings to use Cartesia.' : undefined}
                  onClick={() => updatePrefs((p) => ({ ...p, engine: e }))}
                  className={`flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-[12.5px] font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    engine === e ? 'bg-slate-800 text-slate-100 shadow-sm' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {VOICE_ENGINE_LABELS[e]}
                </button>
              );
            })}
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

        <div className="flex-1 min-h-0 overflow-y-auto grid md:grid-cols-[minmax(0,1fr)_23.75rem]">
          <div className="px-5 sm:px-6 py-5 flex flex-col gap-5 min-w-0">
            {/* Voice */}
            <div className="flex flex-col gap-2">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Voice</span>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                <span className="w-[38px] h-[38px] rounded-full bg-gradient-to-br from-indigo-600 to-cyan-500 text-white font-semibold flex items-center justify-center shrink-0">
                  {(voice.name.charAt(0) || '?').toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold text-slate-100 truncate" title={voice.full}>
                    {voice.name}
                  </span>
                  <span className="block text-[11.5px] text-slate-400 truncate capitalize">
                    {[VOICE_ENGINE_LABELS[engine], voice.meta].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {voice.preview && (
                  <button type="button" onClick={toggleAudition} className="h-8 px-2.5 flex items-center gap-1.5 rounded-[9px] border border-slate-800 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 shrink-0 cursor-pointer">
                    {auditioning ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                    Sample
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsPickerOpen(true)}
                  className="h-8 px-2.5 rounded-[9px] border border-slate-800 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 shrink-0 cursor-pointer"
                >
                  Change
                </button>
              </div>
            </div>

            {/* Script */}
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="tts-text" className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 mr-auto">
                  Text
                </label>
                <select
                  aria-label="Language"
                  value={prefs.language}
                  onChange={(ev) => updatePrefs((p) => ({ ...p, language: ev.target.value }))}
                  className="h-7 bg-slate-950/60 border border-slate-800 rounded-[8px] px-2 text-[11.5px] text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code} className="bg-slate-900">
                      {l.label}
                    </option>
                  ))}
                </select>
                {projectScript?.trim() && (
                  <button type="button" onClick={() => setText(projectScript)} className={smallButton} title="Replace the text with this project's dub script">
                    <FileText className="w-3.5 h-3.5" /> Project script
                  </button>
                )}
                <button type="button" onClick={() => setText('')} disabled={!text} className={smallButton}>
                  Clear
                </button>
              </div>
              <textarea
                id="tts-text"
                ref={textareaRef}
                value={text}
                onChange={(ev) => setText(ev.target.value)}
                onKeyDown={(ev) => {
                  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && canGenerate) {
                    ev.preventDefault();
                    void runTake(engine);
                  }
                }}
                rows={7}
                placeholder="Type or paste what should be said. Line breaks become breathing pauses."
                className="w-full min-h-[10rem] resize-y bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-xl px-3.5 py-3 text-[14px] leading-relaxed text-slate-100 placeholder-slate-500 focus:outline-none"
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-slate-500 font-mono tabular-nums">
                <span>{chars.toLocaleString()} characters</span>
                {chars > 0 && <span>≈ {formatLength(estimatedSeconds)} of speech</span>}
                {chars > 0 && <span>≈ {creditsFor(engine).toLocaleString()} {VOICE_ENGINE_LABELS[engine]} credits</span>}
                {chars > 10000 && <span className="text-amber-400">Long text is voiced in passages and joined.</span>}
              </div>
              {engine === 'elevenlabs' && takesTags && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-500 mr-1">Audio tags</span>
                  {ELEVEN_V3_AUDIO_TAGS.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => insertTag(tag)}
                      className="px-2 py-0.5 rounded-full border border-slate-800 bg-slate-950/60 hover:border-indigo-500/50 hover:text-indigo-200 text-[11px] font-mono text-slate-400 cursor-pointer"
                    >
                      [{tag}]
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Model and delivery, per engine */}
            <div className="flex flex-col gap-4 p-4 rounded-xl border border-slate-800 bg-slate-950/30">
              <div className="flex items-center justify-between gap-2 -my-1">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                  {VOICE_ENGINE_LABELS[engine]} model &amp; delivery
                </span>
                {engine === 'elevenlabs' && (
                  <ResetDefaultsButton
                    onClick={() => setEl({ useOwnSettings: false, settings: { ...DEFAULT_VOICE_SETTINGS } })}
                    disabled={!prefs.el.useOwnSettings && isElevenLabsDefault(prefs.el.settings)}
                  />
                )}
              </div>

              {engine === 'elevenlabs' ? (
                <>
                  <div className="grid sm:grid-cols-2 gap-4 items-start">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="tts-el-model" className="text-xs text-slate-400">Model</label>
                      <select
                        id="tts-el-model"
                        value={prefs.el.modelId}
                        onChange={(ev) => setEl({ modelId: ev.target.value })}
                        className={`${field} cursor-pointer`}
                      >
                        {!models.some((m) => m.model_id === prefs.el.modelId) && (
                          <option value={prefs.el.modelId} className="bg-slate-900">{prefs.el.modelId}</option>
                        )}
                        {models.map((m) => (
                          <option key={m.model_id} value={m.model_id} className="bg-slate-900">
                            {m.name}
                            {m.token_cost_factor && m.token_cost_factor !== 1 ? ` · ${m.token_cost_factor}× credits` : ''}
                          </option>
                        ))}
                      </select>
                      {elModel?.description && <p className="text-[11px] text-slate-500 leading-snug">{elModel.description}</p>}
                    </div>
                    <div className="flex flex-col gap-3 sm:pt-6">
                      {toggle(
                        'Auto delivery cues',
                        takesTags ? 'Adds [calm], [sighs]… so it is performed, not read' : 'Eleven v3 and v4 only',
                        prefs.el.expressive && takesTags,
                        (v) => setEl({ expressive: v }),
                        !takesTags
                      )}
                    </div>
                  </div>

                  {toggle(
                    "Use the voice's own settings",
                    'How the voice sounds on the ElevenLabs website',
                    prefs.el.useOwnSettings,
                    (v) => setEl(v ? { useOwnSettings: true } : { useOwnSettings: false, settings: { ...DEFAULT_VOICE_SETTINGS, ...(ownSettings || {}) } })
                  )}

                  <div className="grid sm:grid-cols-2 gap-4">
                    {slider(
                      'Stability',
                      isV3 ? 'Below 0.5 creative, 0.5 natural, above robust.' : 'Higher is steadier; lower is more emotional.',
                      activeSettings?.stability ?? DEFAULT_VOICE_SETTINGS.stability,
                      (v) => setEl({ settings: { ...prefs.el.settings, stability: v } }),
                      { ends: ['Variable', 'Stable'], disabled: prefs.el.useOwnSettings }
                    )}
                    {slider(
                      'Similarity',
                      'How closely it keeps to the original voice.',
                      activeSettings?.similarity_boost ?? DEFAULT_VOICE_SETTINGS.similarity_boost,
                      (v) => setEl({ settings: { ...prefs.el.settings, similarity_boost: v } }),
                      { ends: ['Looser', 'Closer'], disabled: prefs.el.useOwnSettings }
                    )}
                    {slider(
                      'Style exaggeration',
                      'Amplifies the voice’s style. Costs latency; 0 is safest.',
                      activeSettings?.style ?? 0,
                      (v) => setEl({ settings: { ...prefs.el.settings, style: v } }),
                      { ends: ['None', 'Strong'], disabled: prefs.el.useOwnSettings }
                    )}
                    {slider(
                      'Speed',
                      speedApplies ? 'Speaking rate; 1.0 is natural.' : 'This model ignores speed.',
                      activeSettings?.speed ?? 1,
                      (v) => setEl({ settings: { ...prefs.el.settings, speed: v } }),
                      {
                        min: MIN_VOICE_SPEED,
                        max: MAX_VOICE_SPEED,
                        step: 0.01,
                        suffix: '×',
                        ends: ['Slower', 'Faster'],
                        disabled: prefs.el.useOwnSettings || !speedApplies,
                      }
                    )}
                  </div>
                  {toggle(
                    'Speaker boost',
                    'Sharpens likeness to the voice, slightly slower',
                    activeSettings?.use_speaker_boost !== false,
                    (v) => setEl({ settings: { ...prefs.el.settings, use_speaker_boost: v } }),
                    prefs.el.useOwnSettings
                  )}
                </>
              ) : (
                <>
                  <div className="grid sm:grid-cols-2 gap-4 items-start">
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="tts-ca-model" className="text-xs text-slate-400">Model</label>
                      <select
                        id="tts-ca-model"
                        value={prefs.cartesia.modelId}
                        onChange={(ev) => setCartesia({ modelId: ev.target.value })}
                        className={`${field} cursor-pointer`}
                      >
                        {CARTESIA_MODELS.map((m) => (
                          <option key={m.id} value={m.id} className="bg-slate-900">{m.name}</option>
                        ))}
                      </select>
                      {cartesiaModel && <p className="text-[11px] text-slate-500 leading-snug">{cartesiaModel.description}</p>}
                    </div>
                    <div className={`flex flex-col gap-1.5 ${cartesiaControls ? '' : 'opacity-45'}`}>
                      <label htmlFor="tts-ca-emotion" className="text-xs text-slate-400">Emotion</label>
                      <select
                        id="tts-ca-emotion"
                        value={prefs.cartesia.emotion}
                        disabled={!cartesiaControls}
                        onChange={(ev) => setCartesia({ emotion: ev.target.value })}
                        className={`${field} cursor-pointer`}
                      >
                        <option value="" className="bg-slate-900">Let the model choose</option>
                        {CARTESIA_EMOTIONS.map((emo) => (
                          <option key={emo} value={emo} className="bg-slate-900">
                            {emo.charAt(0).toUpperCase() + emo.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    {slider('Speed', cartesiaControls ? 'Speaking rate; 1.0 is natural.' : 'Sonic 3 models only.', prefs.cartesia.speed, (v) => setCartesia({ speed: v }), {
                      min: MIN_CARTESIA_SPEED,
                      max: MAX_CARTESIA_SPEED,
                      step: 0.01,
                      suffix: '×',
                      ends: ['Slower', 'Faster'],
                      disabled: !cartesiaControls,
                    })}
                    {slider('Volume', cartesiaControls ? 'Loudness of the read; 1.0 is normal.' : 'Sonic 3 models only.', prefs.cartesia.volume, (v) => setCartesia({ volume: v }), {
                      min: 0.5,
                      max: 2,
                      step: 0.05,
                      suffix: '×',
                      ends: ['Softer', 'Louder'],
                      disabled: !cartesiaControls,
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setCartesia({ speed: 1, volume: 1, emotion: '' })}
                    className={`${smallButton} w-fit`}
                  >
                    Reset delivery
                  </button>
                </>
              )}
            </div>

            {/* Output */}
            <div className="grid sm:grid-cols-2 gap-4 items-start">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tts-format" className="text-xs text-slate-400">Output format</label>
                <select
                  id="tts-format"
                  value={prefs.outputFormat}
                  onChange={(ev) => updatePrefs((p) => ({ ...p, outputFormat: ev.target.value }))}
                  className={`${field} cursor-pointer`}
                >
                  {OUTPUT_FORMATS.map((f) => (
                    <option key={f.id} value={f.id} className="bg-slate-900">{f.label}</option>
                  ))}
                </select>
                {formatHint && <p className="text-[11px] text-slate-500">{formatHint}.</p>}
              </div>
              {engine === 'elevenlabs' && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="tts-seed" className="text-xs text-slate-400">Seed</label>
                  <div className="flex gap-1.5">
                    <input
                      id="tts-seed"
                      type="number"
                      min={0}
                      max={4294967295}
                      value={prefs.el.seedLocked ? prefs.el.seed : ''}
                      placeholder="Random each take"
                      disabled={!prefs.el.seedLocked}
                      onChange={(ev) => {
                        const n = Math.floor(Number(ev.target.value));
                        if (Number.isFinite(n)) setEl({ seed: Math.min(4294967295, Math.max(0, n)) });
                      }}
                      className={`${field} font-mono disabled:opacity-60`}
                    />
                    <button
                      type="button"
                      onClick={() => setEl({ seedLocked: !prefs.el.seedLocked })}
                      aria-pressed={prefs.el.seedLocked}
                      title={prefs.el.seedLocked ? 'Unlock: a new seed each take' : 'Lock the seed to repeat a take'}
                      className={`w-10 h-10 shrink-0 flex items-center justify-center rounded-[10px] border cursor-pointer ${
                        prefs.el.seedLocked ? 'border-indigo-500 bg-indigo-950/40 text-indigo-200' : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-100'
                      }`}
                    >
                      {prefs.el.seedLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEl({ seed: randomSeed(), seedLocked: true })}
                      title="New random seed"
                      aria-label="New random seed"
                      className="w-10 h-10 shrink-0 flex items-center justify-center rounded-[10px] border border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-100 cursor-pointer"
                    >
                      <Dices className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500">Same seed, text and settings gives the same take.</p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button type="button" onClick={() => void runTake(engine)} disabled={!canGenerate} className={primaryButton}>
                <AudioLines className="w-4 h-4" /> Generate with {VOICE_ENGINE_LABELS[engine]}
              </button>
              {cartesiaAvailable && (
                <button
                  type="button"
                  onClick={() => {
                    void runTake('elevenlabs');
                    void runTake('cartesia');
                  }}
                  disabled={!canCompare}
                  title={canCompare ? 'Voice the same text on both engines, each with its own voice and settings' : 'Choose a voice on both engines first'}
                  className={secondaryButton}
                >
                  <Columns2 className="w-4 h-4" /> Generate on both
                </button>
              )}
              <span className="text-[11.5px] text-slate-500">
                <kbd className="font-mono">Ctrl</kbd> + <kbd className="font-mono">Enter</kbd> to generate
              </span>
            </div>

            {errorMessage && (
              <p className="flex items-start gap-2 px-3 py-2.5 rounded-[10px] bg-rose-500/10 border border-rose-500/30 text-[12.5px] text-slate-200" role="alert">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-px" /> {errorMessage}
              </p>
            )}
          </div>

          {/* Takes */}
          <aside aria-label="Takes" className="px-5 py-5 border-t md:border-t-0 md:border-l border-slate-800 bg-slate-950/40 flex flex-col gap-3 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                Takes{takes.length ? ` · ${takes.length}` : ''}
              </span>
              {takes.length > 0 && !running && (
                <button type="button" onClick={() => takes.forEach((t) => removeTake(t.id))} className="text-[11.5px] text-slate-500 hover:text-slate-200 cursor-pointer">
                  Clear all
                </button>
              )}
            </div>

            {takes.length === 0 ? (
              <div className="flex-1 min-h-[13.75rem] flex flex-col items-center justify-center gap-2.5 p-6 text-center rounded-xl border-[1.5px] border-dashed border-slate-700 text-[12.5px] text-slate-500">
                <span className="w-10 h-10 rounded-[11px] bg-slate-900 border border-slate-800 text-slate-400 flex items-center justify-center">
                  <Speech className="w-5 h-5" />
                </span>
                <span className="max-w-[16rem]">
                  Each take appears here with its voice and model, so you can compare them and keep the best one.
                </span>
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {takes.map((take) => {
                  const prog = take.status === 'running' ? progressOf(take) : null;
                  return (
                    <li
                      key={take.id}
                      className={`flex flex-col gap-2 p-3 rounded-xl bg-slate-900 border ${
                        playingTakeId === take.id ? 'border-indigo-500/60' : 'border-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => togglePlay(take)}
                          disabled={take.status !== 'done'}
                          className="w-[30px] h-[30px] rounded-full border border-slate-700 bg-slate-950/60 text-slate-100 flex items-center justify-center shrink-0 disabled:opacity-30 cursor-pointer"
                          aria-label={`${playingTakeId === take.id ? 'Stop' : 'Play'} take by ${take.voiceName}`}
                        >
                          {take.status === 'running' ? (
                            <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                          ) : playingTakeId === take.id ? (
                            <Square className="w-3 h-3 fill-current" />
                          ) : (
                            <Play className="w-3 h-3 fill-current ml-px" />
                          )}
                        </button>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-[12.5px] font-semibold text-slate-100 truncate">{take.voiceName}</span>
                            <span
                              className={`text-[9.5px] uppercase tracking-wider font-semibold px-1.5 py-px rounded ${
                                take.engine === 'cartesia' ? 'bg-cyan-500/15 text-cyan-300' : 'bg-indigo-500/15 text-indigo-300'
                              }`}
                            >
                              {VOICE_ENGINE_LABELS[take.engine]}
                            </span>
                          </span>
                          <span className="block text-[11px] text-slate-400 truncate font-mono">
                            {[
                              take.modelLabel,
                              take.buffer ? formatLength(take.buffer.duration) : null,
                              take.seed !== undefined ? `seed ${take.seed}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => removeTake(take.id)}
                          aria-label={take.status === 'running' ? 'Cancel take' : 'Remove take'}
                          title={take.status === 'running' ? 'Cancel' : 'Remove'}
                          className="p-1 text-slate-500 hover:text-slate-200 cursor-pointer"
                        >
                          {take.status === 'running' ? <X className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      <p className="text-[11.5px] text-slate-400 line-clamp-2" title={take.text}>
                        {take.text}
                      </p>

                      {prog && (
                        <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
                          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                            {prog.fraction === null ? (
                              <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 animate-[dubsweep_1.4s_ease-in-out_infinite]" />
                            ) : (
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-[width] duration-500"
                                style={{ width: `${Math.max(4, Math.round(prog.fraction * 100))}%` }}
                              />
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400">{prog.label}</span>
                        </div>
                      )}

                      {take.status === 'done' && take.buffer && (
                        <div className="h-[30px]">
                          <MiniWaveform buffer={take.buffer} className={take.engine === 'cartesia' ? 'text-cyan-400/80' : 'text-indigo-400'} />
                        </div>
                      )}

                      {take.status === 'failed' && (
                        <p className="flex items-start gap-1.5 text-[11.5px] text-rose-300">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {take.error}
                        </p>
                      )}
                      {take.status === 'cancelled' && <p className="text-[11.5px] text-slate-500">Cancelled.</p>}

                      {take.status === 'done' && (
                        <div className="flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => downloadTake(take)} className={smallButton}>
                            <Download className="w-3.5 h-3.5" /> .{take.blob ? audioFileExtension(take.blob) : 'mp3'}
                          </button>
                          {onSetDubbedMaster && (
                            <button
                              type="button"
                              disabled={!take.buffer || !take.blob}
                              onClick={() => take.blob && take.buffer && onSetDubbedMaster(take.blob, take.buffer)}
                              className={smallButton}
                              title="Make this the project's finished dub audio"
                            >
                              <Film className="w-3.5 h-3.5" /> Use as the dub
                            </button>
                          )}
                          {take.seed !== undefined && (
                            <button
                              type="button"
                              onClick={() => setEl({ seed: take.seed!, seedLocked: true })}
                              className={smallButton}
                              title="Lock this take's seed to regenerate it with small changes"
                            >
                              <Lock className="w-3.5 h-3.5" /> Reuse seed
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setText(take.text)}
                            disabled={take.text === text.trim()}
                            className={smallButton}
                          >
                            <Check className="w-3.5 h-3.5" /> Load text
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>
        </div>
      </section>

      {/* The voice library for the engine that is on */}
      {isPickerOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a voice"
          onClick={(ev) => {
            ev.stopPropagation();
            if (ev.target === ev.currentTarget) setIsPickerOpen(false);
          }}
          onKeyDown={(ev) => ev.key === 'Escape' && setIsPickerOpen(false)}
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
              elVoiceId={voiceId}
              onElVoiceIdChange={selectVoice}
              availableVoices={engineVoices}
              targetLanguage={prefs.language}
              voiceEngine={engine}
              onVoiceEngineChange={cartesiaAvailable ? (e) => updatePrefs((p) => ({ ...p, engine: e })) : undefined}
              className="h-[78vh]"
            />
          </div>
        </div>
      )}
    </div>
  );
};
