import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Volume2,
  Play,
  Pause,
  CheckCircle2,
  ArrowRight,
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
  ShieldCheck,
  ArrowLeftRight,
  X,
} from 'lucide-react';
import { AudioSegment, BatchJob, ProcessingStatus } from '../types';
import { Voice } from '../services/elevenLabsService';
import { audioBufferToWav } from '../services/audioService';
import {
  generateTargetLanguageScript,
  generateSrtContent,
  generateVttContent,
  downloadFile,
  TargetScriptFormat,
  SrtOptions,
  DEFAULT_SRT_OPTIONS,
} from '../services/srtService';
import { ReviewWaveformPlayer } from './ReviewWaveformPlayer';
import { VoiceSelectorCard, SelectedVoiceSummary, POPULAR_ELEVENLABS_VOICES } from './VoiceSelectorCard';
import { MediaStrip, MiniWaveform } from './MediaStrip';
import { useFavoriteVoices } from '../services/favoriteVoicesService';
import { PhoneticSmartTextarea } from './PhoneticSmartTextarea';
import { SrtExportModal } from './SrtExportModal';
import { CustomScriptAlignModal } from './CustomScriptAlignModal';
import { TranslationPromptCard } from './TranslationPromptCard';
import { TranslationPromptModal } from './TranslationPromptModal';
import { PauseSensitivityControl } from './PauseSensitivityControl';
import { QaCockpit } from './QaCockpit';
import { getPresetById } from '../services/translationPromptPresets';
import { runQa, useQaConfig } from '../services/qaService';
import { useGlossaryTerms } from '../services/glossaryService';
import { useSignoff } from '../services/signoffService';

type ReviewMode = 'grid' | 'table' | 'spotlight' | 'script' | 'qa';

const REVIEW_VIEWS: { id: ReviewMode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'table', label: 'Cues', Icon: Table },
  { id: 'grid', label: 'Cards', Icon: LayoutGrid },
  { id: 'spotlight', label: 'Spotlight', Icon: Maximize2 },
  { id: 'script', label: 'Script', Icon: FileText },
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

