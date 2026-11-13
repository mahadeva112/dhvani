import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, ClipboardPaste, FileText, FolderOpen, Gauge, Languages, RefreshCw, Scissors, X, Zap } from 'lucide-react';
import { AudioSegment } from '../types';
import { timingProblems } from '../services/transcriptSegments';
import { TranscriptExportMenu, TranscriptExportNotice, type TranscriptExportResult, type TranscriptFormat } from './TranscriptExportMenu';
import { TranscriptSegmentEditor, formatSplitTime } from './TranscriptSegmentEditor';
import { scrollWithin } from './scrollWithin';
import { translationFraction, type RetranslateProgress } from '../services/subtitleService';
import type { VoiceRate } from '../services/voiceRate';
import { reportError } from '../services/errorPopup';

/** Files the paste window can open: a saved script file, or a .txt or .srt script. */
const SCRIPT_FILE_ACCEPT = '.json,.txt,.srt,.vtt,application/json,text/plain';

interface TargetScriptChoiceProps {
  segments: AudioSegment[];
  /** Language ElevenLabs heard, when known. */
  spokenLanguage?: string;
  targetLanguage: string;
  languages: { code: string; label: string }[] | string[];
  onTargetLanguageChange: (lang: string) => void;
  isTranscribing: boolean;
  pipelineStatus?: string;
  isTranslating: boolean;
  translationProgress?: RetranslateProgress | null;
  /** Stops a running translation; nothing it did is applied. */
  onCancelTranslation?: () => void;
  translationStyleName: string;
  /** Where translation runs, e.g. "Your gateway — gpt-4.1". */
  translationSummary?: string | null;
  /** False when no translation engine is set up. */
  translationReady?: boolean;
  onOpenPromptModal: () => void;
  /** The dub voice's measured speaking rate, or null before its sample is read. */
  voiceRate?: VoiceRate | null;
  voiceName?: string;
  /** How many speakers' own voices have been measured too; their cues are sized for those. */
  ownVoiceRates?: number;
  /** Translation sizes each cue for that rate. */
  fitToVoice?: boolean;
  onFitToVoiceChange?: (on: boolean) => void;
  /** Runs the existing translation on the transcript. Only called from the button here. */
  onTranslate: () => Promise<void>;
  /** Fast translate: translation only, no meaning, length or term checks. */
  onFastTranslate?: () => Promise<void>;
  /** Opens the paste-and-align dialog, with any text pasted or file dropped here. Never translates. */
  onUseOwnScript: (script?: { text?: string; file?: File }) => void;
  onSeek?: (time: number) => void;
  activeSegmentId?: string | number | null;
  /** Saves the transcript as a file; omitted hides Export. */
  onExport?: (format: TranscriptFormat) => Promise<TranscriptExportResult>;
  /** Puts a split or merged cut on the project; omitted hides Edit segments. */
  onApplySegments?: (segments: AudioSegment[]) => void;
  /** The segments as transcribed, kept from the first split or merge, for Reset. */
  transcriptCuts?: AudioSegment[] | null;
  /** Plays the original between two times. */
  onHear?: (start: number, end: number) => void;
  /** Where the playhead is on the original's clock: S splits the segment there. */
  getPlayhead?: () => number;
}

/** 125.4 -> "2:05.4" */
const formatCueTime = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

