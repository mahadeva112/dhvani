import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  FileText,
  Bot,
  Cpu,
  Zap,
  AlignLeft,
  Check,
  AlertCircle,
  Clock,
  ArrowRight,
  RefreshCw,
  Clipboard,
  Layers,
  ChevronRight,
  Sliders,
  SlidersHorizontal,
} from 'lucide-react';
import { AudioSegment } from '../types';
import { alignCustomScriptWithGemini } from '../services/geminiService';

export type AlignmentStrategy = 'ai' | 'line' | 'proportional' | 'sentence';

interface CustomScriptAlignModalProps {
  isOpen: boolean;
  onClose: () => void;
  segments: AudioSegment[];
  targetLanguage: string;
  onApplyAlignedScript: (alignedSegments: { id: string | number; textTarget: string }[]) => void;
}

export const CustomScriptAlignModal: React.FC<CustomScriptAlignModalProps> = ({
  isOpen,
  onClose,
  segments,
  targetLanguage,
  onApplyAlignedScript,
}) => {
  const [pastedText, setPastedText] = useState<string>('');
  const [strategy, setStrategy] = useState<AlignmentStrategy>('ai');
  const [alignedDraft, setAlignedDraft] = useState<
    { id: string | number; targetText: string; englishText: string; duration: number }[]
  >([]);
  const [isAligning, setIsAligning] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Initialize draft on open or when segments change
  useEffect(() => {
    if (isOpen && segments) {
      const initialDraft = segments.map((seg) => ({
        id: seg.id,
        targetText: seg.textTarget || (seg as any).targetText || '',
        englishText: seg.textSource || (seg as any).originalText || '',
        duration: Math.max(0.5, seg.duration || (seg.endTime - seg.startTime) || 1),
      }));
      setAlignedDraft(initialDraft);
    }
  }, [isOpen, segments]);

  // Client-side Alignment Algorithms
  const runClientAlignment = (text: string, selectedStrategy: AlignmentStrategy) => {
    if (!segments || segments.length === 0) return;
    const cleanText = text.trim();
    if (!cleanText) {
      setAlignedDraft(
        segments.map((seg) => ({
          id: seg.id,
          targetText: '',
          englishText: seg.textSource || '',
          duration: Math.max(0.5, seg.duration || (seg.endTime - seg.startTime) || 1),
        }))
      );
      return;
    }

    if (selectedStrategy === 'line') {
      // Line-by-Line Alignment
      const lines = cleanText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      const newDraft = segments.map((seg, idx) => {
        let assignedText = '';
        if (idx < lines.length) {
          if (idx === segments.length - 1 && lines.length > segments.length) {
            // Join all remaining lines into the last segment
            assignedText = lines.slice(idx).join(' ');
          } else {
            assignedText = lines[idx];
          }
        }
        return {
          id: seg.id,
          targetText: assignedText,
          englishText: seg.textSource || '',
          duration: Math.max(0.5, seg.duration || (seg.endTime - seg.startTime) || 1),
        };
      });
      setAlignedDraft(newDraft);
    } else if (selectedStrategy === 'sentence') {
      // Sentence Boundary Alignment
      const sentences = cleanText
        .split(/(?<=[.!?।。\n])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);

      const totalEngChars = segments.reduce((sum, s) => sum + (s.textSource || '').length, 0) || 1;
      let sentenceCursor = 0;

      const newDraft = segments.map((seg, idx) => {
        const engLen = (seg.textSource || '').length || 10;
        const weight = engLen / totalEngChars;
        const targetSentenceCount = Math.max(1, Math.round(weight * sentences.length));

        let assignedText = '';
        if (idx === segments.length - 1) {
          assignedText = sentences.slice(sentenceCursor).join(' ');
        } else {
          assignedText = sentences.slice(sentenceCursor, sentenceCursor + targetSentenceCount).join(' ');
          sentenceCursor += targetSentenceCount;
        }

        return {
          id: seg.id,
          targetText: assignedText,
          englishText: seg.textSource || '',
          duration: Math.max(0.5, seg.duration || (seg.endTime - seg.startTime) || 1),
        };
      });
      setAlignedDraft(newDraft);
    } else if (selectedStrategy === 'proportional') {
      // Proportional Word Distribution by English Length
      const words = cleanText.split(/\s+/).filter(Boolean);
      const totalEngLength = segments.reduce((sum, s) => sum + (s.textSource || '').length, 0) || 1;

      let wordCursor = 0;
      const newDraft = segments.map((seg, idx) => {
        const engLen = (seg.textSource || '').length || 10;
        const ratio = engLen / totalEngLength;
        const wordCountForSeg = Math.max(1, Math.round(ratio * words.length));

        let assignedWords: string[] = [];
        if (idx === segments.length - 1) {
          assignedWords = words.slice(wordCursor);
        } else {
          assignedWords = words.slice(wordCursor, wordCursor + wordCountForSeg);
          wordCursor += wordCountForSeg;
        }

        return {
          id: seg.id,
          targetText: assignedWords.join(' '),
          englishText: seg.textSource || '',
          duration: Math.max(0.5, seg.duration || (seg.endTime - seg.startTime) || 1),
        };
      });
      setAlignedDraft(newDraft);
    }
  };

  // Run Alignment handler
  const handleAlign = async (overrideStrategy?: AlignmentStrategy) => {
    const activeStrat = overrideStrategy || strategy;
    setErrorMsg(null);

    if (!pastedText.trim()) {
      setErrorMsg('Please paste your custom translated script into the box above.');
      return;
    }

    if (activeStrat === 'ai') {
      setIsAligning(true);
      try {
        const aiResults = await alignCustomScriptWithGemini(segments, pastedText, targetLanguage);
        const map = new Map(aiResults.map((r) => [String(r.id), r.targetText]));

        const newDraft = segments.map((seg) => ({
          id: seg.id,
          targetText: map.get(String(seg.id)) || '',
          englishText: seg.textSource || '',
          duration: Math.max(0.5, seg.duration || (seg.endTime - seg.startTime) || 1),
        }));
        setAlignedDraft(newDraft);
        setSuccessMsg(`Successfully aligned script into ${segments.length} cues using AI semantic matching!`);
        setTimeout(() => setSuccessMsg(null), 4000);
      } catch (err: any) {
        console.warn('AI Alignment failed, falling back to smart proportional strategy:', err);
        setErrorMsg('AI Alignment API unavailable. Auto-switching to Smart Proportional alignment.');
        setStrategy('proportional');
        runClientAlignment(pastedText, 'proportional');
      } finally {
        setIsAligning(false);
      }
    } else {
      runClientAlignment(pastedText, activeStrat);
      setSuccessMsg(`Script aligned using ${activeStrat} mode.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    }
  };

  // Apply to parent dubbing job
  const handleApply = () => {
    if (!alignedDraft || alignedDraft.length === 0) return;
    const payload = alignedDraft.map((item) => ({
      id: item.id,
      textTarget: item.targetText,
    }));
    onApplyAlignedScript(payload);
    onClose();
  };

  // Helper for shifting words between cues
  const shiftWordDown = (index: number) => {
    if (index >= alignedDraft.length - 1) return;
    const currentText = alignedDraft[index].targetText.trim();
    if (!currentText) return;
    const words = currentText.split(/\s+/);
    const lastWord = words.pop() || '';
    const newCurrent = words.join(' ');
    const nextText = (alignedDraft[index + 1].targetText.trim() + ' ' + lastWord).trim();

    const newDraft = [...alignedDraft];
    newDraft[index] = { ...newDraft[index], targetText: newCurrent };
    newDraft[index + 1] = { ...newDraft[index + 1], targetText: nextText };
    setAlignedDraft(newDraft);
  };

  const shiftWordUp = (index: number) => {
    if (index <= 0) return;
    const currentText = alignedDraft[index].targetText.trim();
    if (!currentText) return;
    const words = currentText.split(/\s+/);
    const firstWord = words.shift() || '';
    const newCurrent = words.join(' ');
    const prevText = (alignedDraft[index - 1].targetText.trim() + ' ' + firstWord).trim();

    const newDraft = [...alignedDraft];
    newDraft[index] = { ...newDraft[index], targetText: newCurrent };
    newDraft[index - 1] = { ...newDraft[index - 1], targetText: prevText };
    setAlignedDraft(newDraft);
  };

  // Statistics
  const stats = useMemo(() => {
    const rawLines = pastedText.split(/\r?\n/).filter((l) => l.trim()).length;
    const rawWords = pastedText.split(/\s+/).filter(Boolean).length;
    return { rawLines, rawWords };
  }, [pastedText]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-3xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-950/80 border border-indigo-700/60 text-indigo-400">
              <Bot className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-100 tracking-tight font-display">
                  Custom Script Alignment for Dubbing
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950 border border-indigo-700 text-indigo-300 font-semibold">
                  {targetLanguage}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300">
                  {segments.length} English Cues Split
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Paste your external translated script to automatically align it with the meaningfully split English timing cues.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-indigo-200 hover:bg-slate-800/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Split into Paste Area (Top/Left) and Alignment Preview Grid (Bottom/Right) */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5 custom-scrollbar">
          {/* Section 1: Paste Input Box & Alignment Mode Selectors */}
          <div className="bg-slate-950/80 p-4 sm:p-5 rounded-2xl border border-slate-800 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-xs font-bold text-slate-200 uppercase font-mono tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-cyan-400" />
                <span>1. Paste Custom Translated Script ({targetLanguage})</span>
              </label>

              <div className="flex items-center gap-2 text-xs">
                {stats.rawWords > 0 && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-300 font-semibold">
                    {stats.rawLines} lines • {stats.rawWords} words pasted
                  </span>
                )}
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) {
                        setPastedText(text);
                        setErrorMsg(null);
                      }
                    } catch (e) {
                      console.warn('Clipboard read error', e);
                    }
                  }}
                  className="px-2.5 py-1 rounded-xl bg-slate-900 hover:bg-slate-800/80 border border-slate-700 text-slate-300 hover:text-indigo-200 hover:border-indigo-500/40 font-medium flex items-center gap-1.5 transition-colors text-xs"
                >
                  <Clipboard className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Paste from Clipboard</span>
                </button>
                {pastedText && (
                  <button
                    type="button"
                    onClick={() => setPastedText('')}
                    className="px-2 py-1 text-slate-500 hover:text-rose-400 transition-colors text-xs"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Script Textarea */}
            <textarea
              value={pastedText}
              onChange={(e) => {
                setPastedText(e.target.value);
                setErrorMsg(null);
              }}
              placeholder={`Paste your custom ${targetLanguage} script here (e.g. multi-line dialogue, paragraph, or translated transcript)...`}
              rows={4}
              className="w-full p-3.5 rounded-2xl bg-slate-900 border border-slate-700/80 text-slate-100 font-sans text-xs sm:text-sm focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 placeholder-slate-500 leading-relaxed custom-scrollbar"
            />

            {/* Alignment Strategy Options */}
            <div className="space-y-2 pt-1">
              <span className="text-xs font-bold text-slate-300 font-mono uppercase tracking-wider block">
                Select Alignment Strategy:
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStrategy('ai');
                    if (pastedText.trim()) handleAlign('ai');
                  }}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    strategy === 'ai'
                      ? 'bg-indigo-950/80 border-indigo-500 text-indigo-100 shadow-md ring-1 ring-indigo-500/40'
                      : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-indigo-500/40 hover:bg-slate-800/80 hover:text-indigo-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs flex items-center gap-1.5 text-indigo-300">
                      <Bot className="w-3.5 h-3.5 text-indigo-400" /> AI Semantic Match
                    </span>
                    {strategy === 'ai' && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Uses Gemini to match meaning directly to each English cue context.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStrategy('line');
                    if (pastedText.trim()) handleAlign('line');
                  }}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    strategy === 'line'
                      ? 'bg-indigo-950/80 border-indigo-500 text-indigo-100 shadow-md ring-1 ring-indigo-500/40'
                      : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-indigo-500/40 hover:bg-slate-800/80 hover:text-indigo-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs flex items-center gap-1.5 text-emerald-300">
                      <AlignLeft className="w-3.5 h-3.5" /> Line-by-Line (1:1)
                    </span>
                    {strategy === 'line' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Maps Line 1 to Cue 1, Line 2 to Cue 2 directly in sequence.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStrategy('proportional');
                    if (pastedText.trim()) handleAlign('proportional');
                  }}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    strategy === 'proportional'
                      ? 'bg-indigo-950/80 border-indigo-500 text-indigo-100 shadow-md ring-1 ring-indigo-500/40'
                      : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-indigo-500/40 hover:bg-slate-800/80 hover:text-indigo-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs flex items-center gap-1.5 text-cyan-300">
                      <SlidersHorizontal className="w-3.5 h-3.5" /> Smart Pacing Ratio
                    </span>
                    {strategy === 'proportional' && <Check className="w-3.5 h-3.5 text-cyan-400" />}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Distributes words proportionally to English cue durations & length.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setStrategy('sentence');
                    if (pastedText.trim()) handleAlign('sentence');
                  }}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    strategy === 'sentence'
                      ? 'bg-indigo-950/80 border-indigo-500 text-indigo-100 shadow-md ring-1 ring-indigo-500/40'
                      : 'bg-slate-900/90 border-slate-800 text-slate-300 hover:border-indigo-500/40 hover:bg-slate-800/80 hover:text-indigo-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-xs flex items-center gap-1.5 text-purple-300">
                      <Layers className="w-3.5 h-3.5" /> Sentence Boundary
                    </span>
                    {strategy === 'sentence' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                  </div>
                  <p className="text-[10px] text-slate-400 leading-normal">
                    Splits by sentence terminals (. ! ? ।) across English timing blocks.
                  </p>
                </button>
              </div>
            </div>

            {/* Run Alignment Action Button */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => handleAlign()}
                disabled={isAligning || !pastedText.trim()}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-indigo-50 font-bold text-xs flex items-center gap-2 shadow-lg shadow-indigo-600/20 transition-all active:scale-95 cursor-pointer"
              >
                {isAligning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-indigo-200" />
                    <span>AI Aligning Script to {segments.length} Cues...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 text-indigo-200" />
                    <span>Align & Split Script to English Cues</span>
                  </>
                )}
              </button>

              {errorMsg && (
                <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                  <Check className="w-4 h-4 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Interactive Real-Time Alignment Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-200 uppercase font-mono tracking-wider flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>2. Review & Fine-Tune Aligned Dialogue Cues ({alignedDraft.length} cues)</span>
              </label>
              <span className="text-[11px] text-slate-400">
                Edit text per cue or use nudge buttons to balance speaking speed.
              </span>
            </div>

            {/* Cue Cards Grid */}
            <div className="space-y-3">
              {alignedDraft.map((item, index) => {
                const charCount = item.targetText.trim().length;
                const wordCount = item.targetText.trim().split(/\s+/).filter(Boolean).length;
                const cps = item.duration > 0 ? (charCount / item.duration).toFixed(1) : '0';
                const numericCps = parseFloat(cps);

                // Speed indicator badge
                let cpsBadgeColor = 'bg-emerald-950/80 text-emerald-300 border-emerald-800';
                let cpsLabel = 'Natural Pace';
                if (numericCps > 20) {
                  cpsBadgeColor = 'bg-rose-950/80 text-rose-300 border-rose-800';
                  cpsLabel = 'Pacing Warning: Very Fast';
                } else if (numericCps > 14) {
                  cpsBadgeColor = 'bg-amber-950/80 text-amber-300 border-amber-800';
                  cpsLabel = 'Fast Pace';
                }

                return (
                  <div
                    key={String(item.id) + '-' + index}
                    className="p-3.5 sm:p-4 rounded-2xl bg-slate-950 border border-slate-800 hover:border-slate-700 transition-all space-y-2.5 shadow-sm"
                  >
                    {/* Header Row: Cue ID, Timing, and CPS indicator */}
                    <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                          Cue #{index + 1}
                        </span>
                        <span className="font-mono text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {item.duration.toFixed(2)}s duration
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${cpsBadgeColor}`}>
                          {wordCount} words • {charCount} chars ({cps} cps) - {cpsLabel}
                        </span>

                        {/* Shift Nudge controls */}
                        <div className="flex items-center gap-1 text-[10px] font-mono">
                          <button
                            type="button"
                            onClick={() => shiftWordUp(index)}
                            disabled={index === 0 || !item.targetText.trim()}
                            className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
                            title="Shift first word up to previous cue"
                          >
                            ↑ Move Word Up
                          </button>
                          <button
                            type="button"
                            onClick={() => shiftWordDown(index)}
                            disabled={index === alignedDraft.length - 1 || !item.targetText.trim()}
                            className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-40 transition-colors"
                            title="Shift last word down to next cue"
                          >
                            ↓ Move Word Down
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Dual Column Content: English Source vs Aligned Target Text */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                      {/* English Source (5 cols) */}
                      <div className="md:col-span-5 p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs">
                        <span className="text-[10px] font-mono text-indigo-400 uppercase tracking-wider block font-semibold mb-1">
                          Original English Script Cue
                        </span>
                        <p className="text-slate-300 font-sans leading-relaxed">
                          {item.englishText || <span className="text-slate-600 italic">No English text</span>}
                        </p>
                      </div>

                      {/* Arrow Divider */}
                      <div className="hidden md:flex md:col-span-1 justify-center">
                        <ArrowRight className="w-4 h-4 text-slate-600" />
                      </div>

                      {/* Target Language Aligned Input (6 cols) */}
                      <div className="md:col-span-6">
                        <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider block font-semibold mb-1">
                          Aligned Target Script ({targetLanguage})
                        </span>
                        <textarea
                          value={item.targetText}
                          onChange={(e) => {
                            const val = e.target.value;
                            const copy = [...alignedDraft];
                            copy[index] = { ...copy[index], targetText: val };
                            setAlignedDraft(copy);
                          }}
                          placeholder={`Enter translated text for Cue #${index + 1}...`}
                          rows={2}
                          className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-700/80 text-white text-xs sm:text-sm focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 custom-scrollbar leading-relaxed"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-950/80 shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>Clicking apply will update all {segments.length} dialogue cues in your dubbing session.</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-indigo-200 text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-lg shadow-indigo-600/20 transition-all active:scale-95 flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>Apply Aligned Script to Dubbing</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
