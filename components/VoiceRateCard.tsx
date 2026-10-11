import React from 'react';
import { AlertCircle, Gauge, Loader2, RefreshCw } from 'lucide-react';
import { TYPICAL_SYLLABLES_PER_SECOND } from '../services/speechTiming';
import type { VoiceRateState } from '../services/voiceRate';

/** Rates this far from typical read as a slow or a fast voice. */
const PACE_SPREAD = 0.12;

const paceOf = (rate: number) =>
  rate < TYPICAL_SYLLABLES_PER_SECOND * (1 - PACE_SPREAD)
    ? { label: 'Slow', className: 'bg-sky-500/15 text-sky-300' }
    : rate > TYPICAL_SYLLABLES_PER_SECOND * (1 + PACE_SPREAD)
      ? { label: 'Fast', className: 'bg-amber-500/15 text-amber-300' }
      : { label: 'Average', className: 'bg-emerald-500/15 text-emerald-300' };

const measuredOn = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * The picked voice's speaking rate in the dub language, measured from a short
 * sample it reads when it is picked. Review's fit hints and the translation
 * use it before the first sync.
 */
export const VoiceRateCard: React.FC<{ voiceRate: VoiceRateState; language: string }> = ({ voiceRate, language }) => {
  const { rate, status, error, measureAgain } = voiceRate;
  if (status === 'idle') return null;

  if (status === 'no-sample') {
    return (
      <p className="text-[11.5px] text-slate-500 leading-snug">
        There's no {language} sample to read yet, so line fit uses a typical speaking rate until the first sync.
      </p>
    );
  }

  if (status === 'measuring') {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/40 border border-slate-800 text-xs text-slate-400" role="status">
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        Measuring how fast this voice speaks {language}…
      </div>
    );
  }

  if (status === 'error' || !rate) {
    return (
      <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/30 text-xs" role="alert">
        <AlertCircle className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-px" />
        <span className="min-w-0 flex-1 text-amber-200 leading-snug">
          Couldn't measure this voice's speaking rate{error ? `: ${error}` : '.'} Line fit uses a typical rate meanwhile.
        </span>
        <button
          type="button"
          onClick={measureAgain}
          className="px-2 py-0.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-[11px] font-medium text-slate-200 cursor-pointer shrink-0"
        >
          Try again
        </button>
      </div>
    );
  }

  const pace = paceOf(rate.syllablesPerSecond);
  return (
    <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-950/40 border border-slate-800 min-w-0">
      <Gauge className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] text-slate-500">Speaking rate in {language}</span>
        <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-100">
          <span className="tabular-nums">{rate.syllablesPerSecond.toFixed(1)} syllables/s</span>
          <span className={`text-[10.5px] font-semibold px-1.5 py-px rounded-md ${pace.className}`}>{pace.label}</span>
        </span>
        <span className="block text-[11px] text-slate-500 truncate">
          From a short sample read{measuredOn(rate.measuredAt) ? ` · ${measuredOn(rate.measuredAt)}` : ''}. Review and translation use it.
        </span>
      </span>
      <button
        type="button"
        onClick={measureAgain}
        title="Read the sample again and measure the rate anew. Uses a few voice credits."
        aria-label="Measure the speaking rate again"
        className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
