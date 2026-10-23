import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Check, AlertCircle, RefreshCw, ClipboardPaste, ArrowUp, ArrowDown, Info, FileText, FolderOpen } from 'lucide-react';
import { AudioSegment } from '../types';
import { alignCustomScriptWithGemini, ScriptCoverage, ScriptFit, ScriptFlag, UnresolvedRange } from '../services/geminiService';
import { readDhvaniScript, mapScriptToCues, DhvaniScript } from '../services/scriptShare';
import {
  cleanPastedScript,
  splitByLines,
  splitBySentences,
  splitByLength,
  scriptLines,
  shiftWord,
  holdsWholeScript,
  countWords,
} from '../services/scriptAlignService';
import { reportError } from '../services/errorPopup';

export type AlignmentStrategy = 'ai' | 'line' | 'proportional' | 'sentence';

interface CustomScriptAlignModalProps {
  isOpen: boolean;
  onClose: () => void;
  segments: AudioSegment[];
  targetLanguage: string;
  /** Seconds of this project's audio, to tell when a script file was timed on other audio. */
  audioDuration?: number;
  onApplyAlignedScript: (alignedSegments: { id: string | number; textTarget: string }[]) => void;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

interface DraftRow {
  id: string | number;
  englishText: string;
  duration: number;
  targetText: string;
  fit?: ScriptFit;
  estimated?: boolean;
  flag?: ScriptFlag;
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

const needsCheck = (row: DraftRow) => Boolean(row.estimated || row.flag || row.fit === 'partial' || row.fit === 'none');

/** What each unresolved range means, for the notice. */
const UNRESOLVED: Record<UnresolvedRange['reason'], string> = {
  'ran-out': 'your script ended before them, so they are empty — earlier cues may hold their words',
  overrun: 'their part of the script took more than their English share and a second look could not settle it',
  collapsed: 'a passage sat in one cue and could not be spread by meaning, so it was left there',
};

const describeUnresolved = (ranges: UnresolvedRange[]) =>
  ranges.map((r) => `Cue${r.firstCue === r.lastCue ? ` ${r.firstCue}` : `s ${r.firstCue}–${r.lastCue}`}: ${UNRESOLVED[r.reason]}.`).join(' ');

const WAYS: { id: AlignmentStrategy; title: string; hint: string; tag?: string }[] = [
  {
    id: 'ai',
    title: 'By meaning',
    hint: 'AI matches your lines to the cues and cuts a line only where it runs over several cues. It never rewrites or translates your words.',
    tag: 'Recommended',
  },
  { id: 'line', title: 'One line per cue', hint: 'Line 1 goes to cue 1, and so on.' },
  { id: 'sentence', title: 'By sentence', hint: "Whole sentences, shared out by each cue's length." },
  { id: 'proportional', title: 'By length', hint: "Words shared out by each cue's length." },
];

/** The cues a script was placed over, which the user can change and match again. */
const CoverageRange: React.FC<{ coverage: ScriptCoverage; cueCount: number; onApply: (range: ScriptCoverage) => void }> = ({
  coverage,
  cueCount,
  onApply,
}) => {
  const [first, setFirst] = useState(String(coverage.firstCue));
  const [last, setLast] = useState(String(coverage.lastCue));
  const firstCue = Number(first);
  const lastCue = Number(last);
  const valid = Number.isInteger(firstCue) && Number.isInteger(lastCue) && firstCue >= 1 && firstCue <= lastCue && lastCue <= cueCount;
  const changed = firstCue !== coverage.firstCue || lastCue !== coverage.lastCue;
  const field =
    'w-[4.25rem] h-[28px] bg-slate-950/60 border border-slate-700 focus:border-indigo-500 rounded-lg px-2 text-[12.5px] font-mono tabular-nums text-slate-100 focus:outline-none';
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
      <span>Script covers cues</span>
      <input aria-label="First cue the script covers" type="number" min={1} max={cueCount} value={first} onChange={(e) => setFirst(e.target.value)} className={field} />
      <span>to</span>
      <input aria-label="Last cue the script covers" type="number" min={1} max={cueCount} value={last} onChange={(e) => setLast(e.target.value)} className={field} />
      <button
        type="button"
        onClick={() => valid && onApply({ firstCue, lastCue })}
        disabled={!changed}
        className="h-[28px] px-2.5 rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-[12px] font-medium text-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-default"
      >
        Match again
      </button>
      {changed && !valid && <span className="text-amber-300">Pick cues from 1 to {cueCount}, first before last.</span>}
    </div>
  );
};

export const CustomScriptAlignModal: React.FC<CustomScriptAlignModalProps> = ({
  isOpen,
  onClose,
  segments,
  targetLanguage,
  audioDuration,
  onApplyAlignedScript,
}) => {
  const [pastedText, setPastedText] = useState<string>('');
  // A script file opened from disk; it stands in for the paste box.
  const [opened, setOpened] = useState<{ name: string; script: DhvaniScript } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [strategy, setStrategy] = useState<AlignmentStrategy>('ai');
  const [draft, setDraft] = useState<DraftRow[]>([]);
  // The cleaned script the current draft was fitted from; null until fitted.
  const [fittedScript, setFittedScript] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [onlyToCheck, setOnlyToCheck] = useState(false);
  // The cues the last match placed the script over, when it covers only part.
  const [coverage, setCoverage] = useState<ScriptCoverage | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pastePending = useRef(false);

  const isAligning = progress !== null;
  // A script Dhvani saved or exported: placed by its times, or one line per cue.
  const dhvani = useMemo(() => opened?.script ?? readDhvaniScript(pastedText), [opened, pastedText]);
  const timed = dhvani?.kind === 'cues' ? dhvani : null;
  const cleaned = useMemo(() => {
    if (dhvani?.kind === 'lines') return { text: dhvani.lines.join('\n'), subtitleBlocks: null };
    if (dhvani?.kind === 'cues') return { text: dhvani.file.cues.map((c) => c.target).filter(Boolean).join('\n'), subtitleBlocks: null };
    return cleanPastedScript(pastedText);
  }, [dhvani, pastedText]);
  const exportLines = dhvani?.kind === 'lines' ? dhvani.lines.length : null;
  // Lines of a plain paste; null for a subtitle file or a script Dhvani saved.
  const plainLines = dhvani || cleaned.subtitleBlocks !== null ? null : scriptLines(cleaned.text).length;
  const timedMismatch = timed ? mapScriptToCues(timed.file, [], { audioDuration }).audioMismatch : null;
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
    setCoverage(null);
  }, [isOpen]);

  // Stop a running alignment if the dialog goes away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const resetFit = () => {
    setFittedScript(null);
    setErrorMsg(null);
    setNotice(null);
    setCoverage(null);
  };

  const cancelAlign = () => abortRef.current?.abort();

  /** Fits the script; `chosen` places it over the cues the user picked. */
  const fit = async (chosen?: ScriptCoverage) => {
    const script = cleaned.text;
    setErrorMsg(null);
    setNotice(null);
    setCoverage(null);
    if (!script) {
      setErrorMsg('Paste your script into the box first.');
      return;
    }

    let way = strategy;
    const notes: string[] = [];
    if (timed) {
      const fileLanguage = timed.file.targetLanguage.trim();
      if (fileLanguage && fileLanguage.toLowerCase() !== targetLanguage.trim().toLowerCase()) {
        notes.push(`This script is in ${fileLanguage}, and the dub language is ${targetLanguage}.`);
      }
      if (!timedMismatch) return fitByTime(timed, notes);
      way = 'ai';
      notes.push(
        `This script was timed on audio ${clock(timedMismatch.file)} long, and this audio is ${clock(timedMismatch.here)}, so its times don't apply here. It was matched to the English instead.`
      );
    }
    if (exportLines !== null) {
      if (way === 'line' && exportLines === segments.length) {
        notes.push(`Your paste is a Dhvani script with ${exportLines} lines, one per cue, so each line went to its cue.`);
      } else {
        notes.push(`The Dhvani header and speaker names were removed from your paste (${exportLines} lines for ${segments.length} cues).`);
      }
    }
    if (cleaned.subtitleBlocks !== null) {
      if (way === 'line' && cleaned.subtitleBlocks === segments.length) {
        notes.push(`Your paste is a subtitle file with ${cleaned.subtitleBlocks} blocks, one per cue, so each block went to its cue.`);
      } else {
        notes.push(`Subtitle numbers and timings were removed from your paste (${cleaned.subtitleBlocks} blocks for ${segments.length} cues).`);
      }
    }

    if (way === 'line' && plainLines === segments.length) {
      notes.push(`Your script has ${plainLines} lines, one per cue, so each line went to its cue.`);
    }

    if (way !== 'ai') {
      const split = (way === 'line' ? splitByLines : way === 'sentence' ? splitBySentences : splitByLength)(script, segments);
      setDraft(rowsFrom(segments, split.texts).map((row, i) => ({ ...row, estimated: split.estimated?.[i] })));
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
      const { cues: aligned, coverage, unresolved, collapsed } = await alignCustomScriptWithGemini(segments, script, targetLanguage, {
        signal: controller.signal,
        coverage: chosen,
        onProgress: (done, total, message) => setProgress({ done, total: total || segments.length, message }),
      });
      const rows = rowsFrom(segments, aligned.map((a) => a.targetText)).map((row, i) => ({
        ...row,
        fit: aligned[i].fit,
        estimated: aligned[i].estimated,
        // Placing words never changes timing, so a cue with no length is only pointed out.
        flag: segments[i].endTime - segments[i].startTime < 0.01 ? ('zero-length' as const) : aligned[i].flag,
      }));
      const zeroLength = rows.filter((row) => row.flag === 'zero-length').length;
      const missing = rows.filter((row) => row.flag === 'missing').length;
      setDraft(rows);
      setFittedScript(script);
      // Cues outside what the script covers are explained by the note below.
      const flagged = rows.filter(
        (row, i) => needsCheck(row) && (!coverage || (i + 1 >= coverage.firstCue && i + 1 <= coverage.lastCue))
      ).length;
      setOnlyToCheck(false);
      if (coverage) {
        setCoverage(coverage);
        notes.push(
          chosen
            ? `Your script was placed over cues ${coverage.firstCue}–${coverage.lastCue}, so the cues outside that were left empty.`
            : `Your script seems to cover cues ${coverage.firstCue}–${coverage.lastCue}, so the cues outside that were left empty. If that's wrong, change the range below.`
        );
      }
      if (collapsed) notes.push(`${collapsed} ${collapsed === 1 ? 'passage that sat' : 'passages that sat'} in one cue ${collapsed === 1 ? 'was' : 'were'} spread over the cues ${collapsed === 1 ? 'it says' : 'they say'}.`);
      if (missing) notes.push(`${missing} ${missing === 1 ? 'cue has' : 'cues have'} English your script does not say, so ${missing === 1 ? 'it was' : 'they were'} left empty (marked Not in script).`);
      if (unresolved.length) notes.push(describeUnresolved(unresolved));
      if (zeroLength) notes.push(`${zeroLength} ${zeroLength === 1 ? 'cue has' : 'cues have'} no length in the timeline; fix their timing before dubbing.`);
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
      setErrorMsg('Matched by length, not meaning — check each cue.');
      reportError(err, {
        title: 'Your script could not be matched by meaning',
        safe: 'Your script was split by length instead, so nothing is lost — check each cue before applying.',
      });
      setNotice(notes.join(' ') || null);
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  /**
   * Places a script Dhvani saved by its times: each line goes to the cue at
   * its time, and only lines that run over several cues here are placed by
   * meaning, each over just those cues, so a line can't drift off its time.
   */
  const fitByTime = async (script: Extract<DhvaniScript, { kind: 'cues' }>, notes: string[]) => {
    const map = mapScriptToCues(script.file, segments, { audioDuration, coarse: script.coarse });
    const zero = new Set(map.zeroLength);
    let rows: DraftRow[] = rowsFrom(segments, map.texts).map((row, i) => {
      // In a placement by time, a cue no line falls on said nothing in the script.
      const unsaid = !map.texts[i].trim() && row.englishText.trim();
      return {
        ...row,
        estimated: map.estimated[i],
        fit: map.match === 'timed' && unsaid ? 'none' : undefined,
        flag: zero.has(i) ? 'zero-length' : unsaid ? 'missing' : undefined,
      };
    });
    setDraft(rows);
    setFittedScript(cleaned.text);
    setOnlyToCheck(false);
    const lineCount = script.file.cues.filter((c) => c.target.trim()).length;
    if (map.match === 'same') {
      notes.push(
        map.identity === 'text'
          ? 'The script has these very cues (its English matches cue for cue), so each line went back to its cue.'
          : 'The script has as many cues at the same times, so each line went back to its cue. It has no English to confirm that, so check a few.'
      );
    } else {
      if (map.sourceDiffers) notes.push(`The script has ${segments.length} cues too, but its English is not this transcript's, so its lines were not matched cue for cue.`);
      notes.push(`The script's ${lineCount} lines were cut differently from these ${segments.length} cues, so each line went to the cue at its time.`);
      if (script.coarse) notes.push('Its times are to the second, so check where lines meet.');
    }
    if (zero.size) {
      notes.push(
        `${zero.size} ${zero.size === 1 ? 'cue has' : 'cues have'} no length in the timeline. Their lines were kept; fix their timing before dubbing.`
      );
    }

    if (map.windows.length > 0) {
      const controller = new AbortController();
      abortRef.current = controller;
      let failed = 0;
      let unspread = 0;
      try {
        for (const [w, window] of map.windows.entries()) {
          if (controller.signal.aborted) break;
          setProgress({
            done: w,
            total: map.windows.length,
            message:
              window.kind === 'collapsed'
                ? `Spreading passages that sat in one cue (${w + 1} of ${map.windows.length})`
                : `Placing lines that run over several cues (${w + 1} of ${map.windows.length})`,
          });
          try {
            const { cues } = await alignCustomScriptWithGemini(
              window.cues.map((i) => segments[i]),
              window.text,
              targetLanguage,
              { signal: controller.signal }
            );
            // A passage that could only be spread by length stays where the file has it.
            const speech = window.cues.filter((i) => rows[i].englishText.trim());
            if (window.kind === 'collapsed' && speech.filter((i) => cues[window.cues.indexOf(i)].estimated).length > speech.length / 2) {
              unspread += 1;
              rows = rows.map((row, i) => (i === window.cues.find((c) => map.texts[c].trim()) ? { ...row, flag: 'collapsed' } : row));
              setDraft(rows);
              continue;
            }
            rows = rows.map((row, i) => {
              const at = window.cues.indexOf(i);
              if (at < 0) return row;
              const cue = cues[at];
              return { ...row, targetText: cue.targetText, fit: cue.fit, estimated: cue.estimated, flag: zero.has(i) ? 'zero-length' : cue.flag };
            });
            setDraft(rows);
          } catch (err) {
            if (controller.signal.aborted) break;
            console.warn('Placing by meaning failed; the lines stay as they were:', err);
            if (window.kind === 'collapsed') {
              unspread += 1;
              rows = rows.map((row, i) => (i === window.cues.find((c) => map.texts[c].trim()) ? { ...row, flag: 'collapsed' } : row));
              setDraft(rows);
            } else failed += 1;
          }
        }
      } finally {
        abortRef.current = null;
        setProgress(null);
      }
      if (controller.signal.aborted) notes.push('Stopped: lines not yet placed by meaning are left as they were.');
      else {
        const problems = [
          failed &&
            `${failed} ${failed === 1 ? 'line' : 'lines'} that run over several cues could not be placed by meaning, so they are split by length (marked Estimated).`,
          unspread &&
            `${unspread} ${unspread === 1 ? 'passage' : 'passages'} that sat in one cue could not be spread by meaning, so ${unspread === 1 ? 'it was' : 'they were'} left as in your file (marked Not spread).`,
        ].filter(Boolean);
        if (problems.length) setErrorMsg(problems.join(' '));
      }
    }
    const flagged = rows.filter(needsCheck).length;
    notes.push(
      flagged
        ? `${flagged} ${flagged === 1 ? 'cue needs' : 'cues need'} a look. Use "Only cues to check" to go through them.`
        : 'Every line found its cue.'
    );
    setNotice(notes.join(' '));
  };

  // A paste into the box, or an opened file, only picks the split: nothing is
  // matched until the button is pressed. One line or block per cue goes line by line.
  useEffect(() => {
    if (!pastePending.current) return;
    pastePending.current = false;
    const count = exportLines ?? cleaned.subtitleBlocks ?? (timed ? null : plainLines);
    if (count !== null && count > 1 && count === segments.length) setStrategy('line');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastedText, opened]);

  const openFile = async (file: File) => {
    try {
      const text = await file.text();
      const script = readDhvaniScript(text);
      if (script) {
        pastePending.current = true;
        setOpened({ name: file.name, script });
        resetFit();
      } else if (/\.json$/i.test(file.name)) {
        setErrorMsg(`${file.name} is not a script Dhvani saved.`);
      } else {
        setOpened(null);
        acceptPaste(text);
      }
    } catch {
      setErrorMsg(`${file.name} could not be read.`);
    }
  };

  const acceptPaste = (text: string) => {
    pastePending.current = true;
    setPastedText(text);
    resetFit();
  };

  const updateTexts = (texts: string[], touched: number[]) =>
    setDraft((rows) =>
      rows.map((row, i) =>
        // A cue edited by hand counts as checked.
        touched.includes(i)
          ? { ...row, targetText: texts[i], fit: undefined, estimated: false, flag: row.flag === 'zero-length' ? row.flag : undefined }
          : { ...row, targetText: texts[i] }
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
              Paste a {targetLanguage} script you already have. Each part is matched to the cue it translates, word for word as you wrote it. Nothing is translated and the timing doesn't change.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isAligning}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 disabled:opacity-40 transition-colors shrink-0 cursor-default"
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
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 min-h-[20px]">
                <label htmlFor="align-paste" className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">
                  Your script
                </label>
                {(pastedText || opened) && !isAligning && (
                  <button
                    type="button"
                    onClick={() => {
                      setPastedText('');
                      setOpened(null);
                      resetFit();
                    }}
                    className="text-[11.5px] text-slate-400 hover:text-slate-200 cursor-default"
                  >
                    Clear
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.txt,.srt,.vtt,application/json,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void openFile(file);
                }}
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isAligning}
                  onClick={() => fileInputRef.current?.click()}
                  title="Open a script file saved with Save script, or a .txt or .srt script"
                  className="h-9 px-3 flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-slate-700 bg-slate-950/60 hover:bg-slate-800 hover:border-slate-600 text-[12.5px] font-medium text-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-default"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  Open file
                </button>
                <button
                  type="button"
                  disabled={isAligning}
                  onClick={async () => {
                    try {
                      const text = await navigator.clipboard.readText();
                      if (text.trim()) {
                        setOpened(null);
                        acceptPaste(text);
                      } else setErrorMsg('The clipboard is empty.');
                    } catch {
                      setErrorMsg('The clipboard could not be read here. Paste into the box with Ctrl+V instead.');
                    }
                  }}
                  title="Paste from the clipboard"
                  className="h-9 px-3 flex items-center justify-center gap-2 whitespace-nowrap rounded-[10px] border border-slate-700 bg-slate-950/60 hover:bg-slate-800 hover:border-slate-600 text-[12.5px] font-medium text-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-default"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  Paste
                </button>
              </div>
            </div>
            {opened ? (
              <div className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-700 bg-slate-950/60">
                <FileText className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-slate-100 truncate" title={opened.name}>
                    {opened.name}
                  </span>
                  <span className="block text-[11.5px] text-slate-400">
                    {opened.script.kind === 'cues'
                      ? `${opened.script.file.cues.length} lines with their times${opened.script.file.targetLanguage ? ` · ${opened.script.file.targetLanguage}` : ''}`
                      : `${opened.script.lines.length} lines`}
                  </span>
                </span>
              </div>
            ) : (
            <textarea
              id="align-paste"
              value={pastedText}
              readOnly={isAligning}
              onPaste={() => {
                pastePending.current = true;
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
              placeholder={`Paste your ${targetLanguage} script: paragraphs, one line per cue, or an .srt file. Then press the button below to match it to the English.`}
              rows={7}
              className="w-full min-h-[10.5rem] resize-y bg-slate-950/60 border border-slate-700 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/15 rounded-xl px-3 py-2.5 text-[14px] leading-relaxed text-slate-100 placeholder-slate-500 focus:outline-none read-only:opacity-70"
            />
            )}
            {cleaned.text && (
              <span className="text-[11.5px] text-slate-500 tabular-nums">
                {countWords(cleaned.text).toLocaleString()} words · {cleaned.text.split('\n').filter((l) => l.trim()).length} lines
                {cleaned.subtitleBlocks !== null && ' · subtitle file'}
                {dhvani && ' · Dhvani script'}
              </span>
            )}

            {timed && !timedMismatch ? (
              <p className="flex items-start gap-2 p-2.5 rounded-[11px] border border-slate-800 text-[11.5px] text-slate-300">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px text-slate-400" />
                <span>
                  This script keeps each line's time, so each line goes to the cue at that time. A line that runs over several cues here is split
                  between them by meaning.
                </span>
              </p>
            ) : (
            <>
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
                    className={`flex items-start gap-2.5 p-2.5 rounded-[11px] border text-left transition-colors cursor-default disabled:cursor-not-allowed disabled:opacity-60 ${
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
            </>
            )}

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
                  className="h-[34px] rounded-[10px] border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-default"
                >
                  Stop
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void fit()}
                disabled={!cleaned.text}
                className="h-[38px] flex items-center justify-center gap-2 rounded-[10px] border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-[13px] font-semibold text-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-default"
              >
                {timed && !timedMismatch
                  ? hasAligned
                    ? 'Place it again'
                    : 'Place it by time'
                  : hasAligned
                    ? 'Split it again'
                    : strategy === 'ai'
                      ? 'Match it to the English'
                      : 'Split it into the cues'}
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
            {coverage && !isAligning && (
              <CoverageRange key={`${coverage.firstCue}-${coverage.lastCue}`} coverage={coverage} cueCount={segments.length} onApply={(range) => void fit(range)} />
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
                    <label className="ml-auto flex items-center gap-1.5 cursor-default select-none text-slate-300">
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
                    : item.flag === 'zero-length'
                      ? { label: 'Zero length', tone: 'amber', hint: 'This cue has no length in the timeline. Its line is kept; fix its timing before dubbing.' }
                    : item.flag === 'ran-out'
                      ? { label: 'Script ended', tone: 'rose', hint: 'Your script ended before this cue. If it does say this English, an earlier cue holds those words.' }
                    : item.flag === 'overrun'
                      ? { label: 'Check placement', tone: 'amber', hint: 'This part of your script took more than its English share. Check that these words are not from later cues.' }
                    : item.flag === 'collapsed'
                      ? { label: 'Not spread', tone: 'amber', hint: 'This passage seems to say the empty cues next to it too, but it could not be spread by meaning. Move its words by hand.' }
                    : item.flag === 'missing'
                      ? { label: 'Not in script', tone: 'rose', hint: 'Your script has nothing for this English, so the cue was left empty rather than filled.' }
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
                        className="mt-1.5 w-[22px] h-[22px] shrink-0 rounded-md border border-slate-800 text-slate-500 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 disabled:!opacity-20 cursor-default"
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
                        className="mt-1.5 w-[22px] h-[22px] shrink-0 rounded-md border border-slate-800 text-slate-500 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 disabled:!opacity-20 cursor-default"
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
                            {tooFast ? 'Too fast' : 'OK'}
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
            Replaces the {targetLanguage} in all {segments.length} cues. The transcript and its timing stay as they are, and you can undo it.
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={isAligning}
            className="h-[38px] px-3.5 rounded-[10px] border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-[13px] font-medium text-slate-200 disabled:opacity-40 cursor-default"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!hasAligned || filled === 0 || isAligning}
            className="h-[38px] px-4 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-default"
          >
            Use this script
          </button>
        </div>
      </section>
    </div>
  );
};
