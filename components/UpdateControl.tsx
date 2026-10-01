import React from 'react';
import { createPortal } from 'react-dom';
import { Download, RotateCw, X, Check, AlertCircle, ExternalLink } from 'lucide-react';

/** The updater's state as desktop/main.cjs pushes it. */
export interface AppUpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  /** False for portable copies: they can learn about an update but not install it. */
  canInstall: boolean;
  currentVersion: string;
  version: string | null;
  releaseNotes: string;
  releaseDate: string | null;
  percent: number;
  transferred: number;
  total: number;
  error: string | null;
}

interface DesktopUpdates {
  getState: () => Promise<AppUpdateState>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  openReleases: () => Promise<void>;
  onState: (cb: (state: AppUpdateState) => void) => () => void;
  onOpenRequest: (cb: () => void) => () => void;
}

declare global {
  interface Window {
    /** Present only inside the desktop app (desktop/preload.cjs). */
    dhvaniUpdates?: DesktopUpdates;
  }
}

/** The Tools menu opens the update window through this event. */
export const OPEN_UPDATES_EVENT = 'dhvani:open-updates';
export const openUpdates = () => window.dispatchEvent(new Event(OPEN_UPDATES_EVENT));

/** True inside the desktop app, the only place updates exist. */
export const updatesSupported = () => typeof window !== 'undefined' && Boolean(window.dhvaniUpdates);

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

const PillSpinner = () => (
  <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-current border-r-transparent animate-spin" aria-hidden="true" />
);

/**
 * The header's Update button and the window behind it.
 *
 * Renders nothing outside the desktop app, and nothing in the header until a
 * newer published release exists. The user picks when to download and when to
 * restart; `busy` holds the restart back while a dub or sync is running.
 */
