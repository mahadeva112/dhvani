import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { ProHeader, DEFAULT_LANGUAGES, DEFAULT_TARGET_LANGUAGE, ThemeMode } from './components/ProHeader';
import { ExpressDubWizard } from './components/ExpressDubWizard';
import { VoiceSettingsModal } from './components/VoiceSettingsModal';
import { BatchQueueModal } from './components/BatchQueueModal';
import { PhoneticKeyboardModal } from './components/PhoneticKeyboardModal';
import { TranslationPromptModal } from './components/TranslationPromptModal';
import { VoiceChangerModal } from './components/VoiceChangerModal';
import { PauseSensitivityModal } from './components/PauseSensitivityModal';
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
  resegmentAudioBuffer,
} from './services/audioService';
import {
  transcribeMedia,
  translateSegmentsToLanguage,
} from './services/geminiService';
import { retranslateCues } from './services/subtitleService';
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
  getVoices,
  Voice,
  ElevenLabsVoiceSettings,
  ALL_ELEVENLABS_MODELS,
} from './services/elevenLabsService';
import { buildSpeechScript } from './services/speechScript';

/** Renamed from 'elVoiceSettings' so the old forced defaults every install saved are dropped. */
const VOICE_SETTINGS_STORAGE_KEY = 'elVoiceSettingsV2';
import {
  generateSrtContent,
  generateTargetLanguageScript,
  downloadFile,
  TargetScriptFormat,
  DEFAULT_SRT_OPTIONS,
  SrtOptions,
  adjustSegmentsForDubbedTimeline,
} from './services/srtService';
import {
  getAllJobsFromStorage,
  saveJobToStorage,
  deleteJobFromStorage,
  clearAllJobsFromStorage,
} from './services/storageService';
import {
  BatchJob,
  ProcessingStatus,
  AudioSegment,
  AudioTrackMode,
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

export default function App() {
  // --- STATE ---
  const [queue, setQueue] = useState<BatchJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // Audio Playback State
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [trackMode, setTrackMode] = useState<AudioTrackMode>('synth');

  // Modals & Settings
  const [isVoiceSettingsOpen, setIsVoiceSettingsOpen] = useState<boolean>(false);
  const [isQueueModalOpen, setIsQueueModalOpen] = useState<boolean>(false);
  const [isPhoneticKeyboardOpen, setIsPhoneticKeyboardOpen] = useState<boolean>(false);
  const [keyboardActiveSegment, setKeyboardActiveSegment] = useState<AudioSegment | null>(null);

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
  const [elModelId, setElModelId] = useState<string>(() => {
    try {
      return localStorage.getItem('elModelId') || 'eleven_v3';
    } catch {
      return 'eleven_v3';
    }
  });
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
  const [availableVoices, setAvailableVoices] = useState<Voice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState<boolean>(false);

  // Processing Flags
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);

  /** Live stage message from the transcription/translation pipeline. */
  const [pipelineStatus, setPipelineStatus] = useState<string>('');
  const [pipelineProgress, setPipelineProgress] = useState<number>(0);

  /** What the local backend reports it can do; null until probed, or if offline. */
  const [backendHealth, setBackendHealth] = useState<BackendHealth | null>(null);
  const [backendChecked, setBackendChecked] = useState<boolean>(false);
  const [backendSettings, setBackendSettings] = useState<BackendSettings | null>(null);

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

  const toggleTheme = useCallback(() => {
    setThemeMode((prev) => {
      if (prev === 'auto') return 'light';
      if (prev === 'light') return 'dark';
      return 'auto';
    });
  }, []);

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

  // Sync playback rate to audio elements
  useEffect(() => {
    if (sourceAudioRef.current) sourceAudioRef.current.playbackRate = playbackRate;
    if (synthAudioRef.current) synthAudioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // Active Job helper
  const activeJob = useMemo(() => queue.find((j) => j.id === activeJobId) || null, [queue, activeJobId]);

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
        const saved = await getAllJobsFromStorage();
        if (saved && saved.length > 0) {
          setQueue(saved);
          setActiveJobId(saved[0].id);
        }
      } catch (err) {
        console.warn('Could not load stored session:', err);
      }
    };
    loadStorage();
  }, []);

  // Update storage & state helper
  const updateJob = useCallback((id: string, updates: Partial<BatchJob>) => {
    setQueue((prev) =>
      prev.map((job) => {
        if (job.id === id) {
          const updatedJob = { ...job, ...updates };
          saveJobToStorage(updatedJob).catch((err) => console.error('Storage Save Error:', err));
          return updatedJob;
        }
        return job;
      })
    );
  }, []);

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

        // 2. If the active job already has dialogue segments, re-translate them to the new language
        if (activeJob.segments && activeJob.segments.length > 0) {
          setIsTranslatingLanguage(true);
          try {
            const promptToUse = activeJob.customPrompt || customPrompt;

            // Re-translates existing cues only: the audio is never re-sent and
            // the ElevenLabs timestamps are reused verbatim.
            const { segments: translatedSegments, translatedSrt, untranslatedCueIds } =
              await retranslateCues(activeJob.segments, {
                sourceLanguage: activeJob.detectedLanguage || sourceLanguage,
                targetLanguage: newLang,
                customPrompt: promptToUse,
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
    [activeJob, customPrompt, updateJob]
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
      try {
        const targetLang = activeJob.language || selectedLanguage;

        // Text-only retranslation against the existing ElevenLabs timestamps.
        const { segments: translatedSegments, translatedSrt, untranslatedCueIds } =
          await retranslateCues(activeJob.segments, {
            sourceLanguage: activeJob.detectedLanguage || sourceLanguage,
            targetLanguage: targetLang,
            customPrompt: promptToUse,
          });

        const newScript = translatedSegments
          .map((s) => s.textTarget || (s as any).targetText || '')
          .filter(Boolean)
          .join(' ');

        updateJob(activeJob.id, {
          segments: translatedSegments,
          script: newScript,
          customPrompt: promptToUse,
          translatedSrt,
          translationWarning: untranslatedCueIds.length
            ? `${untranslatedCueIds.length} cue(s) kept their previous text. Timestamps are unchanged — you can retry.`
            : null,
          synthesizedAudioUrl: null,
          synthesizedBlob: null,
          synthAudioBuffer: null,
          xmlOutput: '',
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

  // Re-transcribe raw audio file with custom prompt
  const handleRetranscribeAudio = useCallback(
    async (overridePrompt?: string) => {
      if (!activeJob || !activeJob.file) return;
      const promptToUse = overridePrompt !== undefined ? overridePrompt : (activeJob.customPrompt || customPrompt);
      setIsTranscribing(true);
      setPipelineProgress(0);
      try {
        const targetLang = activeJob.language || selectedLanguage;
        const result = await transcribeMedia(
          activeJob.file,
          targetLang,
          promptToUse,
          (status) => setPipelineStatus(status),
          sourceLanguage
        );

        updateJob(activeJob.id, {
          language: targetLang,
          sourceLanguage,
          detectedLanguage: result.detectedLanguage,
          script: result.script,
          segments: result.segments,
          customPrompt: promptToUse,
          originalSrt: result.originalSrt,
          translatedSrt: result.translatedSrt,
          translationWarning: result.translationWarning,
          errorMsg: null,
          xmlOutput: '',
          validationResult: null,
          synthesizedAudioUrl: null,
          srtUrl: null,
          synthAudioBuffer: null,
        });
      } catch (err: any) {
        updateJob(activeJob.id, { errorMsg: describePipelineError(err) });
        throw err;
      } finally {
        setIsTranscribing(false);
        setPipelineStatus('');
      }
    },
    [activeJob, customPrompt, selectedLanguage, sourceLanguage, updateJob]
  );

  // Audio source & synth URLs
  const sourceAudioUrl = useMemo(() => {
    if (!activeJob?.file) return null;
    return URL.createObjectURL(activeJob.file);
  }, [activeJob?.file]);

  const synthAudioUrl = activeJob?.synthesizedAudioUrl || null;

  // Re-decode audio buffers if needed
  useEffect(() => {
    if (activeJob && !activeJob.audioBuffer && activeJob.file) {
      analyzeAudio(activeJob.file)
        .then(({ buffer, segments }) => {
          updateJob(activeJob.id, {
            audioBuffer: buffer,
            segments: activeJob.segments.length > 0 ? activeJob.segments : segments,
          });
        })
        .catch((e) => console.warn('Audio decode notice:', e));
    }
    if (activeJob && !activeJob.synthAudioBuffer && synthAudioUrl) {
      decodeAudioBlobUrl(synthAudioUrl)
        .then((buffer) => {
          updateJob(activeJob.id, { synthAudioBuffer: buffer });
        })
        .catch((e) => console.warn('Synth decode notice:', e));
    }
  }, [activeJob?.id, synthAudioUrl]);

  // --- AUDIO SYNCHRONIZATION ENGINE ---
  const syncPlayback = useCallback(
    (action: 'play' | 'pause' | 'seek', seekTime?: number) => {
      const source = sourceAudioRef.current;
      const synth = synthAudioRef.current;

      const targetTime = seekTime !== undefined ? seekTime : currentTime;

      if (action === 'seek') {
        if (source && isFinite(targetTime)) source.currentTime = targetTime;
        if (synth && isFinite(targetTime)) synth.currentTime = targetTime;
        setCurrentTime(targetTime);
        return;
      }

      if (action === 'play') {
        setIsPlaying(true);
        if (trackMode === 'source' || trackMode === 'both') {
          if (source) {
            source.currentTime = targetTime;
            source.play().catch(console.warn);
          }
        }
        if (trackMode === 'synth' || trackMode === 'both') {
          if (synth && synth.src) {
            synth.currentTime = targetTime;
            synth.play().catch(console.warn);
          }
        }
      } else {
        setIsPlaying(false);
        if (source) source.pause();
        if (synth) synth.pause();
      }
    },
    [currentTime, trackMode]
  );

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      syncPlayback('pause');
    } else {
      syncPlayback('play');
    }
  }, [isPlaying, syncPlayback]);

  const handleSeek = useCallback(
    (time: number) => {
      syncPlayback('seek', time);
    },
    [syncPlayback]
  );

  // Audio elements event listeners
  useEffect(() => {
    const source = sourceAudioRef.current;
    const synth = synthAudioRef.current;
    const activeEl = trackMode === 'source' || !synthAudioUrl ? source : synth;
    if (!activeEl) return;

    const onTimeUpdate = () => {
      setCurrentTime(activeEl.currentTime);
    };

    const onEnded = () => {
      setIsPlaying(false);
    };

    activeEl.addEventListener('timeupdate', onTimeUpdate);
    activeEl.addEventListener('ended', onEnded);
    return () => {
      activeEl.removeEventListener('timeupdate', onTimeUpdate);
      activeEl.removeEventListener('ended', onEnded);
    };
  }, [trackMode, synthAudioUrl]);

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
  const fetchVoices = useCallback(async () => {
    if (!elApiKey || elApiKey.length <= 10) return;
    setIsLoadingVoices(true);
    try {
      setAvailableVoices(await getVoices(elApiKey));
    } finally {
      setIsLoadingVoices(false);
    }
  }, [elApiKey]);

  useEffect(() => {
    void fetchVoices();
  }, [fetchVoices]);

  // Save ElevenLabs settings to local storage
  const handleElVoiceIdChange = (id: string) => {
    // Custom slider values were tuned for the previous voice; a new voice
    // starts from its own ElevenLabs settings.
    if (id !== elVoiceId) handleElVoiceSettingsChange(null);
    setElVoiceId(id);
    try {
      localStorage.setItem('elVoiceId', id);
    } catch {}
  };

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
    setQueue([newJob]);
    setActiveJobId(newJob.id);

    /*
     * Run the full workflow:
     *   ElevenLabs transcription + word timestamps -> original SRT
     *   -> Gemini translation -> translated SRT on those same timestamps.
     */
    setIsTranscribing(true);
    setPipelineProgress(0);
    setPipelineStatus('Uploading media...');
    try {
      const result = await transcribeMedia(
        file,
        selectedLanguage,
        customPrompt,
        (status) => setPipelineStatus(status),
        sourceLanguage
      );

      updateJob(newJob.id, {
        script: result.script,
        segments: result.segments,
        language: selectedLanguage,
        sourceLanguage,
        detectedLanguage: result.detectedLanguage,
        originalSrt: result.originalSrt,
        translatedSrt: result.translatedSrt,
        translationWarning: result.translationWarning,
        errorMsg: null,
        customPrompt,
        promptPresetId,
      });
    } catch (err: any) {
      console.warn('Auto transcription notice:', err);
      updateJob(newJob.id, { errorMsg: describePipelineError(err) });
    } finally {
      setIsTranscribing(false);
      setPipelineStatus('');
    }
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
              targetText: 'পডকাস্টে আপনাকে স্বাগতম। আজ আমরা কৃত্রিম বুদ্ধিমত্তার নতুন দিগন্ত নিয়ে আলোচনা করছি।',
              textSource: 'Welcome back to the podcast. Today we are exploring the frontiers of artificial intelligence.',
              textTarget: 'পডকাস্টে আপনাকে স্বাগতম। আজ আমরা কৃত্রিম বুদ্ধিমত্তার নতুন দিগন্ত নিয়ে আলোচনা করছি।',
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
              targetText: 'আমাকে আমন্ত্রণ জানানোর জন্য ধন্যবাদ। গত ছয় মাসে প্রযুক্তির অগ্রগতি সত্যিই অভূতপূর্ব।',
              textSource: 'Thank you for having me. The rate of progress over the last six months has been truly unprecedented.',
              textTarget: 'আমাকে আমন্ত্রণ জানানোর জন্য ধন্যবাদ। গত ছয় মাসে প্রযুক্তির অগ্রগতি সত্যিই অভূতপূর্ব।',
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
              targetText: 'চলুন সরাসরি মাল্টিমোডাল মডেল এবং রিয়েল-টাইম ভয়েস অনুবাদ নিয়ে আলোচনা শুরু করি।',
              textSource: 'Let us dive straight into multimodal models and live speech translation.',
              textTarget: 'চলুন সরাসরি মাল্টিমোডাল মডেল এবং রিয়েল-টাইম ভয়েস অনুবাদ নিয়ে আলোচনা শুরু করি।',
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
              targetText: 'সুপ্রভাত সবাইকে, এবং আমাদের বার্ষিক পণ্য উন্মোচন কীনোটে আপনাদের সবাইকে স্বাগতম।',
              textSource: 'Good morning everyone, and welcome to our annual product announcement keynote.',
              textTarget: 'সুপ্রভাত সবাইকে, এবং আমাদের বার্ষিক পণ্য উন্মোচন কীনোটে আপনাদের সবাইকে স্বাগতম।',
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
              targetText: 'আজ আমরা ভয়েস প্রযুক্তির এক নতুন যুগ শুরু করছি যা প্রতিটি কণ্ঠের স্বাভাবিক অভিব্যক্তি ধরে রাখে।',
              textSource: 'Today we are introducing a new era of voice technology that preserves natural pauses and emotion.',
              textTarget: 'আজ আমরা ভয়েস প্রযুক্তির এক নতুন যুগ শুরু করছি যা প্রতিটি কণ্ঠের স্বাভাবিক অভিব্যক্তি ধরে রাখে।',
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
              targetText: 'এখন প্রতিটি ভাষাভাষী মানুষের কণ্ঠ কুড়িরও বেশি ভাষায় অবিকল অনুভূতির সাথে প্রকাশিত হতে পারে।',
              textSource: 'Every speaker can now be heard in over twenty languages with zero loss of authenticity.',
              textTarget: 'এখন প্রতিটি ভাষাভাষী মানুষের কণ্ঠ কুড়িরও বেশি ভাষায় অবিকল অনুভূতির সাথে প্রকাশিত হতে পারে।',
              emotion: 'inspiring',
              speedRate: 1.0,
            },
          ];

    const fullScript = segments.map((s) => `[${s.speaker}]: ${s.targetText}`).join('\n\n');

    const newJob: BatchJob = {
      id: Math.random().toString(36).substring(2, 9),
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
    };

    await saveJobToStorage(newJob);
    setQueue([newJob]);
    setActiveJobId(newJob.id);

    // If target language is not Bengali, automatically translate sample cues to chosen language
    if (selectedLanguage && selectedLanguage !== 'Bengali') {
      setIsTranslatingLanguage(true);
      translateSegmentsToLanguage(segments, selectedLanguage)
        .then((translated) => {
          const translatedScript = translated
            .map((s) => s.textTarget || (s as any).targetText || '')
            .filter(Boolean)
            .join(' ');
          updateJob(newJob.id, {
            segments: translated,
            script: translatedScript,
          });
        })
        .catch((e) => console.warn('Sample translation failed:', e))
        .finally(() => setIsTranslatingLanguage(false));
    }
  };

  /**
   * Transcribes with ElevenLabs, then translates with Gemini.
   *
   * ElevenLabs owns the transcript and every timestamp; Gemini only replaces
   * cue text.
   */
  const handleAutoTranscribe = async () => {
    if (!activeJob) return;
    setIsTranscribing(true);
    setPipelineProgress(0);
    try {
      const targetLang = activeJob.language || selectedLanguage;
      const promptToUse = activeJob.customPrompt || customPrompt;
      const result = await transcribeMedia(
        activeJob.file,
        targetLang,
        promptToUse,
        (status) => setPipelineStatus(status),
        activeJob.sourceLanguage ?? sourceLanguage
      );

      updateJob(activeJob.id, {
        language: targetLang,
        detectedLanguage: result.detectedLanguage,
        script: result.script,
        segments: result.segments,
        customPrompt: promptToUse,
        originalSrt: result.originalSrt,
        translatedSrt: result.translatedSrt,
        translationWarning: result.translationWarning,
        errorMsg: null,
        xmlOutput: '',
        validationResult: null,
        synthesizedAudioUrl: null,
        srtUrl: null,
        synthAudioBuffer: null,
      });
    } catch (err: any) {
      updateJob(activeJob.id, { errorMsg: describePipelineError(err) });
    } finally {
      setIsTranscribing(false);
      setPipelineStatus('');
    }
  };

  // Master Speech Synthesis (ElevenLabs or Gemini 3.5 Flash)
  const handleSynthesizeMaster = async () => {
    if (!activeJob) return;

    // Subtitle cues are rejoined into flowing sentences; see buildSpeechScript.
    const textToSynthesize =
      activeJob.segments && activeJob.segments.length > 0
        ? buildSpeechScript(activeJob.segments)
        : activeJob.script.trim();

    if (!textToSynthesize) {
      alert('Please enter or review translated dialogue cues first.');
      return;
    }

    setIsBatchProcessing(true);
    updateJob(activeJob.id, { status: ProcessingStatus.SYNTHESIZING_AUDIO, errorMsg: null });

    try {
      const blob = await synthesizeSpeech(
        elApiKey,
        elVoiceId,
        textToSynthesize,
        elModelId,
        elOutputFormat,
        elVoiceSettings,
        { expressive: true, language: activeJob.language || selectedLanguage }
      );

      const url = URL.createObjectURL(blob);
      let srtOpts = DEFAULT_SRT_OPTIONS;
      try {
        const saved = localStorage.getItem('dhvani_srt_options');
        if (saved) srtOpts = JSON.parse(saved);
      } catch {}
      const srtContent = generateSrtContent(activeJob.segments, srtOpts);
      const srtBlob = new Blob([srtContent], { type: 'text/srt' });
      const srtUrl = URL.createObjectURL(srtBlob);

      // Decode synthetic audio buffer for waveform and playback
      decodeAudioBlobUrl(url)
        .then((synthBuffer) => {
          const alignedSegments = adjustSegmentsForDubbedTimeline(activeJob.segments, synthBuffer.duration, srtOpts);
          const alignedSrtContent = generateSrtContent(alignedSegments, srtOpts);
          const alignedSrtBlob = new Blob([alignedSrtContent], { type: 'text/srt' });
          const alignedSrtUrl = URL.createObjectURL(alignedSrtBlob);

          updateJob(activeJob.id, {
            synthAudioBuffer: synthBuffer,
            srtUrl: alignedSrtUrl,
            srtBlob: alignedSrtBlob,
          });
        })
        .catch(console.warn);

      updateJob(activeJob.id, {
        synthesizedAudioUrl: url,
        synthesizedBlob: blob,
        srtUrl,
        srtBlob,
        status: ProcessingStatus.COMPLETED,
      });

      // Switch monitor to Dubbed Master
      setTrackMode('synth');
    } catch (err: any) {
      console.error('Synthesis Error:', err);
      updateJob(activeJob.id, {
        status: ProcessingStatus.ERROR,
        errorMsg: `Speech Synthesis Failed: ${err.message}`,
      });
    } finally {
      setIsBatchProcessing(false);
    }
  };

  // Segment Text Update Handler
  const handleUpdateSegment = useCallback(
    (id: string | number, updates: Partial<AudioSegment>) => {
      if (!activeJob) return;
      const updated = activeJob.segments.map((s) => (s.id === id ? { ...s, ...updates } : s));
      updateJob(activeJob.id, { segments: updated });
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
      updateJob(activeJob.id, { segments });
    },
    [activeJob, updateJob]
  );

  // Play Solo Original Audio for specific segment
  const handlePlaySoloSegment = useCallback(
    (seg: AudioSegment) => {
      const source = sourceAudioRef.current;
      if (!source) return;
      handleSeek(seg.startTime);
      source.currentTime = seg.startTime;
      source.play().catch(console.warn);
      setTimeout(() => {
        if (source && !isPlaying) source.pause();
      }, seg.duration * 1000);
    },
    [handleSeek, isPlaying]
  );

  // Download Master Lossless WAV
  const handleDownloadMasterWav = useCallback(() => {
    if (!activeJob?.synthesizedBlob) {
      if (activeJob?.synthAudioBuffer) {
        const blob = audioBufferToWav(activeJob.synthAudioBuffer);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dhvani_${activeJob.language || 'dubbed'}_master.wav`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      return;
    }
    const url = URL.createObjectURL(activeJob.synthesizedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dhvani_${activeJob.language || 'dubbed'}_master.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeJob]);

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
        activeJob.file?.name ? `Dhvani Dub - ${activeJob.file.name}` : undefined
      );
      const cleanLang = targetLang.toLowerCase().replace(/\s+/g, '_');
      const ext = format === 'json' ? 'json' : format === 'csv' ? 'csv' : 'txt';
      const mime =
        format === 'json'
          ? 'application/json'
          : format === 'csv'
          ? 'text/csv'
          : 'text/plain;charset=utf-8';
      downloadFile(scriptContent, `dhvani_${cleanLang}_script_${format}.${ext}`, mime);
    },
    [activeJob, selectedLanguage]
  );

  // Batch Queue Helpers
  const handleRemoveJobFromQueue = useCallback(
    async (id: string) => {
      await deleteJobFromStorage(id);
      setQueue((prev) => {
        const next = prev.filter((j) => j.id !== id);
        if (activeJobId === id) {
          setActiveJobId(next.length > 0 ? next[0].id : null);
        }
        return next;
      });
    },
    [activeJobId]
  );

  const handleClearAllQueue = useCallback(async () => {
    await clearAllJobsFromStorage();
    setQueue([]);
    setActiveJobId(null);
    setCurrentTime(0);
    setIsPlaying(false);
  }, []);

  const handleAddFilesToQueue = useCallback(
    async (files: FileList | File[]) => {
      const fileList = Array.from(files);
      if (fileList.length === 0) return;

      const newJobs: BatchJob[] = [];

      for (const file of fileList) {
        const newJob: BatchJob = {
          id: Math.random().toString(36).substring(2, 9),
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

      setQueue((prev) => [...prev, ...newJobs]);

      if (!activeJobId && newJobs.length > 0) {
        setActiveJobId(newJobs[0].id);
      }
    },
    [selectedLanguage, activeJobId]
  );

  // Reset Session to start with a new audio file
  const handleResetSession = useCallback(async () => {
    if (activeJob) {
      await deleteJobFromStorage(activeJob.id);
    }
    setQueue([]);
    setActiveJobId(null);
    setCurrentTime(0);
    setIsPlaying(false);
  }, [activeJob]);

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
        setQueue([newJob]);
        setActiveJobId(newJob.id);
      }
    },
    [activeJob, selectedLanguage, customPrompt, promptPresetId, updateJob]
  );

  // Voice Changer: Set as synthesized master dubbed track
  const handleSetDubbedMaster = useCallback(
    (masterBlob: Blob, masterBuffer: AudioBuffer) => {
      if (!activeJob) return;
      const masterUrl = URL.createObjectURL(masterBlob);
      updateJob(activeJob.id, {
        synthAudioBuffer: masterBuffer,
        synthesizedAudioUrl: masterUrl,
        synthesizedBlob: masterBlob,
        status: ProcessingStatus.COMPLETED,
      });
      setTrackMode('synth');
    },
    [activeJob, updateJob]
  );

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
      {sourceAudioUrl && <audio ref={sourceAudioRef} src={sourceAudioUrl} preload="auto" />}
      {synthAudioUrl && <audio ref={synthAudioRef} src={synthAudioUrl} preload="auto" />}

      {/* Streamlined Clean Header */}
      <ProHeader
        activeJob={activeJob}
        language={activeJob?.language || selectedLanguage}
        targetLanguage={activeJob?.language || selectedLanguage}
        onLanguageChange={handleLanguageChange}
        onTargetLanguageChange={handleLanguageChange}
        languages={DEFAULT_LANGUAGES}
        onOpenSettings={() => setIsVoiceSettingsOpen(true)}
        /*
         * Only offered when the backend will actually accept a change. Behind a
         * proxy, or with ALLOW_KEY_SETUP=false, keys come from the environment,
         * so the button is hidden rather than opening a form that cannot save.
         */
        onOpenApiSettings={
          backendSettings?.canSaveKeys ? () => setIsApiSettingsOpen(true) : undefined
        }
        translationSummary={translationSummary}
        onOpenCustomPrompt={() => setIsPromptModalOpen(true)}
        onOpenPhoneticKeyboard={() => {
          setKeyboardActiveSegment(activeJob?.segments?.[0] || null);
          setIsPhoneticKeyboardOpen(true);
        }}
        onOpenQueue={() => setIsQueueModalOpen(true)}
        onOpenVoiceChanger={() => setIsVoiceChangerOpen(true)}
        onOpenPauseSensitivity={() => setIsPauseSensitivityOpen(true)}
        pauseSensitivity={activeJob?.analysisSensitivity ?? 50}
        queueCount={queue.length}
        onResetSession={handleResetSession}
        theme={effectiveTheme}
        themeMode={themeMode}
        onThemeModeChange={setThemeMode}
        onToggleTheme={toggleTheme}
      />

      {/* First-run setup: keys straight into the machine's config, no terminal. */}
      {needsSetup && backendSettings && (
        <SetupWizard
          keySource={backendSettings.keys}
          configFile={backendSettings.configFile}
          translation={backendSettings.translation}
          server={backendSettings.server}
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
          onComplete={() => {
            setIsApiSettingsOpen(false);
            probeBackend().catch(() => {});
          }}
          onSkip={() => setIsApiSettingsOpen(false)}
        />
      )}

      {/*
        Setup banner: a missing key or a stopped backend is a configuration
        problem, so say so up front rather than failing on the first upload.
      */}
      {backendChecked && !needsSetup && backendIssue && (
        <div
          className="mx-4 sm:mx-6 lg:mx-8 mt-4 px-4 py-3 rounded-2xl bg-amber-950/60 border border-amber-700/70 text-amber-100 text-xs sm:text-sm flex items-start gap-3"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold">{backendIssue.title}</p>
            <p className="text-amber-200/80 mt-0.5 leading-relaxed">{backendIssue.detail}</p>
          </div>
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
      <main className="flex-1 flex flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-8 w-full max-w-7xl mx-auto min-w-0">
        <ExpressDubWizard
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
          availableVoices={availableVoices}
          onOpenPhoneticKeyboard={(segment) => {
            setKeyboardActiveSegment(segment || activeJob?.segments?.[0] || null);
            setIsPhoneticKeyboardOpen(true);
          }}
          onAutoTranscribe={handleAutoTranscribe}
          isTranscribing={isTranscribing}
          onSynthesizeMaster={handleSynthesizeMaster}
          ttsModelName={
            ALL_ELEVENLABS_MODELS.find((model) => model.model_id === elModelId)?.name || elModelId
          }
          isSynthesizing={isBatchProcessing}
          onUpdateSegment={handleUpdateSegment}
          onPlaySegmentSolo={handlePlaySoloSegment}
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
          currentTime={currentTime}
          duration={totalDuration}
          onSeek={handleSeek}
          trackMode={trackMode}
          onTrackModeChange={setTrackMode}
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
          onResetSession={handleResetSession}
          onDownloadWav={handleDownloadMasterWav}
          onDownloadSrt={handleDownloadMasterSrt}
          onDownloadScript={handleDownloadMasterScript}
          customPrompt={activeJob?.customPrompt || customPrompt}
          promptPresetId={activeJob?.promptPresetId || promptPresetId}
          onUpdateTranslationPrompt={handleUpdateTranslationPrompt}
          onRetranslateSegments={handleRetranslateWithPrompt}
          onRetranscribeAudio={handleRetranscribeAudio}
          isTranslatingLanguage={isTranslatingLanguage}
          onOpenPromptModal={() => setIsPromptModalOpen(true)}
          onOpenVoiceChanger={() => setIsVoiceChangerOpen(true)}
          analysisSensitivity={activeJob?.analysisSensitivity ?? 50}
          onSensitivityChange={activeJobHasTranscript ? undefined : handleSensitivityChange}
        />
      </main>

      {/* Voice Changer Studio Modal */}
      <VoiceChangerModal
        isOpen={isVoiceChangerOpen}
        onClose={() => setIsVoiceChangerOpen(false)}
        activeAudioFile={activeJob?.file || null}
        activeAudioBuffer={activeJob?.audioBuffer || null}
        elApiKey={elApiKey}
        availableVoices={availableVoices}
        selectedVoiceId={elVoiceId}
        onSelectVoiceId={handleElVoiceIdChange}
        onApplyTransformedAudio={handleApplyTransformedAudio}
        onSetDubbedMaster={handleSetDubbedMaster}
        onRefreshVoices={fetchVoices}
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
        availableVoices={availableVoices}
        isLoadingVoices={isLoadingVoices}
        onRefreshVoices={fetchVoices}
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

      {/* Batch Queue Manager Pop-up Modal */}
      <BatchQueueModal
        isOpen={isQueueModalOpen}
        onClose={() => setIsQueueModalOpen(false)}
        queue={queue}
        activeJobId={activeJobId}
        onSelectJob={(id) => {
          setActiveJobId(id);
          setCurrentTime(0);
          setIsPlaying(false);
        }}
        onRemoveJob={handleRemoveJobFromQueue}
        onClearQueue={handleClearAllQueue}
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
      />

      {/* Floating Dynamic Translation Progress Pill */}
      {isTranslatingLanguage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-indigo-950/95 border border-indigo-500/80 text-white px-4 py-2.5 rounded-2xl shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-5">
          <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
          <span className="text-xs font-semibold">
            Translating dialogue cues to {selectedLanguage}...
          </span>
        </div>
      )}
    </div>
  );
}
