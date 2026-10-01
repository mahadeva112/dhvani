import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, ChevronDown, ClipboardPaste, FileText, Languages, RefreshCw } from 'lucide-react';
import { AudioSegment } from '../types';
import type { RetranslateProgress } from '../services/subtitleService';

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
  /** Runs the existing translation on the transcript. Only called from the button here. */
  onTranslate: () => Promise<void>;
  /** Opens the paste-and-align dialog. Never translates. */
  onUseOwnScript: () => void;
  onSeek?: (time: number) => void;
  activeSegmentId?: string | number | null;
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
  onTranslate,
  onUseOwnScript,
  onSeek,
  activeSegmentId = null,
}) => {
  const [method, setMethod] = useState<TargetMethod>(() => {
    try {
      return localStorage.getItem(METHOD_STORAGE_KEY) === 'custom' ? 'custom' : 'translate';
    } catch {
      return 'translate';
    }
  });
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);

  const chooseMethod = (next: TargetMethod) => {
    setMethod(next);
    setError(null);
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
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeSegmentId]);

  const spoken = segments.filter((s) => (s.textSource || s.originalText || '').trim());
  const hasTranscript = spoken.length > 0;
  const length = segments.length ? segments[segments.length - 1].endTime : 0;
  const sameLanguage = Boolean(spokenLanguage) && spokenLanguage.toLowerCase() === targetLanguage.toLowerCase();
  const translateBlocked = method === 'translate' && !sameLanguage && !translationReady;
  const busy = isTranscribing || isTranslating;
  const percent =
    translationProgress && translationProgress.total > 0
      ? Math.min(98, Math.round(((translationProgress.done + 0.5) / translationProgress.total) * 100))
      : null;

  const handleContinue = async () => {
    setError(null);
    if (method === 'custom') {
      onUseOwnScript();
      return;
    }
    try {
      await onTranslate();
    } catch (err: any) {
      setError(`${err?.message || 'The translation failed.'} Your transcript and timestamps are intact. Try again or use your own script.`);
    }
  };

  const optionClass = (on: boolean) =>
    `w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${
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
          {hasTranscript && !isTranscribing && (
            <span className="text-xs text-slate-400 tabular-nums">
              {segments.length} {segments.length === 1 ? 'cue' : 'cues'} · {formatLength(length)}
              {spokenLanguage ? ` · ${spokenLanguage}` : ''}
            </span>
          )}
          <span className="ml-auto text-[11.5px] text-slate-500">Timestamps from the audio</span>
        </div>

        {isTranscribing ? (
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
              return (
                <li key={seg.id} data-cue-id={String(seg.id)} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 44px' }}>
                  <button
                    type="button"
                    onClick={() => onSeek?.(seg.startTime)}
                    className={`w-full grid grid-cols-[2rem_7.5rem_minmax(0,1fr)] gap-2.5 items-baseline px-4 py-2.5 text-left transition-colors cursor-pointer ${
                      on ? 'bg-indigo-500/10' : 'hover:bg-slate-800/40'
                    }`}
                    title="Play from here"
                  >
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {formatCueTime(seg.startTime)}–{formatCueTime(seg.endTime)}
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
              className="appearance-none w-full h-9 bg-slate-950 border border-slate-800 hover:border-slate-600 rounded-lg pl-2.5 pr-8 text-[13px] font-medium text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer disabled:cursor-default disabled:opacity-60"
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
                className="px-2 py-1 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-[11.5px] font-medium text-slate-200 disabled:opacity-40 cursor-pointer"
              >
                Change
              </button>
            </div>
          )}
        </div>

        <div className="mt-auto px-4 sm:px-5 py-4 border-t border-slate-800 bg-slate-950/60 flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => void handleContinue()}
            disabled={busy || !hasTranscript || translateBlocked}
            className="h-11 flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors disabled:bg-slate-800 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer active:translate-y-px"
          >
            {isTranslating ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Translating{percent !== null ? ` · ${percent}%` : '…'}</span>
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

          {error ? (
            <p className="flex items-start gap-1.5 text-xs text-amber-300" role="alert">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
            </p>
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
