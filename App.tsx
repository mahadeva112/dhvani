import React, { useState, useRef, useEffect, useCallback, useMemo, startTransition } from 'react';
import { RefreshCw, AlertTriangle, Languages, X } from 'lucide-react';
import { ProHeader, DEFAULT_LANGUAGES, DEFAULT_TARGET_LANGUAGE, HeaderQuota } from './components/ProHeader';
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
import { POPULAR_ELEVENLABS_VOICES, type VoiceEngine } from './components/VoiceSelectorCard';
import { getCartesiaUsage, getGatewayUsage, type CartesiaUsage, type GatewayUsage } from './services/usageService';
import { languageFit } from './services/indianVoices';
import {
  TRANSLATION_PRESETS,
  DEFAULT_PROMPT_PRESET_ID,
  currentPromptChoice,
  TranslationPromptPreset,
} from './services/translationPromptPresets';
import { promptStyleName } from './services/savedTranslationPrompts';

import {
  analyzeAudio,
  decodeAudioBlobUrl,
  audioBufferToWav,
  audioFileExtension,
  resegmentAudioBuffer,
} from './services/audioService';
import { transcribeOnly } from './services/geminiService';
import { retranslateCues, RetranslateProgress, translationFraction } from './services/subtitleService';
import {
  getBackendHealth,
  getBackendSettings,
  BackendHealth,
  BackendSettings,
  SERVER_MANAGED_KEY,
  DhvaniApiError,
  apiPostBlobAudio,
} from './services/apiClient';
import { SetupWizard } from './components/SetupWizard';
import { ErrorPopup } from './components/ErrorPopup';
import { reportError } from './services/errorPopup';
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
/** Off when the user turned off sizing the translation for the voice's speaking rate. */
const FIT_TRANSLATION_STORAGE_KEY = 'dhvani_fit_translation_to_voice';
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
// Sync settings too: opening an older project saves them for the first time, and that isn't working on it.
const VIEW_FIELDS = new Set<string>(['audioBuffer', 'synthAudioBuffer', 'syncedAudioBuffer', 'lastStep', 'syncOptions']);

/** A new id for a Sync's bank (syncEpoch), or a bank the server is to be sent. */
const newSyncId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** A project saved before Syncs had ids: its bank is the first one. */
const FIRST_SYNC = 'first';

/** While one of these runs (a transcription, translation, Sync), its own updates are not steps: what it ends with is. */
const WORKING = new Set<ProcessingStatus>([
  ProcessingStatus.QUEUED,
  ProcessingStatus.UPLOADING,
  ProcessingStatus.ANALYZING_AUDIO,
  ProcessingStatus.GENERATING_XML,
  ProcessingStatus.VALIDATING_XML,
  ProcessingStatus.SYNTHESIZING_AUDIO,
]);

/** How long a project that is no longer open keeps its decoded audio. */
const RELEASE_CLOSED_AUDIO_MS = 30_000;

const historyStateOf = (job: BatchJob): HistoryState =>
  Object.fromEntries(HISTORY_FIELDS.map((field) => [field, job[field] ?? null])) as HistoryState;

/** The project's history, or one made from Review's when it has only that, or null. */
const projectHistoryOf = (job: BatchJob): ProjectHistory | null =>
  job.projectHistory ?? (job.reviewHistory && job.reviewHistory.steps.length > 1 ? fromReviewHistory(job.reviewHistory, historyStateOf(job)) : null);

/** The Sync a project's bank belongs to: an old project's dub is the first one; no dub, none. */
const syncIdOf = (job: Pick<BatchJob, 'syncEpoch' | 'syncBank' | 'syncedBlob'>) =>
  job.syncBank || job.syncedBlob ? job.syncEpoch || FIRST_SYNC : null;

/** What a project's Sync leaves to keep when another takes its place: its bank, or the dub file the voice changer made. */
const syncKeepOf = (job: BatchJob) =>
  job.syncBank && job.syncBankBlob
    ? { blob: job.syncBankBlob, kind: 'bank' as const }
    : !job.syncBank && job.syncedBlob
      ? { blob: job.syncedBlob, kind: 'file' as const }
      : null;

/**
 * The project after a change, with the change as a step in its history: what
 * it did, named, after the step it was at. A change that sets the history
 * itself (undo, redo) or is made while the project is being worked on is
 * not one; nor is one that changes nothing a step puts back.
 */
const withHistoryStep = (
  job: BatchJob,
  next: BatchJob,
  updates: Partial<BatchJob>,
  { label, key }: { label?: string; key?: string } = {}
): { job: BatchJob; dropped: string[] } => {
  // The Sync the dub is from goes with it: none once there is no dub.
  const epoch = syncIdOf(next);
  const withEpoch = (next.syncEpoch ?? null) === epoch ? next : { ...next, syncEpoch: epoch };
  // Before there is a script there is nothing to undo to: the history starts at the first script.
  if ('projectHistory' in updates || WORKING.has(withEpoch.status) || !job.segments?.length || !HISTORY_FIELDS.some((field) => field in updates)) {
    return { job: withEpoch, dropped: [] };
  }
  const before = { ...historyStateOf(job), syncEpoch: syncIdOf(job) };
  const after = historyStateOf(withEpoch);
  const change = describeProjectChange(before, after);
  if (!change) return { job: withEpoch, dropped: [] };
  const recorded = recordProjectStep(projectHistoryOf(job), before, after, { label: label ?? change.label, key: label ? key : (key ?? change.key) });
  const { history, dropped } = keepRecentSyncs(recorded, epoch);
  return { job: { ...withEpoch, projectHistory: history }, dropped };
};
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
import { refittedOptions } from './services/syncAutoFit';
import {
  DEFAULT_DUB_AUDIO_QUALITY,
  dubAudioQualityLabel,
  fallbackNotice,
  isDubAudioQuality,
  voiceInAllowedQuality,
  type DubAudioQuality,
} from './services/dubAudioQuality';
import { lineTextNow, notPending, pendingForSync, rewordedOnly, syncPendingAfter } from './services/syncPending';
import { BASE_LABELS, backToFirstStep, recordReviewStep, reviewHistoryLabels, startReviewHistory } from './services/reviewHistory';
import {
  catchUpProject,
  describeProjectChange,
  fromReviewHistory,
  HISTORY_FIELDS,
  historyEntries,
  historyLabels,
  keepRecentSyncs,
  moveTo,
  recordProjectStep,
  stateAt,
  type HistoryState,
  type ProjectHistory,
} from './services/projectHistory';
import { audioParts, hasEdits, isClip, lockedLines, measureEdits, moveCopyAudio, originalParts, partLine, spokenSpan, partEnd, partsOf, rebaseEdits, renderSyncEdits, SyncEdits, withoutAudioClips, type AudioFileInfo, type AudioFileRecord, type AudioTrack, type SyncBank, type SyncBankLine } from './services/syncEditService';
import { alignTakeWords, carryCopyAudio, carryTakes, fitTakeToParts, knownWords, phraseLine, phraseOf, pickedTakes, sayWords, placeTakeChunks, placeTakeLikeSync, putTake, SYNC_TAKE_ID, takeOnCopy, takesOf, TAKES_PER_ASK, voiceTakes, type SyncTake, type TakeAsk } from './services/syncTakesService';
import { readRetakePlacement } from './services/retakePlacement';
import { dotsToPauses, stripPauses } from './server/lib/linePauses.js';
import { stripTags, tagsOf } from './server/lib/lineTags.js';
import {
  laneClips,
  keptVoiceTakes,
  lineVoiceIds,
  linesOutOfVoice,
  linesToChange,
  putChangedLines,
  speakersOf,
  takeIsIn,
  voiceChangeLines,
  voiceChangeTakes,
  type ChangedVoice,
  type ChangedVoices,
  type LineProgress,
  type SpeakerVoices,
  type VoiceChangeSettings,
} from './services/voiceChangeService';
import { LiveDubEngine, liveClips } from './services/liveDubEngine';
import { cleanSpeakerLevels, silencedSpeakers, withSpeakerLevels, type SpeakerMonitor } from './services/speakerLevels';
import type { SyncEditStatus } from './components/SyncEditTimeline';
import {
  getAllJobsFromStorage,
  saveJobToStorage,
  deleteJobFromStorage,
  deleteHistoryBanks,
  getHistoryBank,
  getHistoryBanks,
  getReviewVideo,
  saveReviewVideo,
  saveHistoryBank,
  clearAllJobsFromStorage,
} from './services/storageService';
import { byNewest, projectFileStem, projectName } from './services/projects';
import {
  exportProject,
  exportProjectJson,
  importProject,
  isProjectJson,
  projectFileName,
  projectJsonFileName,
  readProjectJson,
  type ProjectJsonData,
} from './services/projectArchive';
import { looksTranscribedAgain, mergeScriptUpdate } from './services/scriptUpdate';
import { UpdateScriptPanel, type ScriptUpdatePreview } from './components/UpdateScriptPanel';
import { SyncAgainGuard, type SyncAgainGuardState } from './components/SyncAgainGuard';
import { SyncFromScratchConfirm, type SyncFromScratchState } from './components/SyncFromScratchConfirm';
import { describeLineEdit, linesToHold, lockLines, pickedTakeName, releaseLines, unlockedEdits } from './services/syncAgainGuard';
import { transcriptFileName, transcriptParagraphs, transcriptSrt } from './services/transcriptExport';
import { sameCuts } from './services/transcriptSegments';
import { saveFileAs } from './services/saveFile';
import { loadPassagePause } from './components/review/passages';
import type { TranscriptExportResult, TranscriptFormat } from './components/TranscriptExportMenu';
import { OpenProjectJsonPanel, type PendingProjectJson } from './components/OpenProjectJsonPanel';
import { addSignoffs, signoffsForJob } from './services/signoffService';
import { speakerSyllableRates, useVoiceRates, type VoiceRateVoice } from './services/voiceRate';
import { currentStep, hasTranscript, openSteps } from './services/steps';
import { setDubLanguage } from './services/dubLanguage';
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
  PauseGate,
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
/** The notice for cues a translation left with their previous text; null when it missed none. */
const untranslatedWarning = (count: number) =>
  count ? `${count} cue(s) kept their previous text. Timestamps are unchanged — translate just those again.` : null;

const SYNC_EDIT_RENDER_DELAY_MS = 600;

/** Why a project could not be saved to this computer, in words a user can act on. */
const saveFailureMessage = (err: unknown): string => {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'QuotaExceededError') return 'This computer has no room left for it. Free some disk space, then save again.';
  if (name === 'InvalidStateError' || name === 'UnknownError') return 'The project store could not be opened. Save again, or restart Dhvani.';
  const message = (err as { message?: string } | null)?.message;
  return message ? `${message}.`.replace(/\.\.$/, '.') : 'The project store refused it.';
};

/** The source's length, which the synced dub is as long as. */
/** Where line `key` plays now, in timeline seconds (its parts that sound, copies left out); null when it doesn't. */
const lineSpanIn = (bank: SyncBank, edits: SyncEdits | null | undefined, key: string | undefined) => {
  const line = key ? bank.lines.find((l) => l.key === key) : null;
  if (!line) return null;
  const parts = partsOf(edits, line, bank.sampleRate).filter((part) => !part.muted && !part.copy);
  if (parts.length === 0) return null;
  return { start: Math.min(...parts.map((part) => part.start)), end: Math.max(...parts.map(partEnd)) };
};

const sourceDurationOf = (job: BatchJob) =>
  job.audioBuffer?.duration || job.audioMetadata?.duration || job.segments[job.segments.length - 1]?.endTime || 0;

/** The voice a dub is voiced with, as it was set when Dub was pressed: a dub waiting its turn keeps it. */
interface DubVoice {
  apiKey: string;
  voiceId: string;
  modelId: string;
  voiceSettings: ElevenLabsVoiceSettings | null;
  cartesia: CartesiaVoicePrefs;
  expression: VoiceExpression;
  tuneStability: boolean;
  quality: DubAudioQuality;
  mixPeak: MixPeakMode;
  /** The dub language for a project that has none of its own. */
  language: string;
}

/** A Dub pressed while another project's dub ran: it starts once that one ends. */
interface QueuedDub {
  jobId: string;
  options: SyncOptions;
  voice: DubVoice;
  /** Sync from scratch: every line voiced anew, nothing kept from the dub before. */
  fresh?: boolean;
}

