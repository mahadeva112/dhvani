import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useStepHeaderSlot } from './stepHeaderSlot';
import {
  Play,
  Pause,
  CheckCircle2,
  ArrowRight,
  Loader2,
  RotateCcw,
  Plus,
  Download,
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
  Table,
  Search,
  Filter,
  Copy,
  AlertTriangle,
  Languages,
  ChevronsDown,
  ChevronsUp,
  Share2,
  ChevronDown,
  ClipboardPaste,
  AudioWaveform,
  Speech,
  ShieldCheck,
  ArrowLeftRight,
  X,
  Pencil,
  Redo2,
  Undo2,
  FileText,
  Video,
  Zap,
} from 'lucide-react';
import { AudioSegment, BatchJob, MixPeakMode, ProcessingStatus, TargetSource, TrackSwitchOptions } from '../types';
import { hasTranscript } from '../services/steps';
import { projectFileStem } from '../services/projects';
import { useVoiceMatches } from '../services/useVoiceMatches';
import { listSpeakers, likelySlips, overlapsBefore, speakerOf, isMultiSpeaker, SPEAKER_COLORS } from '../services/speakers';
import type { SpeakerSlip } from '../services/speakers';
import { SpeakerBar, SpeakerStrip, CueSelectionBar, SpeakerPicker, SpeakerCueNotes, SpeakerChip, CastCard, MainVoiceRole, MixPeakChoice, MixChecks, StemDownloads } from './SpeakerPanel';
import { retranslateCues, translationFraction, type RetranslateProgress } from '../services/subtitleService';
import { TargetScriptChoice } from './TargetScriptChoice';
import { scrollWithin } from './scrollWithin';
import type { TranscriptExportResult, TranscriptFormat } from './TranscriptExportMenu';
import {
  Voice,
  DubProgress,
  ElevenLabsModel,
  ElevenLabsVoiceSettings,
  DEFAULT_VOICE_SETTINGS,
  getVoiceSettings,
  performsAudioTags,
  isElevenLabsDefault,
  type VoiceExpression,
} from '../services/elevenLabsService';
import { cartesiaTakesControls } from '../services/cartesiaService';
import { ResetDefaultsButton } from './ResetDefaultsButton';
import { audioBufferToWav } from '../services/audioService';
import {
  generateTargetLanguageScript,
  downloadFile,
  TargetScriptFormat,
  SrtOptions,
  DEFAULT_SRT_OPTIONS,
  adjustSegmentsForDubbedTimeline,
  SubtitleExportChoice,
  loadSubtitleExportChoice,
  saveSubtitleExportChoice,
  resolveSubtitleTiming,
} from '../services/srtService';
import { timelineMapper } from '../services/playbackTimeline';
import { ReviewWaveformPlayer } from './ReviewWaveformPlayer';
import { GrammarCheckButton, GrammarPanel, type GrammarScope } from './review/GrammarPanel';
import { CueRowMenu, ReviewViewMenu, ShowLinesMenu } from './review/ReviewMenus';
import { CenteredPanel } from './CenteredPanel';
import { checkGrammar as checkGrammarLines, type GrammarFix, type GrammarState } from '../services/grammarCheck';
import { VoiceSelectorCard, SelectedVoiceSummary, POPULAR_ELEVENLABS_VOICES, VoiceEngine } from './VoiceSelectorCard';
import { MediaStrip } from './MediaStrip';
import { FloatingWindow } from './FloatingWindow';
import { useReviewVideo } from './ReviewVideoPanel';
import { ReviewVideoFloat, reserveReviewWindow } from './ReviewVideoFloat';
import { useLiveTime } from './useLiveTime';
import { TrackStrip } from './TrackStrip';
import type { MixerLevels, MixerTrack, TrackLevel } from './useTrackMixer';
import { useFavoriteVoices } from '../services/favoriteVoicesService';
import { PhoneticSmartTextarea } from './PhoneticSmartTextarea';
import { SrtExportModal } from './SrtExportModal';
import { CustomScriptAlignModal, type ScriptHandOff } from './CustomScriptAlignModal';
import { TranslationPromptModal } from './TranslationPromptModal';
import { QaCockpit } from './QaCockpit';
import { SyncResultsPanel, SyncSettingsDialog, SyncSettingsPanel, SyncStatusBar, useSyncOptions } from './SyncPanel';
import { DubSettingsCard } from './DubSettingsCard';
import { SyncProgressPage, useSyncPageView, useSyncRun } from './SyncProgressPage';
import { SyncAlignmentView } from './SyncAlignmentView';
import { LinePair } from './LinePair';
import { describeChange, joinPresetLabel, pickLengthByHand, presetName } from './SyncJoinSettings';
import { presetSuggestion, type SyncJoinPreset } from '../services/syncPresets';
import { lineTextNow } from '../services/syncPending';
import {
  distributeLineText,
  expertPreview,
  withLiveText,
  ALLOWED_OVERFLOW,
  PACE_DIRECTION,
  PACE_SHARE,
  measureSpeechSeconds,
  scriptCharacterCount,
  speakingRate,
  syncedSpeakingRate,
  syncedPlacedShare,
  syncedSpeakerRates,
  suggestShorterLine,
  suggestLongerLine,
  suggestRewordedLine,
  checkWording,
  syncedSegments,
  TYPICAL_CHARS_PER_SECOND,
  withLineTargets,
  fitJoinSettings,
  previewSync,
  type LineSuggestion,
} from '../services/syncService';
import { autoFitForSync, canUndoAutoFit, refitRequestFor, undoAutoFit, withRefit, type AutoFitOutcome } from '../services/syncAutoFit';
import { AutoFitPanel } from './AutoFitPanel';
import { DEFAULT_DUB_AUDIO_QUALITY, DUB_AUDIO_QUALITIES, type DubAudioQuality } from '../services/dubAudioQuality';
import type { EstimateMethod, LineContext, SpeakerFitRates, SyncOptions, SyncPreviewUnit, SyncProgress, SyncReport, SyncUnitReport } from '../services/syncService';
import { syllableFit, syllableRate, timeLine } from '../services/speechTiming';
import { learnedPace, learnPaceFromSync, voicePaceKey, type LearnedPace } from '../services/voicePace';
import { useSyncPreview, useLineFixes, LineFixControls, WordingButtons, lineNote, isShort, EstimateSwitch, ExpertLineDetail, estimateBasis, directionFor, RATE_BASIS_NOTE, LINE_OPTIONS, DubEstimateLane, SourceLineLane, LaneViewSwitch, useLaneView, PauseTicksLane, WordingSuggestRow, LineFitRow, LineFitWordings, type PlaceDrag, type StretchDraft } from './SyncPreviewPanel';
import { placeOf, withCut, withLinePlaces, withLineRate, withLineRates, withPartStart, withPauseSkip } from '../services/linePlaces';
import type { WordingRequest } from './TakesPanel';
import { stripPauses } from '../server/lib/linePauses.js';
import type { RateBasis, VoiceRateState } from '../services/voiceRate';
import { VoiceRateCard } from './VoiceRateCard';
import type { SpeakerMonitor } from '../services/speakerLevels';
import type { RewriteDirection } from './SyncPreviewPanel';
import { FitMeter, ScriptFitStrip, fitAdvice, fitLabel, fitNote, needsFix, pauseAdvice } from './FinalScriptFit';
import { SaveScriptMenu, type ScriptScope } from './SaveScriptMenu';
import { DOCX_MIME, buildScriptDocx, loadWordParagraphSize, scriptDocxFileName, scriptDocxRows } from '../services/scriptDocx';
import { saveFileAs } from '../services/saveFile';
import { hueOf, lineIndexByCue } from './lineColors';
import { DEFAULT_PROMPT_PRESET_ID } from '../services/translationPromptPresets';
import { promptStyleName } from '../services/savedTranslationPrompts';
import { runQa, useQaConfig } from '../services/qaService';
import { useGlossaryTerms } from '../services/glossaryService';
import { choicesFor, rememberChoice } from '../services/wordingChoices';
import { useSignoff } from '../services/signoffService';
import { ScriptTableView, type LinePacing } from './review/ScriptTableView';
import { PASSAGE_PAUSES, buildPassages, loadPassagePause, savePassagePause } from './review/passages';
import { CueEditButtons, CueEditNotice, PickableWords, useCueEditing, useReviewUndoKeys, type ReviewUndo } from './review/CueEditBar';
import { reviewHistoryLabels } from '../services/reviewHistory';
import { HistoryMenu, type ProjectHistoryView } from './HistoryMenu';
import { SyncEditTimeline, type AudioTrackLanes, type SyncEditStatus } from './SyncEditTimeline';
import { isClip, partLine, spokenSpan, type AudioTrack, type SyncEdits } from '../services/syncEditService';
import { alignTakeWords, firstWordAt, takesOf, type TakeAsk } from '../services/syncTakesService';
import { TakesPanel } from './TakesPanel';
import { PageScrollLock } from './usePageScrollLock';

type ReviewMode = 'table' | 'script' | 'qa';

/** Review's edit keys, in the player's ? hints (they were a sentence in a bar of their own). */
const REVIEW_EDIT_HINTS: [string[], string][] = [
  [['S'], 'split the cue at the playhead (or before a word clicked in Original)'],
  [['M'], 'join a cue with the next'],
  [['Ctrl', 'Z'], 'undo · Ctrl + Shift + Z redo'],
];

const REVIEW_VIEWS: { id: ReviewMode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'table', label: 'Cues', Icon: Table },
  { id: 'script', label: 'Script', Icon: FileText },
  { id: 'qa', label: 'QA', Icon: ShieldCheck },
];

/** Review text size: the reviewer scales the script with − and +, remembered per machine. */
const REVIEW_FONT_KEY = 'dhvani_review_font_px';
const SCRIPT_SCOPE_KEY = 'dhvani_script_scope';
/** Quick or Expert: how the Sync preview times the dub lines. */
const ESTIMATE_METHOD_KEY = 'dhvani_estimate_method';
/** A speaker's rate from a sync is used once that many of their lines were voiced, as Fit to this video asks. */
const MIN_SPEAKER_SYNC_LINES = 5;
const REVIEW_FONT_MIN = 12;
const REVIEW_FONT_MAX = 22;
const REVIEW_FONT_DEFAULT = 17;
/** Review's line details, Simple or Detailed, kept on this computer. */
const REVIEW_DETAILS_KEY = 'dhvani_review_details';

/** A line's length, counted the way the pacing figures count it. */
const CharCount: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => (
  <span className={`font-mono text-[12px] text-slate-400 tabular-nums whitespace-nowrap ${className}`}>
    {text.length} chars
  </span>
);

/** A line's syllables, counted as the Expert estimate counts them. */
const SyllableCount: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => (
  <span className={`font-mono text-[12px] text-slate-400 tabular-nums whitespace-nowrap ${className}`}>
    {timeLine(text, 1).syllables} syl
  </span>
);

/** `own`: the cue's syllables; the rest are for its whole sync line, which spans `cues` when it is more than this one. */
type SyllableFitInfo = ReturnType<typeof syllableFit> & { own: number; cues: string | null };

/** A dub line's syllables and what it takes to fit its slot: fewer, or room for more. */

const SyllableFitNote: React.FC<{ fit: SyllableFitInfo; className?: string }> = ({ fit, className = '' }) =>
  fit.own === 0 && fit.syllables === 0 ? null : (
  <span
    className={`font-mono text-[12px] tabular-nums whitespace-nowrap ${fit.cut > 0 ? 'text-amber-300' : 'text-slate-400'} ${className}`}
    title={`The slot holds about ${fit.holds} syllables at the voice's rate${fit.cues ? `, for cues ${fit.cues} as one line` : ''}`}
  >
    {fit.own} syl ·{' '}
    {fit.cues && <span className="text-slate-400">line {fit.cues}: {fit.syllables} syl, </span>}
    {fit.cut > 0 ? `${fit.cut} fewer to fit` : fit.room > 0 ? `room for ${fit.room} more` : 'fits'}
  </span>
  );

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
/** Dub lines either side of one being reworded that the text model reads it with. */
const LINE_CONTEXT = 2;

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
    read: estimate,
    estimate,
    overflow: Math.max(0, estimate - duration),
    underflow: short ? duration - estimate : 0,
    status: level === 'fast' ? 'long' : level === 'tight' ? 'tight' : short ? 'short' : 'fits',
    targetChars: short
      ? Math.max(length + 1, Math.floor(REVIEW_CPS * duration * REVIEW_FULLER_FILL))
      : Math.max(1, Math.floor(REVIEW_FAST_CPS * duration * REVIEW_SHORTER_MARGIN)),
  };
};

/** The share of a slot a line that fits may grow into when reworded, as the server leaves for Sync's own suggestions. */
const SLOT_MARGIN = 0.92;

/**
 * How much shorter or longer a wording aims to be when the user picks a way
 * the line's fit does not point: a fifth either side of the line as it is.
 */
const PICKED_SHORTER = 0.8;
const PICKED_LONGER = 1.2;

/**
 * Shorter, Longer and Same length for a line that already fits: shown when the
 * row is hovered or focused, so the list stays quiet until the user wants one.
 */
const hoverWordings = 'mt-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity';

/** True when a cue's line ends well before the original speaker stops: one to make fuller. */
const endsEarly = (seg: AudioSegment, text: string) => reviewLineOf(seg, text, '').status === 'short';

/** A line's pace for the Script view's marks: its speed, and how early it ends when it does. */
const linePacingOf = (seg: AudioSegment, text: string): LinePacing => {
  const pace = getPace(text, seg.duration);
  const line = reviewLineOf(seg, text, '');
  return { level: pace.level, cps: pace.cps, endsEarlyBy: line.status === 'short' ? line.underflow : null };
};

/** Whether the table groups its rows into passages, kept on this computer. */
const TABLE_PASSAGES_KEY = 'dhvani_table_passages';

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

/** Whole seconds, so it re-renders once a second. */
const LiveClock: React.FC<LiveTimeProps> = ({ currentTime, isPlaying, getLiveTime }) => (
  <>{formatClock(useLiveTime(currentTime, isPlaying, getLiveTime, 1))}</>
);

const railButton =
  'flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg border border-edge bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-default';

/**
 * The step a job has got to: source until it is transcribed, review until
 * there is a dub, then Dub.
 */
