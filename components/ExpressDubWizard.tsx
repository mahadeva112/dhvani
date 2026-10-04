import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import {
  Volume2,
  Play,
  Pause,
  CheckCircle2,
  ArrowRight,
  Loader2,
  RotateCcw,
  Download,
  FileText,
  Check,
  AlertCircle,
  Headphones,
  Edit3,
  Globe,
  Mic,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  Layers,
  Sliders,
  SlidersHorizontal,
  RefreshCw,
  Clock,
  Music,
  LayoutGrid,
  Table,
  Maximize2,
  Search,
  Filter,
  Copy,
  AlertTriangle,
  Languages,
  ChevronsDown,
  ChevronsUp,
  Keyboard,
  Share2,
  ChevronDown,
  ClipboardPaste,
  AudioWaveform,
  Speech,
  ShieldCheck,
  ArrowLeftRight,
  Scissors,
  BookOpen,
  X,
} from 'lucide-react';
import { AudioSegment, BatchJob, MixPeakMode, ProcessingStatus, TargetSource, TrackSwitchOptions } from '../types';
import { listSpeakers, likelySlips, overlapsBefore, speakerOf, isMultiSpeaker } from '../services/speakers';
import type { SpeakerSlip } from '../services/speakers';
import { SpeakerBar, SpeakerPicker, SpeakerCueNotes, SpeakerChip, CastCard, MixPeakChoice, MixChecks, StemDownloads } from './SpeakerPanel';
import type { RetranslateProgress } from '../services/subtitleService';
import { TargetScriptChoice } from './TargetScriptChoice';
import {
  Voice,
  DubProgress,
  ElevenLabsModel,
  ElevenLabsVoiceSettings,
  DEFAULT_VOICE_SETTINGS,
  getVoiceSettings,
  performsAudioTags,
  isElevenLabsDefault,
} from '../services/elevenLabsService';
import { ResetDefaultsButton } from './ResetDefaultsButton';
import { audioBufferToWav } from '../services/audioService';
import {
  generateTargetLanguageScript,
  generateSrtContent,
  generateVttContent,
  downloadFile,
  TargetScriptFormat,
  SrtOptions,
  DEFAULT_SRT_OPTIONS,
  adjustSegmentsForDubbedTimeline,
} from '../services/srtService';
import { timelineMapper } from '../services/playbackTimeline';
import { ReviewWaveformPlayer } from './ReviewWaveformPlayer';
import { VoiceSelectorCard, SelectedVoiceSummary, POPULAR_ELEVENLABS_VOICES, VoiceEngine } from './VoiceSelectorCard';
import { MediaStrip, MiniWaveform } from './MediaStrip';
import { useLiveFrame, useLiveTime } from './useLiveTime';
import { useFavoriteVoices } from '../services/favoriteVoicesService';
import { PhoneticSmartTextarea } from './PhoneticSmartTextarea';
import { SrtExportModal } from './SrtExportModal';
import { CustomScriptAlignModal } from './CustomScriptAlignModal';
import { TranslationPromptModal } from './TranslationPromptModal';
import { PauseSensitivityControl } from './PauseSensitivityControl';
import { QaCockpit } from './QaCockpit';
import { SyncResultsPanel, SyncSettingsPanel, useSyncOptions } from './SyncPanel';
import {
  distributeLineText,
  measureSpeechSeconds,
  scriptCharacterCount,
  speakingRate,
  suggestShorterLine,
  suggestLongerLine,
  syncedSegments,
  TYPICAL_CHARS_PER_SECOND,
  withLineTargets,
} from '../services/syncService';
import type { SyncOptions, SyncPreviewUnit, SyncProgress, SyncUnitReport } from '../services/syncService';
import { SyncPreviewPanel, useSyncPreview, useLineFixes, LineFixControls, lineNote, PreviewCards, PreviewTimeline, isShort } from './SyncPreviewPanel';
import type { RewriteDirection } from './SyncPreviewPanel';
import { FitMeter, ScriptFitStrip, fitAdvice, needsFix } from './FinalScriptFit';
import { hueOf, lineIndexByCue, withAlpha } from './lineColors';
import type { ScriptFitFilter } from './FinalScriptFit';
import { getPresetById, DEFAULT_PROMPT_PRESET_ID } from '../services/translationPromptPresets';
import { runQa, useQaConfig } from '../services/qaService';
import { useGlossaryTerms } from '../services/glossaryService';
import { useSignoff } from '../services/signoffService';
import { ContinuousDocumentView, ContinuousDocumentHandle } from './review/ContinuousDocumentView';

type ReviewMode = 'grid' | 'table' | 'spotlight' | 'script' | 'document' | 'qa';

const REVIEW_VIEWS: { id: ReviewMode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'table', label: 'Cues', Icon: Table },
  { id: 'grid', label: 'Cards', Icon: LayoutGrid },
  { id: 'spotlight', label: 'Spotlight', Icon: Maximize2 },
  { id: 'script', label: 'Script', Icon: FileText },
  { id: 'document', label: 'Document', Icon: BookOpen },
  { id: 'qa', label: 'QA', Icon: ShieldCheck },
];

/**
 * How comfortably a translated line fits its time slot, in characters per
 * second: up to 14 reads naturally, up to 18 is tight, beyond that the voice rushes.
 */
const getPace = (text: string, duration: number) => {
  const cps = duration > 0 ? text.length / duration : 0;
  const level: 'natural' | 'tight' | 'fast' = cps > 18 ? 'fast' : cps > 14 ? 'tight' : 'natural';
  return {
    cps,
    level,
    meter: Math.min(100, (cps / 24) * 100),
    label: level === 'fast' ? 'Too fast' : level === 'tight' ? 'Tight' : 'Natural',
    pillClass:
      level === 'fast'
        ? 'bg-rose-500/15 text-rose-300'
        : level === 'tight'
          ? 'bg-amber-500/15 text-amber-300'
          : 'bg-emerald-500/15 text-emerald-300',
    barClass: level === 'fast' ? 'bg-rose-400' : level === 'tight' ? 'bg-amber-400' : 'bg-emerald-400',
  };
};

/** Review judges whether a line ends early at the top of a natural pace (see getPace). */
const REVIEW_CPS = 14;
/** Past this a line is too fast (see getPace); a shorter wording has to come in under it. */
const REVIEW_FAST_CPS = 18;
/** A new wording aims a little under its time, and a fuller one close to all of it, as Sync's suggestions do (server/lib/syncDub.js). */
const REVIEW_SHORTER_MARGIN = 0.92;
const REVIEW_FULLER_FILL = 0.95;

/**
 * One cue as a line to reword on the Review step, in the shape the Final
 * dub's rewording works on, with the rate its speech is measured at. Too fast
 * (see getPace) is a line to shorten, measured at the too-fast limit so a
 * wording that fits is no longer too fast: aiming lower would ask a short line
 * to lose so much that no wording keeps its meaning. A line that at a natural
 * pace ends well before the original speaker stops is one to make fuller. The
 * cue's own time is both its slot and its speech.
 */
const reviewLineOf = (seg: AudioSegment, text: string, sourceText: string): SyncPreviewUnit & { cps: number } => {
  const duration = Math.max(0, seg.duration || seg.endTime - seg.startTime);
  const length = text.trim().length;
  const level = getPace(text, duration).level;
  const short = level === 'natural' && length > 0 && isShort(length / REVIEW_CPS, duration);
  const cps = short ? REVIEW_CPS : REVIEW_FAST_CPS;
  const estimate = length / cps;
  return {
    cps,
    index: 0,
    key: String(seg.id),
    cueIds: [seg.id],
    text,
    sourceText,
    srcStart: seg.startTime,
    srcEnd: seg.endTime,
    nextStart: null,
    slot: duration,
    spoken: duration,
    estimate,
    overflow: Math.max(0, estimate - duration),
    underflow: short ? duration - estimate : 0,
    status: level === 'fast' ? 'long' : level === 'tight' ? 'tight' : short ? 'short' : 'fits',
    targetChars: short
      ? Math.max(length + 1, Math.floor(REVIEW_CPS * duration * REVIEW_FULLER_FILL))
      : Math.max(1, Math.floor(REVIEW_FAST_CPS * duration * REVIEW_SHORTER_MARGIN)),
  };
};

/** True when a cue's line ends well before the original speaker stops: one to make fuller. */
const endsEarly = (seg: AudioSegment, text: string) => reviewLineOf(seg, text, '').status === 'short';

/** Rough time left, in words. */
const formatTimeLeft = (seconds: number) =>
  seconds < 60 ? 'Less than a minute left' : `About ${Math.round(seconds / 60)} min left`;