/** 125.4 -> "2:05", 3725 -> "1:02:05" */
const formatClock = (seconds: number) => {
  const t = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const railButton =
  'flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';

interface ExpressDubWizardProps {
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
  availableVoices: Voice[];
  onOpenPhoneticKeyboard?: (segment?: AudioSegment) => void;
  onAutoTranscribe: () => Promise<void>;
  isTranscribing: boolean;
  onSynthesizeMaster: () => Promise<void>;
  /** Display name of the ElevenLabs model the dub is generated with. */
  ttsModelName?: string;
  isSynthesizing: boolean;
  onUpdateSegment: (id: string | number, updates: Partial<AudioSegment>) => void;
  onPlaySegmentSolo: (segment: AudioSegment) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  trackMode: 'source' | 'synth' | 'both';
  onTrackModeChange: (mode: 'source' | 'synth' | 'both') => void;
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
  isTranslatingLanguage?: boolean;
  onOpenPromptModal?: () => void;
  onOpenVoiceChanger?: () => void;
  analysisSensitivity?: number;
  onSensitivityChange?: (sensitivity: number) => void;
}

export const ExpressDubWizard: React.FC<ExpressDubWizardProps> = ({
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
  onOpenPhoneticKeyboard,
  onAutoTranscribe,
  isTranscribing,
  onSynthesizeMaster,
  ttsModelName = 'ElevenLabs',
  isSynthesizing,
  onUpdateSegment,
  onPlaySegmentSolo,
  isPlaying,
  onTogglePlay,
  currentTime,
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
  isTranslatingLanguage,
  onOpenPromptModal,
  onOpenVoiceChanger,
  analysisSensitivity = 50,
  onSensitivityChange,
}) => {
  const [playingSegmentId, setPlayingSegmentId] = useState<string | number | null>(null);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [isLocalPromptModalOpen, setIsLocalPromptModalOpen] = useState(false);

  // Pro Review Suite Mode & Controls
  const [reviewMode, setReviewMode] = useState<ReviewMode>('table');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pacingFilter, setPacingFilter] = useState<'all' | 'risk' | 'tight'>('all');
  const [scriptExportFormat, setScriptExportFormat] = useState<TargetScriptFormat>('dialogue');
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
  const scriptScrollRef = useRef<HTMLDivElement>(null);

  // Pagination State for Long Scripts (30m to 1h) compatibility
  const [currentPage, setCurrentPage] = useState<number>(1);
  const itemsPerPage = 35; // Ideal density for buttery smooth React rendering and DOM performance

  // Reset page to 1 when search or filter options change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, pacingFilter, reviewMode]);

  const handleApplyAlignedSegments = (alignedItems: { id: string | number; textTarget: string }[]) => {
    if (!segments || segments.length === 0) return;
    alignedItems.forEach((item) => {
      onUpdateSegment(item.id, {
        textTarget: item.textTarget,
        targetText: item.textTarget,
      });
    });
    setExportSuccessMessage(`Applied custom script alignment across ${alignedItems.length} dialogue cues!`);
    setTimeout(() => setExportSuccessMessage(null), 3500);
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

  // Compute Current Step in Express Wizard:
  // Step 1: No audio uploaded yet OR audio uploaded but 0 segments transcribed
  // Step 2: Audio uploaded AND segments exist, but no synthesized dub yet
  // Step 3: Dub synthesized (synthAudioBuffer / synthesizedAudioUrl exists)
  const currentStep = !activeJob
    ? 1
    : activeJob.segments.length === 0
    ? 1
    : activeJob.synthesizedAudioUrl || activeJob.synthAudioBuffer
    ? 3
    : 2;

  const [stepOverride, setStepOverride] = useState<number | null>(null);
  const activeStep = stepOverride !== null ? stepOverride : currentStep;
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

  const filteredSegments = useMemo(() => {
    return segments.filter((seg) => {
      const srcText = getSourceText(seg).toLowerCase();
      const tgtText = getTargetText(seg).toLowerCase();
      const speaker = (seg.speaker || '').toLowerCase();
      const q = searchQuery.trim().toLowerCase();

      if (q && !srcText.includes(q) && !tgtText.includes(q) && !speaker.includes(q)) {
        return false;
      }

      const charCount = getTargetText(seg).length;
      const cps = seg.duration > 0 ? charCount / seg.duration : 0;

      if (pacingFilter === 'risk') return cps > 18;
      if (pacingFilter === 'tight') return cps > 14 && cps <= 18;
      return true;
    });
  }, [segments, searchQuery, pacingFilter]);

  const activeSegmentId = useMemo(() => {
    return segments.find((s) => currentTime >= s.startTime && currentTime <= s.endTime)?.id || null;
  }, [segments, currentTime]);

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

  const pacingCounts = useMemo(() => {
    const counts = { natural: 0, tight: 0, fast: 0 };
    segments.forEach((seg) => {
      counts[getPace(getTargetText(seg), seg.duration).level]++;
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
    onSeek(seg.startTime);
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
      setExportSuccessMessage(`Exported ${targetLanguage} script (${format.toUpperCase()})`);
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
    setExportSuccessMessage(`Exported ${targetLanguage} script (${format.toUpperCase()})`);
    setTimeout(() => setExportSuccessMessage(null), 3000);
  };

  const handleCopyFullTargetScript = (format: TargetScriptFormat = 'dialogue') => {
    if (!segments || segments.length === 0) return;
    const scriptContent = generateTargetLanguageScript(segments, targetLanguage, format);
    try {
      navigator.clipboard.writeText(scriptContent);
      setExportSuccessMessage(`Copied full ${targetLanguage} script to clipboard!`);
      setTimeout(() => setExportSuccessMessage(null), 3000);
    } catch (e) {
      console.warn('Clipboard write failed:', e);
    }
  };

  const handleExportSrtWithSettings = (customOpts?: SrtOptions) => {
    if (!segments || segments.length === 0) return;
    const opts = customOpts || srtOptions;
    const srt = generateSrtContent(segments, opts);
    const cleanLang = (targetLanguage || 'captions').toLowerCase().replace(/\s+/g, '_');
    downloadFile(srt, `dhvani_${cleanLang}_subtitles.srt`, 'text/srt;charset=utf-8');
    setExportSuccessMessage(
      `Exported .SRT (${opts.maxLinesPerCue} line, max ${opts.maxWordsPerLine} words/line)`
    );
    setTimeout(() => setExportSuccessMessage(null), 3500);
  };

  const handleExportVttWithSettings = (customOpts?: SrtOptions) => {
    if (!segments || segments.length === 0) return;
    const opts = customOpts || srtOptions;
    const vtt = generateVttContent(segments, opts);
    const cleanLang = (targetLanguage || 'captions').toLowerCase().replace(/\s+/g, '_');
    downloadFile(vtt, `dhvani_${cleanLang}_subtitles.vtt`, 'text/vtt;charset=utf-8');
    setExportSuccessMessage(`Exported WebVTT .VTT captions`);
    setTimeout(() => setExportSuccessMessage(null), 3000);
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

  return (
    <div className="w-full flex flex-col space-y-4 sm:space-y-5">
      {/* Step bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Dubbing steps"
          className="flex items-center gap-1 p-1 rounded-full bg-slate-900/90 border border-slate-800 text-xs sm:text-[13px] max-w-full overflow-x-auto [scrollbar-width:none]"
        >
          {[
            { n: 1, label: 'Source & voice', enabled: true },
            { n: 2, label: 'Review translation', enabled: hasSegments },
            { n: 3, label: 'Final dub', enabled: hasSegments },
          ].map((s) => {
            const isActive = activeStep === s.n;
            return (
              <button
                key={s.n}
                type="button"
                onClick={() => s.enabled && setStepOverride(s.n)}
                disabled={!s.enabled}
                aria-current={isActive ? 'step' : undefined}
                className={`flex items-center gap-2 pl-1.5 pr-3.5 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-slate-800 text-slate-100 shadow-sm'
                    : s.enabled
                      ? 'text-slate-400 hover:text-slate-200 cursor-pointer'
                      : 'text-slate-600 cursor-not-allowed'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-mono border ${
                    isActive
                      ? s.n === 3
                        ? 'bg-emerald-500 border-emerald-500 text-white'
                        : 'bg-indigo-500 border-indigo-500 text-white'
                      : 'border-slate-700'
                  }`}
                >
                  {s.n === 3 && activeJob?.synthesizedAudioUrl && !isActive ? <Check className="w-3 h-3" /> : s.n}
                </span>
                <span>{s.label}</span>
                {s.n === 2 && hasSegments && (
                  <span className="text-[10px] font-mono text-cyan-300 tabular-nums">{activeJob!.segments.length} cues</span>
                )}
              </button>
            );
          })}
        </nav>

        {activeJob && onResetSession && (
          <button
            type="button"
            onClick={onResetSession}
            className="flex items-center gap-2 text-xs sm:text-[13px] text-slate-300 hover:text-slate-100 bg-slate-900/90 hover:bg-slate-800 px-3.5 py-1.5 rounded-full border border-slate-800 transition-colors cursor-pointer"
            title="Start fresh with a new audio file"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>New audio</span>
          </button>
        )}
      </div>

      {/* ========================================================================= */}
      {/* STEP 1: MEDIA, LANGUAGES & VOICE */}
      {/* ========================================================================= */}
      {activeStep === 1 && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-200">
          <MediaStrip
            file={activeJob?.file ?? null}
            audioBuffer={activeJob?.audioBuffer ?? null}
            onFileSelect={onFileSelect}
            onLoadSample={(sample) => {
              onLoadSampleSession(sample);
              setStepOverride(2);
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-4 items-stretch">
            {/* Voice library: the main decision on this step */}
            <VoiceSelectorCard
              elVoiceId={elVoiceId}
              onElVoiceIdChange={onElVoiceIdChange}
              availableVoices={availableVoices}
              targetLanguage={targetLanguage}
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
                    <select
                      id="express-wizard-source-lang-select"
                      value={sourceLanguage}
                      onChange={(e) => onSourceLanguageChange?.(e.target.value)}
                      disabled={!onSourceLanguageChange}
                      className="w-full h-10 bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-xl px-3 text-[13px] font-medium text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:cursor-default"
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
                    <select
                      id="express-wizard-lang-select"
                      value={targetLanguage}
                      onChange={(e) => onTargetLanguageChange(e.target.value)}
                      className="w-full h-10 bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-xl px-3 text-[13px] font-medium text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer"
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
                </div>
                <p className="text-[11.5px] text-slate-500 leading-relaxed">
                  Auto detect works for most talks. Set the language when speakers mix languages.
                </p>
              </div>

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
                </div>
              )}

              <div className="px-4 sm:px-5 py-4 border-t border-slate-800 bg-slate-950/60 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={async () => {
                    await onAutoTranscribe();
                    setStepOverride(2);
                  }}
                  disabled={!activeJob || isTranscribing}
                  className="h-11 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer active:translate-y-px"
                >
                  {isTranscribing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Transcribing and translating…</span>
                    </>
                  ) : activeJob ? (
                    <>
                      <span>Transcribe &amp; translate to {targetLanguage}</span>
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
                    <span>Translate</span>
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
        <div className="flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Interactive Audio Waveform & Pro Audition Player */}
          <ReviewWaveformPlayer
            audioBuffer={activeJob.audioBuffer}
            segments={segments}
            currentTime={currentTime}
            duration={duration || activeJob.audioBuffer?.duration || 0}
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
            }}
            activeSegmentId={
              segments.find((s) => currentTime >= s.startTime && currentTime <= s.endTime)?.id || null
            }
            targetLanguage={targetLanguage}
            playbackRate={playbackRate}
            onPlaybackRateChange={onPlaybackRateChange}
            trackMode={trackMode}
            onTrackModeChange={onTrackModeChange}
            hasSynthesizedAudio={Boolean(activeJob.synthesizedAudioUrl)}
            sensitivity={analysisSensitivity}
            onSensitivityChange={onSensitivityChange}
          />

          {/* Workspace: cue editor and review panel share one height, so neither leaves a gap */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_21rem] gap-4 lg:h-[calc(100vh-7rem)] lg:min-h-[600px]">
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
                        placeholder="Find in cues"
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
                    onClick={() => onOpenPhoneticKeyboard()}
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
                <div className={reviewMode === 'table' ? '' : 'p-3 sm:p-4 space-y-4'}>
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

          {/* Empty Filter State */}
          {reviewMode !== 'qa' && filteredSegments.length === 0 && (
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
                    (currentTime >= seg.startTime && currentTime <= seg.endTime) || isCuePlaying;
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
                const isCueActive = (currentTime >= seg.startTime && currentTime <= seg.endTime) || isCuePlaying;
                const pace = getPace(tgtText, seg.duration);
                const cueNumber = (currentPage - 1) * itemsPerPage + index + 1;

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
                      onClick={() => onSeek(seg.startTime)}
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
                      {seg.speaker && (
                        <span className="block text-[10.5px] uppercase tracking-wide font-semibold text-slate-500 mb-0.5">
                          {seg.speaker}
                        </span>
                      )}
                      {srcText || <span className="text-slate-600 italic">No original text</span>}
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
                      {pace.level === 'fast' && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-rose-300 leading-snug">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                          <span>Too long for {seg.duration.toFixed(1)}s. Shorten it so the voice doesn't rush.</span>
                        </p>
                      )}
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
                  {reviewMode === 'qa'
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
                  <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Translation</span>
                  <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
                    <span className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0">
                      <SlidersHorizontal className="w-4 h-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-100 truncate">
                        {getPresetById(promptPresetId || 'conversational').name}
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
                        onClick={() => onRetranslateSegments(customPrompt || '')}
                        disabled={isTranslatingLanguage || segments.length === 0}
                        className={railButton}
                        title="Translate every cue again with the current style"
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
                      title="Paste your own translated script and fit it to these cues"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5" />
                      Paste script
                    </button>
                  </div>
                </div>

                {/* Export */}
                <div className="px-4 sm:px-5 py-4 border-t border-slate-800 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Export</span>
                    <button
                      type="button"
                      onClick={() => setIsSrtModalOpen(true)}
                      className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                      title="Max words, lines and characters per subtitle, with a live preview"
                    >
                      <Sliders className="w-3 h-3" /> Subtitle settings
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => handleExportSrtWithSettings()} disabled={segments.length === 0} className={railButton}>
                      <Download className="w-3.5 h-3.5" /> Subtitles .srt
                    </button>
                    <button type="button" onClick={() => handleExportVttWithSettings()} disabled={segments.length === 0} className={railButton}>
                      <Download className="w-3.5 h-3.5" /> Subtitles .vtt
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      id="express-step2-script-format"
                      value={scriptExportFormat}
                      onChange={(e) => setScriptExportFormat(e.target.value as TargetScriptFormat)}
                      className="flex-1 min-w-0 h-8 bg-slate-950 border border-slate-800 rounded-lg px-2 text-xs font-medium text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer"
                      aria-label="Script format"
                    >
                      <option value="dialogue" className="bg-slate-900">Dialogue .txt</option>
                      <option value="timecoded" className="bg-slate-900">With timecodes .txt</option>
                      <option value="bilingual" className="bg-slate-900">Bilingual .txt</option>
                      <option value="csv" className="bg-slate-900">Cue sheet .csv</option>
                      <option value="json" className="bg-slate-900">Data .json</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleExportTargetScript(scriptExportFormat)}
                      disabled={segments.length === 0}
                      className={`${railButton} shrink-0`}
                    >
                      <Download className="w-3.5 h-3.5" /> Script
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopyFullTargetScript()}
                      disabled={segments.length === 0}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 shrink-0 cursor-pointer"
                      title={`Copy the ${targetLanguage} script`}
                      aria-label={`Copy the ${targetLanguage} script`}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Tools */}
                {(onSensitivityChange || onOpenVoiceChanger) && (
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
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 3: FINAL DUB */}
      {/* ========================================================================= */}
      {activeStep === 3 && activeJob && (() => {
        const hasDub = Boolean(activeJob.synthesizedAudioUrl);
        const dubBuffer = activeJob.synthAudioBuffer;
        const sourceBuffer = activeJob.audioBuffer;
        const totalLength = duration || dubBuffer?.duration || sourceBuffer?.duration || 0;
        const activeCue = segments.find((s) => s.id === activeSegmentId) || null;
        const activeCueIndex = activeCue ? segments.indexOf(activeCue) : -1;
        const openIssues = openFindings.length;

        return (
        <div className="flex flex-col gap-4 animate-in fade-in duration-200">
          {/* Dub panel: ready, dubbing, or finished */}
          <section aria-label="Dub" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col gap-4">
            {isSynthesizing ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-[17px] font-semibold text-slate-100">Dubbing in {targetLanguage}</h2>
                  <span className="text-[11.5px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300">In progress</span>
                  <span className="text-xs text-slate-400">{ttsModelName}</span>
                </div>
                {/* One ElevenLabs request covers the whole script, so progress can't be counted per cue. */}
                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 animate-[dubsweep_1.4s_ease-in-out_infinite]" />
                </div>
                <p className="text-xs text-slate-400">
                  Voicing {segments.length} cues ({dubCharacterCount.toLocaleString()} characters). You can keep reading the script while it works.
                </p>
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
                      { id: 'synth' as const, label: 'Dub', dot: 'bg-indigo-400' },
                      { id: 'source' as const, label: 'Original', dot: 'bg-cyan-400' },
                      { id: 'both' as const, label: 'Both', dot: '' },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={trackMode === m.id}
                        onClick={() => onTrackModeChange(m.id)}
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

                {/* Dub and original, one lane each; click a lane to jump there */}
                <div className="grid grid-cols-1 sm:grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 items-center">
                  {[
                    { label: `${targetLanguage} dub`, buffer: dubBuffer, dot: 'bg-indigo-400', color: 'text-indigo-400', muted: trackMode === 'source' },
                    { label: 'Original', buffer: sourceBuffer, dot: 'bg-cyan-400', color: 'text-cyan-400', muted: trackMode === 'synth' },
                  ].map((lane) => (
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
                        aria-valuemax={Math.round(totalLength)}
                        aria-valuenow={Math.round(currentTime)}
                        onClick={(e) => {
                          const r = e.currentTarget.getBoundingClientRect();
                          onSeek(((e.clientX - r.left) / r.width) * totalLength);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowRight') onSeek(Math.min(totalLength, currentTime + 5));
                          if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 5));
                        }}
                        className={`relative h-14 rounded-lg bg-slate-950/60 overflow-hidden cursor-pointer transition-opacity ${lane.muted ? 'opacity-40' : ''}`}
                      >
                        {lane.buffer ? (
                          <MiniWaveform buffer={lane.buffer} className={lane.color} />
                        ) : (
                          <span className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">
                            Waveform not available
                          </span>
                        )}
                        {totalLength > 0 && (
                          <span
                            className="absolute top-0 bottom-0 w-0.5 bg-slate-100 pointer-events-none"
                            style={{ left: `${Math.min(100, (currentTime / totalLength) * 100)}%` }}
                          />
                        )}
                      </div>
                    </React.Fragment>
                  ))}
                  <div className="sm:col-start-2 flex justify-between font-mono text-[10px] text-slate-500 tabular-nums">
                    {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                      <span key={f}>{formatClock(totalLength * f)}</span>
                    ))}
                  </div>
                </div>

                {/* Transport and live caption */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => activeCueIndex > 0 && onSeek(segments[activeCueIndex - 1].startTime)}
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
                      const next = segments.find((s) => s.startTime > currentTime + 0.05);
                      if (next) onSeek(next.startTime);
                    }}
                    className="w-8 h-8 rounded-full border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                    aria-label="Next cue"
                  >
                    <ChevronsRight className="w-4 h-4" />
                  </button>
                  <span className="font-mono text-sm text-slate-100 tabular-nums">
                    {formatClock(currentTime)} <span className="text-slate-500">/ {formatClock(totalLength)}</span>
                  </span>

                  <div
                    aria-live="polite"
                    className="flex-1 min-w-[15rem] flex items-center gap-3 px-3.5 py-2 rounded-xl bg-slate-950/60 border border-slate-800 min-h-[3.25rem]"
                  >
                    {activeCue ? (
                      <>
                        <span className="font-mono text-[10.5px] text-slate-500 shrink-0">
                          #{String(activeCueIndex + 1).padStart(2, '0')}
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

          {/* Script and delivery share one height */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_21rem] gap-4 items-stretch">
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

              <div className="flex-1 min-h-0 max-h-[32rem] lg:max-h-none overflow-y-auto custom-scrollbar py-1.5">
                {segments.map((seg, i) => {
                  const isNow = seg.id === activeSegmentId;
                  return (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => onSeek(seg.startTime)}
                      className={`w-full text-left grid gap-x-3 px-4 py-2.5 transition-colors cursor-pointer ${
                        finalScriptLayout === 'dialogue' ? 'grid-cols-[2rem_minmax(0,1fr)]' : 'grid-cols-[2rem_4.5rem_minmax(0,1fr)]'
                      } ${isNow ? 'bg-indigo-950/40' : 'hover:bg-slate-800/30'}`}
                    >
                      <span className={`font-mono text-[11px] pt-1 tabular-nums ${isNow ? 'text-indigo-300' : 'text-slate-500'}`}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {finalScriptLayout !== 'dialogue' && (
                        <span className="font-mono text-[11.5px] text-slate-400 pt-1 tabular-nums">{formatClock(seg.startTime)}</span>
                      )}
                      <span className="min-w-0">
                        {seg.speaker && (i === 0 || segments[i - 1].speaker !== seg.speaker) && (
                          <span className="block text-[10.5px] uppercase tracking-wide font-semibold text-slate-500">{seg.speaker}</span>
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
            </section>

            {/* Deliver panel */}
            <aside aria-label="Deliver" className="flex flex-col bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 sm:px-5 pt-4">
                <h2 className="text-[15px] font-semibold text-slate-100">Deliver</h2>
                <button type="button" onClick={() => setStepOverride(2)} className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer">
                  ← Review
                </button>
              </div>

              <div className="px-4 sm:px-5 py-4 flex flex-col gap-2.5">
                <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Voice</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <SelectedVoiceSummary voiceId={elVoiceId} availableVoices={availableVoices} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsVoicePickerOpen(true)}
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
                <div className="flex justify-between text-xs text-slate-400">
                  <span>Model</span>
                  <span className="text-slate-200 font-medium truncate ml-3">{ttsModelName}</span>
                </div>
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
                    tag: 'SRT',
                    tone: 'bg-indigo-500/15 text-indigo-300',
                    title: `${targetLanguage} subtitles`,
                    detail: `${segments.length} cues · ${srtOptions.maxLinesPerCue} line, ${srtOptions.maxWordsPerLine} words max`,
                    onClick: () => handleExportSrtWithSettings(),
                    disabled: segments.length === 0,
                  },
                  {
                    tag: 'TXT',
                    tone: 'bg-cyan-500/15 text-cyan-300',
                    title: `${targetLanguage} script`,
                    detail: `${finalScriptLayout.charAt(0).toUpperCase()}${finalScriptLayout.slice(1)} layout`,
                    onClick: () => handleExportTargetScript(finalScriptLayout),
                    disabled: segments.length === 0,
                  },
                ].map((d) => (
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
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => handleExportVttWithSettings()} disabled={segments.length === 0} className={railButton}>
                    .vtt subtitles
                  </button>
                  <button type="button" onClick={() => setIsSrtModalOpen(true)} className={railButton}>
                    <Sliders className="w-3.5 h-3.5" /> Subtitle settings
                  </button>
                </div>
              </div>

              {onOpenVoiceChanger && (
                <div className="px-4 sm:px-5 py-4 border-t border-slate-800">
                  <button type="button" onClick={onOpenVoiceChanger} className={`${railButton} w-full`}>
                    <AudioWaveform className="w-3.5 h-3.5" /> Voice changer
                  </button>
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
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsVoicePickerOpen(false)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" /> Done
                  </button>
                </div>
                <VoiceSelectorCard
                  elVoiceId={elVoiceId}
                  onElVoiceIdChange={onElVoiceIdChange}
                  availableVoices={availableVoices}
                  targetLanguage={targetLanguage}
                  className="h-[78vh]"
                />
              </div>
            </div>
          )}
        </div>
        );
      })()}

      {/* Floating Export Toast Notification */}
      {exportSuccessMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-emerald-950/95 border border-emerald-500/80 text-emerald-100 px-4 py-2.5 rounded-2xl shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs font-semibold">{exportSuccessMessage}</span>
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
        currentPresetId={promptPresetId || 'conversational'}
        targetLanguage={targetLanguage}
        hasActiveSegments={segments.length > 0}
        hasAudioFile={!!activeJob?.file}
        onSavePrompt={(p, id) => {
          if (onUpdateTranslationPrompt) onUpdateTranslationPrompt(p, id);
        }}
        onRetranslateSegments={onRetranslateSegments}
        onRetranscribeAudio={onRetranscribeAudio}
        isTranslating={isTranslatingLanguage}
      />
    </div>
  );
};
