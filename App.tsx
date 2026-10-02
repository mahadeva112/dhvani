import React, { useState, useRef, useEffect, useCallback, useMemo, startTransition } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { ProHeader, DEFAULT_LANGUAGES, DEFAULT_TARGET_LANGUAGE, ThemeMode, HeaderQuota } from './components/ProHeader';
import { ExpressDubWizard, stepForJob } from './components/ExpressDubWizard';
import { useTrackMixer } from './components/useTrackMixer';
import { syncFraction } from './components/SyncPanel';
import { VoiceSettingsModal } from './components/VoiceSettingsModal';
import { BatchQueueModal } from './components/BatchQueueModal';
import { PhoneticKeyboardModal } from './components/PhoneticKeyboardModal';
import { TranslationPromptModal } from './components/TranslationPromptModal';
import { VoiceChangerModal } from './components/VoiceChangerModal';
import { TextToSpeechModal } from './components/TextToSpeechModal';
import { PauseSensitivityModal } from './components/PauseSensitivityModal';
import type { VoiceEngine } from './components/VoiceSelectorCard';
import { getCartesiaUsage, getGatewayUsage, type CartesiaUsage, type GatewayUsage } from './services/usageService';
import { languageFit } from './services/indianVoices';
import {
  TRANSLATION_PRESETS,
  DEFAULT_PROMPT_PRESET_ID,
  getPresetById,
  TranslationPromptPreset,
} from './services/translationPromptPresets';

import {
  analyzeAudio,
  decodeAudioBlobUrl,
  audioBufferToWav,
  audioFileExtension,
  resegmentAudioBuffer,
} from './services/audioService';
import { transcribeOnly } from './services/geminiService';
import { retranslateCues, RetranslateProgress } from './services/subtitleService';
import {
  getBackendHealth,
  getBackendSettings,
  BackendHealth,
  BackendSettings,
  SERVER_MANAGED_KEY,
  DhvaniApiError,
} from './services/apiClient';
import { SetupWizard } from './components/SetupWizard';
import {
  synthesizeSpeech,
  getDubProgress,
  cancelDub,
  DubProgress,
  getVoices,
  validateApiKey,
  Voice,
  ElevenLabsVoiceSettings,
  ElevenLabsModel,
  ALL_ELEVENLABS_MODELS,
  DEFAULT_ELEVENLABS_MODEL,
  getModels,
  performsAudioTags,
  VoiceExpression,
  type StabilityAdjustment,
} from './services/elevenLabsService';
import { buildSpeechScript } from './services/speechScript';
import { matchSourceDelivery } from './services/sourceCueService';
import { isMultiSpeaker, renameCast, renameSpeaker } from './services/speakers';
import {
  getCartesiaVoices,
  isCartesiaVoice,
  readCartesiaPrefs,
  saveCartesiaPrefs,
  CARTESIA_MODELS,
  cartesiaTakesControls,
  cartesiaForExpression,
  type CartesiaVoicePrefs,
} from './services/cartesiaService';

/** Renamed from 'elVoiceSettings' so the old forced defaults every install saved are dropped. */
const VOICE_SETTINGS_STORAGE_KEY = 'elVoiceSettingsV2';
/** Which engine speaks the dub, and the last voice picked on each one. */
const VOICE_ENGINE_STORAGE_KEY = 'dhvani_voice_engine';
const LAST_VOICE_STORAGE_KEY = 'dhvani_voice_by_engine';
// The last voice library fetched, so the picker opens full instead of filling in later.
const VOICE_LIBRARY_CACHE_KEY = 'dhvani_voice_library';
// The API sends far more per voice than the picker reads (a full library runs to
// tens of MB); the cache keeps only what the picker and voice summaries use.
const slimVoice = (v: Voice): Voice => ({
  voice_id: v.voice_id,
  name: v.name,
  category: v.category,
  labels: v.labels,
  preview_url: v.preview_url,
  provider: v.provider,
  // Only the language code is read, and the API repeats it once per model.
  verified_languages: v.verified_languages && [
    ...new Set(v.verified_languages.map((l) => l.language).filter(Boolean)),
  ].map((language) => ({ language })),
});
/** The project that was open, so a restart comes back to it. */
const OPEN_PROJECT_STORAGE_KEY = 'dhvani_open_project';
/**
 * Not working on a project: its audio, decoded again each time it opens, and
 * the step it is on. Changing these leaves when it was last worked on.
 */
const VIEW_FIELDS = new Set<string>(['audioBuffer', 'synthAudioBuffer', 'syncedAudioBuffer', 'lastStep']);
const DEFAULT_ELEVENLABS_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // Rachel

const engineOfVoice = (voiceId?: string | null): VoiceEngine =>
  isCartesiaVoice(voiceId) ? 'cartesia' : 'elevenlabs';

