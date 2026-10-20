import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Copy, RefreshCw, ShieldCheck } from 'lucide-react';
import { CenteredPanel } from './CenteredPanel';
import { onErrorReport, reportError, type ErrorReport } from '../services/errorPopup';

/**
 * The one window every error opens in, mounted once at the app root. A new
 * error replaces the one on screen; Close or Escape dismisses it.
 */
export const ErrorPopup: React.FC = () => {
  const [report, setReport] = useState<ErrorReport | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(
    () =>
      onErrorReport((next) => {
        setReport(next);
        setCopied(false);
        setOpen(true);
      }),
    []
  );

  // A backend error no screen caught still gets the popup, instead of vanishing into the console.
  useEffect(() => {
    const onUnhandled = (event: PromiseRejectionEvent) => {
      if ((event.reason as { name?: string } | null)?.name === 'DhvaniApiError') reportError(event.reason);
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => window.removeEventListener('unhandledrejection', onUnhandled);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.details);
      setCopied(true);
    } catch {
      // Clipboard refused (no focus or permission); the details stay on screen.
    }
  };

  const retry = () => {
    const run = report?.retry;
    setOpen(false);
    run?.();
  };

  return (
    <CenteredPanel open={open} onClose={close} label={report?.title || 'Error'} className="max-w-lg p-5 sm:p-6 gap-4" layerClassName="z-[80]">
      {report && (
        <>
          <header className="flex items-start gap-3">
            <span className="shrink-0 w-9 h-9 rounded-full bg-rose-500/15 text-rose-300 flex items-center justify-center">
              <AlertCircle className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-50 leading-tight">{report.title}</h2>
              <p className="mt-1 text-[13.5px] text-slate-300 leading-snug">{report.summary}</p>
            </div>
          </header>

          {report.serverSaid && (
            <div className="rounded-xl bg-slate-950/60 border border-slate-800 px-3 py-2">
              <div className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">What the server said</div>
              <p className="mt-0.5 text-[12.5px] text-slate-300 leading-snug break-words">{report.serverSaid}</p>
            </div>
          )}

          {report.steps.length > 0 && (
            <div>
              <div className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500 mb-1.5">What to do</div>
              <ol className="space-y-1.5">
                {report.steps.map((step, i) => (
                  <li key={i} className="flex gap-2.5 text-[13px] text-slate-200 leading-snug">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-200 text-[11px] font-semibold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {report.safe && (
            <p className="flex items-start gap-2 text-[12.5px] text-emerald-300/90 leading-snug">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-px" />
              {report.safe}
            </p>
          )}

          <footer className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={copy}
              className="mr-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy details'}
            </button>
            <button
              type="button"
              onClick={close}
              className="px-4 py-1.5 rounded-lg text-[13px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700"
            >
              Close
            </button>
            {report.retry && (
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-semibold text-white bg-indigo-500 hover:bg-indigo-400"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Try again
              </button>
            )}
          </footer>
        </>
      )}
    </CenteredPanel>
  );
};
