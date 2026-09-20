import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  Upload,
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
  Radio,
  Tv,
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
  AudioLines,
  Languages,
  ChevronsDown,
  ChevronsUp,
  Keyboard,
  Share2,
  ChevronDown,
  ClipboardPaste,
  AudioWaveform,
  ShieldCheck,
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
import { VoiceSelectorCard } from './VoiceSelectorCard';
import { PhoneticSmartTextarea } from './PhoneticSmartTextarea';
import { SrtExportModal } from './SrtExportModal';
import { CustomScriptAlignModal } from './CustomScriptAlignModal';
import { TranslationPromptCard } from './TranslationPromptCard';
import { FinalScriptViewer } from './FinalScriptViewer';
import { TranslationPromptModal } from './TranslationPromptModal';
import { PauseSensitivityControl } from './PauseSensitivityControl';
import { QaCockpit } from './QaCockpit';
import { getPresetById } from '../services/translationPromptPresets';
import { runQa, useQaConfig } from '../services/qaService';
import { useGlossaryTerms } from '../services/glossaryService';
import { useSignoff } from '../services/signoffService';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [playingSegmentId, setPlayingSegmentId] = useState<string | number | null>(null);
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [isLocalPromptModalOpen, setIsLocalPromptModalOpen] = useState(false);

  // Pro Review Suite Mode & Controls
  const [reviewMode, setReviewMode] = useState<'grid' | 'table' | 'spotlight' | 'script' | 'qa'>(
    'grid'
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [pacingFilter, setPacingFilter] = useState<'all' | 'risk' | 'safe'>('all');
  const [spotlightIndex, setSpotlightIndex] = useState<number>(0);
  const [copiedCueId, setCopiedCueId] = useState<string | number | null>(null);
  const [isListExpanded, setIsListExpanded] = useState<boolean>(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);
  const [isSrtMenuOpen, setIsSrtMenuOpen] = useState<boolean>(false);
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFileSelect(e.dataTransfer.files);
    }
  };

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
      if (pacingFilter === 'safe') return cps <= 18;
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
  const qaBlockingCount = useMemo(() => {
    const waived = qaSignoff?.overrides || {};
    return qaReport.findings.filter((f) => f.severity === 'block' && !waived[f.id]).length;
  }, [qaReport.findings, qaSignoff]);

  const handleJumpToCue = (seg: AudioSegment) => {
    const idx = segments.findIndex((s) => s.id === seg.id);
    if (idx !== -1) setSpotlightIndex(idx);
    onSeek(seg.startTime);
    setReviewMode('grid');

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
      setIsExportMenuOpen(false);
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
    setIsExportMenuOpen(false);
    setExportSuccessMessage(`Exported ${targetLanguage} script (${format.toUpperCase()})`);
    setTimeout(() => setExportSuccessMessage(null), 3000);
  };

  const handleCopyFullTargetScript = () => {
    if (!segments || segments.length === 0) return;
    const scriptContent = generateTargetLanguageScript(segments, targetLanguage, 'dialogue');
    try {
      navigator.clipboard.writeText(scriptContent);
      setExportSuccessMessage(`Copied full ${targetLanguage} script to clipboard!`);
      setIsExportMenuOpen(false);
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
    setIsSrtMenuOpen(false);
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
    setIsSrtMenuOpen(false);
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
      {/* 3-Step Wizard Progress Bar */}
      <div className="bg-slate-900/95 border border-slate-800 px-4 py-3 sm:px-5 sm:py-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="flex items-center gap-2 text-xs sm:text-sm font-bold font-display uppercase tracking-wider text-indigo-400 bg-indigo-950/70 border border-indigo-700/60 px-3 py-1.5 rounded-xl shadow-2xs">
            <AudioLines className="w-4 h-4 text-indigo-400" />
            Express 3-Step Dub
          </span>
        </div>

        {/* Step Badges */}
        <div className="flex items-center gap-1.5 sm:gap-3 text-xs sm:text-sm">
          {/* Step 1 */}
          <button
            onClick={() => setStepOverride(1)}
            className={`flex items-center gap-2 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl font-semibold transition-all cursor-pointer ${
              activeStep === 1
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-1 ring-indigo-400/50'
                : activeJob
                ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40'
                : 'bg-slate-950 text-slate-500'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">1</span>
            <span>Audio to Translation</span>
          </button>

          <ChevronRight className="w-4 h-4 text-slate-600" />

          {/* Step 2 */}
          <button
            onClick={() => activeJob && activeJob.segments.length > 0 && setStepOverride(2)}
            disabled={!activeJob || activeJob.segments.length === 0}
            className={`flex items-center gap-2 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl font-semibold transition-all cursor-pointer ${
              activeStep === 2
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 ring-1 ring-indigo-400/50'
                : activeJob && activeJob.segments.length > 0
                ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40'
                : 'opacity-40 bg-slate-950 text-slate-600 cursor-not-allowed'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">2</span>
            <span>Review Translation</span>
            {activeJob && activeJob.segments.length > 0 && (
              <span className="text-[11px] bg-slate-800 text-cyan-300 px-2 py-0.5 rounded-md font-mono font-bold border border-slate-700">
                {activeJob.segments.length} cues
              </span>
            )}
          </button>

          <ChevronRight className="w-4 h-4 text-slate-600" />

          {/* Step 3 */}
          <button
            onClick={() => activeJob && activeJob.segments.length > 0 && setStepOverride(3)}
            disabled={!activeJob || activeJob.segments.length === 0}
            className={`flex items-center gap-2 px-3.5 py-1.5 sm:px-4 sm:py-2 rounded-xl font-semibold transition-all cursor-pointer ${
              activeStep === 3
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 ring-1 ring-emerald-400/50'
                : activeJob && activeJob.segments.length > 0
                ? 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40'
                : 'opacity-40 bg-slate-950 text-slate-600 cursor-not-allowed'
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">3</span>
            <span>Final Script & Dub</span>
            {activeJob?.synthesizedAudioUrl && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          </button>
        </div>

        {/* Start Fresh / New Dub Session */}
        {activeJob && onResetSession && (
          <button
            onClick={onResetSession}
            className="flex items-center gap-2 text-xs sm:text-sm text-slate-300 hover:text-indigo-200 bg-slate-900 hover:bg-slate-800 px-3.5 py-1.5 sm:py-2 rounded-xl border border-slate-800 hover:border-indigo-500/40 transition-colors shadow-xs active:scale-95 cursor-pointer"
            title="Start fresh with a new audio file"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
            <span>New Audio</span>
          </button>
        )}
      </div>

      {/* ========================================================================= */}
      {/* STEP 1: AUDIO IN & TARGET LANGUAGE SETUP */}
      {/* ========================================================================= */}
      {activeStep === 1 && (
        <div className="space-y-4 sm:space-y-5 animate-in fade-in zoom-in-95 duration-200">
          {/* Step 1 Title Bar */}
          <div className="flex items-center justify-between gap-3 px-1 py-1">
            <div className="flex items-center gap-3">
              <h2 className="text-base sm:text-lg font-bold text-white font-display flex items-center gap-2">
                <span>Step 1: Audio Input & Voice Setup</span>
              </h2>
              <span className="text-xs sm:text-sm text-slate-400 hidden sm:inline">
                • Select target language, dubbing voice model & provide speech audio
              </span>
            </div>
            {activeJob?.file && (
              <span className="text-xs font-mono text-cyan-300 bg-cyan-950/80 border border-cyan-800/80 px-3 py-1 rounded-lg truncate max-w-xs shadow-xs">
                {activeJob.file.name}
              </span>
            )}
          </div>

          {/* 2-Column Responsive Pro Studio Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6 items-stretch">
            {/* LEFT COLUMN: Source Language, Target Language & Dubbing Voice */}
            <div className="flex flex-col gap-4">
              {/* Source Language Card — drives ElevenLabs transcription accuracy */}
              {onSourceLanguageChange && (
                <div className="bg-slate-900/90 border border-slate-800 p-4 sm:p-5 rounded-2xl flex items-center justify-between gap-4 shadow-sm">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center border border-cyan-500/30 shrink-0 shadow-xs">
                      <Languages className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <label
                        htmlFor="express-wizard-source-lang-select"
                        className="text-sm font-bold text-slate-100 block truncate leading-tight"
                      >
                        Source Audio Language
                      </label>
                      <p className="text-xs text-slate-400 truncate leading-tight mt-1">
                        ElevenLabs transcription &amp; subtitle timestamps
                      </p>
                    </div>
                  </div>

                  <select
                    id="express-wizard-source-lang-select"
                    value={sourceLanguage}
                    onChange={(e) => onSourceLanguageChange(e.target.value)}
                    className="bg-slate-950 border border-slate-700 hover:border-cyan-500 rounded-xl px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-cyan-500 cursor-pointer shrink-0 shadow-inner"
                  >
                    <option value="" className="bg-slate-900 text-white">
                      Auto Detect
                    </option>
                    <option value="English" className="bg-slate-900 text-white">
                      English
                    </option>
                    {languages.map((lang) => {
                      const code = typeof lang === 'string' ? lang : lang.code;
                      const label = typeof lang === 'string' ? lang : lang.label;
                      return (
                        <option key={`src-${code}`} value={code} className="bg-slate-900 text-white">
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              {/* Target Translation Language Card */}
              <div className="bg-slate-900/90 border border-slate-800 p-4 sm:p-5 rounded-2xl flex items-center justify-between gap-4 shadow-sm">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-400 flex items-center justify-center border border-indigo-500/30 shrink-0 shadow-xs">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor="express-wizard-lang-select" className="text-sm font-bold text-slate-100 block truncate leading-tight">
                      Target Translation Language
                    </label>
                    <p className="text-xs text-slate-400 truncate leading-tight mt-1">
                      Script localization, pauses & audio dubbing
                    </p>
                  </div>
                </div>

                <select
                  id="express-wizard-lang-select"
                  value={targetLanguage}
                  onChange={(e) => onTargetLanguageChange(e.target.value)}
                  className="bg-slate-950 border border-slate-700 hover:border-indigo-500 rounded-xl px-4 py-2.5 text-sm font-bold text-white focus:outline-none focus:border-indigo-500 cursor-pointer shrink-0 shadow-inner"
                >
                  {languages.map((lang) => {
                    const code = typeof lang === 'string' ? lang : lang.code;
                    const label = typeof lang === 'string' ? lang : lang.label;
                    return (
                      <option key={code} value={code} className="bg-slate-900 text-white">
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Rich Voice Selection & Search Card */}
              <div className="flex-1 flex flex-col">
                <VoiceSelectorCard
                  elVoiceId={elVoiceId}
                  onElVoiceIdChange={onElVoiceIdChange}
                  availableVoices={availableVoices}
                />
              </div>

              {/* Voice Changer from Audio (Aligned Left-Right Row below Dubbing Voice Section) */}
              {onOpenVoiceChanger && (
                <div className="bg-slate-900/90 border border-slate-800 hover:border-purple-800/60 p-3.5 sm:p-4 rounded-2xl flex items-center justify-between gap-3 shadow-sm transition-all">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/15 text-purple-400 flex items-center justify-center border border-purple-500/30 shrink-0 shadow-xs">
                      <AudioWaveform className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-slate-100 truncate">
                          Voice Changer from Audio
                        </h4>
                        <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md bg-purple-950/80 text-purple-300 border border-purple-800/60 uppercase">
                          Speech-to-Speech
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        Transform speaker voice timbre, clone voices or apply audio DSP filters
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onOpenVoiceChanger}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs sm:text-sm font-bold shadow-md shadow-purple-600/20 active:scale-95 transition-all shrink-0 cursor-pointer"
                    title="Open Voice Changer Studio"
                  >
                    <AudioWaveform className="w-4 h-4" />
                    <span className="whitespace-nowrap">Change Voice</span>
                  </button>
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: Drag-Drop Audio Upload, Samples & Action */}
            <div className="flex flex-col gap-4">
              {/* Drag and Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex-1 min-h-[220px] lg:min-h-[250px] flex flex-col items-center justify-center p-6 sm:p-8 rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer text-center relative overflow-hidden group ${
                  isDragOver
                    ? 'border-cyan-400 bg-cyan-950/30 scale-[1.01] shadow-xl shadow-cyan-500/20'
                    : 'border-slate-800 hover:border-indigo-500/80 bg-slate-900/85 hover:bg-slate-900 shadow-sm'
                }`}
              >
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-500 flex items-center justify-center text-white shadow-lg shadow-indigo-500/30 group-hover:scale-105 transition-all mb-3">
                  <Upload className="w-6 h-6" />
                </div>
                <h3 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  {activeJob?.file ? `Current Media: ${activeJob.file.name}` : 'Drop Speech Audio or Video Here'}
                </h3>
                <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-sm">
                  Click or drag audio (WAV, MP3, M4A, FLAC, OGG) or video (MP4, MOV, MKV, WEBM).
                  Video keeps its original file — only the audio track is sent for transcription.
                </p>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500 font-mono">
                  <span className="px-2.5 py-0.5 rounded-md bg-slate-950/80 border border-slate-800">Stereo/Mono</span>
                  <span className="px-2.5 py-0.5 rounded-md bg-slate-950/80 border border-slate-800">
                    ElevenLabs Scribe
                  </span>
                  <span className="px-2.5 py-0.5 rounded-md bg-slate-950/80 border border-slate-800">
                    Word Timestamps
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      onFileSelect(e.target.files);
                    }
                  }}
                />
              </div>

              {/* Instant Demo Presets Bar */}
              <div className="bg-slate-900/90 border border-slate-800 p-3.5 sm:p-4 rounded-2xl space-y-2.5 shadow-sm">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-indigo-400" />
                    Instant Demo Samples:
                  </span>
                  <span className="text-[11px] text-indigo-400 font-mono font-bold bg-indigo-950/70 border border-indigo-800/60 px-2 py-0.5 rounded-md">
                    1-Click Instant Test
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      onLoadSampleSession('podcast');
                      setStepOverride(2);
                    }}
                    className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-850 text-slate-200 hover:text-white border border-slate-800 hover:border-indigo-500/50 text-xs sm:text-sm font-semibold transition-all active:scale-95 text-center truncate cursor-pointer shadow-xs"
                  >
                    <Radio className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span className="truncate">Podcast Sample</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onLoadSampleSession('keynote');
                      setStepOverride(2);
                    }}
                    className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-850 text-slate-200 hover:text-white border border-slate-800 hover:border-cyan-500/50 text-xs sm:text-sm font-semibold transition-all active:scale-95 text-center truncate cursor-pointer shadow-xs"
                  >
                    <Tv className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span className="truncate">Keynote Speech</span>
                  </button>
                </div>
              </div>

              {/* Primary Action Button (If Audio is loaded) */}
              {activeJob && (
                <button
                  type="button"
                  onClick={async () => {
                    await onAutoTranscribe();
                    setStepOverride(2);
                  }}
                  disabled={isTranscribing}
                  className="flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white text-sm sm:text-base font-bold shadow-lg shadow-indigo-600/30 disabled:opacity-50 transition-all active:scale-95 cursor-pointer"
                >
                  {isTranscribing ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <Languages className="w-4 h-4 text-white" />
                  )}
                  <span>
                    {isTranscribing
                      ? `Transcribing & Translating to ${targetLanguage}...`
                      : `Transcribe & Translate to ${targetLanguage} ➔`}
                  </span>
                </button>
              )}

              {/* Live pipeline stage: upload, transcription, SRT, translation */}
              {isTranscribing && pipelineStatus && (
                <div
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-950/80 border border-indigo-800/60 text-xs text-indigo-200 font-mono"
                  role="status"
                  aria-live="polite"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse shrink-0" />
                  <span className="truncate">{pipelineStatus}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 2: PRO REVIEW & TRANSLATION POLISH */}
      {/* ========================================================================= */}
      {activeStep === 2 && activeJob && (
        <div className="space-y-3.5 animate-in fade-in zoom-in-95 duration-200">
          {/* Top Review Header Card */}
          <div className="bg-slate-900/90 border border-slate-800 p-3.5 rounded-2xl flex flex-wrap items-center justify-between gap-3 shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white font-display">
                  Step 2: Pro Review & Translation Polish ({targetLanguage})
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 border border-indigo-700/60 text-indigo-400 font-semibold">
                  Pro Studio Mode
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-400">
                  {segments.length} Cues Ready
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Verify translation accuracy and speech pacing before synthesis. Choose your preferred review layout below.
              </p>
            </div>

            {/* Action to proceed to Dub, Export Target Script, Subtitles & Language Selector */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Translation Custom Prompt Trigger */}
              <button
                type="button"
                onClick={() => {
                  if (onOpenPromptModal) onOpenPromptModal();
                  else setIsLocalPromptModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/80 text-indigo-300 hover:text-white text-xs font-semibold shadow-xs transition-all active:scale-95 cursor-pointer"
                title="Change translation prompt, persona tone, or domain terminology"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                <span>Custom Prompt: {getPresetById(promptPresetId || 'conversational').name}</span>
              </button>

              {/* Quick Re-Translate with current prompt */}
              {onRetranslateSegments && (
                <button
                  type="button"
                  onClick={() => onRetranslateSegments(customPrompt || '')}
                  disabled={isTranslatingLanguage || segments.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-700/80 hover:border-indigo-500/60 text-slate-200 hover:text-indigo-200 text-xs font-semibold shadow-xs transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  title="Re-translate all dialogue cues using the current custom prompt"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 ${isTranslatingLanguage ? 'animate-spin' : ''}`} />
                  <span>{isTranslatingLanguage ? 'Translating...' : 'Re-Translate'}</span>
                </button>
              )}

              {/* Custom Script Paste & Alignment Trigger */}
              <button
                type="button"
                onClick={() => setIsAlignModalOpen(true)}
                disabled={segments.length === 0}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 border border-indigo-400/40 text-indigo-50 text-xs font-bold shadow-md shadow-indigo-600/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                title="Paste a custom translated script and align it to English timing cues"
              >
                <ClipboardPaste className="w-3.5 h-3.5 text-indigo-200" />
                <span>Paste Custom Script & Align</span>
              </button>

              {/* Export Subtitles (.SRT / .VTT) Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsSrtMenuOpen(!isSrtMenuOpen);
                    setIsExportMenuOpen(false);
                  }}
                  disabled={segments.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-700/80 hover:border-indigo-500/60 text-slate-200 hover:text-indigo-200 text-xs font-semibold shadow-xs transition-all active:scale-95 disabled:opacity-50"
                  title="Export synchronized subtitles (.SRT, .VTT) with custom constraints"
                >
                  <FileText className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Export .SRT ({srtOptions.maxLinesPerCue}L, {srtOptions.maxWordsPerLine}W)</span>
                  <ChevronDown
                    className={`w-3 h-3 text-slate-400 transition-transform ${
                      isSrtMenuOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Subtitles Dropdown */}
                {isSrtMenuOpen && (
                  <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-slate-900 border border-slate-700/90 shadow-2xl z-50 p-2 space-y-1 animate-in fade-in zoom-in-95 backdrop-blur-xl">
                    <div className="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400 border-b border-slate-800 flex items-center justify-between">
                      <span>Subtitle Export Options</span>
                      <span className="text-indigo-400 font-bold">
                        {srtOptions.maxLinesPerCue} Line • {srtOptions.maxWordsPerLine} Words
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleExportSrtWithSettings()}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors"
                    >
                      <Download className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div>
                        <p className="font-semibold">Download .SRT Subtitles</p>
                        <p className="text-[10px] text-slate-400">
                          {srtOptions.maxLinesPerCue} line per cue, max {srtOptions.maxWordsPerLine} words/line
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportVttWithSettings()}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors"
                    >
                      <FileText className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div>
                        <p className="font-semibold">Download WebVTT (.VTT)</p>
                        <p className="text-[10px] text-slate-400">Web video player subtitle format</p>
                      </div>
                    </button>

                    <div className="pt-1 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSrtMenuOpen(false);
                          setIsSrtModalOpen(true);
                        }}
                        className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-indigo-300 hover:bg-indigo-950/80 hover:text-white flex items-center gap-2.5 transition-colors font-semibold"
                      >
                        <Sliders className="w-4 h-4 text-indigo-400 shrink-0" />
                        <div>
                          <p>Customize SRT Settings...</p>
                          <p className="text-[10px] text-indigo-300/70 font-normal">
                            Max words, lines, chars, sec & live preview
                          </p>
                        </div>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Export Targeted Language Script Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setIsExportMenuOpen(!isExportMenuOpen);
                    setIsSrtMenuOpen(false);
                  }}
                  disabled={segments.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700/80 hover:border-indigo-500/60 text-slate-200 hover:text-white text-xs font-semibold shadow-xs transition-all active:scale-95 disabled:opacity-50"
                  title="Export translated script in multiple formats (.txt, .json, .csv)"
                >
                  <FileText className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Export {targetLanguage} Script</span>
                  <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isExportMenuOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
                {isExportMenuOpen && (
                  <div className="absolute right-0 mt-2 w-64 rounded-2xl bg-slate-900 border border-slate-700/90 shadow-2xl z-50 p-2 space-y-1 animate-in fade-in zoom-in-95 backdrop-blur-xl">
                    <div className="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-400 border-b border-slate-800 flex items-center justify-between">
                      <span>Export {targetLanguage} Script</span>
                      <span className="text-cyan-400 font-bold">{segments.length} Cues</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleExportTargetScript('dialogue')}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors"
                    >
                      <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div>
                        <p className="font-semibold">Plain Dialogue (.TXT)</p>
                        <p className="text-[10px] text-slate-400">Pure clean reading dialogue text</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportTargetScript('timecoded')}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors"
                    >
                      <Clock className="w-4 h-4 text-cyan-400 shrink-0" />
                      <div>
                        <p className="font-semibold">Broadcast Cues (.TXT)</p>
                        <p className="text-[10px] text-slate-400">Timestamps [MM:SS] and speakers</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportTargetScript('bilingual')}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors"
                    >
                      <Languages className="w-4 h-4 text-indigo-400 shrink-0" />
                      <div>
                        <p className="font-semibold">Bilingual Script (.TXT)</p>
                        <p className="text-[10px] text-slate-400">Original & target side-by-side</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportTargetScript('csv')}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors"
                    >
                      <Table className="w-4 h-4 text-amber-400 shrink-0" />
                      <div>
                        <p className="font-semibold">Spreadsheet Cue Sheet (.CSV)</p>
                        <p className="text-[10px] text-slate-400">Excel / Google Sheets compatible</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleExportTargetScript('json')}
                      className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-slate-200 hover:bg-slate-800 hover:text-white flex items-center gap-2.5 transition-colors"
                    >
                      <Download className="w-4 h-4 text-purple-400 shrink-0" />
                      <div>
                        <p className="font-semibold">Structured Data (.JSON)</p>
                        <p className="text-[10px] text-slate-400">Raw cue metadata & timings</p>
                      </div>
                    </button>

                    <div className="pt-1 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={handleCopyFullTargetScript}
                        className="w-full text-left px-2.5 py-2 rounded-xl text-xs text-indigo-300 hover:bg-indigo-950/80 hover:text-white flex items-center gap-2.5 transition-colors font-semibold"
                      >
                        <Copy className="w-4 h-4 text-indigo-400 shrink-0" />
                        <span>Copy Script to Clipboard</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs">
                <Globe className="w-3.5 h-3.5 text-indigo-400 mr-1.5" />
                <select
                  id="express-step2-lang-select"
                  value={targetLanguage}
                  onChange={(e) => onTargetLanguageChange(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-white focus:outline-none cursor-pointer"
                >
                  {languages.map((lang) => {
                    const code = typeof lang === 'string' ? lang : lang.code;
                    const label = typeof lang === 'string' ? lang : lang.label;
                    return (
                      <option key={code} value={code} className="bg-slate-900 text-white">
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              <button
                type="button"
                onClick={async () => {
                  setStepOverride(3);
                  await onSynthesizeMaster();
                }}
                disabled={isSynthesizing || activeJob.segments.length === 0}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white text-xs font-bold shadow-lg shadow-indigo-600/30 disabled:opacity-50 transition-all active:scale-95"
              >
                {isSynthesizing ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Volume2 className="w-4 h-4 text-white" />
                )}
                <span>
                  {isSynthesizing
                    ? 'Dubbing with ElevenLabs...'
                    : `Dub with ElevenLabs ➔`}
                </span>
              </button>
            </div>
          </div>

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

          {/* Pro Review Options Ribbon (Review Mode Selector, Search, and Pacing Filter) */}
          <div className="bg-slate-900/60 border border-slate-800/80 p-2.5 rounded-2xl flex flex-wrap items-center justify-between gap-2.5 shadow-sm">
            {/* Review Mode Selector (Studio Cards, Cue Table, Spotlight Line, Continuous Script) */}
            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setReviewMode('grid')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  reviewMode === 'grid'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
                title="Studio Cards: Side-by-side dialogue cards with timing & pacing controls"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Studio Cards</span>
              </button>

              <button
                type="button"
                onClick={() => setReviewMode('table')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  reviewMode === 'table'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
                title="Cue Sheet: Dense broadcast table for fast scanning and timing comparison"
              >
                <Table className="w-3.5 h-3.5" />
                <span>Cue Sheet Table</span>
              </button>

              <button
                type="button"
                onClick={() => setReviewMode('spotlight')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  reviewMode === 'spotlight'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
                title="Spotlight: Focus on one sentence at a time with large teleprompter typography"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Spotlight Line</span>
              </button>

              <button
                type="button"
                onClick={() => setReviewMode('script')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  reviewMode === 'script'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
                title="Continuous Script: Full side-by-side script flow for checking narrative tone"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Continuous Script</span>
              </button>

              <button
                type="button"
                onClick={() => setReviewMode('qa')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  reviewMode === 'qa'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
                title="QA & Sign-off: automated checks, locked terminology, and the approval chain"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>QA &amp; Sign-off</span>
                {qaBlockingCount > 0 ? (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-md bg-rose-600 text-white text-[10px] font-bold leading-none">
                    {qaBlockingCount}
                  </span>
                ) : qaReport.warningCount > 0 ? (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-md bg-amber-500 text-slate-950 text-[10px] font-bold leading-none">
                    {qaReport.warningCount}
                  </span>
                ) : (
                  <Check className="w-3 h-3 text-emerald-400" />
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsAlignModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-300 hover:text-white bg-indigo-950/60 hover:bg-indigo-900/80 border border-indigo-700/60 transition-all ml-1 cursor-pointer"
                title="Paste a custom translated script and align it to English timing cues"
              >
                <ClipboardPaste className="w-3.5 h-3.5 text-indigo-400" />
                <span>Paste Custom Script...</span>
              </button>

              {onOpenVoiceChanger && (
                <button
                  type="button"
                  onClick={onOpenVoiceChanger}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-purple-300 hover:text-white bg-purple-950/60 hover:bg-purple-900/80 border border-purple-700/60 transition-all cursor-pointer shadow-xs active:scale-95"
                  title="Change voice from audio using Speech-to-Speech (STS), Voice Cloning, or Audio Filters"
                >
                  <AudioWaveform className="w-3.5 h-3.5 text-purple-400" />
                  <span>Voice Changer</span>
                </button>
              )}
            </div>

            {/* Right Tools: Search Filter & Pacing Health Filters */}
            {/* The cockpit does its own filtering, so these would only confuse. */}
            <div
              className={`flex items-center gap-2 flex-wrap ${reviewMode === 'qa' ? 'hidden' : ''}`}
            >
              {/* Search Box */}
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search dialogue or speaker..."
                  className="bg-slate-950 border border-slate-800 text-xs rounded-xl pl-8 pr-3 py-1.5 text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-44 sm:w-52"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 text-slate-500 hover:text-slate-300 text-xs font-bold"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Pacing Filter Pills */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                <button
                  onClick={() => setPacingFilter('all')}
                  className={`px-2 py-1 rounded-lg font-medium transition-all ${
                    pacingFilter === 'all'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  All ({segments.length})
                </button>
                <button
                  onClick={() => setPacingFilter('risk')}
                  className={`px-2 py-1 rounded-lg font-medium flex items-center gap-1 transition-all ${
                    pacingFilter === 'risk'
                      ? 'bg-amber-900/60 text-amber-200 border border-amber-700/60'
                      : 'text-slate-400 hover:text-amber-300'
                  }`}
                  title="Cues where translation exceeds 18 chars/second"
                >
                  {riskCuesCount > 0 && <AlertTriangle className="w-3 h-3 text-amber-400" />}
                  <span>Fast Pacing ({riskCuesCount})</span>
                </button>
                <button
                  onClick={() => setPacingFilter('safe')}
                  className={`px-2 py-1 rounded-lg font-medium transition-all ${
                    pacingFilter === 'safe'
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                      : 'text-slate-400 hover:text-emerald-300'
                  }`}
                >
                  Optimal
                </button>
              </div>

              {/* Pause Sensitivity Slider (Compact Toolbar) */}
              {onSensitivityChange && (
                <PauseSensitivityControl
                  variant="compact"
                  sensitivity={analysisSensitivity}
                  onChange={onSensitivityChange}
                  segmentCount={segments.length}
                />
              )}

              {/* Scroll & View Depth Helpers */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                <button
                  type="button"
                  onClick={scrollToTop}
                  className="px-2 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 flex items-center gap-1 font-medium transition-all"
                  title="Jump to first cue line"
                >
                  <ChevronsUp className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Top</span>
                </button>
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className="px-2 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-900 flex items-center gap-1 font-medium transition-all"
                  title="Jump to bottom cue line"
                >
                  <ChevronsDown className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Bottom</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsListExpanded(!isListExpanded)}
                  className={`px-2 py-1 rounded-lg font-medium transition-all ${
                    isListExpanded
                      ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/50'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900'
                  }`}
                  title="Toggle between scrollable viewport and full-page expanded view"
                >
                  {isListExpanded ? 'Compact View' : 'Expand All'}
                </button>

                {/* On-Screen Phonetic Keyboard Launcher */}
                {onOpenPhoneticKeyboard && (
                  <button
                    type="button"
                    onClick={() => onOpenPhoneticKeyboard()}
                    className="px-2.5 py-1 rounded-lg bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-800/80 text-indigo-300 hover:text-white flex items-center gap-1.5 font-medium transition-all shadow-xs"
                    title="Open Virtual Indic Phonetic Keyboard"
                  >
                    <Keyboard className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Indic Keyboard</span>
                  </button>
                )}
              </div>
            </div>
          </div>

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
            <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-2">
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
                ref={scriptScrollRef}
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
          {/* OPTION 2: CUE SHEET TABLE (Broadcast Pro Table) */}
          {/* ========================================================================= */}
          {reviewMode === 'table' && filteredSegments.length > 0 && (
            <div className="space-y-4">
              {renderPaginationControls()}
              
              <div className="border border-slate-800 rounded-2xl bg-slate-900/60 overflow-hidden shadow-sm">
                <div
                  ref={scriptScrollRef}
                  className={`scroll-smooth custom-scrollbar ${
                    isListExpanded
                      ? 'overflow-visible pb-12'
                      : 'max-h-[65vh] min-h-[360px] overflow-y-auto overscroll-contain pb-8'
                  }`}
                >
                  <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-950/90 text-slate-400 border-b border-slate-800 uppercase font-mono text-[10px] sticky top-0 z-10 backdrop-blur-sm">
                    <tr>
                      <th className="py-2.5 px-3 w-12 text-center">#</th>
                      <th className="py-2.5 px-3 w-28">Time In - Out</th>
                      <th className="py-2.5 px-2 w-16">Speaker</th>
                      <th className="py-2.5 px-3 w-5/12">Original Dialogue</th>
                      <th className="py-2.5 px-3 w-5/12 text-indigo-300">{targetLanguage} Translation (Editable)</th>
                      <th className="py-2.5 px-2 w-24 text-center">Pacing</th>
                      <th className="py-2.5 px-3 w-20 text-right">Audition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {paginatedSegments.map((seg, index) => {
                      const srcText = getSourceText(seg);
                      const tgtText = getTargetText(seg);
                      const isCuePlaying = playingSegmentId === seg.id;
                      const isCueActive =
                        (currentTime >= seg.startTime && currentTime <= seg.endTime) || isCuePlaying;
                      const charCount = tgtText.length;
                      const cpsInfo = getCpsInfo(charCount, seg.duration);

                      return (
                        <tr
                          key={seg.id}
                          id={`cue-row-${seg.id}`}
                          className={`transition-colors group ${
                            isCueActive
                              ? 'bg-indigo-950/40 text-white font-medium border-l-2 border-indigo-500'
                              : 'hover:bg-slate-800/40'
                          }`}
                        >
                          {/* Index */}
                          <td className="py-2.5 px-3 font-mono text-center text-slate-400 font-bold">
                            {(currentPage - 1) * itemsPerPage + index + 1}
                          </td>

                        {/* Timecode */}
                        <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                          <span className="text-cyan-400 font-semibold text-[11px]">
                            {formatSeconds(seg.startTime)} - {formatSeconds(seg.endTime)}
                          </span>
                          <span className="block text-[10px] text-slate-500">
                            {seg.duration.toFixed(1)}s
                          </span>
                        </td>

                        {/* Speaker */}
                        <td className="py-2.5 px-2">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-transparent text-[10px] font-semibold whitespace-nowrap">
                            {seg.speaker || 'Speaker'}
                          </span>
                        </td>

                        {/* Original Dialogue */}
                        <td className="py-2.5 px-3 text-slate-300 leading-relaxed font-sans">
                          {srcText || <span className="text-slate-600 italic">No audio text</span>}
                        </td>

                        {/* Editable Target Translation with Phonetic Transliteration */}
                        <td className="py-2.5 px-3">
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
                            placeholder={`Translation in ${targetLanguage}...`}
                          />
                          <div className="flex justify-between items-center text-[10px] text-slate-500 mt-0.5">
                            <span>{charCount} chars</span>
                            <span className="font-mono">{cpsInfo.cps} CPS</span>
                          </div>
                        </td>

                        {/* Pacing Badge */}
                        <td className="py-2.5 px-2 text-center">
                          <span className={`inline-block text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap ${cpsInfo.badgeClass}`}>
                            {cpsInfo.cps} CPS
                          </span>
                        </td>

                        {/* Audition Button */}
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setPlayingSegmentId(seg.id);
                              onPlaySegmentSolo(seg);
                              setTimeout(() => setPlayingSegmentId(null), seg.duration * 1000 + 500);
                            }}
                            className={`p-1.5 rounded-lg border transition-all ${
                              isCuePlaying
                                ? 'bg-amber-600 text-white border-amber-500 animate-pulse'
                                : 'bg-slate-800 text-slate-300 hover:text-white border-slate-700'
                            }`}
                            title="Audition original speech line"
                          >
                            {isCuePlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              </div>
              
              {renderPaginationControls()}
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
                  ref={scriptScrollRef}
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
                            onClick={handleCopyFullTargetScript}
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

          {/*
            Step footer rather than a card of its own: the negative margin closes
            the gap so it reads as the end of the panel above, while staying
            pinned to the bottom of the viewport as the cue list scrolls.
          */}
          <div className="sticky bottom-0 z-30 -mt-3.5 p-3 sm:p-3.5 rounded-b-2xl bg-slate-900/95 border border-t-0 border-slate-800 shadow-lg backdrop-blur-md flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={() => setStepOverride(1)}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all font-medium"
            >
              ← Back to Audio & Language
            </button>

            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-xs text-slate-400 font-mono">
                {filteredSegments.length} of {segments.length} cues reviewed
              </span>

              {/*
                A dub can still be run with issues outstanding — that is the
                reviewer's call — but not without being told they are there.
              */}
              <button
                type="button"
                onClick={() => setReviewMode('qa')}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
                  qaBlockingCount > 0
                    ? 'bg-rose-950/60 hover:bg-rose-900/60 border-rose-800/70 text-rose-200'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                }`}
                title="Open the QA & sign-off cockpit"
              >
                <ShieldCheck
                  className={`w-3.5 h-3.5 ${
                    qaBlockingCount > 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                />
                <span>
                  {qaBlockingCount > 0
                    ? `${qaBlockingCount} blocking ${
                        qaBlockingCount === 1 ? 'issue' : 'issues'
                      }`
                    : 'QA clear'}
                </span>
              </button>

              {/* Export Script Quick Action Button */}
              <button
                type="button"
                onClick={() => handleExportTargetScript('dialogue')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold transition-all active:scale-95 shadow-xs"
                title={`Export ${targetLanguage} script as .TXT`}
              >
                <FileText className="w-3.5 h-3.5 text-cyan-400" />
                <span>Export {targetLanguage} Script (.TXT)</span>
              </button>

              {/* Scroll to Top shortcut */}
              <button
                type="button"
                onClick={() => {
                  scrollToTop();
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 text-xs transition-all flex items-center gap-1"
                title="Scroll back to top of script cues"
              >
                <ChevronsUp className="w-4 h-4" />
                <span className="text-[11px] hidden sm:inline">Top</span>
              </button>

              {/* Primary Next Action: Finalize Script & Dub */}
              <button
                type="button"
                onClick={async () => {
                  setStepOverride(3);
                  if (!activeJob.synthesizedAudioUrl && !isSynthesizing) {
                    await onSynthesizeMaster();
                  }
                }}
                disabled={activeJob.segments.length === 0 || isSynthesizing}
                className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-600 via-indigo-600 to-cyan-500 hover:from-emerald-500 hover:to-cyan-400 text-white text-xs sm:text-sm font-bold shadow-xl shadow-emerald-600/30 disabled:opacity-50 transition-all active:scale-95 cursor-pointer"
              >
                {isSynthesizing ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <AudioWaveform className="w-4 h-4 text-emerald-300" />
                )}
                <span>
                  {isSynthesizing
                    ? 'Dubbing with ElevenLabs...'
                    : 'Finalize & Dub with ElevenLabs (Step 3) ➔'}
                </span>
              </button>

              {/*
                Forcing a fresh dub only differs from the button above once a dub
                exists, which is the only time it is worth a button of its own.
              */}
              {activeJob.synthesizedAudioUrl && (
                <button
                  type="button"
                  onClick={async () => {
                    setStepOverride(3);
                    await onSynthesizeMaster();
                  }}
                  disabled={isSynthesizing || activeJob.segments.length === 0}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold shadow-xs disabled:opacity-50 transition-all active:scale-95 cursor-pointer"
                  title="Discard the existing dub and synthesize it again from the current script"
                >
                  {isSynthesizing ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                  )}
                  <span>{isSynthesizing ? 'Dubbing...' : 'Re-dub'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 3: FINAL SCRIPT & DUBBED AUDIO MASTER */}
      {/* ========================================================================= */}
      {activeStep === 3 && activeJob && (
        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
          {/* Final Script Viewer & Exporter */}
          <FinalScriptViewer
            segments={segments}
            targetLanguage={targetLanguage}
            onUpdateSegment={onUpdateSegment}
            onOpenPromptModal={() => {
              if (onOpenPromptModal) onOpenPromptModal();
              else setIsLocalPromptModalOpen(true);
            }}
            promptPresetName={getPresetById(promptPresetId || 'conversational').name}
          />

          {!activeJob.synthesizedAudioUrl ? (
            <div className="bg-gradient-to-r from-emerald-950/90 via-slate-900 to-indigo-950/90 border border-emerald-500/40 p-5 sm:p-6 rounded-3xl space-y-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
                    <Volume2 className="w-6 h-6 text-emerald-400" />
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-white font-display flex items-center gap-2">
                      <span>Dub Final Script with ElevenLabs</span>
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2.5 py-0.5 rounded-full border border-emerald-500/30 font-mono font-bold uppercase">
                        11 Labs AI
                      </span>
                    </h2>
                    <p className="text-xs text-slate-300 mt-1">
                      Generate ultra-realistic human audio in <span className="text-emerald-400 font-semibold">{targetLanguage}</span> using ElevenLabs AI voice synthesis models.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={onSynthesizeMaster}
                  disabled={isSynthesizing}
                  className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm shadow-xl shadow-emerald-600/40 disabled:opacity-50 transition-all active:scale-95 cursor-pointer ring-1 ring-emerald-400/50"
                >
                  {isSynthesizing ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <AudioWaveform className="w-4 h-4 text-emerald-200" />
                  )}
                  <span>
                    {isSynthesizing
                      ? 'Generating Audio in ElevenLabs...'
                      : 'Start Dubbing Now (ElevenLabs) ➔'}
                  </span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-3xl space-y-4 shadow-xl">
              {/* Success Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-white font-display">
                      Step 3: Dubbed Audio Master Ready ({targetLanguage})
                    </h2>
                    <p className="text-xs text-slate-400">
                      Speech generated with ElevenLabs v3 Multilingual. Natural pauses and prosody aligned to original audio.
                    </p>
                  </div>
                </div>

                {/* Redo Synthesis button */}
                <button
                  type="button"
                  onClick={onSynthesizeMaster}
                  disabled={isSynthesizing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSynthesizing ? 'animate-spin' : ''}`} />
                  <span>Re-Dub Audio</span>
                </button>
              </div>

            {/* A/B Track Audition Switcher */}
            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/80 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                  <Headphones className="w-3.5 h-3.5 text-indigo-400" />
                  <span>A/B Comparison Audition:</span>
                </span>

                {/* Track Mode Selector */}
                <div className="flex items-center bg-slate-900 p-1 rounded-xl border border-slate-800 gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => onTrackModeChange('synth')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all ${
                      trackMode === 'synth'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-400 hover:text-indigo-200'
                    }`}
                  >
                    Dubbed Master Only
                  </button>

                  <button
                    type="button"
                    onClick={() => onTrackModeChange('source')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all ${
                      trackMode === 'source'
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-indigo-200'
                    }`}
                  >
                    Original Audio Only
                  </button>

                  <button
                    type="button"
                    onClick={() => onTrackModeChange('both')}
                    className={`px-3 py-1 rounded-lg font-bold transition-all ${
                      trackMode === 'both'
                        ? 'bg-cyan-600 text-white shadow'
                        : 'text-slate-400 hover:text-indigo-200'
                    }`}
                  >
                    Simultaneous Mix (A+B)
                  </button>
                </div>
              </div>

              {/* Master Playback Scrub bar */}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={onTogglePlay}
                  className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-cyan-500 hover:scale-105 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 transition-all active:scale-95 shrink-0"
                >
                  {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
                </button>

                <div className="flex-1 space-y-1">
                  <div className="flex justify-between text-[11px] font-mono text-slate-400">
                    <span className="text-cyan-400 font-bold">{formatSeconds(currentTime)}</span>
                    <span>{formatSeconds(duration || 0)}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.05}
                    value={currentTime}
                    onChange={(e) => onSeek(parseFloat(e.target.value))}
                    className="w-full accent-cyan-400 h-2 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* Download Master Outputs Section (4-Column Layout: Audio, Subtitles, Target Script, Voice Changer) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              {/* Card 1: WAV Master Download */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col justify-between gap-3 shadow-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <Music className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-sm font-bold text-white">Lossless WAV Audio</h3>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Uncompressed broadcast-grade dubbed master with speech timing & pauses.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onDownloadWav}
                  className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Master WAV</span>
                </button>
              </div>

              {/* Card 2: Subtitles & Captions Download */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col justify-between gap-3 shadow-sm">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-cyan-400" />
                      <h3 className="text-sm font-bold text-white">Subtitles ({targetLanguage})</h3>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-950 border border-indigo-800 text-indigo-300 font-semibold">
                      {srtOptions.maxLinesPerCue}L • {srtOptions.maxWordsPerLine}W
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Synchronized .SRT captions ({srtOptions.maxLinesPerCue} line, max {srtOptions.maxWordsPerLine} words/line).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => handleExportSrtWithSettings()}
                    className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download .SRT Subtitles</span>
                  </button>

                  <div className="grid grid-cols-2 gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() => setIsSrtModalOpen(true)}
                      className="py-1 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-indigo-300 hover:text-indigo-200 font-semibold transition-colors text-center flex items-center justify-center gap-1"
                      title="Customize max characters, seconds, words, lines & live preview"
                    >
                      <Sliders className="w-3 h-3 text-indigo-400" />
                      <span>Settings</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportVttWithSettings()}
                      className="py-1 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-indigo-200 font-mono transition-colors text-center"
                      title="Download WebVTT format"
                    >
                      .VTT Format
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 3: Target Language Script Export */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex flex-col justify-between gap-3 shadow-sm">
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Languages className="w-4 h-4 text-purple-400" />
                      <h3 className="text-sm font-bold text-white">Target Script</h3>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-950 border border-purple-800 text-purple-300 font-semibold">
                      {segments.length} Cues
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Dialogue script in {targetLanguage} for voice artists, teleprompter, or records.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => handleExportTargetScript('dialogue')}
                    className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Script (.TXT)</span>
                  </button>

                  <div className="grid grid-cols-3 gap-1 text-[10px]">
                    <button
                      type="button"
                      onClick={() => handleExportTargetScript('timecoded')}
                      className="py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-indigo-200 font-mono transition-colors text-center"
                      title="Export timestamped cues"
                    >
                      Cues
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportTargetScript('csv')}
                      className="py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-indigo-200 font-mono transition-colors text-center"
                      title="Export CSV spreadsheet"
                    >
                      CSV
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExportTargetScript('json')}
                      className="py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-indigo-200 font-mono transition-colors text-center"
                      title="Export JSON"
                    >
                      JSON
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 4: AI Voice Changer from Audio (Speech-to-Speech) */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-purple-900/50 flex flex-col justify-between gap-3 shadow-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <AudioWaveform className="w-4 h-4 text-purple-400" />
                    <h3 className="text-sm font-bold text-white">Voice Changer</h3>
                  </div>
                  <p className="text-xs text-purple-300/80 mt-1">
                    Convert voice timbre & identity from audio with Speech-to-Speech or Voice Clone.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (onOpenVoiceChanger) onOpenVoiceChanger();
                    }}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 cursor-pointer"
                  >
                    <AudioWaveform className="w-3.5 h-3.5" />
                    <span>Change Voice (STS)</span>
                  </button>
                  <p className="text-[10px] text-center text-slate-500">
                    ElevenLabs STS • Audio Cloning
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setStepOverride(2)}
                className="text-xs text-slate-400 hover:text-indigo-200 flex items-center gap-1"
              >
                ← Back to Review & Edit Script
              </button>

              {onResetSession && (
                <button
                  type="button"
                  onClick={onResetSession}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-indigo-200 border border-slate-700 text-xs font-semibold transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Dub Another Audio</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    )}

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
