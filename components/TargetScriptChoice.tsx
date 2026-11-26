import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, ClipboardPaste, FolderOpen, Gauge, Languages, RefreshCw, X, Zap } from 'lucide-react';
import { AudioSegment } from '../types';
import type { TranscriptExportResult, TranscriptFormat } from './TranscriptExportMenu';
import { TranscriptPanel } from './TranscriptPanel';
import { Select, languageOptions } from './Select';
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
  /** Fast translate: written sentence by sentence like Natural, no meaning, length or term checks. */
  onFastTranslate?: () => Promise<void>;
  /** Natural: each sentence written whole in spoken language, then cut back onto its cues. */
  onNaturalTranslate?: () => Promise<void>;
  /** Opens the paste-and-align dialog, with any text pasted or file dropped here. Never translates. */
  onUseOwnScript: (script?: { text?: string; file?: File }) => void;
  onSeek?: (time: number) => void;
  activeSegmentId?: string | number | null;
  /** Saves the transcript as a file; omitted hides Export. */
  onExport?: (format: TranscriptFormat) => Promise<TranscriptExportResult>;
  /** Saves the edited transcript as one Undo step; omitted hides Edit. */
  onApplySegments?: (segments: AudioSegment[]) => void;
  /** The segments as transcribed, kept from the first split or merge, for Reset. */
  transcriptCuts?: AudioSegment[] | null;
  /** Plays the original between two times. */
  onHear?: (start: number, end: number) => void;
  /** Where the playhead is on the original's clock: S splits the segment there. */
  getPlayhead?: () => number;
}

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
  onNaturalTranslate,
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
  const [naturalRunning, setNaturalRunning] = useState(false);
  /** A file dragged over the paste drop zone. */
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const spoken = segments.filter((s) => (s.textSource || s.originalText || '').trim());
  const hasTranscript = spoken.length > 0;

  const sameLanguage = Boolean(spokenLanguage) && spokenLanguage.toLowerCase() === targetLanguage.toLowerCase();
  const translateBlocked = !sameLanguage && !translationReady;
  const busy = isTranscribing || isTranslating;
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

  const fraction = translationFraction(translationProgress);
  const percent = fraction === null ? null : Math.round(fraction * 100);
  const translatingLabel = fastRunning
    ? 'Fast translating'
    : naturalRunning
      ? 'Natural translating'
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
  const handleNaturalTranslate = async () => {
    if (!onNaturalTranslate) return;
    setNaturalRunning(true);
    try {
      await onNaturalTranslate();
    } catch (err: any) {
      reportError(err, {
        title: `Natural translation to ${targetLanguage} failed`,
        safe: 'Your transcript and timestamps are intact. You can also use your own script instead.',
        retry: handleNaturalTranslate,
      });
    } finally {
      setNaturalRunning(false);
    }
  };
  const showFast = !sameLanguage && Boolean(onFastTranslate);
  const showNatural = !sameLanguage && Boolean(onNaturalTranslate);
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
      {/* The transcript with the timestamps every script will use, and its one Edit */}
      <TranscriptPanel
        className="h-[60vh] lg:h-auto"
        segments={segments}
        spokenLanguage={spokenLanguage}
        isTranscribing={isTranscribing}
        pipelineStatus={pipelineStatus}
        busy={isTranslating}
        onSeek={onSeek}
        activeSegmentId={activeSegmentId}
        onExport={onExport}
        onApplySegments={onApplySegments}
        transcriptCuts={transcriptCuts}
        onHear={onHear}
        getPlayhead={getPlayhead}
        onEditingChange={setEditing}
        emptyHint="Go back to Setup and transcribe the audio."
      />

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
          <Select
            id="target-choice-lang"
            value={targetLanguage}
            disabled={busy}
            onChange={onTargetLanguageChange}
            className="flex-1"
            rememberAs="dub-language"
            options={languageOptions(languages)}
          />
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
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTranslate()}
                    disabled={translateDisabled}
                    className="w-full min-w-0 h-10 px-3 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-default active:translate-y-px"
                  >
                    <span className="truncate">{sameLanguage ? `Use the ${targetLanguage} transcript` : `Translate to ${targetLanguage}`}</span>
                    <ArrowRight className="w-4 h-4 shrink-0" />
                  </button>
                  {(showFast || showNatural) && (
                    <div className="flex gap-2">
                      {showFast && (
                        <button
                          type="button"
                          onClick={() => void handleFastTranslate()}
                          disabled={translateDisabled}
                          title={`Fast translate to ${targetLanguage}: whole sentences in everyday spoken words, quickly. Skips meaning, length and term checks.`}
                          className="flex-1 min-w-0 h-10 px-3 flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-100 text-sm font-medium transition-colors disabled:text-slate-500 disabled:hover:bg-slate-900 disabled:cursor-not-allowed cursor-default active:translate-y-px"
                        >
                          <Zap className="w-4 h-4" aria-hidden="true" />
                          Fast
                        </button>
                      )}
                      {showNatural && (
                        <button
                          type="button"
                          onClick={() => void handleNaturalTranslate()}
                          disabled={translateDisabled}
                          title={`Translate to ${targetLanguage} sentence by sentence, the way it is spoken, then cut each sentence back onto its cues.`}
                          className="flex-1 min-w-0 h-10 px-3 flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-100 text-sm font-medium transition-colors disabled:text-slate-500 disabled:hover:bg-slate-900 disabled:cursor-not-allowed cursor-default active:translate-y-px"
                        >
                          <Languages className="w-4 h-4" aria-hidden="true" />
                          Natural
                        </button>
                      )}
                    </div>
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