export const UpdateControl: React.FC<{ busy?: boolean }> = ({ busy = false }) => {
  const api = typeof window !== 'undefined' ? window.dhvaniUpdates : undefined;
  const [state, setState] = React.useState<AppUpdateState | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (!api) return;
    let live = true;
    api.getState().then((s) => live && setState(s));
    const offState = api.onState(setState);
    const offOpen = api.onOpenRequest(() => setOpen(true));
    const onMenu = () => {
      setOpen(true);
      api.check();
    };
    window.addEventListener(OPEN_UPDATES_EVENT, onMenu);
    return () => {
      live = false;
      offState();
      offOpen();
      window.removeEventListener(OPEN_UPDATES_EVENT, onMenu);
    };
  }, [api]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!api || !state) return null;

  const { status, canInstall, version, currentVersion } = state;
  const percent = Math.round(state.percent || 0);
  const offered = status === 'available' || status === 'downloading' || status === 'downloaded';

  const pillLabel =
    status === 'downloading' ? `Downloading ${percent}%` : status === 'downloaded' ? 'Restart to update' : `Update to ${version}`;

  const title =
    status === 'checking'
      ? 'Checking for updates…'
      : status === 'not-available'
        ? 'You’re up to date'
        : status === 'error'
          ? 'Couldn’t check for updates'
          : status === 'downloading'
            ? `Downloading ${version}…`
            : status === 'downloaded'
              ? 'Ready to install'
              : offered
                ? 'Update available'
                : 'Updates';

  return (
    <>
      {offered && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 h-[34px] px-3 rounded-full bg-blue-600 hover:bg-blue-500 text-white keep-white text-[12.5px] font-semibold whitespace-nowrap transition-colors cursor-pointer"
          title={status === 'downloaded' ? `DHVANI ${version} is ready to install` : `DHVANI ${version} is available`}
        >
          {status === 'downloading' ? (
            <PillSpinner />
          ) : status === 'downloaded' ? (
            <RotateCw className="w-3.5 h-3.5" strokeWidth={2.5} />
          ) : (
            <Download className="w-3.5 h-3.5" strokeWidth={2.5} />
          )}
          <span className="hidden sm:inline tabular-nums">{pillLabel}</span>
        </button>
      )}

      {open &&
        createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200 select-text"
          onClick={(e) => e.target === e.currentTarget && setOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-title"
            className="w-full max-w-[28rem] min-h-full sm:min-h-0 sm:my-auto flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
          >
            <div className="flex items-center gap-3.5 px-5 py-4 border-b border-slate-800">
              <div className="w-[38px] h-[38px] rounded-[10px] bg-slate-100 text-slate-950 flex items-center justify-center shrink-0" aria-hidden="true">
                {status === 'downloaded' ? <RotateCw className="w-[18px] h-[18px]" /> : <Download className="w-[18px] h-[18px]" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="update-title" className="text-lg font-semibold text-slate-100 leading-tight">
                  {title}
                </h2>
                <p className="text-[12.5px] text-slate-400 mt-0.5 tabular-nums">
                  Installed {currentVersion}
                  {version && offered && <> · New {version}</>}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-4 flex flex-col gap-3.5" aria-live="polite">
              {status === 'checking' && (
                <p className="flex items-center gap-2 text-[13px] text-slate-400">
                  <PillSpinner /> Looking for a newer version on GitHub.
                </p>
              )}

              {status === 'not-available' && (
                <p className="flex items-center gap-2 text-[13px] text-slate-300">
                  <Check className="w-4 h-4 text-emerald-400" /> DHVANI {currentVersion} is the latest version.
                </p>
              )}

              {state.error && (status === 'error' || status === 'available') && (
                <p className="flex items-start gap-2 text-[13px] text-rose-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    {status === 'available' ? 'The download stopped. ' : ''}
                    Check your internet connection and try again.
                    <span className="block text-[11.5px] text-slate-500 mt-0.5 break-words">{state.error}</span>
                  </span>
                </p>
              )}

              {offered && state.releaseNotes && (
                <div>
                  <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 mb-1">What’s new</p>
                  <div className="max-h-48 overflow-y-auto custom-scrollbar whitespace-pre-line text-[13px] leading-relaxed text-slate-300 rounded-[10px] bg-slate-950/60 border border-slate-800 px-3 py-2.5">
                    {state.releaseNotes}
                  </div>
                </div>
              )}

              {status === 'downloading' && (
                <div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div className="h-full rounded-full bg-blue-500 transition-[width] duration-300" style={{ width: `${Math.max(2, percent)}%` }} />
                  </div>
                  <div className="flex justify-between mt-1.5 text-[11.5px] text-slate-400 tabular-nums">
                    <span>{percent}%</span>
                    {state.total > 0 && (
                      <span>
                        {megabytes(state.transferred)} of {megabytes(state.total)}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {offered && (
                <p className="text-[12px] text-slate-500">
                  {!canInstall
                    ? 'This portable copy can’t update itself. Download the new version from the Releases page.'
                    : status === 'downloaded' && busy
                      ? 'Wait for the current dub or sync to finish, then restart.'
                      : status === 'downloaded'
                        ? 'DHVANI closes, installs the update and opens again. Your keys and settings are kept.'
                        : status === 'downloading'
                          ? 'Keep working. You can close this window; the download carries on.'
                          : 'Your keys and settings are kept.'}
                </p>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 px-5 py-3.5 border-t border-slate-800">
              {status === 'error' || status === 'not-available' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={() => api.check()}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white keep-white text-[12.5px] font-semibold cursor-pointer"
                  >
                    Check again
                  </button>
                </>
              ) : !canInstall && status === 'available' ? (
                <button
                  type="button"
                  onClick={() => api.openReleases()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white keep-white text-[12.5px] font-semibold cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Open Releases page
                </button>
              ) : status === 'available' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-pointer"
                  >
                    Later
                  </button>
                  <button
                    type="button"
                    onClick={() => api.download()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white keep-white text-[12.5px] font-semibold cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> {state.error ? 'Retry download' : 'Download and install'}
                  </button>
                </>
              ) : status === 'downloading' ? (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-pointer"
                >
                  Hide
                </button>
              ) : status === 'downloaded' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-pointer"
                  >
                    Install when I close
                  </button>
                  <button
                    type="button"
                    onClick={() => !busy && api.install()}
                    aria-disabled={busy}
                    title={busy ? 'A dub or sync is running' : undefined}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white keep-white text-[12.5px] font-semibold ${
                      busy ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-500 cursor-pointer'
                    }`}
                  >
                    <RotateCw className="w-3.5 h-3.5" /> Restart and install
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-pointer"
                >
                  Close
                </button>
              )}
            </div>
          </section>
        </div>,
          // The header's backdrop blur would otherwise pin this overlay inside it.
          document.body
        )}
    </>
  );
};
