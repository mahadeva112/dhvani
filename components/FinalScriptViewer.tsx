import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  FileText,
  Copy,
  Check,
  Download,
  Clock,
  Languages,
  Edit3,
  Sliders,
  SlidersHorizontal,
  Table,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { AudioSegment } from '../types';
import {
  generateTargetLanguageScript,
  TargetScriptFormat,
  downloadFile,
} from '../services/srtService';

interface FinalScriptViewerProps {
  segments: AudioSegment[];
  targetLanguage: string;
  sourceFileName?: string;
  promptPresetName?: string;
  onUpdateSegment?: (id: string | number, updates: Partial<AudioSegment>) => void;
  onOpenPromptModal?: () => void;
  onDownloadScript?: (format: TargetScriptFormat) => void;
  elVoiceName?: string;
}

export const FinalScriptViewer: React.FC<FinalScriptViewerProps> = ({
  segments,
  targetLanguage,
  sourceFileName,
  promptPresetName = 'Conversational',
  onUpdateSegment,
  onOpenPromptModal,
  onDownloadScript,
  elVoiceName,
}) => {
  const [formatMode, setFormatMode] = useState<TargetScriptFormat>('dialogue');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  // Long scripts (hundreds of cues) are paged like the Step 2 review list.
  const CUES_PER_PAGE = 35;
  const [currentPage, setCurrentPage] = useState<number>(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const totalPages = Math.max(1, Math.ceil(segments.length / CUES_PER_PAGE));
  const pageStart = (currentPage - 1) * CUES_PER_PAGE;
  const pageSegments = segments.slice(pageStart, pageStart + CUES_PER_PAGE);

  // Keep the page in range if cues are removed or re-segmented.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const goToPage = (page: number) => {
    setCurrentPage(Math.min(totalPages, Math.max(1, page)));
    bodyRef.current?.scrollTo({ top: 0 });
  };

  // Script Statistics
  const stats = useMemo(() => {
    let wordCount = 0;
    let charCount = 0;
    let totalDuration = 0;

    segments.forEach((s) => {
      const text = s.textTarget || (s as any).targetText || '';
      charCount += text.length;
      wordCount += text.trim().split(/\s+/).filter(Boolean).length;
      totalDuration = Math.max(totalDuration, s.endTime || 0);
    });

    const estReadingSec = wordCount > 0 ? Math.round((wordCount / 140) * 60) : 0;

    return {
      cuesCount: segments.length,
      wordCount,
      charCount,
      totalDuration,
      estReadingSec,
    };
  }, [segments]);

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m}:${s < 10 ? '0' : ''}${s}.${ms}`;
  };

  const handleCopyScript = () => {
    const scriptText = generateTargetLanguageScript(segments, targetLanguage, formatMode, sourceFileName);
    try {
      navigator.clipboard.writeText(scriptText);
      setIsCopied(true);
      setCopiedNotification(`Copied ${targetLanguage} final script to clipboard!`);
      setTimeout(() => {
        setIsCopied(false);
        setCopiedNotification(null);
      }, 2000);
    } catch (e) {
      console.warn('Copy script error:', e);
    }
  };

  const handleDownloadScript = (format: TargetScriptFormat) => {
    if (onDownloadScript) {
      onDownloadScript(format);
      return;
    }
    const scriptContent = generateTargetLanguageScript(segments, targetLanguage, format, sourceFileName);
    const cleanLang = (targetLanguage || 'script').toLowerCase().replace(/\s+/g, '_');
    const ext = format === 'json' ? 'json' : format === 'csv' ? 'csv' : 'txt';
    const mime = format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/plain;charset=utf-8';
    downloadFile(scriptContent, `dhvani_${cleanLang}_final_script_${format}.${ext}`, mime);
  };

  const renderPagination = () => {
    if (totalPages <= 1) return null;
    const navBtn =
      'rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-900 disabled:opacity-20 disabled:pointer-events-none transition-all flex items-center gap-1 font-semibold cursor-pointer';
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 py-2 px-3 bg-slate-50 dark:bg-slate-950/80 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px]">
        <div className="text-slate-500 dark:text-slate-400 font-medium">
          Cues{' '}
          <span className="text-indigo-600 dark:text-indigo-400 font-bold">
            {pageStart + 1} - {Math.min(segments.length, pageStart + CUES_PER_PAGE)}
          </span>{' '}
          of <span className="text-slate-900 dark:text-white font-bold">{segments.length}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button type="button" disabled={currentPage === 1} onClick={() => goToPage(1)} className={`p-1 ${navBtn}`} title="First Page">
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={currentPage === 1} onClick={() => goToPage(currentPage - 1)} className={`px-2 py-1 ${navBtn}`}>
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Prev</span>
          </button>
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-medium">
            <span className="text-slate-500 dark:text-slate-400">Page</span>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (val >= 1 && val <= totalPages) goToPage(val);
              }}
              className="w-8 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-center rounded text-slate-900 dark:text-white font-bold text-xs focus:outline-none focus:border-indigo-500 py-0.5"
            />
            <span className="text-slate-400 dark:text-slate-500">of {totalPages}</span>
          </div>
          <button type="button" disabled={currentPage === totalPages} onClick={() => goToPage(currentPage + 1)} className={`px-2 py-1 ${navBtn}`}>
            <span>Next</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={currentPage === totalPages} onClick={() => goToPage(totalPages)} className={`p-1 ${navBtn}`} title="Last Page">
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full bg-white dark:bg-slate-950/90 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 space-y-4 shadow-xl">
      {/* Header with Title and Metadata */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-purple-500/10 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center border border-purple-200 dark:border-purple-500/30 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-slate-900 dark:text-white font-display">
                Final {targetLanguage} Script
              </h3>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950 border border-purple-200 dark:border-purple-800 text-purple-700 dark:text-purple-300 font-semibold">
                {stats.cuesCount} Cues
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-semibold">
                {stats.wordCount} Words
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Polished dialogue script translated with <span className="text-indigo-600 dark:text-indigo-300 font-semibold">{promptPresetName}</span> prompt.
            </p>
          </div>
        </div>

        {/* Top Controls: Format Switcher & Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Format Mode Tabs */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setFormatMode('dialogue')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                formatMode === 'dialogue'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Dialogue
            </button>
            <button
              type="button"
              onClick={() => setFormatMode('timecoded')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                formatMode === 'timecoded'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Timecoded
            </button>
            <button
              type="button"
              onClick={() => setFormatMode('bilingual')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
                formatMode === 'bilingual'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Bilingual
            </button>
          </div>

          {/* Quick Edit Toggle */}
          {onUpdateSegment && (
            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
                isEditing
                  ? 'bg-indigo-600 text-white border-indigo-400'
                  : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border-slate-300 dark:border-slate-800'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>{isEditing ? 'Done Editing' : 'Edit Script'}</span>
            </button>
          )}

          {/* Prompt Adjustment */}
          {onOpenPromptModal && (
            <button
              type="button"
              onClick={onOpenPromptModal}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-200 border border-slate-300 dark:border-slate-800 text-xs font-semibold transition-all cursor-pointer"
              title="Change prompt and re-translate script"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
              <span>Adjust Prompt</span>
            </button>
          )}

          {/* Copy Script */}
          <button
            type="button"
            onClick={handleCopyScript}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-800 text-xs font-semibold transition-all active:scale-95 cursor-pointer"
          >
            {isCopied ? (
              <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
            )}
            <span>{isCopied ? 'Copied' : 'Copy Script'}</span>
          </button>
        </div>
      </div>

      {renderPagination()}

      {/* Script Reader Body */}
      <div
        ref={bodyRef}
        className="bg-slate-50 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800/90 rounded-2xl p-4 max-h-[70vh] overflow-y-auto custom-scrollbar space-y-3.5"
      >
        {pageSegments.map((seg, pageIdx) => {
          const idx = pageStart + pageIdx;
          const targetText = seg.textTarget || (seg as any).targetText || '';
          const sourceText = seg.textSource || (seg as any).originalText || '';

          return (
            <div
              key={seg.id || idx}
              className="group p-3 rounded-xl bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/70 hover:border-indigo-400 dark:hover:border-indigo-500/40 transition-all space-y-1.5 shadow-2xs"
            >
              {/* Cue Info Row */}
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/80 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800/60">
                    {seg.speaker || `Speaker ${idx + 1}`}
                  </span>
                  <span className="text-slate-400 dark:text-slate-500">#{idx + 1}</span>
                </div>
                <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
                    <span>{formatSeconds(seg.startTime)} - {formatSeconds(seg.endTime)}</span>
                  </span>
                  <span className="text-slate-300 dark:text-slate-600 font-bold">•</span>
                  <span className="text-cyan-700 dark:text-cyan-400 font-semibold">{seg.duration.toFixed(1)}s</span>
                </div>
              </div>

              {/* Bilingual Source text if selected */}
              {formatMode === 'bilingual' && sourceText && (
                <div className="text-xs text-slate-500 dark:text-slate-400 italic pl-2 border-l-2 border-slate-300 dark:border-slate-700 font-sans">
                  {sourceText}
                </div>
              )}

              {/* Target Translated Text (Editable or Read-only) */}
              {isEditing && onUpdateSegment ? (
                <textarea
                  rows={2}
                  value={targetText}
                  onChange={(e) =>
                    onUpdateSegment(seg.id, {
                      textTarget: e.target.value,
                      targetText: e.target.value,
                    })
                  }
                  className="w-full rounded-xl bg-white dark:bg-slate-900 border border-indigo-400 dark:border-indigo-500/50 p-2 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-indigo-400 leading-relaxed font-sans"
                />
              ) : (
                <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-100 font-medium leading-relaxed font-sans select-text">
                  {targetText || <span className="text-slate-400 dark:text-slate-500 italic">No translated dialogue</span>}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {renderPagination()}

      {/* Script Actions Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
          <span>Export Formats:</span>
          <button
            type="button"
            onClick={() => handleDownloadScript('dialogue')}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800 cursor-pointer"
          >
            .TXT Dialogue
          </button>
          <button
            type="button"
            onClick={() => handleDownloadScript('timecoded')}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800 cursor-pointer"
          >
            .TXT Timecoded
          </button>
          <button
            type="button"
            onClick={() => handleDownloadScript('csv')}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800 cursor-pointer"
          >
            .CSV Table
          </button>
          <button
            type="button"
            onClick={() => handleDownloadScript('json')}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-200 dark:border-slate-800 cursor-pointer"
          >
            .JSON
          </button>
        </div>

        {copiedNotification && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1 animate-in fade-in">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{copiedNotification}</span>
          </span>
        )}
      </div>
    </div>
  );
};
