import React, { useState, useMemo, useEffect } from 'react';
import {
  X,
  FileText,
  Sliders,
  Download,
  Copy,
  Check,
  RotateCcw,
  Layers,
  Clock,
  Type,
  AlignLeft,
  Settings,
  HelpCircle,
} from 'lucide-react';
import { AudioSegment } from '../types';
import {
  SrtOptions,
  DEFAULT_SRT_OPTIONS,
  SRT_PRESETS,
  generateSrtContent,
  generateVttContent,
  downloadFile,
  SubtitleCasing,
  adjustSegmentsForDubbedTimeline,
} from '../services/srtService';

interface SrtExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  segments: AudioSegment[];
  targetLanguage: string;
  /** Source language ElevenLabs transcribed, used to label the original track. */
  sourceLanguage?: string;
  initialOptions?: SrtOptions;
  onOptionsChange?: (options: SrtOptions) => void;
  synthAudioDuration?: number;
  hasSynthAudio?: boolean;
}

export const SrtExportModal: React.FC<SrtExportModalProps> = ({
  isOpen,
  onClose,
  segments,
  targetLanguage,
  sourceLanguage = '',
  initialOptions,
  onOptionsChange,
  synthAudioDuration = 0,
  hasSynthAudio = false,
}) => {
  const [options, setOptions] = useState<SrtOptions>(() => {
    try {
      const saved = localStorage.getItem('dhvani_srt_options');
      if (saved) return JSON.parse(saved);
    } catch {}
    return initialOptions || DEFAULT_SRT_OPTIONS;
  });

  const [activePresetId, setActivePresetId] = useState<string>('shorts_viral');
  const [copied, setCopied] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'srt' | 'vtt'>('srt');
  const [syncMode, setSyncMode] = useState<'dubbed' | 'original'>('original');

  /**
   * Which language track to export. Both share the same ElevenLabs timestamps;
   * only the text differs.
   */
  const [scriptTrack, setScriptTrack] = useState<'target' | 'source'>('target');

  // Automatically default to dubbed mode if synthetic audio exists
  useEffect(() => {
    if (isOpen) {
      setSyncMode(hasSynthAudio ? 'dubbed' : 'original');
    }
  }, [hasSynthAudio, isOpen]);

  // Sync state if initialOptions changes
  useEffect(() => {
    if (initialOptions) {
      setOptions(initialOptions);
    }
  }, [initialOptions]);

  // Save to localStorage & notify parent
  const handleUpdateOptions = (newOptions: SrtOptions, presetId: string = 'custom') => {
    setOptions(newOptions);
    setActivePresetId(presetId);
    try {
      localStorage.setItem('dhvani_srt_options', JSON.stringify(newOptions));
    } catch {}
    if (onOptionsChange) {
      onOptionsChange(newOptions);
    }
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = SRT_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      handleUpdateOptions({ ...preset.options }, preset.id);
    }
  };

  const handleResetDefaults = () => {
    handleUpdateOptions({ ...DEFAULT_SRT_OPTIONS }, 'shorts_viral');
  };

  /*
   * Pick the language track first. Exporting the source track keeps each
   * segment's ElevenLabs word timings aligned with its text, which lets
   * generateSrtContent cut cues on exact measured word boundaries.
   */
  const trackSegments = useMemo(() => {
    if (scriptTrack === 'target') return segments;
    return segments.map((segment) => ({
      ...segment,
      textTarget: segment.textSource || '',
      targetText: segment.textSource || '',
    }));
  }, [segments, scriptTrack]);

  // Align segments to the continuous dubbed audio timeline if selected
  const processedSegments = useMemo(() => {
    if (syncMode === 'dubbed' && hasSynthAudio && synthAudioDuration > 0) {
      return adjustSegmentsForDubbedTimeline(trackSegments, synthAudioDuration, options);
    }
    return trackSegments;
  }, [trackSegments, syncMode, hasSynthAudio, synthAudioDuration, options]);

  /** True when every exported cue boundary is a measured ElevenLabs word. */
  const hasExactTimings = useMemo(
    () =>
      syncMode !== 'dubbed' &&
      scriptTrack === 'source' &&
      segments.some((segment) => (segment.words?.length ?? 0) > 0),
    [segments, syncMode, scriptTrack]
  );

  // Generate real-time preview content
  const previewSrt = useMemo(() => {
    if (!processedSegments || processedSegments.length === 0) return '';
    return generateSrtContent(processedSegments, options);
  }, [processedSegments, options]);

  const previewVtt = useMemo(() => {
    if (!processedSegments || processedSegments.length === 0) return '';
    return generateVttContent(processedSegments, options);
  }, [processedSegments, options]);


  const activePreviewText = activeTab === 'srt' ? previewSrt : previewVtt;

  // Compute live statistics
  const previewStats = useMemo(() => {
    if (!previewSrt) return { cueCount: 0, totalWords: 0, avgWordsPerCue: 0 };
    const cues = previewSrt.split(/\n\n+/).filter(Boolean);
    const cueCount = cues.length;
    let totalWords = 0;
    cues.forEach((cue) => {
      const lines = cue.split('\n').slice(2); // Skip index & timestamps
      const words = lines.join(' ').split(/\s+/).filter(Boolean);
      totalWords += words.length;
    });
    const avgWordsPerCue = cueCount > 0 ? (totalWords / cueCount).toFixed(1) : '0';
    return { cueCount, totalWords, avgWordsPerCue };
  }, [previewSrt]);

  const handleCopy = () => {
    if (!activePreviewText) return;
    try {
      navigator.clipboard.writeText(activePreviewText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Copy failed', e);
    }
  };

  /** Names the file after the track actually being exported. */
  const exportLabel = useMemo(() => {
    const base = scriptTrack === 'source' ? sourceLanguage || 'original' : targetLanguage || 'captions';
    return base.toLowerCase().replace(/\s+/g, '_');
  }, [scriptTrack, sourceLanguage, targetLanguage]);

  const handleDownloadSrt = () => {
    if (!previewSrt) return;
    downloadFile(previewSrt, `dhvani_${exportLabel}_subtitles.srt`, 'text/srt;charset=utf-8');
    onClose();
  };

  const handleDownloadVtt = () => {
    if (!previewVtt) return;
    downloadFile(previewVtt, `dhvani_${exportLabel}_subtitles.vtt`, 'text/vtt;charset=utf-8');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-3xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-950 border border-indigo-700/60 text-indigo-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Custom Subtitle (.SRT) Export Settings
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-950 border border-indigo-700 text-indigo-300 font-semibold">
                  {targetLanguage}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Configure line limits, words per cue, and duration pacing with real-time preview.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Split into Settings (Left) and Live Preview (Right) */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
          {/* Left Column: Config Controls (7 cols) */}
          <div className="lg:col-span-7 p-5 sm:p-6 space-y-6">
            {/* Presets Quick Selector */}
            <div>
              <label className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider flex items-center justify-between mb-2.5">
                <span className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" /> Format Presets
                </span>
                <span className="text-[11px] text-slate-500 font-normal lowercase">Click to auto-configure</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {SRT_PRESETS.map((preset) => {
                  const isSelected = activePresetId === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleApplyPreset(preset.id)}
                      className={`text-left p-2.5 rounded-xl border text-xs transition-all ${
                        isSelected
                          ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-sm ring-1 ring-indigo-500/50'
                          : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold flex items-center gap-1.5">
                          {preset.name}
                          {preset.id === 'shorts_viral' && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-mono">
                              Default
                            </span>
                          )}
                        </span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-indigo-400 shrink-0" />}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 line-clamp-1">{preset.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Language Track: translated vs original transcription */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 space-y-3 shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 uppercase font-mono tracking-wider flex items-center gap-1.5">
                  <Type className="w-3.5 h-3.5 text-indigo-400" /> Subtitle Language Track
                </span>
                {hasExactTimings && (
                  <span
                    className="text-[10px] font-semibold text-emerald-400 font-mono"
                    title="Every cue starts and ends on a word timestamp measured by ElevenLabs."
                  >
                    Exact ElevenLabs timings
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setScriptTrack('target')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    scriptTrack === 'target'
                      ? 'bg-indigo-950/70 border-indigo-500 text-white shadow-sm ring-1 ring-indigo-500/50'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <div className="font-bold text-xs">Translated ({targetLanguage})</div>
                  <p className="text-[9px] text-slate-400 mt-0.5 leading-relaxed">
                    Gemini translation placed on the original ElevenLabs timestamps.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setScriptTrack('source')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    scriptTrack === 'source'
                      ? 'bg-cyan-950/70 border-cyan-500 text-white shadow-sm ring-1 ring-cyan-500/50'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white'
                  }`}
                >
                  <div className="font-bold text-xs">
                    Original{sourceLanguage ? ` (${sourceLanguage})` : ' transcription'}
                  </div>
                  <p className="text-[9px] text-slate-400 mt-0.5 leading-relaxed">
                    The ElevenLabs transcript, cut on exact word timestamps.
                  </p>
                </button>
              </div>
            </div>

            {/* Audio Track Timeline Synchronization Settings */}
            {hasSynthAudio && (
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-slate-950 to-slate-950 border border-emerald-500/30 space-y-3 shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-200 uppercase font-mono tracking-wider flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Subtitle Timeline Sync
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-400 font-mono">
                    Dubbed Master Audio Active
                  </span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSyncMode('dubbed')}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      syncMode === 'dubbed'
                        ? 'bg-emerald-950/70 border-emerald-500 text-white shadow-sm ring-1 ring-emerald-500/50'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <div className="font-bold text-xs">Sync with Dubbed Audio</div>
                    <p className="text-[9px] text-slate-400 mt-0.5 leading-relaxed">
                      Aligns subtitle cues perfectly with continuous, dubbed ElevenLabs audio speech ({synthAudioDuration ? synthAudioDuration.toFixed(1) : '0.0'}s).
                    </p>
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => setSyncMode('original')}
                    className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                      syncMode === 'original'
                        ? 'bg-indigo-950/50 border-indigo-500/50 text-white shadow-sm ring-1 ring-indigo-500/30'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white'
                    }`}
                  >
                    <div className="font-bold text-xs">Sync with Original Timeline</div>
                    <p className="text-[9px] text-slate-400 mt-0.5 leading-relaxed">
                      Preserves the original video timestamps and silent gaps for burning subtitles onto the original source video.
                    </p>
                  </button>
                </div>
              </div>
            )}

            {/* Custom Tuning Parameters */}
            <div className="space-y-4 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300 uppercase font-mono tracking-wider flex items-center gap-1.5">
                  <Settings className="w-3.5 h-3.5 text-indigo-400" /> Fine-Tune Constraints
                </label>
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="text-[11px] text-slate-400 hover:text-indigo-300 flex items-center gap-1 transition-colors font-medium"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Defaults (1 line, 3 words)</span>
                </button>
              </div>

              {/* 1. Max Words Per Line (CRITICAL REQUEST) */}
              <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlignLeft className="w-4 h-4 text-cyan-400" />
                    <span className="text-xs font-bold text-slate-200">Max Words Per Line</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-mono font-bold text-cyan-400 px-2 py-0.5 rounded-lg bg-cyan-950/70 border border-cyan-800/60">
                      {options.maxWordsPerLine} {options.maxWordsPerLine === 1 ? 'word' : 'words'}
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min="1"
                  max="12"
                  step="1"
                  value={options.maxWordsPerLine}
                  onChange={(e) =>
                    handleUpdateOptions({ ...options, maxWordsPerLine: parseInt(e.target.value, 10) })
                  }
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
                <p className="text-[10px] text-slate-400">
                  Controls how many words appear on one line. Default is <strong>3 words</strong> for high-retention vertical reels.
                </p>
              </div>

              {/* 2. Max Lines Per Cue */}
              <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-slate-200">Max Lines Per Subtitle Cue</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-emerald-400">
                    {options.maxLinesPerCue} {options.maxLinesPerCue === 1 ? 'Line (Default)' : 'Lines'}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 3, 4].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => handleUpdateOptions({ ...options, maxLinesPerCue: num })}
                      className={`py-1.5 px-2 rounded-xl text-xs font-bold font-mono transition-all ${
                        options.maxLinesPerCue === num
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {num} {num === 1 ? 'Line' : 'Lines'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400">
                  Default is <strong>1 line</strong> for dynamic captions. Select 2 lines for standard movie/TV subtitles.
                </p>
              </div>

              {/* 3. Max Characters Per Line & Max Duration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Max Characters */}
                <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Type className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-xs font-bold text-slate-200">Max Characters</span>
                    </div>
                    <span className="text-xs font-mono font-bold text-purple-400">
                      {options.maxCharsPerLine} ch
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="60"
                    step="1"
                    value={options.maxCharsPerLine}
                    onChange={(e) =>
                      handleUpdateOptions({ ...options, maxCharsPerLine: parseInt(e.target.value, 10) })
                    }
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-400"
                  />
                  <p className="text-[10px] text-slate-400">Hard limit on character width per line.</p>
                </div>

                {/* Max Duration */}
                <div className="p-3 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-bold text-slate-200">Max Duration</span>
                    </div>
                    <span className="text-xs font-mono font-bold text-amber-400">
                      {options.maxDurationSeconds}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.8"
                    max="8.0"
                    step="0.2"
                    value={options.maxDurationSeconds}
                    onChange={(e) =>
                      handleUpdateOptions({ ...options, maxDurationSeconds: parseFloat(e.target.value) })
                    }
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-400"
                  />
                  <p className="text-[10px] text-slate-400">Maximum display time per cue in seconds.</p>
                </div>
              </div>

              {/* 4. Text Styling & Cleaning Options */}
              <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
                <span className="text-xs font-bold text-slate-200 block">Text Formatting & Cleanup</span>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateOptions({
                        ...options,
                        includePunctuation: !options.includePunctuation,
                      })
                    }
                    className={`p-2 rounded-xl border text-xs font-medium flex items-center justify-between transition-all ${
                      options.includePunctuation
                        ? 'bg-slate-900 border-indigo-500/80 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <span>Keep Punctuation</span>
                    <span className={`text-[10px] font-mono px-1.5 rounded ${options.includePunctuation ? 'bg-indigo-950 text-indigo-300' : 'bg-slate-800 text-slate-500'}`}>
                      {options.includePunctuation ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleUpdateOptions({
                        ...options,
                        removeSpeakerLabel: !options.removeSpeakerLabel,
                      })
                    }
                    className={`p-2 rounded-xl border text-xs font-medium flex items-center justify-between transition-all ${
                      options.removeSpeakerLabel
                        ? 'bg-slate-900 border-emerald-500/80 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <span>Strip Speaker Tags</span>
                    <span className={`text-[10px] font-mono px-1.5 rounded ${options.removeSpeakerLabel ? 'bg-emerald-950 text-emerald-300' : 'bg-slate-800 text-slate-500'}`}>
                      {options.removeSpeakerLabel ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  <div className="flex items-center bg-slate-900 border border-slate-800 rounded-xl px-2">
                    <select
                      value={options.casing || 'original'}
                      onChange={(e) =>
                        handleUpdateOptions({
                          ...options,
                          casing: e.target.value as SubtitleCasing,
                        })
                      }
                      className="w-full bg-transparent text-xs text-slate-200 font-semibold focus:outline-hidden py-2 cursor-pointer"
                    >
                      <option value="original" className="bg-slate-900 text-slate-100">
                        Case: Original
                      </option>
                      <option value="uppercase" className="bg-slate-900 text-slate-100">
                        Case: UPPERCASE
                      </option>
                      <option value="capitalize" className="bg-slate-900 text-slate-100">
                        Case: Capitalize
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Live Interactive SRT Preview (5 cols) */}
          <div className="lg:col-span-5 p-5 sm:p-6 bg-slate-950/70 flex flex-col justify-between space-y-4">
            <div>
              {/* Preview Header */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-bold text-white uppercase font-mono tracking-wider">
                    Live Subtitle Preview
                  </span>
                </div>

                {/* Tab Switcher */}
                <div className="flex items-center p-0.5 rounded-xl bg-slate-900 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => setActiveTab('srt')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono transition-all ${
                      activeTab === 'srt'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    .SRT
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('vtt')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-mono transition-all ${
                      activeTab === 'vtt'
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    .VTT
                  </button>
                </div>
              </div>

              {/* Real-time Stats Chips */}
              <div className="flex items-center gap-2 py-2 text-[10px] font-mono text-slate-400 flex-wrap">
                <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-cyan-300">
                  {previewStats.cueCount} Cues
                </span>
                <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-emerald-300">
                  {previewStats.avgWordsPerCue} avg words/cue
                </span>
                <span className="px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 text-purple-300">
                  {options.maxLinesPerCue} Line{options.maxLinesPerCue > 1 ? 's' : ''} Limit
                </span>
              </div>

              {/* Code / Text Preview Container */}
              <div className="relative mt-1">
                <pre className="p-4 rounded-2xl bg-slate-950 border border-slate-800 font-mono text-xs text-slate-300 h-72 sm:h-80 overflow-y-auto whitespace-pre-wrap select-all leading-relaxed custom-scrollbar">
                  {activePreviewText || (
                    <span className="text-slate-600 italic">No dialogue segments available for preview.</span>
                  )}
                </pre>

                {/* Floating Copy Button */}
                <button
                  type="button"
                  onClick={handleCopy}
                  className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700 text-slate-200 hover:text-white text-xs font-semibold shadow-md transition-all active:scale-95"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400 font-bold">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Download Buttons in Right Column */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={handleDownloadSrt}
                disabled={!previewSrt}
                className="w-full py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-indigo-600/20 active:scale-98 disabled:opacity-50"
              >
                <Download className="w-4 h-4" />
                <span>Download .SRT (Customized)</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadVtt}
                disabled={!previewVtt}
                className="w-full py-2.5 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all active:scale-98 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-slate-400" />
                <span>Download WebVTT (.VTT)</span>
              </button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-slate-800 bg-slate-950/60 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
            <span>Settings automatically save to your workspace preference.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
