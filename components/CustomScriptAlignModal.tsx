import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Check, AlertCircle, RefreshCw, ClipboardPaste, ArrowUp, ArrowDown, Info } from 'lucide-react';
import { AudioSegment } from '../types';
import { alignCustomScriptWithGemini, ScriptFit } from '../services/geminiService';
import {
  cleanPastedScript,
  splitByLines,
  splitBySentences,
  splitByLength,
  shiftWord,
  holdsWholeScript,
  countWords,
} from '../services/scriptAlignService';

export type AlignmentStrategy = 'ai' | 'line' | 'proportional' | 'sentence';

interface CustomScriptAlignModalProps {
  isOpen: boolean;
  onClose: () => void;
  segments: AudioSegment[];
  targetLanguage: string;
  onApplyAlignedScript: (alignedSegments: { id: string | number; textTarget: string }[]) => void;
}

interface DraftRow {
  id: string | number;
  englishText: string;
  duration: number;
  targetText: string;
  fit?: ScriptFit;
  estimated?: boolean;
}

interface Progress {
  done: number;
  total: number;
  message: string;
}

/** Characters per second above which a line is hard to say in its cue. */
const FAST_CPS = 18;

const durationOf = (seg: AudioSegment) => Math.max(0.5, seg.duration || seg.endTime - seg.startTime || 1);

const rowsFrom = (segments: AudioSegment[], texts?: string[]): DraftRow[] =>
  segments.map((seg, i) => ({
    id: seg.id,
    englishText: seg.textSource || seg.originalText || '',
    duration: durationOf(seg),
    targetText: texts ? texts[i] ?? '' : seg.textTarget || seg.targetText || '',
  }));

const needsCheck = (row: DraftRow) => Boolean(row.estimated || row.fit === 'partial' || row.fit === 'none');

const WAYS: { id: AlignmentStrategy; title: string; hint: string; tag?: string }[] = [
  { id: 'ai', title: 'By meaning', hint: 'AI finds where each English cue ends in your script. Your words are kept exactly.', tag: 'Recommended' },
  { id: 'line', title: 'One line per cue', hint: 'Line 1 goes to cue 1, and so on.' },
  { id: 'sentence', title: 'By sentence', hint: "Whole sentences, shared out by each cue's length." },
  { id: 'proportional', title: 'By length', hint: "Words shared out by each cue's length." },
];