/** 125.4 -> "2:05", 3725 -> "1:02:05" */
const formatClock = (seconds: number) => {
  const t = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

interface LiveTimeProps {
  currentTime: number;
  isPlaying: boolean;
  getLiveTime?: () => number | null;
}

/** One track's lane in a player: the original or a dub, drawn over its own length. */
interface TrackLane {
  label: string;
  track: 'source' | 'synth';
  length: number;
  buffer: AudioBuffer | null | undefined;
  dot: string;
  color: string;
  /** Each line's stretch of this track, in seconds, in the line's colour: tinted behind the waveform and drawn over it. */
  spans?: { from: number; to: number; color: string }[];
}

/** A line's start on one lane joined to its start on the next, as fractions of each lane's length. */
interface LaneLink {
  from: number;
  to: number;
  color: string;
}

/** A lane's playhead, moved every frame while playing on the painted frame, without re-rendering anything. */
const LanePlayhead: React.FC<LiveTimeProps & { totalLength: number }> = ({ currentTime, isPlaying, getLiveTime, totalLength }) => {
  const ref = useRef<HTMLSpanElement>(null);
  useLiveFrame(currentTime, isPlaying, getLiveTime, (time) => {
    if (ref.current) ref.current.style.left = `${Math.max(0, Math.min(100, (time / totalLength) * 100))}%`;
  });
  return <span ref={ref} className="absolute top-0 bottom-0 w-0.5 -ml-px bg-slate-100 pointer-events-none" />;
};

/** Whole seconds, so it re-renders once a second. */
const LiveClock: React.FC<LiveTimeProps> = ({ currentTime, isPlaying, getLiveTime }) => (
  <>{formatClock(useLiveTime(currentTime, isPlaying, getLiveTime, 1))}</>
);

const railButton =
  'flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';

/**
 * The step a job belongs on when nobody has picked one: source until there are
 * cues, review until there is a dub, then the final dub.
 */
export const stepForJob = (job: BatchJob | null): number =>
  !job || job.segments.length === 0 ? 1 : job.synthesizedAudioUrl || job.synthAudioBuffer ? 3 : job.syncedAudioUrl ? 4 : 2;

interface ExpressDubWizardProps {
  /** The step on screen, owned by App so the header can show and change it. */
  activeStep: number;
  onStepChange: (step: number) => void;
  activeJob: BatchJob | null;
  onFileSelect: (files: FileList | File[]) => void;
  onLoadSampleSession: (sampleType: 'podcast' | 'keynote') => void;
  targetLanguage: string;
  onTargetLanguageChange: (lang: string) => void;
  /** Source language for transcription; '' means ElevenLabs auto-detect. */
  sourceLanguage?: string;
  onSourceLanguageChange?: (lang: string) => void;
  languages: { code: string; label: string }[] | string[];
  /** Live stage message from the transcription/translation pipeline. */
  pipelineStatus?: string;
  elVoiceId: string;
  onElVoiceIdChange: (v: string) => void;
  /** Voices of the engine that is on; the other engine's voices are not offered. */
  availableVoices: Voice[];
  /** Which engine speaks the dub. Omitting the change handler hides the switch (no Cartesia key). */
  voiceEngine?: VoiceEngine;
  onVoiceEngineChange?: (engine: VoiceEngine) => void;
  onOpenPhoneticKeyboard?: (segment?: AudioSegment) => void;
  onAutoTranscribe: () => Promise<void>;
  isTranscribing: boolean;
  onSynthesizeMaster: () => Promise<void>;
  /** Display name of the ElevenLabs model the dub is generated with. */
  ttsModelName?: string;
  /** The ElevenLabs model the dub is voiced with, and the models to choose from. */
  elModelId?: string;
  onElModelIdChange?: (modelId: string) => void;
  elModels?: ElevenLabsModel[];
  /** Adds emotion cues to an Eleven v3/v4 dub before it is voiced; off means the script is spoken as written. */
  emotionEnhance?: boolean;
  onEmotionEnhanceChange?: (enabled: boolean) => void;
  /** Brings a dub's passages to one loudness; off keeps each at the level it was voiced at. */
  dubMatchLoudness?: boolean;
  onDubMatchLoudnessChange?: (enabled: boolean) => void;
  /** Used to load the voice's own ElevenLabs settings, which the sliders start from. */
  elApiKey?: string;
  /** Null means the voice's own ElevenLabs settings are used. */
  elVoiceSettings?: ElevenLabsVoiceSettings | null;
  onElVoiceSettingsChange?: (settings: ElevenLabsVoiceSettings | null) => void;
  isSynthesizing: boolean;
  /** Progress of the dub in flight, polled from the server; null before the first report. */
  dubProgress?: DubProgress | null;
  isCancellingDub?: boolean;
  onCancelSynthesis?: () => void;
  /** Sync: a dub voiced line by line and placed on the original's phrases. Omitted hides the panel. */
  onSyncDub?: (options: SyncOptions) => void;
  isSyncing?: boolean;
  syncProgress?: SyncProgress | null;
  isCancellingSync?: boolean;
  onCancelSync?: () => void;
  /** Why the last sync failed, shown in the panel. */
  syncError?: string | null;
  /** Keys of synced lines reworded or retaken since the last sync. */
  syncPendingLines?: string[];
  onApplySyncLine?: (unit: SyncUnitReport, text: string) => void;
  onRetakeSyncLine?: (unit: SyncUnitReport) => void;
  onUpdateSegment: (id: string | number, updates: Partial<AudioSegment>) => void;
  /** Replaces every segment in one write, for changes that touch many cues. */
  onReplaceSegments: (segments: AudioSegment[]) => void;
  onPlaySegmentSolo: (segment: AudioSegment) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  /** The playing track's exact position, for a playhead that moves every frame. */
  getLiveTime?: () => number | null;
  duration: number;
  onSeek: (time: number) => void;
  trackMode: 'source' | 'synth' | 'both';
  /** Switches what is heard as one action; see TrackSwitchOptions. */
  onTrackModeChange: (mode: 'source' | 'synth' | 'both', options?: TrackSwitchOptions) => void;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  onResetSession?: () => void;
  onDownloadWav: () => void;
  onDownloadSrt: () => void;
  onDownloadScript?: (format?: TargetScriptFormat) => void;
  isCompact?: boolean;
  customPrompt?: string;
  promptPresetId?: string;
  onUpdateTranslationPrompt?: (prompt: string, presetId: string) => void;
  onRetranslateSegments?: (prompt: string) => Promise<void>;
  onRetranscribeAudio?: (prompt: string) => Promise<void>;
  /** The transcript's explicit "Translate" choice; the only path that translates a waiting transcript. */
  onTranslateTranscript?: () => Promise<void>;
  /** Records where the target lines came from, e.g. 'custom' once a pasted script is applied. */
  onTargetSourceChange?: (source: TargetSource) => void;
  /** Where translation runs, for the choice panel. */
  translationSummary?: string | null;
  /** False when no translation engine is set up. */
  translationReady?: boolean;
  translationProgress?: RetranslateProgress | null;
  isTranslatingLanguage?: boolean;
  onOpenPromptModal?: () => void;
  onOpenVoiceChanger?: () => void;
  /** Opens the standalone text-to-speech studio. */
  onOpenTextToSpeech?: () => void;
  analysisSensitivity?: number;
  onSensitivityChange?: (sensitivity: number) => void;
  /** Whether uploads are transcribed with speakers told apart, and how many speakers (0: detect). */
  multiSpeakerInput?: boolean;
  onMultiSpeakerInputChange?: (enabled: boolean) => void;
  speakerCount?: number;
  onSpeakerCountChange?: (count: number) => void;
  /** Gives a speaker their own voice; null hands them back to the main voice. */
  onCastChange?: (speaker: string, voiceId: string | null) => void;
  /** Renames a speaker on every cue; a name already in use merges the two. */
  onRenameSpeaker?: (from: string, to: string) => void;
  /** How a mix of several voices above full scale is written. */
  mixPeak?: MixPeakMode;
  onMixPeakChange?: (mode: MixPeakMode) => void;
  onDownloadStem?: (speaker: string) => void;
}

export const ExpressDubWizard: React.FC<ExpressDubWizardProps> = ({
  activeStep,
  onStepChange,
  activeJob,
  onFileSelect,
  onLoadSampleSession,
  targetLanguage,
  onTargetLanguageChange,
  sourceLanguage = '',
  onSourceLanguageChange,
  languages,
  pipelineStatus = '',
  elVoiceId,
  onElVoiceIdChange,
  availableVoices,
  voiceEngine = 'elevenlabs',
  onVoiceEngineChange,
  onOpenPhoneticKeyboard,
  onAutoTranscribe,
  isTranscribing,
  onSynthesizeMaster,
  ttsModelName = 'ElevenLabs',
  elModelId,
  emotionEnhance = false,
  onEmotionEnhanceChange,
  dubMatchLoudness = false,
  onDubMatchLoudnessChange,
  onElModelIdChange,
  elModels = [],
  elApiKey = '',
  elVoiceSettings = null,
  onElVoiceSettingsChange,
  isSynthesizing,
  dubProgress = null,
  isCancellingDub = false,
  onCancelSynthesis,
  onSyncDub,
  isSyncing = false,
  syncProgress = null,
  isCancellingSync = false,
  onCancelSync,
  syncError = null,
  syncPendingLines = [],
  onApplySyncLine,
  onRetakeSyncLine,
  onUpdateSegment,
  onReplaceSegments,
  onPlaySegmentSolo,
  isPlaying,
  onTogglePlay,
  currentTime,
  getLiveTime,
  duration,
  onSeek,
  trackMode,
  onTrackModeChange,
  playbackRate = 1.0,
  onPlaybackRateChange,
  onResetSession,
  onDownloadWav,
  onDownloadSrt,
  onDownloadScript,
  isCompact = true,
  customPrompt,
  promptPresetId,
  onUpdateTranslationPrompt,
  onRetranslateSegments,
  onRetranscribeAudio,
  onTranslateTranscript,
  onTargetSourceChange,
  translationSummary = null,
  translationReady = true,
  translationProgress = null,
  isTranslatingLanguage,
  onOpenPromptModal,
  onOpenVoiceChanger,
  onOpenTextToSpeech,
  analysisSensitivity = 50,
  onSensitivityChange,
  multiSpeakerInput = false,
  onMultiSpeakerInputChange,
  speakerCount = 0,
  onSpeakerCountChange,
  onCastChange,
  onRenameSpeaker,
  mixPeak = 'float',
  onMixPeakChange,
  onDownloadStem,
}) => {
  const [playingSegmentId, setPlayingSegmentId] = useState<string | number | null>(null);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [isLocalPromptModalOpen, setIsLocalPromptModalOpen] = useState(false);

  // Pro Review Suite Mode & Controls
  const [reviewMode, setReviewMode] = useState<ReviewMode>('table');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pacingFilter, setPacingFilter] = useState<'all' | 'risk' | 'tight' | 'short'>('all');
  // Several speakers: whose cues the review shows (none: everyone), and labels to check.
  const [speakerFilter, setSpeakerFilter] = useState<string[]>([]);
  const [slipsOnly, setSlipsOnly] = useState(false);
  const [keptSlips, setKeptSlips] = useState<Set<string>>(() => new Set());
  // The speaker whose voice the library picks, or null for the main voice.
  const [castPickFor, setCastPickFor] = useState<string | null>(null);
  const [finalScriptLayout, setFinalScriptLayout] = useState<'dialogue' | 'timecoded' | 'bilingual'>('bilingual');
  const [isVoicePickerOpen, setIsVoicePickerOpen] = useState(false);
  const { favorites: favoriteVoices } = useFavoriteVoices();
  const [spotlightIndex, setSpotlightIndex] = useState<number>(0);
  const [copiedCueId, setCopiedCueId] = useState<string | number | null>(null);
  // The views scroll inside the editor panel, so their own height caps are off.
  const isListExpanded = true;
  const [isSrtModalOpen, setIsSrtModalOpen] = useState<boolean>(false);
  const [isAlignModalOpen, setIsAlignModalOpen] = useState<boolean>(false);
  const [srtOptions, setSrtOptions] = useState<SrtOptions>(() => {
    try {
      const saved = localStorage.getItem('dhvani_srt_options');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_SRT_OPTIONS;
  });
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);
  // Offered in the toast right after a pasted script replaces every cue.
  const [toastUndo, setToastUndo] = useState<(() => void) | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scriptScrollRef = useRef<HTMLDivElement>(null);
  const documentViewRef = useRef<ContinuousDocumentHandle>(null);

  // Pagination State for Long Scripts (30m to 1h) compatibility
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 35; // Ideal density for buttery smooth React rendering and DOM performance

  // Reset page to 1 when search or filter options change
  // The voice's own ElevenLabs settings: what a dub uses until a slider is moved.
  const [voiceOwnSettings, setVoiceOwnSettings] = useState<ElevenLabsVoiceSettings | null>(null);
  const showVoiceSliders = voiceEngine === 'elevenlabs' && Boolean(onElVoiceSettingsChange);
  useEffect(() => {
    setVoiceOwnSettings(null);
    if (!showVoiceSliders || !elVoiceId) return;
    let cancelled = false;
    getVoiceSettings(elApiKey, elVoiceId)
      .then((settings) => {
        if (!cancelled) setVoiceOwnSettings(settings);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showVoiceSliders, elApiKey, elVoiceId]);
  const shownVoiceSettings: ElevenLabsVoiceSettings = {
    ...DEFAULT_VOICE_SETTINGS,
    ...(elVoiceSettings || voiceOwnSettings || {}),
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pacingFilter, reviewMode]);

  // All cues change in one write: onUpdateSegment in a loop would keep only
  // the last cue, since every call starts from the same render's segments.
  const handleApplyAlignedSegments = (alignedItems: { id: string | number; textTarget: string }[]) => {
    if (!segments || segments.length === 0) return;
    const before = new Map(segments.map((seg) => [String(seg.id), { textTarget: seg.textTarget, targetText: seg.targetText }]));
    const byId = new Map(alignedItems.map((item) => [String(item.id), item.textTarget]));
    const sourceBefore: TargetSource = activeJob?.targetSource ?? 'translated';
    onReplaceSegments(
      segments.map((seg) => {
        const text = byId.get(String(seg.id));
        return text === undefined ? seg : { ...seg, textTarget: text, targetText: text };
      })
    );
    onTargetSourceChange?.('custom');

    if (toastTimer.current) clearTimeout(toastTimer.current);
    setExportSuccessMessage(`Your script is now in ${alignedItems.length} ${alignedItems.length === 1 ? 'cue' : 'cues'}`);
    setToastUndo(() => () => {
      // Only the text goes back; anything else changed since then stays.
      onReplaceSegments(
        latestSegments.current.map((seg) => {
          const previous = before.get(String(seg.id));
          return previous ? { ...seg, ...previous } : seg;
        })
      );
      // A transcript that was waiting for its script waits again.
      onTargetSourceChange?.(sourceBefore);
      setToastUndo(null);
      setExportSuccessMessage('The cues have their previous lines back');
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setExportSuccessMessage(null), 3000);
    });
    toastTimer.current = setTimeout(() => {
      setExportSuccessMessage(null);
      setToastUndo(null);
    }, 10000);
  };

  const scrollToTop = () => {
    // The document view scrolls its two columns itself.
    if (reviewMode === 'document') return documentViewRef.current?.scrollToEdge('top');
    if (scriptScrollRef.current) {
      scriptScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const scrollToBottom = () => {
    if (reviewMode === 'document') return documentViewRef.current?.scrollToEdge('bottom');
    if (scriptScrollRef.current) {
      scriptScrollRef.current.scrollTo({
        top: scriptScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  const renderPaginationControls = () => {
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-between gap-4 py-2 px-3 bg-slate-950/80 rounded-xl border border-slate-800 text-[11px] shadow-md animate-in fade-in duration-150">
        <div className="text-slate-400 font-medium">
          Cues <span className="text-indigo-400 font-bold">{(currentPage - 1) * itemsPerPage + 1} - {Math.min(filteredSegments.length, currentPage * itemsPerPage)}</span> of <span className="text-white font-bold">{filteredSegments.length}</span>
        </div>
        
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(1)}
            className="p-1 rounded-lg border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
            title="First Page"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
          
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
            className="px-2 py-1 rounded-lg border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-900 disabled:opacity-20 disabled:pointer-events-none transition-all flex items-center gap-1 font-semibold cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Prev</span>
          </button>
          
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-slate-900 border border-slate-800 font-medium">
            <span className="text-slate-400">Page</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (val >= 1 && val <= totalPages) {
                  setCurrentPage(val);
                }
              }}
              className="w-8 bg-slate-950 border border-slate-800 text-center rounded text-white font-bold text-xs focus:outline-none focus:border-indigo-500 py-0.5"
            />
            <span className="text-slate-500">of {totalPages}</span>
          </div>
          
          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
            className="px-2 py-1 rounded-lg border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-900 disabled:opacity-20 disabled:pointer-events-none transition-all flex items-center gap-1 font-semibold cursor-pointer"
          >
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          
          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(totalPages)}
            className="p-1 rounded-lg border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-900 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-pointer"
            title="Last Page"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  // The header shows and switches steps, so the step lives in App.
  const setStepOverride = onStepChange;
  // Step 4's settings, shared by its rail and the "Sync again" in its results.
  const [syncOptions, setSyncOptions] = useSyncOptions();
  const hasSegments = Boolean(activeJob && activeJob.segments.length > 0);

  const getSourceText = (seg: AudioSegment) => seg.textSource || seg.originalText || '';
  const getTargetText = (seg: AudioSegment) => seg.textTarget || seg.targetText || '';

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m}:${s < 10 ? '0' : ''}${s}.${ms}`;
  };

  const segments = activeJob?.segments || [];

  // Several speakers: who they are, labels that look like slips, and where two talk at once.
  const speakers = useMemo(() => listSpeakers(segments), [segments]);
  const multiSpeaker = useMemo(() => isMultiSpeaker(segments), [segments]);
  const speakerSlips = useMemo(() => {
    if (!multiSpeaker) return new Map<string, SpeakerSlip>();
    const slips = likelySlips(segments);
    for (const id of keptSlips) slips.delete(id);
    return slips;
  }, [segments, multiSpeaker, keptSlips]);
  const speakerOverlaps = useMemo(() => (multiSpeaker ? overlapsBefore(segments) : new Map<string, { speaker: string; seconds: number }>()), [segments, multiSpeaker]);
  const overlapIds = useMemo(() => new Set(speakerOverlaps.keys()), [speakerOverlaps]);
  const speakerByName = useMemo(() => new Map(speakers.map((s) => [s.name, s])), [speakers]);
  const cueIndexById = useMemo(() => new Map(segments.map((seg, i) => [String(seg.id), i])), [segments]);
  // A filter on a speaker who was renamed or merged away no longer applies.
  useEffect(() => {
    setSpeakerFilter((filter) => {
      const next = filter.filter((name) => speakerByName.has(name));
      return next.length === filter.length ? filter : next;
    });
    if (speakerSlips.size === 0) setSlipsOnly(false);
  }, [speakerByName, speakerSlips.size]);
  const latestSegments = useRef(segments);
  latestSegments.current = segments;
  const hasTranscript = segments.some((s) => (s.textSource || s.originalText || '').trim());
  // Transcribed, but translate-or-your-script has not been chosen yet.
  const awaitingScript = activeJob?.targetSource === 'pending';
  const scriptIsCustom = activeJob?.targetSource === 'custom';

  /*
   * The sync preview: step 4's before the first sync, and the Final script's
   * sync fit on step 3. The voice's speaking rate comes from the Final dub
   * when there is one (the characters it was voiced from over its seconds of
   * speech), else a typical rate, and both say which.
   */
  const dubSpeechSeconds = useMemo(
    () => (activeJob?.synthAudioBuffer ? measureSpeechSeconds(activeJob.synthAudioBuffer) : 0),
    [activeJob?.synthAudioBuffer]
  );
  const scriptCharacters = useMemo(() => scriptCharacterCount(segments), [segments]);
  // Counted when the dub was made, so editing lines afterwards doesn't shift the rate. Older dubs didn't save it.
  const rateCharacters = activeJob?.dubScriptCharacters ?? scriptCharacters;
  const measuredRate = activeJob?.synthesizedAudioUrl ? speakingRate(rateCharacters, dubSpeechSeconds) : null;
  // Rounded so small script edits don't move every estimate and refetch the preview.
  const previewRate = Math.round((measuredRate ?? TYPICAL_CHARS_PER_SECOND) * 10) / 10;
  const hasSyncReport = Boolean(activeJob?.syncedAudioUrl && activeJob?.syncReport);
  /*
   * The Sync step plays the synced dub as its second track once there is one
   * (App picks the same file), every other step the dub, which Sync leaves as
   * it was.
   */
  const onSyncedTrack = activeStep === 4 && hasSyncReport;
  /** The cues where Sync placed them, for subtitles that match the synced dub. */
  const syncedCues = useMemo(
    () => (hasSyncReport && activeJob?.syncReport ? syncedSegments(segments, activeJob.syncReport) : undefined),
    [hasSyncReport, activeJob?.syncReport, segments]
  );
  /*
   * Each track's own clock. The original's cues are the segments. The dub's
   * are where Sync placed them, which is the original's clock; before a sync
   * they are where the lines fall in the dub as voiced, estimated from line
   * lengths over its duration. While the unsynced dub is heard its clock
   * differs from the original's, so cue times are mapped between the two:
   * every playhead, caption, highlight and jump uses the clock being heard.
   */
  const dubBuffer = (onSyncedTrack ? activeJob?.syncedAudioBuffer : activeJob?.synthAudioBuffer) ?? null;
  const dubCues = useMemo(
    () =>
      (onSyncedTrack ? syncedCues : undefined) ??
      (dubBuffer ? adjustSegmentsForDubbedTimeline(segments, dubBuffer.duration) : segments),
    [onSyncedTrack, syncedCues, dubBuffer, segments]
  );
  const hasDubAudio = onSyncedTrack || Boolean(activeJob?.synthesizedAudioUrl);
  const hearingDub = trackMode === 'synth' && hasDubAudio;
  const dubToSource = useMemo(() => timelineMapper(dubCues, segments), [dubCues, segments]);
  const sourceToDub = useMemo(() => timelineMapper(segments, dubCues), [segments, dubCues]);
  const dubClockDiffers = hearingDub && !onSyncedTrack;
  /** A time on the heard clock as a time on the original's. */
  const toSourceClock = useCallback((t: number) => (dubClockDiffers ? dubToSource(t) : t), [dubClockDiffers, dubToSource]);
  /** A time on the original's clock as a time on the heard one. */
  const toHeardClock = useCallback((t: number) => (dubClockDiffers ? sourceToDub(t) : t), [dubClockDiffers, sourceToDub]);
  const sourceClockTime = toSourceClock(currentTime);
  const getSourceLiveTime = useMemo(
    () =>
      getLiveTime
        ? () => {
            const t = getLiveTime();
            return t === null ? null : toSourceClock(t);
          }
        : undefined,
    [getLiveTime, toSourceClock]
  );
  /** Seeks to a time on the original's clock, wherever that is on the heard track. */
  const seekSource = useCallback((t: number) => onSeek(toHeardClock(t)), [onSeek, toHeardClock]);
  const heardCues = hearingDub ? dubCues : segments;
  const heardBuffer = hearingDub ? dubBuffer : activeJob?.audioBuffer ?? null;
  const heardDuration = hearingDub ? dubBuffer?.duration || 0 : duration || activeJob?.audioBuffer?.duration || 0;

  /*
   * Switching between the original and an unsynced dub keeps the same moment
   * of speech, not the same second. Synced, the two share a clock.
   */
  const switchTrack = useCallback(
    (mode: 'source' | 'synth' | 'both', options: TrackSwitchOptions = {}) => {
      let seek = options.seek;
      const fromDub = trackMode === 'synth' && hasDubAudio;
      const toDub = mode === 'synth' && hasDubAudio;
      if (seek === undefined && !onSyncedTrack && fromDub !== toDub) {
        const now = getLiveTime?.() ?? currentTime;
        seek = fromDub ? dubToSource(now) : sourceToDub(now);
      }
      onTrackModeChange(mode, { ...options, seek });
    },
    [trackMode, hasDubAudio, onSyncedTrack, getLiveTime, currentTime, dubToSource, sourceToDub, onTrackModeChange]
  );
  /*
   * The sync previews draw lines where they will sit on the original's clock,
   * and their playheads read that clock whatever is heard. Playing or
   * clicking one keeps the track picked in Listen to (Original, Dub or Both);
   * a click is mapped onto the heard track's clock.
   */
  const previewSeek = seekSource;
  const previewTogglePlay = onTogglePlay;
  /** Plays from a time on the original's clock on the track picked in Listen to. */
  const listenHere = useCallback(
    (t: number) => switchTrack(trackMode, { seek: toHeardClock(t), play: true }),
    [switchTrack, trackMode, toHeardClock]
  );
  const listenOriginal = useCallback((t: number) => switchTrack('source', { seek: t, play: true }), [switchTrack]);
  /*
   * The unsynced dub is one take with its lines back to back, so it has no
   * place on the previews' timeline (the original's): a playhead there could
   * only guess the line, and would jump over every pause between lines. So
   * while it is heard the previews hide their playhead and say why.
   */
  const previewOffClockNote = dubClockDiffers ? (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        You're hearing the dub, which isn't synced yet: its lines run back to back, so they don't sit on this timeline. The player above shows where the
        dub is.
      </span>
      <button
        type="button"
        onClick={() => switchTrack('source', { play: true })}
        className="shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-xs text-slate-100 cursor-pointer"
      >
        <Play className="w-3 h-3 fill-current" /> Hear the original here
      </button>
    </span>
  ) : undefined;
  /** The preview line under the playhead, for the Final script to pick out and keep in view. */
  const [nowLineKey, setNowLineKey] = useState<string | null>(null);
  const finalListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!nowLineKey || !isPlaying) return;
    const list = finalListRef.current;
    const row = document.getElementById(`final-line-${nowLineKey}`);
    if (!list || !row || !list.contains(row)) return;
    // Scroll the list itself, never the page, and only when the line has left it.
    const top = row.offsetTop; // The list is positioned, so this is from its top.
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: Math.max(0, top - list.clientHeight * 0.25), behavior: 'smooth' });
    }
  }, [nowLineKey, isPlaying]);

  const syncPreview = useSyncPreview({
    enabled:
      ((activeStep === 4 && !hasSyncReport) || (activeStep === 3 && !isSynthesizing)) && !isSyncing && segments.length > 0,
    segments,
    precision: syncOptions.precision,
    join: syncOptions.join,
    charsPerSecond: previewRate,
    sourceDuration: activeJob?.audioBuffer?.duration || 0,
  });

  /** Puts a wording of a preview line into the script, spread over its cues; returns their texts before. */
  const applyPreviewLine = (unit: SyncPreviewUnit, text: string) => {
    const ids = unit.cueIds.map(String);
    const cues = segments.filter((seg) => ids.includes(String(seg.id)));
    const before = Object.fromEntries(cues.map((cue) => [String(cue.id), getTargetText(cue)]));
    const texts = distributeLineText(text, cues.map(getTargetText));
    const byId = new Map(cues.map((cue, n) => [String(cue.id), texts[n] ?? '']));
    onReplaceSegments(
      segments.map((seg) => {
        const next = byId.get(String(seg.id));
        return next === undefined ? seg : { ...seg, textTarget: next, targetText: next };
      })
    );
    return before;
  };
  const restoreCueTexts = (before: Record<string, string>) =>
    onReplaceSegments(
      segments.map((seg) => {
        const text = before[String(seg.id)];
        return text === undefined ? seg : { ...seg, textTarget: text, targetText: text };
      })
    );
  /** A shorter or a fuller wording of a line, from the text model; the line's status decides which. */
  const suggestLine = (unit: SyncPreviewUnit, avoid: string[], direction: RewriteDirection) =>
    (direction === 'longer' ? suggestLongerLine : suggestShorterLine)({
      text: unit.text,
      sourceText: unit.sourceText,
      language: targetLanguage,
      targetChars: unit.targetChars,
      avoid,
    });
  /** Step 3's rewording, kept apart from step 4's so each step's rows are its own. */
  const finalFixes = useLineFixes({ onSuggest: suggestLine, onUseLine: applyPreviewLine, onRestore: restoreCueTexts });
  /** The Review step's rewording, one cue at a time. */
  const reviewFixes = useLineFixes({ onSuggest: suggestLine, onUseLine: applyPreviewLine, onRestore: restoreCueTexts });
  /** The preview with the lengths the user trimmed lines to on the timeline; both steps use it. */
  const linePreview = useMemo(() => withLineTargets(syncPreview.preview, segments), [syncPreview.preview, segments]);
  /** The dub bar picked on the Final dub timeline, for trimming. */
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  const selectedLine = linePreview?.units.find((u) => u.key === selectedLineKey) || null;
  /**
   * A cue's colour: its line's (lineColors.ts), so a line keeps one colour here,
   * in the sync preview and in the sync report. Until the preview has grouped
   * the cues into lines each cue takes its own; a cue in no line (no words) has none.
   */
  // Once synced, the report's lines: they are the ones the synced dub was built from.
  const cueLines = useMemo(
    () => lineIndexByCue(hasSyncReport ? activeJob?.syncReport?.units : linePreview?.units),
    [hasSyncReport, activeJob?.syncReport, linePreview]
  );
  const cueColor = useCallback(
    (seg: AudioSegment, index: number): string | null => {
      if (cueLines.size === 0) return hueOf(index);
      const line = cueLines.get(String(seg.id));
      return line === undefined ? null : hueOf(line);
    },
    [cueLines]
  );
  /**
   * The Final dub lanes in line colours: each cue's stretch of the original and
   * of the dub, and where each line starts on both. Kept between renders, since
   * a new set of spans redraws the waveforms.
   */
  const lineLanes = useMemo(() => {
    const cueColors = segments.map((seg, i) => cueColor(seg, i));
    const dubById = new Map(dubCues.map((cue) => [String(cue.id), cue]));
    const sourceSpans: { from: number; to: number; color: string }[] = [];
    const dubSpans: { from: number; to: number; color: string }[] = [];
    const lineStarts: { source: number; dub: number; color: string }[] = [];
    segments.forEach((seg, i) => {
      const color = cueColors[i];
      if (!color) return;
      sourceSpans.push({ from: seg.startTime, to: seg.endTime, color });
      const cue = dubById.get(String(seg.id));
      if (!cue) return;
      dubSpans.push({ from: cue.startTime, to: cue.endTime, color });
      // One link per line, from its first cue.
      const sameLine = i > 0 && cueLines.size > 0 && cueLines.get(String(seg.id)) === cueLines.get(String(segments[i - 1].id));
      if (!sameLine) lineStarts.push({ source: seg.startTime, dub: cue.startTime, color });
    });
    return { cueColors, sourceSpans, dubSpans, lineStarts };
  }, [segments, dubCues, cueColor, cueLines]);
  /**
   * Saves a line's trimmed length on its first cue, or clears it with null.
   * The line's work starts over, so its direction is decided from the new length.
   */
  const trimLine = (unit: SyncPreviewUnit, seconds: number | null) => {
    const first = String(unit.cueIds[0]);
    onReplaceSegments(
      segments.map((seg) => {
        if (String(seg.id) !== first) return seg;
        const { dubTargetSeconds: _old, ...rest } = seg;
        return seconds === null ? rest : { ...rest, dubTargetSeconds: seconds };
      })
    );
    finalFixes.reset(unit);
  };
  const [finalScriptFilter, setFinalScriptFilter] = useState<ScriptFitFilter>('all');
  /**
   * The Final script's rows, one block per sync line: cues Sync voices as one
   * clip stay together, so the line's fit and its suggestion sit once beside
   * all of them. Cues with nothing to voice stand alone.
   */
  const finalScriptGroups = useMemo(() => {
    const unitOf = new Map<string, SyncPreviewUnit>();
    for (const unit of linePreview?.units || []) for (const id of unit.cueIds) unitOf.set(String(id), unit);
    const groups: { key: string; unit: SyncPreviewUnit | null; cues: { seg: AudioSegment; index: number }[] }[] = [];
    segments.forEach((seg, index) => {
      const unit = unitOf.get(String(seg.id)) || null;
      const last = groups[groups.length - 1];
      if (unit && last?.unit === unit) last.cues.push({ seg, index });
      else groups.push({ key: unit ? `line-${unit.key}` : `cue-${seg.id}`, unit, cues: [{ seg, index }] });
    });
    return groups;
  }, [segments, linePreview]);
  const finalToFix = (linePreview?.units || []).filter((u) => needsFix(u) && finalFixes.notStarted(u));

  const filteredSegments = useMemo(() => {
    return segments.filter((seg) => {
      const srcText = getSourceText(seg).toLowerCase();
      const tgtText = getTargetText(seg).toLowerCase();
      const speaker = (seg.speaker || '').toLowerCase();
      const q = searchQuery.trim().toLowerCase();

      if (speakerFilter.length > 0 && !speakerFilter.includes(speakerOf(seg))) return false;
      if (slipsOnly && !speakerSlips.has(String(seg.id))) return false;

      if (q && !srcText.includes(q) && !tgtText.includes(q) && !speaker.includes(q)) {
        return false;
      }

      const charCount = getTargetText(seg).length;
      const cps = seg.duration > 0 ? charCount / seg.duration : 0;

      if (pacingFilter === 'risk') return cps > 18;
      if (pacingFilter === 'tight') return cps > 14 && cps <= 18;
      if (pacingFilter === 'short') return endsEarly(seg, getTargetText(seg));
      return true;
    });
  }, [segments, searchQuery, pacingFilter, speakerFilter, slipsOnly, speakerSlips]);

  const activeSegmentId = useMemo(() => {
    return segments.find((s) => sourceClockTime >= s.startTime && sourceClockTime <= s.endTime)?.id || null;
  }, [segments, sourceClockTime]);

  // Auto-page progression on playback or segment updates
  useEffect(() => {
    if (activeSegmentId) {
      const idx = filteredSegments.findIndex((s) => s.id === activeSegmentId);
      if (idx !== -1) {
        const pageOfActiveSegment = Math.floor(idx / itemsPerPage) + 1;
        if (pageOfActiveSegment !== currentPage) {
          setCurrentPage(pageOfActiveSegment);
        }
      }
    }
  }, [activeSegmentId, filteredSegments, currentPage]);

  const riskCuesCount = useMemo(() => {
    return segments.filter((seg) => {
      const cps = seg.duration > 0 ? getTargetText(seg).length / seg.duration : 0;
      return cps > 18;
    }).length;
  }, [segments]);

  /*
    The same report the QA cockpit shows, computed here so the ribbon badge and
    the step footer can warn about blocking issues without the reviewer having
    to open the cockpit to find out they exist.
  */
  const { terms: glossaryTerms } = useGlossaryTerms();
  const [qaConfig] = useQaConfig();
  const { signoff: qaSignoff } = useSignoff(activeJob?.id ?? null, targetLanguage);
  const qaReport = useMemo(
    () => runQa(segments, { language: targetLanguage, glossary: glossaryTerms, config: qaConfig }),
    [segments, targetLanguage, glossaryTerms, qaConfig]
  );
  /** What ElevenLabs is asked to voice, which is what a dub is billed on. */
  const dubCharacterCount = useMemo(
    () => segments.reduce((sum, seg) => sum + getTargetText(seg).length, 0),
    [segments]
  );

  /** "Aaditya" out of "Aaditya - Rich, Deep and Suspenseful", for button labels. */
  const voiceShortName = useMemo(() => {
    const full =
      availableVoices?.find((v) => v.voice_id === elVoiceId)?.name ||
      POPULAR_ELEVENLABS_VOICES.find((v) => v.id === elVoiceId)?.name ||
      '';
    return full.trim().split(/\s+[-–—|]\s+/)[0];
  }, [availableVoices, elVoiceId]);

  /**
   * Where a dub in flight has got to, as a cue. Streamed audio is measured in
   * seconds against the source's length; without streaming only finished
   * passages count, so the cue range of the passage being voiced is shown.
   */
  const dubStartedAtRef = useRef<number | null>(null);
  if (isSynthesizing && dubStartedAtRef.current === null) dubStartedAtRef.current = Date.now();
  if (!isSynthesizing) dubStartedAtRef.current = null;

  const dubRun = useMemo(() => {
    if (!isSynthesizing) return null;
    // Cumulative share of the script's characters at the end of each cue.
    const lengths = segments.map((seg) => getTargetText(seg).length);
    const total = lengths.reduce((a, b) => a + b, 0) || 1;
    let running = 0;
    const cueEnds = lengths.map((n) => (running += n) / total);
    const cueAt = (fraction: number) => {
      const i = cueEnds.findIndex((end) => end > fraction);
      return i === -1 ? segments.length - 1 : i;
    };

    const p = dubProgress;
    const sourceLength =
      activeJob?.audioBuffer?.duration || segments[segments.length - 1]?.endTime || 0;
    const charsFraction = p && p.totalChars > 0 ? p.charsDone / p.totalChars : 0;
    const secondsFraction = p?.streaming && sourceLength > 0 ? p.secondsGenerated / sourceLength : 0;
    const joining = p?.phase === 'joining';
    // Never claim the end before the last passage is in.
    const fraction = joining ? 1 : Math.min(0.98, Math.max(charsFraction, secondsFraction));

    // Without streaming, the passage being voiced runs from what's done to the next boundary.
    const passageEnd = p && p.passageCount > 0 ? Math.min(1, charsFraction + 1 / p.passageCount) : 1;
    const elapsed = dubStartedAtRef.current ? (Date.now() - dubStartedAtRef.current) / 1000 : 0;
    const secondsLeft = fraction > 0.05 && !joining ? (elapsed * (1 - fraction)) / fraction : null;

    return {
      phase: p?.phase || 'preparing',
      streaming: p?.streaming !== false,
      fraction,
      currentCue: cueAt(fraction),
      rangeStart: cueAt(charsFraction),
      rangeEnd: cueAt(Math.max(charsFraction, passageEnd - 0.0001)),
      cuesDone: fraction >= 1 ? segments.length : cueAt(fraction),
      secondsLeft,
      passagesDone: p?.passagesDone ?? 0,
      passageCount: p?.passageCount ?? 0,
    };
  }, [isSynthesizing, dubProgress, segments, activeJob?.audioBuffer]);

  const pacingCounts = useMemo(() => {
    const counts = { natural: 0, tight: 0, fast: 0, short: 0 };
    segments.forEach((seg) => {
      counts[getPace(getTargetText(seg), seg.duration).level]++;
      if (endsEarly(seg, getTargetText(seg))) counts.short++;
    });
    return counts;
  }, [segments]);

  /** Unwaived QA findings, blocking ones first, for the review panel. */
  const openFindings = useMemo(() => {
    const waived = qaSignoff?.overrides || {};
    return qaReport.findings
      .filter((f) => !waived[f.id])
      .sort((x, y) => Number(y.severity === 'block') - Number(x.severity === 'block') || x.cueNumber - y.cueNumber);
  }, [qaReport.findings, qaSignoff]);

  const qaBlockingCount = useMemo(() => {
    const waived = qaSignoff?.overrides || {};
    return qaReport.findings.filter((f) => f.severity === 'block' && !waived[f.id]).length;
  }, [qaReport.findings, qaSignoff]);

  const handleJumpToCue = (seg: AudioSegment) => {
    const idx = segments.findIndex((s) => s.id === seg.id);
    if (idx !== -1) setSpotlightIndex(idx);
    seekSource(seg.startTime);
    // The document shows every cue, so it opens the cue in place.
    if (reviewMode === 'document') {
      documentViewRef.current?.reveal(seg.id, { focus: true });
      return;
    }
    setReviewMode('table');

    /*
      A search or pacing filter can be hiding the very cue the reviewer asked
      to open, so clear whatever would exclude it and jump straight to its page.
    */
    let listed = filteredSegments;
    if (!listed.some((s) => s.id === seg.id)) {
      setSearchQuery('');
      setPacingFilter('all');
      listed = segments;
    }
    const position = listed.findIndex((s) => s.id === seg.id);
    if (position !== -1) setCurrentPage(Math.floor(position / itemsPerPage) + 1);

    // The card only exists once the grid has rendered on the right page.
    window.setTimeout(() => {
      document.getElementById(`cue-card-${seg.id}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 120);
  };

  const totalPages = useMemo(() => {
    return Math.ceil(filteredSegments.length / itemsPerPage);
  }, [filteredSegments.length]);

  const paginatedSegments = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredSegments.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredSegments, currentPage]);

  const handleCopyText = (id: string | number, text: string) => {
    try {
      navigator.clipboard.writeText(text);
      setCopiedCueId(id);
      setTimeout(() => setCopiedCueId(null), 1500);
    } catch (e) {
      console.warn('Clipboard write failed:', e);
    }
  };

  const handleExportTargetScript = (format: TargetScriptFormat = 'dialogue') => {
    if (onDownloadScript) {
      onDownloadScript(format);
      setExportSuccessMessage(`Saved the ${targetLanguage} script`);
      setTimeout(() => setExportSuccessMessage(null), 3000);
      return;
    }

    if (!activeJob || !segments || segments.length === 0) return;
    const scriptContent = generateTargetLanguageScript(
      segments,
      targetLanguage,
      format,
      activeJob.file?.name ? `Dhvani Studio - ${activeJob.file.name}` : undefined
    );
    const cleanLang = (targetLanguage || 'script').toLowerCase().replace(/\s+/g, '_');
    const extension = format === 'json' ? 'json' : format === 'csv' ? 'csv' : 'txt';
    const mimeType =
      format === 'json'
        ? 'application/json'
        : format === 'csv'
        ? 'text/csv'
        : 'text/plain;charset=utf-8';
    const fileName = `dhvani_${cleanLang}_script_${format}.${extension}`;

    downloadFile(scriptContent, fileName, mimeType);
    setExportSuccessMessage(`Saved the ${targetLanguage} script`);
    setTimeout(() => setExportSuccessMessage(null), 3000);
  };

  const handleCopyFullTargetScript = (format: TargetScriptFormat = 'dialogue') => {
    if (!segments || segments.length === 0) return;
    const scriptContent = generateTargetLanguageScript(segments, targetLanguage, format);
    try {
      navigator.clipboard.writeText(scriptContent);
      setExportSuccessMessage(`Copied the ${targetLanguage} script`);
      setTimeout(() => setExportSuccessMessage(null), 3000);
    } catch (e) {
      console.warn('Clipboard write failed:', e);
    }
  };

  /** Subtitles from step 4, timed to the synced dub: each cue where Sync placed its line. */
  const handleExportStepSubtitles = (format: 'srt' | 'vtt') => {
    if (!syncedCues || syncedCues.length === 0) return;
    const content = format === 'srt' ? generateSrtContent(syncedCues, srtOptions) : generateVttContent(syncedCues, srtOptions);
    const cleanLang = (targetLanguage || 'captions').toLowerCase().replace(/\s+/g, '_');
    downloadFile(content, `dhvani_${cleanLang}_synced_subtitles.${format}`, format === 'srt' ? 'text/srt;charset=utf-8' : 'text/vtt;charset=utf-8');
    setExportSuccessMessage(`Saved the .${format} subtitles, timed to the synced dub`);
    setTimeout(() => setExportSuccessMessage(null), 3500);
  };

  const getCpsInfo = (charCount: number, duration: number) => {
    const cps = duration > 0 ? charCount / duration : 0;
    if (cps > 18) {
      return {
        cps: cps.toFixed(1),
        label: 'Fast (>18 CPS)',
        badgeClass: 'text-amber-300 bg-amber-950/80 border border-amber-800/80',
        barColor: 'bg-amber-500',
        warning: 'High text density: voice may speak quickly to fit time window.',
      };
    }
    if (cps > 14) {
      return {
        cps: cps.toFixed(1),
        label: 'Moderate (14-18 CPS)',
        badgeClass: 'text-cyan-300 bg-cyan-950/80 border border-cyan-800/80',
        barColor: 'bg-cyan-500',
        warning: null,
      };
    }
    return {
      cps: cps.toFixed(1),
      label: 'Optimal (≤14 CPS)',
      badgeClass: 'text-emerald-300 bg-emerald-950/80 border border-emerald-800/80',
      barColor: 'bg-emerald-500',
      warning: null,
    };
  };

  /*
   * The original and a dub, one lane each, as the Final dub step and the Sync
   * step show them; click a lane to jump there. The lane not being heard is
   * dimmed, and a click on it starts it at that point.
   */
  const renderTrackLanes = (lanes: TrackLane[], rulerLength: number, links?: LaneLink[]) => (
    <div className="grid grid-cols-1 sm:grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-center">
      {lanes.map((lane, laneIndex) => {
        const muted = lane.track === 'source' ? trackMode === 'synth' : trackMode === 'source';
        return (
          <React.Fragment key={lane.label}>
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
              <span className={`w-2 h-2 rounded-sm shrink-0 ${lane.dot}`} />
              {lane.label}
            </span>
            <div
              role="slider"
              tabIndex={0}
              aria-label={`${lane.label} position`}
              aria-valuemin={0}
              aria-valuemax={Math.round(lane.length)}
              aria-valuenow={Math.round(muted ? 0 : currentTime)}
              onClick={(e) => {
                if (lane.length <= 0) return;
                const r = e.currentTarget.getBoundingClientRect();
                const t = ((e.clientX - r.left) / r.width) * lane.length;
                // A time on this lane's own track: a muted lane starts being heard there.
                if (muted) switchTrack(lane.track, { seek: t });
                else onSeek(t);
              }}
              onKeyDown={(e) => {
                if (muted) return;
                if (e.key === 'ArrowRight') onSeek(Math.min(lane.length, currentTime + 5));
                if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 5));
              }}
              className={`relative h-14 rounded-lg bg-slate-950/60 overflow-hidden cursor-pointer transition-opacity ${muted ? 'opacity-40' : ''}`}
            >
              {lane.spans &&
                lane.length > 0 &&
                lane.spans.map((span, n) => (
                  <span
                    key={n}
                    aria-hidden="true"
                    className="absolute top-1.5 bottom-1.5 rounded pointer-events-none"
                    style={{
                      left: `${(span.from / lane.length) * 100}%`,
                      width: `${Math.max(0.2, ((span.to - span.from) / lane.length) * 100)}%`,
                      background: withAlpha(span.color, 0.12),
                    }}
                  />
                ))}
              {lane.buffer ? (
                <MiniWaveform buffer={lane.buffer} className={`relative ${lane.color}`} spans={lane.spans} />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">Waveform not available</span>
              )}
              {/* Only on lanes being heard, at the heard position over that lane's own length. */}
              {!muted && lane.length > 0 && (
                <LanePlayhead currentTime={currentTime} isPlaying={isPlaying} getLiveTime={getLiveTime} totalLength={lane.length} />
              )}
            </div>
            {/* Each line's start on this lane joined to its start on the next */}
            {links && laneIndex === 0 && lanes.length > 1 && (
              <>
                <span className="hidden sm:block text-[10px] text-slate-500">Same line</span>
                <svg viewBox="0 0 1000 20" preserveAspectRatio="none" className="w-full h-5" aria-hidden="true">
                  {links.map((link, n) => (
                    <path
                      key={n}
                      d={`M ${link.from * 1000} 0 C ${link.from * 1000} 11, ${link.to * 1000} 9, ${link.to * 1000} 20`}
                      fill="none"
                      stroke={link.color}
                      strokeOpacity={0.6}
                      strokeWidth={1.25}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
              </>
            )}
          </React.Fragment>
        );
      })}
      <div className="sm:col-start-2 flex justify-between font-mono text-[10px] text-slate-500 tabular-nums">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{formatClock(rulerLength * f)}</span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="w-full flex-1 flex flex-col space-y-4 sm:space-y-5">
      {/* ========================================================================= */}
      {/* STEP 1: MEDIA, LANGUAGES & VOICE */}
      {/* ========================================================================= */}
      {activeStep === 1 && (
        <div className="flex-1 flex flex-col gap-4 animate-in fade-in duration-200">
          <MediaStrip
            file={activeJob?.file ?? null}
            audioBuffer={activeJob?.audioBuffer ?? null}
            onFileSelect={onFileSelect}
            onLoadSample={(sample) => {
              onLoadSampleSession(sample);
              setStepOverride(2);
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem] gap-4 items-stretch lg:flex-1">
            {/* Voice library: the main decision on this step */}
            <VoiceSelectorCard
              elVoiceId={elVoiceId}
              onElVoiceIdChange={onElVoiceIdChange}
              availableVoices={availableVoices}
              targetLanguage={targetLanguage}
              voiceEngine={voiceEngine}
              onVoiceEngineChange={onVoiceEngineChange}
              // Zero height + full min-height: the setup panel alone sets the row height,
              // and the voice list scrolls inside it instead of leaving a gap below the panel.
              className="lg:h-0 lg:min-h-full"
            />

            {/* Setup panel */}
            <aside
              aria-label="Dub setup"
              className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden flex flex-col"
            >
              <h2 className="px-4 sm:px-5 pt-4 text-[15px] font-semibold text-slate-100">Dub setup</h2>

              <div className="px-4 sm:px-5 py-4 flex flex-col gap-2.5">
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <label htmlFor="express-wizard-source-lang-select" className="text-xs text-slate-400">
                      Spoken in
                    </label>
                    <div className="relative group">
                      <select
                        id="express-wizard-source-lang-select"
                        value={sourceLanguage}
                        onChange={(e) => onSourceLanguageChange?.(e.target.value)}
                        disabled={!onSourceLanguageChange}
                        className="appearance-none w-full h-10 bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-xl pl-3 pr-9 text-[13px] font-medium text-slate-100 truncate transition-colors focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 cursor-pointer disabled:cursor-default"
                      >
                        <option value="" className="bg-slate-900">Auto detect</option>
                        <option value="English" className="bg-slate-900">English</option>
                        {languages.map((lang) => {
                          const code = typeof lang === 'string' ? lang : lang.code;
                          const label = typeof lang === 'string' ? lang : lang.label;
                          return (
                            <option key={`src-${code}`} value={code} className="bg-slate-900">
                              {label}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown
                        aria-hidden="true"
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-hover:text-slate-300 group-focus-within:text-indigo-400 transition-colors"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const from = sourceLanguage;
                      onSourceLanguageChange?.(targetLanguage);
                      onTargetLanguageChange(from);
                    }}
                    disabled={!onSourceLanguageChange || !sourceLanguage || sourceLanguage === 'English'}
                    className="w-9 h-10 flex items-center justify-center rounded-xl border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors cursor-pointer"
                    title="Swap languages"
                    aria-label="Swap languages"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                  </button>

                  <div className="flex flex-col gap-1.5 min-w-0">
                    <label htmlFor="express-wizard-lang-select" className="text-xs text-slate-400">
                      Dub into
                    </label>
                    <div className="relative group">
                      <select
                        id="express-wizard-lang-select"
                        value={targetLanguage}
                        onChange={(e) => onTargetLanguageChange(e.target.value)}
                        className="appearance-none w-full h-10 bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-xl pl-3 pr-9 text-[13px] font-medium text-slate-100 truncate transition-colors focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 cursor-pointer"
                      >
                        {languages.map((lang) => {
                          const code = typeof lang === 'string' ? lang : lang.code;
                          const label = typeof lang === 'string' ? lang : lang.label;
                          return (
                            <option key={code} value={code} className="bg-slate-900">
                              {label}
                            </option>
                          );
                        })}
                      </select>
                      <ChevronDown
                        aria-hidden="true"
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-hover:text-slate-300 group-focus-within:text-indigo-400 transition-colors"
                      />
                    </div>
                  </div>
                </div>
                <p className="text-[11.5px] text-slate-500 leading-relaxed">
                  Auto detect works for most talks. Set the language when speakers mix languages.
                </p>
              </div>

              {onMultiSpeakerInputChange && (
                <div className="px-4 sm:px-5 py-4 border-t border-slate-800 flex flex-col gap-2.5">
                  <label className="flex items-start justify-between gap-3 cursor-pointer">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[13px] font-semibold text-slate-100">More than one person speaks</span>
                      <span className="text-[11.5px] text-slate-500 leading-snug">
                        ElevenLabs labels who says each line, so every speaker can get their own voice.
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={multiSpeakerInput}
                      aria-label="More than one person speaks"
                      onClick={() => onMultiSpeakerInputChange(!multiSpeakerInput)}
                      className={`relative w-9 h-5 rounded-full shrink-0 mt-0.5 transition-colors cursor-pointer ${
                        multiSpeakerInput ? 'bg-indigo-500' : 'bg-slate-700'
                      }`}
                    >
                      <span
                        className={`absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white transition-all ${multiSpeakerInput ? 'left-[19px]' : 'left-[3px]'}`}
                      />
                    </button>
                  </label>
                  {multiSpeakerInput && onSpeakerCountChange && (
                    <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                      <label htmlFor="express-wizard-speaker-count">How many speakers</label>
                      <select
                        id="express-wizard-speaker-count"
                        value={speakerCount}
                        onChange={(e) => onSpeakerCountChange(Number(e.target.value))}
                        className="h-8 bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-lg px-2 text-xs font-medium text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value={0} className="bg-slate-900">Detect</option>
                        {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
                          <option key={n} value={n} className="bg-slate-900">
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {multiSpeakerInput && speakerCount === 0 && (
                    <p className="text-[11px] text-slate-500 leading-snug">Setting the number helps when two voices sound alike.</p>
                  )}
                  {multiSpeakerInput && activeJob && segments.length > 0 && !multiSpeaker && onRetranscribeAudio && (
                    <button
                      type="button"
                      onClick={() => onRetranscribeAudio(activeJob.customPrompt ?? customPrompt ?? '').catch(() => {})}
                      disabled={isTranscribing}
                      title="This file was transcribed as one speaker. Transcribing again clears its translated lines."
                      className={`${railButton} w-full`}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isTranscribing ? 'animate-spin' : ''}`} />
                      {isTranscribing ? 'Transcribing…' : 'Transcribe again to find speakers'}
                    </button>
                  )}
                </div>
              )}

              <div className="px-4 sm:px-5 py-4 border-t border-slate-800 flex flex-col gap-2.5">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Voice</span>
                <SelectedVoiceSummary voiceId={elVoiceId} availableVoices={availableVoices} />
              </div>

              {onSensitivityChange && (
                <div className="px-4 sm:px-5 py-4 border-t border-slate-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[13px]">
                    <label htmlFor="express-wizard-pause" className="text-slate-200">
                      Pause detection
                    </label>
                    <span className="font-mono text-slate-400 tabular-nums">{analysisSensitivity}</span>
                  </div>
                  <input
                    id="express-wizard-pause"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={analysisSensitivity}
                    onChange={(e) => onSensitivityChange(Number(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10.5px] text-slate-500">
                    <span>Fewer, longer lines</span>
                    <span>More, shorter lines</span>
                  </div>
                </div>
              )}

              {onOpenVoiceChanger && (
                <div className="px-4 sm:px-5 py-4 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={onOpenVoiceChanger}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-800 hover:bg-slate-800/60 text-left transition-colors cursor-pointer"
                  >
                    <span className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 flex items-center justify-center shrink-0">
                      <AudioWaveform className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-100">Voice changer</span>
                      <span className="block text-xs text-slate-500 truncate">
                        Keep the delivery, swap the speaker's voice
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                  </button>
                  {onOpenTextToSpeech && (
                    <button
                      type="button"
                      onClick={onOpenTextToSpeech}
                      className="mt-2 w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-800 hover:bg-slate-800/60 text-left transition-colors cursor-pointer"
                    >
                      <span className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 flex items-center justify-center shrink-0">
                        <Speech className="w-4 h-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-slate-100">Text to speech</span>
                        <span className="block text-xs text-slate-500 truncate">
                          Voice any text with ElevenLabs or Cartesia
                        </span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                    </button>
                  )}
                </div>
              )}

              <div className="mt-auto px-4 sm:px-5 py-4 border-t border-slate-800 bg-slate-950/60 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    // Transcribing again replaces the cues, and with them any script on them.
                    if (
                      hasTranscript &&
                      !awaitingScript &&
                      !window.confirm(
                        scriptIsCustom
                          ? 'Transcribe again? The new transcript replaces the current cues and your aligned script. You can paste the script again afterwards.'
                          : 'Transcribe again? The new transcript replaces the current cues and their translation.'
                      )
                    ) {
                      return;
                    }
                    await onAutoTranscribe();
                    setStepOverride(2);
                  }}
                  disabled={!activeJob || isTranscribing}
                  className="h-11 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer active:translate-y-px"
                >
                  {isTranscribing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Transcribing…</span>
                    </>
                  ) : activeJob ? (
                    <>
                      <Mic className="w-4 h-4" />
                      <span>{hasTranscript ? 'Transcribe again' : 'Transcribe audio'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  ) : (
                    <span>Add media to continue</span>
                  )}
                </button>

                {isTranscribing && pipelineStatus ? (
                  <div className="flex items-center gap-2 text-xs text-indigo-200 font-mono" role="status" aria-live="polite">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />
                    <span className="truncate">{pipelineStatus}</span>
                  </div>
                ) : (
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>Transcribe</span>
                    <span aria-hidden="true">→</span>
                    <span>Word timings</span>
                    <span aria-hidden="true">→</span>
                    <span>Translate or your script</span>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 2: PRO REVIEW & TRANSLATION POLISH */}
      {/* ========================================================================= */}
      {activeStep === 2 && activeJob && (
        <div className="flex-1 flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Interactive Audio Waveform & Pro Audition Player */}
          {/* The waveform, cues and clock of the track being heard. */}
          <ReviewWaveformPlayer
            audioBuffer={heardBuffer}
            segments={heardCues}
            currentTime={currentTime}
            getLiveTime={getLiveTime}
            duration={heardDuration}
            isPlaying={isPlaying}
            onTogglePlay={onTogglePlay}
            onSeek={onSeek}
            onSelectSegment={(seg) => {
              const idx = segments.findIndex((s) => s.id === seg.id);
              if (idx !== -1) setSpotlightIndex(idx);
              const cardEl = document.getElementById(`cue-card-${seg.id}`);
              if (cardEl) {
                cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }
              documentViewRef.current?.reveal(seg.id);
            }}
            targetLanguage={targetLanguage}
            playbackRate={playbackRate}
            onPlaybackRateChange={onPlaybackRateChange}
            trackMode={trackMode}
            onTrackModeChange={switchTrack}
            hasSynthesizedAudio={Boolean(activeJob.synthesizedAudioUrl)}
            sensitivity={analysisSensitivity}
            onSensitivityChange={onSensitivityChange}
          />

          {multiSpeaker && (
            <SpeakerBar
              speakers={speakers}
              segments={segments}
              duration={activeJob.audioBuffer?.duration || duration}
              currentTime={sourceClockTime}
              onSeek={seekSource}
              filter={speakerFilter}
              onFilterChange={(filter) => {
                setSpeakerFilter(filter);
                setCurrentPage(1);
              }}
              slipCount={speakerSlips.size}
              slipsShown={slipsOnly}
              onShowSlips={() => {
                setSlipsOnly((on) => !on);
                setReviewMode('table');
                setCurrentPage(1);
              }}
              onRenameSpeaker={onRenameSpeaker}
              overlapIds={overlapIds}
            />
          )}

          {/*
            Transcribed but no script yet: the user chooses automatic
            translation or their own script before the editor opens.
          */}
          {awaitingScript ? (
            <TargetScriptChoice
              segments={segments}
              spokenLanguage={activeJob.detectedLanguage || activeJob.sourceLanguage || ''}
              targetLanguage={targetLanguage}
              languages={languages}
              onTargetLanguageChange={onTargetLanguageChange}
              isTranscribing={isTranscribing}
              pipelineStatus={pipelineStatus}
              isTranslating={Boolean(isTranslatingLanguage)}
              translationProgress={translationProgress}
              translationStyleName={getPresetById(promptPresetId || DEFAULT_PROMPT_PRESET_ID).name}
              translationSummary={translationSummary}
              translationReady={translationReady}
              onOpenPromptModal={() => {
                if (onOpenPromptModal) onOpenPromptModal();
                else setIsLocalPromptModalOpen(true);
              }}
              onTranslate={async () => {
                if (onTranslateTranscript) await onTranslateTranscript();
                else if (onRetranslateSegments) await onRetranslateSegments(customPrompt || '');
              }}
              onUseOwnScript={() => setIsAlignModalOpen(true)}
              onSeek={seekSource}
              activeSegmentId={activeSegmentId}
            />
          ) : (
          /* Workspace: cue editor and review panel share one height, so neither leaves a gap */
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_25rem] gap-4 lg:h-[calc(100vh-7rem)] lg:min-h-[600px]">
            <section
              aria-label="Translation cues"
              className="flex flex-col min-h-0 h-[78vh] lg:h-auto bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden"
            >
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-b border-slate-800">
                <div
                  role="group"
                  aria-label="View"
                  className="flex bg-slate-950 border border-slate-800 rounded-xl p-0.5 gap-0.5 max-w-full overflow-x-auto [scrollbar-width:none]"
                >
                  {REVIEW_VIEWS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={reviewMode === id}
                      onClick={() => setReviewMode(id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                        reviewMode === id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{label}</span>
                      {id === 'qa' &&
                        (qaBlockingCount > 0 ? (
                          <span className="px-1.5 rounded-md bg-rose-600 text-white text-[10px] font-mono font-semibold leading-4">
                            {qaBlockingCount}
                          </span>
                        ) : qaReport.warningCount > 0 ? (
                          <span className="px-1.5 rounded-md bg-amber-500 text-slate-950 text-[10px] font-mono font-semibold leading-4">
                            {qaReport.warningCount}
                          </span>
                        ) : (
                          <Check className="w-3 h-3 text-emerald-400" />
                        ))}
                    </button>
                  ))}
                </div>

                {/* The cockpit does its own filtering, so these would only confuse. */}
                {reviewMode !== 'qa' && (
                  <>
                    <div className="relative flex-1 min-w-[10rem]">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="express-step2-search"
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (reviewMode === 'document' && e.key === 'Enter') {
                            e.preventDefault();
                            documentViewRef.current?.stepMatch(e.shiftKey ? -1 : 1);
                          }
                        }}
                        placeholder={reviewMode === 'document' ? 'Find in script' : 'Find in cues'}
                        className="w-full h-8 bg-slate-950 border border-slate-800 rounded-xl pl-8 pr-7 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-200 cursor-pointer"
                          aria-label="Clear search"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    <div role="group" aria-label="Pacing filter" className="flex items-center gap-1.5">
                      {[
                        { id: 'all' as const, label: 'All', count: segments.length, dot: '' },
                        { id: 'risk' as const, label: 'Too fast', count: pacingCounts.fast, dot: 'bg-rose-400' },
                        { id: 'tight' as const, label: 'Tight', count: pacingCounts.tight, dot: 'bg-amber-400' },
                        { id: 'short' as const, label: 'Ends early', count: pacingCounts.short, dot: 'bg-sky-400' },
                      ].map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          aria-pressed={pacingFilter === f.id}
                          onClick={() => setPacingFilter(f.id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                            pacingFilter === f.id
                              ? 'bg-slate-100 text-slate-900 border-slate-100'
                              : 'border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                          }`}
                        >
                          {f.dot && <span className={`w-1.5 h-1.5 rounded-full ${f.dot}`} />}
                          {f.label}
                          <span className="font-mono text-[10px] opacity-70 tabular-nums">{f.count}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {onOpenPhoneticKeyboard && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenPhoneticKeyboard(
                        reviewMode === 'document' ? documentViewRef.current?.lastFocusedSegment() ?? undefined : undefined
                      )
                    }
                    className="ml-auto w-8 h-8 flex items-center justify-center rounded-xl border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Open the Indic phonetic keyboard"
                    aria-label="Open the Indic phonetic keyboard"
                  >
                    <Keyboard className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Active view */}
              <div ref={scriptScrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar">
                <div
                  className={
                    reviewMode === 'table' ? '' : reviewMode === 'document' ? 'h-full p-3 sm:p-4' : 'p-3 sm:p-4 space-y-4'
                  }
                >
          {/* ========================================================================= */}
          {/* OPTION 5: QA & SIGN-OFF COCKPIT */}
          {/* ========================================================================= */}
          {reviewMode === 'qa' && (
            <QaCockpit
              jobId={activeJob.id}
              fileName={activeJob.file?.name}
              segments={segments}
              targetLanguage={targetLanguage}
              onUpdateSegment={onUpdateSegment}
              onJumpToCue={handleJumpToCue}
            />
          )}

          {/* ========================================================================= */}
          {/* OPTION 6: CONTINUOUS DOCUMENT (the whole script as running prose) */}
          {/* ========================================================================= */}
          {reviewMode === 'document' && segments.length > 0 && (
            <ContinuousDocumentView
              ref={documentViewRef}
              segments={segments}
              sourceLanguage={activeJob.detectedLanguage || activeJob.sourceLanguage || sourceLanguage}
              targetLanguage={targetLanguage}
              getSourceText={getSourceText}
              getTargetText={getTargetText}
              onUpdateSegment={onUpdateSegment}
              getPaceLevel={(seg) => getPace(getTargetText(seg), seg.duration).level}
              isEndingEarly={(seg) => endsEarly(seg, getTargetText(seg))}
              pacingFilter={pacingFilter}
              searchQuery={searchQuery}
              activeSegmentId={activeSegmentId}
              isPlaying={isPlaying}
              onSeek={seekSource}
            />
          )}

          {/* Empty Filter State (the document dims and highlights instead of filtering) */}
          {reviewMode !== 'qa' && reviewMode !== 'document' && filteredSegments.length === 0 && (
            <div className="m-3 p-8 rounded-2xl bg-slate-950/60 border border-dashed border-slate-800 text-center space-y-2">
              <p className="text-sm font-semibold text-slate-300">No dialogue cues matched your filter</p>
              <p className="text-xs text-slate-500">Try changing your search query or pacing filter.</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setPacingFilter('all');
                }}
                className="mt-2 text-xs text-indigo-400 hover:underline font-semibold"
              >
                Reset Search & Filters
              </button>
            </div>
          )}

          {/* ========================================================================= */}
          {/* OPTION 1: STUDIO CARDS (Side-by-Side Pro Grid) */}
          {/* ========================================================================= */}
          {reviewMode === 'grid' && filteredSegments.length > 0 && (
            <div className="space-y-4">
              {renderPaginationControls()}
              
              <div
                className={`space-y-3 pr-2 scroll-smooth ${
                  isListExpanded
                    ? 'overflow-visible pb-12'
                    : 'max-h-[65vh] min-h-[360px] overflow-y-auto overscroll-contain pb-8 custom-scrollbar'
                }`}
              >
                {paginatedSegments.map((seg, index) => {
                  const srcText = getSourceText(seg);
                  const tgtText = getTargetText(seg);
                  const isCuePlaying = playingSegmentId === seg.id;
                  const isCueActive =
                    (sourceClockTime >= seg.startTime && sourceClockTime <= seg.endTime) || isCuePlaying;
                  const charCount = tgtText.length;
                  const cpsInfo = getCpsInfo(charCount, seg.duration);
                  const isCopied = copiedCueId === seg.id;

                  return (
                    <div
                      key={seg.id}
                      id={`cue-card-${seg.id}`}
                      className={`p-3.5 rounded-2xl transition-all flex flex-col gap-2.5 shadow-sm border ${
                        isCueActive
                          ? 'bg-slate-900 border-indigo-500 ring-2 ring-indigo-500/30 shadow-indigo-500/10'
                          : 'bg-slate-900/70 border-slate-800 hover:border-indigo-500/50'
                      }`}
                    >
                      {/* Card Header: Timing, Speaker, CPS Health, Audition Button */}
                      <div className="flex flex-wrap items-center justify-between text-xs border-b border-slate-200 dark:border-slate-800/80 pb-2 gap-2">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-transparent flex items-center justify-center font-mono text-[10px] font-bold">
                            {(currentPage - 1) * itemsPerPage + index + 1}
                          </span>
                        <span className="font-mono text-cyan-600 dark:text-cyan-400 font-bold text-[11px]">
                          [{formatSeconds(seg.startTime)} - {formatSeconds(seg.endTime)}]
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          ({seg.duration.toFixed(1)}s window)
                        </span>
                        <span className="text-slate-700 dark:text-slate-300 font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-0.5 rounded-md text-[10px]">
                          {seg.speaker || 'Speaker'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Pacing health badge */}
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded-md ${cpsInfo.badgeClass}`}
                          title="Characters per second pacing for this cue duration"
                        >
                          {cpsInfo.label}
                        </span>

                        {/* Copy Translated Text Button */}
                        <button
                          type="button"
                          onClick={() => handleCopyText(seg.id, tgtText)}
                          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 text-[11px] transition-all shadow-2xs"
                          title="Copy translated text"
                        >
                          {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{isCopied ? 'Copied' : 'Copy'}</span>
                        </button>

                        {/* Solo play original audio button */}
                        <button
                          type="button"
                          onClick={() => {
                            setPlayingSegmentId(seg.id);
                            onPlaySegmentSolo(seg);
                            setTimeout(() => setPlayingSegmentId(null), seg.duration * 1000 + 500);
                          }}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
                            isCuePlaying
                              ? 'bg-amber-600 text-white border-amber-500 animate-pulse'
                              : 'bg-slate-900 text-slate-300 hover:text-indigo-200 hover:bg-slate-800 border-slate-800 hover:border-indigo-500/40'
                          }`}
                          title="Listen to original speech audio for this line"
                        >
                          {isCuePlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                          <span>{isCuePlaying ? 'Auditioning...' : 'Listen Original'}</span>
                        </button>
                      </div>
                    </div>

                    {/* Side-by-Side: Original Source Dialogue vs Target Translation */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                      {/* Source Audio Transcription */}
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-mono tracking-wider text-slate-500">
                          Original Audio Transcription:
                        </label>
                        <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs text-slate-300 leading-relaxed font-sans min-h-[56px]">
                          {srcText || <span className="text-slate-600 italic">No original transcription available</span>}
                        </div>
                      </div>

                      {/* Target Translation (Editable directly with Phonetic Roman to Indic support) */}
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase font-mono tracking-wider text-indigo-400 flex items-center justify-between">
                          <span>{targetLanguage} Translation:</span>
                          <span className="text-slate-500 font-sans normal-case text-[10px]">
                            {charCount} characters ({cpsInfo.cps} chars/s)
                          </span>
                        </label>
                        <PhoneticSmartTextarea
                          showQuickSymbols={false}
                          value={tgtText}
                          language={targetLanguage}
                          onChange={(newVal) =>
                            onUpdateSegment(seg.id, {
                              textTarget: newVal,
                              targetText: newVal,
                            })
                          }
                          onOpenKeyboardModal={
                            onOpenPhoneticKeyboard ? () => onOpenPhoneticKeyboard(seg) : undefined
                          }
                          rows={2}
                          placeholder={`Translated text in ${targetLanguage}...`}
                        />
                      </div>
                    </div>

                    {/* Fast Pacing Warning Advice */}
                    {cpsInfo.warning && (
                      <div className="text-[11px] text-amber-400 bg-amber-950/40 border border-amber-900/60 rounded-xl px-2.5 py-1 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                        <span>{cpsInfo.warning} Consider tightening phrasing to maintain natural conversational cadence.</span>
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
              
              {renderPaginationControls()}
            </div>
          )}

          {/* ========================================================================= */}
          {/* OPTION 2: CUES (default): one row per cue, English beside the editable translation */}
          {/* ========================================================================= */}
          {reviewMode === 'table' && filteredSegments.length > 0 && (
            <div>
              <div className="hidden md:grid grid-cols-[3.5rem_5.5rem_minmax(0,1fr)_minmax(0,1.15fr)_5.5rem] gap-4 px-4 py-2 sticky top-0 z-10 bg-slate-900 border-b border-slate-800 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                <span>#</span>
                <span>Time</span>
                <span>Original</span>
                <span>{targetLanguage}</span>
                <span className="text-right">Pacing</span>
              </div>

              {paginatedSegments.map((seg, index) => {
                const srcText = getSourceText(seg);
                const tgtText = getTargetText(seg);
                const isCuePlaying = playingSegmentId === seg.id;
                const isCueActive = (sourceClockTime >= seg.startTime && sourceClockTime <= seg.endTime) || isCuePlaying;
                const pace = getPace(tgtText, seg.duration);
                // The cue's own number, so a filtered list still names cues as everywhere else.
                const cueNumber = (cueIndexById.get(String(seg.id)) ?? (currentPage - 1) * itemsPerPage + index) + 1;

                return (
                  <div
                    key={seg.id}
                    id={`cue-card-${seg.id}`}
                    className={`relative grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[3.5rem_5.5rem_minmax(0,1fr)_minmax(0,1.15fr)_5.5rem] gap-x-4 gap-y-2 px-4 py-3 border-b border-slate-800 transition-colors ${
                      isCueActive ? 'bg-indigo-950/40' : 'hover:bg-slate-800/30'
                    }`}
                  >
                    {isCueActive && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-indigo-400" />}

                    {/* Number and audition */}
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPlayingSegmentId(seg.id);
                          onPlaySegmentSolo(seg);
                          setTimeout(() => setPlayingSegmentId(null), seg.duration * 1000 + 500);
                        }}
                        className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                          isCuePlaying
                            ? 'bg-indigo-500 border-indigo-500 text-white'
                            : 'border-slate-700 text-slate-300 hover:border-indigo-400 hover:text-indigo-300'
                        }`}
                        title="Listen to the original line"
                        aria-label={`Listen to cue ${cueNumber}`}
                      >
                        {isCuePlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-px" />}
                      </button>
                      <span className="font-mono text-[11px] text-slate-500 pt-1.5 tabular-nums">
                        {String(cueNumber).padStart(2, '0')}
                      </span>
                    </div>

                    {/* Time: click to jump the player here */}
                    <button
                      type="button"
                      onClick={() => seekSource(seg.startTime)}
                      className="self-start text-left font-mono text-[11.5px] text-slate-300 hover:text-indigo-300 leading-snug tabular-nums cursor-pointer md:pt-1"
                      title="Jump the player to this cue"
                    >
                      {formatSeconds(seg.startTime)}
                      <span className="md:block text-[10.5px] text-slate-500 ml-1.5 md:ml-0">{seg.duration.toFixed(1)}s</span>
                    </button>

                    {/* Pacing (right column on desktop, top-right on phones) */}
                    <div className="md:order-last flex flex-col items-end gap-1.5 md:pt-1">
                      <span className={`font-mono text-[10.5px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${pace.pillClass}`}>
                        {pace.cps.toFixed(1)} cps
                      </span>
                      <span className="w-16 h-1 rounded-full bg-slate-800 overflow-hidden">
                        <span className={`block h-full rounded-full ${pace.barClass}`} style={{ width: `${pace.meter}%` }} />
                      </span>
                      <span className="text-[10.5px] text-slate-500">{pace.label}</span>
                    </div>

                    {/* Original */}
                    <div className="col-span-3 md:col-span-1 text-[13px] text-slate-400 leading-relaxed">
                      {multiSpeaker ? (
                        <span className="block mb-1">
                          <SpeakerPicker
                            value={speakerOf(seg)}
                            speakers={speakers}
                            onChange={(speaker) => onUpdateSegment(seg.id, { speaker })}
                          />
                        </span>
                      ) : (
                        seg.speaker && (
                          <span className="block text-[10.5px] uppercase tracking-wide font-semibold text-slate-500 mb-0.5">
                            {seg.speaker}
                          </span>
                        )
                      )}
                      {srcText || <span className="text-slate-600 italic">No original text</span>}
                      {multiSpeaker && (
                        <SpeakerCueNotes
                          current={speakerOf(seg)}
                          slip={speakerSlips.get(String(seg.id))}
                          overlap={speakerOverlaps.get(String(seg.id))}
                          onHear={() => {
                            setPlayingSegmentId(seg.id);
                            onPlaySegmentSolo(seg);
                            setTimeout(() => setPlayingSegmentId(null), seg.duration * 1000 + 500);
                          }}
                          onAccept={(speaker) => onUpdateSegment(seg.id, { speaker })}
                          onKeep={() => setKeptSlips((kept) => new Set(kept).add(String(seg.id)))}
                        />
                      )}
                    </div>

                    {/* Translation */}
                    <div className="col-span-3 md:col-span-1 min-w-0">
                      <PhoneticSmartTextarea
                        showQuickSymbols={false}
                        value={tgtText}
                        language={targetLanguage}
                        onChange={(newVal) =>
                          onUpdateSegment(seg.id, {
                            textTarget: newVal,
                            targetText: newVal,
                          })
                        }
                        onOpenKeyboardModal={onOpenPhoneticKeyboard ? () => onOpenPhoneticKeyboard(seg) : undefined}
                        rows={2}
                        placeholder={`${targetLanguage} line`}
                        compactToolbar
                      />
                      {(() => {
                        const { cps: lineCps, ...line } = reviewLineOf(seg, tgtText, srcText);
                        const fix = reviewFixes.controlsFor(line);
                        const flagged = line.status === 'long' || line.status === 'short';
                        if (!flagged && fix.state.kind === 'idle') return null;
                        const started = fix.state.kind !== 'idle' && fix.state.kind !== 'error';
                        return (
                          <>
                            {!started && line.status === 'long' && (
                              <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-rose-300 leading-snug">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                                <span>Too long for {seg.duration.toFixed(1)}s. Shorten it so the voice doesn't rush.</span>
                              </p>
                            )}
                            {!started && line.status === 'short' && (
                              <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-sky-300 leading-snug">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                                <span>
                                  Ends about {line.underflow.toFixed(1)}s before the original speaker stops. A fuller line fills the gap.
                                </span>
                              </p>
                            )}
                            <LineFixControls unit={line} cps={lineCps} {...fix} />
                          </>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}

              <div className="p-3">{renderPaginationControls()}</div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* OPTION 3: SPOTLIGHT LINE-BY-LINE (Focused Teleprompter Review) */}
          {/* ========================================================================= */}
          {reviewMode === 'spotlight' && filteredSegments.length > 0 && (() => {
            const safeIndex = Math.min(spotlightIndex, filteredSegments.length - 1);
            const currentSeg = filteredSegments[safeIndex] || filteredSegments[0];
            const srcText = getSourceText(currentSeg);
            const tgtText = getTargetText(currentSeg);
            const isCuePlaying = playingSegmentId === currentSeg.id;
            const charCount = tgtText.length;
            const cpsInfo = getCpsInfo(charCount, currentSeg.duration);

            return (
              <div className="space-y-3 bg-slate-900/80 border border-slate-800 p-4 sm:p-6 rounded-2xl shadow-sm">
                {/* Spotlight Navigation Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-xl bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-950 dark:border-indigo-700/60 dark:text-indigo-400 font-mono text-xs font-bold">
                      Cue {safeIndex + 1} of {filteredSegments.length}
                    </span>
                    <span className="font-mono text-cyan-600 dark:text-cyan-400 font-bold text-xs">
                      [{formatSeconds(currentSeg.startTime)} - {formatSeconds(currentSeg.endTime)}] ({currentSeg.duration.toFixed(1)}s)
                    </span>
                    <span className="text-slate-700 dark:text-slate-300 font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 px-2 py-0.5 rounded text-xs">
                      {currentSeg.speaker || 'Speaker'}
                    </span>
                  </div>

                  {/* Previous / Next Stepper & Audition Button */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSpotlightIndex((prev) => Math.max(0, prev - 1))}
                      disabled={safeIndex === 0}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 text-xs font-semibold transition-all shadow-xs"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Previous Cue</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setSpotlightIndex((prev) => Math.min(filteredSegments.length - 1, prev + 1))}
                      disabled={safeIndex >= filteredSegments.length - 1}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 text-xs font-semibold transition-all shadow-xs"
                    >
                      <span>Next Cue</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                    {/* Audition Current Cue */}
                    <button
                      type="button"
                      onClick={() => {
                        setPlayingSegmentId(currentSeg.id);
                        onPlaySegmentSolo(currentSeg);
                        setTimeout(() => setPlayingSegmentId(null), currentSeg.duration * 1000 + 500);
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                        isCuePlaying
                          ? 'bg-amber-600 text-white border-amber-500 animate-pulse'
                          : 'bg-indigo-600 text-white hover:bg-indigo-500 border-indigo-500'
                      }`}
                    >
                      {isCuePlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      <span>{isCuePlaying ? 'Playing Audio...' : 'Audition Line'}</span>
                    </button>
                  </div>
                </div>

                {/* Original Transcription Display */}
                <div className="space-y-1.5">
                  <label className="text-xs uppercase font-mono tracking-wider text-slate-400">
                    Original Speech (Source Audio):
                  </label>
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-sm text-slate-200 leading-relaxed font-sans">
                    {srcText || <span className="text-slate-500 italic">No audio transcription available</span>}
                  </div>
                </div>

                {/* Target Translation Large Input */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs uppercase font-mono tracking-wider text-indigo-400 font-bold">
                      {targetLanguage} Translated Script (Editable):
                    </label>
                    <div className="flex items-center gap-2">
                      <span className={`text-[11px] font-mono px-2 py-0.5 rounded-md ${cpsInfo.badgeClass}`}>
                        {cpsInfo.label}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        {charCount} chars
                      </span>
                    </div>
                  </div>
                  <PhoneticSmartTextarea
                          showQuickSymbols={false}
                    value={tgtText}
                    language={targetLanguage}
                    onChange={(newVal) =>
                      onUpdateSegment(currentSeg.id, {
                        textTarget: newVal,
                        targetText: newVal,
                      })
                    }
                    onOpenKeyboardModal={
                      onOpenPhoneticKeyboard ? () => onOpenPhoneticKeyboard(currentSeg) : undefined
                    }
                    rows={3}
                    placeholder={`Type translation in ${targetLanguage}...`}
                  />
                </div>

                {/* Thumbnail Strip to Jump Between Cues */}
                <div className="pt-2 border-t border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                    <span>Jump to Cue:</span>
                    <span>Showing window around #{safeIndex + 1} of {filteredSegments.length}</span>
                  </div>
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {safeIndex > 7 && (
                      <button
                        type="button"
                        onClick={() => setSpotlightIndex(0)}
                        className="px-2 py-1 rounded-lg text-[10px] font-mono font-bold bg-slate-900 border border-slate-850 hover:text-white text-slate-400 shrink-0 transition-all"
                      >
                        &laquo; First (#1)
                      </button>
                    )}
                    {filteredSegments.map((s, idx) => {
                      if (Math.abs(idx - safeIndex) > 7) return null;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSpotlightIndex(idx)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all shrink-0 ${
                            idx === safeIndex
                              ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500'
                              : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
                          }`}
                        >
                          #{idx + 1}
                        </button>
                      );
                    })}
                    {safeIndex < filteredSegments.length - 8 && (
                      <button
                        type="button"
                        onClick={() => setSpotlightIndex(filteredSegments.length - 1)}
                        className="px-2 py-1 rounded-lg text-[10px] font-mono font-bold bg-slate-900 border border-slate-850 hover:text-white text-slate-400 shrink-0 transition-all"
                      >
                        Last (#{filteredSegments.length}) &raquo;
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ========================================================================= */}
          {/* OPTION 4: CONTINUOUS SCRIPT (Dual-Column Full Flow Review) */}
          {/* ========================================================================= */}
          {reviewMode === 'script' && filteredSegments.length > 0 && (
            <div className="space-y-4">
              {renderPaginationControls()}
              
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-4">
                <div
                  className={`scroll-smooth pr-2 custom-scrollbar ${
                    isListExpanded
                      ? 'overflow-visible pb-12'
                      : 'max-h-[65vh] min-h-[360px] overflow-y-auto overscroll-contain pb-8'
                  }`}
                >
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Column 1: Full Original Script */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <span className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider">
                          Original Audio Script Flow
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono">Reference</span>
                      </div>

                      <div className="space-y-3">
                        {paginatedSegments.map((seg, idx) => (
                          <div
                            key={seg.id}
                            className="p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-1"
                          >
                            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                              <span className="font-bold text-slate-400">
                                [{(currentPage - 1) * itemsPerPage + idx + 1}] {seg.speaker || 'Speaker'}
                              </span>
                              <span className="text-cyan-400">
                                {formatSeconds(seg.startTime)} - {formatSeconds(seg.endTime)}
                              </span>
                            </div>
                            <p className="text-xs text-slate-200 leading-relaxed font-sans">
                              {getSourceText(seg)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Column 2: Full Translated Script (Editable) */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-indigo-400 uppercase font-mono tracking-wider">
                            {targetLanguage} Translated Script Flow
                          </span>
                          <span className="text-[11px] text-slate-500 font-mono">Direct Editing</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleExportTargetScript('dialogue')}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 hover:text-white text-[11px] font-semibold transition-all shadow-xs"
                            title="Download translated script as .TXT file"
                          >
                            <Download className="w-3 h-3 text-indigo-400" />
                            <span>Export .TXT</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyFullTargetScript()}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white text-[11px] font-semibold transition-all shadow-xs"
                            title="Copy full translated script to clipboard"
                          >
                            <Copy className="w-3 h-3 text-slate-400" />
                            <span>Copy</span>
                          </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        {paginatedSegments.map((seg, idx) => (
                          <div
                            key={seg.id}
                            className="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-1 hover:border-indigo-500/60 transition-all"
                          >
                            <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                              <span className="font-bold text-indigo-300">
                                [{(currentPage - 1) * itemsPerPage + idx + 1}] {targetLanguage}
                              </span>
                              <span>{getTargetText(seg).length} chars</span>
                            </div>
                            <PhoneticSmartTextarea
                          showQuickSymbols={false}
                              value={getTargetText(seg)}
                              language={targetLanguage}
                              onChange={(newVal) =>
                                onUpdateSegment(seg.id, {
                                  textTarget: newVal,
                                  targetText: newVal,
                                })
                              }
                              onOpenKeyboardModal={
                                onOpenPhoneticKeyboard ? () => onOpenPhoneticKeyboard(seg) : undefined
                              }
                              rows={2}
                              placeholder={`Type translation in ${targetLanguage}...`}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              {renderPaginationControls()}
            </div>
          )}

                </div>
              </div>

              <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-slate-800 text-[11px] text-slate-500">
                <span className="tabular-nums">
                  {reviewMode === 'qa' || reviewMode === 'document'
                    ? `${segments.length} cues`
                    : `Showing ${filteredSegments.length} of ${segments.length} cues`}
                </span>
                <span className="hidden sm:flex items-center gap-3">
                  <button type="button" onClick={scrollToTop} className="flex items-center gap-1 hover:text-slate-200 cursor-pointer">
                    <ChevronsUp className="w-3.5 h-3.5" /> Top
                  </button>
                  <button type="button" onClick={scrollToBottom} className="flex items-center gap-1 hover:text-slate-200 cursor-pointer">
                    <ChevronsDown className="w-3.5 h-3.5" /> Bottom
                  </button>
                </span>
              </div>
            </section>

            {/* Review panel */}
            <aside
              aria-label="Review"
              className="flex flex-col min-h-0 bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between gap-2 px-4 sm:px-5 pt-4">
                <h2 className="text-[15px] font-semibold text-slate-100">Review</h2>
                <button
                  type="button"
                  onClick={() => setStepOverride(1)}
                  className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  ← Source &amp; voice
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                {/* Pacing health */}
                <div className="px-4 sm:px-5 py-4 flex flex-col gap-2.5">
                  <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Pacing health</span>
                  <div className="flex h-2 rounded-full overflow-hidden gap-0.5 bg-slate-800">
                    {segments.length > 0 && (
                      <>
                        <span className="bg-emerald-400" style={{ width: `${(pacingCounts.natural / segments.length) * 100}%` }} />
                        <span className="bg-amber-400" style={{ width: `${(pacingCounts.tight / segments.length) * 100}%` }} />
                        <span className="bg-rose-400" style={{ width: `${(pacingCounts.fast / segments.length) * 100}%` }} />
                      </>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Natural', value: pacingCounts.natural, dot: 'bg-emerald-400', filter: 'all' as const },
                      { label: 'Tight', value: pacingCounts.tight, dot: 'bg-amber-400', filter: 'tight' as const },
                      { label: 'Too fast', value: pacingCounts.fast, dot: 'bg-rose-400', filter: 'risk' as const },
                    ].map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => {
                          setReviewMode(reviewMode === 'qa' ? 'table' : reviewMode);
                          setPacingFilter(s.filter);
                        }}
                        className="text-left rounded-lg -m-1 p-1 hover:bg-slate-800/60 cursor-pointer"
                        title={s.filter === 'all' ? 'Show all cues' : `Show ${s.label.toLowerCase()} cues`}
                      >
                        <span className="block text-lg font-semibold text-slate-100 tabular-nums leading-tight">{s.value}</span>
                        <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
                          {s.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Needs attention */}
                <div className="px-4 sm:px-5 py-4 border-t border-slate-800 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Needs attention</span>
                    {openFindings.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setReviewMode('qa')}
                        className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                      >
                        All {openFindings.length} →
                      </button>
                    )}
                  </div>
                  {openFindings.length === 0 ? (
                    <p className="flex items-center gap-2 text-xs text-emerald-300">
                      <CheckCircle2 className="w-4 h-4" /> No QA issues found
                    </p>
                  ) : (
                    openFindings.slice(0, 3).map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          const seg = segments.find((s) => s.id === f.segmentId);
                          if (seg) handleJumpToCue(seg);
                        }}
                        className="w-full flex items-start gap-2.5 p-2.5 rounded-xl border border-slate-800 hover:bg-slate-800/50 text-left transition-colors cursor-pointer"
                      >
                        <span
                          className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                            f.severity === 'block' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          <AlertTriangle className="w-3 h-3" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-semibold text-slate-100 truncate">{f.title}</span>
                          <span className="block text-[11.5px] text-slate-400 line-clamp-2">{f.detail}</span>
                        </span>
                        <span className="font-mono text-[10.5px] text-slate-500 shrink-0">#{f.cueNumber}</span>
                      </button>
                    ))
                  )}
                </div>

                {/* Translation */}
                <div className="px-4 sm:px-5 py-4 border-t border-slate-800 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Translation</span>
                    <span
                      className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${
                        scriptIsCustom ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-300'
                      }`}
                      title={
                        scriptIsCustom
                          ? 'The cues hold the script you pasted, aligned to the transcript. It was not translated.'
                          : 'The cues hold the automatic translation of the transcript.'
                      }
                    >
                      {scriptIsCustom ? 'Your script' : 'Automatic'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
                    <span className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0">
                      <SlidersHorizontal className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-100 truncate">
                        {getPresetById(promptPresetId || DEFAULT_PROMPT_PRESET_ID).name}
                      </span>
                      <span className="block text-[11.5px] text-slate-400">Translation style</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (onOpenPromptModal) onOpenPromptModal();
                        else setIsLocalPromptModalOpen(true);
                      }}
                      className="px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[11.5px] font-medium text-slate-200 cursor-pointer"
                    >
                      Change
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <label htmlFor="express-step2-lang-select" className="text-xs text-slate-400 shrink-0">
                      Dub into
                    </label>
                    <select
                      id="express-step2-lang-select"
                      value={targetLanguage}
                      onChange={(e) => onTargetLanguageChange(e.target.value)}
                      className="flex-1 min-w-0 h-8 bg-slate-950 border border-slate-800 rounded-lg px-2 text-xs font-medium text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer"
                    >
                      {languages.map((lang) => {
                        const code = typeof lang === 'string' ? lang : lang.code;
                        const label = typeof lang === 'string' ? lang : lang.label;
                        return (
                          <option key={code} value={code} className="bg-slate-900">
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {onRetranslateSegments && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            scriptIsCustom &&
                            !window.confirm(
                              `Replace your script with an automatic ${targetLanguage} translation? This uses translation credits. You can paste your script again afterwards.`
                            )
                          ) {
                            return;
                          }
                          onRetranslateSegments(customPrompt || '').catch(() => {
                            // The failure is shown in the job's warning banner.
                          });
                        }}
                        disabled={isTranslatingLanguage || segments.length === 0}
                        className={railButton}
                        title={
                          scriptIsCustom
                            ? 'Replace your script with an automatic translation of the transcript'
                            : 'Translate every cue again with the current style'
                        }
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isTranslatingLanguage ? 'animate-spin' : ''}`} />
                        {isTranslatingLanguage ? 'Translating…' : 'Re-translate'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsAlignModalOpen(true)}
                      disabled={segments.length === 0}
                      className={railButton}
                      title="Paste your own translated script; each part is matched to the English cue it translates"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5" />
                      Paste script
                    </button>
                  </div>
                </div>

                {/* Tools */}
                {(onSensitivityChange || onOpenVoiceChanger || onOpenTextToSpeech) && (
                  <div className="px-4 sm:px-5 py-4 border-t border-slate-800 flex flex-col gap-3">
                    {onSensitivityChange && (
                      <PauseSensitivityControl
                        variant="compact"
                        sensitivity={analysisSensitivity}
                        onChange={onSensitivityChange}
                        segmentCount={segments.length}
                      />
                    )}
                    {onOpenVoiceChanger && (
                      <button
                        type="button"
                        onClick={onOpenVoiceChanger}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-800 hover:bg-slate-800/60 text-left transition-colors cursor-pointer"
                      >
                        <span className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 flex items-center justify-center shrink-0">
                          <AudioWaveform className="w-4 h-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-slate-100">Voice changer</span>
                          <span className="block text-xs text-slate-500 truncate">Keep the delivery, swap the speaker's voice</span>
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                      </button>
                    )}
                    {onOpenTextToSpeech && (
                      <button
                        type="button"
                        onClick={onOpenTextToSpeech}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-800 hover:bg-slate-800/60 text-left transition-colors cursor-pointer"
                      >
                        <span className="w-8 h-8 rounded-lg bg-slate-950 border border-slate-800 text-slate-400 flex items-center justify-center shrink-0">
                          <Speech className="w-4 h-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-slate-100">Text to speech</span>
                          <span className="block text-xs text-slate-500 truncate">Voice any text with ElevenLabs or Cartesia</span>
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/*
                Continuing only moves on to Step 3. Dubbing spends ElevenLabs
                credits, so it starts from Step 3 once a voice is picked. A dub can
                still be run with QA issues outstanding, but not without being told.
              */}
              <div className="px-4 sm:px-5 py-4 border-t border-slate-800 bg-slate-950/60 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStepOverride(3);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  disabled={activeJob.segments.length === 0}
                  className="h-11 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer active:translate-y-px"
                >
                  {isSynthesizing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Dubbing in progress, view it
                    </>
                  ) : (
                    <>
                      Continue to dub <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
                {activeJob.synthesizedAudioUrl && (
                  <button
                    type="button"
                    onClick={async () => {
                      setStepOverride(3);
                      await onSynthesizeMaster();
                    }}
                    disabled={isSynthesizing || activeJob.segments.length === 0}
                    className={`${railButton} h-9`}
                    title="Discard the existing dub and make it again from the current script"
                  >
                    <Volume2 className="w-3.5 h-3.5" /> Dub again from this script
                  </button>
                )}
                <p className={`text-center text-[11.5px] ${qaBlockingCount > 0 ? 'text-rose-300' : 'text-slate-500'}`}>
                  {qaBlockingCount > 0
                    ? `${qaBlockingCount} blocking ${qaBlockingCount === 1 ? 'issue' : 'issues'} open. You can still dub.`
                    : 'QA clear. Ready to dub.'}
                </p>
              </div>
            </aside>
          </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 3: FINAL DUB */}
      {/* ========================================================================= */}
      {activeStep === 3 && activeJob && (() => {
        const hasDub = Boolean(activeJob.synthesizedAudioUrl);
        const sourceBuffer = activeJob.audioBuffer;
        const totalLength = duration || dubBuffer?.duration || sourceBuffer?.duration || 0;
        // Each lane is drawn on its own track's length; the two differ until the dub is synced.
        const sourceLength = duration || sourceBuffer?.duration || 0;
        const dubLength = dubBuffer?.duration || 0;
        const activeCue = segments.find((s) => s.id === activeSegmentId) || null;
        const activeCueIndex = activeCue ? segments.indexOf(activeCue) : -1;
        const openIssues = openFindings.length;
        const { cueColors, sourceSpans, dubSpans, lineStarts } = lineLanes;
        const laneLinks =
          sourceLength > 0 && dubLength > 0
            ? lineStarts.map((start) => ({ from: start.source / sourceLength, to: start.dub / dubLength, color: start.color }))
            : undefined;

        return (
        <div className="flex-1 flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Dub panel: ready, dubbing, or finished */}
          <section aria-label="Dub" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
            {isSynthesizing && dubRun ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-[17px] font-semibold text-slate-100">Dubbing in {targetLanguage}</h2>
                  <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">
                    {isCancellingDub ? 'Cancelling…' : 'In progress'}
                  </span>
                  <span className="text-xs text-slate-400">{[voiceShortName, ttsModelName].filter(Boolean).join(' · ')}</span>
                  {onCancelSynthesis && (
                    <button
                      type="button"
                      onClick={onCancelSynthesis}
                      disabled={isCancellingDub}
                      className={`ml-auto ${railButton}`}
                      title="Stop the dub. The passage being voiced finishes on ElevenLabs; nothing after it is requested."
                    >
                      <X className="w-3.5 h-3.5" /> {isCancellingDub ? 'Cancelling…' : 'Cancel'}
                    </button>
                  )}
                </div>

                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  {dubRun.phase === 'preparing' ? (
                    <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 animate-[dubsweep_1.4s_ease-in-out_infinite]" />
                  ) : (
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-[width] duration-500"
                      style={{ width: `${Math.max(2, dubRun.fraction * 100)}%` }}
                    />
                  )}
                </div>

                {/* One block per cue: voiced, being voiced, still to come */}
                <div
                  aria-hidden="true"
                  className="grid gap-0.5"
                  style={{ gridTemplateColumns: `repeat(${Math.min(segments.length, 120) || 1}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: Math.min(segments.length, 120) }, (_, cell) => {
                    const perCell = segments.length / Math.min(segments.length, 120);
                    const first = Math.floor(cell * perCell);
                    const last = Math.max(first, Math.ceil((cell + 1) * perCell) - 1);
                    const active =
                      dubRun.phase === 'voicing' &&
                      (dubRun.streaming
                        ? dubRun.currentCue >= first && dubRun.currentCue <= last
                        : last >= dubRun.rangeStart && first <= dubRun.rangeEnd);
                    const done = last < dubRun.cuesDone && !active;
                    return (
                      <span
                        key={cell}
                        className={`h-3.5 rounded-sm ${done ? 'bg-indigo-500' : active ? 'bg-cyan-400 animate-pulse' : 'bg-slate-800'}`}
                      />
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[12.5px] text-slate-400" role="status" aria-live="polite">
                  <span className="min-w-0">
                    {dubRun.phase === 'preparing' && 'Preparing the script for the voice…'}
                    {dubRun.phase === 'joining' && 'All cues voiced. Putting the passages together…'}
                    {dubRun.phase === 'voicing' &&
                      (dubRun.streaming ? (
                        <>
                          Voicing cue <b className="text-slate-100 font-medium tabular-nums">{dubRun.currentCue + 1} of {segments.length}</b>
                          {segments[dubRun.currentCue] && (
                            <span className="text-slate-500">: “{getTargetText(segments[dubRun.currentCue])}”</span>
                          )}
                        </>
                      ) : (
                        <>
                          Voicing cues{' '}
                          <b className="text-slate-100 font-medium tabular-nums">
                            {dubRun.rangeStart + 1}–{dubRun.rangeEnd + 1} of {segments.length}
                          </b>
                          {dubRun.passageCount > 1 && (
                            <span className="text-slate-500">
                              {' '}(part {Math.min(dubRun.passagesDone + 1, dubRun.passageCount)} of {dubRun.passageCount})
                            </span>
                          )}
                        </>
                      ))}
                  </span>
                  {dubRun.secondsLeft !== null && (
                    <span className="shrink-0 text-slate-300">{formatTimeLeft(dubRun.secondsLeft)}</span>
                  )}
                </div>
              </>
            ) : !hasDub ? (
              <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-5 items-center">
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-[17px] font-semibold text-slate-100">Ready to dub</h2>
                    <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full border border-slate-700 text-slate-400">Not started</span>
                  </div>
                  <div className="flex flex-wrap gap-x-8 gap-y-3">
                    {[
                      { value: segments.length.toLocaleString(), label: 'cues' },
                      { value: dubCharacterCount.toLocaleString(), label: 'characters to voice' },
                      { value: formatClock(totalLength), label: 'dub length' },
                      {
                        value: String(openIssues),
                        label: openIssues === 1 ? 'QA issue open' : 'QA issues open',
                        tone: openIssues > 0 ? 'text-amber-300' : 'text-emerald-300',
                      },
                    ].map((f) => (
                      <div key={f.label}>
                        <span className={`block text-[22px] font-semibold tabular-nums leading-tight ${f.tone || 'text-slate-100'}`}>{f.value}</span>
                        <span className="text-xs text-slate-400">{f.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col md:items-end gap-1.5">
                  <button
                    type="button"
                    onClick={onSynthesizeMaster}
                    className="h-13 px-6 py-3.5 flex items-center justify-center gap-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[15px] font-semibold transition-colors cursor-pointer active:translate-y-px"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Dub in {targetLanguage}
                    {voiceShortName && ` with ${voiceShortName}`}
                  </button>
                  <p className="text-xs text-slate-500">Uses about {dubCharacterCount.toLocaleString()} ElevenLabs characters.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-[17px] font-semibold text-slate-100">{targetLanguage} dub</h2>
                  <span className="flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                    <Check className="w-3 h-3" /> Ready
                  </span>
                  <span className="text-xs text-slate-400">
                    {[voiceShortName, ttsModelName].filter(Boolean).join(' · ')}
                  </span>
                  <div role="group" aria-label="Listen to" className="ml-auto flex bg-slate-950 border border-slate-800 rounded-xl p-0.5 gap-0.5">
                    {[
                      { id: 'source' as const, label: 'Original', dot: 'bg-cyan-400' },
                      { id: 'synth' as const, label: 'Dub', dot: 'bg-indigo-400' },
                      { id: 'both' as const, label: 'Both', dot: '' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={trackMode === m.id}
                        onClick={() => switchTrack(m.id)}
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                          trackMode === m.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {m.dot && <span className={`w-2 h-2 rounded-sm ${m.dot}`} />}
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {renderTrackLanes(
                  [
                    { label: 'Original', track: 'source', length: sourceLength, buffer: sourceBuffer, dot: 'bg-cyan-400', color: 'text-slate-400/30', spans: sourceSpans },
                    { label: `${targetLanguage} dub`, track: 'synth', length: dubLength, buffer: dubBuffer, dot: 'bg-indigo-400', color: 'text-slate-400/30', spans: dubSpans },
                  ],
                  heardDuration,
                  laneLinks
                )}

                {multiSpeaker && activeJob.dubMix && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
                    <MixChecks mix={activeJob.dubMix} />
                  </div>
                )}

                {/* Transport and live caption */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => activeCueIndex > 0 && seekSource(segments[activeCueIndex - 1].startTime)}
                    className="w-8 h-8 rounded-full border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                    aria-label="Previous cue"
                  >
                    <ChevronsLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={onTogglePlay}
                    className="w-11 h-11 rounded-full bg-slate-100 hover:bg-white text-slate-950 flex items-center justify-center cursor-pointer"
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const next = segments.find((s) => s.startTime > sourceClockTime + 0.05);
                      if (next) seekSource(next.startTime);
                    }}
                    className="w-8 h-8 rounded-full border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                    aria-label="Next cue"
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-sm text-slate-100 tabular-nums">
                    <LiveClock currentTime={currentTime} isPlaying={isPlaying} getLiveTime={getLiveTime} />{' '}
                    <span className="text-slate-500">/ {formatClock(heardDuration || totalLength)}</span>
                  </span>

                  <div
                    aria-live="polite"
                    className="flex-1 min-w-[15rem] flex items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800 min-h-[3.25rem]"
                  >
                    {activeCue ? (
                      <>
                        <span className="font-mono text-[10.5px] shrink-0 flex items-center gap-1.5" style={{ color: cueColors[activeCueIndex] ?? '#64748b' }}>
                          <span className="w-2 h-2 rounded-sm" style={{ background: cueColors[activeCueIndex] ?? '#64748b' }} />#{String(activeCueIndex + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[15px] font-medium text-slate-100 leading-snug">{getTargetText(activeCue)}</span>
                          <span className="block text-[11.5px] text-slate-400 truncate">{getSourceText(activeCue)}</span>
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">Press play to follow the dub line by line.</span>
                    )}
                  </div>

                  <select
                    value={playbackRate}
                    onChange={(e) => onPlaybackRateChange(Number(e.target.value))}
                    className="h-8 bg-slate-950 border border-slate-800 rounded-lg px-2 font-mono text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                    aria-label="Playback speed"
                  >
                    {[0.75, 1, 1.25, 1.5].map((r) => (
                      <option key={r} value={r} className="bg-slate-900">
                        {r}×
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
          </section>

          {/* Sync is step 4; the dub hands over to it here. */}
          {onSyncDub && hasDub && !isSynthesizing && (
            <section
              aria-label="Next step"
              className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 rounded-2xl border border-indigo-500/40 bg-indigo-950/30"
            >
              <span className="w-9 h-9 rounded-xl bg-indigo-500/20 text-indigo-300 flex items-center justify-center shrink-0">
                <Scissors className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-100">
                  {isSyncing
                    ? 'Syncing the dub to the original'
                    : hasSyncReport && activeJob.syncReport
                      ? `Synced: ${activeJob.syncReport.summary.inSync} of ${activeJob.syncReport.summary.lines} lines in sync`
                      : 'Next: sync the dub to the original'}
                </p>
                <p className="text-[12.5px] text-slate-400">
                  {isSyncing
                    ? 'It runs in step 4. You can keep working here.'
                    : hasSyncReport && syncPendingLines.length > 0
                      ? `${syncPendingLines.length === 1 ? '1 line has' : `${syncPendingLines.length} lines have`} changed since. Sync again to hear ${syncPendingLines.length === 1 ? 'it' : 'them'}.`
                      : hasSyncReport
                        ? 'Every line starts where the original line starts. The synced dub is in step 4; the dub here stays as it was.'
                        : 'Each line is moved to start where the original line starts. The voice itself is not changed.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStepOverride(4);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="h-10 px-4 flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors cursor-pointer active:translate-y-px shrink-0"
              >
                {isSyncing ? 'View sync' : hasSyncReport ? 'Open sync' : 'Continue to sync'} <ArrowRight className="w-4 h-4" />
              </button>
            </section>
          )}

          {/* The Sync preview, as step 4 shows it, with trimming: pick a dub bar and drag its end to the length you want. */}
          {!isSynthesizing && linePreview && (
            <section aria-label="Sync preview" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-slate-100">Sync preview</h2>
                  <p className="text-xs text-slate-400">
                    {measuredRate !== null ? 'An estimate' : 'A rough estimate'} from the text length, at {linePreview.charsPerSecond.toFixed(1)} chars/s{' '}
                    {measuredRate !== null ? 'from this dub' : '(a typical rate)'}. Click a dub bar, then drag its end to the length you want; that
                    line's suggestion aims for it.
                  </p>
                </div>
                {syncPreview.loading && <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" aria-label="Updating" />}
              </div>
              <PreviewCards preview={linePreview} />
              <PreviewTimeline
                units={linePreview.units}
                reportedTime={sourceClockTime}
                getLiveTime={getSourceLiveTime}
                onSeek={previewSeek}
                isPlaying={isPlaying}
                onTogglePlay={previewTogglePlay}
                selectedKey={selectedLineKey}
                // Picking a line only shows it in the card below; the page stays where the user scrolled it.
                onSelect={(unit) => setSelectedLineKey(unit.key)}
                onTrim={trimLine}
                charsPerSecond={linePreview.charsPerSecond}
                offClockNote={previewOffClockNote}
                onCurrentLine={(unit) => setNowLineKey(unit?.key ?? null)}
                sourceBuffer={sourceBuffer}
              />
              {selectedLine &&
                (() => {
                  const unit = selectedLine;
                  const fix = finalFixes.controlsFor(unit);
                  const fixing = needsFix(unit) || fix.state.kind !== 'idle';
                  const note = fix.state.kind === 'idle' ? fitAdvice(unit) : lineNote(unit, fix.state, fix.direction).text;
                  const lineNumber = segments.findIndex((seg) => String(seg.id) === unit.key) + 1;
                  return (
                    <div className="rounded-xl border border-indigo-500/30 bg-slate-950/60 px-3.5 py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <span className="text-[13px] font-semibold text-slate-100">Line {String(lineNumber).padStart(2, '0')}</span>
                        <span className="font-mono text-[11.5px] text-slate-400 tabular-nums">{formatClock(unit.srcStart)}</span>
                        <span className="font-mono text-[11.5px] text-slate-400 tabular-nums">
                          about {unit.estimate.toFixed(1)} s · slot {unit.slot.toFixed(1)} s · original speech {unit.spoken.toFixed(1)} s
                        </span>
                        <span className="ml-auto flex items-center gap-1.5">
                          {unit.wantSeconds !== undefined && (
                            <button type="button" onClick={() => trimLine(unit, null)} className={railButton} title="Go back to the length worked out from the slot">
                              <RotateCcw className="w-3.5 h-3.5" /> Reset trim
                            </button>
                          )}
                          <button type="button" onClick={() => setSelectedLineKey(null)} className={railButton} aria-label="Close this line">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      </div>
                      <p className="mt-1.5 text-[14px] text-slate-100 leading-snug">{unit.text}</p>
                      {unit.sourceText && <p className="text-xs text-slate-500 mt-0.5">{unit.sourceText}</p>}
                      <p className={`text-[11.5px] mt-1.5 ${fixing ? (fix.direction === 'longer' ? 'text-sky-300' : 'text-amber-300') : 'text-slate-400'}`}>
                        {note || 'Fits its slot. Drag the end of its bar to set a length of your own.'}
                      </p>
                      {fixing && <LineFixControls unit={unit} cps={linePreview.charsPerSecond} {...fix} />}
                    </div>
                  );
                })()}
            </section>
          )}

          {/* Script and delivery share one height */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_25rem] gap-4 items-stretch lg:flex-1">
            <section
              aria-label="Final script"
              className="flex flex-col min-h-0 lg:h-0 lg:min-h-full bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden"
            >
              <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 border-b border-slate-800">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold text-slate-100">Final script</h2>
                  <p className="text-xs text-slate-400">What the voice says, cue by cue. Click a line to jump there.</p>
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <div role="group" aria-label="Script layout" className="flex bg-slate-950 border border-slate-800 rounded-xl p-0.5 gap-0.5">
                    {[
                      { id: 'dialogue' as const, label: 'Dialogue' },
                      { id: 'timecoded' as const, label: 'Timecoded' },
                      { id: 'bilingual' as const, label: 'Bilingual' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={finalScriptLayout === m.id}
                        onClick={() => setFinalScriptLayout(m.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                          finalScriptLayout === m.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyFullTargetScript(finalScriptLayout)}
                    className={railButton}
                    title={`Copy the ${targetLanguage} script in this layout`}
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                  <button type="button" onClick={() => setStepOverride(2)} className={railButton}>
                    <Edit3 className="w-3.5 h-3.5" /> Edit in review
                  </button>
                </div>
              </div>

              {!isSynthesizing && (
                <ScriptFitStrip
                  preview={linePreview}
                  loading={syncPreview.loading}
                  error={syncPreview.error}
                  rateMeasured={measuredRate !== null}
                  filter={finalScriptFilter}
                  onFilter={setFinalScriptFilter}
                  toFix={{
                    shorter: finalToFix.filter((u) => finalFixes.directionOf(u) === 'shorter').length,
                    longer: finalToFix.filter((u) => finalFixes.directionOf(u) === 'longer').length,
                  }}
                  onFixAll={() => finalFixes.suggestAll(finalToFix)}
                />
              )}

              <div ref={finalListRef} className="relative flex-1 min-h-0 max-h-[32rem] lg:max-h-none overflow-y-auto custom-scrollbar py-1.5">
                {(() => {
                  const fitShown = Boolean(linePreview) && !isSynthesizing;
                  const cps = linePreview?.charsPerSecond ?? 1;
                  // A line stays listed under Lines to fix once it has been worked on, even when it now fits.
                  const shown = finalScriptGroups.filter(
                    (g) => finalScriptFilter === 'all' || !fitShown || (g.unit && (needsFix(g.unit) || finalFixes.worked(g.unit)))
                  );
                  if (shown.length === 0) {
                    return (
                      <p className="px-4 py-6 text-center text-xs text-slate-500">
                        No line is likely to run past its slot or end early.{' '}
                        <button type="button" onClick={() => setFinalScriptFilter('all')} className="text-indigo-300 hover:text-indigo-200 cursor-pointer">
                          Show all lines
                        </button>
                      </p>
                    );
                  }
                  // The fit's note and controls line up under the text, past the number (and the time).
                  const indent = finalScriptLayout === 'dialogue' ? 'pl-[3.75rem]' : 'pl-[9rem]';
                  return shown.map((group) => {
                    const unit = fitShown ? group.unit : null;
                    const fix = unit ? finalFixes.controlsFor(unit) : null;
                    const fixing = Boolean(unit && fix && (needsFix(unit) || fix.state.kind !== 'idle'));
                    const note = unit && fix ? (fix.state.kind === 'idle' ? { text: fitAdvice(unit), tone: '' } : lineNote(unit, fix.state, fix.direction)) : null;
                    const noteTone =
                      note?.tone || (unit?.status === 'long' ? 'text-amber-300' : unit?.status === 'short' ? 'text-sky-300' : 'text-slate-500');
                    return (
                      <div
                        key={group.key}
                        id={group.unit ? `final-line-${group.unit.key}` : undefined}
                        className={`border-t border-slate-800/50 first:border-t-0 scroll-mt-2 border-l-[3px] ${
                          group.unit && group.unit.key === nowLineKey ? 'border-l-white/80 bg-slate-800/40' : group.unit ? '' : 'border-l-transparent'
                        } ${group.unit && group.unit.key === selectedLineKey ? 'bg-indigo-950/20 ring-1 ring-inset ring-indigo-500/40' : ''}`}
                        // The line's colour, as on the timelines; white while it plays.
                        style={group.unit && group.unit.key !== nowLineKey ? { borderLeftColor: hueOf(group.unit.index) } : undefined}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start">
                          <div className="flex-1 min-w-0">
                            {group.cues.map(({ seg, index: i }) => {
                              const isNow = seg.id === activeSegmentId;
                              return (
                                <button
                                  key={seg.id}
                                  type="button"
                                  onClick={() => seekSource(seg.startTime)}
                                  className={`w-full text-left grid gap-x-3 px-4 py-2.5 transition-colors cursor-pointer ${
                                    finalScriptLayout === 'dialogue' ? 'grid-cols-[2rem_minmax(0,1fr)]' : 'grid-cols-[2rem_4.5rem_minmax(0,1fr)]'
                                  } ${isNow ? 'bg-indigo-950/40' : 'hover:bg-slate-800/30'}`}
                                >
                                  <span
                                    className={`font-mono text-[11px] pt-1 tabular-nums ${isNow ? 'text-indigo-300' : 'text-slate-500'}`}
                                    style={!isNow && cueColor(seg, i) ? { color: cueColor(seg, i) as string } : undefined}
                                  >
                                    {String(i + 1).padStart(2, '0')}
                                  </span>
                                  {finalScriptLayout !== 'dialogue' && (
                                    <span className="font-mono text-[11.5px] text-slate-400 pt-1 tabular-nums">{formatClock(seg.startTime)}</span>
                                  )}
                                  <span className="min-w-0">
                                    {seg.speaker && (i === 0 || segments[i - 1].speaker !== seg.speaker) && (
                                      <span
                                        className="block text-[10.5px] uppercase tracking-wide font-semibold text-slate-500"
                                        style={multiSpeaker ? { color: speakerByName.get(speakerOf(seg))?.color } : undefined}
                                      >
                                        {seg.speaker}
                                      </span>
                                    )}
                                    <span className="block text-[15px] text-slate-100 leading-relaxed">{getTargetText(seg)}</span>
                                    {finalScriptLayout === 'bilingual' && (
                                      <span className="block text-xs text-slate-500 mt-0.5">{getSourceText(seg)}</span>
                                    )}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          {unit && <FitMeter unit={unit} className={`${indent} sm:pl-0 pr-4 pb-2 sm:py-3 sm:w-40 shrink-0`} />}
                        </div>
                        {unit && fix && note?.text && (
                          <div className={`${indent} pr-4 pb-3`}>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                              <p className={`text-[11.5px] ${noteTone}`}>{note.text}</p>
                              {fixing && (
                                <button
                                  type="button"
                                  onClick={() => listenOriginal(Math.max(0, unit.srcStart - 0.6))}
                                  className="flex items-center gap-1 h-6 px-2 rounded-md border border-slate-800 hover:bg-slate-800 text-[11.5px] text-slate-300 cursor-pointer"
                                  title="Play the original sentence"
                                >
                                  <Play className="w-3 h-3 fill-current" /> Original
                                </button>
                              )}
                            </div>
                            {fixing && <LineFixControls unit={unit} cps={cps} {...fix} />}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </section>

            {/* Deliver panel */}
            <aside aria-label="Deliver" className="flex flex-col bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 sm:px-5 pt-4">
                <h2 className="text-[15px] font-semibold text-slate-100">Deliver</h2>
                <button type="button" onClick={() => setStepOverride(2)} className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer">
                  ← Review
                </button>
              </div>

              {multiSpeaker && onCastChange && (
                <div className="px-4 sm:px-5 pt-4 flex flex-col gap-2">
                  <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Cast</span>
                  <CastCard
                    speakers={speakers}
                    cast={activeJob.cast}
                    mainVoiceId={elVoiceId}
                    availableVoices={availableVoices}
                    disabled={isSynthesizing}
                    onPick={(speaker) => {
                      setCastPickFor(speaker);
                      setIsVoicePickerOpen(true);
                    }}
                    onUseMain={(speaker) => onCastChange(speaker, null)}
                  />
                </div>
              )}

              <div className="px-4 sm:px-5 py-4 flex flex-col gap-2.5">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">{multiSpeaker ? 'Main voice' : 'Voice'}</span>
                {multiSpeaker && (
                  <span className="-mt-1 text-[11px] text-slate-500 leading-snug">Speaks for anyone in the cast without a voice of their own.</span>
                )}
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <SelectedVoiceSummary voiceId={elVoiceId} availableVoices={availableVoices} />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCastPickFor(null);
                      setIsVoicePickerOpen(true);
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer shrink-0"
                  >
                    Change
                  </button>
                </div>
                {favoriteVoices.length > 0 && (
                  <div role="group" aria-label="Favourite voices" className="flex flex-wrap gap-1.5">
                    {favoriteVoices.slice(0, 4).map((fav) => {
                      const on = fav.id === elVoiceId;
                      const name = (fav.name || fav.id).split(/\s+[-–—|]\s+/)[0];
                      return (
                        <button
                          key={fav.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => onElVoiceIdChange(fav.id)}
                          className={`flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-xs transition-colors cursor-pointer ${
                            on ? 'border-indigo-500 bg-indigo-950/40 text-slate-100' : 'border-slate-800 text-slate-300 hover:bg-slate-800/60'
                          }`}
                          title={fav.name}
                        >
                          <span className="w-5 h-5 rounded-full bg-slate-700 text-white text-[10px] font-semibold flex items-center justify-center">
                            {name.charAt(0).toUpperCase()}
                          </span>
                          <span className="truncate max-w-[7rem]">{name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {voiceEngine === 'elevenlabs' && elModelId && onElModelIdChange && elModels.length > 0 ? (
                  <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                    <label htmlFor="dub-el-model">Model</label>
                    <select
                      id="dub-el-model"
                      value={elModelId}
                      onChange={(e) => onElModelIdChange(e.target.value)}
                      disabled={isSynthesizing}
                      title={hasDub ? 'A new model applies the next time you dub.' : undefined}
                      className="min-w-0 max-w-[65%] h-8 bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-lg px-2 text-xs font-medium text-slate-200 truncate focus:outline-none focus:border-indigo-500 cursor-pointer disabled:cursor-default disabled:opacity-60"
                    >
                      {!elModels.some((m) => m.model_id === elModelId) && (
                        <option value={elModelId} className="bg-slate-900">{ttsModelName}</option>
                      )}
                      {elModels.map((m) => (
                        <option key={m.model_id} value={m.model_id} className="bg-slate-900">
                          {m.name}
                          {m.token_cost_factor && m.token_cost_factor !== 1 ? ` · ${m.token_cost_factor}× credits` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex justify-between text-xs text-slate-400">
                    <span>Model</span>
                    <span className="text-slate-200 font-medium truncate ml-3">{ttsModelName}</span>
                  </div>
                )}
                {voiceEngine === 'elevenlabs' && onEmotionEnhanceChange && (() => {
                  // A dub with several voices is read as written: delivery cues are written for one continuous read.
                  const takesCues = Boolean(elModelId && performsAudioTags(elModelId)) && !multiSpeaker;
                  return (
                    <label
                      className={`flex items-start gap-2.5 text-xs ${takesCues ? 'cursor-pointer' : 'opacity-60 cursor-default'}`}
                      title={hasDub ? 'Applies the next time you dub.' : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={emotionEnhance && takesCues}
                        onChange={(e) => onEmotionEnhanceChange(e.target.checked)}
                        disabled={isSynthesizing || !takesCues}
                        className="mt-0.5 w-3.5 h-3.5 accent-indigo-500 cursor-pointer disabled:cursor-default"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-slate-200 font-medium">Enhance emotion</span>
                        <span className="text-[11px] text-slate-500 leading-snug">
                          {takesCues
                            ? 'Adds cues like [calm] and [sighs] before voicing. Off: the script is spoken exactly as written.'
                            : multiSpeaker
                              ? 'For a dub in one voice. With several speakers, each reads the script as written.'
                              : 'Eleven v3 and v4 only.'}
                        </span>
                      </span>
                    </label>
                  );
                })()}
                {onDubMatchLoudnessChange && (
                  <label className="flex items-start gap-2.5 text-xs cursor-pointer" title={hasDub ? 'Applies the next time you dub.' : undefined}>
                    <input
                      type="checkbox"
                      checked={dubMatchLoudness}
                      onChange={(e) => onDubMatchLoudnessChange(e.target.checked)}
                      disabled={isSynthesizing}
                      className="mt-0.5 w-3.5 h-3.5 accent-indigo-500 cursor-pointer disabled:cursor-default"
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-slate-200 font-medium">{multiSpeaker ? 'Even out speakers' : 'Even out loudness'}</span>
                      <span className="text-[11px] text-slate-500 leading-snug">
                        {multiSpeaker
                          ? 'One gain per speaker, so every voice sits at one level and keeps its own dynamics. Off: every line exactly as voiced.'
                          : 'Brings every passage of a long script to one level. Off: each keeps exactly the level it was voiced at.'}
                      </span>
                    </span>
                  </label>
                )}
                {multiSpeaker && onMixPeakChange && (
                  <div className="pt-1" title={hasDub ? 'Applies the next time you dub.' : undefined}>
                    <MixPeakChoice value={mixPeak} onChange={onMixPeakChange} disabled={isSynthesizing} />
                  </div>
                )}
                {showVoiceSliders && (
                  <div className="flex flex-col gap-3 pt-1">
                    <div className="flex items-center justify-between -mb-1">
                      <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Voice settings</span>
                      <ResetDefaultsButton
                        onClick={() => onElVoiceSettingsChange?.({ ...DEFAULT_VOICE_SETTINGS })}
                        disabled={isSynthesizing || isElevenLabsDefault(shownVoiceSettings)}
                      />
                    </div>
                    {[
                      {
                        key: 'stability' as const,
                        label: 'Stability',
                        ends: elModelId && performsAudioTags(elModelId) ? ['Creative', 'Robust'] : ['More variable', 'More stable'],
                      },
                      { key: 'similarity_boost' as const, label: 'Similarity', ends: ['Low', 'High'] },
                      { key: 'style' as const, label: 'Style Exaggeration', ends: ['None', 'Exaggerated'] },
                    ].map((s) => (
                      <div key={s.key}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[13px] font-semibold text-slate-100">{s.label}</span>
                          <span className="font-mono text-xs text-slate-300 tabular-nums">{(shownVoiceSettings[s.key] ?? 0).toFixed(2)}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={shownVoiceSettings[s.key] ?? 0}
                          disabled={isSynthesizing}
                          onChange={(e) =>
                            onElVoiceSettingsChange?.({ ...shownVoiceSettings, [s.key]: parseFloat(e.target.value) })
                          }
                          aria-label={s.label}
                          className="w-full mt-1.5 accent-indigo-500 cursor-pointer disabled:cursor-default disabled:opacity-60"
                        />
                        <div className="flex justify-between text-[10.5px] text-slate-500">
                          <span>{s.ends[0]}</span>
                          <span>{s.ends[1]}</span>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 text-[13px] font-semibold text-slate-100">Speaker boost</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={shownVoiceSettings.use_speaker_boost !== false}
                        aria-label="Speaker boost"
                        disabled={isSynthesizing}
                        onClick={() =>
                          onElVoiceSettingsChange?.({
                            ...shownVoiceSettings,
                            use_speaker_boost: shownVoiceSettings.use_speaker_boost === false,
                          })
                        }
                        className={`relative w-[34px] h-5 rounded-full shrink-0 transition-colors cursor-pointer disabled:cursor-default disabled:opacity-60 ${
                          shownVoiceSettings.use_speaker_boost !== false ? 'bg-indigo-500' : 'bg-slate-700'
                        }`}
                      >
                        <span
                          className={`absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white transition-all ${
                            shownVoiceSettings.use_speaker_boost !== false ? 'left-[17px]' : 'left-[3px]'
                          }`}
                        />
                      </button>
                    </div>
                    <p className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span>{elVoiceSettings ? 'Your settings. They apply the next time you dub.' : "The voice's own ElevenLabs settings."}</span>
                      {elVoiceSettings && (
                        <button
                          type="button"
                          onClick={() => onElVoiceSettingsChange?.(null)}
                          disabled={isSynthesizing}
                          className="shrink-0 text-indigo-400 hover:text-indigo-300 cursor-pointer disabled:cursor-default"
                        >
                          Reset
                        </button>
                      )}
                    </p>
                  </div>
                )}
              </div>

              <div className="px-4 sm:px-5 py-4 border-t border-slate-800 flex flex-col gap-2">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Downloads</span>
                {[
                  {
                    tag: 'WAV',
                    tone: 'bg-emerald-500/15 text-emerald-300',
                    title: `${targetLanguage} dub audio`,
                    detail: hasDub && dubBuffer
                      ? `${formatClock(dubBuffer.duration)} · ${Math.round(dubBuffer.sampleRate / 1000)} kHz`
                      : 'Available once the dub is made',
                    onClick: onDownloadWav,
                    disabled: !hasDub || !onDownloadWav,
                    hero: hasDub,
                  },
                  {
                    tag: 'TXT',
                    tone: 'bg-cyan-500/15 text-cyan-300',
                    title: `${targetLanguage} script`,
                    detail: `${finalScriptLayout.charAt(0).toUpperCase()}${finalScriptLayout.slice(1)} layout`,
                    onClick: () => handleExportTargetScript(finalScriptLayout),
                    disabled: segments.length === 0,
                  },
                ].filter((d) => !!d).map((d) => (
                  <button
                    key={d.tag}
                    type="button"
                    onClick={d.onClick}
                    disabled={d.disabled}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer ${
                      d.hero ? 'border-emerald-800/70 bg-emerald-950/30 hover:bg-emerald-950/50' : 'border-slate-800 hover:bg-slate-800/50'
                    }`}
                  >
                    <span className={`w-9 h-9 rounded-lg flex items-center justify-center font-mono text-[9.5px] font-semibold shrink-0 ${d.tone}`}>
                      {d.tag}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-100">{d.title}</span>
                      <span className="block text-[11.5px] text-slate-400 truncate">{d.detail}</span>
                    </span>
                    <Download className="w-4 h-4 text-slate-500 shrink-0" />
                  </button>
                ))}
                {hasDub && multiSpeaker && activeJob.dubStems && activeJob.dubStems.length > 0 && onDownloadStem && (
                  <StemDownloads stems={activeJob.dubStems} speakers={speakers} onDownload={onDownloadStem} />
                )}
              </div>

              {onOpenVoiceChanger && (
                <div className="px-4 sm:px-5 py-4 border-t border-slate-800">
                  <button type="button" onClick={onOpenVoiceChanger} className={`${railButton} w-full`}>
                    <AudioWaveform className="w-3.5 h-3.5" /> Voice changer
                  </button>
                  {onOpenTextToSpeech && (
                    <button type="button" onClick={onOpenTextToSpeech} className={`${railButton} w-full mt-2`}>
                      <Speech className="w-3.5 h-3.5" /> Text to speech
                    </button>
                  )}
                </div>
              )}

              <div className="mt-auto px-4 sm:px-5 py-4 border-t border-slate-800 bg-slate-950/60 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={onSynthesizeMaster}
                  disabled={isSynthesizing || segments.length === 0}
                  className="h-11 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer active:translate-y-px"
                >
                  {isSynthesizing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Dubbing…
                    </>
                  ) : hasDub ? (
                    <>
                      <RefreshCw className="w-4 h-4" /> Dub again
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" /> Dub in {targetLanguage}
                    </>
                  )}
                </button>
                {onResetSession && (
                  <button type="button" onClick={onResetSession} className={`${railButton} h-9`}>
                    <RotateCcw className="w-3.5 h-3.5" /> Start a new dub
                  </button>
                )}
                <p className="text-center text-[11.5px] text-slate-500">
                  {isSynthesizing
                    ? 'You can keep reading while it works.'
                    : `${hasDub ? 'Dubbing again uses' : 'Uses'} about ${dubCharacterCount.toLocaleString()} ElevenLabs characters.`}
                </p>
              </div>
            </aside>
          </div>

          {/* Full voice library, opened from Change */}
          {isVoicePickerOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
              role="dialog"
              aria-modal="true"
              aria-label="Choose a voice"
              onClick={(e) => e.target === e.currentTarget && setIsVoicePickerOpen(false)}
              onKeyDown={(e) => e.key === 'Escape' && setIsVoicePickerOpen(false)}
            >
              <div className="w-full max-w-5xl flex flex-col gap-3">
                <div className="flex items-center justify-end gap-3">
                  {castPickFor && (
                    <span className="mr-auto text-sm text-slate-200">
                      Voice for <SpeakerChip speaker={speakerByName.get(castPickFor)} name={castPickFor} />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsVoicePickerOpen(false)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" /> Done
                  </button>
                </div>
                <VoiceSelectorCard
                  elVoiceId={castPickFor ? activeJob.cast?.[castPickFor]?.voiceId || elVoiceId : elVoiceId}
                  onElVoiceIdChange={castPickFor && onCastChange ? (id) => onCastChange(castPickFor, id) : onElVoiceIdChange}
                  availableVoices={availableVoices}
                  targetLanguage={targetLanguage}
                  voiceEngine={voiceEngine}
                  onVoiceEngineChange={onVoiceEngineChange}
                  className="h-[78vh]"
                />
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* ========================================================================= */}
      {/* STEP 4: SYNC */}
      {/* ========================================================================= */}
      {activeStep === 4 && activeJob && (() => {
        // Before the first sync the player here plays the dub; after it, the synced dub.
        const hasDub = hasDubAudio;
        const report = hasSyncReport ? activeJob.syncReport || null : null;
        const totalLength = duration || dubBuffer?.duration || activeJob.audioBuffer?.duration || 0;
        const sourceLength = duration || activeJob.audioBuffer?.duration || 0;
        const syncedLength = dubBuffer?.duration || sourceLength;
        const activeCue = segments.find((s) => s.id === activeSegmentId) || null;
        const activeCueIndex = activeCue ? segments.indexOf(activeCue) : -1;
        const blockedReason = !onSyncDub
          ? 'Sync is not available.'
          : isSynthesizing
            ? 'Wait for the dub to finish first.'
            : segments.length === 0
              ? 'There are no cues to sync yet.'
              : null;
        const runSync = () => onSyncDub?.(syncOptions);

        return (
        <div className="flex-1 flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Transport: the lines worth a listen play through it; once synced, the original over the synced dub */}
          {hasDub && (
            <section aria-label="Player" className="bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3 flex flex-col gap-3">
              {report &&
                renderTrackLanes(
                  [
                    { label: 'Original', track: 'source', length: sourceLength, buffer: activeJob.audioBuffer, dot: 'bg-cyan-400', color: 'text-slate-400/30', spans: lineLanes.sourceSpans },
                    { label: 'Synced', track: 'synth', length: syncedLength, buffer: dubBuffer, dot: 'bg-indigo-400', color: 'text-slate-400/30', spans: lineLanes.dubSpans },
                  ],
                  heardDuration || totalLength,
                  // Each lane is drawn on its own track's length, so the links show where a line moved to.
                  sourceLength > 0 && syncedLength > 0
                    ? lineLanes.lineStarts.map((start) => ({ from: start.source / sourceLength, to: start.dub / syncedLength, color: start.color }))
                    : undefined
                )}
              <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => activeCueIndex > 0 && seekSource(segments[activeCueIndex - 1].startTime)}
                className="w-8 h-8 rounded-full border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                aria-label="Previous cue"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onTogglePlay}
                className="w-10 h-10 rounded-full bg-slate-100 hover:bg-white text-slate-950 flex items-center justify-center cursor-pointer"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = segments.find((s) => s.startTime > sourceClockTime + 0.05);
                  if (next) seekSource(next.startTime);
                }}
                className="w-8 h-8 rounded-full border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                aria-label="Next cue"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
              <span className="font-mono text-sm text-slate-100 tabular-nums">
                <LiveClock currentTime={currentTime} isPlaying={isPlaying} getLiveTime={getLiveTime} />{' '}
                <span className="text-slate-500">/ {formatClock(heardDuration || totalLength)}</span>
              </span>
              <span aria-live="polite" className="flex-1 min-w-[12rem] truncate text-[13px] text-slate-300">
                {activeCue ? getTargetText(activeCue) : <span className="text-xs text-slate-500">Press play, or Listen on a line below.</span>}
              </span>
              <div role="group" aria-label="Listen to" className="flex bg-slate-950 border border-slate-800 rounded-xl p-0.5 gap-0.5">
                {[
                  { id: 'source' as const, label: 'Original', dot: 'bg-cyan-400' },
                  { id: 'synth' as const, label: 'Dub', dot: 'bg-indigo-400' },
                  { id: 'both' as const, label: 'Both', dot: '' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={trackMode === m.id}
                    onClick={() => switchTrack(m.id)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      trackMode === m.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {m.dot && <span className={`w-2 h-2 rounded-sm ${m.dot}`} />}
                    {m.label}
                  </button>
                ))}
              </div>
              <select
                value={playbackRate}
                onChange={(e) => onPlaybackRateChange(Number(e.target.value))}
                className="h-8 bg-slate-950 border border-slate-800 rounded-lg px-2 font-mono text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                aria-label="Playback speed"
              >
                {[0.75, 1, 1.25, 1.5].map((r) => (
                  <option key={r} value={r} className="bg-slate-900">
                    {r}×
                  </option>
                ))}
              </select>
              </div>
            </section>
          )}

          {multiSpeaker && (
            <section aria-label="Speakers in the synced dub" className="bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-3 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 mr-1">Cast</span>
                {speakers.map((s) => (
                  <SpeakerChip
                    key={s.name}
                    speaker={s}
                    name={s.name}
                    suffix={
                      (availableVoices.find((v) => v.voice_id === (activeJob.cast?.[s.name]?.voiceId || elVoiceId))?.name || '')
                        .split(/\s+[-–—|]\s+/)[0] || undefined
                    }
                  />
                ))}
                <button type="button" onClick={() => setStepOverride(3)} className="ml-auto text-xs text-slate-400 hover:text-slate-200 cursor-pointer">
                  Change voices in Final dub
                </button>
              </div>
              {report && activeJob.syncMix ? (
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                  <MixChecks mix={activeJob.syncMix} synced />
                  {activeJob.syncedStems && activeJob.syncedStems.length > 0 && onDownloadStem && (
                    <StemDownloads stems={activeJob.syncedStems} speakers={speakers} onDownload={onDownloadStem} />
                  )}
                </div>
              ) : (
                <p className="text-[12px] text-slate-400">
                  Each speaker is voiced with their own voice and placed on their own lines. Where two people talk at once in the original, the dub keeps that overlap.
                </p>
              )}
            </section>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_25rem] gap-4 items-start">
            <SyncResultsPanel
              report={report}
              progress={syncProgress}
              isSyncing={isSyncing}
              isCancelling={isCancellingSync}
              lineCount={segments.length}
              duration={totalLength}
              blockedReason={blockedReason}
              onSync={runSync}
              preview={
                <SyncPreviewPanel
                  preview={linePreview}
                  loading={syncPreview.loading}
                  error={syncPreview.error}
                  rateMeasured={measuredRate !== null}
                  currentTime={sourceClockTime}
                  isPlaying={isPlaying}
                  onTogglePlay={previewTogglePlay}
                  getLiveTime={getSourceLiveTime}
                  onSeek={previewSeek}
                  onListenOriginal={listenOriginal}
                  offClockNote={previewOffClockNote}
                  onSuggest={suggestLine}
                  onUseLine={applyPreviewLine}
                  onRestore={restoreCueTexts}
                  sourceBuffer={activeJob.audioBuffer}
                />
              }
              currentTime={sourceClockTime}
              isPlaying={isPlaying}
              onTogglePlay={onTogglePlay}
              getLiveTime={getSourceLiveTime}
              onSeek={seekSource}
              onListen={listenHere}
              sourceBuffer={activeJob.audioBuffer}
              dubBuffer={report ? activeJob.syncedAudioBuffer : null}
              pendingLines={syncPendingLines}
              onApplyLine={onApplySyncLine}
              onRetakeLine={onRetakeSyncLine}
              onSuggestLine={(unit, avoid) =>
                unit.targetChars == null
                  ? Promise.resolve(null)
                  : (unit.short && !unit.exceeded ? suggestLongerLine : suggestShorterLine)({
                      text: unit.text,
                      sourceText: unit.sourceText,
                      language: targetLanguage,
                      targetChars: unit.targetChars,
                      avoid,
                    })
              }
            />
            <SyncSettingsPanel
              options={syncOptions}
              onOptionsChange={setSyncOptions}
              synced={Boolean(report)}
              hasDub={hasDub}
              isSyncing={isSyncing}
              isCancelling={isCancellingSync}
              error={syncError}
              blockedReason={blockedReason}
              pendingCount={syncPendingLines.length}
              previewShown={!report && Boolean(syncPreview.preview)}
              previewLongCount={syncPreview.preview?.summary.long ?? 0}
              previewShortCount={syncPreview.preview?.summary.short ?? 0}
              onSync={runSync}
              onCancel={() => onCancelSync?.()}
              onBack={() => {
                setStepOverride(3);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              onDownloadWav={report ? onDownloadWav : undefined}
              onOpenVoiceChanger={report ? onOpenVoiceChanger : undefined}
              subtitles={
                report && syncedCues && syncedCues.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => handleExportStepSubtitles('srt')}
                      disabled={isSyncing}
                      className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-800 hover:bg-slate-800/50 text-left transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                    >
                      <span className="w-9 h-9 rounded-lg flex items-center justify-center font-mono text-[9.5px] font-semibold shrink-0 bg-indigo-500/15 text-indigo-300">
                        SRT
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-slate-100">{targetLanguage} subtitles</span>
                        <span className="block text-[11.5px] text-slate-400 truncate">
                          Timed to the synced dub · {srtOptions.maxLinesPerCue} line,{' '}
                          {srtOptions.maxWordsPerLine} words max
                        </span>
                      </span>
                      <Download className="w-4 h-4 text-slate-500 shrink-0" />
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => handleExportStepSubtitles('vtt')} disabled={isSyncing} className={railButton}>
                        <Download className="w-3.5 h-3.5" /> .vtt subtitles
                      </button>
                      <button type="button" onClick={() => setIsSrtModalOpen(true)} className={railButton}>
                        <Sliders className="w-3.5 h-3.5" /> Subtitle settings
                      </button>
                    </div>
                  </>
                )
              }
            />
          </div>
        </div>
        );
      })()}

      {/* Floating Export Toast Notification */}
      {exportSuccessMessage && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-slate-100 text-slate-950 text-[12.5px] font-medium shadow-2xl animate-in fade-in slide-in-from-bottom-2"
        >
          <Check className="w-3.5 h-3.5 shrink-0" />
          {exportSuccessMessage}
          {toastUndo && (
            <button
              type="button"
              onClick={toastUndo}
              className="ml-1.5 -mr-1.5 px-2.5 py-0.5 rounded-full bg-slate-950 text-slate-100 text-[12px] font-semibold hover:bg-slate-800 cursor-pointer"
            >
              Undo
            </button>
          )}
        </div>
      )}

      {/* Custom SRT Export Settings & Live Preview Modal */}
      <SrtExportModal
        isOpen={isSrtModalOpen}
        onClose={() => setIsSrtModalOpen(false)}
        segments={segments}
        targetLanguage={targetLanguage}
        sourceLanguage={activeJob?.detectedLanguage || sourceLanguage}
        initialOptions={srtOptions}
        onOptionsChange={(newOpts) => setSrtOptions(newOpts)}
        synthAudioDuration={activeJob?.synthAudioBuffer?.duration}
        hasSynthAudio={!!activeJob?.synthesizedAudioUrl}
        syncedSegments={syncedCues}
      />

      {/* Custom Script Paste & Alignment Modal */}
      <CustomScriptAlignModal
        isOpen={isAlignModalOpen}
        onClose={() => setIsAlignModalOpen(false)}
        segments={segments}
        targetLanguage={targetLanguage}
        onApplyAlignedScript={handleApplyAlignedSegments}
      />

      {/* Translation Custom Prompt Modal (Local Fallback) */}
      <TranslationPromptModal
        isOpen={isLocalPromptModalOpen}
        onClose={() => setIsLocalPromptModalOpen(false)}
        currentPrompt={customPrompt || ''}
        currentPresetId={promptPresetId || DEFAULT_PROMPT_PRESET_ID}
        targetLanguage={targetLanguage}
        hasActiveSegments={segments.length > 0}
        hasAudioFile={!!activeJob?.file}
        onSavePrompt={(p, id) => {
          if (onUpdateTranslationPrompt) onUpdateTranslationPrompt(p, id);
        }}
        onRetranslateSegments={onRetranslateSegments}
        onRetranscribeAudio={onRetranscribeAudio}
        isTranslating={isTranslatingLanguage}
        segmentCount={segments.length}
        audioDuration={activeJob?.audioBuffer?.duration || 0}
      />
    </div>
  );
};