/** 125.4 -> "2:05" */
const formatLength = (seconds: number) => {
  const t = Math.max(0, Math.round(seconds || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * Shown on Review while a transcript waits for its target-language script.
 * Transcription is done; nothing has been translated. The user picks
 * automatic translation (the existing prompt and engine, which spends
 * translation credits) or their own translated script, which is only aligned
 * to the transcript's cues and never translated.
 */
export const TargetScriptChoice: React.FC<TargetScriptChoiceProps> = ({
  segments,
  spokenLanguage = '',
  targetLanguage,
  languages,
  onTargetLanguageChange,
  isTranscribing,
  pipelineStatus = '',
  isTranslating,
  onCancelTranslation,
  translationProgress = null,
  translationStyleName,
  translationSummary,
  translationReady = true,
  onOpenPromptModal,
  voiceRate = null,
  voiceName = '',
  ownVoiceRates = 0,
  fitToVoice = true,
  onFitToVoiceChange,
  onTranslate,
  onFastTranslate,
  onUseOwnScript,
  onSeek,
  activeSegmentId = null,
  onExport,
  onApplySegments,
  transcriptCuts = null,
  onHear,
  getPlayhead,
}) => {
  const [editing, setEditing] = useState(false);
  /** Which button the running translation came from, for its spinner. */
  const [fastRunning, setFastRunning] = useState(false);
  /** The playhead time S was pressed at, to split as the editor opens. */
  const [splitOnOpen, setSplitOnOpen] = useState<number | null>(null);
  const [exportResult, setExportResult] = useState<TranscriptExportResult | null>(null);
  /** A file dragged over the paste drop zone. */
  const [dragOver, setDragOver] = useState(false);
  const listRef = useRef<HTMLOListElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Keep the cue being played in view.
  useEffect(() => {
    if (activeSegmentId === null || !listRef.current) return;
    const row = listRef.current.querySelector<HTMLElement>(`[data-cue-id="${CSS.escape(String(activeSegmentId))}"]`);
    scrollWithin(row);
  }, [activeSegmentId]);

  const spoken = segments.filter((s) => (s.textSource || s.originalText || '').trim());
  const hasTranscript = spoken.length > 0;
  const length = segments.length ? segments[segments.length - 1].endTime : 0;
  const sameLanguage = Boolean(spokenLanguage) && spokenLanguage.toLowerCase() === targetLanguage.toLowerCase();
  const translateBlocked = !sameLanguage && !translationReady;
  const busy = isTranscribing || isTranslating;
  // S on the transcript opens segment editing with a split at the playhead.
  useEffect(() => {
    if (editing || !onApplySegments || !getPlayhead || !hasTranscript || busy) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.toLowerCase() !== 's') return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      setExportResult(null);
      setSplitOnOpen(getPlayhead());
      setEditing(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onApplySegments, getPlayhead, hasTranscript, busy]);

  // Ctrl+V on the page (outside a text box) opens the paste window with that text.
  const pasteReady = hasTranscript && !busy && !editing;
  useEffect(() => {
    if (!pasteReady) return;
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const text = e.clipboardData?.getData('text/plain') || '';
      if (!text.trim()) return;
      e.preventDefault();
      onUseOwnScript({ text });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pasteReady, onUseOwnScript]);

  const flagged = useMemo(() => new Map(timingProblems(segments).map((p) => [String(p.id), p])), [segments]);
  const fraction = translationFraction(translationProgress);
  const percent = fraction === null ? null : Math.round(fraction * 100);
  const translatingLabel = fastRunning
    ? 'Fast translating'
    : translationProgress?.step === 'check'
      ? 'Checking meaning and length'
      : 'Translating';

  const handleTranslate = async () => {
    try {
      await onTranslate();
    } catch (err: any) {
      reportError(err, {
        title: `Translation to ${targetLanguage} failed`,
        safe: 'Your transcript and timestamps are intact. You can also use your own script instead.',
        retry: handleTranslate,
      });
    }
  };

  const handleFastTranslate = async () => {
    if (!onFastTranslate) return;
    setFastRunning(true);
    try {
      await onFastTranslate();
    } catch (err: any) {
      reportError(err, {
        title: `Fast translation to ${targetLanguage} failed`,
        safe: 'Your transcript and timestamps are intact. You can also use your own script instead.',
        retry: handleFastTranslate,
      });
    } finally {
      setFastRunning(false);
    }
  };
  const showFast = !sameLanguage && Boolean(onFastTranslate);
  const translateDisabled = busy || editing || !hasTranscript || translateBlocked;
  const pasteDisabled = !pasteReady;

  const chip = (label: string, tone: 'amber' | 'green' | 'grey') => (
    <span
      className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
        tone === 'amber' ? 'bg-amber-500/15 text-amber-300' : tone === 'green' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-300'
      }`}
    >
      {label}
    </span>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_27rem] gap-4 lg:h-[calc(100vh-7rem)] lg:min-h-[560px]">
      {/* The transcript, read-only, with the timestamps every script will use */}
      <section
        aria-label="Transcript"
        className="flex flex-col min-h-0 h-[60vh] lg:h-auto bg-slate-900/90 border border-edge rounded-2xl overflow-hidden"
      >
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 border-b border-edge">
          <FileText className="w-4 h-4 text-slate-400" aria-hidden="true" />
          <h2 className="text-[14px] font-semibold text-slate-100">Transcript</h2>
          {hasTranscript && !isTranscribing && !editing && (
            <span className="text-xs text-slate-400 tabular-nums">
              {segments.length} {segments.length === 1 ? 'segment' : 'segments'} · {formatLength(length)}
              {spokenLanguage ? ` · ${spokenLanguage}` : ''}
            </span>
          )}
          {!editing && (
            <div className="ml-auto flex items-center gap-2">
              {onApplySegments && hasTranscript && !busy && (
                <button
                  type="button"
                  onClick={() => {
                    setExportResult(null);
                    setSplitOnOpen(null);
                    setEditing(true);
                  }}
                  className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg border border-edge bg-slate-950 hover:bg-slate-800 text-[12px] font-medium text-slate-200 cursor-default"
                  title="Split or merge segments before you translate. Optional. Or play to a point and press S."
                >
                  <Scissors className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  Edit segments
                </button>
              )}
              {onExport && (
                <TranscriptExportMenu
                  onExport={onExport}
                  onResult={setExportResult}
                  disabled={!hasTranscript || isTranscribing}
                  segmentCount={segments.length}
                  translated={false}
                />
              )}
              {!onExport && !onApplySegments && <span className="text-[11.5px] text-slate-500">Timestamps from the audio</span>}
            </div>
          )}
        </div>

        {editing && onApplySegments ? (
          <TranscriptSegmentEditor
            segments={segments}
            transcriptCuts={transcriptCuts}
            onApply={(next) => {
              onApplySegments(next);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
            onHear={onHear}
            formatTime={formatSplitTime}
            getPlayhead={getPlayhead}
            initialSplitTime={splitOnOpen}
          />
        ) : isTranscribing ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center" role="status" aria-live="polite">
            <RefreshCw className="w-5 h-5 text-indigo-300 animate-spin" />
            <p className="text-sm font-semibold text-slate-200">Transcribing</p>
            <p className="text-xs text-slate-400 font-mono max-w-sm truncate">{pipelineStatus || 'Working…'}</p>
          </div>
        ) : !hasTranscript ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm font-semibold text-slate-300">No transcript yet</p>
            <p className="text-xs text-slate-500">Go back to Source and voice and transcribe the audio.</p>
          </div>
        ) : (
          <ol ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar divide-y divide-slate-800/70">
            {segments.map((seg, i) => {
              const text = seg.textSource || seg.originalText || '';
              const on = activeSegmentId === seg.id;
              const problem = flagged.get(String(seg.id));
              const estimated = seg.timingSource === 'derived';
              return (
                <li key={seg.id} data-cue-id={String(seg.id)} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 44px' }}>
                  <button
                    type="button"
                    onClick={() => Number.isFinite(seg.startTime) && onSeek?.(seg.startTime)}
                    className={`w-full grid grid-cols-[2rem_7.5rem_minmax(0,1fr)] gap-2.5 items-baseline px-4 py-2.5 text-left transition-colors cursor-default ${
                      on ? 'bg-indigo-500/10' : problem ? 'bg-rose-500/[0.06] hover:bg-rose-500/10' : 'hover:bg-slate-800/40'
                    }`}
                    title={problem ? 'Check this segment’s timing' : 'Play from here'}
                  >
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                    <span className={`font-mono text-[11px] tabular-nums ${problem ? 'text-rose-300' : estimated ? 'text-amber-300' : 'text-slate-400'}`}>
                      {Number.isFinite(seg.startTime) ? formatCueTime(seg.startTime) : '—'}–{Number.isFinite(seg.endTime) ? formatCueTime(seg.endTime) : '—'}
                      {problem ? (
                        <span className="block text-[9.5px] font-sans font-semibold text-rose-300/90">check timing</span>
                      ) : estimated ? (
                        <span className="block text-[9.5px] font-sans font-semibold text-amber-300/80">estimated</span>
                      ) : null}
                    </span>
                    <span className="text-[13px] leading-snug text-slate-200">
                      {text || <span className="italic text-slate-600">No speech</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {!editing && (
          <TranscriptExportNotice
            result={exportResult}
            onDismiss={() => setExportResult(null)}
            onShowSegment={(index) => {
              const seg = segments[index];
              if (!seg) return;
              scrollWithin(listRef.current?.querySelector(`[data-cue-id="${CSS.escape(String(seg.id))}"]`), 'center');
              if (Number.isFinite(seg.startTime)) onSeek?.(seg.startTime);
            }}
            onSaveJson={
              onExport
                ? () =>
                    void onExport('json')
                      .then(setExportResult)
                      .catch((err) => reportError(err, { title: 'Exporting the transcript failed', safe: 'Your transcript is unchanged.' }))
                : undefined
            }
          />
        )}
      </section>

      {/* The two ways to get the script, each with its own button */}
      <aside aria-label="Get the script" className="bg-slate-900/90 border border-edge rounded-2xl overflow-hidden flex flex-col min-h-0">
        <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-edge">
          <h2 className="text-[15px] font-semibold text-slate-100">Get the {targetLanguage} script</h2>
          <p className="text-[12px] text-slate-400 mt-0.5">The transcript is ready. Nothing has been translated yet.</p>
        </div>

        <div className="px-4 sm:px-5 py-3 flex items-center gap-2">
          <label htmlFor="target-choice-lang" className="text-xs text-slate-400 shrink-0">
            Dub into
          </label>
          <div className="relative flex-1 min-w-0 group">
            <select
              id="target-choice-lang"
              value={targetLanguage}
              disabled={busy}
              onChange={(e) => onTargetLanguageChange(e.target.value)}
              className="appearance-none w-full h-9 bg-slate-950 border border-edge hover:border-slate-600 rounded-lg pl-2.5 pr-8 text-[13px] font-medium text-slate-100 focus:outline-none focus:border-indigo-500 cursor-default disabled:opacity-60"
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
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          </div>
        </div>

        <div className="px-4 sm:px-5 pb-4 flex flex-col gap-2 overflow-y-auto custom-scrollbar min-h-0">
          {/* Translate */}
          <section
            aria-label={sameLanguage ? 'Use the transcript' : 'Translate automatically'}
            className={`rounded-xl border bg-slate-950/40 p-3.5 flex flex-col gap-3 ${
              isTranslating ? 'border-indigo-500 ring-4 ring-indigo-500/10' : 'border-edge'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0" aria-hidden="true">
                <Languages className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-slate-100">
                  {sameLanguage ? 'Use the transcript as the script' : 'Translate automatically'}
                </span>
                <span className="block text-[12px] text-slate-400 mt-0.5 leading-snug">
                  {sameLanguage
                    ? `It's already in ${targetLanguage}, so it's used as-is.`
                    : `Each line written in ${targetLanguage}, on the transcript's timestamps.`}
                </span>
              </span>
              {sameLanguage ? chip('No credits used', 'green') : chip('Uses credits', 'amber')}
            </div>

            {!sameLanguage && (
              <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-slate-900 border border-edge">
                <span className="text-[11.5px] text-slate-500 shrink-0">Style</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-semibold text-slate-100 truncate">{translationStyleName}</span>
                  {translationSummary && <span className="block text-[11px] text-slate-500 truncate">{translationSummary}</span>}
                </span>
                <button
                  type="button"
                  onClick={onOpenPromptModal}
                  disabled={busy}
                  className="px-2 py-0.5 rounded-md border border-edge hover:bg-slate-800 text-[11.5px] font-medium text-slate-200 disabled:opacity-40 cursor-default"
                >
                  Change
                </button>
              </div>
            )}

            {!sameLanguage && onFitToVoiceChange && (
              voiceRate ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={fitToVoice}
                  disabled={busy}
                  onClick={() => onFitToVoiceChange(!fitToVoice)}
                  title={`Each line is translated to about the syllables its voice can say in the time the speaker took, without dropping meaning.${
                    ownVoiceRates > 0 ? ` ${ownVoiceRates} speaker${ownVoiceRates > 1 ? 's have their' : ' has their'} own voice measured too.` : ''
                  }`}
                  className="flex items-start gap-2.5 text-left disabled:opacity-60 cursor-default"
                >
                  <span
                    className={`relative w-[30px] h-[17px] mt-0.5 rounded-full shrink-0 transition-colors ${fitToVoice ? 'bg-indigo-500' : 'bg-slate-700'}`}
                    aria-hidden="true"
                  >
                    <span
                      className={`absolute top-[2px] w-[13px] h-[13px] rounded-full bg-slate-100 transition-[left] ${fitToVoice ? 'left-[15px]' : 'left-[2px]'}`}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium text-slate-100">Fit to the voice's speed</span>
                    <span className="block text-[11px] text-slate-500 leading-snug">
                      {voiceName || 'Your voice'} speaks {targetLanguage} at {voiceRate.syllablesPerSecond.toFixed(1)} syllables/s
                    </span>
                  </span>
                </button>
              ) : (
                <p className="flex items-start gap-1.5 text-[11px] text-slate-500 leading-snug">
                  <Gauge className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                  Once your voice has read its sample in step 1, the translation can be sized for its speed.
                </p>
              )
            )}

            {translateBlocked && (
              <p className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[12px] text-amber-200 leading-snug">
                <AlertTriangle className="w-4 h-4 mt-px text-amber-300 shrink-0" aria-hidden="true" />
                No translation engine is set up. Add one in API settings, or use your own script.
              </p>
            )}

            {isTranslating ? (
              <div className="flex flex-col gap-2" role="status" aria-live="polite">
                <div className="flex items-center gap-2 text-[12.5px] text-slate-200">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-300" aria-hidden="true" />
                  <span>{translatingLabel}{percent === null ? '…' : ''}</span>
                  {percent !== null && <span className="ml-auto font-mono text-slate-400 tabular-nums">{percent}%</span>}
                </div>
                <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full bg-indigo-500 transition-[width] duration-500 ${percent === null ? 'w-1/4 animate-pulse' : ''}`}
                    style={percent === null ? undefined : { width: `${percent}%` }}
                  />
                </div>
                {onCancelTranslation && (
                  <button
                    type="button"
                    onClick={onCancelTranslation}
                    className="h-9 flex items-center justify-center gap-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-200 text-[13px] font-medium cursor-default"
                    title="Stop the translation. Nothing it did is applied; the transcript stays as it is."
                  >
                    <X className="w-4 h-4" /> Cancel translation
                  </button>
                )}
                {fastRunning && <p className="text-[11px] text-slate-500">Run the full Translate later if a line needs fixing.</p>}
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTranslate()}
                    disabled={translateDisabled}
                    className="flex-1 min-w-0 h-10 px-3 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-default active:translate-y-px"
                  >
                    <span className="truncate">{sameLanguage ? `Use the ${targetLanguage} transcript` : `Translate to ${targetLanguage}`}</span>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </button>
                  {showFast && (
                    <button
                      type="button"
                      onClick={() => void handleFastTranslate()}
                      disabled={translateDisabled}
                      title={`Fast translate to ${targetLanguage}: translation only. Skips meaning, length and term checks.`}
                      className="h-10 px-3 flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-100 text-sm font-medium transition-colors disabled:text-slate-500 disabled:hover:bg-slate-900 disabled:cursor-not-allowed cursor-default active:translate-y-px"
                    >
                      <Zap className="w-4 h-4" aria-hidden="true" />
                      Fast
                    </button>
                  )}
                </div>
                <p className="-mt-1 text-[11px] text-slate-500 leading-snug">
                  {editing
                    ? 'Apply or cancel your segment changes first.'
                    : sameLanguage
                      ? 'Nothing is sent anywhere.'
                      : `Sends ${spoken.length} ${spoken.length === 1 ? 'line' : 'lines'} to your translation engine.`}
                </p>
              </>
            )}
          </section>

          <div className="flex items-center gap-3 text-[11px] text-slate-600 my-0.5" aria-hidden="true">
            <span className="flex-1 h-px bg-slate-800" />
            or
            <span className="flex-1 h-px bg-slate-800" />
          </div>

          {/* Paste my script */}
          <section
            aria-label={`Use my ${targetLanguage} script`}
            className={`rounded-xl border border-edge bg-slate-950/40 p-3.5 flex flex-col gap-3 transition-opacity ${pasteDisabled ? 'opacity-50' : ''}`}
          >
            <div className="flex items-start gap-2.5">
              <span className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-300 flex items-center justify-center shrink-0" aria-hidden="true">
                <ClipboardPaste className="w-4 h-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold text-slate-100">Use my {targetLanguage} script</span>
                <span className="block text-[12px] text-slate-400 mt-0.5 leading-snug">
                  Matched to the lines by meaning. Your words stay exactly as written.
                </span>
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={SCRIPT_FILE_ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onUseOwnScript({ file });
              }}
            />
            <div
              onDragOver={(e) => {
                if (pasteDisabled || !e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                setDragOver(false);
                const file = e.dataTransfer.files?.[0];
                if (pasteDisabled || !file) return;
                e.preventDefault();
                onUseOwnScript({ file });
              }}
              className={`rounded-xl border-[1.5px] border-dashed px-3 py-3.5 flex flex-col items-center gap-2.5 text-center transition-colors ${
                dragOver ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-700'
              }`}
            >
              <span className="text-[12.5px] text-slate-300">
                Press <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded border border-slate-600 text-slate-200">Ctrl+V</kbd> to paste, or drop a file
              </span>
              <span className="flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => onUseOwnScript()}
                  disabled={pasteDisabled}
                  className="h-9 px-3 flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[12.5px] font-medium text-slate-100 disabled:cursor-not-allowed cursor-default active:translate-y-px"
                >
                  <ClipboardPaste className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  Paste script
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={pasteDisabled}
                  title="Open a script file saved with Save script, or a .txt or .srt script"
                  className="h-9 px-3 flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[12.5px] font-medium text-slate-100 disabled:cursor-not-allowed cursor-default active:translate-y-px"
                >
                  <FolderOpen className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  Open file
                </button>
              </span>
            </div>

            <span className="flex flex-wrap gap-1.5">
              {chip('Not translated', 'green')}
              {chip('Keeps timestamps', 'grey')}
              {chip('No credits', 'grey')}
            </span>
          </section>
        </div>
      </aside>
    </div>
  );
};
