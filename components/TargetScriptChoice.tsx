import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ChevronDown, ClipboardPaste, FileText, Gauge, Languages, RefreshCw, Scissors, Zap } from 'lucide-react';
import { AudioSegment } from '../types';
import { timingProblems } from '../services/transcriptSegments';
import { TranscriptExportMenu, TranscriptExportNotice, type TranscriptExportResult, type TranscriptFormat } from './TranscriptExportMenu';
import { TranscriptSegmentEditor, formatSplitTime } from './TranscriptSegmentEditor';
import { scrollWithin } from './scrollWithin';
import { translationFraction, type RetranslateProgress } from '../services/subtitleService';
import type { VoiceRate } from '../services/voiceRate';
import { reportError } from '../services/errorPopup';

export type TargetMethod = 'translate' | 'custom';

const METHOD_STORAGE_KEY = 'dhvani_target_method';

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
  /** Opens the paste-and-align dialog. Never translates. */
  onUseOwnScript: () => void;
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
  const [method, setMethod] = useState<TargetMethod>(() => {
    try {
      return localStorage.getItem(METHOD_STORAGE_KEY) === 'custom' ? 'custom' : 'translate';
    } catch {
      return 'translate';
    }
  });
  const listRef = useRef<HTMLOListElement | null>(null);

  const chooseMethod = (next: TargetMethod) => {
    setMethod(next);
    try {
      localStorage.setItem(METHOD_STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  };

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
  const translateBlocked = method === 'translate' && !sameLanguage && !translationReady;
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

  const flagged = useMemo(() => new Map(timingProblems(segments).map((p) => [String(p.id), p])), [segments]);
  const fraction = translationFraction(translationProgress);
  const percent = fraction === null ? null : Math.round(fraction * 100);
  const translatingLabel = translationProgress?.step === 'check' ? 'Checking meaning and length' : 'Translating';

  const handleContinue = async () => {
    if (method === 'custom') {
      onUseOwnScript();
      return;
    }
    try {
      await onTranslate();
    } catch (err: any) {
      reportError(err, {
        title: `Translation to ${targetLanguage} failed`,
        safe: 'Your transcript and timestamps are intact. You can also use your own script instead.',
        retry: handleContinue,
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
  const showFast = method === 'translate' && !sameLanguage && Boolean(onFastTranslate);
  const fastSpinning = isTranslating && fastRunning;

  const optionClass = (on: boolean) =>
    `w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors cursor-default disabled:cursor-not-allowed disabled:opacity-60 ${
      on ? 'border-indigo-500 ring-4 ring-indigo-500/10 bg-slate-950/40' : 'border-slate-800 hover:bg-slate-800/40'
    }`;

  const radioDot = (on: boolean) => (
    <span
      className={`w-[15px] h-[15px] mt-1 rounded-full border-[1.5px] flex items-center justify-center shrink-0 ${
        on ? 'border-indigo-400' : 'border-slate-600'
      }`}
    >
      {on && <span className="w-[7px] h-[7px] rounded-full bg-indigo-400" />}
    </span>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_24rem] 2xl:grid-cols-[minmax(0,1fr)_27rem] gap-4 lg:h-[calc(100vh-7rem)] lg:min-h-[560px]">
      {/* The transcript, read-only, with the timestamps every script will use */}
      <section
        aria-label="Transcript"
        className="flex flex-col min-h-0 h-[60vh] lg:h-auto bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden"
      >
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 border-b border-slate-800">
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
                  className="h-8 px-2.5 flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950 hover:bg-slate-800 text-[12px] font-medium text-slate-200 cursor-default"
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

      {/* The choice */}
      <aside aria-label="Choose your script" className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden flex flex-col min-h-0">
        <div className="px-4 sm:px-5 pt-4 pb-3">
          <h2 className="text-[15px] font-semibold text-slate-100">Choose your {targetLanguage} script</h2>
          <p className="text-[12px] text-slate-400 mt-1 leading-relaxed">
            The transcript is ready. Nothing has been translated yet.
          </p>
        </div>

        <div className="px-4 sm:px-5 pb-4 flex items-center gap-2">
          <label htmlFor="target-choice-lang" className="text-xs text-slate-400 shrink-0">
            Dub into
          </label>
          <div className="relative flex-1 min-w-0 group">
            <select
              id="target-choice-lang"
              value={targetLanguage}
              disabled={busy}
              onChange={(e) => onTargetLanguageChange(e.target.value)}
              className="appearance-none w-full h-9 bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-lg pl-2.5 pr-8 text-[13px] font-medium text-slate-100 focus:outline-none focus:border-indigo-500 cursor-default disabled:opacity-60"
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

        <div role="radiogroup" aria-label="How to get the script" className="px-4 sm:px-5 pb-4 flex flex-col gap-2.5 overflow-y-auto">
          <button
            type="button"
            role="radio"
            aria-checked={method === 'translate'}
            disabled={busy}
            onClick={() => chooseMethod('translate')}
            className={optionClass(method === 'translate')}
          >
            {radioDot(method === 'translate')}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-100">
                <Languages className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                {sameLanguage ? 'Use the transcript as the script' : 'Translate automatically'}
              </span>
              <span className="block text-[12px] text-slate-400 mt-1 leading-snug">
                {sameLanguage
                  ? `The transcript is already in ${targetLanguage}, so it's used as-is. Nothing is sent for translation.`
                  : `Your translation style writes each cue in ${targetLanguage}, on the transcript's timestamps.`}
              </span>
              <span className="flex flex-wrap gap-1.5 mt-2">
                {sameLanguage ? (
                  <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">No credits used</span>
                ) : (
                  <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">Uses translation credits</span>
                )}
              </span>
            </span>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={method === 'custom'}
            disabled={busy}
            onClick={() => chooseMethod('custom')}
            className={optionClass(method === 'custom')}
          >
            {radioDot(method === 'custom')}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-100">
                <ClipboardPaste className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                Use my translated script
              </span>
              <span className="block text-[12px] text-slate-400 mt-1 leading-snug">
                Paste a {targetLanguage} script you already have. It's matched to the cues by meaning. Your words stay exactly as written and the timestamps don't change.
              </span>
              <span className="flex flex-wrap gap-1.5 mt-2">
                <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">Not translated</span>
                <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">Keeps timestamps</span>
              </span>
            </span>
          </button>

          {method === 'translate' && !sameLanguage && (
            <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-slate-100 truncate">{translationStyleName}</span>
                <span className="block text-[11px] text-slate-500 truncate">
                  {translationSummary || 'Translation style'}
                </span>
              </span>
              <button
                type="button"
                onClick={onOpenPromptModal}
                disabled={busy}
                className="px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[11.5px] font-medium text-slate-200 disabled:opacity-40 cursor-default"
              >
                Change
              </button>
            </div>
          )}

          {method === 'translate' && !sameLanguage && onFitToVoiceChange && (
            voiceRate ? (
              <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 cursor-default">
                <input
                  type="checkbox"
                  checked={fitToVoice}
                  disabled={busy}
                  onChange={(e) => onFitToVoiceChange(e.target.checked)}
                  className="mt-0.5 accent-indigo-500 cursor-default"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-100">
                    <Gauge className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                    Fit the translation to the voice's speed
                  </span>
                  <span className="block text-[11px] text-slate-500 leading-snug mt-0.5">
                    {voiceName || 'Your voice'} speaks {targetLanguage} at {voiceRate.syllablesPerSecond.toFixed(1)} syllables/s
                    {ownVoiceRates > 0 ? `, and ${ownVoiceRates} speaker${ownVoiceRates > 1 ? 's have their' : ' has their'} own voice measured too` : ''}. Each cue is
                    translated to about the syllables its voice can say in the time the speaker took, without dropping meaning.
                  </span>
                </span>
              </label>
            ) : (
              <p className="flex items-start gap-1.5 text-[11px] text-slate-500 leading-snug px-1">
                <Gauge className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                Once your voice has read its sample in step 1, the translation can be sized for its speed.
              </p>
            )
          )}
        </div>

        <div className="mt-auto px-4 sm:px-5 py-4 border-t border-slate-800 bg-slate-950/60 flex flex-col gap-2.5">
          {showFast && (
            <>
              <button
                type="button"
                onClick={() => void handleFastTranslate()}
                disabled={busy || editing || !hasTranscript || translateBlocked}
                className="h-10 flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-100 text-sm font-medium transition-colors disabled:text-slate-500 disabled:hover:bg-slate-900 disabled:cursor-not-allowed cursor-default active:translate-y-px"
              >
                {fastSpinning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Fast translating{percent !== null ? ` · ${percent}%` : '…'}</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" aria-hidden="true" />
                    <span>Fast translate to {targetLanguage}</span>
                  </>
                )}
              </button>
              <p className="-mt-1 mb-0.5 text-[11px] text-slate-500 text-center">
                Translation only. Skips meaning, length and term checks.
              </p>
            </>
          )}
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={busy || editing || !hasTranscript || translateBlocked}
            className="h-11 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-default active:translate-y-px"
          >
            {isTranslating && !fastSpinning ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{translatingLabel}{percent !== null ? ` · ${percent}%` : '…'}</span>
              </>
            ) : method === 'custom' ? (
              <>
                <ClipboardPaste className="w-4 h-4" />
                <span>Paste your script</span>
              </>
            ) : (
              <>
                <span>{sameLanguage ? `Use the ${targetLanguage} transcript` : `Translate to ${targetLanguage}`}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          {editing ? (
            <p className="text-[11.5px] text-slate-400 text-center">Apply or cancel your segment changes first.</p>
          ) : fastSpinning ? (
            <p className="text-[11.5px] text-slate-500 text-center">Run the full Translate later if a line needs fixing.</p>
          ) : translateBlocked ? (
            <p className="text-[11.5px] text-amber-300 text-center">
              No translation engine is set up. Add one in API settings, or use your own script.
            </p>
          ) : (
            <p className="text-[11.5px] text-slate-500 text-center">
              {method === 'custom'
                ? 'Nothing is translated. The transcript timings are reused.'
                : sameLanguage
                  ? 'Nothing is sent anywhere.'
                  : `Sends ${spoken.length} ${spoken.length === 1 ? 'cue' : 'cues'} to your translation engine.`}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
};