const readLastVoices = (): Partial<Record<VoiceEngine, string>> => {
  try {
    return JSON.parse(localStorage.getItem(LAST_VOICE_STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
};
import {
  generateSrtContent,
  generateTargetLanguageScript,
  downloadFile,
  TargetScriptFormat,
  DEFAULT_SRT_OPTIONS,
  SrtOptions,
} from './services/srtService';
import {
  syncDub,
  getSyncProgress,
  cancelSync,
  distributeLineText,
  audioDebugEnabled,
  scriptCharacterCount,
  SyncOptions,
  SyncProgress,
  SyncUnitReport,
} from './services/syncService';
import { syncPendingAfter, withPendingLines } from './services/syncPending';
import { hasEdits, lockedLines, measureEdits, originalParts, rebaseEdits, renderSyncEdits, SyncEdits } from './services/syncEditService';
import { LiveDubEngine, liveClips } from './services/liveDubEngine';
import type { SyncEditStatus } from './components/SyncEditTimeline';
import {
  getAllJobsFromStorage,
  saveJobToStorage,
  deleteJobFromStorage,
  clearAllJobsFromStorage,
} from './services/storageService';
import { byNewest } from './services/projects';
import { currentStep, hasTranscript, openSteps } from './services/steps';
import {
  BatchJob,
  ProcessingStatus,
  AudioSegment,
  AudioTrackMode,
  TargetSource,
  TrackSwitchOptions,
  DubLines,
  DubMixReport,
  MixPeakMode,
} from './types';

/**
 * Turns a backend or network failure into something the user can act on.
 *
 * A missing key is a setup problem, not a bug, and should read that way.
 */
const describePipelineError = (err: unknown): string => {
  if (err instanceof DhvaniApiError) {
    switch (err.code) {
      case 'missing_api_key':
      case 'invalid_api_key':
        return `${err.message} (Edit the .env file in the project folder, then restart the server.)`;
      case 'backend_unreachable':
        return 'The local DHVANI backend is not running. Start it with "npm run dev" and try again.';
      case 'rate_limited':
        return `${err.message} Nothing was lost — retry in a moment.`;
      case 'unsupported_media':
      case 'payload_too_large':
      case 'empty_transcription':
      case 'no_timestamps':
        return err.message;
      default:
        return err.message;
    }
  }
  return `Transcription failed: ${(err as any)?.message || err}`;
};

/** How long Edit timing waits after an edit before rendering the dub again, so a run of edits renders once. */
const SYNC_EDIT_RENDER_DELAY_MS = 600;

/** The source's length, which the synced dub is as long as. */
const sourceDurationOf = (job: BatchJob) =>
  job.audioBuffer?.duration || job.audioMetadata?.duration || job.segments[job.segments.length - 1]?.endTime || 0;

export default function App() {
  // --- STATE ---
  const [queue, setQueue] = useState<BatchJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Audio Playback State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  // What the player plays (and so which track is soloed), kept across restarts.
  const [trackMode, setTrackMode] = useState<AudioTrackMode>(() => {
    try {
      const saved = localStorage.getItem('dhvani_track_mode');
      return saved === 'source' || saved === 'both' ? saved : 'synth';
    } catch {
      return 'synth';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('dhvani_track_mode', trackMode);
    } catch {
      /* Storage off: the mode lasts until the app closes. */
    }
  }, [trackMode]);

  // Modals & Settings
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState<boolean>(false);
  const [isQueueModalOpen, setIsQueueModalOpen] = useState<boolean>(false);
  const [isPhoneticKeyboardOpen, setIsPhoneticKeyboardOpen] = useState<boolean>(false);
  const [keyboardActiveSegment, setKeyboardActiveSegment] = useState<AudioSegment | null>(null);

  /*
   * How much expression a dub is voiced with: Off (as written, the voice's own settings), Neutral (calm and
   * even, no tags), Natural (tagged from the source audio) or Expressive (tags guessed from the script).
   * Off by default. A choice saved before this was one setting carries over: Enhance emotion on was
   * Natural with Match source audio and Expressive without.
   */
  const [voiceExpression, setVoiceExpression] = useState<VoiceExpression>(() => {
    try {
      const saved = localStorage.getItem('dhvani_voice_expression');
      if (saved === 'off' || saved === 'neutral' || saved === 'natural' || saved === 'expressive') return saved;
      if (localStorage.getItem('dhvani_emotion_enhance') === 'true') {
        return localStorage.getItem('dhvani_emotion_match_source') === 'false' ? 'expressive' : 'natural';
      }
    } catch {}
    return 'off';
  });

  // Whether a dub's passages are brought to one loudness. On by default; off keeps each at the level it was voiced at.
  const [dubMatchLoudness, setDubMatchLoudness] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dhvani_dub_match_loudness') !== 'false';
    } catch {
      return true;
    }
  });

  // Whether the backend may steady a long dub's stability on the voice's own settings. On by default.
  const [tuneStability, setTuneStability] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dhvani_tune_stability') !== 'false';
    } catch {
      return true;
    }
  });
  const handleTuneStabilityChange = useCallback((enabled: boolean) => {
    setTuneStability(enabled);
    try {
      localStorage.setItem('dhvani_tune_stability', String(enabled));
    } catch {}
  }, []);
  /** What the last dub or sync changed about the stability, shown in Voice Settings. */
  const [lastStabilityAdjustment, setLastStabilityAdjustment] = useState<StabilityAdjustment | null>(null);

  // Whether uploads are transcribed with speakers told apart, and how many speakers (0: let ElevenLabs decide).
  const [multiSpeakerInput, setMultiSpeakerInput] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dhvani_multi_speaker') === 'true';
    } catch {
      return false;
    }
  });
  const [speakerCount, setSpeakerCount] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('dhvani_speaker_count'));
      return Number.isInteger(saved) && saved >= 2 && saved <= 32 ? saved : 0;
    } catch {
      return 0;
    }
  });
  // How a mix of several voices that peaks above full scale is written: as summed in float, or turned down.
  const [mixPeak, setMixPeak] = useState<MixPeakMode>(() => {
    try {
      return localStorage.getItem('dhvani_mix_peak') === 'lower' ? 'lower' : 'float';
    } catch {
      return 'float';
    }
  });

  const handleMultiSpeakerInputChange = useCallback((enabled: boolean) => {
    setMultiSpeakerInput(enabled);
    try {
      localStorage.setItem('dhvani_multi_speaker', String(enabled));
    } catch {}
  }, []);

  const handleSpeakerCountChange = useCallback((count: number) => {
    setSpeakerCount(count);
    try {
      localStorage.setItem('dhvani_speaker_count', String(count));
    } catch {}
  }, []);

  const handleMixPeakChange = useCallback((mode: MixPeakMode) => {
    setMixPeak(mode);
    try {
      localStorage.setItem('dhvani_mix_peak', mode);
    } catch {}
  }, []);

  /** What a transcription is asked for: speakers told apart when the user said several people speak. */
  const speakerOptions = useMemo(
    () => ({ diarize: multiSpeakerInput, numSpeakers: multiSpeakerInput && speakerCount ? speakerCount : undefined }),
    [multiSpeakerInput, speakerCount]
  );

  const handleDubMatchLoudnessChange = useCallback((enabled: boolean) => {
    setDubMatchLoudness(enabled);
    try {
      localStorage.setItem('dhvani_dub_match_loudness', String(enabled));
    } catch {}
  }, []);

  const handleVoiceExpressionChange = useCallback((expression: VoiceExpression) => {
    setVoiceExpression(expression);
    try {
      localStorage.setItem('dhvani_voice_expression', expression);
    } catch {}
  }, []);

  // The last source-matched script per project, so a re-dub of an unchanged script doesn't listen again.
  const sourceCueCacheRef = useRef<Record<string, { key: string; segments: AudioSegment[] }>>({});

  // Whether Roman-to-Indic conversion is on as you type across the app.
  const [isGlobalPhoneticEnabled, setIsGlobalPhoneticEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dhvani_global_phonetic') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleGlobalPhonetic = useCallback((enabled: boolean) => {
    setIsGlobalPhoneticEnabled(enabled);
    try {
      localStorage.setItem('dhvani_global_phonetic', String(enabled));
    } catch {
      // ignore storage errors
    }
  }, []);
  const [isPromptModalOpen, setIsPromptModalOpen] = useState<boolean>(false);
  const [isVoiceChangerOpen, setIsVoiceChangerOpen] = useState<boolean>(false);
  const [isTextToSpeechOpen, setIsTextToSpeechOpen] = useState<boolean>(false);
  const [isPauseSensitivityOpen, setIsPauseSensitivityOpen] = useState<boolean>(false);
  /** API & translation engine dialog, opened from the header's API Settings button. */
  const [isApiSettingsOpen, setIsApiSettingsOpen] = useState<boolean>(false);

  // Translation Prompt & Persona Settings
  const [promptPresetId, setPromptPresetId] = useState<string>(() => {
    try {
      return localStorage.getItem('dhvani_prompt_preset_id') || DEFAULT_PROMPT_PRESET_ID;
    } catch {
      return DEFAULT_PROMPT_PRESET_ID;
    }
  });

  const [customPrompt, setCustomPrompt] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('dhvani_custom_prompt');
      if (saved) return saved;
    } catch {}
    return getPresetById(DEFAULT_PROMPT_PRESET_ID).prompt;
  });

  // Speech synthesis runs on ElevenLabs; it is the only engine.
  const [elApiKey, setElApiKey] = useState<string>(() => {
    // Clear any key left over from when this modal still edited one locally.
    try {
      localStorage.removeItem('elApiKey');
    } catch {
      // ignore storage errors
    }
    return '';
  });
  const [elVoiceId, setElVoiceId] = useState<string>(() => {
    try {
      return localStorage.getItem('elVoiceId') || '21m00Tcm4TlvDq8ikWAM'; // Rachel default
    } catch {
      return '21m00Tcm4TlvDq8ikWAM';
    }
  });
  // Only one engine is on at a time: its voices are offered and it speaks the dub.
  const [voiceEngine, setVoiceEngine] = useState<VoiceEngine>(() => {
    try {
      const saved = localStorage.getItem(VOICE_ENGINE_STORAGE_KEY);
      if (saved === 'cartesia' || saved === 'elevenlabs') return saved;
      return engineOfVoice(localStorage.getItem('elVoiceId'));
    } catch {
      return 'elevenlabs';
    }
  });
  const [elModelId, setElModelId] = useState<string>(() => {
    try {
      return localStorage.getItem('elModelId') || DEFAULT_ELEVENLABS_MODEL;
    } catch {
      return DEFAULT_ELEVENLABS_MODEL;
    }
  });
  const [elModels, setElModels] = useState<ElevenLabsModel[]>(ALL_ELEVENLABS_MODELS);
  const [elOutputFormat, setElOutputFormat] = useState<string>('mp3_44100_128');
  // Null means "use the voice's own ElevenLabs settings", as the website does;
  // only a deliberate change in Voice Settings stores an override.
  const [elVoiceSettings, setElVoiceSettings] = useState<ElevenLabsVoiceSettings | null>(() => {
    try {
      const saved = localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return null;
  });
  const [availableVoices, setAvailableVoices] = useState<Voice[]>(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(VOICE_LIBRARY_CACHE_KEY) || '[]');
      if (Array.isArray(cached)) return cached;
    } catch {}
    return [];
  });
  const [isLoadingVoices, setIsLoadingVoices] = useState<boolean>(false);
  // False until the first library fetch has finished, or there is nothing to fetch.
  const [voicesSettled, setVoicesSettled] = useState<boolean>(false);

  // The dub in flight (a sync): its progress, and what cancelling it needs.
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [isCancellingSync, setIsCancellingSync] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  // `readJobId`: the continuous read in flight before the lines are placed, if the dub is voiced that way.
  const syncRunRef = useRef<{ jobId: string; controller: AbortController; readJobId?: string } | null>(null);
  /** The continuous read's progress, while the script is voiced in one take; null otherwise. */
  const [readProgress, setReadProgress] = useState<DubProgress | null>(null);
  /** One seed per dub session, so a second Sync reuses the lines the first one voiced. */
  const syncSeedRef = useRef<Record<string, number>>({});
  /**
   * Edit timing: whether the synced dub has caught up with the edits. An edit
   * is shown at once and rendered a moment later, once the user stops editing.
   */
  const [syncEditStatus, setSyncEditStatus] = useState<SyncEditStatus>({ state: 'ready' });
  const syncEditRunRef = useRef<{ timer: number | null; controller: AbortController | null }>({ timer: null, controller: null });
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  /** The transcription in flight: which project, and what cancelling it needs. */
  const transcribeRunRef = useRef<{ jobId: string; controller: AbortController } | null>(null);
  const [transcribingJobId, setTranscribingJobId] = useState<string | null>(null);
  /** The project whose transcription the user just cancelled, for the note in Source & voice. */
  const [cancelledTranscriptionJob, setCancelledTranscriptionJob] = useState<string | null>(null);

  /** Live stage message from the transcription/translation pipeline. */
  const [pipelineStatus, setPipelineStatus] = useState<string>('');
  const [pipelineProgress, setPipelineProgress] = useState<number>(0);

  /** What the local backend reports it can do; null until probed, or if offline. */
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [backendChecked, setBackendChecked] = useState<boolean>(false);
  const [backendSettings, setBackendSettings] = useState<BackendSettings | null>(null);

  // How a Cartesia voice is voiced: one set for the dub, the Sync tab and the studio.
  const [cartesiaPrefs, setCartesiaPrefs] = useState<CartesiaVoicePrefs>(readCartesiaPrefs);
  /** With the model resolved: the one picked, else the server's, else the newest Sonic. */
  const cartesiaVoice = useMemo<CartesiaVoicePrefs>(
    () => ({
      ...cartesiaPrefs,
      modelId: cartesiaPrefs.modelId || backendSettings?.server?.values.cartesiaTtsModel || CARTESIA_MODELS[0].id,
    }),
    [cartesiaPrefs, backendSettings]
  );
  const cartesiaModelName = CARTESIA_MODELS.find((m) => m.id === cartesiaVoice.modelId)?.name || cartesiaVoice.modelId;
  const handleCartesiaPrefsChange = useCallback((prefs: CartesiaVoicePrefs) => {
    setCartesiaPrefs(prefs);
    saveCartesiaPrefs(prefs);
  }, []);

  /** Set when the user chooses to configure keys via .env instead of the UI. */
  const [setupDismissed, setSetupDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dhvani_setup_dismissed') === 'true';
    } catch {
      return false;
    }
  });

  // Theme State: 'auto' | 'light' | 'dark'
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const savedMode = localStorage.getItem('dhvani_theme_mode');
      if (savedMode === 'auto' || savedMode === 'light' || savedMode === 'dark') return savedMode;
      const legacy = localStorage.getItem('dhvani_theme');
      if (legacy === 'light' || legacy === 'dark') return legacy;
      return 'auto';
    } catch {
      return 'auto';
    }
  });

  // Track system dark preference dynamically
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Effective active theme: 'dark' | 'light'
  const effectiveTheme: 'dark' | 'light' = useMemo(() => {
    if (themeMode === 'auto') {
      return systemPrefersDark ? 'dark' : 'light';
    }
    return themeMode;
  }, [themeMode, systemPrefersDark]);

  // Apply theme to document root
  useEffect(() => {
    const root = document.documentElement;
    if (effectiveTheme === 'light') {
      root.classList.remove('dark');
      root.classList.add('light');
      root.setAttribute('data-theme', 'light');
    } else {
      root.classList.remove('light');
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    }
    try {
      localStorage.setItem('dhvani_theme_mode', themeMode);
      localStorage.setItem('dhvani_theme', effectiveTheme);
    } catch (e) {
      console.warn('Failed to save theme preference:', e);
    }
  }, [themeMode, effectiveTheme]);

  // Target Dubbing Language State (Persistent across sessions & new jobs)
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => {
    try {
      // Bengali used to be the default. An install still on it from before
      // Hindi became the default moves to Hindi once; choosing Bengali again
      // afterwards sticks.
      if (!localStorage.getItem('dhvani_target_language_default_hindi')) {
        localStorage.setItem('dhvani_target_language_default_hindi', '1');
        if (localStorage.getItem('dhvani_target_language') === 'Bengali') {
          localStorage.setItem('dhvani_target_language', DEFAULT_TARGET_LANGUAGE);
        }
      }
      return localStorage.getItem('dhvani_target_language') || DEFAULT_TARGET_LANGUAGE;
    } catch {
      return DEFAULT_TARGET_LANGUAGE;
    }
  });
  const [isTranslatingLanguage, setIsTranslatingLanguage] = useState<boolean>(false);
  const [translationProgress, setTranslationProgress] = useState<RetranslateProgress | null>(null);

  /**
   * Source language for transcription. Empty string means "let ElevenLabs
   * auto-detect", which is the default and works well for clean recordings;
   * naming the language improves accuracy on noisy or code-mixed audio.
   */
  const [sourceLanguage, setSourceLanguage] = useState<string>(() => {
    try {
      return localStorage.getItem('dhvani_source_language') ?? '';
    } catch {
      return '';
    }
  });

  const handleSourceLanguageChange = useCallback((lang: string) => {
    setSourceLanguage(lang);
    try {
      localStorage.setItem('dhvani_source_language', lang);
    } catch {
      // ignore storage errors
    }
  }, []);

  // Audio HTML Elements
  const sourceAudioRef = useRef<HTMLAudioElement | null>(null);
  const synthAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);

  // Active Job helper
  const activeJob = useMemo(() => queue.find((j) => j.id === activeJobId) || null, [queue, activeJobId]);
  const activeJobIdRef = useRef(activeJobId);
  activeJobIdRef.current = activeJobId;

  // The step on screen. Null follows the job: the step the user last picked on
  // it, else as far as it has got. A pick in the header or wizard is kept on
  // the job, so opening it again lands there.
  const [stepOverride, setStepOverride] = useState<number | null>(null);
  // Dubbing and Sync need a script, so a transcript waiting for the choice
  // stays on Review, where the choice is made.
  const awaitingScript = activeJob?.targetSource === 'pending';
  // A step kept from before only counts once there is a transcript to work on.
  const keptStep = activeJob?.lastStep && (activeJob.lastStep === 1 || hasTranscript(activeJob.segments)) ? currentStep(activeJob.lastStep) : null;
  const requestedStep = stepOverride ?? keptStep ?? stepForJob(activeJob);
  // Steps open one at a time: a step is reachable only once the one before it
  // is done, and while a step's work runs every step after it is locked.
  const stepGate = useMemo(
    () =>
      openSteps(activeJob, {
        transcribing: Boolean(activeJob && transcribingJobId === activeJob.id),
        translating: isTranslatingLanguage,
      }),
    [activeJob, transcribingJobId, isTranslatingLanguage]
  );
  const activeStep = Math.max(1, Math.min(awaitingScript && requestedStep > 2 ? 2 : requestedStep, stepGate.upTo));
  useEffect(() => {
    setStepOverride(null);
  }, [activeJob?.id]);

  // ElevenLabs character allowance for the header, refreshed after each dub.
  const [elevenLabsQuota, setElevenLabsQuota] = useState<HeaderQuota | null>(null);
  const refreshQuota = useCallback(() => {
    return validateApiKey(elApiKey)
      .then((res) => {
        const sub = res.isValid ? res.user?.subscription : undefined;
        setElevenLabsQuota(
          sub && sub.character_limit > 0
            ? {
                used: sub.character_count,
                limit: sub.character_limit,
                tier: sub.tier,
                resetUnix: sub.next_character_count_reset_unix,
              }
            : null
        );
      })
      .catch(() => setElevenLabsQuota(null));
  }, [elApiKey]);

  // Cartesia credits used and the gateway budget, fetched when the balance popover opens.
  const [cartesiaUsage, setCartesiaUsage] = useState<CartesiaUsage | null>(null);
  const [gatewayUsage, setGatewayUsage] = useState<GatewayUsage | null>(null);
  const [usageUpdatedAt, setUsageUpdatedAt] = useState<number | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const refreshUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const [cartesia, gateway] = await Promise.all([
        getCartesiaUsage(),
        getGatewayUsage(),
        backendHealth?.elevenLabsConfigured ? refreshQuota() : null,
      ]);
      setCartesiaUsage(cartesia);
      setGatewayUsage(gateway);
      setUsageUpdatedAt(Date.now());
    } finally {
      setUsageLoading(false);
    }
  }, [refreshQuota, backendHealth?.elevenLabsConfigured]);

  /** One line describing where translation runs, for the API Settings button. */
  const translationSummary = useMemo(() => {
    const translation = backendSettings?.translation;
    if (!translation) return null;

    if (translation.mode === 'gateway') {
      return `Your gateway — ${translation.models?.[0] || 'model not set'}`;
    }
    if (translation.mode === 'google') {
      return `Google Gemini — ${translation.models?.[0] || ''}`;
    }
    return 'No translation engine configured';
  }, [backendSettings]);

  /** The one setup problem most worth surfacing, or null when everything is ready. */
  const backendIssue = useMemo(() => {
    if (!backendChecked) return null;

    if (!backendHealth) {
      return {
        title: 'The local DHVANI backend is not running.',
        detail:
          'Start it from the project folder with "npm run dev" (or "npm run server"). ' +
          'The browser talks only to this local server, which holds your API keys.',
      };
    }

    const missing: string[] = [];
    if (!backendHealth.elevenLabsConfigured) missing.push('ElevenLabs (transcription & voice)');
    if (!backendHealth.geminiConfigured) missing.push('a translation engine');

    if (missing.length > 0) {
      return {
        title: `Not configured yet: ${missing.join(' and ')}.`,
        detail: backendSettings?.canSaveKeys
          ? 'Open API Settings in the header and enter your own keys. They are saved on this ' +
            'computer, never reach the browser, and no .env file or restart is needed.'
          : 'This deployment has key setup disabled, so set these as environment variables on ' +
            'the host running DHVANI and restart it.',
      };
    }

    if (!backendHealth.ffmpegAvailable) {
      return {
        title: 'ffmpeg was not found, so audio will not be extracted from video files.',
        detail:
          'Video still works — the file is sent to ElevenLabs as-is — but installing ffmpeg ' +
          '(or running "npm install" so ffmpeg-static is present) makes video uploads smaller and faster.',
      };
    }

    return null;
  }, [backendChecked, backendHealth, backendSettings]);

  // selectedLanguage is the last language the user picked, not the active
  // job's: the UI already shows `activeJob?.language || selectedLanguage`, so
  // switching to (or restoring) an older job must not overwrite it — new jobs
  // should start in the language the user chose most recently.

  // Overall Duration
  const totalDuration = useMemo(() => {
    if (activeJob?.audioBuffer) return activeJob.audioBuffer.duration;
    if (activeJob?.synthAudioBuffer) return activeJob.synthAudioBuffer.duration;
    if (activeJob?.segments && activeJob.segments.length > 0) {
      return Math.max(...activeJob.segments.map((s) => s.endTime));
    }
    return 0;
  }, [activeJob]);

  /*
   * Probe the local backend once on mount.
   *
   * When the backend already holds an ElevenLabs key, the UI switches to a
   * server-managed placeholder so the user is never asked to paste a key into
   * the browser — the key stays in the backend's environment.
   */
  const probeBackend = useCallback(async () => {
    const [health, settings] = await Promise.all([getBackendHealth(), getBackendSettings()]);

    setBackendHealth(health);
    setBackendSettings(settings);
    setBackendChecked(true);

    if (health?.elevenLabsConfigured) {
      setElApiKey((current) =>
        current && current !== SERVER_MANAGED_KEY ? current : SERVER_MANAGED_KEY
      );
    }

    return health;
  }, []);

  useEffect(() => {
    let cancelled = false;
    probeBackend().catch(() => {
      if (!cancelled) setBackendChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [probeBackend]);

  /*
   * Show the first-run setup only when the backend has no keys AND is able to
   * save them. Behind a proxy, or with ALLOW_KEY_SETUP=false, the banner
   * pointing at environment variables is the right guidance instead.
   */
  const needsSetup =
    backendChecked &&
    !setupDismissed &&
    Boolean(backendHealth) &&
    Boolean(backendSettings?.canSaveKeys) &&
    (!backendHealth?.elevenLabsConfigured || !backendHealth?.geminiConfigured);

  useEffect(() => {
    if (backendHealth?.elevenLabsConfigured) refreshQuota();
  }, [backendHealth?.elevenLabsConfigured, refreshQuota]);

  /** What is running on the active job, for the header's status pill and progress line. */
  const headerActivity = useMemo(() => {
    // Sync runs in the Dub step but keeps going on any step, so the header follows it.
    if (isSyncing) return { label: isCancellingSync ? 'Cancelling dub' : 'Dubbing', fraction: syncProgress ? Math.min(0.98, syncFraction(syncProgress)) : null };
    if (isTranscribing) return { label: pipelineStatus.replace(/\.+$/, '') || 'Transcribing', fraction: null };
    if (isTranslatingLanguage) {
      const p = translationProgress;
      return { label: 'Translating', fraction: p && p.total > 0 ? Math.min(0.98, (p.done + 0.5) / p.total) : null };
    }
    return null;
  }, [isSyncing, isCancellingSync, syncProgress, isTranscribing, pipelineStatus, isTranslatingLanguage, translationProgress]);

  const handleDismissSetup = useCallback(() => {
    setSetupDismissed(true);
    try {
      localStorage.setItem('dhvani_setup_dismissed', 'true');
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleSetupComplete = useCallback(() => {
    setSetupDismissed(false);
    try {
      localStorage.removeItem('dhvani_setup_dismissed');
    } catch {
      // ignore storage errors
    }
    probeBackend().catch(() => {});
  }, [probeBackend]);

  // Load saved session on initial mount
  useEffect(() => {
    const loadStorage = async () => {
      try {
        const stored = await getAllJobsFromStorage();
        if (stored && stored.length > 0) {
          // Object URLs die with the page, so each saved file gets a new one; the buffers decode from them.
          const saved = stored.map((stale) => {
            // Saved before Sync kept its own file: the dub's slot holds the synced dub, and the unsynced one is gone.
            const job =
              stale.syncReport && stale.synthesizedBlob && !stale.syncedBlob
                ? { ...stale, syncedBlob: stale.synthesizedBlob, synthesizedBlob: null }
                : stale;
            return {
              ...job,
              synthesizedAudioUrl: job.synthesizedBlob ? URL.createObjectURL(job.synthesizedBlob) : null,
              syncedAudioUrl: job.syncedBlob ? URL.createObjectURL(job.syncedBlob) : null,
              srtUrl: job.srtBlob ? URL.createObjectURL(job.srtBlob) : null,
              // A dub or sync in flight ended with the page; it leaves what there was, as a cancel does.
              status:
                job.status === ProcessingStatus.SYNTHESIZING_AUDIO
                  ? job.synthesizedBlob || job.syncedBlob
                    ? ProcessingStatus.COMPLETED
                    : ProcessingStatus.IDLE
                  : job.status,
            };
          });
          saved.sort(byNewest);
          setQueue(saved);
          // Back to the project that was open, else the newest.
          let lastOpen: string | null = null;
          try {
            lastOpen = localStorage.getItem(OPEN_PROJECT_STORAGE_KEY);
          } catch {}
          setActiveJobId(saved.some((j) => j.id === lastOpen) ? lastOpen : saved[0].id);
        }
      } catch (err) {
        console.warn('Could not load stored session:', err);
      }
    };
    loadStorage();
  }, []);

  useEffect(() => {
    if (!activeJobId) return;
    try {
      localStorage.setItem(OPEN_PROJECT_STORAGE_KEY, activeJobId);
    } catch {}
  }, [activeJobId]);

  // Update storage & state helper
  const updateJob = useCallback((id: string, updates: Partial<BatchJob>) => {
    // Opening a project or moving between its steps isn't working on it.
    const worksOnIt = Object.keys(updates).some((k) => !VIEW_FIELDS.has(k));
    setQueue((prev) =>
      prev.map((job) => {
        if (job.id === id) {
          const updatedJob = { ...job, ...updates, ...(worksOnIt ? { updatedAt: Date.now() } : {}) };
          saveJobToStorage(updatedJob).catch((err) => console.error('Storage Save Error:', err));
          return updatedJob;
        }
        return job;
      })
    );
  }, []);

  const handleStepChange = useCallback(
    (step: number) => {
      // A locked step can't be opened, from the header or from any button on the page.
      if (step > stepGate.upTo) return;
      setStepOverride(step);
      if (activeJob && activeJob.lastStep !== step) updateJob(activeJob.id, { lastStep: step });
    },
    [activeJob, updateJob, stepGate.upTo]
  );

  // Central Target Language Change Handler with Instant Re-translation
  const handleLanguageChange = useCallback(
    async (newLang: string) => {
      setSelectedLanguage(newLang);
      try {
        localStorage.setItem('dhvani_target_language', newLang);
      } catch {
        // ignore storage errors
      }

      if (activeJob) {
        // 1. Immediately update active job's language
        updateJob(activeJob.id, { language: newLang });

        // A transcript still waiting for a choice is only retargeted: the
        // user picks translate or their own script after this.
        if (activeJob.targetSource === 'pending') return;

        // The user's own script is never machine-translated. It stays as
        // written, and the user is told it no longer matches.
        if (activeJob.targetSource === 'custom') {
          const previous = activeJob.language || selectedLanguage;
          if (previous !== newLang) {
            updateJob(activeJob.id, {
              translationWarning: `Your script is in ${previous}, and the dub language is now ${newLang}. Paste a ${newLang} script or translate the transcript from the Translation panel.`,
            });
          }
          return;
        }

        // 2. If the active job already has dialogue segments, re-translate them to the new language
        if (activeJob.segments && activeJob.segments.length > 0) {
          setIsTranslatingLanguage(true);
          setTranslationProgress(null);
          try {
            const promptToUse = activeJob.customPrompt || customPrompt;

            // Re-translates existing cues only: the audio is never re-sent and
            // the ElevenLabs timestamps are reused verbatim.
            const { segments: translatedSegments, translatedSrt, untranslatedCueIds } =
              await retranslateCues(activeJob.segments, {
                sourceLanguage: activeJob.detectedLanguage || sourceLanguage,
                targetLanguage: newLang,
                customPrompt: promptToUse,
                onProgress: setTranslationProgress,
              });

            const newScript = translatedSegments
              .map((s) => s.textTarget || (s as any).targetText || '')
              .filter(Boolean)
              .join(' ');

            updateJob(activeJob.id, {
              language: newLang,
              segments: translatedSegments,
              script: newScript,
              translatedSrt,
              translationWarning: untranslatedCueIds.length
                ? `${untranslatedCueIds.length} cue(s) kept their previous text. Timestamps are unchanged — you can retry the translation.`
                : null,
              synthesizedAudioUrl: null,
              synthesizedBlob: null,
              synthAudioBuffer: null,
              xmlOutput: '',
              syncedAudioUrl: null,
              syncedBlob: null,
              syncedAudioBuffer: null,
              syncReport: null,
              syncBank: null,
              syncBankBlob: null,
              syncEdits: null,
              syncBaseReport: null,
              dubStems: null,
              dubMix: null,
              syncedStems: null,
              syncMix: null,
            });
          } catch (err: any) {
            // The transcription and its timings survive a failed translation.
            console.warn('Auto translation to new language failed:', err);
            updateJob(activeJob.id, {
              translationWarning: `Translation to ${newLang} failed: ${
                err?.message || err
              } Your transcription and timestamps are intact — retry the translation when ready.`,
            });
          } finally {
            setIsTranslatingLanguage(false);
          }
        }
      }
    },
    [activeJob, customPrompt, selectedLanguage, updateJob]
  );

  // Custom Translation Prompt Handlers
  const handleUpdateTranslationPrompt = useCallback(
    (newPrompt: string, newPresetId: string) => {
      setCustomPrompt(newPrompt);
      setPromptPresetId(newPresetId);
      try {
        localStorage.setItem('dhvani_custom_prompt', newPrompt);
        localStorage.setItem('dhvani_prompt_preset_id', newPresetId);
      } catch {}
      if (activeJob) {
        updateJob(activeJob.id, {
          customPrompt: newPrompt,
          promptPresetId: newPresetId,
        });
      }
    },
    [activeJob, updateJob]
  );

  // Re-translate all existing dialogue segments with custom prompt
  const handleRetranslateWithPrompt = useCallback(
    async (overridePrompt?: string) => {
      if (!activeJob || !activeJob.segments || activeJob.segments.length === 0) return;
      const promptToUse = overridePrompt !== undefined ? overridePrompt : (activeJob.customPrompt || customPrompt);
      setIsTranslatingLanguage(true);
      setTranslationProgress(null);
      try {
        const targetLang = activeJob.language || selectedLanguage;

        // Text-only retranslation against the existing ElevenLabs timestamps.
        const { segments: translatedSegments, translatedSrt, untranslatedCueIds } =
          await retranslateCues(activeJob.segments, {
            sourceLanguage: activeJob.detectedLanguage || sourceLanguage,
            targetLanguage: targetLang,
            customPrompt: promptToUse,
            onProgress: setTranslationProgress,
          });

        const newScript = translatedSegments
          .map((s) => s.textTarget || (s as any).targetText || '')
          .filter(Boolean)
          .join(' ');

        updateJob(activeJob.id, {
          segments: translatedSegments,
          script: newScript,
          customPrompt: promptToUse,
          targetSource: 'translated',
          translatedSrt,
          translationWarning: untranslatedCueIds.length
            ? `${untranslatedCueIds.length} cue(s) kept their previous text. Timestamps are unchanged — you can retry.`
            : null,
          synthesizedAudioUrl: null,
          synthesizedBlob: null,
          synthAudioBuffer: null,
          xmlOutput: '',
          syncedAudioUrl: null,
          syncedBlob: null,
          syncedAudioBuffer: null,
          syncReport: null,
          syncBank: null,
          syncBankBlob: null,
          syncEdits: null,
          syncBaseReport: null,
          dubStems: null,
          dubMix: null,
          syncedStems: null,
          syncMix: null,
        });
      } catch (err: any) {
        console.warn('Retranslate with prompt error:', err);
        updateJob(activeJob.id, {
          translationWarning: `Translation failed: ${
            err?.message || err
          } Your transcription and timestamps are intact.`,
        });
        throw err;
      } finally {
        setIsTranslatingLanguage(false);
      }
    },
    [activeJob, customPrompt, selectedLanguage, updateJob]
  );

  /**
   * The transcript's "Translate" choice. The only place a waiting transcript
   * is sent to the translation engine, and only on the user's click. When the
   * transcript is already in the dub language it becomes the script as-is,
   * the same shortcut the pipeline takes, so no credits are spent on it.
   */
  const handleTranslateTranscript = useCallback(async () => {
    if (!activeJob || activeJob.segments.length === 0) return;
    const targetLang = activeJob.language || selectedLanguage;
    const spoken = activeJob.detectedLanguage || activeJob.sourceLanguage || '';
    if (spoken && spoken.toLowerCase() === targetLang.toLowerCase()) {
      const segments = activeJob.segments.map((s) => {
        const text = s.textSource || s.originalText || '';
        return { ...s, textTarget: text, targetText: text };
      });
      updateJob(activeJob.id, {
        segments,
        script: segments.map((s) => s.textTarget).filter(Boolean).join(' '),
        targetSource: 'translated',
        translationWarning: null,
      });
      return;
    }
    await handleRetranslateWithPrompt();
  }, [activeJob, selectedLanguage, updateJob, handleRetranslateWithPrompt]);

  /** Records where the target lines came from, e.g. once a pasted script is applied. */
  const handleTargetSourceChange = useCallback(
    (targetSource: TargetSource) => {
      if (!activeJob) return;
      updateJob(activeJob.id, {
        targetSource,
        // A pasted script replaces whatever the translation reported.
        ...(targetSource === 'custom' ? { translationWarning: null, translatedSrt: '' } : {}),
      });
    },
    [activeJob, updateJob]
  );

  /**
   * Transcribes a project's file, which only ever starts when the user asks.
   * Returns the transcript, or null when the user cancelled it: then the
   * request is dropped, which stops the server too (ffmpeg, the upload to
   * ElevenLabs, any retry), and the project is left as it was.
   */
  const runTranscription = async (jobId: string, file: File, language: string) => {
    transcribeRunRef.current?.controller.abort();
    const controller = new AbortController();
    transcribeRunRef.current = { jobId, controller };
    setTranscribingJobId(jobId);
    setIsTranscribing(true);
    setCancelledTranscriptionJob(null);
    setPipelineProgress(0);
    try {
      return await transcribeOnly(file, (status) => setPipelineStatus(status), language, { ...speakerOptions, signal: controller.signal });
    } catch (err) {
      if (controller.signal.aborted) {
        setCancelledTranscriptionJob(jobId);
        return null;
      }
      throw err;
    } finally {
      if (transcribeRunRef.current?.controller === controller) {
        transcribeRunRef.current = null;
        setTranscribingJobId(null);
        setIsTranscribing(false);
        setPipelineStatus('');
      }
    }
  };

  /** Stops the transcription in flight, here and on the server. */
  const handleCancelTranscription = () => transcribeRunRef.current?.controller.abort();

  // Transcribe the raw audio again. It stops at the transcript: the user
  // chooses translate or their own script afterwards. A cancel keeps the transcript there was.
  const handleRetranscribeAudio = useCallback(
    async (overridePrompt?: string) => {
      if (!activeJob || !activeJob.file) return;
      const promptToUse = overridePrompt !== undefined ? overridePrompt : (activeJob.customPrompt || customPrompt);
      try {
        const targetLang = activeJob.language || selectedLanguage;
        const result = await runTranscription(activeJob.id, activeJob.file, sourceLanguage);
        if (!result) return;

        updateJob(activeJob.id, {
          language: targetLang,
          sourceLanguage,
          detectedLanguage: result.detectedLanguage,
          script: '',
          segments: result.segments,
          customPrompt: promptToUse,
          originalSrt: result.originalSrt,
          translatedSrt: '',
          translationWarning: null,
          targetSource: 'pending',
          errorMsg: null,
          xmlOutput: '',
          validationResult: null,
          synthesizedAudioUrl: null,
          synthesizedBlob: null,
          srtUrl: null,
          srtBlob: null,
          synthAudioBuffer: null,
          syncedAudioUrl: null,
          syncedBlob: null,
          syncedAudioBuffer: null,
          syncReport: null,
          syncBank: null,
          syncBankBlob: null,
          syncEdits: null,
          syncBaseReport: null,
          dubStems: null,
          dubMix: null,
          syncedStems: null,
          syncMix: null,
        });
      } catch (err: any) {
        updateJob(activeJob.id, { errorMsg: describePipelineError(err) });
        throw err;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeJob, customPrompt, selectedLanguage, sourceLanguage, speakerOptions, updateJob]
  );

  // Audio source & synth URLs
  const sourceAudioUrl = useMemo(() => {
    if (!activeJob?.file) return null;
    return URL.createObjectURL(activeJob.file);
  }, [activeJob?.file]);

  /*
   * The second track: the synced dub once there is one, else the dub of a
   * project made before Dub and Sync were one step. Each keeps its own file.
   */
  const playsSynced = Boolean(activeJob?.syncedAudioUrl);
  const synthAudioUrl = (playsSynced ? activeJob?.syncedAudioUrl : activeJob?.synthesizedAudioUrl) || null;
  const synthBufferField = playsSynced ? 'syncedAudioBuffer' : 'synthAudioBuffer';
  // Until there is a dub the original is the only thing to hear, whatever mode was last picked.
  const playMode: AudioTrackMode = synthAudioUrl ? trackMode : 'source';
  // The listening faders of the Dub step; every other step hears both tracks at full level.
  const mixerElements = useMemo(() => ({ source: sourceAudioRef, synth: synthAudioRef }), []);
  const mixer = useTrackMixer(mixerElements, activeStep === 3);

  /*
   * While Edit timing is open, the dub is played live from the sync's lines
   * (liveDubEngine.ts), as a DAW plays its clips: an edit is heard at once and
   * playback never stops for the render, which carries on in the background
   * for the file. The original stays the clock. At a speed other than 1x the
   * synced dub's file plays as before, since the live dub would change pitch.
   */
  const [editTimingAudio, setEditTimingAudio] = useState<AudioBuffer | null>(null);
  const liveDub = playsSynced && Boolean(editTimingAudio && activeJob?.syncBank) && playbackRate === 1;
  const liveDubRef = useRef(liveDub);
  liveDubRef.current = liveDub;
  const liveDubClips = useMemo(
    () =>
      liveDub && activeJob?.syncBank
        ? liveClips(activeJob.syncBank, activeJob.syncEdits, Boolean(activeJob.syncBaseReport?.mix), originalParts(activeJob.syncEdits, sourceDurationOf(activeJob)))
        : [],
    [liveDub, activeJob?.syncBank, activeJob?.syncEdits, activeJob?.syncBaseReport, activeJob?.audioBuffer]
  );
  const liveDubClipsRef = useRef(liveDubClips);
  liveDubClipsRef.current = liveDubClips;
  const liveEngineRef = useRef<LiveDubEngine | null>(null);
  const liveDubInputRef = useRef<{ bank: NonNullable<BatchJob['syncBank']>; multiSpeaker: boolean; sourceDuration: number } | null>(null);
  liveDubInputRef.current = activeJob?.syncBank
    ? { bank: activeJob.syncBank, multiSpeaker: Boolean(activeJob.syncBaseReport?.mix), sourceDuration: sourceDurationOf(activeJob) }
    : null;
  // The original, which the clips of it on the dub play from.
  const liveOriginal = activeJob?.audioBuffer ?? null;
  const liveOriginalRef = useRef(liveOriginal);
  liveOriginalRef.current = liveOriginal;
  /** A drag in Edit timing, heard while it lasts; null puts the committed edits back. Nothing re-renders for it. */
  const handleSyncEditDraft = useCallback((edits: SyncEdits | null) => {
    const engine = liveEngineRef.current;
    const input = liveDubInputRef.current;
    if (!engine || !input) return;
    engine.setClips(edits ? liveClips(input.bank, edits, input.multiSpeaker, originalParts(edits, input.sourceDuration)) : liveDubClipsRef.current);
  }, []);

  // Sync playback rate to audio elements, including ones mounted after the rate was set
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  useEffect(() => {
    if (sourceAudioRef.current) sourceAudioRef.current.playbackRate = playbackRate;
    if (synthAudioRef.current) synthAudioRef.current.playbackRate = playbackRate;
  }, [playbackRate, sourceAudioUrl, synthAudioUrl]);

  /*
   * The dub URL whose buffer is being decoded, so the effect below and the
   * dub and sync handlers don't decode the same file twice, and the URL the
   * active job plays now, so a decode that lands after a newer dub is dropped.
   */
  const decodingSynthUrlRef = useRef<string | null>(null);
  const currentSynthUrlRef = useRef<string | null>(synthAudioUrl);
  currentSynthUrlRef.current = synthAudioUrl;
  /** The active job's synced dub, so a decode that lands after a newer one is dropped. */
  const currentSyncedUrlRef = useRef<string | null>(null);
  currentSyncedUrlRef.current = activeJob?.syncedAudioUrl || null;

  // Re-decode audio buffers if needed
  useEffect(() => {
    if (activeJob && !activeJob.audioBuffer && activeJob.file) {
      analyzeAudio(activeJob.file)
        .then(({ buffer, segments }) => {
          updateJob(activeJob.id, {
            audioBuffer: buffer,
            ...(activeJob.segments.length > 0 ? {} : { segments }),
          });
        })
        .catch((e) => console.warn('Audio decode notice:', e));
    }
    if (activeJob && !activeJob[synthBufferField] && synthAudioUrl && decodingSynthUrlRef.current !== synthAudioUrl) {
      const url = synthAudioUrl;
      const field = synthBufferField;
      decodingSynthUrlRef.current = url;
      decodeAudioBlobUrl(url)
        .then((buffer) => {
          if (currentSynthUrlRef.current === url) updateJob(activeJob.id, { [field]: buffer });
        })
        .catch((e) => console.warn('Synth decode notice:', e))
        .finally(() => {
          if (decodingSynthUrlRef.current === url) decodingSynthUrlRef.current = null;
        });
    }
  }, [activeJob?.id, synthAudioUrl]);

  // --- AUDIO SYNCHRONIZATION ENGINE ---
  /*
   * Everything here reads refs, not render-time values, so a handler that
   * switches the track and then plays in the same click sees the new track.
   *
   * The heard clock: the original in 'source' and 'both' (where the dub is
   * locked to it), the dub in 'synth'. In 'both', once the original has ended
   * the dub is all that is left to hear, so it becomes the clock.
   */
  const playModeRef = useRef<AudioTrackMode>(playMode);
  playModeRef.current = playMode;
  const isPlayingRef = useRef(isPlaying);
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  /** A position, on the heard clock, where playback stops by itself: the end of a solo cue. */
  const stopAtRef = useRef<number | null>(null);

  const setPlaying = useCallback((playing: boolean) => {
    isPlayingRef.current = playing;
    setIsPlaying(playing);
  }, []);

  const elementsFor = useCallback((mode: AudioTrackMode) => {
    const source = sourceAudioRef.current;
    // The live dub plays in place of the synced dub's element, on the original's clock.
    const synth = liveDubRef.current ? null : synthAudioRef.current?.src ? synthAudioRef.current : null;
    const els = mode === 'source' ? [source] : mode === 'synth' ? [liveDubRef.current ? source : synth] : [source, synth];
    return els.filter((el): el is HTMLAudioElement => Boolean(el));
  }, []);

  const heardElement = useCallback((mode: AudioTrackMode = playModeRef.current) => {
    const source = sourceAudioRef.current;
    const synth = synthAudioRef.current;
    if (liveDubRef.current) return source;
    if (mode === 'synth') return synth;
    if (mode === 'both' && source?.ended && synth && !synth.ended) return synth;
    return source;
  }, []);

  const pauseAll = useCallback(() => {
    stopAtRef.current = null;
    setPlaying(false);
    sourceAudioRef.current?.pause();
    synthAudioRef.current?.pause();
    const heard = heardElement();
    if (heard) setCurrentTime(heard.currentTime);
  }, [heardElement, setPlaying]);

  /** Puts every element on the same position, so whichever track plays next starts where the playhead is. */
  const seekAll = useCallback((time: number) => {
    if (!isFinite(time)) return;
    const t = Math.max(0, time);
    [sourceAudioRef.current, synthAudioRef.current].forEach((el) => {
      if (el) el.currentTime = t;
    });
    setCurrentTime(t);
  }, []);

  const startPlayback = useCallback(
    (mode: AudioTrackMode, at: number) => {
      const els = elementsFor(mode);
      if (els.length === 0) return;
      seekAll(at);
      setPlaying(true);
      mixer.prepare(els);
      els.forEach((el) => {
        el.playbackRate = playbackRateRef.current;
        el.play().catch((e) => {
          // A play cut short by a pause or a new source is expected; anything else means nothing is playing.
          if (e?.name === 'AbortError') return;
          console.warn(e);
          if (isPlayingRef.current) pauseAll();
        });
      });
    },
    [elementsFor, seekAll, setPlaying, pauseAll, mixer.prepare]
  );

  const syncPlayback = useCallback(
    (action: 'play' | 'pause' | 'seek', seekTime?: number) => {
      if (action === 'seek') {
        if (seekTime === undefined) return;
        stopAtRef.current = null;
        seekAll(seekTime);
        return;
      }
      if (action === 'play') {
        // Resume from where the audio actually is: React's currentTime trails it by up to a quarter-second.
        const heard = heardElement();
        const at = seekTime ?? (heard ? heard.currentTime : currentTimeRef.current);
        startPlayback(playModeRef.current, at);
      } else {
        pauseAll();
      }
    },
    [heardElement, seekAll, startPlayback, pauseAll]
  );

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) {
      syncPlayback('pause');
    } else {
      stopAtRef.current = null;
      syncPlayback('play');
    }
  }, [syncPlayback]);

  const handleSeek = useCallback(
    (time: number) => {
      syncPlayback('seek', time);
    },
    [syncPlayback]
  );

  /*
   * Switches what is heard as one action: the old track stops, the new one
   * starts at the same position (or `seek`), playing if anything was. The
   * playhead's clock and the audio change together, so they never disagree.
   */
  const changeTrackMode = useCallback(
    (mode: AudioTrackMode, options: TrackSwitchOptions = {}) => {
      const next: AudioTrackMode = currentSynthUrlRef.current ? mode : 'source';
      const heard = heardElement();
      const at = options.seek ?? (heard ? heard.currentTime : currentTimeRef.current);
      const play = options.play ?? isPlayingRef.current;
      stopAtRef.current = null;
      if (next === playModeRef.current) {
        // Same track: a seek and a play or pause, without stopping what is already playing.
        setTrackMode(mode);
        if (play && !isPlayingRef.current) startPlayback(next, at);
        else if (!play && isPlayingRef.current) {
          pauseAll();
          seekAll(at);
        } else if (options.seek !== undefined) seekAll(at);
        return;
      }
      playModeRef.current = next;
      setTrackMode(mode);
      sourceAudioRef.current?.pause();
      synthAudioRef.current?.pause();
      if (play) {
        startPlayback(next, at);
      } else {
        setPlaying(false);
        seekAll(at);
      }
    },
    [heardElement, startPlayback, setPlaying, seekAll, pauseAll]
  );

  // The heard track's exact position, read every frame by the playheads so they move smoothly.
  const getLiveTime = useCallback(() => {
    const el = heardElement();
    return el ? el.currentTime : null;
  }, [heardElement]);

  /*
   * Playing state follows the elements, not just our own calls: a pause from
   * the system or media keys, a track that ends, or a play from outside all
   * land here. Bound to both elements; each event is judged against the
   * tracks the current mode plays.
   */
  useEffect(() => {
    const els = [sourceAudioRef.current, synthAudioRef.current].filter((el): el is HTMLAudioElement => Boolean(el));
    if (els.length === 0) return;
    const inMode = (el: HTMLAudioElement) => elementsFor(playModeRef.current).includes(el);

    const onTimeUpdate = (e: Event) => {
      const el = e.currentTarget as HTMLAudioElement;
      // A transition: the re-render this sets off (the whole page, on a long script) yields to the
      // animation frames that move the playheads, instead of blocking them four times a second.
      if (el === heardElement()) {
        const t = el.currentTime;
        startTransition(() => setCurrentTime(t));
      }
    };
    const onPause = (e: Event) => {
      const el = e.currentTarget as HTMLAudioElement;
      // Our own pauses clear isPlayingRef first; a pause followed by a play in the same task has el.paused false again.
      if (!isPlayingRef.current || !el.paused || el.ended || !inMode(el)) return;
      pauseAll();
    };
    const onEnded = (e: Event) => {
      const el = e.currentTarget as HTMLAudioElement;
      if (!isPlayingRef.current || !inMode(el)) return;
      // In 'both' the longer track plays on; playback is over when every track has stopped.
      if (elementsFor(playModeRef.current).every((x) => x.paused)) {
        stopAtRef.current = null;
        setPlaying(false);
        setCurrentTime(el.currentTime);
      }
    };
    const onPlay = (e: Event) => {
      const el = e.currentTarget as HTMLAudioElement;
      if (isPlayingRef.current || !inMode(el)) return;
      // Started from outside (media keys): bring the other track in at the same position.
      startPlayback(playModeRef.current, el.currentTime);
    };

    els.forEach((el) => {
      el.addEventListener('timeupdate', onTimeUpdate);
      el.addEventListener('pause', onPause);
      el.addEventListener('ended', onEnded);
      el.addEventListener('play', onPlay);
    });
    return () => {
      els.forEach((el) => {
        // An element replaced by a new file must not play on, unheard by the transport.
        if (!el.isConnected) el.pause();
        el.removeEventListener('timeupdate', onTimeUpdate);
        el.removeEventListener('pause', onPause);
        el.removeEventListener('ended', onEnded);
        el.removeEventListener('play', onPlay);
      });
    };
    // The URLs too: each <audio> is keyed by its URL, so a new file is a new element.
  }, [sourceAudioUrl, synthAudioUrl, elementsFor, heardElement, pauseAll, setPlaying, startPlayback]);

  /*
   * A new file under a track (a new dub, a sync result, another job) is a
   * new element starting at zero. Playback that used it stops, and the new
   * element is put where the playhead was so the two still agree.
   */
  const lastUrlsRef = useRef({ source: sourceAudioUrl, synth: synthAudioUrl });
  useEffect(() => {
    const last = lastUrlsRef.current;
    lastUrlsRef.current = { source: sourceAudioUrl, synth: synthAudioUrl };
    const sourceChanged = last.source !== sourceAudioUrl;
    const synthChanged = last.synth !== synthAudioUrl;
    if (!sourceChanged && !synthChanged) return;
    // The live dub plays on through a new render of the synced dub: that file isn't what is heard.
    if (isPlayingRef.current && (sourceChanged || (playModeRef.current !== 'source' && !liveDubRef.current))) pauseAll();
    if (sourceChanged) return; // A new job starts from zero; its loaders reset the position.
    const el = synthAudioRef.current;
    if (!el) return;
    const at = currentTimeRef.current;
    const restore = () => {
      el.currentTime = Math.min(at, isFinite(el.duration) ? el.duration : at);
    };
    if (el.readyState >= 1) restore();
    else el.addEventListener('loadedmetadata', restore, { once: true });
    return () => el.removeEventListener('loadedmetadata', restore);
  }, [sourceAudioUrl, synthAudioUrl, pauseAll]);

  /*
   * While playing, every frame: stop a solo cue exactly at its end, and in
   * 'both' keep the dub locked to the original. Two <audio> elements run on
   * separate clocks and drift apart; small drift is pulled in by nudging the
   * dub's rate by 1% (preview only, never a render), large drift by a seek.
   */
  useEffect(() => {
    if (!isPlaying) return;
    let frame = 0;
    let lastLock = 0;
    const tick = (now: number) => {
      const heard = heardElement();
      if (stopAtRef.current !== null && heard && heard.currentTime >= stopAtRef.current) {
        pauseAll();
        return;
      }
      const source = sourceAudioRef.current;
      const synth = synthAudioRef.current;
      if (playModeRef.current === 'both' && !liveDubRef.current && source && synth && now - lastLock > 100) {
        lastLock = now;
        const rate = playbackRateRef.current;
        if (source.paused || synth.paused || source.seeking || synth.seeking) {
          if (synth.playbackRate !== rate) synth.playbackRate = rate;
        } else {
          const drift = synth.currentTime - source.currentTime;
          if (Math.abs(drift) > 0.08) {
            synth.currentTime = source.currentTime;
            synth.playbackRate = rate;
          } else if (Math.abs(drift) > 0.012) {
            synth.playbackRate = rate * (drift > 0 ? 0.99 : 1.01);
          } else if (synth.playbackRate !== rate) {
            synth.playbackRate = rate;
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (synthAudioRef.current) synthAudioRef.current.playbackRate = playbackRateRef.current;
    };
  }, [isPlaying, heardElement, pauseAll]);

  /*
   * The live dub: turned on or off while playing, playback carries on from
   * the same place on the other player. While on, it follows the original's
   * clock every few frames, and edits reach it the moment they are made.
   */
  const lastLiveRef = useRef(liveDub);
  useEffect(() => {
    mixer.setLive(liveDub, () => playModeRef.current === 'synth');
    if (lastLiveRef.current === liveDub) return;
    lastLiveRef.current = liveDub;
    if (!isPlayingRef.current) return;
    const at = sourceAudioRef.current?.currentTime ?? currentTimeRef.current;
    pauseAll();
    startPlayback(playModeRef.current, at);
  }, [liveDub, mixer.setLive, pauseAll, startPlayback]);

  useEffect(() => {
    if (!liveDub || !editTimingAudio) return;
    let engine: LiveDubEngine | null = null;
    const tick = () => {
      const el = sourceAudioRef.current;
      const on = isPlayingRef.current && playModeRef.current !== 'source' && el && !el.paused && !el.seeking && el.readyState >= 3;
      if (!on || !el) {
        engine?.stop();
        return;
      }
      if (!engine) {
        const out = mixer.liveOutput();
        if (!out) return;
        engine = new LiveDubEngine(out.ctx, out.input, editTimingAudio);
        engine.setOriginal(liveOriginalRef.current);
        engine.setClips(liveDubClipsRef.current);
        liveEngineRef.current = engine;
      }
      engine.follow(el.currentTime);
    };
    tick();
    const timer = window.setInterval(tick, 40);
    return () => {
      window.clearInterval(timer);
      engine?.dispose();
      liveEngineRef.current = null;
    };
  }, [liveDub, editTimingAudio, mixer.liveOutput]);

  useEffect(() => {
    liveEngineRef.current?.setClips(liveDubClips);
  }, [liveDubClips]);
  useEffect(() => {
    liveEngineRef.current?.setOriginal(liveOriginal);
  }, [liveOriginal]);

  // Spacebar shortcuts for play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay]);

  /*
   * Fetch ElevenLabs voices when a key is available.
   *
   * Returns a promise so callers that need the refreshed list — the Voice
   * Changer after cloning a voice, for instance — can await it before they
   * select the new voice ID.
   */
  const cartesiaConfigured = Boolean(backendHealth?.cartesiaConfigured);
  const fetchVoices = useCallback(async () => {
    const useElevenLabs = Boolean(elApiKey) && elApiKey.length > 10;
    if (!useElevenLabs && !cartesiaConfigured) {
      if (backendChecked) setVoicesSettled(true);
      return;
    }
    setIsLoadingVoices(true);
    // One library for both engines; Cartesia voice IDs carry a cartesia: prefix.
    // Each engine's voices land as soon as they arrive, so a slow Cartesia call
    // never holds back the ElevenLabs grid. An empty answer is a failed call
    // (every account has premade voices), so it keeps what is already shown.
    const land = (engine: VoiceEngine, voices: Voice[]) => {
      setAvailableVoices((prev) => {
        if (!voices.length) return prev;
        const next =
          engine === 'elevenlabs'
            ? [...voices, ...prev.filter((v) => engineOfVoice(v.voice_id) === 'cartesia')]
            : [...prev.filter((v) => engineOfVoice(v.voice_id) === 'elevenlabs'), ...voices];
        try {
          localStorage.setItem(VOICE_LIBRARY_CACHE_KEY, JSON.stringify(next.map(slimVoice)));
        } catch {}
        return next;
      });
    };
    try {
      await Promise.all([
        useElevenLabs ? getVoices(elApiKey).then((v) => land('elevenlabs', v)) : null,
        cartesiaConfigured ? getCartesiaVoices().then((v) => land('cartesia', v)) : null,
      ]);
    } finally {
      setIsLoadingVoices(false);
      setVoicesSettled(true);
    }
  }, [elApiKey, cartesiaConfigured, backendChecked]);

  useEffect(() => {
    void fetchVoices();
  }, [fetchVoices]);

  // The live model list, so the dub can be voiced with any model the account offers.
  useEffect(() => {
    if (!elApiKey || elApiKey.length <= 10) return;
    let cancelled = false;
    getModels(elApiKey).then((list) => {
      if (!cancelled && list.length) setElModels(list.filter((m) => m.can_do_text_to_speech !== false));
    });
    return () => {
      cancelled = true;
    };
  }, [elApiKey]);

  // Save ElevenLabs settings to local storage
  const handleElVoiceIdChange = (id: string) => {
    // Custom slider values were tuned for the previous voice; a new voice
    // starts from its own ElevenLabs settings.
    if (id !== elVoiceId) handleElVoiceSettingsChange(null);
    setElVoiceId(id);
    try {
      localStorage.setItem('elVoiceId', id);
      // Remembered per engine, so switching back returns to this voice.
      localStorage.setItem(LAST_VOICE_STORAGE_KEY, JSON.stringify({ ...readLastVoices(), [engineOfVoice(id)]: id }));
    } catch {}
  };

  /*
   * Cartesia can only be on once its key is set up. Until the backend has
   * answered, the saved choice stands, so a reload does not flip it.
   */
  const activeVoiceEngine: VoiceEngine =
    voiceEngine === 'cartesia' && backendChecked && !cartesiaConfigured ? 'elevenlabs' : voiceEngine;

  /** The voices of the engine that is on; the other engine's are switched off. */
  const engineVoices = useMemo(
    () => availableVoices.filter((voice) => engineOfVoice(voice.voice_id) === activeVoiceEngine),
    [availableVoices, activeVoiceEngine]
  );

  /** The voice to use on `engine`: the one last picked there, else the best fit for the dub language. */
  const pickVoiceFor = (engine: VoiceEngine, voices: Voice[]): string | null => {
    const remembered = readLastVoices()[engine];
    if (remembered && (voices.length === 0 || voices.some((voice) => voice.voice_id === remembered))) {
      return remembered;
    }
    if (voices.length === 0) return engine === 'elevenlabs' ? DEFAULT_ELEVENLABS_VOICE_ID : null;
    const language = activeJob?.language || selectedLanguage;
    const best = voices.reduce((top, voice) => (languageFit(voice, language) > languageFit(top, language) ? voice : top));
    return best.voice_id;
  };

  const handleVoiceEngineChange = (engine: VoiceEngine) => {
    setVoiceEngine(engine);
    try {
      localStorage.setItem(VOICE_ENGINE_STORAGE_KEY, engine);
    } catch {}
    if (engineOfVoice(elVoiceId) === engine) return;
    const next = pickVoiceFor(
      engine,
      availableVoices.filter((voice) => engineOfVoice(voice.voice_id) === engine)
    );
    if (next) handleElVoiceIdChange(next);
  };

  /*
   * The voice picker's switch. Cartesia needs a key first, so choosing it
   * without one opens API settings with Cartesia already selected.
   */
  const [pendingVoiceEngine, setPendingVoiceEngine] = useState<VoiceEngine | null>(null);
  const requestVoiceEngine = (engine: VoiceEngine) => {
    if (engine === 'cartesia' && !cartesiaConfigured) {
      if (backendSettings?.canSaveKeys) {
        setPendingVoiceEngine('cartesia');
        setIsApiSettingsOpen(true);
      }
      return;
    }
    handleVoiceEngineChange(engine);
  };

  // Keep the chosen voice on the engine that is on, e.g. once Cartesia's voices load or its key is removed.
  useEffect(() => {
    if (engineOfVoice(elVoiceId) === activeVoiceEngine) return;
    if (activeVoiceEngine === 'cartesia' && engineVoices.length === 0) return; // still loading
    const next = pickVoiceFor(activeVoiceEngine, engineVoices);
    if (next && next !== elVoiceId) handleElVoiceIdChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeVoiceEngine, engineVoices, elVoiceId]);

  const handleElModelIdChange = (model: string) => {
    setElModelId(model);
    try {
      localStorage.setItem('elModelId', model);
    } catch {}
  };

  const handleElVoiceSettingsChange = (settings: ElevenLabsVoiceSettings | null) => {
    setElVoiceSettings(settings);
    try {
      if (settings) localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
      else localStorage.removeItem(VOICE_SETTINGS_STORAGE_KEY);
    } catch {}
  };

  // Process uploaded files
  const handleFilesUpload = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    const file = fileArray[0];
    const newJob: BatchJob = {
      id: Math.random().toString(36).substring(2, 9),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      file,
      status: ProcessingStatus.ANALYZING_AUDIO,
      script: '',
      language: selectedLanguage,
      sourceLanguage,
      manualDuration: '',
      expression: 'Warm, conversational studio tone',
      pronunciations: [],
      customPrompt,
      promptPresetId,
      history: { past: [], future: [] },
      audioMetadata: null,
      audioBuffer: null,
      segments: [],
      xmlOutput: '',
      validationResult: null,
      synthesizedAudioUrl: null,
      synthesizedBlob: null,
      srtUrl: null,
      srtBlob: null,
      synthAudioBuffer: null,
      errorMsg: null,
      // Nothing is translated on upload; the user chooses once the transcript is in.
      targetSource: 'pending',
    };

    try {
      const { metadata, buffer, segments } = await analyzeAudio(file);
      newJob.audioMetadata = metadata;
      newJob.audioBuffer = buffer;
      newJob.segments = segments;
      newJob.status = ProcessingStatus.IDLE;
    } catch (e: any) {
      console.warn('Audio analysis notice:', e);
      newJob.status = ProcessingStatus.IDLE;
    }

    await saveJobToStorage(newJob);
    // A new project goes in beside the others; nothing is deleted until the user deletes it.
    setQueue((prev) => [newJob, ...prev]);
    setActiveJobId(newJob.id);

    // Adding a file only adds it: nothing goes to ElevenLabs until the user
    // presses Transcribe, so the language and speakers can be set first.
  };

  // Load sample session
  const handleLoadSampleSession = async (sampleType: 'podcast' | 'keynote') => {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const duration = sampleType === 'podcast' ? 14 : 18;
    const sampleRate = 44100;
    const buffer = audioCtx.createBuffer(2, sampleRate * duration, sampleRate);

    // Generate warm tone with realistic pauses
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < buffer.length; i++) {
        const t = i / sampleRate;
        const inPause = (t > 3.8 && t < 4.8) || (t > 9.2 && t < 10.2);
        if (inPause) {
          data[i] = (Math.random() - 0.5) * 0.002;
        } else {
          const freq = channel === 0 ? 220 : 220.5;
          const tone = Math.sin(2 * Math.PI * freq * t) * 0.15;
          const harmonic = Math.sin(2 * Math.PI * (freq * 2) * t) * 0.05;
          const envelope = Math.sin(Math.PI * (t % 4.5) / 4.5);
          data[i] = (tone + harmonic) * Math.max(0, envelope) + (Math.random() - 0.5) * 0.005;
        }
      }
    }

    const wavBlob = audioBufferToWav(buffer);
    const file = new File(
      [wavBlob],
      sampleType === 'podcast' ? 'studio_podcast_interview.wav' : 'tech_keynote_speech.wav',
      { type: 'audio/wav' }
    );

    const segments: AudioSegment[] =
      sampleType === 'podcast'
        ? [
            {
              id: 'seg-1',
              startTime: 0.0,
              endTime: 3.8,
              duration: 3.8,
              speaker: 'Host',
              originalText: 'Welcome back to the podcast. Today we are exploring the frontiers of artificial intelligence.',
              targetText: 'पॉडकास्ट में फिर स्वागत है। आज बात एआई के नए दौर की।',
              textSource: 'Welcome back to the podcast. Today we are exploring the frontiers of artificial intelligence.',
              textTarget: 'पॉडकास्ट में फिर स्वागत है। आज बात एआई के नए दौर की।',
              emotion: 'conversational',
              speedRate: 1.0,
            },
            {
              id: 'seg-2',
              startTime: 4.8,
              endTime: 9.2,
              duration: 4.4,
              speaker: 'Guest',
              originalText: 'Thank you for having me. The rate of progress over the last six months has been truly unprecedented.',
              targetText: 'शुक्रिया। पिछले छह महीनों में जो तरक्की हुई, वो बेमिसाल है।',
              textSource: 'Thank you for having me. The rate of progress over the last six months has been truly unprecedented.',
              textTarget: 'शुक्रिया। पिछले छह महीनों में जो तरक्की हुई, वो बेमिसाल है।',
              emotion: 'thoughtful',
              speedRate: 1.0,
            },
            {
              id: 'seg-3',
              startTime: 10.2,
              endTime: 13.9,
              duration: 3.7,
              speaker: 'Host',
              originalText: 'Let us dive straight into multimodal models and live speech translation.',
              targetText: 'चलिए, सीधे मल्टीमोडल मॉडल और लाइव अनुवाद पर आएँ।',
              textSource: 'Let us dive straight into multimodal models and live speech translation.',
              textTarget: 'चलिए, सीधे मल्टीमोडल मॉडल और लाइव अनुवाद पर आएँ।',
              emotion: 'enthusiastic',
              speedRate: 1.0,
            },
          ]
        : [
            {
              id: 'seg-1',
              startTime: 0.0,
              endTime: 4.5,
              duration: 4.5,
              speaker: 'Presenter',
              originalText: 'Good morning everyone, and welcome to our annual product announcement keynote.',
              targetText: 'सभी को सुप्रभात, सालाना प्रोडक्ट लॉन्च कीनोट में स्वागत है।',
              textSource: 'Good morning everyone, and welcome to our annual product announcement keynote.',
              textTarget: 'सभी को सुप्रभात, सालाना प्रोडक्ट लॉन्च कीनोट में स्वागत है।',
              emotion: 'confident',
              speedRate: 1.0,
            },
            {
              id: 'seg-2',
              startTime: 5.5,
              endTime: 11.2,
              duration: 5.7,
              speaker: 'Presenter',
              originalText: 'Today we are introducing a new era of voice technology that preserves natural pauses and emotion.',
              targetText: 'आज हम वॉइस टेक्नोलॉजी का नया दौर ला रहे हैं, जो ठहराव और भाव सहेजकर रखता है।',
              textSource: 'Today we are introducing a new era of voice technology that preserves natural pauses and emotion.',
              textTarget: 'आज हम वॉइस टेक्नोलॉजी का नया दौर ला रहे हैं, जो ठहराव और भाव सहेजकर रखता है।',
              emotion: 'visionary',
              speedRate: 1.0,
            },
            {
              id: 'seg-3',
              startTime: 12.0,
              endTime: 17.5,
              duration: 5.5,
              speaker: 'Presenter',
              originalText: 'Every speaker can now be heard in over twenty languages with zero loss of authenticity.',
              targetText: 'अब हर वक्ता बीस से ज़्यादा भाषाओं में सुना जा सकता है, अपनी असलियत खोए बिना।',
              textSource: 'Every speaker can now be heard in over twenty languages with zero loss of authenticity.',
              textTarget: 'अब हर वक्ता बीस से ज़्यादा भाषाओं में सुना जा सकता है, अपनी असलियत खोए बिना।',
              emotion: 'inspiring',
              speedRate: 1.0,
            },
          ];

    // The sample's lines are written in Hindi. Any other dub language starts
    // from the transcript and waits for translate or a pasted script, as an
    // upload does; nothing is translated on load.
    const sampleIsInTarget = !selectedLanguage || selectedLanguage === 'Hindi';
    if (!sampleIsInTarget) {
      segments.forEach((s) => {
        s.textTarget = '';
        s.targetText = '';
      });
    }

    const fullScript = sampleIsInTarget ? segments.map((s) => `[${s.speaker}]: ${s.targetText}`).join('\n\n') : '';

    const newJob: BatchJob = {
      id: Math.random().toString(36).substring(2, 9),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      file,
      status: ProcessingStatus.IDLE,
      script: fullScript,
      language: selectedLanguage,
      manualDuration: '0:14.00',
      expression: 'Warm, conversational studio tone',
      pronunciations: [],
      history: { past: [], future: [] },
      audioMetadata: { fileName: file.name, fileType: file.type, duration: buffer.duration },
      audioBuffer: buffer,
      segments,
      xmlOutput: '',
      validationResult: null,
      synthesizedAudioUrl: null,
      synthesizedBlob: null,
      srtUrl: null,
      srtBlob: null,
      synthAudioBuffer: null,
      errorMsg: null,
      detectedLanguage: 'English',
      targetSource: sampleIsInTarget ? 'translated' : 'pending',
    };

    await saveJobToStorage(newJob);
    // A new project goes in beside the others; nothing is deleted until the user deletes it.
    setQueue((prev) => [newJob, ...prev]);
    setActiveJobId(newJob.id);
  };

  /**
   * Transcribes with ElevenLabs and stops at the transcript.
   *
   * ElevenLabs owns the transcript and every timestamp. The user then chooses
   * automatic translation or their own script; neither runs from here.
   */
  /** Transcribe, as pressed in Source & voice. True once there is a transcript; false when it failed or was cancelled. */
  const handleAutoTranscribe = async (): Promise<boolean> => {
    if (!activeJob) return false;
    try {
      const targetLang = activeJob.language || selectedLanguage;
      const result = await runTranscription(activeJob.id, activeJob.file, activeJob.sourceLanguage ?? sourceLanguage);
      if (!result) return false;

      updateJob(activeJob.id, {
        language: targetLang,
        detectedLanguage: result.detectedLanguage,
        script: '',
        segments: result.segments,
        originalSrt: result.originalSrt,
        translatedSrt: '',
        translationWarning: null,
        targetSource: 'pending',
        errorMsg: null,
        xmlOutput: '',
        validationResult: null,
        synthesizedAudioUrl: null,
        synthesizedBlob: null,
        srtUrl: null,
        srtBlob: null,
        synthAudioBuffer: null,
        syncedAudioUrl: null,
        syncedBlob: null,
        syncedAudioBuffer: null,
        syncReport: null,
        syncBank: null,
        syncBankBlob: null,
        syncEdits: null,
        syncBaseReport: null,
        dubStems: null,
        dubMix: null,
        syncedStems: null,
        syncMix: null,
        lastStep: 2,
      });
      // The transcript is in, so Review is open: go there, if this project is still the one on screen.
      if (activeJobIdRef.current === activeJob.id) setStepOverride(2);
      return true;
    } catch (err: any) {
      updateJob(activeJob.id, { errorMsg: describePipelineError(err) });
      return false;
    }
  };

  /**
   * Voice expression Natural: the job's cues tagged from the original speaker's
   * delivery. Heard once per wording and kept, so a dub and a sync of the same
   * script share the same tags. `onListen` is called when the source must be heard.
   */
  const sourceTaggedSegments = async (job: BatchJob, language: string, signal: AbortSignal, onListen?: () => void) => {
    if (!job.audioBuffer) {
      throw new Error('The source audio is not loaded, so it cannot be matched. Reopen the project, or set Expression to Neutral.');
    }
    const key = JSON.stringify([language, job.segments.map((s) => [s.startTime, s.endTime, s.textTarget || s.targetText || ''])]);
    const cached = sourceCueCacheRef.current[job.id];
    if (cached?.key === key) return cached.segments;
    onListen?.();
    const result = await matchSourceDelivery(job.audioBuffer, job.segments, language, { signal });
    if (result.taggedSections === 0) console.warn('Natural added no tags; the script is voiced as written.');
    sourceCueCacheRef.current[job.id] = { key, segments: result.segments };
    return result.segments;
  };

  /**
   * Sync: voices the cues line by line and places each line on its source
   * phrase, so the dub plays in step with the original. The result is the
   * synced dub, its own file beside the dub (which it leaves alone), and is
   * exactly as long as the source.
   */
  /** Stops an edit render that is waiting or running; its edits stay, unrendered. */
  const cancelSyncEditRender = () => {
    const run = syncEditRunRef.current;
    if (run.timer !== null) window.clearTimeout(run.timer);
    run.controller?.abort();
    syncEditRunRef.current = { timer: null, controller: null };
  };

  /**
   * Renders the synced dub again with its edits, `delay` ms from now unless
   * another edit comes first, and puts it where the synced dub is: the player,
   * the download and the waveform all follow it.
   */
  const scheduleSyncEditRender = (
    jobId: string,
    input: { bank: NonNullable<BatchJob['syncBank']>; bankBlob: Blob | null | undefined; baseReport: NonNullable<BatchJob['syncReport']>; edits: SyncEdits | null; sourceDuration: number; source: AudioBuffer | null | undefined },
    delay = SYNC_EDIT_RENDER_DELAY_MS
  ) => {
    cancelSyncEditRender();
    setSyncEditStatus({ state: 'pending' });
    const timer = window.setTimeout(async () => {
      const controller = new AbortController();
      syncEditRunRef.current = { timer: null, controller };
      setSyncEditStatus({ state: 'rendering' });
      try {
        const { blob, stems, mix } = await renderSyncEdits(
          { bank: input.bank, bankBlob: input.bankBlob, edits: input.edits, report: input.baseReport, sourceDuration: input.sourceDuration, source: input.source },
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const several = Boolean(input.baseReport.mix);
        const previousUrl = jobId === activeJobId ? currentSyncedUrlRef.current : null;
        updateJob(jobId, {
          syncedAudioUrl: url,
          syncedBlob: blob,
          syncedStems: several ? stems : null,
          // The overlaps kept are the sync's; the peak and gains are the edited mix's.
          syncMix: several ? { ...(input.baseReport.mix as DubMixReport), ...(mix || {}) } : null,
          syncedAudioBuffer: null,
        });
        decodingSynthUrlRef.current = url;
        decodeAudioBlobUrl(url)
          .then((buffer) => {
            if (currentSyncedUrlRef.current === url) updateJob(jobId, { syncedAudioBuffer: buffer });
          })
          .catch(console.warn)
          .finally(() => {
            if (decodingSynthUrlRef.current === url) decodingSynthUrlRef.current = null;
          });
        // The file before this render is kept with the project as a Blob until replaced; its URL can go once the player has moved on.
        if (previousUrl) window.setTimeout(() => URL.revokeObjectURL(previousUrl), 5000);
        setSyncEditStatus({ state: 'ready' });
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        console.error('Edit render error:', err);
        setSyncEditStatus({ state: 'error', message: err?.message || 'The edited dub could not be rendered.' });
      } finally {
        if (syncEditRunRef.current.controller === controller) syncEditRunRef.current = { timer: null, controller: null };
      }
    }, delay);
    syncEditRunRef.current = { timer, controller: null };
  };

  /** Edit timing changed a line: the report follows at once, the audio once the user pauses. */
  const handleSyncEditsChange = (edits: SyncEdits) => {
    if (!activeJob?.syncBank || !activeJob.syncBaseReport) return;
    const clean = hasEdits(edits) ? edits : null;
    updateJob(activeJob.id, { syncEdits: clean, syncReport: measureEdits(activeJob.syncBaseReport, activeJob.syncBank, clean) });
    scheduleSyncEditRender(activeJob.id, {
      bank: activeJob.syncBank,
      bankBlob: activeJob.syncBankBlob,
      baseReport: activeJob.syncBaseReport,
      edits: clean,
      sourceDuration: sourceDurationOf(activeJob),
      source: activeJob.audioBuffer,
    });
  };

  /** Renders the edits again after a failed render. */
  const handleRetrySyncEditRender = () => {
    if (!activeJob?.syncBank || !activeJob.syncBaseReport) return;
    scheduleSyncEditRender(
      activeJob.id,
      { bank: activeJob.syncBank, bankBlob: activeJob.syncBankBlob, baseReport: activeJob.syncBaseReport, edits: activeJob.syncEdits || null, sourceDuration: sourceDurationOf(activeJob), source: activeJob.audioBuffer },
      0
    );
  };

  /**
   * One continuous read: the whole script voiced in one take, as a narrator
   * reads it, for Sync to cut each line from. Kept on the job as its dub, with
   * what it says and how it was voiced, so Sync again reuses it until that
   * changes; lines reworded since are voiced on their own.
   */
  /** Whether the dub's voice can take Natural or Expressive: an Eleven v3/v4 model, or a Cartesia sonic-3 one. */
  const expressionTakesTags = () =>
    isCartesiaVoice(elVoiceId) ? cartesiaTakesControls(cartesiaVoice.modelId) : performsAudioTags(elModelId);

  const readScript = async (job: BatchJob, language: string, readKey: string, matchLoudness: boolean, signal: AbortSignal) => {
    const readJobId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `read-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    if (syncRunRef.current) syncRunRef.current.readJobId = readJobId;
    setReadProgress({ phase: 'preparing', passageCount: 0, passagesDone: 0, totalChars: 0, charsDone: 0, secondsGenerated: 0, streaming: true });
    const poll = window.setInterval(() => {
      getDubProgress(readJobId)
        .then((progress) => {
          if (syncRunRef.current?.readJobId === readJobId) setReadProgress(progress);
        })
        // The job is only registered once the request reaches the server; until then, keep waiting.
        .catch(() => {});
    }, 700);
    try {
      // Natural: tag the script from the original speaker's delivery before voicing it.
      const tags = expressionTakesTags();
      const expression: VoiceExpression = tags || voiceExpression === 'off' ? voiceExpression : 'neutral';
      const matchSource = expression === 'natural';
      let script = buildSpeechScript(job.segments);
      if (matchSource) {
        const tagged = await sourceTaggedSegments(job, language, signal, () =>
          setReadProgress({ phase: 'listening', passageCount: 0, passagesDone: 0, totalChars: 0, charsDone: 0, secondsGenerated: 0, streaming: true })
        );
        script = buildSpeechScript(tagged);
      }
      const blob = await synthesizeSpeech(elApiKey, elVoiceId, script, elModelId, elOutputFormat, elVoiceSettings, {
        expressive: expression === 'expressive',
        audioTags: matchSource,
        performanceTags: matchSource,
        steady: expression === 'neutral',
        matchLoudness,
        tuneStability,
        onStabilityAdjustment: setLastStabilityAdjustment,
        cartesia: cartesiaForExpression(cartesiaVoice, expression),
        language,
        jobId: readJobId,
        signal,
      });
      const lines: DubLines = {
        dubId: readJobId,
        voiceId: elVoiceId,
        modelId: elModelId,
        readKey,
        cues: job.segments
          .map((segment) => ({ id: String(segment.id), text: (segment.textTarget || segment.targetText || '').trim() }))
          .filter((cue) => cue.text),
      };
      updateJob(job.id, {
        synthesizedAudioUrl: URL.createObjectURL(blob),
        synthesizedBlob: blob,
        synthAudioBuffer: null,
        dubScriptCharacters: scriptCharacterCount(job.segments),
        dubLines: lines,
        dubStems: null,
        dubMix: null,
      });
      return { blob, lines };
    } finally {
      window.clearInterval(poll);
      if (syncRunRef.current?.readJobId === readJobId) syncRunRef.current.readJobId = undefined;
      setReadProgress(null);
    }
  };

  const handleSyncDub = async ({ voicing, precision, join, suggest, suggestLonger, matchLoudness }: SyncOptions) => {
    if (!activeJob || activeJob.segments.length === 0 || isSyncing) return;
    if (activeJob.targetSource === 'pending') return;

    const hadDub = Boolean(activeJob.synthesizedAudioUrl || activeJob.syncedAudioUrl);
    setIsSyncing(true);
    setSyncError(null);
    updateJob(activeJob.id, { status: ProcessingStatus.SYNTHESIZING_AUDIO, errorMsg: null });

    const jobId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const controller = new AbortController();
    syncRunRef.current = { jobId, controller };
    setSyncProgress(null);
    setIsCancellingSync(false);
    const poll = window.setInterval(() => {
      getSyncProgress(jobId)
        .then((progress) => {
          if (syncRunRef.current?.jobId === jobId) setSyncProgress(progress);
        })
        .catch(() => {});
    }, 700);

    const seed = (syncSeedRef.current[activeJob.id] ??= Math.floor(Math.random() * 2 ** 31));
    const sourceDuration = sourceDurationOf(activeJob);

    // Locked lines in Edit timing stay where the user put them.
    const priorBank = activeJob.syncBank || null;
    const priorEdits = activeJob.syncEdits || null;
    const locked = lockedLines(priorBank, priorEdits);
    // An edit render in flight belongs to the dub this sync replaces.
    cancelSyncEditRender();

    try {
      const several = isMultiSpeaker(activeJob.segments);
      const language = activeJob.language || selectedLanguage;
      // Tags need one voice on a model that performs them; otherwise the dub is voiced as Neutral (or Off).
      const tags = !several && expressionTakesTags();
      const expression: VoiceExpression = tags || voiceExpression === 'off' ? voiceExpression : 'neutral';
      const cartesiaDub = cartesiaForExpression(cartesiaVoice, expression);
      let voiceTexts: Record<string, string> | undefined;
      if (expression === 'natural') {
        const tagged = await sourceTaggedSegments(activeJob, language, controller.signal);
        voiceTexts = Object.fromEntries(tagged.map((segment) => [String(segment.id), segment.textTarget || segment.targetText || '']));
      }
      /*
       * One continuous read (one voice only): the script is read in one take,
       * or the last read is reused while it was voiced the same way, and its
       * lines are cut from it rather than voiced again. A dub made before Dub
       * and Sync were one step counts as a read by its voice.
       */
      let dub: { blob: Blob; lines: DubLines } | undefined;
      if (voicing === 'continuous' && !several) {
        const readKey = JSON.stringify([elVoiceId, elModelId, elVoiceSettings ?? null, expression, matchLoudness, cartesiaDub]);
        const last = activeJob.dubLines;
        const lastFits =
          activeJob.synthesizedBlob && last && last.voiceId === elVoiceId && last.modelId === elModelId && (last.readKey ?? readKey) === readKey;
        dub =
          lastFits && activeJob.synthesizedBlob && last
            ? { blob: activeJob.synthesizedBlob, lines: last }
            : await readScript(activeJob, language, readKey, matchLoudness, controller.signal);
      }
      const { blob, stems, report, bank, bankBlob } = await syncDub(
        {
          segments: activeJob.segments,
          sourceDuration,
          voiceId: elVoiceId,
          modelId: elModelId,
          outputFormat: elOutputFormat,
          voiceSettings: elVoiceSettings,
          language,
          seed,
          precision,
          join,
          suggest,
          suggestLonger,
          matchLoudness,
          lineSeeds: activeJob.syncLineSeeds || undefined,
          debug: audioDebugEnabled(),
          cartesia: cartesiaDub,
          ...(voiceTexts && { voiceTexts }),
          ...(expression === 'expressive' && { expressive: true }),
          ...(expression === 'neutral' && { steady: true }),
          ...(dub && { dub }),
          ...(several && { multiSpeaker: true, cast: activeJob.cast, peak: mixPeak }),
          ...(Object.keys(locked).length > 0 && { locked }),
          tuneStability,
        },
        { apiKey: elApiKey, jobId, signal: controller.signal }
      );
      const { edits: keptEdits, dropped } = rebaseEdits(priorEdits, priorBank, bank);
      const edited = hasEdits(keptEdits);
      if (report.audioDebug) {
        const { lines, ...format } = report.audioDebug;
        console.info('[sync audio]', format);
        console.table(lines.map(({ pauseCuts, ...line }) => ({ ...line, pauseCuts: pauseCuts.length })));
      }
      setLastStabilityAdjustment(report.stabilityAdjustment ?? null);

      const url = URL.createObjectURL(blob);
      // A dub made before Dub and Sync were one step stays as it was, beside the synced dub.
      updateJob(activeJob.id, {
        syncedAudioUrl: url,
        syncedBlob: blob,
        syncReport: edited ? measureEdits(report, bank, keptEdits) : report,
        syncBaseReport: report,
        syncBank: bank,
        syncBankBlob: bankBlob,
        syncEdits: edited ? keptEdits : null,
        syncPendingLines: [],
        syncedStems: several ? stems : null,
        syncMix: several ? report.mix || null : null,
        // Until the synced dub decodes, no waveform rather than the previous sync's.
        syncedAudioBuffer: null,
        status: ProcessingStatus.COMPLETED,
      });
      setSyncEditStatus(
        dropped.length > 0
          ? {
              state: 'ready',
              notice: `${dropped.length === 1 ? 'One line was' : `${dropped.length} lines were`} voiced again, so ${dropped.length === 1 ? 'its' : 'their'} hand edits were dropped.`,
            }
          : { state: 'ready' }
      );
      // The sync placed the locked lines' blocks; their edits are rendered over them now.
      if (edited) scheduleSyncEditRender(activeJob.id, { bank, bankBlob, baseReport: report, edits: keptEdits, sourceDuration, source: activeJob.audioBuffer }, 0);
      decodingSynthUrlRef.current = url;
      decodeAudioBlobUrl(url)
        .then((syncedBuffer) => {
          if (currentSyncedUrlRef.current === url) updateJob(activeJob.id, { syncedAudioBuffer: syncedBuffer });
        })
        .catch(console.warn)
        .finally(() => {
          if (decodingSynthUrlRef.current === url) decodingSynthUrlRef.current = null;
        });

      // Synced, the dub is best judged against the original.
      setTrackMode('both');
      refreshQuota();
    } catch (err: any) {
      // A failed or cancelled sync leaves the dub and the last synced dub as they were.
      updateJob(activeJob.id, { status: hadDub ? ProcessingStatus.COMPLETED : ProcessingStatus.IDLE });
      if (!controller.signal.aborted && err?.code !== 'cancelled') {
        console.error('Sync Error:', err);
        setSyncError(err?.message || 'Sync failed.');
      }
    } finally {
      window.clearInterval(poll);
      if (syncRunRef.current?.jobId === jobId) syncRunRef.current = null;
      setSyncProgress(null);
      setIsCancellingSync(false);
      setIsSyncing(false);
    }
  };

  /** Puts a new wording of a synced line into the script. The next Sync voices it. */
  const handleApplySyncLine = (unit: SyncUnitReport, text: string) => {
    if (!activeJob || !text.trim()) return;
    const ids = unit.cueIds.map(String);
    const cues = activeJob.segments.filter((s) => ids.includes(String(s.id)));
    const texts = distributeLineText(text, cues.map((c) => c.textTarget || c.targetText || ''));
    const byId = new Map(cues.map((c, n) => [String(c.id), texts[n] ?? '']));
    updateJob(activeJob.id, {
      segments: activeJob.segments.map((s) =>
        byId.has(String(s.id)) ? { ...s, textTarget: byId.get(String(s.id)), targetText: byId.get(String(s.id)) } : s
      ),
      syncPendingLines: withPendingLines(activeJob.syncPendingLines, [unit.key]),
    });
  };

  /**
   * Asks for a new take of synced lines: the next Sync voices each again with
   * its own seed. A line locked in Edit timing keeps its take and is skipped.
   */
  const handleRetakeSyncLines = (units: SyncUnitReport[]) => {
    if (!activeJob) return;
    const keys = units.map((unit) => unit.key).filter((key) => !activeJob.syncEdits?.[key]?.locked);
    if (keys.length === 0) return;
    const seeds = { ...activeJob.syncLineSeeds };
    for (const key of keys) seeds[key] = Math.floor(Math.random() * 2 ** 31);
    updateJob(activeJob.id, {
      syncLineSeeds: seeds,
      syncPendingLines: withPendingLines(activeJob.syncPendingLines, keys),
    });
  };

  const handleCancelSync = () => {
    const run = syncRunRef.current;
    if (!run) return;
    setIsCancellingSync(true);
    if (run.readJobId) cancelDub(run.readJobId).catch(() => {});
    cancelSync(run.jobId)
      .catch(() => {})
      .finally(() => run.controller.abort());
  };

  // Segment Text Update Handler
  const handleUpdateSegment = useCallback(
    (id: string | number, updates: Partial<AudioSegment>) => {
      if (!activeJob) return;
      const updated = activeJob.segments.map((s) => (s.id === id ? { ...s, ...updates } : s));
      updateJob(activeJob.id, { segments: updated, ...syncPendingAfter(activeJob, updated) });
    },
    [activeJob, updateJob]
  );

  /*
   * Appends transliterated text to the segment the phonetic keyboard was
   * opened for. The keyboard emits one character or one converted word at a
   * time, so this appends rather than replaces.
   */
  const handleInsertPhoneticText = useCallback(
    (text: string) => {
      const target = keyboardActiveSegment;
      if (!activeJob || !target) return;
      const current = activeJob.segments.find((s) => s.id === target.id);
      const existing = current?.textTarget || current?.targetText || '';
      handleUpdateSegment(target.id, {
        textTarget: existing + text,
        targetText: existing + text,
      });
    },
    [activeJob, keyboardActiveSegment, handleUpdateSegment]
  );

  /** Bulk segment replacement, used by the keyboard's batch transliteration. */
  const handleReplaceSegments = useCallback(
    (segments: AudioSegment[]) => {
      if (!activeJob) return;
      // A cut, join or moved cut changes the synced lines it touches: Sync again places them anew.
      updateJob(activeJob.id, { segments, ...syncPendingAfter(activeJob, segments) });
    },
    [activeJob, updateJob]
  );

  // Play Solo Original Audio for specific segment
  /*
   * Play one cue of the original and stop at its end. It switches to the
   * original so the playhead follows what is heard; the transport loop stops
   * it on the frame the cue ends.
   */
  const handlePlaySoloSegment = useCallback(
    (seg: AudioSegment) => {
      if (!sourceAudioRef.current) return;
      changeTrackMode('source', { seek: seg.startTime, play: true });
      stopAtRef.current = seg.endTime;
    },
    [changeTrackMode]
  );

  // Download Master Lossless WAV: the synced dub, else a dub made before Dub and Sync were one step
  const handleDownloadMasterWav = useCallback(() => {
    if (!activeJob) return;
    const blob = playsSynced ? activeJob.syncedBlob : activeJob.synthesizedBlob;
    const buffer = playsSynced ? activeJob.syncedAudioBuffer : activeJob.synthAudioBuffer;
    const file = blob || (buffer ? audioBufferToWav(buffer) : null);
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dhvani_${activeJob.language || 'dubbed'}_${playsSynced ? 'synced' : 'master'}.${blob ? audioFileExtension(blob) : 'wav'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeJob, playsSynced]);

  /** Gives one speaker a voice of their own; null hands them back to the main voice. */
  const handleCastChange = useCallback(
    (speaker: string, voiceId: string | null) => {
      if (!activeJob) return;
      const cast = { ...(activeJob.cast || {}) };
      if (voiceId) cast[speaker] = { voiceId };
      else delete cast[speaker];
      updateJob(activeJob.id, { cast });
    },
    [activeJob, updateJob]
  );

  /** Renames a speaker on every cue they speak; renaming to a speaker who exists merges the two. */
  const handleRenameSpeaker = useCallback(
    (from: string, to: string) => {
      if (!activeJob || !to.trim() || from === to.trim()) return;
      updateJob(activeJob.id, {
        segments: renameSpeaker(activeJob.segments, from, to),
        cast: renameCast(activeJob.cast, from, to),
      });
    },
    [activeJob, updateJob]
  );

  /** Saves one speaker's track of the dub. */
  const handleDownloadStem = useCallback(
    (speaker: string) => {
      // The Sync step hands out the synced dub's stems; every other step the dub's.
      const stems = playsSynced ? activeJob?.syncedStems : activeJob?.dubStems;
      const stem = stems?.find((s) => s.speaker === speaker);
      if (!stem) return;
      const url = URL.createObjectURL(stem.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dhvani_${activeJob?.language || 'dubbed'}_${playsSynced ? 'synced_' : ''}${speaker.replace(/[^\p{L}\p{N}]+/gu, '_')}.${audioFileExtension(stem.blob)}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [activeJob, playsSynced]
  );

  // Download SubRip (.SRT) Subtitles
  const handleDownloadMasterSrt = useCallback(() => {
    if (!activeJob) return;
    let srtOpts = DEFAULT_SRT_OPTIONS;
    try {
      const saved = localStorage.getItem('dhvani_srt_options');
      if (saved) srtOpts = JSON.parse(saved);
    } catch {}
    const srtContent = generateSrtContent(activeJob.segments, srtOpts);
    const blob = new Blob([srtContent], { type: 'text/srt' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dhvani_${activeJob.language || 'captions'}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeJob]);

  // Download Targeted Language Script
  const handleDownloadMasterScript = useCallback(
    (format: TargetScriptFormat = 'dialogue') => {
      if (!activeJob || !activeJob.segments || activeJob.segments.length === 0) return;
      const targetLang = activeJob.language || selectedLanguage || 'Target Language';
      const scriptContent = generateTargetLanguageScript(
        activeJob.segments,
        targetLang,
        format,
        activeJob.file?.name ? `Dhvani Dub - ${activeJob.file.name}` : undefined,
        {
          sourceLanguage: activeJob.detectedLanguage || activeJob.sourceLanguage || undefined,
          fileName: activeJob.file?.name,
          audioDuration: activeJob.audioBuffer?.duration,
        }
      );
      const cleanLang = targetLang.toLowerCase().replace(/\s+/g, '_');
      if (format === 'json') {
        downloadFile(scriptContent, `dhvani_${cleanLang}_script.json`, 'application/json');
        return;
      }
      const ext = format === 'csv' ? 'csv' : 'txt';
      const mime = format === 'csv' ? 'text/csv' : 'text/plain;charset=utf-8';
      downloadFile(scriptContent, `dhvani_${cleanLang}_script_${format}.${ext}`, mime);
    },
    [activeJob, selectedLanguage]
  );

  // Projects: only deleting one, or clearing them all, removes a project's files.
  const handleSelectJob = useCallback(
    (id: string) => {
      setActiveJobId(id);
      pauseAll();
      seekAll(0);
    },
    [pauseAll, seekAll]
  );

  const handleRenameJob = useCallback((id: string, name: string) => updateJob(id, { name }), [updateJob]);

  const handleRemoveJobFromQueue = useCallback(
    async (id: string) => {
      await deleteJobFromStorage(id);
      if (activeJobId === id) {
        pauseAll();
        seekAll(0);
      }
      setQueue((prev) => {
        const next = prev.filter((j) => j.id !== id);
        if (activeJobId === id) {
          setActiveJobId(next.length > 0 ? next[0].id : null);
        }
        return next;
      });
    },
    [activeJobId, pauseAll, seekAll]
  );

  const handleClearAllQueue = useCallback(async () => {
    await clearAllJobsFromStorage();
    setQueue([]);
    setActiveJobId(null);
    pauseAll();
    seekAll(0);
  }, [pauseAll, seekAll]);

  const handleAddFilesToQueue = useCallback(
    async (files: FileList | File[]) => {
      const fileList = Array.from(files);
      if (fileList.length === 0) return;

      const newJobs: BatchJob[] = [];

      for (const file of fileList) {
        const newJob: BatchJob = {
          id: Math.random().toString(36).substring(2, 9),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          file,
          status: ProcessingStatus.IDLE,
          script: '',
          language: selectedLanguage,
          manualDuration: '',
          expression: 'Warm, conversational studio tone',
          pronunciations: [],
          history: { past: [], future: [] },
          audioMetadata: null,
          audioBuffer: null,
          segments: [],
          xmlOutput: '',
          validationResult: null,
          synthesizedAudioUrl: null,
          synthesizedBlob: null,
          srtUrl: null,
          srtBlob: null,
          synthAudioBuffer: null,
          errorMsg: null,
        };

        try {
          const { metadata, buffer, segments } = await analyzeAudio(file);
          newJob.audioMetadata = metadata;
          newJob.audioBuffer = buffer;
          newJob.segments = segments;
        } catch (e) {
          console.warn('Audio analysis notice for queued file:', e);
        }

        await saveJobToStorage(newJob);
        newJobs.push(newJob);
      }

      setQueue((prev) => [...newJobs, ...prev]);

      if (!activeJobId && newJobs.length > 0) {
        setActiveJobId(newJobs[0].id);
      }
    },
    [selectedLanguage, activeJobId]
  );

  // New dub: back to an empty start, with every project kept in Your projects.
  const handleResetSession = useCallback(() => {
    setActiveJobId(null);
    pauseAll();
    seekAll(0);
  }, [pauseAll, seekAll]);

  // Voice Changer: Replace source audio with transformed speech
  const handleApplyTransformedAudio = useCallback(
    async (newAudioFile: File, newAudioBuffer: AudioBuffer) => {
      if (activeJob) {
        try {
          const { metadata, segments } = await analyzeAudio(newAudioFile);
          updateJob(activeJob.id, {
            file: newAudioFile,
            audioBuffer: newAudioBuffer,
            audioMetadata: metadata,
            segments: segments.length > 0 ? segments : activeJob.segments,
            status: ProcessingStatus.READY,
          });
        } catch {
          updateJob(activeJob.id, {
            file: newAudioFile,
            audioBuffer: newAudioBuffer,
            status: ProcessingStatus.READY,
          });
        }
      } else {
        const newJob: BatchJob = {
          id: `job_${Date.now()}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          file: newAudioFile,
          status: ProcessingStatus.READY,
          script: '',
          language: selectedLanguage,
          manualDuration: '',
          expression: 'Warm, conversational studio tone',
          pronunciations: [],
          customPrompt,
          promptPresetId,
          history: { past: [], future: [] },
          audioMetadata: null,
          audioBuffer: newAudioBuffer,
          segments: [],
          xmlOutput: '',
          validationResult: null,
          synthesizedAudioUrl: null,
          synthesizedBlob: null,
          srtUrl: null,
          srtBlob: null,
          synthAudioBuffer: null,
          errorMsg: null,
        };
        try {
          const { metadata, segments } = await analyzeAudio(newAudioFile);
          newJob.audioMetadata = metadata;
          newJob.segments = segments;
        } catch {}
        await saveJobToStorage(newJob);
        // A new project goes in beside the others; nothing is deleted until the user deletes it.
        setQueue((prev) => [newJob, ...prev]);
        setActiveJobId(newJob.id);
      }
    },
    [activeJob, selectedLanguage, customPrompt, promptPresetId, updateJob]
  );

  // Voice Changer: its result takes the place of the track it worked on, the synced dub or an earlier dub
  const handleSetDubbedMaster = useCallback(
    (masterBlob: Blob, masterBuffer: AudioBuffer) => {
      if (!activeJob) return;
      if (playsSynced) cancelSyncEditRender();
      const masterUrl = URL.createObjectURL(masterBlob);
      updateJob(
        activeJob.id,
        playsSynced
          ? {
              syncedAudioBuffer: masterBuffer,
              syncedAudioUrl: masterUrl,
              syncedBlob: masterBlob,
              // The bank is the dub before the voice changer: editing it now would undo the change.
              syncBank: null,
              syncBankBlob: null,
              syncEdits: null,
              syncBaseReport: null,
              status: ProcessingStatus.COMPLETED,
            }
          : { synthAudioBuffer: masterBuffer, synthesizedAudioUrl: masterUrl, synthesizedBlob: masterBlob, status: ProcessingStatus.COMPLETED }
      );
      setTrackMode('synth');
    },
    [activeJob, playsSynced, updateJob]
  );

  /** The finished dub (the synced one once there is one), which is what the voice changer works on (not the source speech). */
  const voiceChangerBuffer = (playsSynced ? activeJob?.syncedAudioBuffer : activeJob?.synthAudioBuffer) || null;
  const voiceChangerBlob = (playsSynced ? activeJob?.syncedBlob : activeJob?.synthesizedBlob) || null;
  const voiceChangerDubFile = useMemo(() => {
    if (!isVoiceChangerOpen || !activeJob) return null;
    const blob = voiceChangerBlob || (voiceChangerBuffer ? audioBufferToWav(voiceChangerBuffer) : null);
    if (!blob) return null;
    const name = `dhvani_${activeJob.language || 'dubbed'}_${playsSynced ? 'synced' : 'dub'}.${audioFileExtension(blob)}`;
    return new File([blob], name, { type: blob.type || 'audio/wav' });
  }, [isVoiceChangerOpen, voiceChangerBlob, voiceChangerBuffer, playsSynced, activeJob?.language]);

  /** The dub script, offered as a starting text in the text-to-speech studio. */
  const ttsProjectScript = useMemo(() => {
    if (!isTextToSpeechOpen || !activeJob) return undefined;
    return activeJob.segments?.length ? buildSpeechScript(activeJob.segments) : activeJob.script?.trim();
  }, [isTextToSpeechOpen, activeJob]);

  // Once ElevenLabs cues exist, local VAD re-segmentation would discard their
  // text, so the pause-sensitivity control is only offered before transcription.
  const activeJobHasTranscript = Boolean(
    activeJob?.segments?.some((seg) => (seg.textSource || seg.textTarget || '').trim())
  );

  // Resegment Audio based on Pause Sensitivity Slider
  const handleSensitivityChange = useCallback(
    (newSensitivity: number) => {
      if (!activeJob) return;
      if (activeJob.audioBuffer) {
        const updatedSegments = resegmentAudioBuffer(
          activeJob.audioBuffer,
          newSensitivity,
          activeJob.segments
        );
        updateJob(activeJob.id, {
          segments: updatedSegments,
          analysisSensitivity: newSensitivity,
        });
      } else {
        updateJob(activeJob.id, {
          analysisSensitivity: newSensitivity,
        });
      }
    },
    [activeJob, updateJob]
  );

  return (
    <div
      className={`flex flex-col min-h-screen font-sans selection:bg-indigo-500 selection:text-white transition-colors duration-200 ${
        effectiveTheme === 'light' ? 'bg-slate-50 text-slate-900' : 'bg-slate-950 text-slate-100'
      }`}
    >
      {/* Hidden Audio Elements for Reference & Synth */}
      {/* Keyed by URL: a new file is a new element, so no stale position or pending play carries over. */}
      {sourceAudioUrl && <audio key={sourceAudioUrl} ref={sourceAudioRef} src={sourceAudioUrl} preload="auto" />}
      {synthAudioUrl && <audio key={synthAudioUrl} ref={synthAudioRef} src={synthAudioUrl} preload="auto" />}

      {/* Streamlined Clean Header */}
      <ProHeader
        activeJob={activeJob}
        activeStep={activeStep}
        onStepChange={handleStepChange}
        openUpTo={stepGate.upTo}
        lockedWhy={stepGate.why}
        sourceLanguage={activeJob?.detectedLanguage || activeJob?.sourceLanguage || sourceLanguage}
        targetLanguage={activeJob?.language || selectedLanguage}
        mediaDuration={activeJob?.audioBuffer?.duration}
        activity={headerActivity}
        syncPendingCount={activeJob?.syncPendingLines?.length ?? 0}
        // ElevenLabs always transcribes, so its allowance matters whichever engine voices the dub.
        quota={elevenLabsQuota}
        cartesiaUsage={cartesiaUsage}
        gatewayUsage={gatewayUsage}
        usageUpdatedAt={usageUpdatedAt}
        usageLoading={usageLoading}
        onRefreshUsage={refreshUsage}
        voiceEngine={activeVoiceEngine}
        cartesiaReady={cartesiaConfigured}
        elevenLabsReady={Boolean(backendHealth?.elevenLabsConfigured)}
        translationReady={Boolean(backendHealth?.geminiConfigured)}
        translationSummary={translationSummary}
        voiceSummary={
          activeVoiceEngine === 'cartesia'
            ? `Cartesia ${cartesiaModelName}`
            : elModels.find((m) => m.model_id === elModelId)?.name || elModelId
        }
        translationStyleName={getPresetById(activeJob?.promptPresetId || promptPresetId).name}
        onOpenSettings={() => setIsVoiceSettingsOpen(true)}
        /*
         * Only offered when the backend will actually accept a change. Behind a
         * proxy, or with ALLOW_KEY_SETUP=false, keys come from the environment,
         * so the button is hidden rather than opening a form that cannot save.
         */
        onOpenApiSettings={
          backendSettings?.canSaveKeys ? () => setIsApiSettingsOpen(true) : undefined
        }
        onOpenCustomPrompt={() => setIsPromptModalOpen(true)}
        onOpenPhoneticKeyboard={() => {
          setKeyboardActiveSegment(activeJob?.segments?.[0] || null);
          setIsPhoneticKeyboardOpen(true);
        }}
        onOpenQueue={() => setIsQueueModalOpen(true)}
        onOpenVoiceChanger={() => setIsVoiceChangerOpen(true)}
        onOpenTextToSpeech={() => setIsTextToSpeechOpen(true)}
        onOpenPauseSensitivity={() => setIsPauseSensitivityOpen(true)}
        pauseSensitivity={activeJob?.analysisSensitivity ?? 50}
        projects={queue}
        onSelectProject={handleSelectJob}
        onRenameProject={handleRenameJob}
        onRemoveProject={handleRemoveJobFromQueue}
        onResetSession={handleResetSession}
        themeMode={themeMode}
        onThemeModeChange={setThemeMode}
      />

      {/* First-run setup: keys straight into the machine's config, no terminal. */}
      {needsSetup && backendSettings && (
        <SetupWizard
          keySource={backendSettings.keys}
          configFile={backendSettings.configFile}
          translation={backendSettings.translation}
          server={backendSettings.server}
          ffmpegAvailable={backendHealth?.ffmpegAvailable}
          voiceEngine={activeVoiceEngine}
          onVoiceEngineChange={handleVoiceEngineChange}
          onComplete={handleSetupComplete}
          onSkip={handleDismissSetup}
        />
      )}

      {/* Same form reopened from the header's API Settings button. */}
      {isApiSettingsOpen && backendSettings && (
        <SetupWizard
          variant="settings"
          keySource={backendSettings.keys}
          configFile={backendSettings.configFile}
          translation={backendSettings.translation}
          server={backendSettings.server}
          ffmpegAvailable={backendHealth?.ffmpegAvailable}
          voiceEngine={activeVoiceEngine}
          initialEngine={pendingVoiceEngine ?? undefined}
          onVoiceEngineChange={handleVoiceEngineChange}
          onComplete={() => {
            setIsApiSettingsOpen(false);
            setPendingVoiceEngine(null);
            probeBackend().catch(() => {});
          }}
          onSkip={() => {
            setIsApiSettingsOpen(false);
            setPendingVoiceEngine(null);
          }}
        />
      )}

      {/*
        Setup banner: a missing key or a stopped backend is a configuration
        problem, so say so up front rather than failing on the first upload.
      */}
      {backendChecked && !needsSetup && backendIssue && (
        <div
          className="px-4 sm:px-6 lg:px-8 py-2.5 bg-amber-500/10 border-b border-amber-500/30 text-xs sm:text-[13px] flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <p className="min-w-0 flex-1 text-slate-200 leading-snug">
            <span className="font-semibold">{backendIssue.title}</span>{' '}
            <span className="text-slate-400">{backendIssue.detail}</span>
          </p>
          {backendSettings?.canSaveKeys && backendHealth && (!backendHealth.elevenLabsConfigured || !backendHealth.geminiConfigured) && (
            <button
              type="button"
              onClick={() => setIsApiSettingsOpen(true)}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-amber-950 text-xs font-semibold cursor-pointer"
            >
              Open API settings
            </button>
          )}
        </div>
      )}

      {/* Transcription/translation job warning that did not lose any work */}
      {activeJob?.translationWarning && (
        <div
          className="mx-4 sm:mx-6 lg:mx-8 mt-4 px-4 py-3 rounded-2xl bg-sky-950/60 border border-sky-700/70 text-sky-100 text-xs sm:text-sm flex items-start gap-3"
          role="status"
        >
          <AlertTriangle className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <p className="min-w-0 leading-relaxed">{activeJob.translationWarning}</p>
        </div>
      )}

      {/* Main Express Dubbing Studio */}
      <main className="flex-1 flex flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-8 2xl:px-10 w-full mx-auto min-w-0">
        <ExpressDubWizard
          activeStep={activeStep}
          onStepChange={handleStepChange}
          activeJob={activeJob}
          onFileSelect={handleFilesUpload}
          onLoadSampleSession={handleLoadSampleSession}
          targetLanguage={activeJob?.language || selectedLanguage}
          onTargetLanguageChange={handleLanguageChange}
          sourceLanguage={activeJob?.sourceLanguage ?? sourceLanguage}
          onSourceLanguageChange={handleSourceLanguageChange}
          languages={DEFAULT_LANGUAGES}
          pipelineStatus={pipelineStatus}
          elVoiceId={elVoiceId}
          onElVoiceIdChange={handleElVoiceIdChange}
          availableVoices={engineVoices}
          voicesLoading={!voicesSettled}
          voiceEngine={activeVoiceEngine}
          onVoiceEngineChange={cartesiaConfigured || backendSettings?.canSaveKeys ? requestVoiceEngine : undefined}
          onOpenPhoneticKeyboard={(segment) => {
            setKeyboardActiveSegment(segment || activeJob?.segments?.[0] || null);
            setIsPhoneticKeyboardOpen(true);
          }}
          onAutoTranscribe={handleAutoTranscribe}
          isTranscribing={isTranscribing}
          onCancelTranscription={handleCancelTranscription}
          openUpTo={stepGate.upTo}
          lockedWhy={stepGate.why}
          transcriptionCancelled={Boolean(activeJob && cancelledTranscriptionJob === activeJob.id)}
          ttsModelName={
            isCartesiaVoice(elVoiceId)
              ? `Cartesia ${cartesiaModelName}`
              : elModels.find((model) => model.model_id === elModelId)?.name || elModelId
          }
          elModelId={elModelId}
          onElModelIdChange={handleElModelIdChange}
          elModels={elModels}
          elApiKey={elApiKey}
          elVoiceSettings={elVoiceSettings}
          onElVoiceSettingsChange={handleElVoiceSettingsChange}
          onSyncDub={handleSyncDub}
          onSyncEditsChange={handleSyncEditsChange}
          syncEditStatus={syncEditStatus}
          syncEditLive={liveDub}
          onEditTimingAudio={setEditTimingAudio}
          onSyncEditDraft={handleSyncEditDraft}
          onRetrySyncEditRender={handleRetrySyncEditRender}
          isSyncing={isSyncing}
          syncProgress={syncProgress}
          readProgress={readProgress}
          isCancellingSync={isCancellingSync}
          onCancelSync={handleCancelSync}
          syncError={syncError}
          syncPendingLines={activeJob?.syncPendingLines || []}
          onApplySyncLine={handleApplySyncLine}
          onRetakeSyncLines={handleRetakeSyncLines}
          onUpdateSegment={handleUpdateSegment}
          onReplaceSegments={handleReplaceSegments}
          onPlaySegmentSolo={handlePlaySoloSegment}
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
          currentTime={currentTime}
          duration={totalDuration}
          onSeek={handleSeek}
          trackMode={playMode}
          onTrackModeChange={changeTrackMode}
          mixerLevels={mixer.levels}
          onMixerLevelChange={mixer.setLevel}
          getTrackPeak={mixer.peakOf}
          getLiveTime={getLiveTime}
          voiceExpression={voiceExpression}
          onVoiceExpressionChange={handleVoiceExpressionChange}
          cartesiaModelId={cartesiaVoice.modelId}
          dubMatchLoudness={dubMatchLoudness}
          onDubMatchLoudnessChange={handleDubMatchLoudnessChange}
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
          onResetSession={handleResetSession}
          onDownloadWav={handleDownloadMasterWav}
          multiSpeakerInput={multiSpeakerInput}
          onMultiSpeakerInputChange={handleMultiSpeakerInputChange}
          speakerCount={speakerCount}
          onSpeakerCountChange={handleSpeakerCountChange}
          onCastChange={handleCastChange}
          onRenameSpeaker={handleRenameSpeaker}
          mixPeak={mixPeak}
          onMixPeakChange={handleMixPeakChange}
          onDownloadStem={handleDownloadStem}
          onDownloadSrt={handleDownloadMasterSrt}
          onDownloadScript={handleDownloadMasterScript}
          customPrompt={activeJob?.customPrompt || customPrompt}
          promptPresetId={activeJob?.promptPresetId || promptPresetId}
          onUpdateTranslationPrompt={handleUpdateTranslationPrompt}
          onRetranslateSegments={handleRetranslateWithPrompt}
          onRetranscribeAudio={handleRetranscribeAudio}
          onTranslateTranscript={handleTranslateTranscript}
          onTargetSourceChange={handleTargetSourceChange}
          translationSummary={translationSummary}
          translationReady={Boolean(backendHealth?.geminiConfigured)}
          translationProgress={translationProgress}
          isTranslatingLanguage={isTranslatingLanguage}
          onOpenPromptModal={() => setIsPromptModalOpen(true)}
          onOpenVoiceChanger={() => setIsVoiceChangerOpen(true)}
          onOpenTextToSpeech={() => setIsTextToSpeechOpen(true)}
          analysisSensitivity={activeJob?.analysisSensitivity ?? 50}
          onSensitivityChange={activeJobHasTranscript ? undefined : handleSensitivityChange}
        />
      </main>

      {/* Voice Changer Studio Modal */}
      <VoiceChangerModal
        isOpen={isVoiceChangerOpen}
        onClose={() => setIsVoiceChangerOpen(false)}
        dubbedAudioFile={voiceChangerDubFile}
        dubbedAudioBuffer={voiceChangerBuffer}
        originalAudioFile={activeJob?.file || null}
        originalAudioBuffer={activeJob?.audioBuffer || null}
        elApiKey={elApiKey}
        availableVoices={availableVoices}
        selectedVoiceId={elVoiceId}
        onSelectVoiceId={handleElVoiceIdChange}
        onApplyTransformedAudio={handleApplyTransformedAudio}
        onSetDubbedMaster={handleSetDubbedMaster}
        onRefreshVoices={fetchVoices}
        targetLanguage={activeJob?.language || selectedLanguage}
        cartesiaAvailable={cartesiaConfigured}
      />

      {/* Standalone text-to-speech studio, both engines */}
      <TextToSpeechModal
        isOpen={isTextToSpeechOpen}
        onClose={() => setIsTextToSpeechOpen(false)}
        elApiKey={elApiKey}
        availableVoices={availableVoices}
        selectedVoiceId={elVoiceId}
        elModelId={elModelId}
        dubVoiceSettings={elVoiceSettings}
        onDubVoiceSettingsChange={handleElVoiceSettingsChange}
        onDubModelIdChange={handleElModelIdChange}
        dubExpressive={voiceExpression === 'expressive'}
        onDubExpressiveChange={(on) => handleVoiceExpressionChange(on ? 'expressive' : 'off')}
        tuneStability={tuneStability}
        cartesiaAvailable={cartesiaConfigured}
        cartesiaPrefs={cartesiaVoice}
        onCartesiaPrefsChange={handleCartesiaPrefsChange}
        targetLanguage={activeJob?.language || selectedLanguage}
        projectScript={ttsProjectScript}
        onSetDubbedMaster={activeJob ? handleSetDubbedMaster : undefined}
        onGenerated={refreshQuota}
      />

      {/* Custom Translation Prompt Modal */}
      <TranslationPromptModal
        isOpen={isPromptModalOpen}
        onClose={() => setIsPromptModalOpen(false)}
        currentPrompt={activeJob?.customPrompt || customPrompt}
        currentPresetId={activeJob?.promptPresetId || promptPresetId}
        targetLanguage={activeJob?.language || selectedLanguage}
        hasActiveSegments={!!(activeJob?.segments && activeJob.segments.length > 0)}
        hasAudioFile={!!activeJob?.file}
        onSavePrompt={handleUpdateTranslationPrompt}
        onRetranslateSegments={handleRetranslateWithPrompt}
        onRetranscribeAudio={handleRetranscribeAudio}
        isTranslating={isTranslatingLanguage}
        segmentCount={activeJob?.segments?.length || 0}
        audioDuration={activeJob?.audioBuffer?.duration || 0}
      />

      {/* Indic Phonetic Keyboard Modal */}
      <PhoneticKeyboardModal
        isOpen={isPhoneticKeyboardOpen}
        onClose={() => setIsPhoneticKeyboardOpen(false)}
        targetLanguage={activeJob?.language || selectedLanguage}
        onLanguageChange={handleLanguageChange}
        activeSegmentId={keyboardActiveSegment?.id ?? null}
        segments={activeJob?.segments || []}
        onInsertTextToActiveSegment={handleInsertPhoneticText}
        onUpdateSegments={handleReplaceSegments}
        isGlobalPhoneticEnabled={isGlobalPhoneticEnabled}
        onToggleGlobalPhonetic={handleToggleGlobalPhonetic}
      />

      {/* ElevenLabs & Voice Settings Modal */}
      <VoiceSettingsModal
        isOpen={isVoiceSettingsOpen}
        onClose={() => setIsVoiceSettingsOpen(false)}
        elApiKey={elApiKey}
        elVoiceId={elVoiceId}
        onElVoiceIdChange={handleElVoiceIdChange}
        elModelId={elModelId}
        onElModelIdChange={handleElModelIdChange}
        elVoiceSettings={elVoiceSettings}
        onElVoiceSettingsChange={handleElVoiceSettingsChange}
        tuneStability={tuneStability}
        onTuneStabilityChange={handleTuneStabilityChange}
        lastStabilityAdjustment={lastStabilityAdjustment}
        cartesiaPrefs={cartesiaVoice}
        onCartesiaPrefsChange={handleCartesiaPrefsChange}
        availableVoices={engineVoices}
        isLoadingVoices={isLoadingVoices}
        onRefreshVoices={fetchVoices}
        targetLanguage={activeJob?.language || selectedLanguage}
        previewText={(() => {
          const seg = activeJob?.segments?.find((s) => (s.textTarget || s.targetText || '').trim());
          return seg ? seg.textTarget || seg.targetText : undefined;
        })()}
        /* The key itself is edited in API Settings; this only links across. */
        onOpenApiSettings={
          backendSettings?.canSaveKeys
            ? () => {
                setIsVoiceSettingsOpen(false);
                setIsApiSettingsOpen(true);
              }
            : undefined
        }
      />

      {/* Your projects: every dub, kept until the user deletes it */}
      <BatchQueueModal
        isOpen={isQueueModalOpen}
        onClose={() => setIsQueueModalOpen(false)}
        queue={queue}
        activeJobId={activeJobId}
        onSelectJob={handleSelectJob}
        onRemoveJob={handleRemoveJobFromQueue}
        onRenameJob={handleRenameJob}
        onClearQueue={handleClearAllQueue}
        onNewDub={activeJob ? handleResetSession : undefined}
        onAddFiles={handleAddFilesToQueue}
      />

      {/* Pause Sensitivity / VAD Detection Modal */}
      <PauseSensitivityModal
        isOpen={isPauseSensitivityOpen}
        onClose={() => setIsPauseSensitivityOpen(false)}
        sensitivity={activeJob?.analysisSensitivity ?? 50}
        onSensitivityChange={handleSensitivityChange}
        segmentCount={activeJob?.segments?.length || 0}
        hasAudioBuffer={Boolean(activeJob?.audioBuffer)}
        audioBuffer={activeJob?.audioBuffer || null}
        segments={activeJob?.segments || []}
      />
    </div>
  );
}
