import React, { useState, useEffect, useMemo } from 'react';
import { X, Check, AlertCircle, RefreshCw, ClipboardPaste, ArrowUp, ArrowDown } from 'lucide-react';
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
  // Whether the pasted script has been split into the cues yet.
  const [hasAligned, setHasAligned] = useState(false);
  useEffect(() => {
    if (isOpen) setHasAligned(false);
  }, [isOpen]);

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
      setErrorMsg('Paste your script into the box first.');
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
        setSuccessMsg('Fitted by meaning');
        setTimeout(() => setSuccessMsg(null), 4000);
      } catch (err: any) {
        console.warn('AI Alignment failed, falling back to smart proportional strategy:', err);
        setErrorMsg('The AI could not be reached, so the script was split by length instead.');
        setStrategy('proportional');
        runClientAlignment(pastedText, 'proportional');
      } finally {
        setIsAligning(false);
      }
    } else {
      runClientAlignment(pastedText, activeStrat);
      setSuccessMsg('Fitted');
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

  const filled = alignedDraft.filter((d) => d.targetText.trim()).length;
  const fast = alignedDraft.filter((d) => d.targetText.trim() && d.targetText.length / d.duration > 18).length;
  const step = !pastedText.trim() ? 1 : hasAligned ? 3 : 2;
  const WAYS: { id: AlignmentStrategy; title: string; hint: string; tag?: string }[] = [
    { id: 'ai', title: 'By meaning', hint: 'AI matches each part to the English it translates.', tag: 'Recommended' },
    { id: 'line', title: 'One line per cue', hint: 'Line 1 goes to cue 1, and so on.' },
    { id: 'sentence', title: 'By sentence', hint: "Whole sentences, spread by each cue's length." },
    { id: 'proportional', title: 'By length', hint: 'Words shared out in proportion to the timing.' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && !isAligning && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="align-title"
        className="w-full max-w-[65rem] min-h-full sm:min-h-0 sm:my-auto sm:max-h-[calc(100vh-3rem)] flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
      >
        <div className="flex items-center gap-3.5 px-5 sm:px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-slate-100 text-slate-950 flex items-center justify-center shrink-0" aria-hidden="true">
            <ClipboardPaste className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="align-title" className="text-lg font-semibold text-slate-100 leading-tight">
              Paste your own script
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5">
              Use a {targetLanguage} script you already have. It's fitted to the {segments.length} English cues and their timing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isAligning}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Where you are */}
        <div className="flex flex-wrap gap-1.5 px-5 sm:px-6 py-2.5 border-b border-slate-800 bg-slate-950/40 shrink-0" aria-hidden="true">
          {['Paste', 'Choose how to split', 'Check the fit'].map((label, i) => {
            const n = i + 1;
            const done = n < step;
            const on = n === step;
            return (
              <span
                key={label}
                className={`flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full text-[12.5px] ${on ? 'bg-slate-900 text-slate-100 shadow-sm' : 'text-slate-400'}`}
              >
                <span
                  className={`w-[19px] h-[19px] rounded-full flex items-center justify-center font-mono text-[10.5px] border ${
                    done ? 'bg-emerald-500/15 border-transparent text-emerald-300' : on ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-700'
                  }`}
                >
                  {done ? <Check className="w-3 h-3" /> : n}
                </span>
                {label}
              </span>
            );
          })}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto grid md:grid-cols-[20.5rem_minmax(0,1fr)]">
          {/* Paste and choose */}
          <div className="px-5 py-4 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col gap-3.5 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="align-paste" className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                Your script
              </label>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text) {
                        setPastedText(text);
                        setHasAligned(false);
                        setErrorMsg(null);
                      }
                    } catch {
                      setErrorMsg('The clipboard could not be read here. Paste into the box with Ctrl+V instead.');
                    }
                  }}
                  className="h-[30px] px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer"
                >
                  Paste from clipboard
                </button>
                {pastedText && (
                  <button
                    type="button"
                    onClick={() => {
                      setPastedText('');
                      setHasAligned(false);
                    }}
                    className="h-[30px] px-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    Clear
                  </button>
                )}
              </span>
            </div>
            <textarea
              id="align-paste"
              value={pastedText}
              onChange={(e) => {
                setPastedText(e.target.value);
                setHasAligned(false);
                setErrorMsg(null);
              }}
              placeholder={`Paste your ${targetLanguage} script: paragraphs, one line per cue, or a full transcript.`}
              rows={7}
              className="w-full min-h-[10.5rem] resize-y bg-slate-950/60 border border-slate-700 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 rounded-xl px-3 py-2.5 text-[14px] leading-relaxed text-slate-100 placeholder-slate-500 focus:outline-none"
            />
            {pastedText.trim() && (
              <span className="text-[11.5px] text-slate-500 tabular-nums">
                {pastedText.length.toLocaleString()} characters · {stats.rawWords.toLocaleString()} words · {stats.rawLines} lines
              </span>
            )}

            <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">How to split it</span>
            <div role="radiogroup" aria-label="How to split" className="flex flex-col gap-1.5">
              {WAYS.map((w) => {
                const on = strategy === w.id;
                return (
                  <button
                    key={w.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => {
                      setStrategy(w.id);
                      setHasAligned(false);
                    }}
                    className={`flex items-start gap-2.5 p-2.5 rounded-[11px] border text-left transition-colors cursor-pointer ${
                      on ? 'border-indigo-500 ring-4 ring-indigo-500/10' : 'border-slate-800 hover:bg-slate-800/40'
                    }`}
                  >
                    <span className={`w-[15px] h-[15px] mt-0.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${on ? 'border-indigo-400' : 'border-slate-600'}`}>
                      {on && <span className="w-[7px] h-[7px] rounded-full bg-indigo-400" />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-100">
                        {w.title}
                        {w.tag && <span className="text-[10.5px] font-semibold px-1.5 py-px rounded-full bg-indigo-500/15 text-indigo-300">{w.tag}</span>}
                      </span>
                      <span className="block text-[11.5px] text-slate-400 mt-0.5">{w.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={async () => {
                await handleAlign();
                setHasAligned(true);
              }}
              disabled={!pastedText.trim() || isAligning}
              className="h-[38px] flex items-center justify-center gap-2 rounded-[10px] border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-[13px] font-semibold text-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {isAligning ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
              {isAligning ? 'Fitting it to the cues…' : hasAligned ? 'Split it again' : 'Split it into the cues'}
            </button>

            {errorMsg && (
              <p className="flex items-start gap-1.5 text-xs text-amber-300" role="alert">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {errorMsg}
              </p>
            )}
          </div>

          {/* The fit */}
          <div className="px-4 py-3.5 flex flex-col gap-2.5 min-w-0 bg-slate-950/40">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              {hasAligned ? (
                <>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${filled === segments.length ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
                    {filled} of {segments.length} cues filled
                  </span>
                  {fast > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300">{fast} read too fast</span>}
                  <span className="ml-auto hidden sm:inline">Hover a line to move a word to the cue before or after</span>
                </>
              ) : (
                <span>These are the cues' current lines. Split your script to see it fitted here.</span>
              )}
              {successMsg && <span className="text-emerald-300" role="status">{successMsg}</span>}
            </div>

            <div className="flex-1 min-h-[16rem] overflow-y-auto custom-scrollbar flex flex-col gap-1.5 pr-0.5">
              {alignedDraft.map((item, index) => {
                const cps = item.duration > 0 ? item.targetText.length / item.duration : 0;
                const tooFast = item.targetText.trim() && cps > 18;
                return (
                  <div
                    key={item.id}
                    className={`group grid grid-cols-[2rem_minmax(0,1fr)] sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1.25fr)_auto] gap-x-2.5 gap-y-1.5 items-start p-2.5 rounded-[10px] border bg-slate-900 ${
                      tooFast ? 'border-rose-500/40' : 'border-slate-800'
                    }`}
                  >
                    <span className="font-mono text-[11px] text-slate-500 pt-1 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                    <span className="text-[12.5px] text-slate-400 leading-snug pt-1">{item.englishText || <span className="italic text-slate-600">No English text</span>}</span>
                    <span className="col-span-2 sm:col-span-1 flex items-start gap-1">
                      <button
                        type="button"
                        onClick={() => shiftWordUp(index)}
                        disabled={index === 0 || !item.targetText.trim()}
                        className="mt-1.5 w-[22px] h-[22px] shrink-0 rounded-md border border-slate-800 text-slate-500 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 disabled:!opacity-20 cursor-pointer"
                        title="Move the first word to the cue before"
                        aria-label={`Move the first word of cue ${index + 1} to the cue before`}
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <textarea
                        value={item.targetText}
                        onChange={(e) => {
                          const copy = [...alignedDraft];
                          copy[index] = { ...copy[index], targetText: e.target.value };
                          setAlignedDraft(copy);
                        }}
                        rows={2}
                        aria-label={`${targetLanguage} for cue ${index + 1}`}
                        placeholder="Empty"
                        className="flex-1 min-w-0 resize-none bg-transparent border border-transparent hover:border-slate-800 focus:border-indigo-500 focus:bg-slate-950/60 rounded-lg px-2 py-1 text-[14px] leading-relaxed text-slate-100 placeholder-slate-600 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => shiftWordDown(index)}
                        disabled={index === alignedDraft.length - 1 || !item.targetText.trim()}
                        className="mt-1.5 w-[22px] h-[22px] shrink-0 rounded-md border border-slate-800 text-slate-500 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 disabled:!opacity-20 cursor-pointer"
                        title="Move the last word to the next cue"
                        aria-label={`Move the last word of cue ${index + 1} to the next cue`}
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </span>
                    <span className="hidden sm:block pt-1.5">
                      {item.targetText.trim() ? (
                        <span className={`font-mono text-[10.5px] px-2 py-0.5 rounded-full whitespace-nowrap ${tooFast ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                          {tooFast ? `${cps.toFixed(0)} cps` : 'OK'}
                        </span>
                      ) : (
                        <span className="font-mono text-[10.5px] px-2 py-0.5 rounded-full border border-slate-700 text-slate-500">empty</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 px-5 sm:px-6 py-3.5 border-t border-slate-800 shrink-0">
          <span className="min-w-0 flex-1 text-[11.5px] text-slate-500">
            Replaces the {targetLanguage} in all {segments.length} cues. The English and timing stay as they are.
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={isAligning}
            className="h-[38px] px-3.5 rounded-[10px] border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-[13px] font-medium text-slate-200 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!hasAligned || filled === 0 || isAligning}
            className="h-[38px] px-4 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer"
          >
            Use this script
          </button>
        </div>
      </section>
    </div>
  );
};