/** Hands a file to the browser's save. */
const saveAudioFile = (file: Blob, fileName: string) => {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * A project as saved (in IndexedDB or a project file), ready to open: object URLs die with the
 * page, so each saved file gets a new one, and the buffers decode from them.
 */
const reviveSavedJob = (stale: BatchJob): BatchJob => {
  // Saved before Sync kept its own file: the dub's slot holds the synced dub, and the unsynced one is gone.
  const job =
    stale.syncReport && stale.synthesizedBlob && !stale.syncedBlob
      ? { ...stale, syncedBlob: stale.synthesizedBlob, synthesizedBlob: null }
      : stale;
  // A project saved with a style since removed translates with the default from now on.
  const promptChoice = job.promptPresetId ? currentPromptChoice(job.promptPresetId, job.customPrompt) : null;
  return {
    ...job,
    ...(promptChoice && { promptPresetId: promptChoice.presetId, customPrompt: promptChoice.prompt }),
    synthesizedAudioUrl: job.synthesizedBlob ? URL.createObjectURL(job.synthesizedBlob) : null,
    syncedAudioUrl: job.syncedBlob ? URL.createObjectURL(job.syncedBlob) : null,
    srtUrl: job.srtBlob ? URL.createObjectURL(job.srtBlob) : null,
    // A dub or sync in flight ended with the page; it leaves what there was, as a cancel does,
    // and Dub offers to resume it: the lines it voiced were kept on disk.
    ...(job.status === ProcessingStatus.SYNTHESIZING_AUDIO && { syncInterrupted: true }),
    status:
      job.status === ProcessingStatus.SYNTHESIZING_AUDIO
        ? job.synthesizedBlob || job.syncedBlob
          ? ProcessingStatus.COMPLETED
          : ProcessingStatus.IDLE
        : job.status,
  };
};

/**
 * The cues after an edit, as a step Undo can take back. A cut, join or moved
 * cut changes the synced lines it touches: Sync again places them anew.
 */
const withReviewStep = (job: BatchJob, next: AudioSegment[]): Partial<BatchJob> => {
  const { history, segments } = recordReviewStep(job.reviewHistory, job.segments, next);
  return { segments, reviewHistory: history, ...syncPendingAfter(job, segments) };
};

/** A Dhvani JSON read from disk, as opening it or Update script takes it. */
type ProjectJsonFile = PendingProjectJson & {
  id: string;
  /** The id of the project it was saved from. */
  projectId: string;
  signoffs: ReturnType<typeof readProjectJson>['signoffs'];
};

/** Why a script file can't go on a project, or null when it can. */
const scriptUpdateProblem = (job: BatchJob, project: ProjectJsonData): string | null => {
  if (!hasTranscript(project.segments || [])) return 'This file has no transcript to update the script with.';
  if (project.targetSource === 'pending') {
    return "This script isn't translated yet, so it would empty the dub's lines. Translate it, then save the file again.";
  }
  if (project.language && job.language && project.language !== job.language) {
    return `This script is in ${project.language}, but this project is dubbed in ${job.language}.`;
  }
  if (job.status === ProcessingStatus.SYNTHESIZING_AUDIO) return 'A dub is running on this project. Update the script once it finishes.';
  return null;
};

/** What Update script takes from the file besides the cues: the transcript's own fields, where the file has them. */
const SCRIPT_FIELDS = ['originalSrt', 'translatedSrt', 'targetSource', 'sourceLanguage', 'detectedLanguage', 'transcriptCuts'] as const;

export default function App() {
  // --- STATE ---
  const [queue, setQueue] = useState<BatchJob[]>([]);
  /** The projects as they are now, for work that finishes after the render that started it. */
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  /** A Dhvani JSON being opened, waiting for the user to pick its media. */
  const [pendingProjectJson, setPendingProjectJson] = useState<ProjectJsonFile | null>(null);
  /** A Dhvani JSON waiting to go on a project being dubbed (Update script). */
  const [pendingScriptUpdate, setPendingScriptUpdate] = useState<(ProjectJsonFile & { jobId: string }) | null>(null);
  /** The media last read for it, so opening doesn't decode it twice. */
  const pickedMediaRef = useRef<{ file: File; analysis: Awaited<ReturnType<typeof analyzeAudio>> } | null>(null);

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
  /** Bumped by Sync settings in the header's menu; the wizard opens the window on each new value. */
  const [syncSettingsRequest, setSyncSettingsRequest] = useState(0);
  /** API & translation engine dialog, opened from the header's API Settings button. */
  const [isApiSettingsOpen, setIsApiSettingsOpen] = useState<boolean>(false);

  // Translation Prompt & Persona Settings
  // A style saved before it was removed reads as the default, prompt and all.
  const [savedPromptChoice] = useState(() => {
    try {
      return currentPromptChoice(localStorage.getItem('dhvani_prompt_preset_id'), localStorage.getItem('dhvani_custom_prompt'));
    } catch {
      return currentPromptChoice(DEFAULT_PROMPT_PRESET_ID, null);
    }
  });
  const [promptPresetId, setPromptPresetId] = useState<string>(savedPromptChoice.presetId);
  const [customPrompt, setCustomPrompt] = useState<string>(savedPromptChoice.prompt);

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
  // The format a dub is voiced in (Dub step: Audio quality). WAV 48 kHz unless the user picks another.
  const [dubAudioQuality, setDubAudioQuality] = useState<DubAudioQuality>(() => {
    try {
      const saved = localStorage.getItem('dhvani_dub_audio_quality');
      return isDubAudioQuality(saved) ? saved : DEFAULT_DUB_AUDIO_QUALITY;
    } catch {
      return DEFAULT_DUB_AUDIO_QUALITY;
    }
  });
  // Formats the ElevenLabs plan refused, so the next dub starts in one it allows. Picking a quality again tries it again.
  const [refusedQualities, setRefusedQualities] = useState<ReadonlySet<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('dhvani_dub_refused_qualities') || '[]');
      return new Set(Array.isArray(saved) ? saved.filter(isDubAudioQuality) : []);
    } catch {
      return new Set();
    }
  });
  const refuseQuality = useCallback((format: string) => {
    setRefusedQualities((prev) => {
      const next = new Set(prev).add(format);
      try {
        localStorage.setItem('dhvani_dub_refused_qualities', JSON.stringify([...next]));
      } catch {}
      return next;
    });
  }, []);
  const handleDubAudioQualityChange = useCallback((quality: DubAudioQuality) => {
    setDubAudioQuality(quality);
    setRefusedQualities(new Set());
    setDubQualityNotices({});
    try {
      localStorage.setItem('dhvani_dub_audio_quality', quality);
      localStorage.removeItem('dhvani_dub_refused_qualities');
    } catch {}
  }, []);
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

  /*
   * The dub in flight (a sync): one at a time, whichever project is open.
   * Its project, its progress, and what cancelling it needs. A Dub pressed
   * on another project meanwhile waits in `dubQueue` and starts on its own
   * once this one ends, with the voice that was set when it was pressed.
   */
  const [syncingJobId, setSyncingJobId] = useState<string | null>(null);
  const [dubQueue, setDubQueue] = useState<QueuedDub[]>([]);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [isCancellingSync, setIsCancellingSync] = useState(false);
  // Why a project's last dub came out in another format than the one chosen in Audio quality.
  const [dubQualityNotices, setDubQualityNotices] = useState<Record<string, string | null>>({});
  /** The last save to this computer that failed, until one succeeds or the user closes the notice. */
  const [saveFailure, setSaveFailure] = useState<{ jobId: string; message: string } | null>(null);
  /** The synced line whose takes are being voiced (one at a time). */
  const [syncTakesBusy, setSyncTakesBusy] = useState<{ jobId: string; key: string } | null>(null);
  // Sync again asked for on a dub with unlocked hand edits: waits for the user to lock them or let them go.
  const [syncGuard, setSyncGuard] = useState<(SyncAgainGuardState & { jobId: string; options: SyncOptions }) | null>(null);
  // Sync from scratch asked for: waits for the user to confirm what it drops.
  const [scratchConfirm, setScratchConfirm] = useState<(SyncFromScratchState & { jobId: string; options: SyncOptions }) | null>(null);
  // `readJobId`: the continuous read in flight before the lines are placed, if the dub is voiced that way.
  const syncRunRef = useRef<{ jobId: string; projectId: string; controller: AbortController; readJobId?: string } | null>(null);
  /** The continuous read's progress, while the script is voiced in one take; null otherwise. */
  const [readProgress, setReadProgress] = useState<DubProgress | null>(null);
  /** One seed per dub session, so a second Sync reuses the lines the first one voiced. */
  const syncSeedRef = useRef<Record<string, number>>({});
  /**
   * Edit timing: whether the synced dub has caught up with the edits. An edit
   * is shown at once and rendered a moment later, once the user stops editing.
   */
  const [syncEditStatuses, setSyncEditStatuses] = useState<Record<string, SyncEditStatus>>({});
  const setSyncEditStatus = useCallback(
    (jobId: string, status: SyncEditStatus) => setSyncEditStatuses((all) => ({ ...all, [jobId]: status })),
    []
  );
  /** Each project's edit render, waiting or running; one project's never stops another's. */
  const syncEditRunsRef = useRef<Record<string, { timer: number | null; controller: AbortController | null }>>({});
  /** The transcriptions in flight, by project: what cancelling each needs, and its stage message. */
  const transcribeRunsRef = useRef<Record<string, AbortController>>({});
  const [transcriptions, setTranscriptions] = useState<Record<string, string>>({});
  /** The project whose transcription the user just cancelled, for the note in Source & voice. */
  const [cancelledTranscriptionJob, setCancelledTranscriptionJob] = useState<string | null>(null);


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
      // A language since dropped from the list falls back to the default.
      const saved = localStorage.getItem('dhvani_target_language');
      return saved && DEFAULT_LANGUAGES.some((l) => l.code === saved) ? saved : DEFAULT_TARGET_LANGUAGE;
    } catch {
      return DEFAULT_TARGET_LANGUAGE;
    }
  });
  /** The translations in flight, by project, with each one's progress (null until the first report). */
  const [translations, setTranslations] = useState<Record<string, RetranslateProgress | null>>({});
  /** Each running translation's stop switch, by project: Cancel aborts it, and the backend is told to stop. */
  const translationStops = useRef(new Map<string, AbortController>());
  /** Marks a project as translating and returns the signal its translation listens to for Cancel. */
  const startTranslating = useCallback((jobId: string) => {
    translationStops.current.get(jobId)?.abort();
    const stop = new AbortController();
    translationStops.current.set(jobId, stop);
    setTranslations((all) => ({ ...all, [jobId]: null }));
    return stop.signal;
  }, []);
  const stopTranslating = useCallback((jobId: string, signal?: AbortSignal) => {
    // A newer translation of the same project keeps its own switch.
    if (!signal || translationStops.current.get(jobId)?.signal === signal) translationStops.current.delete(jobId);
    setTranslations(({ [jobId]: _done, ...rest }) => rest);
  }, []);
  /** Cancel: the translation stops, nothing it did is applied, the lines stay as they were. */
  const cancelTranslation = useCallback((jobId: string) => {
    translationStops.current.get(jobId)?.abort();
  }, []);
  /** Progress reports for one project's translation; any that land after it ended are dropped. */
  const translationProgressOf = useCallback(
    (jobId: string) => (progress: RetranslateProgress) => setTranslations((all) => (jobId in all ? { ...all, [jobId]: progress } : all)),
    []
  );

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
  // Text boxes for the dub's words type phonetically in its language without being handed it.
  useEffect(() => setDubLanguage(activeJob?.language || selectedLanguage), [activeJob?.language, selectedLanguage]);
  const activeJobIdRef = useRef(activeJobId);
  activeJobIdRef.current = activeJobId;

  // What runs on the open project: each kind of work is kept by project, so another project's never shows here.
  const isTranscribing = Boolean(activeJob && activeJob.id in transcriptions);
  const pipelineStatus = (activeJob && transcriptions[activeJob.id]) || '';
  const isTranslatingLanguage = Boolean(activeJob && activeJob.id in translations);
  const translationProgress = (activeJob && translations[activeJob.id]) || null;
  const dubbingHere = Boolean(activeJob && syncingJobId === activeJob.id);
  const dubWaitingHere = Boolean(activeJob && dubQueue.some((dub) => dub.jobId === activeJob.id));
  const syncEditStatus: SyncEditStatus = (activeJob && syncEditStatuses[activeJob.id]) || { state: 'ready' };

  /*
   * The dub voices' speaking rates in the dub language, measured from a short
   * sample read as soon as a voice is picked (services/voiceRate.ts): the main
   * voice, and with several speakers each one's own voice from the cast. Review
   * estimates with them before the first sync, and translation sizes each cue
   * for the voice that will say it.
   */
  const rateVoice = useMemo(
    () => (elVoiceId ? { voiceId: elVoiceId, modelId: elModelId, voiceSettings: elVoiceSettings, cartesia: cartesiaVoice } : null),
    [elVoiceId, elModelId, elVoiceSettings, cartesiaVoice]
  );
  const jobSegments = activeJob?.segments;
  const jobCast = activeJob?.cast;
  // Sync voices the cast only when the cues name more than one speaker, so only then are their voices read.
  const castRateVoices = useMemo<Record<string, VoiceRateVoice>>(
    () =>
      jobSegments && isMultiSpeaker(jobSegments)
        ? Object.fromEntries(Object.entries(jobCast || {}).filter(([, voice]) => voice?.voiceId).map(([speaker, voice]) => [speaker, { voiceId: voice.voiceId }]))
        : {},
    [jobSegments, jobCast]
  );
  const voiceRates = useVoiceRates(rateVoice, castRateVoices, activeJob?.language || selectedLanguage, { apiKey: elApiKey });
  const voiceRate = voiceRates.main;
  const [fitTranslationToVoice, setFitTranslationToVoice] = useState<boolean>(() => {
    try {
      return localStorage.getItem(FIT_TRANSLATION_STORAGE_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const handleFitTranslationToVoiceChange = useCallback((on: boolean) => {
    setFitTranslationToVoice(on);
    try {
      localStorage.setItem(FIT_TRANSLATION_STORAGE_KEY, on ? 'on' : 'off');
    } catch {
      /* Storage off: the choice lasts until the app closes. */
    }
  }, []);

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
        transcribing: isTranscribing,
        translating: isTranslatingLanguage,
      }),
    [activeJob, isTranscribing, isTranslatingLanguage]
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

  /** The project the running dub belongs to, by name, for the open project's notes about it. */
  const dubbingJob = syncingJobId ? queue.find((job) => job.id === syncingJobId) : undefined;
  const dubbingProjectName = dubbingJob ? projectName(dubbingJob) : null;

  /** What is running on the active job, for the header's status pill and progress line. */
  const headerActivity = useMemo(() => {
    // Sync runs in the Dub step but keeps going on any step, so the header follows it.
    const dubFraction = syncProgress ? Math.min(0.98, syncFraction(syncProgress)) : null;
    if (dubbingHere) return { label: isCancellingSync ? 'Cancelling dub' : 'Dubbing', fraction: dubFraction };
    if (isTranscribing) return { label: pipelineStatus.replace(/\.+$/, '') || 'Transcribing', fraction: null };
    if (isTranslatingLanguage) {
      const checking = translationProgress?.step === 'check';
      return { label: checking ? 'Checking translation' : 'Translating', fraction: translationFraction(translationProgress) };
    }
    if (dubWaitingHere) return { label: 'Waiting to dub', fraction: null };
    // Another project's dub, named so it isn't taken for this one's.
    if (syncingJobId) return { label: dubbingProjectName ? `Dubbing “${dubbingProjectName}”` : 'Dubbing another project', fraction: dubFraction };
    return null;
  }, [dubbingHere, dubWaitingHere, syncingJobId, dubbingProjectName, isCancellingSync, syncProgress, isTranscribing, pipelineStatus, isTranslatingLanguage, translationProgress]);

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
          const saved = stored.map(reviveSavedJob);
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
  /** Changes a project, worked out from the project as it is now rather than as the last render saw it. */
  const updateJobWith = useCallback((id: string, change: (job: BatchJob) => Partial<BatchJob>, step: { label?: string; key?: string } = {}) => {
    setQueue((prev) =>
      prev.map((job) => {
        if (job.id === id) {
          const updates = change(job);
          if (Object.keys(updates).length === 0) return job;
          // Opening a project or moving between its steps isn't working on it.
          const worksOnIt = Object.keys(updates).some((k) => !VIEW_FIELDS.has(k));
          const recorded = withHistoryStep(job, { ...job, ...updates, ...(worksOnIt ? { updatedAt: Date.now() } : {}) }, updates, step);
          const updatedJob = recorded.job;
          // Another Sync's bank takes the place of this one: it is kept apart, for undo to come back to.
          const leaving = syncIdOf(job);
          const kept = leaving && leaving !== updatedJob.syncEpoch ? syncKeepOf(job) : null;
          if (leaving && kept) {
            saveHistoryBank(id, { epoch: leaving, ...kept }).catch((err) => console.warn('The bank before this Sync could not be kept for undo:', err));
          }
          if (recorded.dropped.length > 0) deleteHistoryBanks(id, recorded.dropped).catch(console.warn);
          saveJobToStorage(updatedJob).then(
            () => setSaveFailure((failure) => (failure?.jobId === id ? null : failure)),
            (err) => {
              console.error('Storage Save Error:', err);
              setSaveFailure({ jobId: id, message: saveFailureMessage(err) });
            }
          );
          return updatedJob;
        }
        return job;
      })
    );
  }, []);

  const updateJob = useCallback(
    (id: string, updates: Partial<BatchJob>, step?: { label?: string; key?: string }) => updateJobWith(id, () => updates, step),
    [updateJobWith]
  );

  /** Saves the project whose save failed again, as it is now. */
  const retrySave = useCallback(() => {
    const job = saveFailure && queueRef.current.find((j) => j.id === saveFailure.jobId);
    if (!job) {
      setSaveFailure(null);
      return;
    }
    saveJobToStorage(job).then(
      () => setSaveFailure(null),
      (err) => setSaveFailure({ jobId: job.id, message: saveFailureMessage(err) })
    );
  }, [saveFailure]);

  const handleStepChange = useCallback(
    (step: number) => {
      // A locked step can't be opened, from the header or from any button on the page.
      if (step > stepGate.upTo) return;
      setStepOverride(step);
      if (activeJob && activeJob.lastStep !== step) updateJob(activeJob.id, { lastStep: step });
    },
    [activeJob, updateJob, stepGate.upTo]
  );

  /**
   * The dub language picked. It only sets the language: lines already
   * translated are never sent to translation from here (a pick by mistake
   * used to start a full translation and throw the Sync away). They keep
   * their words, and the user is told to Re-translate or paste a script.
   */
  const handleLanguageChange = useCallback(
    (newLang: string) => {
      setSelectedLanguage(newLang);
      try {
        localStorage.setItem('dhvani_target_language', newLang);
      } catch {
        // ignore storage errors
      }
      if (!activeJob) return;
      const previous = activeJob.language || selectedLanguage;
      updateJob(activeJob.id, { language: newLang });
      // A transcript still waiting for a choice is only retargeted: the user picks translate or their own script after this.
      if (activeJob.targetSource === 'pending' || previous === newLang) return;
      const hasLines = activeJob.segments?.some((seg) => (seg.textTarget || (seg as any).targetText || '').trim());
      if (!hasLines) return;
      updateJob(activeJob.id, {
        translationWarning:
          activeJob.targetSource === 'custom'
            ? `Your script is in ${previous}, and the dub language is now ${newLang}. Paste a ${newLang} script or translate the transcript from the Translation panel.`
            : `The lines are in ${previous}, and the dub language is now ${newLang}. Re-translate from the Translation panel to translate them; nothing has changed yet.`,
      });
    },
    [activeJob, selectedLanguage, updateJob]
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
    async (overridePrompt?: string, { fast = false }: { fast?: boolean } = {}) => {
      if (!activeJob || !activeJob.segments || activeJob.segments.length === 0) return;
      const promptToUse = overridePrompt !== undefined ? overridePrompt : (activeJob.customPrompt || customPrompt);
      const signal = startTranslating(activeJob.id);
      try {
        const targetLang = activeJob.language || selectedLanguage;

        // Text-only retranslation against the existing ElevenLabs timestamps.
        const { segments: translatedSegments, translatedSrt, untranslatedCueIds } =
          await retranslateCues(activeJob.segments, {
            sourceLanguage: activeJob.detectedLanguage || sourceLanguage,
            targetLanguage: targetLang,
            customPrompt: promptToUse,
            ...(fitTranslationToVoice && voiceRate.rate && { voiceRate: voiceRate.rate.syllablesPerSecond }),
            ...(fitTranslationToVoice && { speakerRates: speakerSyllableRates(voiceRates.speakers) }),
            fast,
            signal,
            onProgress: translationProgressOf(activeJob.id),
          });
        // Cancelled while the last answer was on its way: nothing is applied.
        if (signal.aborted) return;

        const newScript = translatedSegments
          .map((s) => s.textTarget || (s as any).targetText || '')
          .filter(Boolean)
          .join(' ');

        updateJob(activeJob.id, {
          segments: translatedSegments,
          reviewHistory: startReviewHistory(translatedSegments, BASE_LABELS.translation),
          script: newScript,
          customPrompt: promptToUse,
          targetSource: 'translated',
          translatedSrt,
          translationWarning: untranslatedWarning(untranslatedCueIds.length),
          untranslatedCueIds: untranslatedCueIds.length ? untranslatedCueIds : null,
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
          syncTakes: null,
          syncEdits: null,
          syncBaseReport: null,
          syncBeforeVoiceChange: null,
          syncChangedVoices: null,
          dubStems: null,
          dubMix: null,
          syncedStems: null,
          syncMix: null,
        });
      } catch (err: any) {
        // Cancelled by the user: no error, the lines stay as they were.
        if (signal.aborted) return;
        console.warn('Retranslate with prompt error:', err);
        reportError(err, {
          title: `Translation to ${activeJob.language || selectedLanguage} failed`,
          safe: 'Your transcription and timestamps are intact. You can also use your own script instead.',
          retry: () => void handleRetranslateWithPrompt(overridePrompt, { fast }).catch(() => {}),
        });
        throw err;
      } finally {
        stopTranslating(activeJob.id, signal);
      }
    },
    [activeJob, customPrompt, selectedLanguage, updateJob, fitTranslationToVoice, voiceRate.rate, voiceRates.speakers]
  );

  /**
   * Translates only the cues the last translation missed. Every other line,
   * any hand edit and the dub stay as they are; a synced line that changes is
   * left for Sync to place again, the same as a hand edit.
   */
  const handleTranslateMissing = useCallback(async () => {
    const ids = new Set(activeJob?.untranslatedCueIds || []);
    if (!activeJob || ids.size === 0) return;
    const jobId = activeJob.id;
    const missing = activeJob.segments.filter((s) => ids.has(String(s.id)));
    if (missing.length === 0) {
      updateJob(jobId, { translationWarning: null, untranslatedCueIds: null });
      return;
    }
    const signal = startTranslating(activeJob.id);
    try {
      const { segments: done, untranslatedCueIds } = await retranslateCues(missing, {
        sourceLanguage: activeJob.detectedLanguage || sourceLanguage,
        targetLanguage: activeJob.language || selectedLanguage,
        customPrompt: activeJob.customPrompt || customPrompt,
        ...(fitTranslationToVoice && voiceRate.rate && { voiceRate: voiceRate.rate.syllablesPerSecond }),
        ...(fitTranslationToVoice && { speakerRates: speakerSyllableRates(voiceRates.speakers) }),
        signal,
        onProgress: translationProgressOf(activeJob.id),
      });
      if (signal.aborted) return;
      // Applied to the job as it is now, in case anything changed while it ran.
      const job = queueRef.current.find((j) => j.id === jobId);
      if (!job) return;
      const stillMissing = new Set(untranslatedCueIds.map(String));
      const byId = new Map(done.filter((s) => !stillMissing.has(String(s.id))).map((s) => [String(s.id), s]));
      const segments = job.segments.map((seg) => {
        const fresh = byId.get(String(seg.id));
        if (!fresh) return seg;
        const text = fresh.textTarget || (fresh as any).targetText || '';
        return { ...seg, textTarget: text, targetText: text, pausedTarget: fresh.pausedTarget };
      });
      const step = recordReviewStep(job.reviewHistory, job.segments, segments, { label: 'Translate missing lines' });
      updateJob(jobId, {
        segments: step.segments,
        reviewHistory: step.history,
        script: segments.map((s) => s.textTarget || (s as any).targetText || '').filter(Boolean).join(' '),
        translationWarning: untranslatedWarning(stillMissing.size),
        untranslatedCueIds: stillMissing.size ? [...stillMissing] : null,
        ...syncPendingAfter(job, segments),
      });
    } catch (err: any) {
      if (signal.aborted) return;
      updateJob(jobId, { translationWarning: untranslatedWarning(ids.size) });
      reportError(err, { title: `Translating ${ids.size} cue(s) failed`, safe: 'Those cues kept their previous text; nothing else changed.' });
    } finally {
      stopTranslating(activeJob.id, signal);
    }
  }, [activeJob, customPrompt, selectedLanguage, updateJob, fitTranslationToVoice, voiceRate.rate, voiceRates.speakers]);

  /**
   * The transcript's "Translate" choice. The only place a waiting transcript
   * is sent to the translation engine, and only on the user's click. When the
   * transcript is already in the dub language it becomes the script as-is,
   * the same shortcut the pipeline takes, so no credits are spent on it.
   * `fast` is Fast translate: translation only, no checks.
   */
  const handleTranslateTranscript = useCallback(async ({ fast = false }: { fast?: boolean } = {}) => {
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
        reviewHistory: startReviewHistory(segments, BASE_LABELS.transcript),
        script: segments.map((s) => s.textTarget).filter(Boolean).join(' '),
        targetSource: 'translated',
        translationWarning: null,
        untranslatedCueIds: null,
      });
      return;
    }
    await handleRetranslateWithPrompt(undefined, { fast });
  }, [activeJob, selectedLanguage, updateJob, handleRetranslateWithPrompt]);

  /** Records where the target lines came from, e.g. once a pasted script is applied. */
  const handleTargetSourceChange = useCallback(
    (targetSource: TargetSource) => {
      if (!activeJob) return;
      updateJobWith(activeJob.id, (job) => ({
        targetSource,
        // A pasted script replaces whatever the translation reported, and undo stops at it.
        ...(targetSource === 'custom'
          ? {
              translationWarning: null,
              untranslatedCueIds: null,
              translatedSrt: '',
              reviewHistory: startReviewHistory(job.segments, BASE_LABELS.script),
            }
          : {}),
      }));
    },
    [activeJob, updateJobWith]
  );

  /**
   * Transcribes a project's file, which only ever starts when the user asks.
   * Returns the transcript, or null when the user cancelled it: then the
   * request is dropped, which stops the server too (ffmpeg, the upload to
   * ElevenLabs, any retry), and the project is left as it was.
   */
  const runTranscription = async (jobId: string, file: File, language: string) => {
    // Transcribing a project again replaces its own transcription in flight; another project's runs on.
    transcribeRunsRef.current[jobId]?.abort();
    const controller = new AbortController();
    transcribeRunsRef.current[jobId] = controller;
    setTranscriptions((all) => ({ ...all, [jobId]: '' }));
    setCancelledTranscriptionJob((cancelled) => (cancelled === jobId ? null : cancelled));
    try {
      return await transcribeOnly(
        file,
        (status) => {
          if (transcribeRunsRef.current[jobId] === controller) setTranscriptions((all) => ({ ...all, [jobId]: status }));
        },
        language,
        { ...speakerOptions, signal: controller.signal }
      );
    } catch (err) {
      if (controller.signal.aborted) {
        // Not when a new transcription of the project replaced it.
        if (transcribeRunsRef.current[jobId] === controller) setCancelledTranscriptionJob(jobId);
        return null;
      }
      throw err;
    } finally {
      if (transcribeRunsRef.current[jobId] === controller) {
        delete transcribeRunsRef.current[jobId];
        setTranscriptions(({ [jobId]: _done, ...rest }) => rest);
      }
    }
  };

  /** Stops the open project's transcription, here and on the server. */
  const handleCancelTranscription = () => {
    if (activeJob) transcribeRunsRef.current[activeJob.id]?.abort();
  };

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
          untranslatedCueIds: null,
          targetSource: 'pending',
          transcriptCuts: null,
          reviewHistory: null,
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
          syncTakes: null,
          syncEdits: null,
          syncBaseReport: null,
          syncBeforeVoiceChange: null,
          syncChangedVoices: null,
          dubStems: null,
          dubMix: null,
          syncedStems: null,
          syncMix: null,
        });
      } catch (err: any) {
        updateJob(activeJob.id, { errorMsg: describePipelineError(err) });
        reportError(err, { title: 'Transcription failed', safe: 'Your file and project are unchanged.' });
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
  /*
   * With several speakers each has a lane in Edit timing: a level, which the
   * file is rendered with and the live dub plays with, and a mute and solo,
   * which only the live dub follows. Mute and solo belong to the project open now.
   */
  const [speakerMonitor, setSpeakerMonitor] = useState<Record<string, SpeakerMonitor>>({});
  useEffect(() => setSpeakerMonitor({}), [activeJobId]);
  const liveBank = useMemo(
    () => (activeJob?.syncBank ? withSpeakerLevels(activeJob.syncBank, activeJob.syncSpeakerLevels) : null),
    [activeJob?.syncBank, activeJob?.syncSpeakerLevels]
  );
  const liveSpeakers = useMemo(() => (liveBank ? [...new Set(liveBank.lines.map((line) => line.speaker))] : []), [liveBank]);
  const liveMulti = Boolean(activeJob?.syncBaseReport?.mix);
  /*
   * Tracks of outside audio under the dub in Edit timing: each file decoded
   * once for the open project, to play live and to draw; a track's mute and
   * solo are for listening, as a speaker's.
   */
  const [trackBuffers, setTrackBuffers] = useState<Record<string, AudioBuffer>>({});
  const trackBuffersRef = useRef(trackBuffers);
  trackBuffersRef.current = trackBuffers;
  const [trackMonitor, setTrackMonitor] = useState<Record<string, SpeakerMonitor>>({});
  useEffect(() => {
    setTrackBuffers({});
    setTrackMonitor({});
  }, [activeJobId]);
  const trackFiles = useMemo(
    () => Object.fromEntries((activeJob?.syncAudioFiles || []).map(({ blob: _blob, ...info }) => [info.id, info as AudioFileInfo])),
    [activeJob?.syncAudioFiles]
  );
  useEffect(() => {
    const missing = (activeJob?.syncAudioFiles || []).filter((file) => !trackBuffersRef.current[file.id]);
    if (missing.length === 0) return;
    let live = true;
    for (const file of missing) {
      const url = URL.createObjectURL(file.blob);
      decodeAudioBlobUrl(url)
        .then((buffer) => live && setTrackBuffers((all) => (all[file.id] ? all : { ...all, [file.id]: buffer })))
        .catch((err) => console.warn(`Could not read ${file.name} for its track:`, err))
        .finally(() => URL.revokeObjectURL(url));
    }
    return () => {
      live = false;
    };
  }, [activeJob?.syncAudioFiles]);
  /*
   * Solo works as in a DAW: once a speaker's lane or a track is soloed, only
   * what is soloed is heard. The other speakers, the other tracks, the clips
   * of the original, and the original itself go quiet (listening only).
   */
  const speakerSoloed = liveMulti && liveSpeakers.some((speaker) => speakerMonitor[speaker]?.solo);
  const trackSoloed = (activeJob?.syncAudioTracks || []).some((track) => trackMonitor[track.id]?.solo);
  const soloing = speakerSoloed || trackSoloed;
  const soloingRef = useRef(soloing);
  soloingRef.current = soloing;
  /** The speakers not heard now: muted, or left out by a solo. With one speaker it has no lane of its own, so only a solo leaves it out. */
  const liveSilenced = useMemo(
    () => (liveMulti ? silencedSpeakers(liveSpeakers, speakerMonitor, trackSoloed) : new Set<string>(trackSoloed ? liveSpeakers : [])),
    [liveMulti, liveSpeakers, speakerMonitor, trackSoloed]
  );
  /** The tracks not heard now: muted, or left out by a solo. */
  const silencedTracks = useMemo(() => {
    const tracks = activeJob?.syncAudioTracks || [];
    return silencedSpeakers(tracks.map((track) => track.id), trackMonitor, speakerSoloed);
  }, [activeJob?.syncAudioTracks, trackMonitor, speakerSoloed]);
  const liveTrackParts = (edits: SyncEdits | null | undefined, tracks: AudioTrack[] | null | undefined, silenced: Set<string>) =>
    audioParts(edits, tracks, trackFiles)
      .filter(({ track }) => !silenced.has(track))
      .map(({ part, file, track }) => ({ part, file, gain: 10 ** ((tracks?.find((t) => t.id === track)?.gainDb ?? 0) / 20) }));
  const liveDubClips = useMemo(
    () =>
      liveDub && liveBank
        ? liveClips(
            liveBank,
            activeJob?.syncEdits,
            liveMulti,
            // The clips of the original have no solo of their own: a solo anywhere leaves them out.
            activeJob && !soloing ? originalParts(activeJob.syncEdits, sourceDurationOf(activeJob)) : [],
            liveSilenced,
            liveTrackParts(activeJob?.syncEdits, activeJob?.syncAudioTracks, silencedTracks)
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveDub, liveBank, activeJob?.syncEdits, activeJob?.syncBaseReport, activeJob?.audioBuffer, liveSilenced, activeJob?.syncAudioTracks, silencedTracks, trackFiles, soloing]
  );
  const liveDubClipsRef = useRef(liveDubClips);
  liveDubClipsRef.current = liveDubClips;
  const liveEngineRef = useRef<LiveDubEngine | null>(null);
  const liveDubInputRef = useRef<{
    bank: NonNullable<BatchJob['syncBank']>;
    multiSpeaker: boolean;
    sourceDuration: number;
    silenced: Set<string>;
    soloing: boolean;
    trackParts: (edits: SyncEdits) => ReturnType<typeof liveTrackParts>;
  } | null>(null);
  liveDubInputRef.current = activeJob && liveBank
    ? {
        bank: liveBank,
        multiSpeaker: Boolean(activeJob.syncBaseReport?.mix),
        sourceDuration: sourceDurationOf(activeJob),
        silenced: liveSilenced,
        soloing,
        trackParts: (edits) => liveTrackParts(edits, activeJob.syncAudioTracks, silencedTracks),
      }
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
    engine.setClips(
      edits
        ? liveClips(input.bank, edits, input.multiSpeaker, input.soloing ? [] : originalParts(edits, input.sourceDuration), input.silenced, input.trackParts(edits))
        : liveDubClipsRef.current
    );
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
  /** A project's synced dub as it is now, open or not, so a decode that lands after a newer one is dropped. */
  const syncedUrlOf = (jobId: string) => queueRef.current.find((job) => job.id === jobId)?.syncedAudioUrl || null;

  // Re-decode audio buffers if needed
  useEffect(() => {
    if (activeJob && !activeJob.audioBuffer && activeJob.file) {
      analyzeAudio(activeJob.file, { sensitivity: activeJob.analysisSensitivity ?? 50, gate: activeJob.analysisGate, detect: activeJob.segments.length === 0 })
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

  /*
   * Decoded audio of projects that are not open is let go once nothing runs on
   * them. A 13-minute project holds about 550 MB of it (original, dub, synced
   * dub), and it piled up per project opened: on a 16 GB Mac that ran out of
   * memory and froze the page (2026-11-09). The effect above decodes it again
   * when the project is opened. The pause leaves an edit render that was just
   * scheduled for the project being left time to finish.
   */
  const workingJobIds = queue
    .filter((job) => WORKING.has(job.status))
    .map((job) => job.id)
    .join(',');
  useEffect(() => {
    const timer = setTimeout(() => {
      setQueue((prev) => {
        let changed = false;
        const next = prev.map((job) => {
          if (job.id === activeJobIdRef.current || WORKING.has(job.status)) return job;
          if (!job.audioBuffer && !job.synthAudioBuffer && !job.syncedAudioBuffer) return job;
          changed = true;
          const released = { ...job, audioBuffer: null, synthAudioBuffer: null, syncedAudioBuffer: null };
          // A callback keeps the whole render it was made in, so the queue from when this project
          // was open (and its audio) lives on in callbacks that have not been made again since.
          // Clearing the old object too is what lets the audio go (seen in a heap snapshot).
          job.audioBuffer = null;
          job.synthAudioBuffer = null;
          job.syncedAudioBuffer = null;
          return released;
        });
        return changed ? next : prev;
      });
    }, RELEASE_CLOSED_AUDIO_MS);
    return () => clearTimeout(timer);
  }, [activeJobId, workingJobIds]);

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
    // The original is only the clock with the dub soloed in the player, or with anything soloed in Edit timing.
    mixer.setLive(liveDub, () => playModeRef.current === 'synth' || soloingRef.current);
    if (lastLiveRef.current === liveDub) return;
    lastLiveRef.current = liveDub;
    if (!isPlayingRef.current) return;
    const at = sourceAudioRef.current?.currentTime ?? currentTimeRef.current;
    pauseAll();
    startPlayback(playModeRef.current, at);
  }, [liveDub, soloing, mixer.setLive, pauseAll, startPlayback]);

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
        engine.setFiles(trackBuffersRef.current);
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
    liveEngineRef.current?.setFiles(trackBuffersRef.current);
  }, [trackBuffers]);
  useEffect(() => {
    // Read through the ref: a closure that names the buffer keeps it, and with it this whole
    // render's scope, alive in every long-lived callback made in the same render.
    liveEngineRef.current?.setOriginal(liveOriginalRef.current);
  }, [liveOriginal]);

  // Spacebar shortcuts for play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space types a space wherever text is typed: boxes, and the Script view's lines typed in place.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
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

  /** The voice API settings' Try it speaks with: the one the dub uses. */
  const previewVoiceName =
    availableVoices.find((voice) => voice.voice_id === elVoiceId)?.name ??
    POPULAR_ELEVENLABS_VOICES.find((voice) => voice.id === elVoiceId)?.name ??
    null;
  const previewVoice = elVoiceId ? { id: elVoiceId, name: previewVoiceName || 'Your voice', modelId: elModelId, apiKey: elApiKey } : null;

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
        untranslatedCueIds: null,
        targetSource: 'pending',
        transcriptCuts: null,
        reviewHistory: null,
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
        syncTakes: null,
        syncEdits: null,
        syncBaseReport: null,
        syncBeforeVoiceChange: null,
        syncChangedVoices: null,
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
      reportError(err, { title: 'Transcription failed', safe: 'Your file and project are unchanged.' });
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
  const cancelSyncEditRender = (jobId: string) => {
    const run = syncEditRunsRef.current[jobId];
    if (!run) return;
    if (run.timer !== null) window.clearTimeout(run.timer);
    run.controller?.abort();
    delete syncEditRunsRef.current[jobId];
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
    cancelSyncEditRender(jobId);
    setSyncEditStatus(jobId, { state: 'pending' });
    const timer = window.setTimeout(async () => {
      const controller = new AbortController();
      syncEditRunsRef.current[jobId] = { timer: null, controller };
      setSyncEditStatus(jobId, { state: 'rendering' });
      try {
        // Each speaker's level from their lane, as the project has it when the render starts.
        const levels = queueRef.current.find((job) => job.id === jobId)?.syncSpeakerLevels;
        const { blob, stems, mix } = await renderSyncEdits(
          { bank: withSpeakerLevels(input.bank, levels), bankBlob: input.bankBlob, edits: input.edits, report: input.baseReport, sourceDuration: input.sourceDuration, source: input.source },
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const several = Boolean(input.baseReport.mix);
        const previousUrl = syncedUrlOf(jobId);
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
            if (syncedUrlOf(jobId) === url) updateJob(jobId, { syncedAudioBuffer: buffer });
          })
          .catch(console.warn)
          .finally(() => {
            if (decodingSynthUrlRef.current === url) decodingSynthUrlRef.current = null;
          });
        // The file before this render is kept with the project as a Blob until replaced; its URL can go once the player has moved on.
        if (previousUrl) window.setTimeout(() => URL.revokeObjectURL(previousUrl), 5000);
        setSyncEditStatus(jobId, { state: 'ready' });
      } catch (err: any) {
        if (controller.signal.aborted || err?.name === 'AbortError') return;
        console.error('Edit render error:', err);
        setSyncEditStatus(jobId, { state: 'error', message: 'The edited dub could not be rendered.' });
        reportError(err, { title: 'Your edits could not be rendered', safe: 'Your edits are kept — Try again on the timeline renders them again.' });
      } finally {
        if (syncEditRunsRef.current[jobId]?.controller === controller) delete syncEditRunsRef.current[jobId];
      }
    }, delay);
    syncEditRunsRef.current[jobId] = { timer, controller: null };
  };

  /**
   * Edit timing changed a line, or a track (with `tracks`, the tracks as they
   * are now, in the same step): the report follows at once, the audio once the
   * user pauses. Clips on tracks are not in the synced dub's file, so a change
   * to them alone renders nothing.
   */
  const handleSyncEditsChange = (edits: SyncEdits, label?: string, tracks?: AudioTrack[]) => {
    if (!activeJob?.syncBank || !activeJob.syncBaseReport) return;
    const clean = hasEdits(edits) ? edits : null;
    const dubChanged = JSON.stringify(withoutAudioClips(clean)) !== JSON.stringify(withoutAudioClips(activeJob.syncEdits));
    updateJob(
      activeJob.id,
      {
        syncEdits: clean,
        syncReport: measureEdits(activeJob.syncBaseReport, activeJob.syncBank, clean),
        ...(tracks && { syncAudioTracks: tracks.length > 0 ? tracks : null }),
      },
      label ? { label: `Edit timing: ${label}` } : undefined
    );
    if (!dubChanged) return;
    scheduleSyncEditRender(activeJob.id, {
      bank: activeJob.syncBank,
      bankBlob: activeJob.syncBankBlob,
      baseReport: activeJob.syncBaseReport,
      edits: clean,
      sourceDuration: sourceDurationOf(activeJob),
      source: activeJob.audioBuffer,
    });
  };

  /** A speaker's level from their lane in Edit timing: kept with the project, and the synced dub rendered with it. */
  const handleSpeakerLevelChange = (speaker: string, db: number) => {
    if (!activeJob?.syncBank || !activeJob.syncBaseReport) return;
    const levels = cleanSpeakerLevels({ ...activeJob.syncSpeakerLevels, [speaker]: db });
    updateJob(activeJob.id, { syncSpeakerLevels: Object.keys(levels).length > 0 ? levels : null });
    scheduleSyncEditRender(activeJob.id, {
      bank: activeJob.syncBank,
      bankBlob: activeJob.syncBankBlob,
      baseReport: activeJob.syncBaseReport,
      edits: activeJob.syncEdits || null,
      sourceDuration: sourceDurationOf(activeJob),
      source: activeJob.audioBuffer,
    });
  };

  /**
   * Audio files dropped on Edit timing, kept with the project as they came and
   * decoded to play and draw. A file that can't be read as audio is named in
   * the error; the others are kept.
   */
  const handleImportTrackAudio = async (files: File[]): Promise<AudioFileInfo[]> => {
    const jobId = activeJob?.id;
    if (!jobId) return [];
    const records: AudioFileRecord[] = [];
    const buffers: Record<string, AudioBuffer> = {};
    const failed: string[] = [];
    for (const file of files) {
      const url = URL.createObjectURL(file);
      try {
        const buffer = await decodeAudioBlobUrl(url);
        const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `file-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
        records.push({ id, name: file.name, blob: file, duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels });
        buffers[id] = buffer;
      } catch {
        failed.push(file.name);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (records.length > 0) {
      setTrackBuffers((all) => ({ ...all, ...buffers }));
      updateJobWith(jobId, (job) => ({ syncAudioFiles: [...(job.syncAudioFiles || []), ...records] }));
    }
    if (failed.length > 0) {
      reportError(new Error(`${failed.join(', ')} could not be read as audio.`), {
        title: failed.length === 1 ? 'That file could not be added' : 'Some files could not be added',
        safe: records.length > 0 ? 'The other files were added.' : 'Nothing was changed.',
      });
    }
    return records.map(({ blob: _blob, ...info }) => info);
  };

  /** A track muted or soloed: heard in Edit timing only, never left out of the file. */
  const handleTrackMonitorChange = (trackId: string, patch: Partial<SpeakerMonitor>) =>
    setTrackMonitor((all) => ({ ...all, [trackId]: { muted: false, solo: false, ...all[trackId], ...patch } }));

  /** A speaker's lane muted or soloed: heard in the live dub only. */
  const handleSpeakerMonitorChange = (speaker: string, patch: Partial<SpeakerMonitor>) =>
    setSpeakerMonitor((all) => ({ ...all, [speaker]: { muted: false, solo: false, ...all[speaker], ...patch } }));

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
  const expressionTakesTags = (voice: Pick<DubVoice, 'voiceId' | 'modelId' | 'cartesia'> = { voiceId: elVoiceId, modelId: elModelId, cartesia: cartesiaVoice }) =>
    isCartesiaVoice(voice.voiceId) ? cartesiaTakesControls(voice.cartesia.modelId) : performsAudioTags(voice.modelId);

  /** The voice as it is set now, for a dub pressed now. */
  const currentDubVoice = (): DubVoice => ({
    apiKey: elApiKey,
    voiceId: elVoiceId,
    modelId: elModelId,
    voiceSettings: elVoiceSettings,
    cartesia: cartesiaVoice,
    expression: voiceExpression,
    tuneStability,
    quality: dubAudioQuality,
    mixPeak,
    language: selectedLanguage,
  });

  const readScript = async (job: BatchJob, voice: DubVoice, language: string, readKey: string, matchLoudness: boolean, outputFormat: string, signal: AbortSignal) => {
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
      const tags = expressionTakesTags(voice);
      const expression: VoiceExpression = tags || voice.expression === 'off' ? voice.expression : 'neutral';
      const matchSource = expression === 'natural';
      let script = buildSpeechScript(job.segments);
      if (matchSource) {
        const tagged = await sourceTaggedSegments(job, language, signal, () =>
          setReadProgress({ phase: 'listening', passageCount: 0, passagesDone: 0, totalChars: 0, charsDone: 0, secondsGenerated: 0, streaming: true })
        );
        script = buildSpeechScript(tagged);
      }
      const blob = await synthesizeSpeech(voice.apiKey, voice.voiceId, script, voice.modelId, outputFormat, voice.voiceSettings, {
        expressive: expression === 'expressive',
        audioTags: matchSource,
        performanceTags: matchSource,
        steady: expression === 'neutral',
        matchLoudness,
        tuneStability: voice.tuneStability,
        onStabilityAdjustment: setLastStabilityAdjustment,
        cartesia: cartesiaForExpression(voice.cartesia, expression),
        language,
        jobId: readJobId,
        signal,
      });
      const lines: DubLines = {
        dubId: readJobId,
        voiceId: voice.voiceId,
        modelId: voice.modelId,
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

  /**
   * Dub, as pressed on the open project: now, or once the dub running for
   * another project ends. When unlocked lines carry hand edits, which Sync
   * again would drop, or play a take picked in the T window, which it would
   * place afresh, it first asks whether to lock them (SyncAgainGuard).
   */
  const handleSyncDub = (options: SyncOptions, { checked = false } = {}) => {
    const job = activeJob;
    if (!job || job.segments.length === 0 || job.targetSource === 'pending') return;
    if (syncRunRef.current?.projectId === job.id || dubQueue.some((dub) => dub.jobId === job.id)) return;
    if (!checked) {
      const pending = job.syncPendingLines || [];
      const lines = unlockedEdits(job.syncBank, job.syncEdits, pending, job.syncTakes);
      if (lines.length > 0) {
        const numberOf = (key: string) => job.segments.findIndex((seg) => String(seg.id) === key) + 1;
        setSyncGuard({
          jobId: job.id,
          options,
          lines: lines.map((line) => ({ ...line, number: numberOf(line.key) })),
          voicedAgain: pending.filter((key) => job.syncEdits?.[key] || pickedTakeName(job.syncTakes, key)).length,
        });
        return;
      }
    }
    if (syncRunRef.current) {
      setDubQueue((waiting) => [...waiting, { jobId: job.id, options, voice: currentDubVoice() }]);
      return;
    }
    runSyncDub(job.id, options, currentDubVoice());
  };

  /**
   * Sync changed lines only, as pressed: every line but the changed ones is
   * locked where it is for this one Sync (hand edits kept), so only the
   * changed lines are voiced and placed and nothing else moves; the locks it
   * added are let go once it ends, done or not (see runSyncDub).
   */
  const handleSyncChangedOnly = (options: SyncOptions) => {
    const job = activeJob;
    if (!job || job.segments.length === 0 || job.targetSource === 'pending') return;
    if (syncRunRef.current?.projectId === job.id || dubQueue.some((dub) => dub.jobId === job.id)) return;
    const changed = job.syncPendingLines || [];
    const bank = job.syncBank;
    if (!bank || changed.length === 0) return handleSyncDub(options);
    const held = linesToHold(bank, job.syncEdits, changed);
    updateJob(job.id, { syncEdits: lockLines(job.syncEdits, held, bank), syncHeldLines: held });
    // Queued, the sync starts once the locks are in the project it reads.
    setDubQueue((waiting) => [...waiting, { jobId: job.id, options, voice: currentDubVoice() }]);
  };

  /**
   * Sync from scratch, as pressed: first says what it drops (hand edits and
   * locks, picked takes, lines moved on Review's dub lane, retakes) and what
   * it costs, as every line is voiced again.
   */
  const handleSyncFromScratch = (options: SyncOptions) => {
    const job = activeJob;
    if (!job || job.segments.length === 0 || job.targetSource === 'pending') return;
    if (syncRunRef.current?.projectId === job.id || dubQueue.some((dub) => dub.jobId === job.id)) return;
    setScratchConfirm({
      jobId: job.id,
      options,
      lines: job.segments.length,
      characters: job.segments.reduce((sum, seg) => sum + (seg.textTarget || seg.targetText || '').length, 0),
      edited: Object.keys(job.syncEdits || {}).filter((key) => !isClip(key)).length,
      picked: Object.keys(job.syncTakes || {}).filter((key) => pickedTakeName(job.syncTakes, key)).length,
      placed: job.segments.filter((seg) => seg.dubPlace).length,
      retakes: new Set([...Object.keys(job.syncLineSeeds || {}), ...Object.keys(job.syncTakeChoices || {})]).size,
    });
  };

  const answerScratchConfirm = () => {
    const confirm = scratchConfirm;
    setScratchConfirm(null);
    if (!confirm || confirm.jobId !== activeJob?.id) return;
    if (syncRunRef.current) {
      setDubQueue((waiting) => [...waiting, { jobId: confirm.jobId, options: confirm.options, voice: currentDubVoice(), fresh: true }]);
      return;
    }
    runSyncDub(confirm.jobId, confirm.options, currentDubVoice(), { fresh: true });
  };

  /** Sync again's question answered: lock the listed lines first, or let their edits go. */
  const answerSyncGuard = (lock: boolean) => {
    const guard = syncGuard;
    setSyncGuard(null);
    if (!guard || guard.jobId !== activeJob?.id) return;
    if (!lock) return handleSyncDub(guard.options, { checked: true });
    const bank = activeJob.syncBank;
    if (!bank) return;
    updateJob(activeJob.id, { syncEdits: lockLines(activeJob.syncEdits, guard.lines.map((line) => line.key), bank) });
    // Queued, the sync starts once the locks are in the project it reads.
    setDubQueue((waiting) => [...waiting, { jobId: activeJob.id, options: guard.options, voice: currentDubVoice() }]);
  };

  const runSyncDub = async (
    projectId: string,
    { voicing, precision, join, refit, suggest, suggestLonger, matchLoudness, verifyWords, timingProtection }: SyncOptions,
    voice: DubVoice,
    { fresh = false }: { fresh?: boolean } = {}
  ) => {
    // The project as it is now: a dub that waited its turn takes the edits made meanwhile.
    const activeJob = queueRef.current.find((job) => job.id === projectId);
    if (!activeJob || activeJob.segments.length === 0 || activeJob.targetSource === 'pending' || syncRunRef.current) return;

    const hadDub = Boolean(activeJob.synthesizedAudioUrl || activeJob.syncedAudioUrl);
    // Kept with the project, so a dub run again after a restart asks for the same reads and finds the lines it already voiced.
    // From scratch, a new seed: no line is found already voiced, so every one is voiced anew.
    const seed = fresh
      ? (syncSeedRef.current[activeJob.id] = Math.floor(Math.random() * 2 ** 31))
      : (syncSeedRef.current[activeJob.id] ??= activeJob.syncSeed ?? Math.floor(Math.random() * 2 ** 31));
    setSyncingJobId(projectId);
    updateJob(activeJob.id, { status: ProcessingStatus.SYNTHESIZING_AUDIO, errorMsg: null, syncSeed: seed, syncInterrupted: false });

    const jobId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const controller = new AbortController();
    syncRunRef.current = { jobId, projectId, controller };
    setSyncProgress(null);
    setIsCancellingSync(false);
    const poll = window.setInterval(() => {
      getSyncProgress(jobId)
        .then((progress) => {
          if (syncRunRef.current?.jobId === jobId) setSyncProgress(progress);
        })
        .catch(() => {});
    }, 700);

    const sourceDuration = sourceDurationOf(activeJob);

    // Locked lines in Edit timing stay where the user put them.
    // From scratch, only clips (of the original, or on a track) stay: no lock, hand edit, picked take or place on Review's dub lane.
    const priorBank = activeJob.syncBank || null;
    const priorEdits = fresh
      ? Object.fromEntries(Object.entries(activeJob.syncEdits || {}).filter(([key]) => isClip(key)))
      : activeJob.syncEdits || null;
    const locked = fresh ? {} : lockedLines(priorBank, priorEdits);
    // Takes picked in the takes panel are kept as they are, unless their words changed since.
    const picked = fresh ? undefined : pickedTakes(priorBank, activeJob.syncTakes, activeJob.syncPendingLines || []);
    const syncSegments = fresh ? activeJob.segments.map(({ dubPlace: _place, ...seg }) => seg) : activeJob.segments;
    // An edit render in flight belongs to the dub this sync replaces.
    cancelSyncEditRender(activeJob.id);

    try {
      const several = isMultiSpeaker(activeJob.segments);
      const language = activeJob.language || voice.language;
      // Tags need one voice on a model that performs them; otherwise the dub is voiced as Neutral (or Off).
      const tags = !several && expressionTakesTags(voice);
      const expression: VoiceExpression = tags || voice.expression === 'off' ? voice.expression : 'neutral';
      const cartesiaDub = cartesiaForExpression(voice.cartesia, expression);
      let voiceTexts: Record<string, string> | undefined;
      if (expression === 'natural') {
        const tagged = await sourceTaggedSegments(activeJob, language, controller.signal);
        voiceTexts = Object.fromEntries(tagged.map((segment) => [String(segment.id), segment.textTarget || segment.targetText || '']));
      }
      /*
       * Picked takes are kept from the last bank, and nothing is resampled,
       * so while there are any the dub stays in the format they were made in.
       */
      const keptFormat = picked && priorBank ? priorBank.outputFormat || 'mp3_44100_128' : null;
      // Cartesia has no plan tiers: a Cartesia voice is asked for the chosen format as it is.
      const refused = isCartesiaVoice(voice.voiceId) ? new Set<string>() : refusedQualities;
      /*
       * One continuous read (one voice only): the script is read in one take,
       * or the last read is reused while it was voiced the same way, and its
       * lines are cut from it rather than voiced again. A dub made before Dub
       * and Sync were one step counts as a read by its voice.
       */
      const voiceDub = async (outputFormat: string) => {
        let dub: { blob: Blob; lines: DubLines } | undefined;
        if (voicing === 'continuous' && !several) {
          const readKey = JSON.stringify([voice.voiceId, voice.modelId, voice.voiceSettings ?? null, expression, matchLoudness, cartesiaDub, outputFormat]);
          const last = activeJob.dubLines;
          const lastFits =
            !fresh &&
            activeJob.synthesizedBlob && last && last.voiceId === voice.voiceId && last.modelId === voice.modelId && (last.readKey ?? readKey) === readKey;
          dub =
            lastFits && activeJob.synthesizedBlob && last
              ? { blob: activeJob.synthesizedBlob, lines: last }
              : await readScript(activeJob, voice, language, readKey, matchLoudness, outputFormat, controller.signal);
        }
        return syncDub(
          {
            segments: syncSegments,
            sourceDuration,
            voiceId: voice.voiceId,
            modelId: voice.modelId,
            outputFormat,
            voiceSettings: voice.voiceSettings,
            language,
            seed,
            precision,
            join,
            ...(refit && { refit }),
            suggest,
            suggestLonger,
            matchLoudness,
            verifyWords,
            timingProtection,
            ...(!fresh && {
              lineSeeds: activeJob.syncLineSeeds || undefined,
              lineTakes: activeJob.syncLineTakes || undefined,
              ...(activeJob.syncTakeChoices && { takeChoices: activeJob.syncTakeChoices }),
              ...(activeJob.syncDeclinedTakes?.length && { declinedTakes: activeJob.syncDeclinedTakes }),
            }),
            debug: audioDebugEnabled(),
            cartesia: cartesiaDub,
            ...(voiceTexts && { voiceTexts }),
            ...(expression === 'expressive' && { expressive: true }),
            ...(expression === 'neutral' && { steady: true }),
            ...(dub && { dub }),
            ...(several && { multiSpeaker: true, cast: activeJob.cast, peak: voice.mixPeak }),
            ...(Object.keys(locked).length > 0 && { locked }),
            // Sync changed lines only: the lines it holds stay put even where a changed line needs more room.
            ...(!fresh && activeJob.syncHeldLines?.length && { holdLocked: true }),
            ...(picked && { picked, pickedBankBlob: activeJob.syncBankBlob }),
            tuneStability: voice.tuneStability,
          },
          { apiKey: voice.apiKey, jobId, signal: controller.signal }
        );
      };
      const { result: voiced, format: voicedFormat } = keptFormat
        ? { result: await voiceDub(keptFormat), format: keptFormat }
        : await voiceInAllowedQuality(voice.quality, refused, voiceDub, refuseQuality);
      const { blob, stems, report, bank: syncedBank, bankBlob: placedBankBlob } = voiced;
      // The bank remembers its format, so takes voiced for it later come back at its rate.
      const placedBank = { ...syncedBank, outputFormat: voicedFormat };
      setDubQualityNotices((all) => ({
        ...all,
        [activeJob.id]:
          keptFormat && keptFormat !== voice.quality
            ? `This dub stays in ${dubAudioQualityLabel(keptFormat)}, the format its picked takes were voiced in. Take them out and Sync again for ${dubAudioQualityLabel(voice.quality)}.`
            : fallbackNotice(voice.quality, voicedFormat),
      }));
      const rebased = rebaseEdits(priorEdits, priorBank, placedBank);
      // Lines Sync changed lines only held are let go again; one voiced differently was placed afresh.
      const held = fresh ? [] : activeJob.syncHeldLines || [];
      let keptEdits = releaseLines(rebased.edits, held, placedBank) ?? {};
      const heldPlain = (key: string) => {
        const line = priorBank?.lines.find((l) => l.key === key);
        const edit = priorEdits?.[key];
        return Boolean(line && edit && describeLineEdit(line, edit, priorBank!.sampleRate).length === 0);
      };
      const moved = rebased.dropped.filter((key) => held.includes(key) && heldPlain(key));
      const dropped = rebased.dropped.filter((key) => !moved.includes(key));
      if (report.audioDebug) {
        const { lines, ...format } = report.audioDebug;
        console.info('[sync audio]', format);
        console.table(lines.map(({ pauseCuts, ...line }) => ({ ...line, pauseCuts: pauseCuts.length })));
      }
      setLastStabilityAdjustment(report.stabilityAdjustment ?? null);

      const url = URL.createObjectURL(blob);
      // Every line keeps its takes: copied from the last bank to the end of this one, the picked one still playing.
      // From scratch, none are kept. Banks that can't be joined keep only the voice-changed takes playing.
      const carried = fresh
        ? null
        : await carryTakes({
            priorBank,
            priorBankBlob: activeJob.syncBankBlob,
            priorTakes: activeJob.syncTakes,
            bank: placedBank,
            bankBlob: placedBankBlob,
            report,
            bankId:
              typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `bank-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
          }).catch((err) => {
            console.warn('The takes could not be kept with the new sync:', err);
            return null;
          });
      // Copies on locked lines that play samples of their own bring them along too.
      const withCopies = await carryCopyAudio({
        edits: keptEdits,
        priorBank,
        priorBankBlob: activeJob.syncBankBlob,
        bank: carried?.bank ?? placedBank,
        bankBlob: carried?.bankBlob ?? placedBankBlob,
        bankId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `bank-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
      }).catch((err) => {
        console.warn('The copies could not keep their own takes with the new sync:', err);
        return null;
      });
      keptEdits = withCopies ? withCopies.edits ?? {} : moveCopyAudio(keptEdits, () => null) ?? {};
      const edited = hasEdits(keptEdits);
      const bank = withCopies?.bank ?? carried?.bank ?? placedBank;
      const bankBlob = withCopies?.bankBlob ?? carried?.bankBlob ?? placedBankBlob;
      // Lines kept as a voice-changed take stay so; a speaker dubbed in another voice since is no longer changed.
      const keptTakes = fresh ? null : carried ? carried.takes : keptVoiceTakes(bank, report, activeJob.syncTakes);
      // From scratch, what was kept for the dub before goes: retakes, take choices, places on the dub lane.
      const projectNow = queueRef.current.find((job) => job.id === activeJob.id) || activeJob;
      const scratch: Partial<BatchJob> = fresh
        ? {
            syncLineSeeds: null,
            syncLineTakes: null,
            syncTakeChoices: null,
            syncDeclinedTakes: null,
            segments: projectNow.segments.map(({ dubPlace: _place, ...seg }) => seg),
          }
        : {};
      const changedVoices = changedVoicesStill(activeJob, voice.voiceId);
      // Fit to this video after voicing swapped the settings: they are the project's settings for the next Sync too.
      const refitted = projectNow.syncOptions ? refittedOptions(projectNow.syncOptions, report) : null;
      // A dub made before Dub and Sync were one step stays as it was, beside the synced dub.
      updateJob(activeJob.id, {
        ...(refitted && { syncOptions: refitted }),
        syncedAudioUrl: url,
        syncedBlob: blob,
        syncReport: edited ? measureEdits(report, bank, keptEdits) : report,
        syncBaseReport: report,
        syncBank: bank,
        syncBankBlob: bankBlob,
        // A new bank: the one before is kept apart, for Undo to go back past this Sync.
        syncEpoch: newSyncId(),
        syncEdits: edited ? keptEdits : null,
        // The takes were in the last bank; the picked ones are in this one now (a voice-changed one with its take).
        syncTakes: keptTakes,
        syncChangedVoices: changedVoices,
        // A new sync is the dub now: the one from before a voice change can't come back over it.
        syncBeforeVoiceChange: null,
        syncPendingLines: [],
        syncPendingWords: [],
        syncHeldLines: null,
        syncedStems: several ? stems : null,
        syncMix: several ? report.mix || null : null,
        // Until the synced dub decodes, no waveform rather than the previous sync's.
        syncedAudioBuffer: null,
        status: ProcessingStatus.COMPLETED,
        ...scratch,
      }, fresh ? { label: 'Sync from scratch' } : undefined);
      const notices = [
        dropped.length > 0 &&
          `${dropped.length === 1 ? 'One line was' : `${dropped.length} lines were`} voiced again, so ${dropped.length === 1 ? 'its' : 'their'} hand edits were dropped.`,
        moved.length > 0 &&
          `${moved.length === 1 ? 'One line that was not changed was' : `${moved.length} lines that were not changed were`} voiced differently (another voice or setting), so ${moved.length === 1 ? 'it was' : 'they were'} placed afresh.`,
      ].filter(Boolean);
      setSyncEditStatus(activeJob.id, notices.length > 0 ? { state: 'ready', notice: notices.join(' ') } : { state: 'ready' });
      // The sync placed the locked lines' blocks; their edits are rendered over them now.
      // The speakers' levels are not in what the sync rendered either, so they are rendered over it too.
      const leveled = several && Object.keys(cleanSpeakerLevels(activeJob.syncSpeakerLevels)).length > 0;
      if (edited || leveled) scheduleSyncEditRender(activeJob.id, { bank, bankBlob, baseReport: report, edits: edited ? keptEdits : null, sourceDuration, source: activeJob.audioBuffer }, 0);
      // Lines voiced again of a speaker changed into another voice are changed into it too.
      const outOfVoice = changedVoices ? linesOutOfVoice(bank, report, keptTakes, changedVoices) : [];
      if (changedVoices && outOfVoice.length > 0) {
        const projectIdNow = activeJob.id;
        window.setTimeout(() => {
          void changeSyncLines(projectIdNow, bank, bankBlob, outOfVoice, voicesToChange(changedVoices), { busy: true }).then(({ error }) => {
            if (error) reportError(new Error(error), { title: 'Lines voiced again are still in the dub voice', safe: 'Change voice on each line, or Voice changer, changes them.' });
          });
        }, 0);
      }
      decodingSynthUrlRef.current = url;
      decodeAudioBlobUrl(url)
        .then((syncedBuffer) => {
          if (syncedUrlOf(activeJob.id) === url) updateJob(activeJob.id, { syncedAudioBuffer: syncedBuffer });
        })
        .catch(console.warn)
        .finally(() => {
          if (decodingSynthUrlRef.current === url) decodingSynthUrlRef.current = null;
        });

      // Synced, the dub is best judged against the original: on the project open, not one opened since.
      if (activeJobIdRef.current === activeJob.id) setTrackMode('both');
      refreshQuota();
    } catch (err: any) {
      // A failed or cancelled sync leaves the dub and the last synced dub as they were, the lines it held let go again.
      const now = queueRef.current.find((job) => job.id === activeJob.id);
      const held = now?.syncHeldLines || [];
      updateJob(activeJob.id, {
        status: hadDub ? ProcessingStatus.COMPLETED : ProcessingStatus.IDLE,
        ...(held.length > 0 && now?.syncBank && { syncEdits: releaseLines(now.syncEdits, held, now.syncBank), syncHeldLines: null }),
      });
      if (!controller.signal.aborted && err?.code !== 'cancelled') {
        console.error('Sync Error:', err);
        reportError(err, { title: 'Sync failed', safe: 'Lines already voiced are kept, so syncing again voices only the rest.' });
      }
    } finally {
      window.clearInterval(poll);
      if (syncRunRef.current?.jobId === jobId) syncRunRef.current = null;
      setSyncProgress(null);
      setIsCancellingSync(false);
      setSyncingJobId(null);
    }
  };

  /**
   * Puts a new wording of a synced line into the dub (Review's Voice and
   * use): one take is voiced in those words now and put where the line is,
   * as the takes panel does, so nothing waits for Sync again. Where the line
   * can't be voiced on its own (no takes bank, or its words already changed),
   * the wording goes into the script and the next Sync voices it.
   */
  const handleApplySyncLine = (unit: SyncUnitReport, text: string) => {
    if (!activeJob || !text.trim()) return;
    const job = activeJob;
    const voicesNow =
      Boolean(job.syncBank?.lines.some((line) => line.key === unit.key) && job.syncBankBlob && job.syncBaseReport) &&
      (!job.syncPendingLines?.includes(unit.key) || rewordedOnly(job, unit.key)) &&
      syncTakesBusy?.jobId !== job.id &&
      syncRunRef.current?.projectId !== job.id;
    if (voicesNow) {
      // An ellipsis typed between words is a pause, as in the takes panel.
      handleVoiceSyncTakes(unit, { direction: 'same', text: dotsToPauses(text.trim()), count: 1 }, { use: true });
      return;
    }
    const ids = unit.cueIds.map(String);
    const cues = activeJob.segments.filter((s) => ids.includes(String(s.id)));
    const texts = distributeLineText(text, cues.map((c) => c.textTarget || c.targetText || ''));
    const byId = new Map(cues.map((c, n) => [String(c.id), texts[n] ?? '']));
    const segments = activeJob.segments.map((s) =>
      byId.has(String(s.id)) ? { ...s, textTarget: byId.get(String(s.id)), targetText: byId.get(String(s.id)) } : s
    );
    updateJob(activeJob.id, { segments, ...syncPendingAfter(activeJob, segments) });
  };

  /**
   * Asks for a new take of synced lines: the next Sync voices each again with
   * its own seed, `takes` times, and keeps the take that fits best. A line
   * locked in Edit timing keeps its take and is skipped.
   */
  const handleRetakeSyncLines = (units: SyncUnitReport[], takes: number) => {
    if (!activeJob) return;
    const keys = units.map((unit) => unit.key).filter((key) => !activeJob.syncEdits?.[key]?.locked);
    if (keys.length === 0) return;
    const seeds = { ...activeJob.syncLineSeeds };
    const counts = { ...activeJob.syncLineTakes };
    for (const key of keys) {
      seeds[key] = Math.floor(Math.random() * 2 ** 31);
      counts[key] = takes;
    }
    updateJob(activeJob.id, {
      syncLineSeeds: seeds,
      syncLineTakes: counts,
      ...pendingForSync(activeJob, keys),
    });
  };

  /**
   * Uses the take Sync offered for a line that ran long (Review: Use new):
   * the next sync voices the line with it, from the cache, so it costs
   * nothing more.
   */
  const handleUseOfferedTake = (unit: SyncUnitReport) => {
    if (!activeJob || !unit.takeFit) return;
    updateJob(activeJob.id, {
      syncTakeChoices: { ...activeJob.syncTakeChoices, [unit.key]: { ...unit.takeFit.choice, text: unit.text } },
      syncDeclinedTakes: (activeJob.syncDeclinedTakes || []).filter((key) => key !== unit.key),
      ...pendingForSync(activeJob, [unit.key]),
    });
  };

  /**
   * Keeps a line's take as it was (Review: Keep old, or Use the first take
   * on one Auto put in): it is not voiced again to fit, and a take put in
   * comes out at the next sync.
   */
  const handleKeepOfferedTake = (unit: SyncUnitReport) => {
    if (!activeJob) return;
    const { [unit.key]: _dropped, ...choices } = activeJob.syncTakeChoices || {};
    updateJob(activeJob.id, {
      syncTakeChoices: choices,
      syncDeclinedTakes: [...new Set([...(activeJob.syncDeclinedTakes || []), unit.key])],
      ...((unit.takeFit?.used || unit.takeChosen) && pendingForSync(activeJob, [unit.key])),
    });
  };

  /**
   * Voices new takes of a synced line now (TakesPanel): the whole line, or
   * only the words picked, read as Sync read it or in a direction. With
   * `text`, the whole line is voiced in new words (pause marks and all); the
   * script takes them only when one of those takes is used. They are added to
   * the line's takes; the dub doesn't change until one is used, unless `use`
   * puts the first of them in the dub at once (Review's Voice and use). A
   * locked line can be retaken: using a take keeps its lock.
   */
  const handleVoiceSyncTakes = async (
    unit: SyncUnitReport,
    { direction, phrase, text, count, stability }: TakeAsk,
    { use = false } = {}
  ) => {
    const job = activeJob;
    if (!job?.syncBank || !job.syncBankBlob || !job.syncBaseReport || syncTakesBusy?.jobId === job.id) return;
    const bank = job.syncBank;
    const base = job.syncBaseReport;
    const line = bank.lines.find((l) => l.key === unit.key);
    const n = base.units.findIndex((u) => u.key === unit.key);
    if (!line || n === -1) return;
    // A line changed since Sync waits for Sync again, unless only its words changed: then its new words are voiced, whole.
    const reworded = rewordedOnly(job, unit.key);
    if (job.syncPendingLines?.includes(unit.key) && (!reworded || phrase)) return;
    if (reworded && !text?.trim()) text = lineTextNow(job.segments, unit.cueIds);
    // New words are a new reading of the whole line: no phrase of the old take, no tags matched to the old words.
    const spoken = text?.trim() && text.trim() !== unit.text ? text.trim() : null;
    if (spoken && phrase) return;
    // Other words typed in place of the picked ones: the line says them there once a take of them is used.
    const say = phrase?.say?.trim() && phrase.say.trim() !== phraseOf(unit.text, phrase.from, phrase.to).words ? phrase.say.trim() : null;
    const resaid = say && phrase ? phraseLine(unit.text, phrase.from, phrase.to, say) : null;
    // The script keeps the words alone: no pause marks, and no tags typed for the voice.
    const words = spoken ? stripTags(stripPauses(spoken)) : resaid ? stripTags(stripPauses(resaid)) : unit.text;
    const typedTags = Boolean((spoken && tagsOf(spoken).length > 0) || (say && tagsOf(say).length > 0));
    setSyncTakesBusy({ jobId: job.id, key: unit.key });
    const controller = new AbortController();
    try {
      // The voice the dub was synced with, as Sync voices it.
      const several = isMultiSpeaker(job.segments);
      const language = job.language || selectedLanguage;
      const tags = !several && expressionTakesTags();
      const expression: VoiceExpression = tags || voiceExpression === 'off' ? voiceExpression : 'neutral';
      let voiceText: string | undefined;
      if (expression === 'natural' && !phrase && !spoken) {
        const tagged = await sourceTaggedSegments(job, language, controller.signal);
        const byId = new Map(tagged.map((segment) => [String(segment.id), segment.textTarget || segment.targetText || '']));
        voiceText = unit.cueIds.map((id) => (byId.get(String(id)) || '').trim()).filter(Boolean).join(' ');
      }
      // A line Sync read with the speaker's pauses is retaken with them too.
      const paused = !spoken && !phrase && !voiceText ? base.units[n].pausedText || null : null;
      // The lines either side, by the same speaker when there are several, as Sync tells the voice about them.
      const neighbour = (step: number) => {
        for (let j = n + step; j >= 0 && j < base.units.length; j += step) {
          if (!several || base.units[j].speaker === unit.speaker) return base.units[j];
        }
        return null;
      };
      const result = await voiceTakes(
        {
          bank,
          bankBlob: job.syncBankBlob,
          line,
          unit: spoken ? { ...base.units[n], text: spoken } : paused ? { ...base.units[n], text: paused } : base.units[n],
          voiceText,
          previousText: neighbour(-1)?.text.slice(-300),
          nextText: neighbour(1)?.text.slice(0, 300),
          readCount: base.units.length,
          phrase,
          lineWords: (() => {
            const current = takesOf(job.syncTakes, line, base.units[n], bank.sampleRate);
            const playing = current.takes.find((t) => t.id === current.active);
            return playing ? knownWords(playing, base.units[n], bank.sampleRate)?.map((w): [number, number] => [w.start, w.end]) : undefined;
          })(),
          direction,
          count: count ?? TAKES_PER_ASK,
          join: base.join,
          // Loudness was evened out when the sync gave any line a gain.
          matchLoudness: !several && bank.lines.some((l) => l.gain !== 1),
          voiceId: elVoiceId,
          modelId: elModelId,
          // Takes come back in the format the bank was voiced in; nothing is resampled.
          outputFormat: bank.outputFormat || 'mp3_44100_128',
          voiceSettings: elVoiceSettings,
          cartesia: cartesiaForExpression(cartesiaVoice, expression),
          language,
          tuneStability,
          steady: expression === 'neutral',
          expressive: expression === 'expressive',
          ownTags: typedTags,
          stability,
          multiSpeaker: several,
          cast: job.cast,
        },
        { apiKey: elApiKey, signal: controller.signal }
      );
      // A speaker changed into another voice gets the takes in it too, each at its own length.
      const changedVoice = changedVoiceOf(job, line.speaker);
      let voicedTakes = result;
      let voiceError: unknown = null;
      if (changedVoice) {
        try {
          const changed = await voiceChangeTakes(
            { bank: { ...bank, bankId: result.bankId }, bankBlob: result.bankBlob, takes: result.takes, voice: changedVoice },
            { apiKey: elApiKey, signal: controller.signal }
          );
          voicedTakes = { bankId: changed.bank.bankId, bankBlob: changed.bankBlob, takes: changed.takes };
        } catch (err: any) {
          if (controller.signal.aborted || err?.code === 'cancelled') throw err;
          voiceError = err;
        }
      }
      // A Sync that finished meanwhile made a new bank: these takes belong to the old one.
      const now = queueRef.current.find((j) => j.id === job.id);
      if (!now?.syncBank || now.syncBank.bankId !== bank.bankId) return;
      const nowLine = now.syncBank.lines.find((l) => l.key === unit.key) || line;
      const kept = takesOf(now.syncTakes, nowLine, base.units[n], now.syncBank.sampleRate);
      // A take keeps the words the script takes from it, and what the voice read, pauses and all.
      const added = voicedTakes.takes.map((take: SyncTake) =>
        spoken ? { ...take, text: words, spoken } : resaid ? { ...take, text: words, spoken: resaid } : paused ? { ...take, text: base.units[n].text, spoken: paused } : take
      );
      const voiced: BatchJob = {
        ...now,
        syncBank: { ...now.syncBank, bankId: voicedTakes.bankId },
        syncBankBlob: voicedTakes.bankBlob,
        syncTakes: { ...(now.syncTakes || {}), [unit.key]: { takes: [...kept.takes, ...added], active: kept.active } },
      };
      const put = use && added[0] ? takeInDub(voiced, unit.key, added[0].id) : null;
      updateJob(job.id, {
        syncBank: voiced.syncBank,
        syncBankBlob: voiced.syncBankBlob,
        syncTakes: voiced.syncTakes,
        ...put?.updates,
      });
      if (put) {
        scheduleSyncEditRender(job.id, put.render, 0);
        if (!put.placed) void placeUsedTake({ ...voiced, ...put.updates }, unit.key, added[0].id, now);
      }
      refreshQuota();
      if (voiceError && changedVoice) {
        reportError(voiceError, {
          title: `The new takes could not be changed into ${changedVoice.name}`,
          safe: 'They are kept in the dub voice. Change voice on a take tries again.',
        });
      }
    } catch (err: any) {
      if (controller.signal.aborted || err?.code === 'cancelled') return;
      console.error('Takes error:', err);
      reportError(err, { title: 'The takes could not be voiced', safe: 'The takes this line already had are kept.' });
    } finally {
      setSyncTakesBusy((busy) => (busy?.jobId === job.id ? null : busy));
    }
  };

  /**
   * Puts one of a line's takes in the dub, where the line is now, and renders
   * the dub with it. A take voiced in other words puts those words in the
   * script and the report too, so the line isn't left waiting for Sync. A
   * locked line stays locked.
   */
  const handleUseSyncTake = (key: string, takeId: string, copy?: string) => {
    const job = activeJob;
    if (!job || syncTakesBusy?.jobId === job.id) return;
    if (copy) {
      void putTakeOnCopy(job, key, takeId, copy);
      return;
    }
    const put = takeInDub(job, key, takeId);
    if (!put) return;
    updateJob(job.id, put.updates);
    scheduleSyncEditRender(job.id, put.render, 0);
    if (!put.placed) void placeUsedTake({ ...job, ...put.updates }, key, takeId, job);
  };

  /**
   * A take on one Alt + drag copy of a line (Edit timing, the copy picked):
   * only the copy plays it, cut at the words it had, its first word where it
   * was (takeOnCopy); the line keeps its take. Words not known yet are timed
   * by forced alignment first; if that fails the copy plays the whole take.
   */
  const putTakeOnCopy = async (job: BatchJob, key: string, takeId: string, copyId: string) => {
    const bank = job.syncBank;
    const base = job.syncBaseReport;
    if (!bank || !base) return;
    const rate = bank.sampleRate;
    const line = bank.lines.find((l) => l.key === key);
    const n = base.units.findIndex((u) => u.key === key);
    const unit = base.units[n];
    const copy = job.syncEdits?.[key]?.parts.find((part) => part.copy && part.id === copyId);
    if (!line || !unit || !copy) return;
    const list = takesOf(job.syncTakes, line, unit, rate);
    const take = list.takes.find((t) => t.id === takeId);
    if (!take) return;
    const played = partLine(line, copy);
    // What the copy plays now: a take of its own, or the line's.
    const oldTake = list.takes.find((t) => (copy.audio ? t.bankStart === copy.audio.bankStart && t.length === copy.audio.length : t.id === list.active));
    if (copy.audio && oldTake?.id === takeId) return;
    let oldWords = oldTake ? knownWords(oldTake, unit, rate) : null;
    let newWords = knownWords(take, unit, rate);
    const oldText = oldTake?.text ?? unit.text;
    const pairs = sayWords(oldText).length > 0 && sayWords(oldText).length === sayWords(take.text).length;
    if (pairs && (!oldWords || !newWords) && job.syncBankBlob) {
      const spoken = <W extends { text: string }>(words: W[]) => words.filter((w) => /[\p{L}\p{N}]/u.test(w.text));
      try {
        oldWords ??= spoken(await alignTakeWords(bank, job.syncBankBlob, played, oldText, { apiKey: elApiKey }));
        newWords ??= spoken(await alignTakeWords(bank, job.syncBankBlob, { ...line, bankStart: take.bankStart, length: take.length }, take.text, { apiKey: elApiKey }));
      } catch (err: any) {
        if (err?.code === 'cancelled') return;
        console.warn('The words of the copy could not be timed; it plays the whole take:', err);
      }
    }
    const part = takeOnCopy({
      key,
      copy,
      take,
      sampleRate: rate,
      firstWord: spokenSpan(line, [copy])?.start ?? copy.start,
      oldWords: pairs ? oldWords : null,
      newWords: pairs ? newWords : null,
    });
    // Anything done meanwhile stays: the copy must still be there, in the same bank.
    const now = queueRef.current.find((j) => j.id === job.id);
    const parts = now?.syncEdits?.[key]?.parts;
    if (!now?.syncBank || !now.syncBaseReport || now.syncBank.bankId !== bank.bankId || !parts?.some((p) => p.id === copyId)) return;
    const edits: SyncEdits = { ...now.syncEdits, [key]: { ...now.syncEdits![key], parts: parts.map((p) => (p.id === copyId ? part : p)) } };
    updateJob(job.id, { syncEdits: edits, syncReport: measureEdits(now.syncBaseReport, now.syncBank, edits) }, { label: `Line ${n + 1}: copy retaken` });
    scheduleSyncEditRender(
      job.id,
      { bank: now.syncBank, bankBlob: now.syncBankBlob, baseReport: now.syncBaseReport, edits, sourceDuration: sourceDurationOf(now), source: now.audioBuffer },
      0
    );
  };

  /**
   * A take just put in the dub goes in whole first, so it is heard at once,
   * its first word where the line's was. Then, as a step of its own in the
   * history (Undo puts it back whole), as the Retake window says:
   * - Where the old parts were (fitTakeToParts): a line the user had in
   *   parts is cut at the same words, never inside one, and each part plays
   *   its first word where the old part's did, with its gain and fades. Its
   *   words and the old take's are timed by forced alignment.
   * - Like Sync (server/lib/placeTake.js), and where the words don't pair up:
   *   with Chunk sync, cut and placed as Sync places a line.
   * The lines either side stay where they are. `job` is the project with the
   * take just put in (the queue catches up a render later), `before` as it was.
   */
  const placeUsedTake = async (job: BatchJob, key: string, takeId: string, before: BatchJob) => {
    const jobId = job.id;
    const bank = job.syncBank;
    const base = job.syncBaseReport;
    const take = job.syncTakes?.[key]?.takes.find((t) => t.id === takeId);
    if (!bank || !base || !job.syncBankBlob || !take) return;
    if (take.chunks?.length || job.syncPendingLines?.includes(key)) return;
    const n = base.units.findIndex((u) => u.key === key);
    if (n === -1) return;
    // Where the lines either side play now, in timeline seconds.
    const prev = lineSpanIn(bank, job.syncEdits, base.units[n - 1]?.key);
    const next = lineSpanIn(bank, job.syncEdits, base.units[n + 1]?.key);
    /** The project now, while the line still plays that take as it went in: anything done to it meanwhile is the user's. */
    const stillAsPut = () => {
      const now = queueRef.current.find((j) => j.id === jobId);
      return now?.syncBank && now.syncBaseReport && now.syncBank.bankId === bank.bankId && now.syncTakes?.[key]?.active === takeId ? now : null;
    };

    // The old take's parts, and its words: the take before this one, as the line played it.
    const oldLine = before.syncBank?.lines.find((l) => l.key === key) ?? null;
    const oldParts = oldLine && before.syncBank ? partsOf(before.syncEdits, oldLine, before.syncBank.sampleRate).filter((part) => !part.copy) : [];
    const oldKept = before.syncTakes?.[key];
    const oldText = oldKept?.takes.find((t) => t.id === oldKept.active)?.text ?? before.syncBaseReport?.units.find((u) => u.key === key)?.text ?? '';
    const count = (text: string) => sayWords(text).length;
    const pairs = count(oldText) > 0 && count(oldText) === count(take.text);
    // Like Sync needs a dub Chunk sync placed; without one a used take goes where the old parts were.
    const placement = readRetakePlacement() === 'sync' && base.join?.chunkSync ? 'sync' : 'old';
    if (placement === 'old' && oldLine && oldParts.length >= 2 && pairs) {
      try {
        // The old take's samples are still in this bank: a bank only grows.
        // Words already known (kept with a take, or Sync's own alignment) are not aligned again.
        const spoken = <W extends { text: string }>(words: W[]) => words.filter((w) => /[\p{L}\p{N}]/u.test(w.text));
        const oldTake = oldKept?.takes.find((t) => t.id === oldKept.active);
        const oldUnit = before.syncBaseReport?.units.find((u) => u.key === key);
        const oldWords = (oldTake && knownWords(oldTake, oldUnit, bank.sampleRate)) ?? spoken(await alignTakeWords(bank, job.syncBankBlob, oldLine, oldText, { apiKey: elApiKey }));
        const newLine = bank.lines.find((l) => l.key === key);
        if (!newLine) return;
        const newWords = knownWords(take, base.units[n], bank.sampleRate) ?? spoken(await alignTakeWords(bank, job.syncBankBlob, newLine, take.text, { apiKey: elApiKey }));
        const fit = fitTakeToParts({ key, oldParts, oldWords, newWords, takeSeconds: take.length / bank.sampleRate, prevEnd: prev?.end ?? null, nextStart: next?.start ?? null, cuts: take.gaps });
        const now = stillAsPut();
        if (!fit || !now?.syncBank || !now.syncBaseReport || now.syncEdits?.[key] !== job.syncEdits?.[key]) return;
        // Copies keep what they play (putTake gave them their own samples).
        const copies = now.syncEdits?.[key]?.parts.filter((part) => part.copy) ?? [];
        const edits: SyncEdits = { ...(now.syncEdits ?? {}), [key]: { locked: Boolean(now.syncEdits?.[key]?.locked), parts: [...fit.parts, ...copies] } };
        // The words go with the takes, so neither is aligned again.
        const pairs = (words: { start: number; end: number }[]): [number, number][] => words.map((w) => [w.start, w.end]);
        const nowKept = now.syncTakes?.[key];
        const syncTakes = nowKept
          ? {
              ...now.syncTakes,
              [key]: {
                ...nowKept,
                takes: nowKept.takes.map((t) =>
                  t.id === takeId && !t.words?.length ? { ...t, words: pairs(newWords) } : t.id === oldTake?.id && !t.words?.length ? { ...t, words: pairs(oldWords) } : t
                ),
              },
            }
          : now.syncTakes;
        updateJob(jobId, { syncEdits: edits, syncReport: measureEdits(now.syncBaseReport, now.syncBank, edits), syncTakes }, { label: `Line ${n + 1}: take placed where the old parts were` });
        scheduleSyncEditRender(
          jobId,
          { bank: now.syncBank, bankBlob: now.syncBankBlob, baseReport: now.syncBaseReport, edits, sourceDuration: sourceDurationOf(now), source: now.audioBuffer },
          0
        );
      } catch (err: any) {
        if (err?.code === 'cancelled') return;
        reportError(err, { title: 'The take could not be cut at the old parts', safe: "It plays whole, its first word where the line's was. Undo puts the old take back." });
      }
      return;
    }
    // A line that was one part stays whole, its first word where it was; Like Sync is for when asked, or the words don't pair up.
    if (placement === 'old' && pairs) return;
    if (!base.join?.chunkSync || job.syncEdits?.[key]?.locked) return;
    try {
      const placed = await placeTakeLikeSync(
        {
          bank,
          bankBlob: job.syncBankBlob,
          key,
          take,
          segments: job.segments,
          join: base.join,
          tolerance: base.tolerance,
          timingProtection: base.timingProtection,
          sourceDuration: sourceDurationOf(job),
          multiSpeaker: isMultiSpeaker(job.segments),
          prev,
          next,
        },
        { apiKey: elApiKey }
      );
      const now = stillAsPut();
      if (!now?.syncBank || !now.syncBaseReport) return;
      const placedLine = placeTakeChunks({ bank: now.syncBank, edits: now.syncEdits, baseReport: now.syncBaseReport, key, take, chunks: placed.chunks });
      if (!placedLine) return;
      updateJob(
        jobId,
        { syncBank: placedLine.bank, syncEdits: placedLine.edits, syncBaseReport: placedLine.baseReport, syncReport: measureEdits(placedLine.baseReport, placedLine.bank, placedLine.edits) },
        { label: `Line ${n + 1}: take cut and placed like Sync` }
      );
      scheduleSyncEditRender(
        jobId,
        { bank: placedLine.bank, bankBlob: now.syncBankBlob, baseReport: placedLine.baseReport, edits: placedLine.edits, sourceDuration: sourceDurationOf(now), source: now.audioBuffer },
        0
      );
    } catch (err: any) {
      if (err?.code === 'cancelled') return;
      reportError(err, { title: 'The take could not be cut and placed like Sync', safe: 'It plays whole, where the line was. Undo or Sync again as usual.' });
    }
  };

  /**
   * What putting one of a line's takes in the dub changes in `job`, and the
   * render that follows; null when the take can't go in (already in, gone,
   * or the line's words changed since Sync).
   */
  const takeInDub = (job: BatchJob, key: string, takeId: string) => {
    const kept = job.syncTakes?.[key];
    const take = kept?.takes.find((t) => t.id === takeId);
    if (!job.syncBank || !job.syncBaseReport || !kept || !take || kept.active === takeId) return null;
    const line = job.syncBank.lines.find(l => l.key === key);
    const unit = job.syncBaseReport.units.find((u) => u.key === key);
    // A line that changed since Sync takes no take, unless only its words changed: a take puts it back in step.
    const reworded = rewordedOnly(job, key);
    if (!line || !unit || (job.syncPendingLines?.includes(key) && !reworded)) return null;
    const put = putTake({ bank: job.syncBank, edits: job.syncEdits, baseReport: job.syncBaseReport, key, take });
    const { bank } = put;
    let { edits } = put;
    // Where the old parts were, at once, when both takes' words are known: no alignment, one step, one render.
    let placed = false;
    const rate = job.syncBank.sampleRate;
    if (readRetakePlacement() !== 'sync' || !job.syncBaseReport.join?.chunkSync) {
      const oldList = takesOf(job.syncTakes, line, unit, rate);
      const oldTake = oldList.takes.find((t) => t.id === oldList.active);
      const oldParts = partsOf(job.syncEdits, line, rate).filter((part) => !part.copy);
      const oldWords = oldTake ? knownWords(oldTake, unit, rate) : null;
      const newWords = knownWords(take, unit, rate);
      const n = job.syncBaseReport.units.findIndex((u) => u.key === key);
      if (oldParts.length >= 2 && oldWords && newWords) {
        const fit = fitTakeToParts({
          key,
          oldParts,
          oldWords,
          newWords,
          takeSeconds: take.length / rate,
          prevEnd: lineSpanIn(job.syncBank, job.syncEdits, job.syncBaseReport.units[n - 1]?.key)?.end ?? null,
          nextStart: lineSpanIn(job.syncBank, job.syncEdits, job.syncBaseReport.units[n + 1]?.key)?.start ?? null,
          cuts: take.gaps,
        });
        if (fit) {
          // Copies keep what they play (putTake gave them their own samples).
          const copies = edits?.[key]?.parts.filter((part) => part.copy) ?? [];
          edits = { ...(edits ?? {}), [key]: { locked: Boolean(edits?.[key]?.locked), parts: [...fit.parts, ...copies] } };
          placed = true;
        }
      }
    }
    const otherWords = take.text !== unit.text;
    const baseReport = otherWords ? { ...put.baseReport, units: put.baseReport.units.map((u) => (u.key === key ? { ...u, text: take.text } : u)) } : put.baseReport;
    let segments = job.segments;
    // The script already says a take voiced in its new words: its cues keep their words as typed.
    if (otherWords && take.text !== lineTextNow(job.segments, unit.cueIds)) {
      const ids = unit.cueIds.map(String);
      const cues = job.segments.filter((s) => ids.includes(String(s.id)));
      const texts = distributeLineText(take.text, cues.map((c) => c.textTarget || c.targetText || ''));
      const byId = new Map(cues.map((c, i) => [String(c.id), texts[i] ?? '']));
      segments = job.segments.map((s) => (byId.has(String(s.id)) ? { ...s, textTarget: byId.get(String(s.id)), targetText: byId.get(String(s.id)) } : s));
    }
    // Back in step with the dub: nothing waits for Sync again on this line, not even a retake asked in Review.
    const drop = <T,>(record: Record<string, T> | null | undefined) => {
      if (!record || !(key in record)) return record;
      const { [key]: _gone, ...rest } = record;
      return Object.keys(rest).length > 0 ? rest : null;
    };
    const inStep: Partial<BatchJob> = reworded
      ? {
          ...notPending(job, key),
          syncLineSeeds: drop(job.syncLineSeeds),
          syncLineTakes: drop(job.syncLineTakes),
          syncTakeChoices: drop(job.syncTakeChoices),
          syncDeclinedTakes: job.syncDeclinedTakes?.filter((k) => k !== key) ?? null,
        }
      : {};
    const updates: Partial<BatchJob> = {
      ...(segments !== job.segments && { segments }),
      ...inStep,
      syncBank: bank,
      syncEdits: edits,
      syncBaseReport: baseReport,
      syncReport: measureEdits(baseReport, bank, edits),
      syncTakes: { ...job.syncTakes, [key]: { ...kept, active: takeId } },
    };
    const render = { bank, bankBlob: job.syncBankBlob, baseReport, edits, sourceDuration: sourceDurationOf(job), source: job.audioBuffer };
    return { updates, render, placed };
  };

  /**
   * Clear takes, in the takes panel: the line keeps Sync's own take and the
   * one in the dub, and the rest leave its list. Their samples stay in the
   * bank, which only grows; the dub is not changed.
   */
  const handleClearSyncTakes = (key: string) => {
    const job = activeJob;
    const kept = job?.syncTakes?.[key];
    if (!job || !kept || syncTakesBusy?.jobId === job.id) return;
    const takes = kept.takes.filter((take) => take.id === SYNC_TAKE_ID || take.id === kept.active);
    if (takes.length === kept.takes.length) return;
    updateJob(job.id, { syncTakes: { ...job.syncTakes, [key]: { ...kept, takes } } });
  };

  /** Cancel, on the open project: its dub stops, or one waiting its turn comes out of the line. */
  const handleCancelSync = () => {
    const projectId = activeJob?.id;
    if (!projectId) return;
    if (dubQueue.some((dub) => dub.jobId === projectId)) {
      setDubQueue((waiting) => waiting.filter((dub) => dub.jobId !== projectId));
      // Sync changed lines only, taken out before it started: the lines it held are let go again.
      const held = activeJob.syncHeldLines || [];
      if (held.length > 0 && activeJob.syncBank) updateJob(projectId, { syncEdits: releaseLines(activeJob.syncEdits, held, activeJob.syncBank), syncHeldLines: null });
      return;
    }
    const run = syncRunRef.current;
    if (!run || run.projectId !== projectId) return;
    setIsCancellingSync(true);
    if (run.readJobId) cancelDub(run.readJobId).catch(() => {});
    cancelSync(run.jobId)
      .catch(() => {})
      .finally(() => run.controller.abort());
  };

  // The next dub waiting starts as soon as none is running; one for a project deleted meanwhile is dropped.
  useEffect(() => {
    if (syncingJobId || syncRunRef.current || dubQueue.length === 0) return;
    const [next, ...rest] = dubQueue;
    setDubQueue(rest);
    runSyncDub(next.jobId, next.options, next.voice, { fresh: next.fresh });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncingJobId, dubQueue]);

  // Segment Text Update Handler
  const handleUpdateSegment = useCallback(
    (id: string | number, updates: Partial<AudioSegment>) => {
      if (!activeJob) return;
      updateJobWith(activeJob.id, (job) =>
        withReviewStep(job, job.segments.map((s) => (s.id === id ? { ...s, ...updates } : s)))
      );
    },
    [activeJob, updateJobWith]
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
      updateJobWith(activeJob.id, (job) => withReviewStep(job, segments));
    },
    [activeJob, updateJobWith]
  );

  /**
   * The project as it was at step `index` of its history: the script, and the
   * dub with its lines, takes, edits and voice changes, rendered again from
   * its bank (nothing is voiced again). A step of another Sync takes that
   * Sync's kept bank; a step whose Sync was let go puts back only the script.
   */
  const goToHistoryStep = async (jobId: string, index: number) => {
    const job = queueRef.current.find((j) => j.id === jobId);
    if (!job) return;
    if (syncRunRef.current?.projectId === jobId || dubQueue.some((dub) => dub.jobId === jobId) || syncTakesBusy?.jobId === jobId || WORKING.has(job.status)) {
      reportError(new Error('Wait for the dub to finish, then undo.'), { title: 'Undo waits for the dub', safe: 'Nothing was changed.' });
      return;
    }
    const current = historyStateOf(job);
    const start = projectHistoryOf(job);
    if (!start) return;
    const history = catchUpProject(start, { ...current, syncEpoch: syncIdOf(job) });
    const target = moveTo(history, index === -1 ? history.at - 1 : index === -2 ? history.at + 1 : index);
    if (!target) return;
    const { state, scriptOnly } = stateAt(target);
    const scriptBack = (notice?: string) => {
      const segments = (state.segments || []) as AudioSegment[];
      updateJob(jobId, { projectHistory: target, segments, ...syncPendingAfter(job, segments) });
      if (notice) reportError(new Error(notice), { title: 'Only the script came back', safe: 'The dub stays as it is now.' });
    };
    if (scriptOnly) return scriptBack();

    // The bank the step's lines play from: this Sync's, or one kept for an earlier one.
    const epoch = state.syncEpoch ?? null;
    const sameSync = epoch === syncIdOf(job);
    let bankBlob = job.syncBankBlob ?? null;
    let bankId = job.syncBank?.bankId ?? newSyncId();
    let file: Blob | null = sameSync && !job.syncBank ? job.syncedBlob ?? null : null;
    if (!sameSync && epoch) {
      const kept = await getHistoryBank(jobId, epoch).catch(() => null);
      if (!kept) return scriptBack('The audio of that Sync is no longer kept, so only the script went back.');
      if (kept.kind === 'bank') {
        bankBlob = kept.blob;
        // The server has another bank under the id now: this one is sent under a new id when it is needed.
        bankId = newSyncId();
      } else file = kept.blob;
    }
    // A change made while the bank was read wins: undo again from there.
    const now = queueRef.current.find((j) => j.id === jobId);
    if (!now || now.projectHistory !== job.projectHistory || now.segments !== job.segments || now.syncBank !== job.syncBank) return;

    cancelSyncEditRender(jobId);
    const bank = state.syncBank ? { ...state.syncBank, bankId } : null;
    const base = state.syncBaseReport ?? null;
    const edits = state.syncEdits && hasEdits(state.syncEdits) ? state.syncEdits : null;
    const previousUrl = now.syncedAudioUrl;
    const fileUrl = !bank && file ? URL.createObjectURL(file) : null;
    updateJob(jobId, {
      ...state,
      projectHistory: target,
      syncBank: bank,
      syncBankBlob: bank ? bankBlob : null,
      syncReport: bank && base ? (edits ? measureEdits(base, bank, edits) : base) : sameSync ? now.syncReport ?? null : null,
      ...(!bank && {
        // No bank: the dub is the voice changer's file, or there is no dub yet at that step.
        syncedBlob: file,
        syncedAudioUrl: fileUrl,
        syncedAudioBuffer: null,
        ...(!file && { syncedStems: null, syncMix: null }),
      }),
    });
    if (bank && base) {
      scheduleSyncEditRender(jobId, { bank, bankBlob, baseReport: base, edits, sourceDuration: sourceDurationOf(now), source: now.audioBuffer }, 0);
    } else {
      setSyncEditStatus(jobId, { state: 'ready' });
      if (fileUrl && file) {
        decodeAudioBlobUrl(fileUrl)
          .then((buffer) => {
            if (syncedUrlOf(jobId) === fileUrl) updateJob(jobId, { syncedAudioBuffer: buffer });
          })
          .catch(console.warn);
      }
      if (previousUrl && previousUrl !== fileUrl) window.setTimeout(() => URL.revokeObjectURL(previousUrl), 5000);
    }
  };

  /** The open project's history as the Undo buttons and History lists show it. */
  const activeHistory = useMemo(
    () => (activeJob ? projectHistoryOf(activeJob) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeJob?.projectHistory, activeJob?.reviewHistory]
  );
  const activeJobIdForHistory = activeJob?.id;
  const projectHistoryView = useMemo(
    () =>
      activeHistory && activeJobIdForHistory
        ? { entries: historyEntries(activeHistory), at: activeHistory.at, labels: historyLabels(activeHistory), goTo: (index: number) => void goToHistoryStepRef.current(activeJobIdForHistory, index) }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeHistory, activeJobIdForHistory]
  );

  // Undo from a callback made earlier still runs with what the app has now.
  const goToHistoryStepRef = useRef(goToHistoryStep);
  goToHistoryStepRef.current = goToHistoryStep;

  /** Undo, Redo, or the script back where Review's undo stops, as one step that can be undone too. */
  const handleReviewHistory = useCallback(
    (action: 'undo' | 'redo' | 'base') => {
      if (!activeJob) return;
      if (action === 'undo') return void goToHistoryStepRef.current(activeJob.id, -1);
      if (action === 'redo') return void goToHistoryStepRef.current(activeJob.id, -2);
      const history = activeJob.reviewHistory;
      const label = reviewHistoryLabels(history).base;
      updateJobWith(
        activeJob.id,
        (job) => {
          const result = job.reviewHistory ? backToFirstStep(job.reviewHistory, job.segments) : null;
          if (!result) return {};
          return { segments: result.segments, reviewHistory: result.history, ...syncPendingAfter(job, result.segments) };
        },
        label ? { label: `Back to ${label}` } : {}
      );
    },
    [activeJob, updateJobWith]
  );

  /**
   * Puts a cut made on the transcript screen on the project. The cut as
   * transcribed is kept from the first change, for Reset; once the cut is
   * back to it, there is nothing to keep.
   */
  const handleApplyTranscriptSegments = useCallback(
    (segments: AudioSegment[]) => {
      if (!activeJob) return;
      const transcribed = activeJob.transcriptCuts ?? activeJob.segments;
      updateJob(activeJob.id, {
        segments,
        transcriptCuts: sameCuts(transcribed, segments) ? null : transcribed,
        ...syncPendingAfter(activeJob, segments),
      });
    },
    [activeJob, updateJob]
  );

  /** Saves the open project's transcript as Dhvani JSON, paragraphs or subtitles. Never transcribes or translates. */
  const handleExportTranscript = useCallback(
    async (format: TranscriptFormat): Promise<TranscriptExportResult> => {
      const job = activeJob;
      if (!job) return { status: 'cancelled' };
      const name = projectName(job);
      let outcome;
      if (format === 'srt') {
        const srt = transcriptSrt(job.segments);
        if (srt.kind === 'blocked') return { status: 'blocked', problems: srt.problems };
        outcome = await saveFileAs(new Blob([srt.content], { type: 'application/x-subrip;charset=utf-8' }), transcriptFileName(name, '.srt'), {
          description: 'Subtitles',
          mime: 'application/x-subrip',
          extension: '.srt',
        });
      } else if (format === 'txt') {
        const text = transcriptParagraphs(job.segments, loadPassagePause());
        outcome = await saveFileAs(new Blob([text], { type: 'text/plain;charset=utf-8' }), transcriptFileName(name, '.txt'), {
          description: 'Text',
          mime: 'text/plain',
          extension: '.txt',
        });
      } else {
        const json = exportProjectJson(job, signoffsForJob(job.id));
        outcome = await saveFileAs(new Blob([json], { type: 'application/json' }), projectJsonFileName(name), {
          description: 'Dhvani JSON',
          mime: 'application/json',
          extension: '.json',
        });
      }
      return outcome.status === 'cancelled' ? outcome : { ...outcome, format };
    },
    [activeJob]
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

  /** The dub to save: the synced dub, else a dub made before Dub and Sync were one step. */
  const masterDubFile = useCallback((): { file: Blob; name: string } | null => {
    if (!activeJob) return null;
    const blob = playsSynced ? activeJob.syncedBlob : activeJob.synthesizedBlob;
    const buffer = playsSynced ? activeJob.syncedAudioBuffer : activeJob.synthAudioBuffer;
    const file = blob || (buffer ? audioBufferToWav(buffer) : null);
    return file && { file, name: projectFileStem(activeJob) };
  }, [activeJob, playsSynced]);

  // Download Master Lossless WAV
  const handleDownloadMasterWav = useCallback(() => {
    const dub = masterDubFile();
    if (dub) saveAudioFile(dub.file, `${dub.name}.${audioFileExtension(dub.file)}`);
  }, [masterDubFile]);

  /**
   * Saves the dub with the tracks of outside audio mixed in, rendered now at
   * the dub's own rate as a 32-bit float WAV, so nothing clips and nothing is
   * turned down. The synced dub's own file stays the dub alone. As MP3, that
   * WAV is encoded at 320 kbps, its rate and channels kept.
   */
  const handleDownloadWithTracks = useCallback(async (format: 'wav' | 'mp3' = 'wav') => {
    const job = activeJob;
    if (!job?.syncBank || !job.syncBaseReport || !job.syncAudioTracks?.length) return;
    const mp3 = format === 'mp3';
    try {
      const { blob } = await renderSyncEdits({
        bank: withSpeakerLevels(job.syncBank, job.syncSpeakerLevels),
        bankBlob: job.syncBankBlob,
        edits: job.syncEdits || null,
        report: job.syncBaseReport,
        sourceDuration: sourceDurationOf(job),
        source: job.audioBuffer,
        tracks: { tracks: job.syncAudioTracks, files: trackFiles, buffers: trackBuffersRef.current },
      });
      const file = mp3 && audioFileExtension(blob) !== 'mp3' ? await apiPostBlobAudio('/audio/mp3', blob) : blob;
      saveAudioFile(file, `${projectFileStem(job)} - dub and tracks.${mp3 ? 'mp3' : audioFileExtension(file)}`);
    } catch (err) {
      reportError(err, {
        title: mp3 ? 'Saving the dub with its tracks as MP3 failed' : 'Saving the dub with its tracks failed',
        safe: mp3
          ? 'The dub and the tracks are unchanged; the WAV of Dub + tracks still works.'
          : 'The dub and the tracks are unchanged; Download WAV still saves the dub alone.',
      });
    }
  }, [activeJob, trackFiles]);

  /** Saves the dub as MP3. The dub stays WAV; only the saved copy is encoded. */
  const handleDownloadMasterMp3 = useCallback(async () => {
    const dub = masterDubFile();
    if (!dub) return;
    try {
      const mp3 = audioFileExtension(dub.file) === 'mp3' ? dub.file : await apiPostBlobAudio('/audio/mp3', dub.file);
      saveAudioFile(mp3, `${dub.name}.mp3`);
    } catch (err) {
      reportError(err, { title: 'Saving the dub as MP3 failed', safe: 'The dub is unchanged; Download WAV still works.' });
    }
  }, [masterDubFile]);

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
      a.download = `${activeJob ? projectFileStem(activeJob) : 'Untitled dub'} - ${speaker.replace(/[^\p{L}\p{N}]+/gu, '_')}.${audioFileExtension(stem.blob)}`;
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
    a.download = `${projectFileStem(activeJob)}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeJob]);

  // Download Targeted Language Script
  const handleDownloadMasterScript = useCallback(
    (format: TargetScriptFormat = 'dialogue', lines?: AudioSegment[]) => {
      if (!activeJob || !activeJob.segments || activeJob.segments.length === 0) return;
      const targetLang = activeJob.language || selectedLanguage || 'Target Language';
      const scriptContent = generateTargetLanguageScript(
        lines ?? activeJob.segments,
        targetLang,
        format,
        activeJob.file?.name ? `Dhvani Dub - ${activeJob.file.name}` : undefined,
        {
          sourceLanguage: activeJob.detectedLanguage || activeJob.sourceLanguage || undefined,
          fileName: activeJob.file?.name,
          audioDuration: activeJob.audioBuffer?.duration,
        }
      );
      const name = projectFileStem(activeJob);
      if (format === 'json') {
        downloadFile(scriptContent, `${name} - script.json`, 'application/json');
        return;
      }
      const ext = format === 'csv' ? 'csv' : 'txt';
      const mime = format === 'csv' ? 'text/csv' : 'text/plain;charset=utf-8';
      downloadFile(scriptContent, `${name} - script ${format}.${ext}`, mime);
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

  /**
   * Saves a project, with its media, edits and takes, as one .dhvani file to
   * open again later or elsewhere. `light`: without the original media, the
   * takes not playing and the undo history.
   */
  const handleExportProject = useCallback(async (id: string, { light = false }: { light?: boolean } = {}) => {
    const job = queueRef.current.find((j) => j.id === id);
    if (!job) return;
    try {
      // The banks of earlier Syncs, so Undo can go back past them in the opened project too.
      const historyBanks = light ? [] : await getHistoryBanks(id).catch(() => []);
      // The review video goes with a full project, not a light one.
      const reviewVideo = light ? null : await getReviewVideo(id).catch(() => null);
      const blob = await exportProject(job, signoffsForJob(id), { light, historyBanks, reviewVideo });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = projectFileName(light ? `${projectName(job)} (light)` : projectName(job));
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // A large file is still being written when click returns.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      reportError(err, { title: 'Exporting the project failed', safe: 'The project is unchanged.' });
    }
  }, []);

  /** Reads the media picked for a Dhvani JSON: its length, and the buffer the project plays. */
  const measureProjectMedia = useCallback(async (file: File) => {
    const analysis = await analyzeAudio(file);
    pickedMediaRef.current = { file, analysis };
    return analysis.buffer.duration;
  }, []);

  /** Makes the project from a Dhvani JSON and the media picked for it, and opens it on Review. */
  const openProjectJson = useCallback(
    async (file: File) => {
      const pending = pendingProjectJson;
      if (!pending) return;
      const analysis = pickedMediaRef.current?.file === file ? pickedMediaRef.current.analysis : await analyzeAudio(file);
      const { project } = pending;
      // A light project: the project as it was, with the original picked again.
      const job = pending.job
        ? reviveSavedJob({ ...pending.job, id: pending.id, file, audioMetadata: analysis.metadata, audioBuffer: analysis.buffer })
        : reviveSavedJob({
            id: pending.id,
            createdAt: project.createdAt ?? Date.now(),
            updatedAt: Date.now(),
            file,
            status: ProcessingStatus.IDLE,
            script: '',
            language: selectedLanguage,
            manualDuration: '',
            expression: 'Warm, conversational studio tone',
            pronunciations: [],
            history: { past: [], future: [] },
            xmlOutput: '',
            validationResult: null,
            synthesizedAudioUrl: null,
            synthesizedBlob: null,
            srtUrl: null,
            srtBlob: null,
            synthAudioBuffer: null,
            errorMsg: null,
            ...project,
            audioMetadata: analysis.metadata,
            audioBuffer: analysis.buffer,
            segments: project.segments,
            lastStep: hasTranscript(project.segments) ? 2 : 1,
            scriptOrigin: pending.projectId || null,
            scriptBase: project.segments,
          });
      await saveJobToStorage(job);
      addSignoffs(pending.signoffs);
      pickedMediaRef.current = null;
      setPendingProjectJson(null);
      pauseAll();
      seekAll(0);
      setQueue((prev) => [job, ...prev.filter((j) => j.id !== job.id)].sort(byNewest));
      setActiveJobId(job.id);
    },
    [pendingProjectJson, selectedLanguage, pauseAll, seekAll]
  );

  /** Opens a .dhvani file as a new project, beside the ones here, and switches to it. */
  const handleImportProject = useCallback(
    async (file: File) => {
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).substring(2, 9);
      try {
        if (await isProjectJson(file)) {
          // No media inside: the user picks the original before the project is made.
          const { project, signoffs, sourceMedia, projectId } = readProjectJson(await file.text(), id);
          const read = { id, fileName: file.name, project, signoffs, sourceMedia, projectId };
          // A newer script for a project opened from this one's file goes on it (Update script), the open one first.
          const jobs = queueRef.current;
          const target = projectId
            ? (jobs.find((j) => j.id === activeJobId && j.scriptOrigin === projectId) ?? jobs.find((j) => j.scriptOrigin === projectId))
            : undefined;
          if (target) setPendingScriptUpdate({ ...read, jobId: target.id });
          else setPendingProjectJson(read);
          return;
        }
        const { job: imported, signoffs, needsMedia, historyBanks, reviewVideo } = await importProject(file, id);
        for (const bank of historyBanks) await saveHistoryBank(id, bank).catch(console.warn);
        if (reviewVideo) await saveReviewVideo(id, reviewVideo).catch(console.warn);
        if (needsMedia) {
          // Light export: the user picks the original before the project is made.
          setPendingProjectJson({ id, fileName: file.name, project: imported, job: imported, signoffs, sourceMedia: needsMedia, projectId: '' });
          return;
        }
        const job = reviveSavedJob(imported);
        await saveJobToStorage(job);
        addSignoffs(signoffs);
        pauseAll();
        seekAll(0);
        setQueue((prev) => [job, ...prev.filter((j) => j.id !== id)].sort(byNewest));
        setActiveJobId(id);
      } catch (err) {
        reportError(err, { title: 'Opening the project failed', safe: 'Your other projects are unchanged.' });
      }
    },
    [activeJobId, pauseAll, seekAll]
  );

  /** What Update script would do to its project, for the panel to show before anything changes. */
  const scriptUpdatePreview = useMemo((): ScriptUpdatePreview | null => {
    const p = pendingScriptUpdate;
    const job = p && queue.find((j) => j.id === p.jobId);
    if (!p || !job) return null;
    const incoming = p.project.segments || [];
    const update = mergeScriptUpdate(job.segments, job.scriptBase, incoming);
    const lookup = new Map([...job.segments, ...incoming].map((s) => [String(s.id), s]));
    const cues = (ids: string[]) => ids.map((id) => lookup.get(id)).filter((s): s is AudioSegment => !!s);
    const pendingNow = job.syncPendingLines?.length ?? 0;
    const pendingAfter = syncPendingAfter(job, update.segments).syncPendingLines?.length ?? pendingNow;
    const here = job.audioMetadata?.duration || job.audioBuffer?.duration || 0;
    const timedOn = p.sourceMedia.duration || 0;
    return {
      fileName: p.fileName,
      projectName: projectName(job),
      changed: update.changed.length,
      added: update.added.length,
      removed: update.removed.length,
      keptHere: update.keptHere.length,
      conflicts: cues(update.conflicts),
      notApplied: cues(update.notApplied),
      linesToVoice: pendingAfter - pendingNow,
      hasDub: !!job.syncReport,
      noBase: update.noBase,
      transcribedAgain: looksTranscribedAgain(update, incoming.length),
      lengthOff: here && timedOn && Math.abs(here - timedOn) > 0.5 ? { here, script: timedOn } : null,
      problem: scriptUpdateProblem(job, p.project),
    };
  }, [pendingScriptUpdate, queue]);

  /**
   * Puts a newer script on the project being dubbed, as one step Undo can take
   * back. The cues it changed are left for the next Sync; nothing is voiced.
   */
  const applyScriptUpdate = useCallback(() => {
    const p = pendingScriptUpdate;
    if (!p) return;
    updateJobWith(p.jobId, (job) => {
      const { project } = p;
      const update = mergeScriptUpdate(job.segments, job.scriptBase, project.segments);
      const step = recordReviewStep(job.reviewHistory, job.segments, update.segments, { label: 'Update script' });
      const fields: Partial<BatchJob> = {};
      for (const key of SCRIPT_FIELDS) if (project[key] !== undefined) Object.assign(fields, { [key]: project[key] });
      return {
        ...fields,
        segments: step.segments,
        reviewHistory: step.history,
        script: step.segments.map((s) => s.textTarget || s.targetText || '').filter(Boolean).join(' '),
        untranslatedCueIds: project.untranslatedCueIds ?? null,
        scriptOrigin: p.projectId || job.scriptOrigin || null,
        scriptBase: project.segments,
        ...syncPendingAfter(job, step.segments),
      };
    });
    setActiveJobId(p.jobId);
    setPendingScriptUpdate(null);
  }, [pendingScriptUpdate, updateJobWith]);

  const handleRemoveJobFromQueue = useCallback(
    async (id: string) => {
      await deleteJobFromStorage(id);
      // Its dub waiting its turn comes out of the line; one running stops, with nothing left to save to.
      setDubQueue((waiting) => waiting.filter((dub) => dub.jobId !== id));
      const run = syncRunRef.current;
      if (run?.projectId === id) {
        if (run.readJobId) cancelDub(run.readJobId).catch(() => {});
        cancelSync(run.jobId)
          .catch(() => {})
          .finally(() => run.controller.abort());
      }
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
    setDubQueue([]);
    const run = syncRunRef.current;
    if (run) {
      if (run.readJobId) cancelDub(run.readJobId).catch(() => {});
      cancelSync(run.jobId)
        .catch(() => {})
        .finally(() => run.controller.abort());
    }
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
      if (playsSynced) cancelSyncEditRender(activeJob.id);
      const masterUrl = URL.createObjectURL(masterBlob);
      // The editable dub is kept for Undo voice change; a second change keeps the first one's, the last with lines.
      const job = activeJob;
      const before =
        job.syncBank && job.syncBankBlob && job.syncBaseReport && job.syncedBlob
          ? {
              syncedBlob: job.syncedBlob,
              syncReport: job.syncReport ?? null,
              syncBank: job.syncBank,
              syncBankBlob: job.syncBankBlob,
              syncEdits: job.syncEdits ?? null,
              syncBaseReport: job.syncBaseReport,
              syncTakes: job.syncTakes ?? null,
              syncedStems: job.syncedStems ?? null,
              syncMix: job.syncMix ?? null,
            }
          : job.syncBeforeVoiceChange ?? null;
      updateJob(
        activeJob.id,
        playsSynced
          ? {
              syncedAudioBuffer: masterBuffer,
              syncedAudioUrl: masterUrl,
              syncedBlob: masterBlob,
              syncBeforeVoiceChange: before,
              // The dub is a file now, not lines in a bank: a Sync of its own for Undo.
              syncEpoch: newSyncId(),
              syncChangedVoices: null,
              // The bank is the dub before the voice changer: editing it now would undo the change.
              syncBank: null,
              syncBankBlob: null,
              syncTakes: null,
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

  /** Undo voice change: the synced dub from before the whole-file change comes back, with its lines and edits. */
  const handleUndoVoiceChange = () => {
    const before = activeJob?.syncBeforeVoiceChange;
    if (!activeJob || !before) return;
    cancelSyncEditRender(activeJob.id);
    const url = URL.createObjectURL(before.syncedBlob);
    const previousUrl = activeJob.syncedAudioUrl;
    updateJob(activeJob.id, {
      ...before,
      syncEpoch: newSyncId(),
      syncedAudioUrl: url,
      syncedAudioBuffer: null,
      syncBeforeVoiceChange: null,
      status: ProcessingStatus.COMPLETED,
    });
    setSyncEditStatus(activeJob.id, { state: 'ready' });
    decodingSynthUrlRef.current = url;
    decodeAudioBlobUrl(url)
      .then((buffer) => {
        if (syncedUrlOf(activeJob.id) === url) updateJob(activeJob.id, { syncedAudioBuffer: buffer });
      })
      .catch(console.warn)
      .finally(() => {
        if (decodingSynthUrlRef.current === url) decodingSynthUrlRef.current = null;
      });
    if (previousUrl) window.setTimeout(() => URL.revokeObjectURL(previousUrl), 5000);
  };

  /** The voice a speaker's lines are voiced in now, as Sync and retakes voice them. */
  const dubVoiceOf = (job: BatchJob, speaker: string, mainVoice: string = elVoiceId) =>
    (isMultiSpeaker(job.segments) && job.cast?.[speaker]?.voiceId) || mainVoice;

  /** The speakers whose changed voice still holds: their dub voice is still the one it was changed over. Null when none. */
  const changedVoicesStill = (job: BatchJob, mainVoice: string = elVoiceId): ChangedVoices | null => {
    const kept = Object.entries(job.syncChangedVoices || {}).filter(([speaker, voice]) => voice.over === dubVoiceOf(job, speaker, mainVoice));
    return kept.length > 0 ? Object.fromEntries(kept) : null;
  };

  /** A speaker's changed voice, while it holds: what their retakes are changed into. */
  const changedVoiceOf = (job: BatchJob, speaker: string): ChangedVoice | null => changedVoicesStill(job)?.[speaker] ?? null;

  /** Changed voices as the voice changer takes them, each speaker with their own settings. */
  const voicesToChange = (voices: ChangedVoices): SpeakerVoices =>
    Object.fromEntries(Object.entries(voices).map(([speaker, v]) => [speaker, { voiceId: v.voiceId, name: v.name, settings: v.settings }]));

  /**
   * Changes `lines` of the synced dub into `voices`, each fitted to its old
   * length, and puts them in the bank as takes of their lines, so every line
   * keeps its place and its edits; the dub is rendered again with them.
   * `remember` keeps the voices as the speakers' changed voices, for their
   * retakes; `busy` marks each line busy while it changes.
   */
  const changeSyncLines = async (
    jobId: string,
    bank: SyncBank,
    bankBlob: Blob,
    lines: SyncBankLine[],
    voices: SpeakerVoices,
    {
      settings,
      remember = false,
      busy = false,
      onLine,
      signal,
    }: { settings?: VoiceChangeSettings; remember?: boolean; busy?: boolean; onLine?: (key: string, progress: LineProgress) => void; signal?: AbortSignal } = {}
  ): Promise<{ changed: number; error: string | null }> => {
    const fallback = settings ?? Object.values(voices).find((v) => v.settings)?.settings;
    if (!fallback || lines.length === 0) return { changed: 0, error: null };
    const { changed, error } = await voiceChangeLines(
      { bank, bankBlob, lines, voices, settings: fallback },
      {
        apiKey: elApiKey,
        signal,
        onLine: (key, progress) => {
          if (busy && progress.state === 'changing') setSyncTakesBusy({ jobId, key });
          onLine?.(key, progress);
        },
      }
    );
    if (busy) setSyncTakesBusy((now) => (now?.jobId === jobId ? null : now));
    refreshQuota();
    // Lines finished before a stop are kept: they are paid for.
    if (changed.length === 0) return { changed: 0, error: error?.message ?? null };
    // A Sync or a take picked meanwhile made a new bank: these lines belong to the old one.
    const now = queueRef.current.find((j) => j.id === jobId);
    if (!now?.syncBank || now.syncBank.bankId !== bank.bankId || !now.syncBankBlob || !now.syncBaseReport) {
      return { changed: 0, error: 'The dub changed while its voice was being changed. Try again.' };
    }
    const put = await putChangedLines(
      { bank: now.syncBank, bankBlob: now.syncBankBlob, takes: now.syncTakes, report: now.syncBaseReport, changed }
    );
    const remembered: ChangedVoices | undefined = remember
      ? {
          ...(now.syncChangedVoices || {}),
          ...Object.fromEntries(
            Object.entries(voices).map(([speaker, v]) => [speaker, { voiceId: v.voiceId, name: v.name, settings: v.settings ?? fallback, over: dubVoiceOf(now, speaker) }])
          ),
        }
      : undefined;
    // Edits stay exactly as they were: each line is as long as before, so they fit it.
    // Copies that kept the line's old samples as their own play the changed ones too.
    const changedAt = new Map<number, { bankStart: number; gain: number }>();
    now.syncBank.lines.forEach((line, n) => {
      const next = put.bank.lines[n];
      if (next && next.key === line.key && next.bankStart !== line.bankStart) changedAt.set(line.bankStart, { bankStart: next.bankStart, gain: next.gain });
    });
    const edits = changedAt.size > 0 ? moveCopyAudio(now.syncEdits, (bankStart) => changedAt.get(bankStart) ?? bankStart) : now.syncEdits || null;
    updateJob(jobId, {
      syncBank: put.bank,
      syncBankBlob: put.bankBlob,
      syncTakes: put.takes,
      ...(edits !== (now.syncEdits || null) && { syncEdits: edits }),
      ...(remembered && { syncChangedVoices: remembered }),
    });
    scheduleSyncEditRender(
      jobId,
      {
        bank: put.bank,
        bankBlob: put.bankBlob,
        baseReport: now.syncBaseReport,
        edits,
        sourceDuration: sourceDurationOf(now),
        source: now.audioBuffer,
      },
      0
    );
    return { changed: changed.length, error: error?.message ?? null };
  };

  /**
   * Voice changer, line by line: each line of the synced dub changed on its
   * own and fitted to its old length, then put in the bank as a take of that
   * line, so every line keeps its place and its edits. The dub is rendered
   * again with them; the old voice stays in each line's takes. The speakers
   * keep the voice: their retakes are changed into it too.
   */
  const handleVoiceChangeLines = async (
    voices: SpeakerVoices,
    settings: VoiceChangeSettings,
    { keys, onLine, signal }: { keys: string[]; onLine: (key: string, progress: LineProgress) => void; signal: AbortSignal }
  ): Promise<{ changed: number; error: string | null }> => {
    const job = activeJob;
    if (!job?.syncBank || !job.syncBankBlob || !job.syncBaseReport) return { changed: 0, error: 'This dub has no synced lines to change.' };
    // Only the lines asked for: one changed already isn't changed again.
    const lines = linesToChange(job.syncBank, voices).filter((line) => keys.includes(line.key));
    return changeSyncLines(job.id, job.syncBank, job.syncBankBlob, lines, voices, { settings, remember: true, onLine, signal });
  };

  /**
   * Change voice, on one take of a line (TakesPanel): the take put through
   * the voice changer into the speaker's changed voice, at its own length,
   * as a new take. The take in the dub is replaced where it is, its edits
   * kept; any other stays a take to use.
   */
  const handleChangeTakeVoice = async (key: string, takeId: string) => {
    const job = activeJob;
    if (!job?.syncBank || !job.syncBankBlob || !job.syncBaseReport || syncTakesBusy?.jobId === job.id) return;
    const line = job.syncBank.lines.find((l) => l.key === key);
    const unit = job.syncBaseReport.units.find((u) => u.key === key);
    const voice = line ? changedVoiceOf(job, line.speaker) : null;
    if (!line || !unit || !voice) return;
    const take = takesOf(job.syncTakes, line, unit).takes.find((t) => t.id === takeId);
    if (!take || takeIsIn(take, voice)) return;
    setSyncTakesBusy({ jobId: job.id, key });
    try {
      const changed = await voiceChangeTakes({ bank: job.syncBank, bankBlob: job.syncBankBlob, takes: [take], voice }, { apiKey: elApiKey });
      refreshQuota();
      const next = changed.takes[0];
      if (next === take) throw new Error('The voice changer gave this take back silent.');
      const now = queueRef.current.find((j) => j.id === job.id);
      if (!now?.syncBank || now.syncBank.bankId !== job.syncBank.bankId || !now.syncBaseReport) return;
      const nowLine = now.syncBank.lines.find((l) => l.key === key) || line;
      const kept = takesOf(now.syncTakes, nowLine, unit);
      // The take in the dub, playing its own samples: the line plays the new ones in their place, every edit kept.
      const inPlace = kept.active === takeId && nowLine.bankStart === take.bankStart && nowLine.length === take.length;
      const bank = {
        ...now.syncBank,
        bankId: changed.bank.bankId,
        lines: inPlace ? now.syncBank.lines.map((l) => (l.key === key ? { ...l, bankStart: next.bankStart, gain: next.gain, hash: next.hash } : l)) : now.syncBank.lines,
      };
      const voiced: BatchJob = {
        ...now,
        syncBank: bank,
        syncBankBlob: changed.bankBlob,
        syncTakes: { ...(now.syncTakes || {}), [key]: { takes: [...kept.takes, next], active: inPlace ? next.id : kept.active } },
      };
      // Copies playing this take as their own play it in the new voice.
      const copyEdits = moveCopyAudio(now.syncEdits, (bankStart) => (bankStart === take.bankStart ? { bankStart: next.bankStart, gain: next.gain } : bankStart));
      const copiesMoved = copyEdits !== (now.syncEdits ?? null);
      if (copiesMoved) voiced.syncEdits = copyEdits;
      // The take in the dub but moved since (another take's place): it goes in as a take is used.
      const put = !inPlace && kept.active === takeId ? takeInDub(voiced, key, next.id) : null;
      updateJob(job.id, { syncBank: voiced.syncBank, syncBankBlob: voiced.syncBankBlob, syncTakes: voiced.syncTakes, ...(copiesMoved && { syncEdits: copyEdits }), ...put?.updates });
      if (put) scheduleSyncEditRender(job.id, put.render, 0);
      else if (inPlace || copiesMoved) {
        scheduleSyncEditRender(
          job.id,
          { bank, bankBlob: changed.bankBlob, baseReport: now.syncBaseReport, edits: copyEdits, sourceDuration: sourceDurationOf(now), source: now.audioBuffer },
          0
        );
      }
    } catch (err: any) {
      if (err?.code === 'cancelled') return;
      reportError(err, { title: `This take could not be changed into ${voice.name}`, safe: 'The takes this line had are kept.' });
    } finally {
      setSyncTakesBusy((busy) => (busy?.jobId === job.id ? null : busy));
    }
  };

  /** Stop changing a speaker's retakes into their changed voice: what was changed stays changed. */
  const handleForgetChangedVoice = (speaker: string) => {
    const job = activeJob;
    if (!job?.syncChangedVoices?.[speaker]) return;
    const { [speaker]: _gone, ...rest } = job.syncChangedVoices;
    updateJob(job.id, { syncChangedVoices: Object.keys(rest).length > 0 ? rest : null });
  };

  /** What the voice changer needs to change the synced dub line by line; null for a dub that isn't synced. */
  const voiceChangeLineByLine = useMemo(() => {
    if (!isVoiceChangerOpen || !activeJob?.syncBank || !activeJob.syncBankBlob || !activeJob.syncBaseReport) return null;
    return {
      speakers: speakersOf(activeJob.syncBank),
      clips: laneClips(activeJob.syncBank, activeJob.syncEdits, sourceDurationOf(activeJob)),
      duration: sourceDurationOf(activeJob),
      cast: Object.fromEntries(Object.entries(activeJob.cast || {}).map(([speaker, voice]) => [speaker, voice.voiceId])),
      lineVoices: lineVoiceIds(activeJob.syncBank, activeJob.syncTakes),
    };
  }, [isVoiceChangerOpen, activeJob?.syncBank, activeJob?.syncBankBlob, activeJob?.syncBaseReport, activeJob?.syncEdits, activeJob?.cast, activeJob?.syncTakes]);

  /** The finished dub (the synced one once there is one), which is what the voice changer works on (not the source speech). */
  const voiceChangerBuffer = (playsSynced ? activeJob?.syncedAudioBuffer : activeJob?.synthAudioBuffer) || null;
  // Read through a ref inside the memo, so no closure names the buffer (see liveOriginalRef).
  const voiceChangerBufferRef = useRef(voiceChangerBuffer);
  voiceChangerBufferRef.current = voiceChangerBuffer;
  const voiceChangerBlob = (playsSynced ? activeJob?.syncedBlob : activeJob?.synthesizedBlob) || null;
  const voiceChangerDubFile = useMemo(() => {
    if (!isVoiceChangerOpen || !activeJob) return null;
    const buffer = voiceChangerBufferRef.current;
    const blob = voiceChangerBlob || (buffer ? audioBufferToWav(buffer) : null);
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

  // Resegment Audio based on Pause Sensitivity Slider. A sensitivity (or a
  // starting point) sets the whole gate again, so it drops any Advanced gate.
  const resegmentActiveJob = useCallback(
    (newSensitivity: number, gate: PauseGate | null) => {
      if (!activeJob) return;
      updateJob(activeJob.id, {
        ...(activeJob.audioBuffer
          ? { segments: resegmentAudioBuffer(activeJob.audioBuffer, newSensitivity, activeJob.segments, gate) }
          : {}),
        analysisSensitivity: newSensitivity,
        analysisGate: gate,
      });
    },
    [activeJob, updateJob]
  );
  const handleSensitivityChange = useCallback(
    (newSensitivity: number) => resegmentActiveJob(newSensitivity, null),
    [resegmentActiveJob]
  );
  const handlePauseGateChange = useCallback(
    (gate: PauseGate | null) => resegmentActiveJob(activeJob?.analysisSensitivity ?? 50, gate),
    [resegmentActiveJob, activeJob?.analysisSensitivity]
  );

  return (
    <div
      className="flex flex-col min-h-screen font-sans selection:bg-indigo-500 selection:text-white bg-slate-950 text-slate-100"
    >
      {/* Hidden Audio Elements for Reference & Synth */}
      {/* Keyed by URL: a new file is a new element, so no stale position or pending play carries over. */}
      {sourceAudioUrl && <audio key={sourceAudioUrl} ref={sourceAudioRef} src={sourceAudioUrl} preload="auto" />}
      {synthAudioUrl && <audio key={synthAudioUrl} ref={synthAudioRef} src={synthAudioUrl} preload="auto" />}

      <ErrorPopup />

      <OpenProjectJsonPanel
        pending={pendingProjectJson}
        measure={measureProjectMedia}
        onOpen={openProjectJson}
        onCancel={() => {
          pickedMediaRef.current = null;
          setPendingProjectJson(null);
        }}
        updateName={activeJob && hasTranscript(activeJob.segments) && !pendingProjectJson?.job ? projectName(activeJob) : null}
        onUpdateInstead={() => {
          if (!pendingProjectJson || !activeJob) return;
          pickedMediaRef.current = null;
          setPendingScriptUpdate({ ...pendingProjectJson, jobId: activeJob.id });
          setPendingProjectJson(null);
        }}
      />
      <SyncAgainGuard guard={syncGuard} onLockAndSync={() => answerSyncGuard(true)} onSyncAnyway={() => answerSyncGuard(false)} onCancel={() => setSyncGuard(null)} />
      <SyncFromScratchConfirm confirm={scratchConfirm} onSync={answerScratchConfirm} onCancel={() => setScratchConfirm(null)} />
      <UpdateScriptPanel
        preview={scriptUpdatePreview}
        onUpdate={applyScriptUpdate}
        onOpenAsNew={() => {
          if (!pendingScriptUpdate) return;
          const { jobId: _target, ...read } = pendingScriptUpdate;
          setPendingScriptUpdate(null);
          setPendingProjectJson(read);
        }}
        onCancel={() => setPendingScriptUpdate(null)}
      />

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
        translationStyleName={promptStyleName(activeJob?.promptPresetId || promptPresetId)}
        voiceName={
          availableVoices.find((voice) => voice.voice_id === elVoiceId)?.name ??
          POPULAR_ELEVENLABS_VOICES.find((voice) => voice.id === elVoiceId)?.name ??
          null
        }
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
        onOpenSyncSettings={() => setSyncSettingsRequest((n) => n + 1)}
        pauseSensitivity={activeJob?.analysisSensitivity ?? 50}
        projects={queue}
        onResetSession={handleResetSession}
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
          dubLanguage={activeJob?.language || selectedLanguage}
          previewVoice={previewVoice}
          elevenLabsQuota={elevenLabsQuota}
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
          dubLanguage={activeJob?.language || selectedLanguage}
          previewVoice={previewVoice}
          elevenLabsQuota={elevenLabsQuota}
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
              className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-amber-950 text-xs font-semibold cursor-default"
            >
              Open API settings
            </button>
          )}
        </div>
      )}

      {/* A save to this computer failed: the work is only in this window until one succeeds. */}
      {saveFailure && (
        <div
          className="px-4 sm:px-6 lg:px-8 py-2.5 bg-rose-500/10 border-b border-rose-500/30 text-xs sm:text-[13px] flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <p className="min-w-0 flex-1 text-slate-200 leading-snug">
            <span className="font-semibold">
              {queue.find((j) => j.id === saveFailure.jobId)?.file?.name || 'This project'} could not be saved.
            </span>{' '}
            <span className="text-slate-400">{saveFailure.message} Until it saves, closing Dhvani loses the latest changes.</span>
          </p>
          <button
            type="button"
            onClick={retrySave}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-400 hover:bg-rose-300 text-rose-950 text-xs font-semibold cursor-default"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Save again
          </button>
          <button
            type="button"
            onClick={() => setSaveFailure(null)}
            className="shrink-0 px-2 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 text-xs cursor-default"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Transcription/translation job warning that did not lose any work */}
      {activeJob?.translationWarning && (
        <div
          className="mx-4 sm:mx-6 lg:mx-8 mt-4 px-4 py-3 rounded-2xl bg-sky-950/60 border border-sky-700/70 text-sky-100 text-xs sm:text-sm flex items-start gap-3"
          role="status"
        >
          <AlertTriangle className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
          <p className="min-w-0 flex-1 leading-relaxed">{activeJob.translationWarning}</p>
          {(activeJob.untranslatedCueIds?.length ?? 0) > 0 && (
            <button
              type="button"
              onClick={handleTranslateMissing}
              disabled={isTranslatingLanguage}
              className="shrink-0 -my-1 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-medium cursor-default inline-flex items-center gap-1.5"
            >
              <Languages className="w-3.5 h-3.5" />
              {isTranslatingLanguage ? 'Translating…' : `Translate ${activeJob.untranslatedCueIds!.length} missed line(s)`}
            </button>
          )}
          <button
            type="button"
            onClick={() => updateJob(activeJob.id, { translationWarning: null })}
            className="shrink-0 -my-1 w-7 h-7 inline-flex items-center justify-center rounded-lg text-sky-300 hover:text-white hover:bg-sky-900/60 cursor-default"
            aria-label="Hide this note"
            title="Hide this note"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main Express Dubbing Studio */}
      <main className="flex-1 flex flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-8 2xl:px-10 w-full mx-auto min-w-0">
        <ExpressDubWizard
          activeStep={activeStep}
          onStepChange={handleStepChange}
          activeJob={activeJob}
          onSyncOptionsChange={(projectId, options) => updateJob(projectId, { syncOptions: options })}
          syncSettingsRequest={syncSettingsRequest}
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
          onSyncChangedOnly={handleSyncChangedOnly}
          onSyncFromScratch={handleSyncFromScratch}
          onSyncEditsChange={handleSyncEditsChange}
          syncAudio={
            activeJob?.syncBank
              ? {
                  tracks: activeJob.syncAudioTracks || [],
                  files: trackFiles,
                  buffers: trackBuffers,
                  monitor: trackMonitor,
                  onMonitor: handleTrackMonitorChange,
                  onImport: handleImportTrackAudio,
                }
              : undefined
          }
          onDownloadWithTracks={handleDownloadWithTracks}
          onUndoVoiceChange={handleUndoVoiceChange}
          syncEditStatus={syncEditStatus}
          syncEditLive={liveDub}
          onEditTimingAudio={setEditTimingAudio}
          onSyncEditDraft={handleSyncEditDraft}
          speakerMonitor={speakerMonitor}
          onSpeakerLevelChange={handleSpeakerLevelChange}
          onSpeakerMonitorChange={handleSpeakerMonitorChange}
          onRetrySyncEditRender={handleRetrySyncEditRender}
          isSyncing={dubbingHere || dubWaitingHere}
          syncWaitingFor={dubWaitingHere ? dubbingProjectName || 'another project' : null}
          syncProgress={dubbingHere ? syncProgress : null}
          readProgress={dubbingHere ? readProgress : null}
          isCancellingSync={dubbingHere && isCancellingSync}
          onCancelSync={handleCancelSync}
          syncPendingLines={activeJob?.syncPendingLines || []}
          syncPendingWords={activeJob?.syncPendingWords || []}
          onApplySyncLine={handleApplySyncLine}
          onRetakeSyncLines={handleRetakeSyncLines}
          onUseOfferedTake={handleUseOfferedTake}
          onKeepOfferedTake={handleKeepOfferedTake}
          onVoiceSyncTakes={handleVoiceSyncTakes}
          onUseSyncTake={handleUseSyncTake}
          onClearSyncTakes={handleClearSyncTakes}
          changedVoiceOf={activeJob ? (speaker: string) => changedVoiceOf(activeJob, speaker) : undefined}
          onChangeSyncTakeVoice={handleChangeTakeVoice}
          onForgetChangedVoice={handleForgetChangedVoice}
          syncTakesBusy={activeJob && syncTakesBusy?.jobId === activeJob.id ? syncTakesBusy.key : null}
          onUpdateSegment={handleUpdateSegment}
          onReplaceSegments={handleReplaceSegments}
          onApplyTranscriptSegments={handleApplyTranscriptSegments}
          onExportTranscript={handleExportTranscript}
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
          dubAudioQuality={dubAudioQuality}
          onDubAudioQualityChange={handleDubAudioQualityChange}
          dubQualityNotice={(activeJob && dubQualityNotices[activeJob.id]) || null}
          playbackRate={playbackRate}
          onPlaybackRateChange={setPlaybackRate}
          onResetSession={handleResetSession}
          onDownloadWav={handleDownloadMasterWav}
          onDownloadMp3={handleDownloadMasterMp3}
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
          onUpdateJobFields={(patch) => activeJob && updateJob(activeJob.id, patch)}
          customPrompt={activeJob?.customPrompt || customPrompt}
          promptPresetId={activeJob?.promptPresetId || promptPresetId}
          onUpdateTranslationPrompt={handleUpdateTranslationPrompt}
          onRetranslateSegments={handleRetranslateWithPrompt}
          onRetranscribeAudio={handleRetranscribeAudio}
          onTranslateTranscript={handleTranslateTranscript}
          voiceRate={voiceRate}
          speakerVoiceRates={voiceRates.speakers}
          fitTranslationToVoice={fitTranslationToVoice}
          onFitTranslationToVoiceChange={handleFitTranslationToVoiceChange}
          onTargetSourceChange={handleTargetSourceChange}
          onReviewHistory={handleReviewHistory}
          projectHistory={projectHistoryView}
          translationSummary={translationSummary}
          translationReady={Boolean(backendHealth?.geminiConfigured)}
          translationProgress={translationProgress}
          isTranslatingLanguage={isTranslatingLanguage}
          onCancelTranslation={activeJob ? () => cancelTranslation(activeJob.id) : undefined}
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
        lineByLine={voiceChangeLineByLine}
        onChangeLines={handleVoiceChangeLines}
        editRender={playsSynced && activeJob?.syncBank ? syncEditStatus.state : 'ready'}
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
        cartesiaReady={cartesiaConfigured}
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
        onExportJob={handleExportProject}
        onImportProject={handleImportProject}
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
        gate={activeJob?.analysisGate ?? null}
        onGateChange={handlePauseGateChange}
        segmentCount={activeJob?.segments?.length || 0}
        hasAudioBuffer={Boolean(activeJob?.audioBuffer)}
        audioBuffer={activeJob?.audioBuffer || null}
        segments={activeJob?.segments || []}
      />
    </div>
  );
}
