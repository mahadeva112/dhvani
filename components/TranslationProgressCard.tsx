import React, { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import type { RetranslateProgress } from '../services/subtitleService';

interface TranslationProgressCardProps {
  language: string;
  /** Null until the backend reports its first batch, or for untracked translations. */
  progress: RetranslateProgress | null;
}

const formatElapsed = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * Floating status card for a cue translation. Shows the real batch count once
 * the backend streams it, and a sweeping bar until then.
 */
export const TranslationProgressCard = ({ language, progress }: TranslationProgressCardProps) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const total = progress?.total ?? 0;
  const done = Math.min(progress?.done ?? 0, total);
  // A batch in flight counts as half done so the bar never sits still at 0%.
  const percent = total > 0 ? Math.min(99, Math.round(((done + 0.5) / total) * 100)) : null;
  const detail =
    progress?.message ||
    (progress?.cueCount ? `Preparing ${progress.cueCount} cues` : 'Sending the cues to the translator');

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 w-[min(340px,calc(100vw-32px))] rounded-2xl border border-slate-200 bg-white/95 p-4 text-slate-800 shadow-2xl backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/95 dark:text-slate-100 animate-in fade-in slide-in-from-bottom-2"
    >
      <div className="flex items-start gap-3">
        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300">
          <Languages className="h-[18px] w-[18px]" />
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-indigo-500 ring-2 ring-white animate-pulse dark:ring-slate-900" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-[13px] font-semibold">Translating to {language}</p>
            {percent !== null && (
              <span className="font-mono text-[12px] font-semibold tabular-nums text-indigo-600 dark:text-indigo-300">
                {percent}%
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-slate-500 dark:text-slate-400" title={detail}>
            {detail}
          </p>
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        {percent !== null ? (
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-[width] duration-700 ease-out"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 animate-[dubsweep_1.4s_ease-in-out_infinite]" />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10.5px] text-slate-400 dark:text-slate-500">
        <span>{total > 1 ? `Part ${Math.min(done + 1, total)} of ${total}` : 'Timestamps stay unchanged'}</span>
        <span className="font-mono tabular-nums">{formatElapsed(elapsed)}</span>
      </div>
    </div>
  );
};