export const CustomScriptAlignModal: React.FC<CustomScriptAlignModalProps> = ({
  isOpen,
  onClose,
  segments,
  targetLanguage,
  onApplyAlignedScript,
}) => {
  const [pastedText, setPastedText] = useState<string>('');
  const [strategy, setStrategy] = useState<AlignmentStrategy>('ai');
  const [draft, setDraft] = useState<DraftRow[]>([]);
  // The cleaned script the current draft was fitted from; null until fitted.
  const [fittedScript, setFittedScript] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [onlyToCheck, setOnlyToCheck] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoFitPending = useRef(false);

  const isAligning = progress !== null;
  const cleaned = useMemo(() => cleanPastedScript(pastedText), [pastedText]);
  const hasAligned = fittedScript !== null;

  // Start from the cues' current lines each time the dialog opens. Only on
  // open: a parent re-render must never wipe a draft being edited.
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  useEffect(() => {
    if (!isOpen) return;
    setDraft(rowsFrom(segmentsRef.current));
    setFittedScript(null);
    setErrorMsg(null);
    setNotice(null);
    setOnlyToCheck(false);
  }, [isOpen]);

  // Stop a running alignment if the dialog goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const resetFit = () => {
    setFittedScript(null);
    setErrorMsg(null);
    setNotice(null);
  };

  const cancelAlign = () => abortRef.current?.abort();

  const fit = async ({ auto = false }: { auto?: boolean } = {}) => {
    const script = cleaned.text;
    setErrorMsg(null);
    setNotice(null);
    if (!script) {
      setErrorMsg('Paste your script into the box first.');
      return;
    }

    let way = strategy;
    const notes: string[] = [];
    if (cleaned.subtitleBlocks !== null) {
      if (auto && cleaned.subtitleBlocks === segments.length) {
        way = 'line';
        setStrategy('line');
        notes.push(`Your paste is a subtitle file with ${cleaned.subtitleBlocks} blocks, one per cue, so each block went to its cue.`);
      } else {
        notes.push(`Subtitle numbers and timings were removed from your paste (${cleaned.subtitleBlocks} blocks for ${segments.length} cues).`);
      }
    }

    if (way !== 'ai') {
      const split = (way === 'line' ? splitByLines : way === 'sentence' ? splitBySentences : splitByLength)(script, segments);
      setDraft(rowsFrom(segments, split.texts));
      setFittedScript(script);
      setOnlyToCheck(false);
      if (split.note) notes.push(split.note);
      setNotice(notes.join(' ') || null);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ done: 0, total: segments.length, message: 'Reading your script' });
    try {
      const { cues: aligned, coverage } = await alignCustomScriptWithGemini(segments, script, targetLanguage, {
        signal: controller.signal,
        onProgress: (done, total, message) => setProgress({ done, total: total || segments.length, message }),
      });
      const rows = rowsFrom(segments, aligned.map((a) => a.targetText)).map((row, i) => ({
        ...row,
        fit: aligned[i].fit,
        estimated: aligned[i].estimated,
      }));
      setDraft(rows);
      setFittedScript(script);
      // Cues outside what the script covers are explained by the note below.
      const flagged = rows.filter(
        (row, i) => needsCheck(row) && (!coverage || (i + 1 >= coverage.firstCue && i + 1 <= coverage.lastCue))
      ).length;
      setOnlyToCheck(false);
      if (coverage) {
        notes.push(
          `Your script covers cues ${coverage.firstCue}–${coverage.lastCue}, so the cues outside that were left empty.`
        );
      }
      notes.push(
        flagged
          ? `${flagged} ${flagged === 1 ? 'cue needs' : 'cues need'} a look. Use "Only cues to check" to go through them.`
          : 'Every cue matched its English.'
      );
      setNotice(notes.join(' '));
    } catch (err: any) {
      if (controller.signal.aborted) {
        setNotice('Stopped. The cues were left as they were.');
        return;
      }
      console.warn('Aligning by meaning failed, splitting by length instead:', err);
      const split = splitByLength(script, segments);
      setDraft(rowsFrom(segments, split.texts).map((row) => ({ ...row, estimated: true })));
      setFittedScript(script);
      setStrategy('proportional');
      setErrorMsg(`${err?.message || 'The AI could not be reached.'} Your script was split by length instead, so check each cue.`);
      setNotice(notes.join(' ') || null);
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  // A paste into the box fits the script straight away.
  useEffect(() => {
    if (!autoFitPending.current) return;
    autoFitPending.current = false;
    if (cleaned.text) void fit({ auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastedText]);

  const acceptPaste = (text: string) => {
    autoFitPending.current = true;
    setPastedText(text);
    resetFit();
  };

  const updateTexts = (texts: string[], touched: number[]) =>
    setDraft((rows) =>
      rows.map((row, i) =>
        // A cue edited by hand counts as checked.
        touched.includes(i) ? { ...row, targetText: texts[i], fit: undefined, estimated: false } : { ...row, targetText: texts[i] }
      )
    );

  const moveWord = (index: number, direction: 'next' | 'previous') => {
    const texts = draft.map((r) => r.targetText);
    updateTexts(shiftWord(texts, index, direction), [index, direction === 'next' ? index + 1 : index - 1]);
  };

  const handleApply = () => {
    if (draft.length === 0) return;
    onApplyAlignedScript(draft.map((row) => ({ id: row.id, textTarget: row.targetText.trim() })));
    onClose();
  };

  const requestClose = () => {
    if (isAligning) cancelAlign();
    else onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!isOpen) return null;

  const filled = draft.filter((d) => d.targetText.trim()).length;
  const fast = draft.filter((d) => d.targetText.trim() && d.targetText.length / d.duration > FAST_CPS).length;
  const toCheck = hasAligned ? draft.filter(needsCheck).length : 0;
  const whole = hasAligned && fittedScript !== null && holdsWholeScript(draft.map((d) => d.targetText), fittedScript);
  const visible = draft.map((row, index) => ({ row, index })).filter(({ row }) => !onlyToCheck || needsCheck(row));
  const step = !cleaned.text ? 1 : hasAligned ? 3 : 2;
  const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

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
              Paste a {targetLanguage} script you already have. Each part is matched to the English cue it translates. The timing doesn't change.
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
          {['Paste', 'Match to the English', 'Check the fit'].map((label, i) => {
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
                  disabled={isAligning}
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text.trim()) acceptPaste(text);
                      else setErrorMsg('The clipboard is empty.');
                    } catch {
                      setErrorMsg('The clipboard could not be read here. Paste into the box with Ctrl+V instead.');
                    }
                  }}
                  className="h-[30px] px-2.5 rounded-lg border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 disabled:opacity-40 cursor-pointer"
                >
                  Paste from clipboard
                </button>
                {pastedText && !isAligning && (
                  <button
                    type="button"
                    onClick={() => {
                      setPastedText('');
                      resetFit();
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
              readOnly={isAligning}
              onPaste={() => {
                autoFitPending.current = true;
              }}
              onChange={(e) => {
                setPastedText(e.target.value);
                resetFit();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && cleaned.text && !isAligning) {
                  e.preventDefault();
                  void fit();
                }
              }}
              placeholder={`Paste your ${targetLanguage} script: paragraphs, one line per cue, or an .srt file. It's matched to the English as soon as you paste.`}
              rows={7}
              className="w-full min-h-[10.5rem] resize-y bg-slate-950/60 border border-slate-700 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 rounded-xl px-3 py-2.5 text-[14px] leading-relaxed text-slate-100 placeholder-slate-500 focus:outline-none read-only:opacity-70"
            />
            {cleaned.text && (
              <span className="text-[11.5px] text-slate-500 tabular-nums">
                {countWords(cleaned.text).toLocaleString()} words · {cleaned.text.split('\n').filter((l) => l.trim()).length} lines
                {cleaned.subtitleBlocks !== null && ' · subtitle file'}
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
                    disabled={isAligning}
                    onClick={() => {
                      setStrategy(w.id);
                      resetFit();
                    }}
                    className={`flex items-start gap-2.5 p-2.5 rounded-[11px] border text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
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

            {isAligning ? (
              <div className="flex flex-col gap-2" role="status" aria-live="polite">
                <div className="flex items-center gap-2 text-[12.5px] text-slate-200">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{progress?.message || 'Matching'}…</span>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">{percent}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div className="h-full bg-indigo-500 transition-[width] duration-500" style={{ width: `${Math.max(4, percent)}%` }} />
                </div>
                <button
                  type="button"
                  onClick={cancelAlign}
                  className="h-[34px] rounded-[10px] border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-pointer"
                >
                  Stop
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void fit()}
                disabled={!cleaned.text}
                className="h-[38px] flex items-center justify-center gap-2 rounded-[10px] border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-[13px] font-semibold text-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                {hasAligned ? 'Split it again' : strategy === 'ai' ? 'Match it to the English' : 'Split it into the cues'}
              </button>
            )}

            {errorMsg && (
              <p className="flex items-start gap-1.5 text-xs text-amber-300" role="alert">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {errorMsg}
              </p>
            )}
            {notice && !isAligning && (
              <p className="flex items-start gap-1.5 text-xs text-slate-300" role="status">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px text-slate-400" /> {notice}
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
                  {toCheck > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300">{toCheck} to check</span>}
                  {fast > 0 && <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300">{fast} read too fast</span>}
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${whole ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-300'}`}
                    title={whole ? 'Read in order, the cues hold your script word for word.' : 'You have edited the words, so the cues no longer hold your paste word for word.'}
                  >
                    {whole ? 'Every word placed' : 'Words edited'}
                  </span>
                  {(toCheck > 0 || onlyToCheck) && (
                    <label className="ml-auto flex items-center gap-1.5 cursor-pointer select-none text-slate-300">
                      <input
                        type="checkbox"
                        checked={onlyToCheck}
                        onChange={(e) => setOnlyToCheck(e.target.checked)}
                        className="accent-indigo-500"
                      />
                      Only cues to check
                    </label>
                  )}
                </>
              ) : (
                <span>These are the cues' current lines. Paste your script to see it matched here.</span>
              )}
            </div>

            <div className="flex-1 min-h-[16rem] overflow-y-auto custom-scrollbar flex flex-col gap-1.5 pr-0.5">
              {onlyToCheck && visible.length === 0 && (
                <p className="text-[12.5px] text-slate-400 p-3">All checked. Nothing else needs a look.</p>
              )}
              {visible.map(({ row: item, index }) => {
                const cps = item.duration > 0 ? item.targetText.length / item.duration : 0;
                const tooFast = Boolean(item.targetText.trim()) && cps > FAST_CPS;
                const flag = hasAligned
                  ? item.estimated
                    ? { label: 'Estimated', tone: 'amber', hint: "The AI's answer for this cue couldn't be used, so it was placed by length. Check where it starts and ends." }
                    : item.fit === 'none'
                      ? { label: 'No match', tone: 'rose', hint: 'Nothing in your script seemed to say this English.' }
                      : item.fit === 'partial'
                        ? { label: 'Check', tone: 'amber', hint: "Part of the meaning may be missing, added, or in the cue next to it." }
                        : null
                  : null;
                return (
                  <div
                    key={item.id}
                    style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 76px' }}
                    className={`group grid grid-cols-[2rem_minmax(0,1fr)] sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1.25fr)_auto] gap-x-2.5 gap-y-1.5 items-start p-2.5 rounded-[10px] border bg-slate-900 ${
                      flag?.tone === 'rose' || tooFast ? 'border-rose-500/40' : flag ? 'border-amber-500/40' : 'border-slate-800'
                    }`}
                  >
                    <span className="font-mono text-[11px] text-slate-500 pt-1 tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                    <span className="text-[12.5px] text-slate-400 leading-snug pt-1">{item.englishText || <span className="italic text-slate-600">No English text</span>}</span>
                    <span className="col-span-2 sm:col-span-1 flex items-start gap-1">
                      <button
                        type="button"
                        onClick={() => moveWord(index, 'previous')}
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
                          const texts = draft.map((r) => r.targetText);
                          texts[index] = e.target.value;
                          updateTexts(texts, [index]);
                        }}
                        rows={2}
                        aria-label={`${targetLanguage} for cue ${index + 1}`}
                        placeholder="Empty"
                        className="flex-1 min-w-0 resize-none bg-transparent border border-transparent hover:border-slate-800 focus:border-indigo-500 focus:bg-slate-950/60 rounded-lg px-2 py-1 text-[14px] leading-relaxed text-slate-100 placeholder-slate-600 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => moveWord(index, 'next')}
                        disabled={index === draft.length - 1 || !item.targetText.trim()}
                        className="mt-1.5 w-[22px] h-[22px] shrink-0 rounded-md border border-slate-800 text-slate-500 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 disabled:!opacity-20 cursor-pointer"
                        title="Move the last word to the next cue"
                        aria-label={`Move the last word of cue ${index + 1} to the next cue`}
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </span>
                    <span className="hidden sm:flex flex-col items-end gap-1 pt-1.5">
                      {flag && (
                        <span
                          title={flag.hint}
                          className={`font-mono text-[10.5px] px-2 py-0.5 rounded-full whitespace-nowrap cursor-help ${
                            flag.tone === 'rose' ? 'bg-rose-500/15 text-rose-300' : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {flag.label}
                        </span>
                      )}
                      {item.targetText.trim() ? (
                        (tooFast || !flag) && (
                          <span className={`font-mono text-[10.5px] px-2 py-0.5 rounded-full whitespace-nowrap ${tooFast ? 'bg-rose-500/15 text-rose-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
                            {tooFast ? `${cps.toFixed(0)} cps` : 'OK'}
                          </span>
                        )
                      ) : (
                        !flag && <span className="font-mono text-[10.5px] px-2 py-0.5 rounded-full border border-slate-700 text-slate-500">empty</span>
                      )}
                    </span>
                    {flag && (
                      <span className={`sm:hidden col-span-2 text-[11px] ${flag.tone === 'rose' ? 'text-rose-300' : 'text-amber-300'}`}>
                        {flag.label}: {flag.hint}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 px-5 sm:px-6 py-3.5 border-t border-slate-800 shrink-0">
          <span className="min-w-0 flex-1 text-[11.5px] text-slate-500">
            Replaces the {targetLanguage} in all {segments.length} cues. The English and timing stay as they are, and you can undo it.
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={isAligning}
            className="h-[38px] px-3.5 rounded-[10px] border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-[13px] font-medium text-slate-200 disabled:opacity-40 cursor-pointer"
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