export const stepForJob = (job: BatchJob | null): number =>
  !job || !hasTranscript(job.segments)
    ? 1
    : job.syncedAudioUrl || job.synthesizedAudioUrl || job.synthAudioBuffer
      ? 3
      : 2;

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
  /** The voice library has not arrived yet; the picker shows placeholders. */
  voicesLoading?: boolean;
  /** Which engine speaks the dub. Omitting the change handler hides the switch (no Cartesia key). */
  voiceEngine?: VoiceEngine;
  onVoiceEngineChange?: (engine: VoiceEngine) => void;
  onOpenPhoneticKeyboard?: (segment?: AudioSegment) => void;
  /** Transcribes the file; true once there is a transcript, false when it failed or was cancelled. */
  onAutoTranscribe: () => Promise<boolean>;
  isTranscribing: boolean;
  /** Stops the transcription in flight, on the server too. */
  onCancelTranscription?: () => void;
  /** The last step that may be opened, and why each later one is locked (services/steps.ts openSteps). */
  openUpTo?: number;
  lockedWhy?: Record<number, string>;
  /** The last transcription of this project was cancelled by the user. */
  transcriptionCancelled?: boolean;
  /** Display name of the ElevenLabs model the dub is generated with. */
  ttsModelName?: string;
  /** The ElevenLabs model the dub is voiced with, and the models to choose from. */
  elModelId?: string;
  onElModelIdChange?: (modelId: string) => void;
  elModels?: ElevenLabsModel[];
  /** How much expression the dub is voiced with: Neutral, Natural (from the source audio) or Expressive. */
  voiceExpression?: VoiceExpression;
  onVoiceExpressionChange?: (expression: VoiceExpression) => void;
  /** The Cartesia model a Cartesia dub is voiced with: Natural and Expressive need a sonic-3 one. */
  cartesiaModelId?: string;
  /** Brings a dub's lines (or, with several speakers, each speaker) to one loudness; off keeps each at the level it was voiced at. */
  dubMatchLoudness?: boolean;
  onDubMatchLoudnessChange?: (enabled: boolean) => void;
  /** The format the dub is voiced in; a plan that refuses it gets the next one down, and `dubQualityNotice` says why. */
  dubAudioQuality?: DubAudioQuality;
  onDubAudioQualityChange?: (quality: DubAudioQuality) => void;
  dubQualityNotice?: string | null;
  /** Used to load the voice's own ElevenLabs settings, which the sliders start from. */
  elApiKey?: string;
  /** Null means the voice's own ElevenLabs settings are used. */
  elVoiceSettings?: ElevenLabsVoiceSettings | null;
  onElVoiceSettingsChange?: (settings: ElevenLabsVoiceSettings | null) => void;
  /** Dub & sync: the dub, voiced line by line and placed on the original's phrases. */
  onSyncDub?: (options: SyncOptions) => void;
  /** Sync from scratch: every line voiced anew, nothing kept from the dub before (asks first). */
  onSyncFromScratch?: (options: SyncOptions) => void;
  /** Syncs only the lines changed since the last Sync, every other line held where it is. */
  onSyncChangedOnly?: (options: SyncOptions) => void;
  /** The Dub step's sync settings changed, for the project they belong to. */
  onSyncOptionsChange?: (projectId: string, options: SyncOptions) => void;
  /** Raised by Sync settings in the header's menu: each new value opens the Sync settings window. */
  syncSettingsRequest?: number;
  /** Edit timing: the synced dub's lines changed by hand, with a name for the change. Omitted hides Edit timing. */
  onSyncEditsChange?: (edits: SyncEdits, label: string, tracks?: AudioTrack[]) => void;
  /** Edit timing's tracks of outside audio: their files, and mute and solo for listening. */
  syncAudio?: AudioTrackLanes;
  /** Saves the dub with its tracks mixed in, as WAV or MP3. */
  onDownloadWithTracks?: (format: 'wav' | 'mp3') => Promise<void>;
  /** Puts back the synced dub from before a whole-file voice change, so its timing can be edited again. */
  onUndoVoiceChange?: () => void;
  /** Whether the synced dub has caught up with the edits. */
  syncEditStatus?: SyncEditStatus;
  /** Edit timing's dub is playing live from its lines, so edits are heard at once. */
  syncEditLive?: boolean;
  /** Edit timing's lines, decoded, while it is open; null once it closes. */
  onEditTimingAudio?: (buffer: AudioBuffer | null) => void;
  /** Edit timing's edits while a drag lasts, for the live dub; null when it ends with nothing changed. */
  onSyncEditDraft?: (edits: SyncEdits | null) => void;
  /** With several speakers, Edit timing's lanes: mute and solo for listening, and each speaker's level for the file. */
  speakerMonitor?: Record<string, SpeakerMonitor>;
  onSpeakerLevelChange?: (speaker: string, db: number) => void;
  onSpeakerMonitorChange?: (speaker: string, patch: Partial<SpeakerMonitor>) => void;
  onRetrySyncEditRender?: () => void;
  isSyncing?: boolean;
  /** Set while this project's dub waits for another project's to finish: that project's name. `isSyncing` is true meanwhile. */
  syncWaitingFor?: string | null;
  syncProgress?: SyncProgress | null;
  /** One continuous read: its progress while the script is voiced in one take, before Sync places the lines. */
  readProgress?: DubProgress | null;
  isCancellingSync?: boolean;
  onCancelSync?: () => void;
  /** Keys of synced lines reworded or retaken since the last sync. */
  syncPendingLines?: string[];
  /** Of those, the lines whose words are all that changed: retaken in the new words where they are. */
  syncPendingWords?: string[];
  onApplySyncLine?: (unit: SyncUnitReport, text: string) => void;
  /** Asks for a new take of each of these synced lines. */
  onRetakeSyncLines?: (units: SyncUnitReport[], takes: number) => void;
  /** Uses, or turns down, the take Sync offered for a line that ran long. */
  onUseOfferedTake?: (unit: SyncUnitReport) => void;
  onKeepOfferedTake?: (unit: SyncUnitReport) => void;
  /** Voices new takes of a synced line now, of the whole line or of some of its words (TakesPanel). */
  onVoiceSyncTakes?: (unit: SyncUnitReport, options: TakeAsk) => void;
  /** Puts one of a line's takes in the dub. */
  /** `copy`: put the take on that Alt + drag copy of the line only; the line keeps its take. */
  onUseSyncTake?: (key: string, takeId: string, copy?: string) => void;
  /** Drops a line's takes but Sync's own and the one in the dub. */
  onClearSyncTakes?: (key: string) => void;
  /** The voice a speaker was changed into by the voice changer, while their retakes are changed into it; null otherwise. */
  changedVoiceOf?: (speaker: string) => { voiceId: string; name: string } | null;
  /** Puts one take of a line through the voice changer into its speaker's changed voice. */
  onChangeSyncTakeVoice?: (key: string, takeId: string) => void;
  /** Stops changing a speaker's retakes into their changed voice. */
  onForgetChangedVoice?: (speaker: string) => void;
  /** The line whose takes are being voiced. */
  syncTakesBusy?: string | null;
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
  /** The listening level of each track in the Dub step's player; solo is `trackMode`. */
  mixerLevels?: MixerLevels;
  onMixerLevelChange?: (track: MixerTrack, patch: Partial<TrackLevel>) => void;
  /** A track's peak level right now, 0 to 1, for its meter. */
  getTrackPeak?: (track: MixerTrack) => number;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  onResetSession?: () => void;
  onDownloadWav: () => void;
  /** Saves the synced dub as MP3. */
  onDownloadMp3?: () => Promise<void>;
  onDownloadSrt: () => void;
  /** Saves the script; `lines` replaces the cues when the script follows the synced dub. */
  onDownloadScript?: (format?: TargetScriptFormat, lines?: AudioSegment[]) => void;
  /** Saves the project's subtitle edits and Edit timing markers. */
  onUpdateJobFields?: (patch: Partial<Pick<BatchJob, 'subtitleEdits' | 'syncMarkers' | 'syncTakeChoices'>>) => void;
  isCompact?: boolean;
  customPrompt?: string;
  promptPresetId?: string;
  onUpdateTranslationPrompt?: (prompt: string, presetId: string) => void;
  onRetranslateSegments?: (prompt: string, options?: { fast?: boolean }) => Promise<void>;
  onRetranscribeAudio?: (prompt: string) => Promise<void>;
  /** The transcript's explicit "Translate" choice; the only path that translates a waiting transcript. */
  onTranslateTranscript?: (options?: { fast?: boolean }) => Promise<void>;
  /** Saves the transcript as Dhvani JSON, paragraph text or subtitles; never transcribes or translates. */
  onExportTranscript?: (format: TranscriptFormat) => Promise<TranscriptExportResult>;
  /** Puts a cut made on the transcript screen on the project, keeping the cut as transcribed for Reset. */
  onApplyTranscriptSegments?: (segments: AudioSegment[]) => void;
  /** The dub voice's speaking rate, measured from a sample read when it is picked (services/voiceRate.ts). */
  voiceRate?: VoiceRateState;
  /** With several speakers: the rate of each speaker's own voice from the cast, by speaker name. */
  speakerVoiceRates?: Record<string, VoiceRateState>;
  /** Translation sizes each cue for the voice's rate. */
  fitTranslationToVoice?: boolean;
  onFitTranslationToVoiceChange?: (on: boolean) => void;
  /** Records where the target lines came from, e.g. 'custom' once a pasted script is applied. */
  onTargetSourceChange?: (source: TargetSource) => void;
  /** Steps the script's history: back, forward, or back to where it starts. */
  onReviewHistory?: (action: 'undo' | 'redo' | 'base') => void;
  /** The project's one history (script and dub): Undo, Redo and the History lists in Review and Edit timing. */
  projectHistory?: ProjectHistoryView;
  /** Where translation runs, for the choice panel. */
  translationSummary?: string | null;
  /** False when no translation engine is set up. */
  translationReady?: boolean;
  translationProgress?: RetranslateProgress | null;
  isTranslatingLanguage?: boolean;
  /** Stops the running translation; nothing it did is applied. */
  onCancelTranslation?: () => void;
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
  voicesLoading = false,
  voiceEngine = 'elevenlabs',
  onVoiceEngineChange,
  onOpenPhoneticKeyboard,
  onAutoTranscribe,
  isTranscribing,
  onCancelTranscription,
  openUpTo = 4,
  lockedWhy = {},
  transcriptionCancelled = false,
  ttsModelName = 'ElevenLabs',
  elModelId,
  voiceExpression = 'off',
  onVoiceExpressionChange,
  cartesiaModelId,
  dubMatchLoudness = false,
  onDubMatchLoudnessChange,
  dubAudioQuality = DEFAULT_DUB_AUDIO_QUALITY,
  onDubAudioQualityChange,
  dubQualityNotice = null,
  onElModelIdChange,
  elModels = [],
  elApiKey = '',
  elVoiceSettings = null,
  onElVoiceSettingsChange,
  onSyncDub,
  onSyncFromScratch,
  onSyncChangedOnly,
  onSyncOptionsChange,
  syncSettingsRequest = 0,
  onSyncEditsChange,
  syncAudio,
  onDownloadWithTracks,
  onUndoVoiceChange,
  syncEditStatus = { state: 'ready' },
  syncEditLive = false,
  onEditTimingAudio,
  onSyncEditDraft,
  speakerMonitor,
  onSpeakerLevelChange,
  onSpeakerMonitorChange,
  onRetrySyncEditRender,
  isSyncing = false,
  syncWaitingFor = null,
  syncProgress = null,
  readProgress = null,
  isCancellingSync = false,
  onCancelSync,
  syncPendingLines = [],
  syncPendingWords = [],
  onApplySyncLine,
  onRetakeSyncLines,
  onUseOfferedTake,
  onKeepOfferedTake,
  onVoiceSyncTakes,
  onUseSyncTake,
  onClearSyncTakes,
  changedVoiceOf,
  onChangeSyncTakeVoice,
  onForgetChangedVoice,
  syncTakesBusy = null,
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
  mixerLevels,
  onMixerLevelChange,
  getTrackPeak,
  playbackRate = 1.0,
  onPlaybackRateChange,
  onResetSession,
  onDownloadWav,
  onDownloadMp3,
  onDownloadSrt,
  onDownloadScript,
  onUpdateJobFields,
  isCompact = true,
  customPrompt,
  promptPresetId,
  onUpdateTranslationPrompt,
  onRetranslateSegments,
  onRetranscribeAudio,
  onTranslateTranscript,
  voiceRate,
  speakerVoiceRates,
  fitTranslationToVoice = true,
  onFitTranslationToVoiceChange,
  onTargetSourceChange,
  onReviewHistory,
  projectHistory,
  onExportTranscript,
  onApplyTranscriptSegments,
  translationSummary = null,
  translationReady = true,
  translationProgress = null,
  isTranslatingLanguage,
  onCancelTranslation,
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
  /** Which Review button the running re-translation came from, for its spinner. */
  const [fastRetranslating, setFastRetranslating] = useState(false);

  // Pro Review Suite Mode & Controls
  const [reviewMode, setReviewMode] = useState<ReviewMode>('table');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pacingFilter, setPacingFilter] = useState<'all' | 'risk' | 'tight' | 'short' | 'fix'>('all');
  // Several speakers: whose cues the review shows (none: everyone), and labels to check.
  const [speakerFilter, setSpeakerFilter] = useState<string[]>([]);
  const [slipsOnly, setSlipsOnly] = useState(false);
  const [keptSlips, setKeptSlips] = useState<Set<string>>(() => new Set());
  // The speaker whose voice the library picks, or null for the main voice.
  const [castPickFor, setCastPickFor] = useState<string | null>(null);
  /** The script as the synced dub has it (lines removed in Edit timing left out, its times), or every cue. */
  const [scriptScope, setScriptScopeState] = useState<ScriptScope>(() => {
    try {
      return localStorage.getItem(SCRIPT_SCOPE_KEY) === 'full' ? 'full' : 'heard';
    } catch {
      return 'heard';
    }
  });
  const setScriptScope = (scope: ScriptScope) => {
    setScriptScopeState(scope);
    try {
      localStorage.setItem(SCRIPT_SCOPE_KEY, scope);
    } catch {}
  };
  const [isVoicePickerOpen, setIsVoicePickerOpen] = useState(false);
  const { favorites: favoriteVoices } = useFavoriteVoices();
  const [reviewFontPx, setReviewFontPx] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(REVIEW_FONT_KEY));
      if (saved >= REVIEW_FONT_MIN && saved <= REVIEW_FONT_MAX) return saved;
    } catch {}
    return REVIEW_FONT_DEFAULT;
  });
  useEffect(() => {
    try {
      localStorage.setItem(REVIEW_FONT_KEY, String(reviewFontPx));
    } catch {}
  }, [reviewFontPx]);
  const reviewTextStyle: React.CSSProperties = { fontSize: `${reviewFontPx}px` };
  /** The original sits a step smaller than the dub line, so the dub reads first. */
  const reviewSourceStyle: React.CSSProperties = { fontSize: `${Math.max(REVIEW_FONT_MIN, reviewFontPx - 2)}px` };
  /** The cue being worked on: only its row shows counts, the fit meter and the wording buttons. */
  const [openCueId, setOpenCueId] = useState<string | null>(null);
  /** Detailed: every row shows its counts and fit, as the list did before. */
  const [reviewDetailed, setReviewDetailedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(REVIEW_DETAILS_KEY) === 'detailed';
    } catch {
      return false;
    }
  });
  const setReviewDetailed = (on: boolean) => {
    setReviewDetailedState(on);
    try {
      localStorage.setItem(REVIEW_DETAILS_KEY, on ? 'detailed' : 'simple');
    } catch {}
  };
  /** Review's setup windows, opened from the bar above the player. */
  const [reviewWindow, setReviewWindow] = useState<'translation' | 'speakers' | null>(null);
  const stepHeaderSlot = useStepHeaderSlot();
  /** The dub language's name, as the language list shows it. */
  const languageLabel = (() => {
    const hit = languages.find((lang) => (typeof lang === 'string' ? lang : lang.code) === targetLanguage);
    return hit ? (typeof hit === 'string' ? hit : hit.label) : targetLanguage;
  })();
  const [copiedCueId, setCopiedCueId] = useState<string | number | null>(null);
  const [isSrtModalOpen, setIsSrtModalOpen] = useState<boolean>(false);
  // The subtitle preview plays its own audio; the project's playback stops so the two never overlap.
  useEffect(() => {
    if (isSrtModalOpen && isPlaying) onTogglePlay();
  }, [isSrtModalOpen]);
  const [isAlignModalOpen, setIsAlignModalOpen] = useState<boolean>(false);
  /** A script pasted or dropped on the script choice, for the paste window to start from. */
  const [alignHandOff, setAlignHandOff] = useState<ScriptHandOff | null>(null);
  /** Dub step: the player's lanes are the Edit timing timeline. */
  const [editingTiming, setEditingTiming] = useState(false);
  /** A line picked in the Dub player to work on in the line list; n changes on every pick. */
  const [focusLine, setFocusLine] = useState<{ key: string; mode: 'takes' | 'words'; n: number } | null>(null);
  /** A local video to watch the dub against; it is only looked at, never part of the project. */
  const reviewVideo = useReviewVideo(activeJob?.id);
  /** The floating video's ✕ hides it; a new video shows again. */
  const [reviewVideoHidden, setReviewVideoHidden] = useState(false);
  useEffect(() => setReviewVideoHidden(false), [reviewVideo.video]);
  /** Edit timing: the line whose takes are open under the timeline. */
  const [timingTakesKey, setTimingTakesKey] = useState<string | null>(null);
  const [timingTakesPhrase, setTimingTakesPhrase] = useState<{ from: number; to: number } | null>(null);
  /** The Alt + drag copy of that line being retaken on its own, or null for the line itself. */
  const [timingTakesCopy, setTimingTakesCopy] = useState<string | null>(null);
  /** The retake window holds edited words not yet voiced. */
  const [timingTakesDirty, setTimingTakesDirty] = useState(false);
  useEffect(() => {
    if (!editingTiming) setTimingTakesKey(null);
  }, [editingTiming]);
  /** Dub step, once synced: the voice panel unfolded to change the voice before syncing again. */
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [srtOptions, setSrtOptions] = useState<SrtOptions>(() => {
    try {
      const saved = localStorage.getItem('dhvani_srt_options');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_SRT_OPTIONS;
  });
  /** The language and timing last chosen in Export subtitles, shown on the Export subtitles button. */
  const [subtitleChoice, setSubtitleChoice] = useState<SubtitleExportChoice>(loadSubtitleExportChoice);
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);
  // Offered in the toast right after a pasted script replaces every cue.
  const [toastUndo, setToastUndo] = useState<(() => void) | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scriptScrollRef = useRef<HTMLDivElement>(null);

  /** Where the original pauses long enough to start a passage; the Cues table and the Script view share it. */
  const [passagePause, setPassagePauseState] = useState<number>(loadPassagePause);
  const setPassagePause = (pause: number) => {
    setPassagePauseState(pause);
    savePassagePause(pause);
  };
  const [groupByPassage, setGroupByPassageState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(TABLE_PASSAGES_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const setGroupByPassage = (on: boolean) => {
    setGroupByPassageState(on);
    try {
      localStorage.setItem(TABLE_PASSAGES_KEY, on ? 'on' : 'off');
    } catch {}
  };
  /** Passages folded shut in the table, by their first cue. */
  const [foldedPassages, setFoldedPassages] = useState<Set<string>>(() => new Set());

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

  // The Script view saves a passage's lines together; onUpdateSegment in a loop would keep only the last one.
  const handleUpdateLines = (lines: { id: string | number; text: string }[]) => {
    const byId = new Map(lines.map((l) => [String(l.id), l.text]));
    onReplaceSegments(
      latestSegments.current.map((seg) => {
        const text = byId.get(String(seg.id));
        return text === undefined ? seg : { ...seg, textTarget: text, targetText: text };
      })
    );
  };

  const scrollToTop = () => {
    if (scriptScrollRef.current) {
      scriptScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const scrollToBottom = () => {
    if (scriptScrollRef.current) {
      scriptScrollRef.current.scrollTo({
        top: scriptScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  };

  // Pinned to the bottom of the cue list, so paging is in reach however far down a long page is scrolled.
  const renderPaginationControls = (inset = '') => {
    if (totalPages <= 1) return null;
    return (
      <div className={`sticky bottom-0 z-20 py-2 bg-slate-900/95 backdrop-blur-sm ${inset}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 px-3 bg-slate-950 rounded-xl border border-edge text-[11px] shadow-md">
        <div className="text-slate-400 font-medium">
          Cues <span className="text-indigo-400 font-bold">{(currentPage - 1) * itemsPerPage + 1} - {Math.min(filteredSegments.length, currentPage * itemsPerPage)}</span> of <span className="text-white font-bold">{filteredSegments.length}</span>
        </div>
        
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => goToPage(1)}
            className="p-1 rounded-lg border border-edge text-slate-400 hover:text-white hover:bg-slate-900 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-default"
            title="First Page"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
          
          <button
            type="button"
            disabled={currentPage === 1}
            onClick={() => goToPage(currentPage - 1)}
            className="px-2 py-1 rounded-lg border border-edge text-slate-300 hover:text-white hover:bg-slate-900 disabled:opacity-20 disabled:pointer-events-none transition-all flex items-center gap-1 font-semibold cursor-default"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Previous</span>
          </button>
          
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-slate-900 border border-edge font-medium">
            <span className="text-slate-400">Page</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (val >= 1 && val <= totalPages) {
                  goToPage(val);
                }
              }}
              className="w-8 bg-slate-950 border border-edge text-center rounded text-white font-bold text-xs focus:outline-none focus:border-indigo-500 py-0.5"
            />
            <span className="text-slate-500">of {totalPages}</span>
          </div>
          
          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => goToPage(currentPage + 1)}
            className="px-2 py-1 rounded-lg border border-edge text-slate-300 hover:text-white hover:bg-slate-900 disabled:opacity-20 disabled:pointer-events-none transition-all flex items-center gap-1 font-semibold cursor-default"
          >
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          
          <button
            type="button"
            disabled={currentPage === totalPages}
            onClick={() => goToPage(totalPages)}
            className="p-1 rounded-lg border border-edge text-slate-400 hover:text-white hover:bg-slate-900 disabled:opacity-20 disabled:pointer-events-none transition-all cursor-default"
            title="Last Page"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      </div>
    );
  };

  // The header shows and switches steps, so the step lives in App.
  const setStepOverride = onStepChange;
  // The Dub step's sync settings, shared by its rail and the "Sync again" in its results.
  const [syncOptions, setSyncOptions] = useSyncOptions(activeJob?.id, activeJob?.syncOptions, onSyncOptionsChange);
  // What Sync's own Fit to this video did on the last press, for this project only (AutoFitPanel).
  const [autoFit, setAutoFit] = useState<{
    jobId: string;
    outcome: AutoFitOutcome;
    undone?: boolean;
    groupingUsed?: boolean;
    hidden?: boolean;
    /** The report from before the press, so the sync's own report is told from it. */
    reportBefore?: unknown;
    /** The sync's report has been read for what it changed after voicing. */
    merged?: boolean;
  } | null>(null);
  const [autoFitting, setAutoFitting] = useState(false);
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
  const speakerColorOf = useMemo(() => new Map(speakers.map((sp) => [sp.name, sp.color])), [speakers]);
  // Sync settings from the header's menu: the Dub step's rail opens its own window, with Fit and Sync; any other step opens it on its own.
  const onDubStep = activeStep === 3 && Boolean(activeJob);
  const [syncSettingsAlone, setSyncSettingsAlone] = useState(false);
  const seenSyncSettingsRequest = useRef(syncSettingsRequest);
  useEffect(() => {
    if (syncSettingsRequest === seenSyncSettingsRequest.current) return;
    seenSyncSettingsRequest.current = syncSettingsRequest;
    if (!onDubStep) setSyncSettingsAlone(true);
  }, [syncSettingsRequest, onDubStep]);
  // All sync settings on the Dub settings card: opens the same window as the header's menu.
  const [cardSettingsRequest, setCardSettingsRequest] = useState(0);
  const speakerSlips = useMemo(() => {
    if (!multiSpeaker) return new Map<string, SpeakerSlip>();
    const slips = likelySlips(segments);
    for (const id of keptSlips) slips.delete(id);
    return slips;
  }, [segments, multiSpeaker, keptSlips]);
  const voiceReading = useVoiceMatches(activeJob?.audioBuffer, segments, multiSpeaker && activeStep === 2);
  const voiceMatches = voiceReading.matches;
  /** Cues that sound like another speaker, by cue id: who they sound like and how well they fit their own label. */
  const voiceFlags = useMemo(() => {
    const flags = new Map<string, { match: number; suggested: string }>();
    const names = new Set(segments.map(speakerOf));
    for (const seg of segments) {
      const id = String(seg.id);
      const found = voiceReading.cues.get(id);
      if (found?.suggested && names.has(found.suggested) && found.suggested !== speakerOf(seg) && !keptSlips.has(id)) {
        flags.set(id, { match: found.match, suggested: found.suggested });
      }
    }
    return flags;
  }, [segments, voiceReading.cues, keptSlips]);
  const [voiceOnly, setVoiceOnly] = useState(false);
  useEffect(() => {
    if (voiceFlags.size === 0) setVoiceOnly(false);
  }, [voiceFlags.size]);
  // Ticked cues, to hand to one speaker at once. Shift-click ticks everything between two cues.
  const [selectedCues, setSelectedCues] = useState<Set<string>>(() => new Set());
  const lastTicked = useRef<string | null>(null);
  useEffect(() => setSelectedCues(new Set()), [activeJob?.id]);
  useEffect(() => {
    // A cue that was split, joined or removed is no longer ticked.
    setSelectedCues((prev) => {
      const live = new Set(segments.map((s) => String(s.id)));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [segments]);
  const assignSpeaker = useCallback(
    (ids: Set<string>, speaker: string) => {
      if (ids.size === 0) return;
      onReplaceSegments(latestSegments.current.map((seg) => (ids.has(String(seg.id)) && speakerOf(seg) !== speaker ? { ...seg, speaker } : seg)));
    },
    [onReplaceSegments]
  );
  /** Plays a speaker's longest cue, so a suggested merge can be heard first. */
  const hearSpeaker = useCallback(
    (name: string) => {
      const cue = segments.filter((seg) => speakerOf(seg) === name).sort((a, b) => b.endTime - b.startTime - (a.endTime - a.startTime))[0];
      if (cue) onPlaySegmentSolo(cue);
    },
    [segments, onPlaySegmentSolo]
  );
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
  const transcribed = hasTranscript(segments);
  // Transcribed, but translate-or-your-script has not been chosen yet.
  const awaitingScript = activeJob?.targetSource === 'pending';
  const scriptIsCustom = activeJob?.targetSource === 'custom';

  /** Review's Re-translate and Fast re-translate; `fast` skips the meaning, length and term checks. */
  const retranslateFromReview = ({ fast = false }: { fast?: boolean } = {}) => {
    if (!onRetranslateSegments) return;
    if (
      scriptIsCustom &&
      !window.confirm(
        `Replace your script with an automatic ${targetLanguage} translation? This uses translation credits. You can paste your script again afterwards.`
      )
    ) {
      return;
    }
    setFastRetranslating(fast);
    onRetranslateSegments(customPrompt || '', { fast })
      .catch(() => {
        // The failure is shown in the job's warning banner.
      })
      .finally(() => setFastRetranslating(false));
  };

  /*
   * The sync preview: Review's line fit and suggestions, and the Dub step's
   * before the first sync. The voice's speaking rate comes from the last sync
   * (each line's characters over the seconds its words took), else from a dub
   * made before Dub and Sync were one step, else a typical rate, and each
   * place says which.
   */
  const dubSpeechSeconds = useMemo(
    () => (activeJob?.synthAudioBuffer ? measureSpeechSeconds(activeJob.synthAudioBuffer) : 0),
    [activeJob?.synthAudioBuffer]
  );
  const scriptCharacters = useMemo(() => scriptCharacterCount(segments), [segments]);
  // Counted when the dub was made, so editing lines afterwards doesn't shift the rate. Older dubs didn't save it.
  const rateCharacters = activeJob?.dubScriptCharacters ?? scriptCharacters;
  const syncRate = useMemo(() => syncedSpeakingRate(activeJob?.syncReport), [activeJob?.syncReport]);
  // How much the last sync closed its lines up once placed: the preview judges each line at that length.
  const placedShare = useMemo(() => {
    const share = syncedPlacedShare(activeJob?.syncReport);
    // Rounded, as the rate is, so it refetches the preview only when it really moves.
    return share === null ? undefined : Math.round(share * 100) / 100;
  }, [activeJob?.syncReport]);
  const fitSpeakerRates = useMemo(() => syncedSpeakerRates(activeJob?.syncReport,
    Object.fromEntries(Object.entries(activeJob?.cast || {}).map(([speaker, voice]) => [speaker, voice.voiceId])), elVoiceId, targetLanguage),
    [activeJob?.syncReport, activeJob?.cast, elVoiceId, targetLanguage]);
  const measuredRate = syncRate ?? (activeJob?.synthesizedAudioUrl ? speakingRate(rateCharacters, dubSpeechSeconds) : null);
  // Before the first sync: the voice's own rate, from the sample it read when it was picked.
  const sampleRate = voiceRate?.rate ?? null;
  const rateBasis: RateBasis = measuredRate !== null ? 'sync' : sampleRate ? 'sample' : 'typical';
  // Rounded so small script edits don't move every estimate and refetch the preview.
  const previewRate = Math.round((measuredRate ?? sampleRate?.charsPerSecond ?? TYPICAL_CHARS_PER_SECOND) * 10) / 10;
  /*
   * With several speakers, each speaker whose voice speaks at a rate of its
   * own: from the last sync's lines of that voice when there are enough,
   * else from the sample read of their own voice. Everyone else is estimated
   * at the rate above.
   */
  const speakerRateTable = useMemo(() => {
    const table: Record<string, { charsPerSecond: number; syllablesPerSecond: number; sample: boolean }> = {};
    if (!multiSpeaker) return table;
    for (const { name } of speakers) {
      const synced = fitSpeakerRates[name];
      if (synced && synced.lines >= MIN_SPEAKER_SYNC_LINES && synced.charsPerSecond > 0) {
        const texts = segments.filter((seg) => (seg.speaker || 'Speaker') === name).map(getTargetText);
        table[name] = { charsPerSecond: synced.charsPerSecond, syllablesPerSecond: syllableRate(texts, synced.charsPerSecond), sample: false };
        continue;
      }
      const own = speakerVoiceRates?.[name]?.rate;
      if (own) table[name] = { charsPerSecond: own.charsPerSecond, syllablesPerSecond: own.syllablesPerSecond, sample: true };
    }
    return table;
  }, [multiSpeaker, speakers, fitSpeakerRates, speakerVoiceRates, segments]);
  // Fit to this video: a speaker's sync rate when there is one, else the sample read of their own voice.
  const fitRates = useMemo<SpeakerFitRates>(
    () =>
      multiSpeaker
        ? Object.fromEntries(
            Object.entries(speakerRateTable).map(([name, rate]) => [name, rate.sample ? { charsPerSecond: rate.charsPerSecond, lines: 0, sample: true } : fitSpeakerRates[name]])
          )
        : fitSpeakerRates,
    [multiSpeaker, speakerRateTable, fitSpeakerRates]
  );
  const previewSpeakerRates = useMemo(
    () => Object.fromEntries(Object.entries(speakerRateTable).map(([name, rate]) => [name, Math.round(rate.charsPerSecond * 10) / 10])),
    [speakerRateTable]
  );
  // What Fit to this video measures from: the Fit card in Sync settings and Sync's own fit read the same.
  const fitSource = useMemo(
    () => ({
      segments,
      charsPerSecond: multiSpeaker ? TYPICAL_CHARS_PER_SECOND : previewRate,
      rateMeasured: !multiSpeaker && rateBasis !== 'typical',
      rateSample: !multiSpeaker && rateBasis === 'sample',
      speakerRates: fitRates,
    }),
    [segments, multiSpeaker, previewRate, rateBasis, fitRates]
  );
  /**
   * Sync, as pressed: Fit to this video first (unless turned off), then the
   * sync with what it settled on. The fit is arithmetic on the cues on the
   * local backend: no voice and no credit (services/syncAutoFit.ts).
   */
  const syncWithFit = async (base: SyncOptions, go: (options: SyncOptions) => void, { fresh = false } = {}) => {
    const job = activeJob;
    if (!job || autoFitting) return;
    if (base.fitOnSync === false) {
      setAutoFit(null);
      return go(base);
    }
    setAutoFitting(true);
    let result: Awaited<ReturnType<typeof autoFitForSync>> = null;
    let refit: SyncOptions['refit'] = null;
    try {
      const { segments: _cues, ...source } = fitSource;
      result = await autoFitForSync({
        options: base,
        segments,
        source,
        // Lines voiced by a sync before: their grouping stays, or a sync would voice them again.
        voicedBefore: Boolean(job.syncReport || job.syncBank || job.syncedAudioUrl),
        fresh,
        fit: (body) => fitJoinSettings(body),
        preview: (join) =>
          previewSync({
            segments,
            precision: base.precision,
            join,
            charsPerSecond: previewRate,
            speakerRates: previewSpeakerRates,
            placedShare,
            sourceDuration: job.audioBuffer?.duration || 0,
          }),
      });
      // Once the lines are voiced, Sync measures how long they really run and may swap these settings (syncRefit.js).
      if (result) refit = await refitRequestFor(result.options, { segments, source, fit: (body) => fitJoinSettings(body) });
    } finally {
      setAutoFitting(false);
    }
    if (!result) return go(base);
    setAutoFit({ jobId: job.id, outcome: result.outcome, reportBefore: job.syncReport ?? null });
    const next = result.options;
    if (next !== base) setSyncOptions((o) => ({ ...o, preset: next.preset, join: next.join, fitted: next.fitted, fitUndone: next.fitUndone }));
    // Sent with this Sync only, never kept with the settings.
    go(refit ? { ...next, refit } : next);
  };
  // The sync's report: what Sync changed once the lines were voiced joins the What changed panel, once.
  useEffect(() => {
    const report = activeJob?.syncReport;
    if (!autoFit || autoFit.merged || autoFit.jobId !== activeJob?.id || isSyncing || !report || report === autoFit.reportBefore) return;
    setAutoFit({ ...autoFit, outcome: withRefit(autoFit.outcome, report), merged: true });
  }, [autoFit, activeJob?.id, activeJob?.syncReport, isSyncing]);
  const hasSyncReport = Boolean(activeJob?.syncedAudioUrl && activeJob?.syncReport);
  // Dub & sync on the Dub step: the progress page while it runs, then its result until Open the dub.
  const syncRun = useSyncRun(isSyncing, syncProgress, syncWaitingFor ?? null);
  // Leaving the Dub step or the project drops the result: it is for the moment after.
  const syncPage = useSyncPageView(isSyncing, activeJob?.id ?? null, hasSyncReport ? activeJob?.syncReport ?? null : null, activeStep === 3);
  /*
   * The second track is the synced dub once there is one (App picks the same
   * file), else a dub made before Dub and Sync were one step.
   */
  const onSyncedTrack = hasSyncReport;
  /** The cues where Sync placed them, for subtitles that match the synced dub. */
  const syncedCues = useMemo(
    () => (hasSyncReport && activeJob?.syncReport ? syncedSegments(segments, activeJob.syncReport) : undefined),
    [hasSyncReport, activeJob?.syncReport, segments]
  );
  /** Cues the synced dub no longer says: their whole line was removed or muted in Edit timing. */
  const removedCueIds = useMemo(() => {
    const ids = new Set<string>();
    if (!hasSyncReport) return ids;
    for (const unit of activeJob?.syncReport?.units || []) {
      if (unit.placedStart === null || unit.placedEnd === null) for (const id of unit.cueIds) ids.add(String(id));
    }
    return ids;
  }, [hasSyncReport, activeJob?.syncReport]);
  const scriptFollowsDub = scriptScope === 'heard' && Boolean(syncedCues);
  /** Each cue's start in the synced dub, for the script's times as heard. */
  const syncedStartOf = useMemo(() => new Map((syncedCues || []).map((cue) => [String(cue.id), cue.startTime])), [syncedCues]);
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

  /*
    A passage played from the Script view stops at its end, on the original's
    clock. Seeking or playing elsewhere drops the stop, so it never pauses later playback.
  */
  const passageStopRef = useRef<{ start: number; end: number; armedAt: number } | null>(null);
  const sourceClockTimeRef = useRef(sourceClockTime);
  sourceClockTimeRef.current = sourceClockTime;
  const handlePlayPassage = (start: number, end: number) => {
    passageStopRef.current = { start, end, armedAt: performance.now() };
    seekSource(start);
    if (!isPlaying) onTogglePlay();
  };
  useEffect(() => {
    if (!isPlaying) {
      passageStopRef.current = null;
      return;
    }
    let frame = 0;
    const watch = () => {
      const stop = passageStopRef.current;
      // The clock can still read the old place for a moment after the seek.
      if (stop && performance.now() - stop.armedAt > 300) {
        const t = getSourceLiveTime?.() ?? sourceClockTimeRef.current;
        if (t >= stop.end && t < stop.end + 1) {
          passageStopRef.current = null;
          onTogglePlay();
          return;
        }
        if (t < stop.start - 1 || t >= stop.end + 1) passageStopRef.current = null;
      }
      frame = requestAnimationFrame(watch);
    };
    frame = requestAnimationFrame(watch);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, getSourceLiveTime, onTogglePlay]);
  const heardCues = hearingDub ? dubCues : segments;

  // Split and join by hand, on the original's clock.
  const reviewEditing = activeStep === 2 && Boolean(activeJob) && !awaitingScript;
  const historyLabels = reviewHistoryLabels(activeJob?.reviewHistory);
  const reviewUndo: ReviewUndo = {
    undoLabel: onReviewHistory ? (projectHistory?.labels.undo ?? null) : null,
    redoLabel: onReviewHistory ? (projectHistory?.labels.redo ?? null) : null,
    baseLabel: onReviewHistory ? historyLabels.base : null,
    history: projectHistory,
    undo: () => onReviewHistory?.('undo'),
    redo: () => onReviewHistory?.('redo'),
    backToBase: () => onReviewHistory?.('base'),
  };
  // Ctrl+Z on the Dub step too; Edit timing, while open, has its own keys for the same history.
  useReviewUndoKeys(reviewEditing || (activeStep === 3 && Boolean(activeJob) && !editingTiming && Boolean(projectHistory)), reviewUndo);
  const cueEditing = useCueEditing({
    enabled: reviewEditing,
    segments,
    onReplaceSegments,
    getPlayhead: () => getSourceLiveTime?.() ?? sourceClockTime,
    onHear: (start, end) => onPlaySegmentSolo({ id: 'cut', startTime: start, endTime: end, duration: end - start }),
    retranslate: (cues) =>
      retranslateCues(cues, {
        sourceLanguage: activeJob?.detectedLanguage || sourceLanguage || '',
        targetLanguage,
        customPrompt: activeJob?.customPrompt || customPrompt || '',
      }),
  });
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
   * Review checks the script against the original, so it plays the original;
   * leaving it gives the Dub step back the track it had.
   */
  const trackBeforeReviewRef = useRef<'source' | 'synth' | 'both' | null>(null);
  useEffect(() => {
    if (activeStep === 2) {
      if (trackMode !== 'source') {
        trackBeforeReviewRef.current = trackMode;
        switchTrack('source', { play: false });
      }
    } else if (trackBeforeReviewRef.current) {
      switchTrack(trackBeforeReviewRef.current, { play: false });
      trackBeforeReviewRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep]);
  /** Plays from a time on the original's clock on the track picked in Listen to. */
  const listenHere = useCallback(
    (t: number) => switchTrack(trackMode, { seek: toHeardClock(t), play: true }),
    [switchTrack, trackMode, toHeardClock]
  );
  const listenOriginal = useCallback((t: number) => switchTrack('source', { seek: t, play: true }), [switchTrack]);

  const syncPreview = useSyncPreview({
    enabled:
      ((activeStep === 2 && !awaitingScript) || (activeStep === 3 && !hasSyncReport)) && !isSyncing && segments.length > 0,
    segments,
    precision: syncOptions.precision,
    join: syncOptions.join,
    charsPerSecond: previewRate,
    speakerRates: previewSpeakerRates,
    placedShare,
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
  /**
   * The dub lines either side of a line's cues, and who says it, so the text
   * model reads the line in context: what it answers, what "he" or "this"
   * points to, a sentence that runs on.
   */
  const lineContextOf = (cueIds: (string | number)[], speaker?: string | null): LineContext | undefined => {
    const ids = new Set(cueIds.map(String));
    const first = segments.findIndex((seg) => ids.has(String(seg.id)));
    if (first < 0) return undefined;
    let last = first;
    while (last + 1 < segments.length && ids.has(String(segments[last + 1].id))) last++;
    const textsOf = (list: AudioSegment[]) => list.map((seg) => getTargetText(seg).trim()).filter(Boolean);
    return {
      before: textsOf(segments.slice(Math.max(0, first - LINE_CONTEXT), first)),
      after: textsOf(segments.slice(last + 1, last + 1 + LINE_CONTEXT)),
      speaker: (speaker ?? segments[first].speaker) || undefined,
    };
  };
  /**
   * Shorter, fuller or same-length wordings of a line, from the text model: the
   * way the user pressed. The way the line's fit points aims at its slot (targetChars);
   * the other way aims a fifth shorter or longer than the line is now.
   */
  const suggestLine = (unit: SyncPreviewUnit, avoid: string[], direction: RewriteDirection, count: number) =>
    (direction === 'longer' ? suggestLongerLine : direction === 'same' ? suggestRewordedLine : suggestShorterLine)({
      text: unit.text,
      sourceText: unit.sourceText,
      language: targetLanguage,
      // A line that fits may take up to what its slot holds, at its own estimated rate.
      targetChars:
        direction === 'same'
          ? Math.max(unit.text.length, Math.floor((unit.text.length * unit.slot * SLOT_MARGIN) / Math.max(0.1, unit.estimate)))
          : direction === directionFor(unit)
            ? unit.targetChars
            : direction === 'shorter'
              ? Math.max(1, Math.floor(unit.text.length * PICKED_SHORTER))
              : Math.max(unit.text.length + 1, Math.ceil(unit.text.length * PICKED_LONGER)),
      avoid,
      count,
      // One wording from one fast call; its meaning is checked behind it (checkLine).
      quick: true,
      context: lineContextOf(unit.cueIds),
      examples: choicesFor(activeJob?.id, unit.text),
    }).then((options) => options.map((o) => (o.issues ? o : { ...o, checking: true })));
  /** The meaning check of a quick wording, run while the user already reads it. */
  const checkLine = (unit: SyncPreviewUnit, option: LineSuggestion, direction: RewriteDirection) =>
    checkWording({ text: unit.text, sourceText: unit.sourceText, candidate: option.text, language: targetLanguage, direction });
  /**
   * Wordings of a synced line for its retake, asked for from the Takes panel:
   * shorter when the words run past the slot, otherwise reworded, with pauses
   * marked where the meaning wants them in the time the slot has to spare.
   */
  const suggestTakeWording = (unit: SyncUnitReport) => (request: WordingRequest) =>
    (request.direction === 'shorter' ? suggestShorterLine : request.direction === 'longer' ? suggestLongerLine : suggestRewordedLine)({
      text: request.text,
      sourceText: unit.sourceText,
      language: targetLanguage,
      targetChars: request.targetChars,
      avoid: request.avoid,
      count: LINE_OPTIONS,
      context: lineContextOf(unit.cueIds, unit.speaker),
      examples: choicesFor(activeJob?.id, stripPauses(request.text)),
      pauseBudget: request.pauseBudget,
    });
  /** A wording put into the script, remembered for this project so later suggestions follow the user's style. */
  const useLine = (unit: SyncPreviewUnit, text: string) => {
    rememberChoice(activeJob?.id, { from: unit.text, to: text });
    return applyPreviewLine(unit, text);
  };
  /** Review's rewording of a sync line, the one place a line is reworded before it is voiced. */
  const lineFixes = useLineFixes({ onSuggest: suggestLine, onCheck: checkLine, onUseLine: useLine, onRestore: restoreCueTexts });
  /** Review's rewording of one cue, while the line fit is still being worked out. */
  const reviewFixes = useLineFixes({ onSuggest: suggestLine, onCheck: checkLine, onUseLine: useLine, onRestore: restoreCueTexts });
  /** The preview with the lengths the user trimmed lines to on the timeline; both steps use it. */
  /** Quick or Expert, the user's pick, kept across restarts; both steps' previews follow it. */
  const [estimateMethod, setEstimateMethod] = useState<EstimateMethod>(() => {
    try {
      // Expert unless the user picked Quick: syllables time Indic lines far closer than characters do.
      return localStorage.getItem(ESTIMATE_METHOD_KEY) === 'quick' ? 'quick' : 'expert';
    } catch {
      return 'expert';
    }
  });
  const changeEstimateMethod = (method: EstimateMethod) => {
    setEstimateMethod(method);
    try {
      localStorage.setItem(ESTIMATE_METHOD_KEY, method);
    } catch {
      /* Storage off: the pick lasts until the app closes. */
    }
  };
  /*
   * Each voice's pace as learned from every Sync of it (services/voicePace.ts):
   * syllables a second while it speaks, and its pauses at a comma, a full stop
   * and between words. A Sync report teaches it as soon as it is here; the
   * Expert estimate then reads lines at it. Free: Sync already timed the words.
   */
  const paceModel = voiceEngine === 'cartesia' ? cartesiaModelId : elModelId;
  const [paceVersion, setPaceVersion] = useState(0);
  useEffect(() => {
    const report = activeJob?.syncReport;
    if (!activeJob?.id || !report || (report.language && report.language !== targetLanguage)) return;
    if (learnPaceFromSync(activeJob.id, report, (voiceId) => voicePaceKey(voiceId, paceModel, targetLanguage))) setPaceVersion((v) => v + 1);
    // Learned once per report: a model or language picked later doesn't make an old report teach again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.id, activeJob?.syncReport]);
  const mainPace = useMemo(
    () => (elVoiceId ? learnedPace(voicePaceKey(elVoiceId, paceModel, targetLanguage)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elVoiceId, paceModel, targetLanguage, paceVersion]
  );
  /** With several speakers, the learned pace of each speaker with a voice of their own; null while it has said too little. */
  const speakerPaces = useMemo(() => {
    const out: Record<string, LearnedPace | null> = {};
    for (const [name, voice] of Object.entries(activeJob?.cast || {})) {
      if (multiSpeaker && voice?.voiceId && voice.voiceId !== elVoiceId) out[name] = learnedPace(voicePaceKey(voice.voiceId, paceModel, targetLanguage));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob?.cast, multiSpeaker, elVoiceId, paceModel, targetLanguage, paceVersion]);
  // The voice's rate in syllables: learned from its Syncs, else as the sample read measured it, else from the same rate in characters.
  const scriptSyllableRate = useMemo(() => syllableRate(segments.map(getTargetText), previewRate), [segments, previewRate]);
  const syllablesPerSecond = mainPace?.syllablesPerSecond ?? (rateBasis === 'sample' && sampleRate ? sampleRate.syllablesPerSecond : scriptSyllableRate);
  /** The syllables a second of whoever says a line: their own voice's, else the main voice's. */
  const syllableRateOf = useCallback(
    (speaker?: string | null) => {
      const name = speaker || 'Speaker';
      if (name in speakerPaces) return speakerPaces[name]?.syllablesPerSecond ?? speakerRateTable[name]?.syllablesPerSecond ?? syllablesPerSecond;
      return speakerRateTable[name]?.syllablesPerSecond ?? syllablesPerSecond;
    },
    [speakerPaces, speakerRateTable, syllablesPerSecond]
  );
  /** The pauses whoever says a line makes, once learned: their own voice's, else the main voice's. */
  const pausesOf = useCallback(
    (speaker?: string | null) => {
      const name = speaker || 'Speaker';
      return name in speakerPaces ? speakerPaces[name]?.pauses : mainPace?.pauses;
    },
    [speakerPaces, mainPace]
  );
  /** Where the Expert estimate's pace comes from, as Review says it. */
  const expertBasis: RateBasis = mainPace ? 'learned' : rateBasis;
  /** A part of a dub line being dragged on Review's dub lane: the fit follows it before it is let go. */
  const [placeDrag, setPlaceDrag] = useState<PlaceDrag | null>(null);
  /** A line being stretched by an edge on Review's dub lane: the fit follows its speed before it is let go. */
  const [stretchDraft, setStretchDraft] = useState<StretchDraft | null>(null);
  /**
   * Where a stretch shows: 'line', its speed on the line and a wording button
   * under it (Mock A); 'card', a clear lane and the picked line's speed and
   * wordings in a card under the player (Mock B). Remembered across sessions.
   */
  const [stretchView, setStretchView] = useState<'line' | 'card'>(() => {
    try {
      return localStorage.getItem('dhvani.stretchView') === 'card' ? 'card' : 'line';
    } catch {
      return 'line';
    }
  });
  const changeStretchView = (view: 'line' | 'card') => {
    setStretchView(view);
    try {
      localStorage.setItem('dhvani.stretchView', view);
    } catch {
      /* Storage off: the choice lasts until the app closes. */
    }
  };
  const linePreview = useMemo(() => {
    // The script as typed now, not as the server last saw it: the fit follows each key.
    const base = withLiveText(syncPreview.preview, segments);
    const targeted = withLineTargets(base && estimateMethod === 'expert' ? expertPreview(base, segments, syllablesPerSecond, syllableRateOf, pausesOf) : base, segments);
    // Judged where the user placed each line, and the one being dragged where it is now;
    // with Cut at the original's pauses, each line cut there as Sync will cut it.
    const { join } = syncOptions;
    const pauseCuts = join.chunkSync && join.cutAtSourcePauses ? { minPause: join.sourceCutMinPause, maxInsert: join.sourceCutMaxInsert } : null;
    // Each stretched line read at its speed first; a left edge being dragged moves the line's first word too.
    const rated = withLineRates(targeted, segments, stretchDraft);
    const draft = placeDrag ?? (stretchDraft && stretchDraft.start !== undefined ? { key: stretchDraft.key, part: 0, start: stretchDraft.start ?? null } : null);
    return withLinePlaces(rated, segments, draft, pauseCuts);
  }, [syncPreview.preview, segments, estimateMethod, syllablesPerSecond, syllableRateOf, pausesOf, placeDrag, stretchDraft, syncOptions]);
  /** The dub bar picked on the Dub step's preview timeline, for trimming. */
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);
  /** A trim being dragged on Review's dub lane, and whether that lane shows bars or words. */
  const [laneDrag, setLaneDrag] = useState<{ key: string; seconds: number } | null>(null);
  const [laneView, setLaneView] = useLaneView();
  const selectedLine = linePreview?.units.find((u) => u.key === selectedLineKey) || null;
  /**
   * The line being heard, by the lane's own rule (its start to the next
   * phrase). The play row shows the picked line, so the pick follows the
   * playhead into each line: what you hear is what you see fixed. A line whose
   * wordings are open stays until they are used or closed; a pick made on the
   * lane (or a stretch) stays until the playhead reaches another line.
   */
  const heardLineKey = useMemo(
    () => linePreview?.units.find((u) => sourceClockTime >= u.srcStart && sourceClockTime < Math.max(u.nextStart ?? -Infinity, u.srcEnd))?.key ?? null,
    [linePreview, sourceClockTime]
  );
  useEffect(() => {
    if (!heardLineKey || heardLineKey === selectedLineKey) return;
    if (selectedLine && lineFixes.stateOf(selectedLine).kind !== 'idle') return;
    setSelectedLineKey(heardLineKey);
  }, [heardLineKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /** A line's cues as the list numbers them: "8" or "8–10". */
  const cueRangeOf = (unit: SyncPreviewUnit) => {
    const numbers = unit.cueIds.map((id) => segments.findIndex((seg) => String(seg.id) === String(id)) + 1).filter((n) => n > 0);
    if (!numbers.length) return undefined;
    const lo = Math.min(...numbers);
    const hi = Math.max(...numbers);
    return lo === hi ? String(lo) : `${lo}–${hi}`;
  };
  /** A line's original words, its cues' joined, for under its own in the play row. */
  const lineSourceOf = (unit: SyncPreviewUnit) =>
    unit.cueIds
      .map((id) => segments.find((seg) => String(seg.id) === String(id)))
      .map((seg) => (seg ? getSourceText(seg) : ''))
      .filter(Boolean)
      .join(' ');
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
  /** Each track's meter reading, kept between renders so the meters don't restart. */
  const trackPeaks = useMemo(
    () => ({
      source: getTrackPeak ? () => getTrackPeak('source') : undefined,
      synth: getTrackPeak ? () => getTrackPeak('synth') : undefined,
    }),
    [getTrackPeak]
  );
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
    lineFixes.reset(unit);
  };
  /** Sets where a line is placed and cut, on its first cue (DubPlace); null puts it back where Sync puts it. */
  const setLinePlace = (unit: SyncPreviewUnit, change: (place: ReturnType<typeof placeOf>) => ReturnType<typeof placeOf>) => {
    const first = String(unit.cueIds[0]);
    onReplaceSegments(
      segments.map((seg) => {
        if (String(seg.id) !== first) return seg;
        const { dubPlace, ...rest } = seg;
        const next = change(dubPlace ?? null);
        return next ? { ...rest, dubPlace: next } : rest;
      })
    );
  };
  const placeLine = (unit: SyncPreviewUnit, letters: number, start: number | null) => setLinePlace(unit, (place) => withPartStart(place, unit, letters, start));
  const cutLine = (unit: SyncPreviewUnit, letters: number, on: boolean) => setLinePlace(unit, (place) => withCut(place, unit, letters, on));
  /** Where the rest of a line would go if cut after `letters` letters: placed as the preview places a cut line, nothing saved. */
  const cutGhost = useCallback(
    (unit: SyncPreviewUnit, letters: number) => {
      if (!linePreview) return null;
      const first = String(unit.cueIds[0]);
      const cutSegments = segments.map((seg) => {
        if (String(seg.id) !== first) return seg;
        const { dubPlace, ...rest } = seg;
        const next = withCut(dubPlace ?? null, unit, letters, true);
        return next ? { ...rest, dubPlace: next } : rest;
      });
      const { join } = syncOptions;
      const pauseCuts = join.chunkSync && join.cutAtSourcePauses ? { minPause: join.sourceCutMinPause, maxInsert: join.sourceCutMaxInsert } : null;
      const part = withLinePlaces({ ...linePreview, units: [unit] }, cutSegments, null, pauseCuts)?.units[0]?.parts?.find((q) => q.letters === letters);
      return part ? { start: part.start, end: part.start + (part.to - part.from) } : null;
    },
    [linePreview, segments, syncOptions]
  );
  /** Stretches a line to `rate` (1 takes the stretch off); a left edge dragged also puts its first word at `start`. */
  const stretchLine = (unit: SyncPreviewUnit, rate: number, start?: number | null) => {
    // The line stretched is the one picked, so the card shows it (without moving the page).
    setSelectedLineKey(unit.key);
    setLinePlace(unit, (place) => {
      const rated = withLineRate(place, unit, rate);
      return start === undefined ? rated : withPartStart(rated, unit, 0, start);
    });
  };
  /** Another wording for a line stretched too far: the line is picked, and its wordings asked for in the list below. */
  const suggestStretched = (unit: SyncPreviewUnit, direction: 'shorter' | 'longer') => {
    pickReviewLine(unit);
    lineFixes.controlsFor(unit).onSuggest(direction);
  };
  /** Turns a line's cut at the original's pause off, or back on. */
  const skipPauseCut = (unit: SyncPreviewUnit, letters: number, skip: boolean) => setLinePlace(unit, (place) => withPauseSkip(place, unit, letters, skip));
  /** Where the original's words start, for a dragged dub line to snap to. */
  const sourceWordStarts = useMemo(
    () => segments.flatMap((seg) => (seg.words || []).filter((w) => /[\p{L}\p{N}]/u.test(String(w.text ?? '')) && Number.isFinite(w.start)).map((w) => w.start)),
    [segments]
  );
  /** Each cue's sync line, for Review to show a line's fit and rewording once, under its last cue. */
  const unitOfCue = useMemo(() => {
    const map = new Map<string, SyncPreviewUnit>();
    for (const unit of linePreview?.units || []) for (const id of unit.cueIds) map.set(String(id), unit);
    return map;
  }, [linePreview]);
  /** Each line's stretch of the original, in its colour, for the Review player to draw the speech in. */
  const reviewLineSpans = useMemo(
    () => (linePreview && !hearingDub && !awaitingScript ? linePreview.units.map((u) => ({ from: u.srcStart, to: u.srcEnd, color: hueOf(u.index) })) : undefined),
    [linePreview, hearingDub, awaitingScript]
  );
  /**
   * How a cue sits, everywhere Review marks it (its row, the filters, the
   * passages, the Script view, the player): the Sync fit of the line it is in,
   * so every mark agrees with the fit. A cue in no line yet, or before the fit
   * is worked out, is judged on its own by characters a second, as before.
   */
  const cuePace = useCallback(
    (seg: AudioSegment, text = getTargetText(seg)) => {
      const own = getPace(text, seg.duration);
      const unit = unitOfCue.get(String(seg.id));
      if (!unit) return { ...own, endsEarly: endsEarly(seg, text), underflow: 0, lineKey: undefined as string | undefined };
      const level: 'natural' | 'tight' | 'fast' = unit.status === 'long' ? 'fast' : unit.status === 'tight' ? 'tight' : 'natural';
      return {
        cps: own.cps,
        level,
        meter: Math.min(100, (unit.estimate / Math.max(0.1, unit.slot)) * 80),
        label: unit.status === 'long' ? 'Too long' : unit.status === 'tight' ? 'Tight' : unit.status === 'short' ? 'Ends early' : 'Fits',
        pillClass: own.pillClass,
        barClass: level === 'fast' ? 'bg-rose-400' : level === 'tight' ? 'bg-amber-400' : unit.status === 'short' ? 'bg-sky-400' : 'bg-emerald-400',
        endsEarly: unit.status === 'short',
        underflow: unit.underflow,
        lineKey: unit.key as string | undefined,
      };
    },
    [unitOfCue]
  );
  /**
   * A cue's dub line in syllables against its slot, from the live text. A cue
   * in a sync line of several cues is judged with that whole line, in its slot.
   */
  const syllableFitOf = (seg: AudioSegment): SyllableFitInfo => {
    const unit = unitOfCue.get(String(seg.id));
    const own = timeLine(getTargetText(seg), 1).syllables;
    if (!unit) return { ...syllableFit(getTargetText(seg), seg.duration, syllableRateOf(seg.speaker)), own, cues: null };
    const text = unit.cueIds.map((id) => getTargetText(segments[cueIndexById.get(String(id)) ?? -1] ?? seg)).join(' ');
    const first = cueIndexById.get(String(unit.cueIds[0]));
    const last = cueIndexById.get(String(unit.cueIds[unit.cueIds.length - 1]));
    const cues = unit.cueIds.length > 1 && first !== undefined && last !== undefined ? `${first + 1}–${last + 1}` : null;
    // The slot holds as many syllables as Sync's closing up lets in: the slot at the read's length.
    return { ...syllableFit(text, unit.slot / (linePreview?.placedShare || 1), syllableRateOf(unit.speaker ?? seg.speaker)), own, cues };
  };
  /** Lines with no suggestion asked for yet, for Review's Suggest for all. */
  const linesToFix = (linePreview?.units || []).filter((u) => needsFix(u) && lineFixes.notStarted(u));
  // A line stays under Lines to fix once it has been worked on, even when it now fits. A key, so the filter reruns only when they change.
  const fixCueKey = (linePreview?.units || [])
    .filter((u) => needsFix(u) || lineFixes.worked(u))
    .flatMap((u) => u.cueIds.map(String))
    .join(' ');
  const fixCueIds = useMemo(() => new Set(fixCueKey.split(' ')), [fixCueKey]);
  const linesToFixCount = (linePreview?.units || []).filter(needsFix).length;
  /** After a sync, the voice panel unfolds and comes into view. */
  const openVoicePanel = () => {
    setVoicePanelOpen(true);
    document.getElementById('dub-voice')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const filteredSegments = useMemo(() => {
    return segments.filter((seg) => {
      const srcText = getSourceText(seg).toLowerCase();
      const tgtText = getTargetText(seg).toLowerCase();
      const speaker = (seg.speaker || '').toLowerCase();
      const q = searchQuery.trim().toLowerCase();

      if (speakerFilter.length > 0 && !speakerFilter.includes(speakerOf(seg))) return false;
      if (slipsOnly && !speakerSlips.has(String(seg.id))) return false;
      if (voiceOnly && !voiceFlags.has(String(seg.id))) return false;

      if (q && !srcText.includes(q) && !tgtText.includes(q) && !speaker.includes(q)) {
        return false;
      }

      const pace = cuePace(seg);
      if (pacingFilter === 'risk') return pace.level === 'fast';
      if (pacingFilter === 'tight') return pace.level === 'tight';
      if (pacingFilter === 'short') return pace.endsEarly;
      if (pacingFilter === 'fix') return fixCueIds.has(String(seg.id));
      return true;
    });
  }, [segments, searchQuery, pacingFilter, speakerFilter, slipsOnly, speakerSlips, voiceOnly, voiceFlags, fixCueIds, cuePace]);
  const filteredIds = useMemo(() => new Set(filteredSegments.map((seg) => String(seg.id))), [filteredSegments]);

  /*
    Grammar check: only when the user presses Check grammar, on the lines they
    picked. Fixes show in the Grammar panel; the script changes only on Accept.
  */
  const [grammar, setGrammar] = useState<{
    running: boolean;
    error: string | null;
    checked: number;
    unread: number;
    fixes: GrammarFix[];
    states: Record<string, GrammarState>;
  } | null>(null);
  const grammarAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    grammarAbort.current?.abort();
    setGrammar(null);
  }, [activeJob?.id]);
  const startGrammarCheck = async (scope: GrammarScope) => {
    const list =
      scope === 'picked' ? segments.filter((seg) => selectedCues.has(String(seg.id))) : scope === 'shown' ? filteredSegments : segments;
    const lines = list
      .map((seg) => ({ id: String(seg.id), text: getTargetText(seg), sourceText: getSourceText(seg) }))
      .filter((l) => l.text.trim());
    grammarAbort.current?.abort();
    const abort = new AbortController();
    grammarAbort.current = abort;
    setGrammar({ running: true, error: null, checked: lines.length, unread: 0, fixes: [], states: {} });
    try {
      const { fixes, unread } = await checkGrammarLines(lines, targetLanguage, { signal: abort.signal });
      if (abort.signal.aborted) return;
      setGrammar((g) => g && { ...g, running: false, fixes, unread });
    } catch (err) {
      if (abort.signal.aborted) return;
      setGrammar((g) => g && { ...g, running: false, error: err instanceof Error ? err.message : 'The grammar check failed.' });
    }
  };
  const stopGrammarCheck = () => {
    grammarAbort.current?.abort();
    setGrammar((g) => g && { ...g, running: false, error: 'Stopped. Nothing was changed.' });
  };
  const closeGrammarCheck = () => {
    grammarAbort.current?.abort();
    setGrammar(null);
  };
  const markGrammar = (ids: string[], state: GrammarState) =>
    setGrammar((g) => g && { ...g, states: { ...g.states, ...Object.fromEntries(ids.map((id) => [id, state])) } });
  const acceptGrammarFixes = (fixes: GrammarFix[]) => {
    const now = new Map(latestSegments.current.map((seg) => [String(seg.id), getTargetText(seg)]));
    // A line edited since the check keeps the user's edit.
    const usable = fixes.filter((f) => now.get(f.id) === f.text);
    if (!usable.length) return;
    handleUpdateLines(usable.map((f) => ({ id: f.id, text: f.fixed })));
    markGrammar(usable.map((f) => f.id), 'accepted');
  };
  const undoGrammarFix = (fix: GrammarFix) => {
    if (grammar?.states[fix.id] === 'accepted') {
      const seg = latestSegments.current.find((s) => String(s.id) === fix.id);
      // Put back only while the line still reads as the fix left it.
      if (seg && getTargetText(seg) === fix.fixed) handleUpdateLines([{ id: fix.id, text: fix.text }]);
    }
    markGrammar([fix.id], 'open');
  };
  const grammarOpenIds = useMemo(
    () => new Set(grammar && !grammar.running ? grammar.fixes.filter((f) => (grammar.states[f.id] ?? 'open') === 'open').map((f) => f.id) : []),
    [grammar]
  );


  const activeSegmentId = useMemo(() => {
    return segments.find((s) => sourceClockTime >= s.startTime && sourceClockTime <= s.endTime)?.id || null;
  }, [segments, sourceClockTime]);

  /*
    Follow the playhead: when it moves into another cue, open that cue's page
    and passage. Only a change of cue moves the view, so Prev / Next and
    edits made while the playhead rests inside a cue stay where the reviewer put them.
  */
  const followedCueId = useRef<string | number | null>(null);
  useEffect(() => {
    if (activeSegmentId === followedCueId.current) return;
    followedCueId.current = activeSegmentId;
    if (!activeSegmentId) return;
    const idx = filteredSegments.findIndex((s) => s.id === activeSegmentId);
    if (idx === -1) return;
    setCurrentPage(Math.floor(idx / itemsPerPage) + 1);
    if (groupByPassage) unfoldPassageOf(activeSegmentId);
  }, [activeSegmentId, filteredSegments]);

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

  /** Who voices a speaker, and how fast: shown on their lane in Edit timing. */
  const speakerCaption = (speaker: string) => {
    const own = activeJob?.cast?.[speaker]?.voiceId;
    const full = availableVoices?.find((v) => v.voice_id === (own || elVoiceId))?.name || '';
    const name = full.trim().split(/\s+[-–—|]\s+/)[0] || (own ? 'Own voice' : 'Main voice');
    const rate = (own ? speakerVoiceRates?.[speaker] : voiceRate)?.rate;
    return [name, rate && `${rate.syllablesPerSecond.toFixed(1)} syllables/s`].filter(Boolean).join(' · ');
  };

  /** "Aaditya" out of "Aaditya - Rich, Deep and Suspenseful", for button labels. */
  const voiceShortName = useMemo(() => {
    const full =
      availableVoices?.find((v) => v.voice_id === elVoiceId)?.name ||
      POPULAR_ELEVENLABS_VOICES.find((v) => v.id === elVoiceId)?.name ||
      '';
    return full.trim().split(/\s+[-–—|]\s+/)[0];
  }, [availableVoices, elVoiceId]);

  // With the Sync fit, lines are counted, as its card counts them; without it, cues.
  const pacingCounts = useMemo(() => {
    const counts = { natural: 0, tight: 0, fast: 0, short: 0 };
    if (linePreview) {
      for (const u of linePreview.units) {
        if (u.status === 'long') counts.fast++;
        else if (u.status === 'tight') counts.tight++;
        else counts.natural++;
        if (u.status === 'short') counts.short++;
      }
      return counts;
    }
    segments.forEach((seg) => {
      counts[getPace(getTargetText(seg), seg.duration).level]++;
      if (endsEarly(seg, getTargetText(seg))) counts.short++;
    });
    return counts;
  }, [segments, linePreview]);

  /** The script's passages, cut where the original pauses, with what needs fixing in each. */
  const passages = useMemo(
    () =>
      buildPassages(segments, passagePause).map((p) => {
        const counts = { fast: 0, tight: 0, short: 0 };
        // A line is counted once, in the passage its last cue is in.
        const counted = new Set<string>();
        p.cues.forEach((seg) => {
          const pace = cuePace(seg);
          if (pace.lineKey) {
            if (counted.has(pace.lineKey)) return;
            counted.add(pace.lineKey);
          }
          if (pace.level === 'fast') counts.fast++;
          else if (pace.level === 'tight') counts.tight++;
          if (pace.endsEarly) counts.short++;
        });
        return { ...p, counts };
      }),
    [segments, passagePause, cuePace]
  );
  const passageOfCue = useMemo(() => {
    const map = new Map<string, (typeof passages)[number]>();
    passages.forEach((p) => p.cues.forEach((seg) => map.set(String(seg.id), p)));
    return map;
  }, [passages]);
  /** Opens a folded passage so one of its cues can be shown. */
  /**
   * Read faster: Eleven v3 and v4 ignore the speed setting, so a line too long
   * can be read with a pace direction instead (server/lib/syncDub.js), chosen
   * here before the sync as Review's offered takes are after one. The next
   * sync voices it so; it lapses once the line's words change.
   */
  const canReadFaster = voiceEngine === 'elevenlabs' && /^eleven_v[34]/.test(elModelId || '') && Boolean(onUpdateJobFields);
  const readsFaster = (unit: SyncPreviewUnit) => {
    const choice = activeJob?.syncTakeChoices?.[unit.key];
    return Boolean(choice?.pace && choice.text === unit.text);
  };
  const setReadsFaster = (unit: SyncPreviewUnit, on: boolean) => {
    if (!activeJob || !onUpdateJobFields) return;
    const { [unit.key]: _old, ...choices } = activeJob.syncTakeChoices || {};
    const seed = activeJob.syncSeed;
    onUpdateJobFields({
      syncTakeChoices: on ? { ...choices, [unit.key]: { ...(Number.isInteger(seed) && { seed: seed as number }), pace: PACE_DIRECTION, text: unit.text } } : choices,
    });
  };

  /** A line picked on Review's dub lane: the player goes to it, and its last cue (where its fit sits) opens ready to type. */
  const pickReviewLine = (unit: SyncPreviewUnit) => {
    setSelectedLineKey(unit.key);
    onSeek(unit.srcStart);
    const last = unit.cueIds[unit.cueIds.length - 1];
    unfoldPassageOf(last);
    setOpenCueId(String(last));
    requestAnimationFrame(() => {
      const card = document.getElementById(`cue-card-${last}`);
      scrollWithin(card, 'center', true);
      card?.querySelector('textarea')?.focus({ preventScroll: true });
    });
  };
  /*
   * Review keys for the lines to fix: Alt + ↓ / ↑ goes to the next or previous
   * one; Alt + 1 / 2 puts that wording of the line being edited into the script.
   */
  const reviewKeys = useRef<(e: KeyboardEvent) => void>(() => {});
  reviewKeys.current = (e: KeyboardEvent) => {
    if (!e.altKey || e.ctrlKey || e.metaKey || !linePreview) return;
    const units = linePreview.units;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const toFix = units.filter(needsFix);
      if (toFix.length === 0) return;
      e.preventDefault();
      const at = units.findIndex((u) => u.key === selectedLineKey);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      for (let k = 1; k <= units.length; k++) {
        const u = units[(((at < 0 ? (step > 0 ? -1 : 0) : at) + step * k) % units.length + units.length) % units.length];
        if (needsFix(u)) return pickReviewLine(u);
      }
    }
    if (e.key === '1' || e.key === '2') {
      const card = (document.activeElement as HTMLElement | null)?.closest('[id^="cue-card-"]');
      const unit = card ? unitOfCue.get(card.id.slice('cue-card-'.length)) : selectedLine;
      if (!unit) return;
      const state = lineFixes.stateOf(unit);
      const option = state.kind === 'draft' ? state.options?.[Number(e.key) - 1] : undefined;
      if (!option) return;
      e.preventDefault();
      lineFixes.controlsFor(unit).onUse(option.text);
    }
  };
  useEffect(() => {
    if (activeStep !== 2) return;
    const listener = (e: KeyboardEvent) => reviewKeys.current(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [activeStep]);
  const unfoldPassageOf = (id: string | number) => {
    const key = passageOfCue.get(String(id))?.key;
    if (!key || !foldedPassages.has(key)) return;
    setFoldedPassages((folded) => {
      const next = new Set(folded);
      next.delete(key);
      return next;
    });
  };

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
    seekSource(seg.startTime);
    // The Script view shows the cue's paragraph when no filter hides it: its dub sentence opens for typing.
    const line =
      reviewMode === 'script'
        ? scriptScrollRef.current?.querySelector<HTMLElement>(`[data-dub-cue="${CSS.escape(String(seg.id))}"]`)
        : null;
    if (line) {
      line.scrollIntoView({ block: 'center', behavior: 'smooth' });
      line.focus({ preventScroll: true });
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
    unfoldPassageOf(seg.id);

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

  // A speaker filter can shrink the list under the page the reviewer is on.
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  // Paging opens the new page at its first cue, not wherever the last one was scrolled to.
  const goToPage = (page: number) => {
    setCurrentPage(Math.min(Math.max(1, page), Math.max(1, totalPages)));
    scriptScrollRef.current?.scrollTo({ top: 0 });
  };

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

  /**
   * The cues a script is made from. As heard: the synced dub's, so a line
   * removed or muted in Edit timing is left out and each keeps its time in
   * the dub. The script file stays whole: Paste script puts it back on cues.
   */
  const scriptLinesFor = (format: TargetScriptFormat) =>
    scriptFollowsDub && format !== 'json' && syncedCues ? syncedCues : segments;

  const handleExportTargetScript = (format: TargetScriptFormat = 'dialogue') => {
    if (format === 'docx') {
      void (async () => {
        const build = async () =>
          new Blob(
            [
              await buildScriptDocx({
                title: activeJob?.file?.name || `${targetLanguage || 'Dub'} script`,
                sourceLanguage: activeJob?.detectedLanguage || activeJob?.sourceLanguage || sourceLanguage,
                targetLanguage,
                rows: scriptDocxRows(scriptLinesFor(format), getSourceText, getTargetText, passagePause, loadWordParagraphSize()),
              }),
            ],
            { type: DOCX_MIME }
          );
        let message: string;
        try {
          // The dialog opens first, while the click still counts; the file is built after.
          const outcome = await saveFileAs(build, scriptDocxFileName(activeJob ? projectFileStem(activeJob) : 'Untitled dub'), { description: 'Word document', mime: DOCX_MIME, extension: '.docx' });
          if (outcome.status === 'cancelled') return;
          message = outcome.downloaded ? `Saved ${outcome.name} to your Downloads folder` : `Saved the ${targetLanguage} script as Word`;
        } catch (err) {
          console.warn('Saving the Word script failed:', err);
          message = `Couldn't save the Word file: ${err instanceof Error ? err.message : String(err)}`;
        }
        setExportSuccessMessage(message);
        setTimeout(() => setExportSuccessMessage(null), 5000);
      })();
      return;
    }
    if (onDownloadScript) {
      onDownloadScript(format, scriptLinesFor(format));
      setExportSuccessMessage(`Saved the ${targetLanguage} script`);
      setTimeout(() => setExportSuccessMessage(null), 3000);
      return;
    }

    if (!activeJob || !segments || segments.length === 0) return;
    const scriptContent = generateTargetLanguageScript(
      scriptLinesFor(format),
      targetLanguage,
      format,
      activeJob.file?.name ? `Dhvani Studio - ${activeJob.file.name}` : undefined,
      {
        sourceLanguage: activeJob.detectedLanguage || sourceLanguage || undefined,
        fileName: activeJob.file?.name,
        audioDuration: activeJob.audioBuffer?.duration,
      }
    );
    const name = projectFileStem(activeJob);
    const extension = format === 'json' ? 'json' : format === 'csv' ? 'csv' : 'txt';
    const mimeType =
      format === 'json'
        ? 'application/json'
        : format === 'csv'
        ? 'text/csv'
        : 'text/plain;charset=utf-8';
    const fileName = format === 'json' ? `${name} - script.json` : `${name} - script ${format}.${extension}`;

    downloadFile(scriptContent, fileName, mimeType);
    setExportSuccessMessage(`Saved the ${targetLanguage} script`);
    setTimeout(() => setExportSuccessMessage(null), 3000);
  };

  const handleCopyFullTargetScript = (format: TargetScriptFormat = 'dialogue') => {
    if (!segments || segments.length === 0) return;
    const scriptContent = generateTargetLanguageScript(scriptLinesFor(format), targetLanguage, format);
    try {
      navigator.clipboard.writeText(scriptContent);
      setExportSuccessMessage(`Copied the ${targetLanguage} script`);
      setTimeout(() => setExportSuccessMessage(null), 3000);
    } catch (e) {
      console.warn('Clipboard write failed:', e);
    }
  };

  const subtitleSourceLanguage = activeJob?.detectedLanguage || sourceLanguage;
  const hasSubtitleDub = Boolean(activeJob?.synthesizedAudioUrl);
  const subtitleTiming = resolveSubtitleTiming(subtitleChoice.timing, Boolean(syncedCues?.length), hasSubtitleDub);
  const subtitleLanguage =
    subtitleChoice.track === 'source' ? subtitleSourceLanguage || 'Original' : targetLanguage || 'Captions';
  const subtitleTimingLabel = { synced: 'the synced dub', dubbed: 'the dub', original: 'the original speech' }[subtitleTiming];

  /** A lane's header: the track's name, and its mute, solo, fader and meter when the player has a mixer. */
  const renderTrackHead = (track: MixerTrack, label: string, dot: string, badge?: React.ReactNode) => {
    if (!mixerLevels || !onMixerLevelChange || !hasDubAudio) {
      return (
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400 truncate">
          <span className={`w-2 h-2 rounded-sm shrink-0 ${dot}`} />
          {label}
          {badge}
        </span>
      );
    }
    const level = mixerLevels[track];
    const soloed = trackMode === track;
    return (
      <TrackStrip
        label={label}
        dot={dot}
        level={level}
        soloed={soloed}
        heard={!level.muted && (trackMode === 'both' || soloed)}
        onLevelChange={(patch) => onMixerLevelChange(track, patch)}
        // Two tracks: soloing one plays only it, and a second press plays both again.
        onSolo={() => switchTrack(soloed ? 'both' : track)}
        getPeak={trackPeaks[track]}
        isPlaying={isPlaying}
        badge={badge}
      />
    );
  };

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
            onLoadSample={onLoadSampleSession}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem] gap-4 items-stretch lg:flex-1">
            {/* Voice library: the main decision on this step */}
            <VoiceSelectorCard
              elVoiceId={elVoiceId}
              onElVoiceIdChange={onElVoiceIdChange}
              availableVoices={availableVoices}
              loading={voicesLoading}
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
              className="bg-slate-900/90 border border-edge rounded-2xl overflow-hidden flex flex-col"
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
                        className="appearance-none w-full h-10 bg-slate-950 border border-edge hover:border-slate-600 rounded-xl pl-3 pr-9 text-[13px] font-medium text-slate-100 truncate transition-colors focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 cursor-default"
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
                    className="w-9 h-10 flex items-center justify-center rounded-xl border border-edge text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors cursor-default"
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
                        className="appearance-none w-full h-10 bg-slate-950 border border-edge hover:border-slate-600 rounded-xl pl-3 pr-9 text-[13px] font-medium text-slate-100 truncate transition-colors focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 cursor-default"
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
                <div className="px-4 sm:px-5 py-4 border-t border-edge flex flex-col gap-2.5">
                  <label className="flex items-start justify-between gap-3 cursor-default">
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
                      className={`relative w-9 h-5 rounded-full shrink-0 mt-0.5 transition-colors cursor-default ${
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
                        className="h-8 bg-slate-950 border border-edge hover:border-slate-600 rounded-lg px-2 text-xs font-medium text-slate-200 focus:outline-none focus:border-indigo-500 cursor-default"
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

              <div className="px-4 sm:px-5 py-4 border-t border-edge flex flex-col gap-2.5">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                  {multiSpeaker || multiSpeakerInput ? 'Main voice' : 'Voice'}
                </span>
                <SelectedVoiceSummary voiceId={elVoiceId} availableVoices={availableVoices} />
                {multiSpeakerInput && !multiSpeaker && (
                  <p className="text-[11px] text-slate-500 leading-snug -mt-1">
                    Pick it for whoever speaks most, such as the host. Every speaker uses it until you give them their own.
                  </p>
                )}
                {multiSpeaker && activeJob && (
                  <MainVoiceRole speakers={speakers} cast={activeJob.cast} mainVoiceId={elVoiceId} availableVoices={availableVoices} />
                )}
                {voiceRate && <VoiceRateCard voiceRate={voiceRate} language={targetLanguage} />}
                {/* More than one person speaks is on, but no speakers are known yet: show what is coming, so the
                    section never looks like a one-voice dub. Voices are picked per speaker only after transcribing,
                    since which person ElevenLabs calls Speaker 1 is not known before. */}
                {multiSpeakerInput && !multiSpeaker && (
                  <div className="flex flex-col gap-1 pt-2">
                    <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Speakers</span>
                    {speakerCount > 0 &&
                      Array.from({ length: speakerCount }, (_, i) => (
                        <div key={i} className="flex items-center gap-2 py-1.5 border-t border-edge first:border-t-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0 opacity-70"
                            style={{ backgroundColor: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }}
                          />
                          <span className="flex-1 min-w-0 truncate text-[13px] text-slate-300">Speaker {i + 1}</span>
                          <span className="text-[11px] text-slate-500">Main voice</span>
                        </div>
                      ))}
                    <p className="text-[11px] text-slate-500 leading-snug pt-1">
                      {speakerCount > 0
                        ? 'After transcribing you will see who speaks most, and give each their own voice.'
                        : 'Speakers are found when the file is transcribed. Then you can give each their own voice here.'}
                    </p>
                  </div>
                )}
                {/* Each speaker's voice can be picked here too, so translation is sized for it before anything is voiced. */}
                {multiSpeaker && onCastChange && activeJob && (
                  <div className="flex flex-col gap-2 pt-2">
                    <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Cast</span>
                    <CastCard
                      speakers={speakers}
                      cast={activeJob.cast}
                      mainVoiceId={elVoiceId}
                      availableVoices={availableVoices}
                      onPick={(speaker) => {
                        setCastPickFor(speaker);
                        setIsVoicePickerOpen(true);
                      }}
                      onUseMain={(speaker) => onCastChange(speaker, null)}
                      rates={speakerVoiceRates}
                      mainRate={voiceRate}
                    />
                  </div>
                )}
              </div>

              {onSensitivityChange && (
                <div className="px-4 sm:px-5 py-4 border-t border-edge flex flex-col gap-2">
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
                    className="w-full accent-indigo-500 cursor-default"
                  />
                  <div className="flex justify-between text-[10.5px] text-slate-500">
                    <span>Fewer, longer lines</span>
                    <span>More, shorter lines</span>
                  </div>
                </div>
              )}

              {onOpenVoiceChanger && (
                <div className="px-4 sm:px-5 py-4 border-t border-edge">
                  <button
                    type="button"
                    onClick={onOpenVoiceChanger}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-edge hover:bg-slate-800/60 text-left transition-colors cursor-default"
                  >
                    <span className="w-8 h-8 rounded-lg bg-slate-950 border border-edge text-slate-400 flex items-center justify-center shrink-0">
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
                      className="mt-2 w-full flex items-center gap-3 p-2.5 rounded-xl border border-edge hover:bg-slate-800/60 text-left transition-colors cursor-default"
                    >
                      <span className="w-8 h-8 rounded-lg bg-slate-950 border border-edge text-slate-400 flex items-center justify-center shrink-0">
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

              <div className="mt-auto px-4 sm:px-5 py-4 border-t border-edge bg-slate-950/60 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    // Transcribing again replaces the cues, and with them any script on them.
                    if (
                      transcribed &&
                      !awaitingScript &&
                      !window.confirm(
                        scriptIsCustom
                          ? 'Transcribe again? The new transcript replaces the current cues and your aligned script. You can paste the script again afterwards.'
                          : 'Transcribe again? The new transcript replaces the current cues and their translation.'
                      )
                    ) {
                      return;
                    }
                    // Once transcribed, the app opens Review itself.
                    await onAutoTranscribe();
                  }}
                  disabled={!activeJob || isTranscribing}
                  className="h-11 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-default active:translate-y-px"
                >
                  {isTranscribing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Transcribing…</span>
                    </>
                  ) : activeJob ? (
                    <>
                      <Mic className="w-4 h-4" />
                      <span>{transcribed ? 'Transcribe again' : 'Transcribe audio'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  ) : (
                    <span>Add media to continue</span>
                  )}
                </button>

                {isTranscribing && onCancelTranscription && (
                  <button
                    type="button"
                    onClick={onCancelTranscription}
                    className="h-9 flex items-center justify-center gap-2 rounded-xl border border-slate-700 text-[13px] font-medium text-slate-200 hover:text-white hover:bg-slate-800 hover:border-rose-500/50 transition-colors cursor-default"
                  >
                    <X className="w-4 h-4" />
                    Cancel transcription
                  </button>
                )}
                {isTranscribing ? null : transcriptionCancelled ? (
                  <p className="text-xs text-amber-300" role="status">
                    Transcription cancelled. {transcribed ? 'The transcript you had is kept.' : 'Press Transcribe audio to start again.'}
                  </p>
                ) : activeJob && !transcribed ? (
                  <p className="text-xs text-slate-400">
                    Nothing is sent to ElevenLabs until you press Transcribe audio: set the language and speakers first.
                  </p>
                ) : (
                  // What transcribing starts: three small steps, ticked once done, the next one lit.
                  <ol aria-label="What happens next" className="flex items-start pt-0.5">
                    {['Transcribe', 'Word timings', 'Translate or your script'].map((label, i) => {
                      const done = transcribed && i < 2;
                      const next = transcribed ? i === 2 : i === 0;
                      return (
                        <li key={label} className="relative flex-1 flex flex-col items-center gap-1 text-center">
                          {i > 0 && (
                            <span
                              aria-hidden="true"
                              className={`absolute top-[9px] right-1/2 w-full h-px ${transcribed && i < 3 ? 'bg-emerald-500/40' : 'bg-slate-700'}`}
                            />
                          )}
                          <span
                            className={`relative w-[18px] h-[18px] rounded-full border flex items-center justify-center font-mono text-[10px] ${
                              done
                                ? 'border-emerald-500/60 bg-emerald-950 text-emerald-300'
                                : next
                                  ? 'border-indigo-400/70 bg-indigo-950 text-indigo-200'
                                  : 'border-slate-700 bg-slate-900 text-slate-500'
                            }`}
                          >
                            {done ? <Check className="w-2.5 h-2.5" strokeWidth={3} /> : i + 1}
                          </span>
                          <span className={`text-[11px] leading-tight ${done ? 'text-slate-400' : next ? 'text-slate-200' : 'text-slate-500'}`}>{label}</span>
                        </li>
                      );
                    })}
                  </ol>
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
          {/*
            Review's setup, out of the editor's way: back a step, and the script
            and its translation in a window in the middle. They
            sit in the app bar, so they take no row above the player.
          */}
          {!awaitingScript &&
            (() => {
              const inBar = Boolean(stepHeaderSlot);
              const button = inBar
                ? 'h-[34px] min-w-0 px-3 rounded-full border border-edge hover:bg-slate-800/60 text-[12.5px] text-slate-200 flex items-center gap-1.5 whitespace-nowrap cursor-default'
                : 'h-9 px-3 rounded-xl border border-edge bg-slate-900 hover:bg-slate-800 text-[13px] text-slate-200 flex items-center gap-2 cursor-default';
              const setup = (
                <>
                  {/* In the app bar the steps already go back to Source & voice, so only the window row has its own Back */}
                  {!inBar && (
                    <button
                      type="button"
                      onClick={() => setStepOverride(1)}
                      className={`group ${button} pl-2 gap-1.5`}
                      title="Back to step 1: the source, speakers and voices"
                    >
                      <ChevronLeft className="w-4 h-4 text-slate-400 transition-transform group-hover:-translate-x-0.5" />
                      <span className="text-slate-400">Back to</span> Source &amp; voice
                    </button>
                  )}
                  {!inBar && <span className="flex-1" />}
                  <button
                    type="button"
                    onClick={() => setReviewWindow('translation')}
                    className={button}
                    title={`Translation: ${languageLabel} · ${scriptIsCustom ? 'Your script' : promptStyleName(promptPresetId || DEFAULT_PROMPT_PRESET_ID)}. Style, the dub language, Re-translate, Paste script`}
                  >
                    <Languages className="w-4 h-4 text-slate-400 shrink-0" />
                    {inBar ? (
                      // In the app bar: the icon and the language only; "Translation" and the style are in the tooltip.
                      <span className="truncate max-w-[12rem]">{targetLanguage}</span>
                    ) : (
                      <>
                        Translation
                        <span className="text-slate-400 truncate max-w-[14rem]">
                          · {languageLabel} · {scriptIsCustom ? 'Your script' : promptStyleName(promptPresetId || DEFAULT_PROMPT_PRESET_ID)}
                        </span>
                      </>
                    )}
                  </button>
                  {inBar && <span className="w-px h-6 bg-slate-800 mx-0.5" aria-hidden="true" />}
                </>
              );
              return stepHeaderSlot ? createPortal(setup, stepHeaderSlot) : <div className="flex flex-wrap items-center gap-2">{setup}</div>;
            })()}

          <CenteredPanel open={reviewWindow === 'translation'} onClose={() => setReviewWindow(null)} label="Script and translation" className="max-w-[28rem] p-5">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="text-[16px] font-semibold text-slate-100 flex-1">Script &amp; translation</h2>
              <span
                className={`text-[12px] font-medium px-2 py-0.5 rounded-full ${scriptIsCustom ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-300'}`}
                title={
                  scriptIsCustom
                    ? 'The cues hold the script you pasted, aligned to the transcript. It was not translated.'
                    : 'The cues hold the automatic translation of the transcript.'
                }
              >
                {scriptIsCustom ? 'Your script' : 'Automatic'}
              </span>
              <button type="button" onClick={() => setReviewWindow(null)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-default" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-950/60 border border-edge">
              <span className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0">
                <SlidersHorizontal className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold text-slate-100 truncate">{promptStyleName(promptPresetId || DEFAULT_PROMPT_PRESET_ID)}</span>
                <span className="block text-[12.5px] text-slate-400">Translation style</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setReviewWindow(null);
                  if (onOpenPromptModal) onOpenPromptModal();
                  else setIsLocalPromptModalOpen(true);
                }}
                className="px-2.5 py-1 rounded-lg border border-edge bg-slate-900 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-default"
              >
                Change
              </button>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <label htmlFor="express-step2-lang-select" className="text-[13px] text-slate-400 shrink-0">
                Dub into
              </label>
              <select
                id="express-step2-lang-select"
                value={targetLanguage}
                onChange={(e) => onTargetLanguageChange(e.target.value)}
                className="flex-1 min-w-0 h-9 bg-slate-950 border border-edge rounded-lg px-2 text-[13px] font-medium text-slate-100 focus:outline-none focus:border-indigo-500 cursor-default"
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
            {isTranslatingLanguage && onCancelTranslation && (
              <button
                type="button"
                onClick={onCancelTranslation}
                className={`${railButton} h-9 text-[13px] w-full mt-3`}
                title="Stop the translation. Nothing it did is applied."
              >
                <X className="w-3.5 h-3.5" /> Cancel translation
              </button>
            )}
            <div className="grid grid-cols-2 gap-2 mt-3">
              {onRetranslateSegments && (
                <button
                  type="button"
                  onClick={() => {
                    setReviewWindow(null);
                    retranslateFromReview();
                  }}
                  disabled={isTranslatingLanguage || segments.length === 0}
                  className={`${railButton} h-9 text-[13px]`}
                  title={scriptIsCustom ? 'Replace your script with an automatic translation of the transcript' : 'Translate every cue again with the current style'}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTranslatingLanguage && !fastRetranslating ? 'animate-spin' : ''}`} />
                  {isTranslatingLanguage && !fastRetranslating ? 'Translating…' : 'Re-translate'}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setReviewWindow(null);
                  setIsAlignModalOpen(true);
                }}
                disabled={segments.length === 0}
                className={`${railButton} h-9 text-[13px]`}
                title="Paste your own translated script; each part is matched to the English cue it translates"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                Paste script
              </button>
              {onRetranslateSegments && (
                <button
                  type="button"
                  onClick={() => {
                    setReviewWindow(null);
                    retranslateFromReview({ fast: true });
                  }}
                  disabled={isTranslatingLanguage || segments.length === 0}
                  className={`${railButton} h-9 text-[13px] col-span-2`}
                  title="Translate every cue again, translation only: skips the meaning, length and term checks"
                >
                  {isTranslatingLanguage && fastRetranslating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  {isTranslatingLanguage && fastRetranslating ? 'Fast translating…' : 'Fast re-translate'}
                </button>
              )}
            </div>
          </CenteredPanel>


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
              unfoldPassageOf(seg.id);
              // The cue list scrolls to the card; the page, and with it the player, stays put.
              scrollWithin(document.getElementById(`cue-card-${seg.id}`), 'center', true);
            }}
            targetLanguage={targetLanguage}
            playbackRate={playbackRate}
            onPlaybackRateChange={onPlaybackRateChange}
            sensitivity={analysisSensitivity}
            onSensitivityChange={onSensitivityChange}
            onDragCut={!hearingDub && !awaitingScript ? cueEditing.dragCut : undefined}
            selectedCutId={hearingDub ? null : cueEditing.boundaryId}
            // Each line as Sync will place it, on the original's clock: picked here, it opens in the list below.
            belowWave={
              linePreview && !hearingDub && !awaitingScript
                ? ({ start, span, time, layers }) => (
                    <DubEstimateLane
                      units={linePreview.units}
                      windowStart={start}
                      windowSeconds={span}
                      selectedKey={selectedLineKey}
                      currentKey={linePreview.units.find((u) => time >= u.srcStart && time < Math.max(u.nextStart ?? -Infinity, u.srcEnd))?.key}
                      onSelect={pickReviewLine}
                      look={laneView}
                      drag={laneDrag}
                      setDrag={setLaneDrag}
                      onPlace={placeLine}
                      onCut={cutLine}
                      cutGhost={cutGhost}
                      // Bars: words typed in a line's bar go into the script, spread over its cues as a wording is.
                      onEditLine={(u, text) => applyPreviewLine(u, text)}
                      onSkipPause={skipPauseCut}
                      placeDrag={placeDrag}
                      setPlaceDrag={setPlaceDrag}
                      snapTimes={sourceWordStarts}
                      onStretch={stretchLine}
                      stretchDraft={stretchDraft}
                      setStretchDraft={setStretchDraft}
                      layers={layers}
                      rateMarks={stretchView === 'card' ? 'drag' : 'always'}
                    />
                  )
                : undefined
            }
            // Under the dub lane: another wording for a line stretched past what sounds natural.
            belowLane={
              linePreview && !hearingDub && !awaitingScript && stretchView === 'line'
                ? ({ start, span }) => (
                    <WordingSuggestRow
                      units={linePreview.units}
                      windowStart={start}
                      windowSeconds={span}
                      busy={(u) => lineFixes.stateOf(u).kind === 'working'}
                      onSuggest={suggestStretched}
                    />
                  )
                : undefined
            }
            toolbarExtra={
              linePreview && !hearingDub && !awaitingScript ? (
                <div role="group" aria-label="Line speed" className="ml-1 flex p-0.5 gap-0.5 rounded-full border border-edge">
                  {(
                    [
                      ['line', 'On line', 'A stretched line shows its speed on it, and another wording under it when it sounds rushed or drags'],
                      ['card', 'Card', 'The lane stays clear: the picked line\'s speed shows in the play row, with its fit'],
                    ] as const
                  ).map(([id, label, hint]) => (
                    <button
                      key={id}
                      type="button"
                      title={hint}
                      aria-pressed={stretchView === id}
                      onClick={() => changeStretchView(id)}
                      className={`h-5 px-2 rounded-full text-[11px] whitespace-nowrap cursor-default ${stretchView === id ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : undefined
            }
            // The lines' pauses in a row of their own, so they never cover a line.
            cuePace={linePreview && !hearingDub ? (seg) => cuePace(seg) : undefined}
            fastLabel={linePreview && !hearingDub ? 'Too long' : 'Too fast'}
            lineSpans={reviewLineSpans}
            pausesRow={
              linePreview && !hearingDub && !awaitingScript
                ? ({ start, span }) => <PauseTicksLane units={linePreview.units} segments={segments} windowStart={start} windowSeconds={span} />
                : undefined
            }
            // Blocks: the original's words in the waveform's place, coloured like their dub below.
            sourceLane={
              linePreview && !hearingDub && !awaitingScript && laneView === 'blocks'
                ? ({ start, span, layers }) => (
                    <SourceLineLane units={linePreview.units} segments={segments} windowStart={start} windowSeconds={span} look="blocks" numbers={layers.numbers} />
                  )
                : undefined
            }
            // Bars: under the waveform, the original in chunks cut where Sync cuts the dub, each as long as its words.
            sourceRow={
              linePreview && !hearingDub && !awaitingScript && laneView === 'bars'
                ? ({ start, span, layers }) => (
                    <SourceLineLane units={linePreview.units} segments={segments} windowStart={start} windowSeconds={span} look="bars" numbers={layers.numbers} />
                  )
                : undefined
            }
            // In the timeline's View menu: Wave, Blocks or Bars, right where the lanes change.
            laneSwitch={linePreview && !hearingDub && !awaitingScript ? <LaneViewSwitch view={laneView} onChange={setLaneView} /> : undefined}
            // In the play row, where the caption was: the picked line, its fit against its room and what fixes it (in Card view its speed too).
            caption={
              linePreview && !hearingDub && !awaitingScript && selectedLine ? (
                <LineFitRow
                  unit={selectedLine}
                  source={lineSourceOf(selectedLine)}
                  cues={cueRangeOf(selectedLine)}
                  fix={lineFixes.controlsFor(selectedLine)}
                  onStretch={(unit, rate) => stretchLine(unit, rate)}
                  onOpen={pickReviewLine}
                  showSpeed={stretchView === 'card'}
                />
              ) : undefined
            }
            // Under the play row, once asked for: the picked line's wordings.
            footer={
              linePreview && !hearingDub && !awaitingScript ? (
                <LineFitWordings unit={selectedLine} cps={linePreview.charsPerSecond} fix={selectedLine ? lineFixes.controlsFor(selectedLine) : null} />
              ) : undefined
            }
            // Split, Undo and History in the player's top bar, not a bar of their own.
            headerStart={!awaitingScript && !hearingDub ? <CueEditButtons editing={cueEditing} history={reviewUndo} /> : undefined}
            extraHints={!awaitingScript && !hearingDub ? REVIEW_EDIT_HINTS : undefined}
            // Who speaks when, as a thin line under the waveform; the rest of Speakers is in its window.
            speakerRow={
              multiSpeaker && !hearingDub
                ? ({ start, span }) => <SpeakerStrip segments={segments} colorOf={speakerColorOf} filter={speakerFilter} overlapIds={overlapIds} windowStart={start} windowSeconds={span} />
                : undefined
            }
          />

          {!awaitingScript && (
            <CueEditNotice editing={cueEditing} segments={segments} cueNumber={(id) => (cueIndexById.get(String(id)) ?? 0) + 1} />
          )}

          {/* A translation running from Review: how far it is, and Cancel. The lines change only once it finishes. */}
          {!awaitingScript && isTranslatingLanguage && (
            <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 bg-slate-900/90 border border-indigo-500/40 rounded-2xl px-3 py-2 text-[13px]">
              <RefreshCw className="w-4 h-4 text-indigo-300 animate-spin shrink-0" />
              <span className="text-slate-100">
                {translationProgress?.step === 'check' ? 'Checking meaning and length' : `Translating to ${targetLanguage}`}
                {(() => {
                  const fraction = translationFraction(translationProgress);
                  return fraction === null ? '…' : ` · ${Math.round(fraction * 100)}%`;
                })()}
              </span>
              <span className="text-slate-400 flex-1 min-w-[12rem]">Your lines stay as they are until it finishes.</span>
              {onCancelTranslation && (
                <button
                  type="button"
                  onClick={onCancelTranslation}
                  className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-600 hover:bg-slate-800 text-[12.5px] font-medium text-slate-100 cursor-default"
                  title="Stop the translation. Nothing it did is applied."
                >
                  <X className="w-3.5 h-3.5" /> Cancel
                </button>
              )}
            </div>
          )}

          {/* Speakers: who speaks, their filter, names and merges, in a window from the list's Speakers button */}
          {multiSpeaker && (
            <CenteredPanel open={reviewWindow === 'speakers'} onClose={() => setReviewWindow(null)} label="Speakers" className="max-w-[46rem] w-full">
            <SpeakerBar
              bare
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
              voiceMatches={voiceMatches}
              onHearSpeaker={!hearingDub ? hearSpeaker : undefined}
              voiceFlagCount={voiceFlags.size}
              voiceShown={voiceOnly}
              onShowVoice={() => {
                setVoiceOnly((on) => !on);
                setReviewMode('table');
                setCurrentPage(1);
              }}
              onFixByVoice={() => {
                const target = new Map([...voiceFlags].map(([id, flag]) => [id, flag.suggested]));
                onReplaceSegments(latestSegments.current.map((seg) => (target.has(String(seg.id)) ? { ...seg, speaker: target.get(String(seg.id)) } : seg)));
              }}
            />
            </CenteredPanel>
          )}

          {multiSpeaker && selectedCues.size > 0 && (
            <CueSelectionBar
              count={selectedCues.size}
              speakers={speakers}
              shownCount={filteredSegments.length}
              onAssign={(speaker) => {
                assignSpeaker(selectedCues, speaker);
                setSelectedCues(new Set());
              }}
              onSelectShown={() => setSelectedCues(new Set(filteredSegments.map((seg) => String(seg.id))))}
              onClear={() => setSelectedCues(new Set())}
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
              onCancelTranslation={onCancelTranslation}
              translationStyleName={promptStyleName(promptPresetId || DEFAULT_PROMPT_PRESET_ID)}
              translationSummary={translationSummary}
              translationReady={translationReady}
              onOpenPromptModal={() => {
                if (onOpenPromptModal) onOpenPromptModal();
                else setIsLocalPromptModalOpen(true);
              }}
              voiceRate={voiceRate?.rate ?? null}
              voiceName={voiceShortName}
              ownVoiceRates={multiSpeaker ? Object.values(speakerVoiceRates || {}).filter((state) => state.rate).length : 0}
              fitToVoice={fitTranslationToVoice}
              onFitToVoiceChange={onFitTranslationToVoiceChange}
              onTranslate={async () => {
                if (onTranslateTranscript) await onTranslateTranscript();
                else if (onRetranslateSegments) await onRetranslateSegments(customPrompt || '');
              }}
              onFastTranslate={onTranslateTranscript ? () => onTranslateTranscript({ fast: true }) : undefined}
              onUseOwnScript={(script) => {
                setAlignHandOff(script ? { ...script, n: Date.now() } : null);
                setIsAlignModalOpen(true);
              }}
              onSeek={seekSource}
              activeSegmentId={activeSegmentId}
              onExport={onExportTranscript}
              onApplySegments={onApplyTranscriptSegments}
              transcriptCuts={activeJob.transcriptCuts}
              onHear={(start, end) => onPlaySegmentSolo({ id: 'cut', startTime: start, endTime: end, duration: end - start })}
              getPlayhead={() => getSourceLiveTime?.() ?? sourceClockTime}
            />
          ) : (
          /* Workspace: cue editor and review panel share one height, so neither leaves a gap */
          <div className={`grid grid-cols-1 ${grammar ? 'lg:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_25rem]' : ''} gap-4 lg:h-[calc(100vh-7rem)] lg:min-h-[600px]`}>
            <section
              aria-label="Translation cues"
              className="flex flex-col min-h-0 h-[78vh] lg:h-auto bg-slate-900/90 border border-edge rounded-2xl overflow-hidden"
            >
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-b border-edge">
                <div
                  role="group"
                  aria-label="View"
                  className="flex bg-slate-950 border border-edge rounded-xl p-0.5 gap-0.5 max-w-full overflow-x-auto [scrollbar-width:none]"
                >
                  {REVIEW_VIEWS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={reviewMode === id}
                      onClick={() => setReviewMode(id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-default ${
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
                    <div className="relative flex-1 min-w-[10rem] max-w-[22rem]">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        id="express-step2-search"
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={reviewMode === 'script' ? 'Find in script' : 'Find in cues'}
                        className="w-full h-8 bg-slate-950 border border-edge rounded-xl pl-8 pr-7 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-200 cursor-default"
                          aria-label="Clear search"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Each line's fit at the voice's rate, in the toolbar's row; the one place to reword lines before they are voiced */}
                    {!awaitingScript && (
                      <ScriptFitStrip
                        inline
                        preview={linePreview}
                        loading={syncPreview.loading}
                        error={syncPreview.error}
                        rateBasis={rateBasis}
                        toFix={{
                          shorter: linesToFix.filter((u) => lineFixes.directionOf(u) === 'shorter').length,
                          longer: linesToFix.filter((u) => lineFixes.directionOf(u) === 'longer').length,
                        }}
                        onFixAll={() => {
                          lineFixes.suggestAll(linesToFix);
                          setReviewMode('table');
                          setPacingFilter('fix');
                        }}
                        basis={
                          linePreview
                            ? `${estimateBasis(linePreview, rateBasis, expertBasis, mainPace?.lines)}${
                                linePreview.placedShare < 1 ? `, each line at ${Math.round(linePreview.placedShare * 100)}% of its read once placed` : ''
                              }.`
                            : undefined
                        }
                        fixCount={pacingFilter === 'fix' ? 0 : linesToFixCount}
                        onShowFix={() => {
                          setReviewMode('table');
                          setPacingFilter('fix');
                        }}
                      />
                    )}

                    {/* One filter, its counts in lines once the Sync fit is worked out (as the strip counts them), else in cues */}
                    <div className="ml-auto">
                    <ShowLinesMenu
                      value={pacingFilter}
                      onChange={(id) => setPacingFilter(id)}
                      options={[
                        { id: 'all' as const, label: linePreview ? 'All lines' : 'All cues', count: linePreview ? linePreview.units.length : segments.length },
                        ...(linePreview ? [{ id: 'fix' as const, label: 'Lines to fix', count: linesToFixCount, dot: 'bg-indigo-400' }] : []),
                        { id: 'risk' as const, label: linePreview ? 'Too long' : 'Too fast', count: pacingCounts.fast, dot: 'bg-rose-400', divided: true },
                        { id: 'tight' as const, label: 'Tight', count: pacingCounts.tight, dot: 'bg-amber-400' },
                        { id: 'short' as const, label: 'Ends early', count: pacingCounts.short, dot: 'bg-sky-400' },
                      ]}
                    />
                    </div>
                  </>
                )}

                {/* Speakers: who is filtered, labels to check, names and merges, in a window */}
                {multiSpeaker && reviewMode !== 'qa' && (
                  <button
                    type="button"
                    onClick={() => setReviewWindow('speakers')}
                    className={`h-8 px-3 rounded-xl border flex items-center gap-2 text-[13px] whitespace-nowrap cursor-default ${
                      speakerFilter.length > 0 || slipsOnly || voiceOnly ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-200' : 'border-edge text-slate-200 hover:bg-slate-800'
                    }`}
                    title={`${speakers.length} speakers: show only some, check labels, rename or merge`}
                  >
                    <span className="flex -space-x-1" aria-hidden="true">
                      {speakers.slice(0, 4).map((sp) => (
                        <span key={sp.name} className="w-2.5 h-2.5 rounded-full ring-2 ring-slate-900" style={{ backgroundColor: sp.color }} />
                      ))}
                    </span>
                    <span className="truncate max-w-[10rem]">{speakerFilter.length > 0 ? speakerFilter.join(', ') : 'Speakers'}</span>
                    {speakerSlips.size + voiceFlags.size > 0 && (
                      <span className="px-1.5 rounded-md bg-amber-500 text-slate-950 text-[10px] font-mono font-semibold leading-4" title="Labels to check">
                        {speakerSlips.size + voiceFlags.size}
                      </span>
                    )}
                    <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                  </button>
                )}

                {reviewMode !== 'qa' && (
                  <div>
                    <GrammarCheckButton
                      picked={selectedCues.size}
                      shown={filteredSegments.length}
                      total={segments.length}
                      busy={Boolean(grammar?.running)}
                      onStart={startGrammarCheck}
                    />
                  </div>
                )}

                {/* How the list looks: line details, text size, passages, estimate, lanes, keyboard */}
                <div className={reviewMode === 'qa' ? 'ml-auto' : ''}>
                  <ReviewViewMenu
                    detailed={reviewDetailed}
                    onDetailed={setReviewDetailed}
                    fontPx={reviewFontPx}
                    fontMin={REVIEW_FONT_MIN}
                    fontMax={REVIEW_FONT_MAX}
                    fontDefault={REVIEW_FONT_DEFAULT}
                    onFontPx={setReviewFontPx}
                    groupByPassage={groupByPassage}
                    onGroupByPassage={setGroupByPassage}
                    passagePause={passagePause}
                    passagePauses={PASSAGE_PAUSES}
                    onPassagePause={setPassagePause}
                    passageCount={passages.length}
                    foldedCount={foldedPassages.size}
                    onUnfoldAll={() => setFoldedPassages(new Set())}
                    estimate={<EstimateSwitch method={estimateMethod} onChange={changeEstimateMethod} />}
                    onOpenKeyboard={onOpenPhoneticKeyboard ? () => onOpenPhoneticKeyboard() : undefined}
                  />
                </div>
              </div>



              {/* Active view */}
              <div ref={scriptScrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar">
                <div
                  className={
                    reviewMode === 'qa' ? 'p-3 sm:p-4 space-y-4' : ''
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
          {/* SCRIPT: long paragraphs, each dub sentence typed in where it stands     */}
          {/* ========================================================================= */}
          {reviewMode === 'script' && filteredSegments.length > 0 && (
            <ScriptTableView
              segments={segments}
              visibleIds={filteredIds}
              sourceLanguage={activeJob.detectedLanguage || activeJob.sourceLanguage || sourceLanguage}
              targetLanguage={targetLanguage}
              getSourceText={getSourceText}
              getTargetText={getTargetText}
              onUpdateLines={handleUpdateLines}
              getPacing={(seg, text) => {
                const pace = cuePace(seg, text);
                return pace.lineKey
                  ? { level: pace.level, cps: pace.cps, endsEarlyBy: pace.endsEarly ? pace.underflow : null, lineKey: pace.lineKey }
                  : linePacingOf(seg, text);
              }}
              fastLabel={linePreview ? 'too long' : 'too fast'}
              passagePause={passagePause}
              activeSegmentId={activeSegmentId}
              isPlaying={isPlaying}
              onSeek={seekSource}
              onPlayPassage={handlePlayPassage}
              onTogglePlay={onTogglePlay}
              fontSize={reviewFontPx}
              exportTitle={activeJob.file?.name}
              exportFileStem={projectFileStem(activeJob)}
              onOpenKeyboard={onOpenPhoneticKeyboard}
            />
          )}

          {/* Empty Filter State */}
          {reviewMode !== 'qa' && filteredSegments.length === 0 && (
            <div className="m-3 p-8 rounded-2xl bg-slate-950/60 border border-dashed border-edge text-center space-y-2">
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
          {/* OPTION 2: CUES (default): one row per cue, English beside the editable translation */}
          {/* ========================================================================= */}
          {reviewMode === 'table' && filteredSegments.length > 0 && (
            <div>
              {/* Group rows and the pause that starts a passage live in the ⋯ menu */}
              <div className="hidden md:grid grid-cols-[4.75rem_5.5rem_minmax(0,1fr)_minmax(0,1.3fr)_2rem] gap-4 px-4 py-2 sticky top-0 z-10 bg-slate-900 border-b border-edge text-[12px] font-medium text-slate-400">
                <span>#</span>
                <span>Time</span>
                <span>Original</span>
                <span>{languageLabel}</span>
                <span />
              </div>

              {paginatedSegments.map((seg, index) => {
                const srcText = getSourceText(seg);
                const tgtText = getTargetText(seg);
                const isCuePlaying = playingSegmentId === seg.id;
                const isCueActive = (sourceClockTime >= seg.startTime && sourceClockTime <= seg.endTime) || isCuePlaying;
                const pace = cuePace(seg, tgtText);
                // The cue's own number, so a filtered list still names cues as everywhere else.
                const cueNumber = (cueIndexById.get(String(seg.id)) ?? (currentPage - 1) * itemsPerPage + index) + 1;

                // A passage gets its header above the first of its cues on this page.
                const passage = groupByPassage ? passageOfCue.get(String(seg.id)) : undefined;
                const prevShown = paginatedSegments[index - 1];
                const opensPassage =
                  passage !== undefined && (!prevShown || passageOfCue.get(String(prevShown.id)) !== passage);
                const folded = passage !== undefined && foldedPassages.has(passage.key);
                const passageHeader = opensPassage && passage && (() => {
                  const first = passage.cues[0];
                  const last = passage.cues[passage.cues.length - 1];
                  const firstNumber = (cueIndexById.get(String(first.id)) ?? 0) + 1;
                  const lastNumber = (cueIndexById.get(String(last.id)) ?? 0) + 1;
                  const continued = String(first.id) !== String(seg.id);
                  const { fast, tight, short } = passage.counts;
                  return (
                    <>
                      {passage.index > 0 && !continued && (
                        <div className="flex items-center gap-2 px-4 pt-3 pb-1 font-mono text-[12px] text-slate-500">
                          <span className="flex-1 border-t border-dashed border-edge" />
                          {passage.pauseBefore.toFixed(1)}s pause in original
                          <span className="flex-1 border-t border-dashed border-edge" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          setFoldedPassages((prev) => {
                            const next = new Set(prev);
                            if (next.has(passage.key)) next.delete(passage.key);
                            else next.add(passage.key);
                            return next;
                          })
                        }
                        aria-expanded={!folded}
                        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 bg-slate-900/80 border-y border-edge text-left text-[12.5px] hover:bg-slate-800/60 cursor-default"
                        title={folded ? 'Show this passage' : 'Fold this passage'}
                      >
                        {folded ? (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                        )}
                        <span className="font-semibold text-slate-200">
                          Passage {passage.index + 1}
                          {continued && <span className="font-normal text-slate-500">, continued</span>}
                        </span>
                        <span className="font-mono text-[12px] text-slate-400 tabular-nums">
                          {formatSeconds(first.startTime)}
                          {first.speaker ? ` · ${first.speaker}` : ''} · {firstNumber === lastNumber ? `cue ${firstNumber}` : `cues ${firstNumber}–${lastNumber}`}
                        </span>
                        {/* What needs work, in one plain count: too long and ending early (tight lines still fit) */}
                        <span
                          className="ml-auto text-[12.5px] tabular-nums"
                          title={[fast > 0 && `${fast} ${linePreview ? 'too long' : 'too fast'}`, tight > 0 && `${tight} tight`, short > 0 && `${short} ending early`].filter(Boolean).join(', ') || undefined}
                        >
                          {fast + short > 0 ? (
                            <span className="text-slate-200">{fast + short} to fix</span>
                          ) : (
                            <span className="text-slate-400">{linePreview ? 'All fit' : 'All natural'}</span>
                          )}
                        </span>
                      </button>
                    </>
                  );
                })();

                // The row being worked on shows its counts, fit and wording buttons; the rest stay quiet.
                const isOpen = openCueId === String(seg.id);
                const showDetail = isOpen || reviewDetailed;
                // A line to fix gets a coloured edge on every cue it spans: red too long, blue ends early.
                const unitHere = linePreview ? unitOfCue.get(String(seg.id)) : undefined;
                const fixEdge = unitHere
                  ? needsFix(unitHere)
                    ? unitHere.status === 'short'
                      ? 'bg-sky-400'
                      : 'bg-rose-400'
                    : ''
                  : pace.level === 'fast'
                    ? 'bg-rose-400'
                    : pace.endsEarly
                      ? 'bg-sky-400'
                      : '';
                const isLastCue = cueIndexById.get(String(seg.id))! >= segments.length - 1;

                return (
                  <React.Fragment key={seg.id}>
                  {passageHeader}
                  {!folded && (
                  <div
                    id={`cue-card-${seg.id}`}
                    onMouseDown={() => setOpenCueId(String(seg.id))}
                    onFocusCapture={() => setOpenCueId(String(seg.id))}
                    className={`group relative grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[4.75rem_5.5rem_minmax(0,1fr)_minmax(0,1.3fr)_2rem] gap-x-4 gap-y-2 px-4 py-3 border-b transition-colors ${
                      String(cueEditing.boundaryId) === String(seg.id) ? 'border-b-indigo-400' : 'border-edge'
                    } ${
                      isCueActive ? 'bg-indigo-950/40' : isOpen ? 'bg-slate-800/40' : 'hover:bg-slate-800/30'
                    }`}
                  >
                    {fixEdge ? (
                      <span className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r ${fixEdge}`} />
                    ) : (
                      (isCueActive || isOpen) && <span className={`absolute left-0 top-0 bottom-0 w-0.5 ${isCueActive ? 'bg-indigo-400' : 'bg-slate-500'}`} />
                    )}

                    {/* Number and audition */}
                    <div className="flex items-start gap-2">
                      {multiSpeaker && (
                        <input
                          type="checkbox"
                          checked={selectedCues.has(String(seg.id))}
                          onChange={() => undefined}
                          onClick={(e) => {
                            const id = String(seg.id);
                            const turnOn = !selectedCues.has(id);
                            const from = e.shiftKey && lastTicked.current ? filteredSegments.findIndex((s) => String(s.id) === lastTicked.current) : -1;
                            const to = filteredSegments.findIndex((s) => String(s.id) === id);
                            const ids = from >= 0 && to >= 0 ? filteredSegments.slice(Math.min(from, to), Math.max(from, to) + 1).map((s) => String(s.id)) : [id];
                            setSelectedCues((prev) => {
                              const next = new Set(prev);
                              for (const one of ids) {
                                if (turnOn) next.add(one);
                                else next.delete(one);
                              }
                              return next;
                            });
                            lastTicked.current = id;
                          }}
                          aria-label={`Select cue ${cueNumber}. Shift-click selects a range.`}
                          title="Select. Shift-click to select a range."
                          className="w-3.5 h-3.5 mt-2 accent-indigo-500 cursor-default shrink-0"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setPlayingSegmentId(seg.id);
                          onPlaySegmentSolo(seg);
                          setTimeout(() => setPlayingSegmentId(null), seg.duration * 1000 + 500);
                        }}
                        className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 transition-colors cursor-default ${
                          isCuePlaying
                            ? 'bg-indigo-500 border-indigo-500 text-white'
                            : 'border-slate-700 text-slate-300 hover:border-indigo-400 hover:text-indigo-300'
                        }`}
                        title="Listen to the original line"
                        aria-label={`Listen to cue ${cueNumber}`}
                      >
                        {isCuePlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-px" />}
                      </button>
                      <span className="font-mono text-[12px] text-slate-400 pt-1.5 tabular-nums">
                        {String(cueNumber).padStart(2, '0')}
                        {grammarOpenIds.has(String(seg.id)) && (
                          <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 align-middle" title="Grammar fix waiting in the Grammar panel" />
                        )}
                      </span>
                    </div>

                    {/* Time: click to jump the player here */}
                    <button
                      type="button"
                      onClick={() => seekSource(seg.startTime)}
                      className="self-start text-left font-mono text-[12.5px] text-slate-300 hover:text-indigo-300 leading-snug tabular-nums cursor-default md:pt-1"
                      title="Jump the player to this cue"
                    >
                      {formatSeconds(seg.startTime)}
                      <span className="md:block text-[12px] text-slate-400 ml-1.5 md:ml-0">{seg.duration.toFixed(1)}s</span>
                    </button>

                    {/* Split, the cut and join, in the row's ⋯ (right column on desktop, top-right on phones) */}
                    <div className="md:order-last flex justify-end md:pt-0.5">
                      <CueRowMenu
                        label={`More for cue ${cueNumber}: split, the cut, join`}
                        className={isOpen || String(cueEditing.boundaryId) === String(seg.id) ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity'}
                        items={[
                          { label: 'Split before the picked word', keys: 'S', onClick: () => cueEditing.splitCueHere(seg.id) },
                          ...(isLastCue
                            ? []
                            : [
                                { label: 'Adjust the cut with the next cue', onClick: () => cueEditing.selectBoundary(seg.id) },
                                { label: 'Join with the next cue', keys: 'M', onClick: () => cueEditing.join(seg.id) },
                              ]),
                        ]}
                      />
                    </div>

                    {/* Original */}
                    <div className="col-span-3 md:col-span-1 text-slate-400 leading-relaxed" style={reviewSourceStyle}>
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
                          <span className="block text-[12px] font-medium text-slate-400 mb-0.5">
                            {seg.speaker}
                          </span>
                        )
                      )}
                      {srcText ? (
                        <PickableWords
                          segment={seg}
                          text={srcText}
                          caretK={cueEditing.caret && String(cueEditing.caret.id) === String(seg.id) ? cueEditing.caret.k : null}
                          onPick={(k, start) => {
                            cueEditing.pickWord(seg.id, k);
                            seekSource(start);
                          }}
                        />
                      ) : (
                        <span className="text-slate-600 italic">No original text</span>
                      )}
                      {showDetail && (
                        <span className="flex flex-wrap gap-x-2 mt-1">
                          <CharCount text={srcText} />
                          <SyllableCount text={srcText} />
                        </span>
                      )}
                      {multiSpeaker && (
                        <SpeakerCueNotes
                          current={speakerOf(seg)}
                          slip={speakerSlips.get(String(seg.id))}
                          voice={voiceFlags.get(String(seg.id))}
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
                    <div className="col-span-3 md:col-span-1 min-w-0" data-review-text>
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
                        rows={1}
                        autoGrow
                        placeholder={`${targetLanguage} line`}
                        compactToolbar
                        fontSize={reviewFontPx}
                      />
                      {showDetail && (
                        <span className="flex flex-wrap gap-x-2 mt-1">
                          <CharCount text={tgtText} />
                          <SyllableFitNote fit={syllableFitOf(seg)} />
                        </span>
                      )}
                      {(() => {
                        if (linePreview) {
                          // A sync line can span several cues: its fit and rewording sit once, under its last cue.
                          const unit = unitOfCue.get(String(seg.id));
                          if (!unit || String(unit.cueIds[unit.cueIds.length - 1]) !== String(seg.id)) return null;
                          const fix = lineFixes.controlsFor(unit);
                          // Closed, a line shows only what is wrong with it, in a few words; open (or Detailed), all of it.
                          const isOpenUnit = unit.cueIds.some((id) => String(id) === openCueId);
                          if (!isOpenUnit && !reviewDetailed && fix.state.kind === 'idle') {
                            return needsFix(unit) ? (
                              <p className={`mt-1.5 text-[13px] leading-snug ${unit.status === 'short' ? 'text-sky-300' : 'text-rose-300'}`}>{fitNote(unit)}</p>
                            ) : null;
                          }
                          const pauses = pauseAdvice(unit);
                          // Placed or cut on the dub lane: how, and the way back to Sync's own place.
                          const moved = unit.parts?.filter((part) => part.placed) ?? [];
                          // Cuts at the original's pauses are Sync's: only the user's own cuts and moves are noted.
                          const ownCuts = unit.parts?.filter((part) => part.index > 0 && !part.byPause).length ?? 0;
                          const skippedPauses = unit.pauseMarks?.filter((mark) => mark.state === 'skipped').length ?? 0;
                          const placedNote = unit.parts && (moved.length > 0 || ownCuts > 0 || skippedPauses > 0) && (
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-slate-400">
                              <span>
                                {ownCuts > 0 ? `Cut by you in ${ownCuts + 1} parts` : moved.length > 0 ? 'Placed by you' : `${skippedPauses} cut at a pause turned off`}
                                {moved.length > 0 &&
                                  `, ${moved
                                    .map((part) => `${unit.parts!.length > 1 ? `part ${part.index + 1} ` : ''}${part.start - part.auto > 0 ? '+' : '−'}${Math.abs(part.start - part.auto).toFixed(1)} s`)
                                    .join(', ')} from where Sync puts it`}
                                . Sync places it there.
                              </span>
                              <button type="button" onClick={() => setLinePlace(unit, () => null)} className={railButton} title="Join its parts and let Sync place the line again">
                                <RotateCcw className="w-3.5 h-3.5" /> Back to auto
                              </button>
                            </div>
                          );
                          if (!needsFix(unit) && fix.state.kind === 'idle') {
                            return (
                              <>
                                <FitMeter unit={unit} className="mt-1.5 sm:items-start" />
                                {pauses && <p className="mt-1 text-[12.5px] leading-snug text-slate-400">{pauses}</p>}
                                {placedNote}
                                <WordingButtons unit={unit} onSuggest={fix.onSuggest} className={isOpenUnit ? 'mt-1.5' : hoverWordings} />
                              </>
                            );
                          }
                          const fasterOn = readsFaster(unit);
                          const fasterSeconds = unit.estimate * PACE_SHARE;
                          const note = fix.state.kind === 'idle' ? { text: [fitAdvice(unit), pauses].filter(Boolean).join(' '), tone: '' } : lineNote(unit, fix.state, fix.direction);
                          const tone = note.tone || (unit.status === 'long' ? 'text-rose-300' : unit.status === 'short' ? 'text-sky-300' : 'text-slate-400');
                          const firstCue = cueIndexById.get(String(unit.cueIds[0]));
                          return (
                            <div className="mt-2 rounded-lg border border-edge bg-slate-950/40 px-2.5 py-2">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="text-[12px] font-medium text-slate-400">Sync fit</span>
                                <span className="font-mono text-[12px] text-slate-300 tabular-nums">{fitLabel(unit)}</span>
                                {unit.cueIds.length > 1 && firstCue !== undefined && (
                                  <span className="text-[12px] text-slate-400">
                                    One line with cues {firstCue + 1}–{cueNumber}
                                  </span>
                                )}
                              </div>
                              <FitMeter unit={unit} className="mt-1.5 sm:items-start" />
                              {note.text && <p className={`mt-1 text-[12.5px] leading-snug ${tone}`}>{note.text}</p>}
                              {unit.wantSeconds !== undefined && (
                                <button type="button" onClick={() => trimLine(unit, null)} className={`${railButton} mt-1.5`} title="Go back to the length worked out from the slot">
                                  <RotateCcw className="w-3.5 h-3.5" /> Reset trim
                                </button>
                              )}
                              {placedNote}
                              {canReadFaster && (unit.status === 'long' || fasterOn) && (
                                <label className="mt-1.5 flex items-start gap-2 text-[12.5px] leading-snug text-slate-300 cursor-default">
                                  <input type="checkbox" className="mt-0.5 accent-indigo-500" checked={fasterOn} onChange={(e) => setReadsFaster(unit, e.target.checked)} />
                                  <span>
                                    Read faster with a pace direction: about {fasterSeconds.toFixed(1)} s, {fasterSeconds - unit.slot > ALLOWED_OVERFLOW[syncOptions.precision] ? 'still long' : 'fits'}.{' '}
                                    <span className="text-slate-400">{elModelId?.startsWith('eleven_v4') ? 'Eleven v4' : 'Eleven v3'} ignores the speed setting, so Sync asks the voice to read faster instead.</span>
                                  </span>
                                </label>
                              )}
                              {unit.expert && (
                                <details className="mt-1.5">
                                  <summary className="text-[12.5px] text-slate-400 hover:text-slate-200 cursor-default select-none">Syllables, pauses and lips</summary>
                                  <ExpertLineDetail unit={unit} />
                                </details>
                              )}
                              <LineFixControls unit={unit} cps={linePreview.charsPerSecond} {...fix} />
                            </div>
                          );
                        }
                        // Until the line fit is worked out, each cue is judged on its own.
                        const { cps: lineCps, ...line } = reviewLineOf(seg, tgtText, srcText);
                        const fix = reviewFixes.controlsFor(line);
                        const flagged = line.status === 'long' || line.status === 'short';
                        if (!flagged && fix.state.kind === 'idle')
                          return isOpen || reviewDetailed ? <WordingButtons unit={line} onSuggest={fix.onSuggest} className={isOpen ? 'mt-1.5' : hoverWordings} /> : null;
                        const started = fix.state.kind !== 'idle' && fix.state.kind !== 'error';
                        return (
                          <>
                            {!started && line.status === 'long' && (
                              <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-rose-300 leading-snug">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                                <span>Too long for {seg.duration.toFixed(1)}s. Shorten it so the voice doesn't rush.</span>
                              </p>
                            )}
                            {!started && line.status === 'short' && (
                              <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] text-sky-300 leading-snug">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                                <span>
                                  Ends about {line.underflow.toFixed(1)}s before the original speaker stops. A fuller line fills the gap.
                                </span>
                              </p>
                            )}
                            {(showDetail || fix.state.kind !== 'idle') && <LineFixControls unit={line} cps={lineCps} {...fix} />}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  )}
                  </React.Fragment>
                );
              })}

              {renderPaginationControls('px-3')}
            </div>
          )}

                </div>
              </div>

              {/*
                The list's end: what it shows, Top and Bottom, and Continue. Continuing only
                moves on to the Dub step. Dubbing spends ElevenLabs credits, so it starts
                there once the voice is set. A dub can still be run with QA issues
                outstanding, but not without being told.
              */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-t border-edge text-[12.5px] text-slate-400">
                <span className="tabular-nums">
                  {reviewMode === 'qa'
                    ? `${segments.length} cues`
                    : `Showing ${filteredSegments.length} of ${segments.length} cues${
                        linePreview && filteredSegments.length < segments.length
                          ? ` (${new Set(filteredSegments.map((seg) => unitOfCue.get(String(seg.id))?.key ?? String(seg.id))).size} lines)`
                          : ''
                      }`}
                </span>
                <span className="hidden sm:flex items-center gap-3">
                  <button type="button" onClick={scrollToTop} className="flex items-center gap-1 hover:text-slate-200 cursor-default">
                    <ChevronsUp className="w-3.5 h-3.5" /> Top
                  </button>
                  <button type="button" onClick={scrollToBottom} className="flex items-center gap-1 hover:text-slate-200 cursor-default">
                    <ChevronsDown className="w-3.5 h-3.5" /> Bottom
                  </button>
                </span>
                <span className="ml-auto flex items-center gap-3">
                  <span className={`text-right leading-tight ${qaBlockingCount > 0 ? 'text-rose-300' : 'text-slate-400'}`}>
                    {qaBlockingCount > 0
                      ? `${qaBlockingCount} blocking ${qaBlockingCount === 1 ? 'issue' : 'issues'} open. You can still dub.`
                      : 'QA clear. Ready to dub.'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setStepOverride(3);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    disabled={activeJob.segments.length === 0 || openUpTo < 3}
                    title={openUpTo < 3 ? lockedWhy[3] : undefined}
                    className="h-9 px-4 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-default active:translate-y-px"
                  >
                    {isSyncing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> {syncWaitingFor ? 'Waiting to dub, view it' : 'Dubbing in progress, view it'}
                      </>
                    ) : (
                      <>
                        Continue to dub <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </span>
              </div>
            </section>

            {/* The Grammar panel, beside the list only while a check is open */}
            {grammar && (
              <aside aria-label="Grammar" className="relative flex flex-col min-h-[28rem] lg:min-h-0 bg-slate-900/90 border border-edge rounded-2xl overflow-clip">
                <GrammarPanel
                  running={grammar.running}
                  error={grammar.error}
                  checked={grammar.checked}
                  unread={grammar.unread}
                  fixes={grammar.fixes}
                  states={grammar.states}
                  currentText={(id) => {
                    const seg = segments.find((s) => String(s.id) === id);
                    return seg ? getTargetText(seg) : null;
                  }}
                  cueLabel={(id) => `#${String((cueIndexById.get(id) ?? 0) + 1).padStart(2, '0')}`}
                  fontSize={Math.max(13, reviewFontPx - 2)}
                  onAccept={acceptGrammarFixes}
                  onSkip={(ids) => markGrammar(ids, 'skipped')}
                  onUndo={undoGrammarFix}
                  onJump={(id) => {
                    const seg = segments.find((s) => String(s.id) === id);
                    if (seg) handleJumpToCue(seg);
                  }}
                  onStop={stopGrammarCheck}
                  onClose={closeGrammarCheck}
                />
              </aside>
            )}
          </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 3: DUB (voice the script, sync it to the original, then edit it) */}
      {/* ========================================================================= */}
      {activeStep === 3 && activeJob && (() => {
        // Before the first sync the player plays a dub made before Dub and Sync were one step, if there is one; after it, the synced dub.
        const hasDub = hasDubAudio;
        const report = hasSyncReport ? activeJob.syncReport || null : null;
        const sourceBuffer = activeJob.audioBuffer;
        const totalLength = duration || dubBuffer?.duration || sourceBuffer?.duration || 0;
        const sourceLength = duration || sourceBuffer?.duration || 0;
        const syncedLength = dubBuffer?.duration || sourceLength;
        const laneSpan = Math.max(sourceLength, syncedLength);
        const activeCue = segments.find((s) => s.id === activeSegmentId) || null;
        const activeCueIndex = activeCue ? segments.indexOf(activeCue) : -1;
        const openIssues = openFindings.length;
        const blockedReason = !onSyncDub ? 'Dubbing is not available.' : segments.length === 0 ? 'There are no cues to dub yet.' : null;
        // One Even out loudness, on the voice panel, for every dub.
        const runSync = () => {
          if (onSyncDub) void syncWithFit({ ...syncOptions, matchLoudness: dubMatchLoudness }, onSyncDub);
        };
        // Changed lines only: no fit on top, as the lines held stay as they were placed.
        const runSyncChangedOnly = onSyncChangedOnly ? () => onSyncChangedOnly({ ...syncOptions, matchLoudness: dubMatchLoudness }) : undefined;
        const runSyncFromScratch = onSyncFromScratch
          ? () => void syncWithFit({ ...syncOptions, matchLoudness: dubMatchLoudness }, onSyncFromScratch, { fresh: true })
          : undefined;
        // What Sync's own Fit to this video did on the last press, with Undo.
        const fitShown = autoFit && autoFit.jobId === activeJob.id && !autoFit.hidden ? autoFit : null;
        const autoFitPanel = fitShown && (
          <AutoFitPanel
            outcome={fitShown.outcome}
            canUndo={canUndoAutoFit(syncOptions, fitShown.outcome)}
            undone={fitShown.undone}
            onUndo={() => {
              setSyncOptions((o) => undoAutoFit(o, fitShown.outcome));
              setAutoFit({ ...fitShown, undone: true });
            }}
            onUseGrouping={
              fitShown.outcome.grouping
                ? () => {
                    const grouped = fitShown.outcome.grouping!.options;
                    setSyncOptions((o) => ({ ...o, preset: grouped.preset, join: grouped.join, fitted: grouped.fitted, fitUndone: undefined }));
                    setAutoFit({ ...fitShown, groupingUsed: true });
                  }
                : undefined
            }
            groupingUsed={fitShown.groupingUsed}
            onTurnOff={syncOptions.fitOnSync !== false ? () => setSyncOptions((o) => ({ ...o, fitOnSync: false })) : undefined}
            onDismiss={() => setAutoFit({ ...fitShown, hidden: true })}
          />
        );
        // The length preset this dub's lines suit, from the last sync; picking it syncs again with it.
        const lengthSuggestion = presetSuggestion(report?.units);
        const syncWithPreset = (preset: Exclude<SyncJoinPreset, 'custom'>) => {
          // A preset picked by hand is the user's choice: Sync runs with it as it is, no fit on top.
          const next = pickLengthByHand(syncOptions, preset);
          setAutoFit(null);
          setSyncOptions(next);
          onSyncDub?.({ ...next, matchLoudness: dubMatchLoudness });
        };
        const canEditTiming = Boolean(onSyncEditsChange);
        // Clips of the original put on the dub are hand edits too, but not lines.
        const editedLineCount = Object.keys(activeJob.syncEdits || {}).filter((key) => !isClip(key)).length;
        const hasEditedTiming = editedLineCount > 0;
        const legacyDub = !report && Boolean(activeJob.synthesizedAudioUrl);

        /** Whether a retake reads the tags typed in its words: Eleven v3 and v4, for a dub in one voice. */
        const takesVoiceTags =
          voiceEngine !== 'elevenlabs'
            ? { on: false, note: 'This voice is not an ElevenLabs voice, which reads no typed tags.' }
            : multiSpeaker
              ? { on: false, note: 'Tags are for a dub in one voice.' }
              : !elModelId || !performsAudioTags(elModelId)
                ? { on: false, note: `This voice is on ${ttsModelName}, which reads no tags. Tags work on Eleven v3 and v4.` }
                : { on: true, note: '' };

        /** A synced line's takes, voiced and picked from at once (TakesPanel). */
        const takesBank = activeJob.syncBank;
        const takesBase = activeJob.syncBaseReport;
        const renderTakes =
          onVoiceSyncTakes && onUseSyncTake && takesBank && takesBase
            ? (
                unit: SyncUnitReport,
                close: () => void,
                initialPhrase?: { from: number; to: number } | null,
                inWindow?: { onDirtyChange: (dirty: boolean) => void; pro?: boolean; copy?: string | null }
              ) => {
                const line = takesBank.lines.find((l) => l.key === unit.key);
                const n = takesBase.units.findIndex((u) => u.key === unit.key);
                if (!line || n === -1) {
                  return <p className="text-[12px] text-slate-400">This line has no take in the dub. Sync again to voice it.</p>;
                }
                // An Alt + drag copy retaken on its own: the take it plays is the one in the dub here, and a take used goes on it alone.
                const copyPart = inWindow?.copy ? activeJob.syncEdits?.[unit.key]?.parts.find((part) => part.copy && part.id === inWindow.copy) ?? null : null;
                const listed = takesOf(activeJob.syncTakes, line, takesBase.units[n]);
                const lineTakes = copyPart?.audio ? { ...listed, active: listed.takes.find((t) => t.bankStart === copyPart.audio!.bankStart)?.id ?? '' } : listed;
                const playedLine = copyPart ? partLine(line, copyPart) : line;
                return (
                  <TakesPanel
                    key={`${activeJob.id}:${unit.key}:${copyPart?.id ?? ''}`}
                    unit={unit}
                    initialPhrase={initialPhrase}
                    locked={Boolean(activeJob.syncEdits?.[unit.key]?.locked ?? line.locked)}
                    lineNumber={segments.findIndex((seg) => String(seg.id) === unit.key) + 1}
                    lineTakes={lineTakes}
                    firstWord={
                      copyPart
                        ? spokenSpan(line, [copyPart])?.start ?? copyPart.start
                        : firstWordAt(line, activeJob.syncEdits, takesBank.sampleRate)
                    }
                    nextStart={takesBase.units[n + 1]?.srcStart ?? null}
                    tolerance={takesBase.tolerance}
                    bankBlob={activeJob.syncBankBlob}
                    sampleRate={takesBank.sampleRate}
                    float={takesBank.float}
                    busy={syncTakesBusy === unit.key}
                    anyBusy={Boolean(syncTakesBusy)}
                    pending={syncPendingLines.includes(unit.key)}
                    scriptText={
                      syncPendingLines.includes(unit.key) && syncPendingWords.includes(unit.key) ? lineTextNow(segments, unit.cueIds) || null : null
                    }
                    onVoice={(options) => onVoiceSyncTakes(unit, options)}
                    onSuggestWording={suggestTakeWording(unit)}
                    onUse={(takeId) => {
                      onUseSyncTake(unit.key, takeId, copyPart?.id);
                      // In the retake window, using a take is the end of it: the take is in the timeline.
                      if (inWindow) close();
                    }}
                    onClearTakes={onClearSyncTakes && (() => onClearSyncTakes(unit.key))}
                    onListenInDub={() => listenHere(Math.max(0, unit.srcStart - 0.6))}
                    onClose={close}
                    inWindow={Boolean(inWindow)}
                    onDirtyChange={inWindow?.onDirtyChange}
                    canPlaceLikeSync={Boolean(takesBase.join?.chunkSync)}
                    voiceTags={takesVoiceTags}
                    pro={Boolean(inWindow?.pro)}
                    language={targetLanguage}
                    changedVoice={changedVoiceOf?.(line.speaker) ?? null}
                    onChangeVoice={onChangeSyncTakeVoice && ((takeId) => onChangeSyncTakeVoice(unit.key, takeId))}
                    onForgetChangedVoice={onForgetChangedVoice && (() => onForgetChangedVoice(line.speaker))}
                    onAlignWords={
                      activeJob.syncBankBlob && !syncPendingLines.includes(unit.key)
                        ? () => alignTakeWords(takesBank, activeJob.syncBankBlob!, playedLine, unit.text, { apiKey: elApiKey || undefined })
                        : undefined
                    }
                  />
                );
              }
            : undefined;
        const timingTakesUnit = timingTakesKey ? report?.units.find((unit) => unit.key === timingTakesKey) ?? null : null;

        /** Before the first sync: how the lines are likely to sit, what is left to look at, and what the dub takes. */
        const fitSummary = linePreview?.summary;
        const readyRows: { key: string; dot: string; title: string; note: string | null; action: { label: string; go: () => void } | null }[] = [];
        if (fitSummary)
          readyRows.push({
            key: 'long',
            dot: fitSummary.long > 0 ? 'bg-rose-400' : 'bg-emerald-400',
            title: fitSummary.long > 0 ? `${fitSummary.long} ${fitSummary.long === 1 ? 'line runs' : 'lines run'} long` : 'Every line should fit',
            note: fitSummary.long > 0 ? `Longest +${fitSummary.maxOverflow.toFixed(1)} s. They show in Worth a listen.` : 'Once Sync places it.',
            action:
              linesToFixCount > 0
                ? {
                    label: 'Fix',
                    go: () => {
                      setStepOverride(2);
                      setReviewMode('table');
                      setPacingFilter('fix');
                    },
                  }
                : null,
          });
        readyRows.push({
          key: 'qa',
          dot: openIssues > 0 ? 'bg-amber-400' : 'bg-emerald-400',
          title: openIssues > 0 ? `${openIssues} QA ${openIssues === 1 ? 'issue' : 'issues'} open` : 'No QA issues open',
          note: openIssues > 0 ? "They don't stop the dub." : null,
          action:
            openIssues > 0
              ? {
                  label: 'Open',
                  go: () => {
                    setStepOverride(2);
                    setReviewMode('qa');
                  },
                }
              : null,
        });
        if (fitSummary?.lips && fitSummary.lips.total > 0)
          readyRows.push({
            key: 'lips',
            dot: fitSummary.lips.matched < fitSummary.lips.total ? 'bg-amber-400' : 'bg-emerald-400',
            title: `${fitSummary.lips.matched} / ${fitSummary.lips.total} lip closures matched`,
            note: "Near where the original speaker's lips close.",
            action: null,
          });
        const fitParts = fitSummary
          ? [
              { n: fitSummary.fits - fitSummary.short, label: 'fit', c: 'bg-emerald-400' },
              { n: fitSummary.short, label: 'end early', c: 'bg-sky-400' },
              { n: fitSummary.tight, label: 'tight', c: 'bg-amber-400' },
              { n: fitSummary.long, label: 'too long', c: 'bg-rose-400' },
            ].filter((part) => part.n > 0)
          : [];
        const readySummary = (
          <>
            {fitSummary ? (
              <div
                className="w-56 shrink-0"
                title={[
                  fitParts.map((part) => `${part.n} ${part.label}`).join(', '),
                  `Estimated in Review: ${estimateBasis(linePreview!, rateBasis, expertBasis, mainPace?.lines)}.`,
                  `${dubCharacterCount.toLocaleString()} characters · ${segments.length.toLocaleString()} cues · ${formatClock(sourceLength || totalLength)}`,
                ].join('\n')}
              >
                <p className="flex items-baseline gap-1.5 text-[12.5px]">
                  <span className="font-semibold text-slate-100">Likely to fit</span>
                  {syncPreview.loading && <Loader2 className="w-3 h-3 text-slate-500 animate-spin self-center" aria-label="Updating" />}
                  <span className="ml-auto font-mono tabular-nums text-slate-300">
                    {fitSummary.fits + fitSummary.tight} / {fitSummary.lines}
                  </span>
                </p>
                <div className="flex h-1.5 mt-1.5 gap-[2px] rounded overflow-hidden bg-slate-800" aria-hidden>
                  {fitParts.map((part) => (
                    <i key={part.c} className={`block h-full ${part.c}`} style={{ flex: part.n }} />
                  ))}
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-xs text-slate-400" role="status">
                {syncPreview.error ? (
                  <span className="text-amber-300">The sync fit could not be worked out.</span>
                ) : (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Timing each line against its source sentence…
                  </>
                )}
              </p>
            )}
            <span aria-hidden className="hidden md:block w-px h-8 bg-edge" />
            {readyRows.map((row) => (
              <span key={row.key} title={row.note ?? undefined} className="flex items-center gap-2 text-[12.5px]">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${row.dot}`} />
                <span className="font-semibold text-slate-100 whitespace-nowrap">{row.title}</span>
                {row.action && (
                  <button
                    type="button"
                    onClick={row.action.go}
                    className="h-6 px-2 rounded-md border border-slate-700 text-[11.5px] font-semibold text-slate-200 hover:bg-slate-800 cursor-default"
                  >
                    {row.action.label}
                  </button>
                )}
              </span>
            ))}
          </>
        );

        // Before a sync, the preset the estimate suits: the lines as read against the original's.
        const prepSuggestion = linePreview
          ? presetSuggestion(linePreview.units.map((u) => ({ speech: u.read, srcStart: u.srcStart, srcEnd: u.srcEnd })))
          : null;
        const cartesiaVoice = voiceEngine === 'cartesia';
        const takesCues =
          (cartesiaVoice ? cartesiaTakesControls(cartesiaModelId) : Boolean(elModelId && performsAudioTags(elModelId))) && !multiSpeaker;
        const dubSettingsCard = (
          <DubSettingsCard
            disabled={isSyncing}
            multiSpeaker={multiSpeaker}
            cast={
              multiSpeaker && onCastChange ? (
                <CastCard
                  speakers={speakers}
                  cast={activeJob.cast}
                  mainVoiceId={elVoiceId}
                  availableVoices={availableVoices}
                  disabled={isSyncing}
                  onPick={(speaker) => {
                    setCastPickFor(speaker);
                    setIsVoicePickerOpen(true);
                  }}
                  onUseMain={(speaker) => onCastChange(speaker, null)}
                  rates={speakerVoiceRates}
                  mainRate={voiceRate}
                />
              ) : undefined
            }
            voiceId={elVoiceId}
            availableVoices={availableVoices}
            voiceRateNote={!multiSpeaker && rateBasis === 'sample' && sampleRate ? `Reads ${sampleRate.syllablesPerSecond.toFixed(1)} syllables/s` : null}
            onChangeVoice={() => {
              setCastPickFor(null);
              setIsVoicePickerOpen(true);
            }}
            favourites={favoriteVoices}
            onPickVoice={onElVoiceIdChange}
            modelId={voiceEngine === 'elevenlabs' ? elModelId : undefined}
            models={elModels}
            onModelChange={onElModelIdChange}
            modelName={ttsModelName}
            expression={
              onVoiceExpressionChange && {
                value: voiceExpression,
                onChange: onVoiceExpressionChange,
                takesCues,
                cartesia: cartesiaVoice,
                notTagged: multiSpeaker
                  ? 'Natural and Expressive are for a dub in one voice.'
                  : cartesiaVoice
                    ? 'Natural and Expressive need a Sonic 3 model.'
                    : 'Natural and Expressive need Eleven v3 or v4.',
              }
            }
            voiceSettings={
              showVoiceSliders && onElVoiceSettingsChange
                ? {
                    shown: shownVoiceSettings,
                    custom: Boolean(elVoiceSettings),
                    isDefault: isElevenLabsDefault(shownVoiceSettings),
                    stabilityEnds: elModelId && performsAudioTags(elModelId) ? ['Creative', 'Robust'] : ['More variable', 'More stable'],
                    onChange: onElVoiceSettingsChange,
                    onDefaults: () => onElVoiceSettingsChange({ ...DEFAULT_VOICE_SETTINGS }),
                  }
                : undefined
            }
            loudness={onDubMatchLoudnessChange && { value: dubMatchLoudness, onChange: onDubMatchLoudnessChange }}
            quality={onDubAudioQualityChange && { value: dubAudioQuality, onChange: onDubAudioQualityChange, notice: dubQualityNotice }}
            mixPeak={multiSpeaker && onMixPeakChange ? <MixPeakChoice value={mixPeak} onChange={onMixPeakChange} disabled={isSyncing} /> : undefined}
            options={syncOptions}
            onOptionsChange={setSyncOptions}
            suggestion={prepSuggestion}
            suggestionEstimated
            paceDirection={voiceEngine === 'elevenlabs' && Boolean(elModelId && performsAudioTags(elModelId))}
            onOpenAllSettings={() => setCardSettingsRequest((n) => n + 1)}
          />
        );

        /** Files and tools under the settings: the script, a dub from before, and the other studios. */
        const dubExtras = (
          <>
            <SaveScriptMenu
              title={`${targetLanguage} script`}
              onSave={handleExportTargetScript}
              disabled={segments.length === 0}
              scope={syncedCues ? scriptScope : undefined}
              onScopeChange={setScriptScope}
              removedCount={removedCueIds.size}
            />
            {legacyDub && onDownloadWav && (
              <button
                type="button"
                onClick={onDownloadWav}
                className={`${railButton} w-full`}
                title="The script read in one take, before its lines are placed on the original"
              >
                <Download className="w-3.5 h-3.5" /> Continuous read, not synced (WAV)
              </button>
            )}
            {legacyDub && multiSpeaker && activeJob.dubStems && activeJob.dubStems.length > 0 && onDownloadStem && (
              <StemDownloads stems={activeJob.dubStems} speakers={speakers} onDownload={onDownloadStem} />
            )}
            {!report && onOpenVoiceChanger && (
              <button type="button" onClick={onOpenVoiceChanger} className={`${railButton} w-full`}>
                <AudioWaveform className="w-3.5 h-3.5" /> Voice changer
              </button>
            )}
            {onOpenTextToSpeech && (
              <button type="button" onClick={onOpenTextToSpeech} className={`${railButton} w-full`}>
                <Speech className="w-3.5 h-3.5" /> Text to speech
              </button>
            )}
            {onResetSession && (
              <button type="button" onClick={onResetSession} className={`${railButton} w-full`}>
                <Plus className="w-3.5 h-3.5" /> Start a new dub
              </button>
            )}
          </>
        );

        /** Ready to dub and the button: a row under the Dub settings before the first sync, the rail after. */
        const syncPanel = (
          <SyncSettingsPanel
            variant={report ? 'rail' : 'bar'}
            summary={readySummary}
            options={syncOptions}
            onOptionsChange={setSyncOptions}
            multiSpeaker={multiSpeaker}
            synced={Boolean(report)}
            hasDub={hasDub}
            isSyncing={isSyncing}
            waitingFor={syncWaitingFor}
            isCancelling={isCancellingSync}
            interrupted={Boolean(activeJob?.syncInterrupted)}
            blockedReason={blockedReason}
            pendingCount={syncPendingLines.length}
            previewShown={!report && Boolean(linePreview)}
            previewLongCount={linePreview?.summary.long ?? 0}
            previewShortCount={linePreview?.summary.short ?? 0}
            lineCount={report ? report.units.length : syncPreview.preview?.summary.lines}
            presetSuggestion={lengthSuggestion}
            onSync={runSync}
            onSyncFromScratch={runSyncFromScratch}
            onSyncChangedOnly={runSyncChangedOnly}
            onCancel={() => onCancelSync?.()}
            onBack={() => {
              setStepOverride(2);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            costNote={`Uses about ${dubCharacterCount.toLocaleString()} ElevenLabs characters.`}
            extras={dubExtras}
            onDownloadWav={report ? onDownloadWav : undefined}
            onDownloadMp3={report ? onDownloadMp3 : undefined}
            onDownloadWithTracks={report && activeJob.syncAudioTracks?.length ? onDownloadWithTracks : undefined}
            onOpenVoiceChanger={report ? onOpenVoiceChanger : undefined}
            openRequest={syncSettingsRequest + cardSettingsRequest}
            fitSource={fitSource}
            subtitles={
              report && syncedCues && syncedCues.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsSrtModalOpen(true)}
                  disabled={isSyncing}
                  className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-slate-700 bg-slate-900/60 hover:bg-slate-800/60 hover:border-slate-600 text-left transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-default"
                >
                  <span className="w-11 h-11 rounded-[10px] flex items-center justify-center shrink-0 bg-indigo-500/15 text-indigo-300">
                    <Sliders className="w-5 h-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14.5px] font-semibold text-slate-100">Export subtitles</span>
                    <span className="block text-[12px] text-slate-400 truncate">
                      {subtitleLanguage} · timed to {subtitleTimingLabel}
                    </span>
                    <span className="block text-[11.5px] text-slate-500 truncate">
                      {srtOptions.maxLinesPerCue} line, {srtOptions.maxWordsPerLine} words max · .srt or .vtt
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                </button>
              )
            }
          />
        );

        // The review video floats over the page, so it stays in view wherever the page is scrolled.
        const reviewClock = { currentTime: sourceClockTime, isPlaying, getLiveTime: getSourceLiveTime, playbackRate };
        const prevCue = () => activeCueIndex > 0 && seekSource(segments[activeCueIndex - 1].startTime);
        const nextCue = () => {
          const next = segments.find((s) => s.startTime > sourceClockTime + 0.05);
          if (next) seekSource(next.startTime);
        };
        /** Edit timing is open in the player, in place of the synced lanes. */
        const timingOpen = Boolean(report && editingTiming && activeJob.syncBank && activeJob.syncBaseReport && onSyncEditsChange);
        /** Once synced, the player is the zoomable sync timeline, with the mixer on its lanes and its own transport. */
        const syncedPlayer = Boolean(report) && !timingOpen;
        /** Speed and the review video, on whichever transport the player shows. */
        const playerExtras = (
          <>
            <select
              value={playbackRate}
              onChange={(e) => onPlaybackRateChange(Number(e.target.value))}
              className="h-8 bg-slate-950 border border-edge rounded-lg px-2 font-mono text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-default"
              aria-label="Playback speed"
            >
              {[0.75, 1, 1.25, 1.5].map((r) => (
                <option key={r} value={r} className="bg-slate-900">
                  {r}×
                </option>
              ))}
            </select>
            {!reviewVideo.video && (
              <button
                type="button"
                onClick={() => {
                  // In a browser the video's window opens now and picks the file itself.
                  if (!hasDub || !reserveReviewWindow((doc) => reviewVideo.pick(doc))) reviewVideo.pick();
                }}
                title="Watch a local video while the dub plays. It stays silent and is kept with the project until you remove it."
                className="h-8 px-2.5 rounded-lg border border-edge text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 cursor-default"
              >
                <Video className="w-3.5 h-3.5" /> Add video
              </button>
            )}
            {reviewVideo.video && reviewVideoHidden && (
              <button
                type="button"
                onClick={() => {
                  if (hasDub) reserveReviewWindow();
                  setReviewVideoHidden(false);
                }}
                className="h-8 px-2.5 rounded-lg border border-edge text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5 cursor-default"
              >
                <Video className="w-3.5 h-3.5" /> Show video
              </button>
            )}
          </>
        );

        // While Dub & sync runs, and right after it finishes: what it is doing, with no settings.
        if (syncPage.show) {
          return (
            <SyncProgressPage
              run={syncRun}
              progress={syncProgress}
              reading={readProgress}
              waitingFor={syncWaitingFor}
              isCancelling={isCancellingSync}
              onCancel={() => onCancelSync?.()}
              done={syncPage.done}
              onOpen={syncPage.open}
              characters={dubCharacterCount}
              about={[
                voiceShortName,
                ttsModelName,
                multiSpeaker ? `${speakers.length} speakers` : syncOptions.voicing === 'continuous' ? 'one continuous read' : 'line by line',
              ]
                .filter(Boolean)
                .join(' · ')}
              suggesting={syncOptions.suggest || syncOptions.suggestLonger}
              fitNote={autoFitPanel}
            />
          );
        }

        return (
        <div className="flex-1 flex flex-col gap-4 animate-in fade-in duration-200">
          {report && !isSyncing && (
            <SyncStatusBar
              report={report}
              handEdits={editedLineCount}
              presetNow={joinPresetLabel(syncOptions)}
              presetSuggestion={lengthSuggestion}
              onUsePreset={syncWithPreset}
            />
          )}
          {report && !isSyncing && autoFitPanel}
          {/* Transport: the lines worth a listen play through it; once synced, the original over the synced dub */}
          {hasDub && (
            <section aria-label="Player" className="bg-slate-900/90 border border-edge rounded-2xl px-4 py-3 flex flex-col gap-3">
              {report && canEditTiming && !(editingTiming && activeJob.syncBank && activeJob.syncBaseReport) && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Player</span>
                  <span className="hidden md:flex items-center gap-1.5 text-[11px] text-slate-500">
                    <Headphones className="w-3.5 h-3.5" /> Levels are for listening; the dub file is unchanged
                  </span>
                  {!activeJob.syncBank && activeJob.syncBeforeVoiceChange && onUndoVoiceChange && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Undo the voice change? The dub goes back to the voice it had before, with its timing edits, and the new voice is thrown away.')) onUndoVoiceChange();
                      }}
                      title="Put back the dub from before the voice change, so its timing can be edited again"
                      className="ml-auto h-8 px-3 rounded-lg border border-slate-700 text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 cursor-default flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Undo voice change
                    </button>
                  )}
                  {projectHistory && (
                    <div
                      className={`${!activeJob.syncBank && activeJob.syncBeforeVoiceChange && onUndoVoiceChange ? '' : 'ml-auto '}flex items-center gap-1`}
                      role="group"
                      aria-label="Undo and history"
                    >
                      <button
                        type="button"
                        onClick={() => projectHistory.goTo(projectHistory.at - 1)}
                        disabled={!projectHistory.labels.undo}
                        title={projectHistory.labels.undo ? `Undo: ${projectHistory.labels.undo} (Ctrl + Z)` : 'Nothing to undo'}
                        aria-label="Undo"
                        className="h-8 w-8 rounded-lg border border-edge flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 cursor-default"
                      >
                        <Undo2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => projectHistory.goTo(projectHistory.at + 1)}
                        disabled={!projectHistory.labels.redo}
                        title={projectHistory.labels.redo ? `Redo: ${projectHistory.labels.redo} (Ctrl + Shift + Z)` : 'Nothing to redo'}
                        aria-label="Redo"
                        className="h-8 w-8 rounded-lg border border-edge flex items-center justify-center text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 cursor-default"
                      >
                        <Redo2 className="w-4 h-4" />
                      </button>
                      {projectHistory.entries.length > 1 && <HistoryMenu history={projectHistory} />}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingTiming(true)}
                    disabled={!activeJob.syncBank}
                    title={
                      activeJob.syncBank
                        ? 'Move, trim, split and stretch the synced lines by hand'
                        : activeJob.syncBeforeVoiceChange
                          ? 'The voice change replaced the whole file: undo it, or Sync again, to edit the timing'
                          : 'Sync again to edit the timing of this dub'
                    }
                    className={`${projectHistory || (!activeJob.syncBank && activeJob.syncBeforeVoiceChange && onUndoVoiceChange) ? '' : 'ml-auto '}h-8 px-3 rounded-lg border border-slate-700 text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-transparent cursor-default flex items-center gap-1.5`}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit timing
                  </button>
                </div>
              )}
              {report && editingTiming && activeJob.syncBank && activeJob.syncBaseReport && onSyncEditsChange && (
                <SyncEditTimeline
                  bank={activeJob.syncBank}
                  bankBlob={activeJob.syncBankBlob}
                  baseReport={activeJob.syncBaseReport}
                  edits={activeJob.syncEdits}
                  onChange={onSyncEditsChange}
                  audio={syncAudio}
                  projectHistory={projectHistory}
                  status={syncEditStatus}
                  live={syncEditLive}
                  onBankAudio={onEditTimingAudio}
                  onDraft={onSyncEditDraft}
                  onRetry={() => onRetrySyncEditRender?.()}
                  sourceBuffer={activeJob.audioBuffer}
                  total={sourceLength || syncedLength}
                  targetLanguage={targetLanguage}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  getLiveTime={getLiveTime}
                  onSeek={onSeek}
                  onPlayFrom={(t) => {
                    onSeek(t);
                    if (!isPlaying) onTogglePlay();
                  }}
                  onClose={() => setEditingTiming(false)}
                  renderTrackHead={mixerLevels ? renderTrackHead : undefined}
                  speakerLanes={
                    activeJob.syncBaseReport.mix && onSpeakerLevelChange && onSpeakerMonitorChange
                      ? {
                          colors: Object.fromEntries(speakers.map((s) => [s.name, s.color])),
                          captions: Object.fromEntries(speakers.map((s) => [s.name, speakerCaption(s.name)])),
                          levels: activeJob.syncSpeakerLevels || {},
                          monitor: speakerMonitor || {},
                          onLevel: onSpeakerLevelChange,
                          onMonitor: onSpeakerMonitorChange,
                        }
                      : undefined
                  }
                  elApiKey={elApiKey}
                  takesUnavailableKeys={syncPendingLines}
                  markers={activeJob.syncMarkers || []}
                  onMarkersChange={onUpdateJobFields && ((markers) => onUpdateJobFields({ syncMarkers: markers.length > 0 ? markers : null }))}
                  onOpenTakes={
                    renderTakes
                      ? (key, phrase, follow, copy) => {
                          // Following the picked line moves an open window only; it never opens one.
                          if (follow && timingTakesKey === null) return;
                          // Nor does it leave edited words that are not voiced yet.
                          if (follow && ((key === timingTakesKey && (copy ?? null) === timingTakesCopy) || timingTakesDirty)) return;
                          setTimingTakesKey(key);
                          setTimingTakesCopy(copy ?? null);
                          setTimingTakesPhrase(phrase ?? null);
                        }
                      : undefined
                  }
                />
              )}
              {report && editingTiming && renderTakes && timingTakesUnit && (
                <FloatingWindow
                  title={
                    <>
                      <Mic className="w-3.5 h-3.5 text-indigo-300" aria-hidden="true" />
                      Retake · line {String(segments.findIndex((seg) => String(seg.id) === timingTakesUnit.key) + 1).padStart(2, '0')}
                      {timingTakesCopy && <span className="text-slate-400 font-normal">· the copy only</span>}
                    </>
                  }
                  // Always the full window: tags, styles, stability and more takes beside the words.
                  width={920}
                  storageKey="dhvani.retakeWindow.position"
                  confirmClose={timingTakesDirty ? 'Your edited words have not been voiced yet. Close and lose them?' : null}
                  onClose={() => {
                    setTimingTakesKey(null);
                    setTimingTakesDirty(false);
                  }}
                >
                  {renderTakes(timingTakesUnit, () => { setTimingTakesKey(null); setTimingTakesDirty(false); }, timingTakesPhrase, { onDirtyChange: setTimingTakesDirty, pro: true, copy: timingTakesCopy })}
                </FloatingWindow>
              )}
              {report && syncedPlayer && (
                <SyncAlignmentView
                  report={report}
                  reportedTime={sourceClockTime}
                  getLiveTime={getSourceLiveTime}
                  onSeek={seekSource}
                  isPlaying={isPlaying}
                  onTogglePlay={onTogglePlay}
                  sourceBuffer={activeJob.audioBuffer}
                  dubBuffer={activeJob.syncedAudioBuffer || dubBuffer}
                  trackHead={
                    mixerLevels && hasDubAudio
                      ? (track) => (track === 'source' ? renderTrackHead('source', 'Original', 'bg-cyan-400') : renderTrackHead('synth', 'Synced', 'bg-indigo-400'))
                      : undefined
                  }
                  silent={{
                    source: trackMode === 'synth' || Boolean(mixerLevels?.source.muted),
                    synth: trackMode === 'source' || Boolean(mixerLevels?.synth.muted),
                  }}
                  onPrevLine={prevCue}
                  onNextLine={nextCue}
                  transportExtras={playerExtras}
                  onWorkOnLine={(unit, mode) => setFocusLine((now) => ({ key: unit.key, mode, n: (now?.n ?? 0) + 1 }))}
                  canOpenTakes={Boolean(renderTakes)}
                  sourceLanguage={subtitleSourceLanguage}
                  dubLanguage={targetLanguage}
                  onSeekTrack={(track, t) => {
                    // A lane not being heard starts being heard there; a lane being heard just moves.
                    const leftOut = track === 'source' ? trackMode === 'synth' : trackMode === 'source';
                    if (leftOut) switchTrack(track, { seek: t });
                    else seekSource(t);
                  }}
                />
              )}
              {!syncedPlayer && (
              <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={prevCue}
                className="w-8 h-8 rounded-full border border-edge text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-default"
                aria-label="Previous cue"
              >
                <ChevronsLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onTogglePlay}
                className="w-10 h-10 rounded-full bg-slate-100 hover:bg-white text-slate-950 flex items-center justify-center cursor-default"
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={nextCue}
                className="w-8 h-8 rounded-full border border-edge text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-default"
                aria-label="Next cue"
              >
                <ChevronsRight className="w-4 h-4" />
              </button>
              <span className="font-mono text-sm text-slate-100 tabular-nums">
                <LiveClock currentTime={currentTime} isPlaying={isPlaying} getLiveTime={getLiveTime} />{' '}
                <span className="text-slate-500">/ {formatClock((trackMode === 'both' && laneSpan) || heardDuration || totalLength)}</span>
              </span>
              <span aria-live="polite" className="flex-1 min-w-[12rem] flex">
                {activeCue ? (
                  <LinePair source={getSourceText(activeCue)} dub={getTargetText(activeCue)} sourceLanguage={subtitleSourceLanguage} dubLanguage={targetLanguage} />
                ) : (
                  <span className="text-xs text-slate-500">Press play, or Listen on a line below.</span>
                )}
              </span>
              {!report && (
                // Before the first sync there are no lanes, so no track strips: pick the track here.
                <div role="group" aria-label="Listen to" className="flex bg-slate-950 border border-edge rounded-xl p-0.5 gap-0.5">
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
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-default ${
                        trackMode === m.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {m.dot && <span className={`w-2 h-2 rounded-sm ${m.dot}`} />}
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
              {playerExtras}
              </div>
              )}
            </section>
          )}
          {hasDub && reviewVideo.video && !reviewVideoHidden && (
            <ReviewVideoFloat
              video={reviewVideo.video}
              {...reviewClock}
              onTogglePlay={onTogglePlay}
              onPrevLine={() => activeCueIndex > 0 && seekSource(segments[activeCueIndex - 1].startTime)}
              onNextLine={() => {
                const next = segments.find((s) => s.startTime > sourceClockTime + 0.05);
                if (next) seekSource(next.startTime);
              }}
              trackMode={trackMode}
              onTrackMode={(mode) => switchTrack(mode)}
              onReplace={reviewVideo.pick}
              onRemove={reviewVideo.clear}
              onHide={() => setReviewVideoHidden(true)}
            />
          )}

          {multiSpeaker && report && (
            <section aria-label="Speakers" className="bg-slate-900/90 border border-edge rounded-2xl px-4 py-3 flex flex-col gap-3">
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
                <button type="button" onClick={openVoicePanel} className="ml-auto text-xs text-slate-400 hover:text-slate-200 cursor-default">
                  Change voices
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

          {/* Before the first sync: the Dub settings with Ready to dub under it, one window high. Once synced: the lines, and the rail. */}
          <div
            className={`grid grid-cols-1 gap-4 ${
              report
                ? 'lg:grid-cols-[minmax(0,1fr)_21rem] 2xl:grid-cols-[minmax(0,1fr)_25rem] items-start lg:items-stretch'
                : `items-stretch ${hasDub ? '' : 'xl:h-[calc(100vh-7rem)] xl:min-h-[600px]'}`
            }`}
          >
            <div className="flex flex-col gap-4 min-w-0 min-h-0">
              {report && (
                <SyncResultsPanel
                  report={report}
                  handEdits={editedLineCount}
                  progress={syncProgress}
                  reading={readProgress}
                  isSyncing={isSyncing}
                  waitingFor={syncWaitingFor}
                  isCancelling={isCancellingSync}
                  lineCount={segments.length}
                  duration={totalLength}
                  blockedReason={blockedReason}
                  onSync={runSync}
                  presetNow={joinPresetLabel(syncOptions)}
                  presetSuggestion={lengthSuggestion}
                  onUsePreset={syncWithPreset}
                    currentTime={sourceClockTime}
                  isPlaying={isPlaying}
                  onTogglePlay={onTogglePlay}
                  getLiveTime={getSourceLiveTime}
                  onSeek={seekSource}
                  onListen={listenHere}
                  sourceBuffer={activeJob.audioBuffer}
                  dubBuffer={report ? activeJob.syncedAudioBuffer : null}
                  pendingLines={syncPendingLines}
                  onSyncChangedOnly={runSyncChangedOnly}
                  onApplyLine={
                    onApplySyncLine &&
                    ((unit, text) => {
                      rememberChoice(activeJob?.id, { from: unit.text, to: text });
                      onApplySyncLine(unit, text);
                    })
                  }
                  applyVoicesNow={Boolean(renderTakes)}
                  takesBusyKey={syncTakesBusy}
                  onRetakeLine={onRetakeSyncLines && ((unit, takes) => onRetakeSyncLines([unit], takes))}
                  onRetakeLines={onRetakeSyncLines}
                  onUseTake={onUseOfferedTake}
                  onKeepTake={onKeepOfferedTake}
                  renderTakes={renderTakes}
                  lockedKeys={Object.keys(activeJob.syncEdits || {}).filter((key) => !isClip(key) && activeJob.syncEdits?.[key]?.locked)}
                  editedKeys={Object.keys(activeJob.syncEdits || {}).filter((key) => !isClip(key))}
                  focusLine={focusLine}
                  onSuggestLine={(unit, avoid) =>
                    unit.targetChars == null
                      ? Promise.resolve([])
                      : (unit.short && !unit.exceeded ? suggestLongerLine : suggestShorterLine)({
                          text: unit.text,
                          sourceText: unit.sourceText,
                          language: targetLanguage,
                          targetChars: unit.targetChars,
                          avoid,
                          context: lineContextOf(unit.cueIds, unit.speaker),
                          examples: choicesFor(activeJob?.id, unit.text),
                          count: LINE_OPTIONS,
                        })
                  }
                />
              )}
              {!report && dubSettingsCard}
              {!report && syncPanel}
            </div>

            {report && (
            <div className="flex flex-col gap-4 min-w-0 min-h-0">
              {/* Voice, once synced: folded to one line until wanted. Before the first sync it is on the Dub settings card. */}
              {report && (
              <aside id="dub-voice" aria-label="Voice and delivery" className="flex flex-col bg-slate-900/90 border border-edge rounded-2xl overflow-hidden scroll-mt-4">
                <div className="flex items-center justify-between gap-2 px-4 sm:px-5 pt-4">
                  <h2 className="text-[15px] font-semibold text-slate-100">Voice and delivery</h2>
                  {report && (
                    <button
                      type="button"
                      onClick={() => setVoicePanelOpen((open) => !open)}
                      aria-expanded={voicePanelOpen}
                      className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 cursor-default"
                    >
                      {voicePanelOpen ? 'Hide' : 'Change'}
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${voicePanelOpen ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                </div>
                {report && !voicePanelOpen ? (
                  <p className="px-4 sm:px-5 pt-1 pb-4 text-xs text-slate-400">
                    {[voiceShortName, ttsModelName, multiSpeaker && `${speakers.length} speakers`].filter(Boolean).join(' · ')}. A change applies when you sync
                    again.
                  </p>
                ) : (
                  <>
                    {multiSpeaker && onCastChange && (
                      <div className="px-4 sm:px-5 pt-4 flex flex-col gap-2">
                        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Cast</span>
                        <CastCard
                          speakers={speakers}
                          cast={activeJob.cast}
                          mainVoiceId={elVoiceId}
                          availableVoices={availableVoices}
                          disabled={isSyncing}
                          onPick={(speaker) => {
                            setCastPickFor(speaker);
                            setIsVoicePickerOpen(true);
                          }}
                          onUseMain={(speaker) => onCastChange(speaker, null)}
                          rates={speakerVoiceRates}
                          mainRate={voiceRate}
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
                          className="px-2.5 py-1.5 rounded-lg border border-edge bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-default shrink-0"
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
                                className={`flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-xs transition-colors cursor-default ${
                                  on ? 'border-indigo-500 bg-indigo-950/40 text-slate-100' : 'border-edge text-slate-300 hover:bg-slate-800/60'
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
                            disabled={isSyncing}
                            title={hasDub ? 'A new model applies the next time you sync.' : undefined}
                            className="min-w-0 max-w-[65%] h-8 bg-slate-950 border border-edge hover:border-slate-600 rounded-lg px-2 text-xs font-medium text-slate-200 truncate focus:outline-none focus:border-indigo-500 cursor-default disabled:opacity-60"
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
                      {onVoiceExpressionChange && (() => {
                        // Tags are written for one continuous read on a model that performs them; anything else is Neutral (or Off).
                        const cartesia = voiceEngine === 'cartesia';
                        const takesCues =
                          (cartesia ? cartesiaTakesControls(cartesiaModelId) : Boolean(elModelId && performsAudioTags(elModelId))) && !multiSpeaker;
                        const current: VoiceExpression = takesCues || voiceExpression === 'off' ? voiceExpression : 'neutral';
                        const notTagged = multiSpeaker
                          ? 'Natural and Expressive are for a dub in one voice.'
                          : cartesia
                            ? 'Natural and Expressive need a Sonic 3 model.'
                            : 'Natural and Expressive need Eleven v3 or v4.';
                        return (
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                              <span id="dub-voice-expression">Expression</span>
                              <div
                                role="group"
                                aria-labelledby="dub-voice-expression"
                                title={hasDub ? 'Applies the next time you sync.' : undefined}
                                className="flex bg-slate-950 border border-edge rounded-xl p-0.5 gap-0.5"
                              >
                                {([
                                  { id: 'off', label: 'Off' },
                                  { id: 'neutral', label: 'Neutral' },
                                  { id: 'natural', label: 'Natural' },
                                  { id: 'expressive', label: 'Expressive' },
                                ] as const).map((m) => {
                                  const off = (m.id === 'natural' || m.id === 'expressive') && !takesCues;
                                  return (
                                    <button
                                      key={m.id}
                                      type="button"
                                      aria-pressed={current === m.id}
                                      onClick={() => onVoiceExpressionChange(m.id)}
                                      disabled={isSyncing || off}
                                      title={off ? notTagged : undefined}
                                      className={`px-2 py-1 rounded-lg text-xs font-medium transition-colors cursor-default ${
                                        current === m.id ? 'bg-slate-800 text-slate-100' : off ? 'text-slate-600' : 'text-slate-400 hover:text-slate-200'
                                      }`}
                                    >
                                      {m.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            <span className="text-[11px] text-slate-500 leading-snug">
                              {current === 'off'
                                ? "The script as written, in the voice's own settings. Nothing added."
                                : current === 'natural'
                                ? cartesia
                                  ? 'Follows how the original speaker spoke: each line gets one mild emotion, like calm or curious.'
                                  : 'Follows how the original speaker spoke: their pace and pauses, with calm tags only.'
                                : current === 'expressive'
                                  ? cartesia
                                    ? 'The voice takes its emotion from the words. Can sound dramatic.'
                                    : 'Adds emotion tags guessed from the script. Can sound dramatic.'
                                  : takesCues
                                    ? "Calm and steady in the speaker's own voice. No tags, one tone throughout."
                                    : `Calm and steady in the speaker's own voice. ${notTagged}`}
                            </span>
                          </div>
                        );
                      })()}
                      {onDubMatchLoudnessChange && (
                        <label className="flex items-start gap-2.5 text-xs cursor-default" title={hasDub ? 'Applies the next time you sync.' : undefined}>
                          <input
                            type="checkbox"
                            checked={dubMatchLoudness}
                            onChange={(e) => onDubMatchLoudnessChange(e.target.checked)}
                            disabled={isSyncing}
                            className="mt-0.5 w-3.5 h-3.5 accent-indigo-500 cursor-default"
                          />
                          <span className="flex flex-col gap-0.5">
                            <span className="text-slate-200 font-medium">{multiSpeaker ? 'Even out speakers' : 'Even out loudness'}</span>
                            <span className="text-[11px] text-slate-500 leading-snug">
                              {multiSpeaker
                                ? 'One gain per speaker, so every voice sits at one level and keeps its own dynamics. Off: every line exactly as voiced.'
                                : 'Brings every line to one level. Off: each line keeps exactly the level it was voiced at.'}
                            </span>
                          </span>
                        </label>
                      )}
                      {onDubAudioQualityChange && (
                        <fieldset className="flex flex-col gap-1.5 pt-1" disabled={isSyncing} title={hasDub ? 'Applies the next time you sync.' : undefined}>
                          <legend className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">Audio quality</legend>
                          {DUB_AUDIO_QUALITIES.map((q) => (
                            <label key={q.id} className="flex items-start gap-2.5 text-xs cursor-default">
                              <input
                                type="radio"
                                name="dub-audio-quality"
                                checked={dubAudioQuality === q.id}
                                onChange={() => onDubAudioQualityChange(q.id)}
                                className="mt-0.5 w-3.5 h-3.5 accent-indigo-500 cursor-default"
                              />
                              <span className="flex flex-col gap-0.5">
                                <span className="text-slate-200 font-medium">{q.label}</span>
                                <span className="text-[11px] text-slate-500 leading-snug">{q.hint}</span>
                              </span>
                            </label>
                          ))}
                          {dubQualityNotice && (
                            <p role="status" className="text-[11px] text-amber-300/90 leading-snug">
                              {dubQualityNotice}
                            </p>
                          )}
                        </fieldset>
                      )}
                      {multiSpeaker && onMixPeakChange && (
                        <div className="pt-1" title={hasDub ? 'Applies the next time you sync.' : undefined}>
                          <MixPeakChoice value={mixPeak} onChange={onMixPeakChange} disabled={isSyncing} />
                        </div>
                      )}
                      {showVoiceSliders && (
                        <div className="flex flex-col gap-3 pt-1">
                          <div className="flex items-center justify-between -mb-1">
                            <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Voice settings</span>
                            <ResetDefaultsButton
                              onClick={() => onElVoiceSettingsChange?.({ ...DEFAULT_VOICE_SETTINGS })}
                              disabled={isSyncing || isElevenLabsDefault(shownVoiceSettings)}
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
                                disabled={isSyncing}
                                onChange={(e) =>
                                  onElVoiceSettingsChange?.({ ...shownVoiceSettings, [s.key]: parseFloat(e.target.value) })
                                }
                                aria-label={s.label}
                                className="w-full mt-1.5 accent-indigo-500 cursor-default disabled:opacity-60"
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
                              disabled={isSyncing}
                              onClick={() =>
                                onElVoiceSettingsChange?.({
                                  ...shownVoiceSettings,
                                  use_speaker_boost: shownVoiceSettings.use_speaker_boost === false,
                                })
                              }
                              className={`relative w-[34px] h-5 rounded-full shrink-0 transition-colors cursor-default disabled:opacity-60 ${
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
                            <span>{elVoiceSettings ? 'Your settings. They apply the next time you sync.' : "The voice's own ElevenLabs settings."}</span>
                            {elVoiceSettings && (
                              <button
                                type="button"
                                onClick={() => onElVoiceSettingsChange?.(null)}
                                disabled={isSyncing}
                                className="shrink-0 text-indigo-400 hover:text-indigo-300 cursor-default"
                              >
                                Reset
                              </button>
                            )}
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </aside>
              )}
              {syncPanel}
            </div>
            )}
          </div>

          {/* Full voice library, opened from Change */}
        </div>
        );
      })()}

      {syncSettingsAlone && !onDubStep && (
        <SyncSettingsDialog
          options={syncOptions}
          onOptionsChange={setSyncOptions}
          multiSpeaker={multiSpeaker}
          isSyncing={isSyncing}
          onClose={() => setSyncSettingsAlone(false)}
        />
      )}

      {/* The voice library over any step: the main voice, or one speaker's from the cast */}
      {isVoicePickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a voice"
          onClick={(e) => e.target === e.currentTarget && setIsVoicePickerOpen(false)}
          onKeyDown={(e) => e.key === 'Escape' && setIsVoicePickerOpen(false)}
        >
          <PageScrollLock />
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
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-default"
              >
                <X className="w-3.5 h-3.5" /> Done
              </button>
            </div>
            <VoiceSelectorCard
              elVoiceId={castPickFor ? activeJob?.cast?.[castPickFor]?.voiceId || elVoiceId : elVoiceId}
              onElVoiceIdChange={castPickFor && onCastChange ? (id) => onCastChange(castPickFor, id) : onElVoiceIdChange}
              availableVoices={availableVoices}
              loading={voicesLoading}
              targetLanguage={targetLanguage}
              voiceEngine={voiceEngine}
              onVoiceEngineChange={onVoiceEngineChange}
              className="h-[78vh]"
            />
          </div>
        </div>
      )}

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
              className="ml-1.5 -mr-1.5 px-2.5 py-0.5 rounded-full bg-slate-950 text-slate-100 text-[12px] font-semibold hover:bg-slate-800 cursor-default"
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
        sourceLanguage={subtitleSourceLanguage}
        fileStem={activeJob ? projectFileStem(activeJob) : undefined}
        initialOptions={srtOptions}
        onOptionsChange={(newOpts) => setSrtOptions(newOpts)}
        synthAudioDuration={activeJob?.synthAudioBuffer?.duration}
        hasSynthAudio={!!activeJob?.synthesizedAudioUrl}
        syncedSegments={syncedCues}
        audio={{ original: activeJob?.file, synced: activeJob?.syncedAudioUrl, dubbed: activeJob?.synthesizedAudioUrl }}
        syncStale={syncPendingLines.length > 0}
        subtitleEdits={activeJob?.subtitleEdits}
        onSubtitleEditChange={
          onUpdateJobFields &&
          ((key, edit) => {
            const next = { ...(activeJob?.subtitleEdits || {}) };
            if (edit) next[key] = edit;
            else delete next[key];
            onUpdateJobFields({ subtitleEdits: Object.keys(next).length > 0 ? next : null });
          })
        }
        exportChoice={subtitleChoice}
        onExportChoiceChange={(choice) => {
          setSubtitleChoice(choice);
          saveSubtitleExportChoice(choice);
        }}
      />

      {/* Custom Script Paste & Alignment Modal */}
      <CustomScriptAlignModal
        isOpen={isAlignModalOpen}
        onClose={() => {
          setIsAlignModalOpen(false);
          setAlignHandOff(null);
        }}
        incoming={alignHandOff}
        segments={segments}
        targetLanguage={targetLanguage}
        audioDuration={activeJob?.audioBuffer?.duration}
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
