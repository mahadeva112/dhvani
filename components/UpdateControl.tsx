import React from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  RotateCw,
  RefreshCw,
  X,
  Check,
  CheckCircle2,
  CircleAlert,
  FolderOpen,
  Circle,
  Loader2,
  ShieldCheck,
  WifiOff,
  ArrowDownToLine,
  ArrowRight,
  PackageCheck,
  Sparkles,
  Clock,
} from 'lucide-react';
import { ToolWindow, toolPrimaryButton, toolSecondaryButton } from './ToolWindow';

/** The updater's state as desktop/main.cjs pushes it. */
export interface AppUpdateState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'installing' | 'error';
  /** False for portable copies: they can learn about an update but not install it. */
  canInstall: boolean;
  /** This launch is the installer reopening the app after a self-update. */
  justUpdated: boolean;
  currentVersion: string;
  version: string | null;
  releaseNotes: string;
  releaseDate: string | null;
  percent: number;
  transferred: number;
  total: number;
  error: string | null;
  /** The offer is the Apple Silicon build, for the Intel build running on Rosetta (macOS only). */
  nativeBuild?: boolean;
}

interface DesktopUpdates {
  getState: () => Promise<AppUpdateState>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  showDownload: () => Promise<void>;
  onState: (cb: (state: AppUpdateState) => void) => () => void;
  onOpenRequest: (cb: () => void) => () => void;
}

declare global {
  interface Window {
    /** Present only inside the desktop app (desktop/preload.cjs). */
    dhvaniUpdates?: DesktopUpdates;
  }
}

/** The Tools menu opens the update window through this event; `detail.check` false opens it without checking again. */
export const OPEN_UPDATES_EVENT = 'dhvani:open-updates';
export const openUpdates = (check = true) => window.dispatchEvent(new CustomEvent(OPEN_UPDATES_EVENT, { detail: { check } }));

/** True inside the desktop app, the only place updates exist. */
export const updatesSupported = () => typeof window !== 'undefined' && Boolean(window.dhvaniUpdates);

/** The updater's state as it changes, for anything that shows the version; null outside the desktop app. */
export const useUpdateState = () => {
  const api = typeof window !== 'undefined' ? window.dhvaniUpdates : undefined;
  const [state, setState] = React.useState<AppUpdateState | null>(null);
  React.useEffect(() => {
    if (!api) return;
    let live = true;
    api.getState().then((s) => live && setState(s));
    const off = api.onState(setState);
    return () => {
      live = false;
      off();
    };
  }, [api]);
  return state;
};

/** The last version whose "update available" notice was shown, so each release announces itself once. */
const NOTICE_KEY = 'dhvani_update_notice_seen';

/** The version whose "updated" message was shown, so it appears once per update. */
const UPDATED_KEY = 'dhvani_updated_notice_seen';
/** The version that last ran, so an update installed by hand is announced too. */
const LAST_VERSION_KEY = 'dhvani_last_version';

const readKey = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeKey = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The message simply shows again next launch.
  }
};

/** The offered version's notes, kept so "See what's new" can show them after the update. */
const NOTES_KEY = 'dhvani_update_notes';

const readNoticeSeen = () => readKey(NOTICE_KEY);

const readSavedNotes = (version: string) => {
  try {
    const saved = JSON.parse(readKey(NOTES_KEY) || 'null');
    return saved?.version === version && typeof saved.notes === 'string' ? saved.notes : '';
  } catch {
    return '';
  }
};

/** Read once per page load: the version that ran before this launch. */
const previousVersion = readKey(LAST_VERSION_KEY);

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** How long a corner notice stays before it leaves by itself. */
const NOTICE_MS = 5000;

/** How long the leaving animation runs (index.css .update-toast-out), with room to spare if animationend never comes. */
const LEAVE_MS = 320;

/**
 * A corner notice that rises in, leaves by itself after `ms` and sinks out.
 * The time left shows as a thin bar at its foot; the pointer over it, focus
 * inside it, a hidden window and `hold` all hold the clock (and the bar). `children` gets
 * `dismiss`, which plays the leaving animation and then calls `onGone`.
 */
const CornerNotice: React.FC<{
  onGone: () => void;
  hold?: boolean;
  ms?: number;
  bar: string;
  children: (dismiss: () => void) => React.ReactNode;
}> = ({ onGone, hold = false, ms = NOTICE_MS, bar, children }) => {
  const [leaving, setLeaving] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const gone = React.useRef(onGone);
  gone.current = onGone;
  const left = React.useRef(ms);
  const finished = React.useRef(false);

  const finish = React.useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    gone.current();
  }, []);
  const dismiss = React.useCallback(() => setLeaving(true), []);

  // A minimised or hidden window holds the clock too, so the notice is still there when DHVANI is looked at again.
  const [hidden, setHidden] = React.useState(() => typeof document !== 'undefined' && document.hidden);
  React.useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const paused = hold || hovered || leaving || hidden;
  // The clock runs only while nothing holds it, and picks up where it stopped.
  React.useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const t = window.setTimeout(() => setLeaving(true), left.current);
    return () => {
      window.clearTimeout(t);
      left.current = Math.max(0, left.current - (Date.now() - started));
    };
  }, [paused]);
  // animationend finishes it; the timer covers a tab in the background, where animations may not run.
  React.useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(finish, LEAVE_MS);
    return () => window.clearTimeout(t);
  }, [leaving, finish]);

  return (
    <div
      role="status"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setHovered(false)}
      onAnimationEnd={(e) => e.target === e.currentTarget && leaving && finish()}
      className={`fixed bottom-6 right-6 z-50 w-[min(22rem,calc(100vw-2rem))] rounded-[14px] bg-slate-900 border border-slate-700/80 shadow-2xl shadow-black/40 text-slate-100 overflow-hidden ${
        leaving ? 'update-toast-out pointer-events-none' : 'update-toast-in'
      }`}
    >
      <div className="flex items-start gap-3 p-4">{children(dismiss)}</div>
      <span
        aria-hidden="true"
        className={`update-toast-time absolute left-0 bottom-0 h-[2px] w-full ${bar} transition-opacity duration-300 ${hold ? 'opacity-0' : 'opacity-70'}`}
        style={{ animationDuration: `${ms}ms`, animationPlayState: paused ? 'paused' : 'running' }}
      />
    </div>
  );
};

const PillSpinner = () => (
  <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-current border-r-transparent animate-spin" aria-hidden="true" />
);

/** The header icon while checking. */
const SpinningIcon: React.FC<{ className?: string }> = ({ className }) => <Loader2 className={`${className ?? ''} animate-spin`} />;

/** When the update server last answered, kept so the window can say "Last checked …". */
const LAST_CHECKED_KEY = 'dhvani_update_last_checked';

const readLastChecked = () => {
  const n = Number(readKey(LAST_CHECKED_KEY));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** "just now", "4 min ago", "2 h ago", "3 days ago", or a date. */
const sinceLabel = (at: number, now: number) => {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

const releaseDay = (iso: string | null) => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null;
};

const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB` : megabytes(bytes));

const etaLabel = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s left`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min left` : `${Math.floor(m / 60)} h ${m % 60} min left`;
};

/** Download speed from the last few progress reports, in bytes per second. */
const useDownloadRate = (transferred: number, active: boolean) => {
  const samples = React.useRef<{ t: number; b: number }[]>([]);
  const [rate, setRate] = React.useState(0);
  React.useEffect(() => {
    if (!active) {
      samples.current = [];
      setRate(0);
      return;
    }
    const now = Date.now();
    const list = samples.current.filter((s) => now - s.t < 6000);
    list.push({ t: now, b: transferred });
    samples.current = list;
    const first = list[0];
    const dt = (now - first.t) / 1000;
    if (dt >= 1 && transferred > first.b) setRate((transferred - first.b) / dt);
  }, [transferred, active]);
  return rate;
};

/** A ticking clock for relative times, refreshed every 30 s while the window is open. */
const useNow = (on: boolean) => {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, [on]);
  return now;
};

/** Release notes as the release carries them, with "- " / "• " lines drawn as a list and "#" / "Title:" lines as headings. */
const ReleaseNotes: React.FC<{ text: string }> = ({ text }) => {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`l${blocks.length}`} className="flex flex-col gap-1.5">
        {items.map((b, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-[7px] w-1 h-1 rounded-full bg-indigo-400 shrink-0" aria-hidden="true" />
            <span>{b}</span>
          </li>
        ))}
      </ul>
    );
  };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const bullet = line.match(/^(?:[-*•·]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    const heading = line.match(/^#{1,6}\s+(.*)$/) || (line.length < 48 && /:$/.test(line) ? [line, line.slice(0, -1)] : null);
    blocks.push(
      heading ? (
        <p key={`h${blocks.length}`} className="text-[11px] uppercase tracking-[0.08em] font-semibold text-slate-400 pt-1 first:pt-0">
          {heading[1]}
        </p>
      ) : (
        <p key={`p${blocks.length}`}>{line}</p>
      )
    );
  }
  flush();
  return <div className="flex flex-col gap-2.5 text-[13px] leading-relaxed text-slate-300">{blocks}</div>;
};

/** The small "1.5.11" chip used in the version strip. */
const VersionChip: React.FC<{ label: string; value: string; tone?: 'muted' | 'new' | 'ok' }> = ({ label, value, tone = 'muted' }) => (
  <div className="min-w-0">
    <p className="text-[10.5px] uppercase tracking-[0.09em] font-semibold text-slate-500">{label}</p>
    <p
      className={`mt-1 text-[15px] font-semibold tabular-nums leading-none ${
        tone === 'new' ? 'text-indigo-300' : tone === 'ok' ? 'text-slate-100' : 'text-slate-300'
      }`}
    >
      {value}
    </p>
  </div>
);

/**
 * The update window and its notices, opened from Tools → Check for updates.
 *
 * Renders nothing outside the desktop app, and nothing in the header: the user
 * asked for no Update button up there (2026-11-09), so a newer version shows in
 * the Tools list's Check for updates item. Each new version also announces
 * itself once with a corner notice; dismissing it or opening the window retires
 * it. The user picks when to download and when to restart; `busy` holds the
 * restart back while a dub or sync is running.
 */
export const UpdateControl: React.FC<{ busy?: boolean }> = ({ busy = false }) => {
  const api = typeof window !== 'undefined' ? window.dhvaniUpdates : undefined;
  const [state, setState] = React.useState<AppUpdateState | null>(null);
  const [open, setOpen] = React.useState(false);
  const [noticeSeen, setNoticeSeen] = React.useState(readNoticeSeen);
  const [updatedSeen, setUpdatedSeen] = React.useState(() => readKey(UPDATED_KEY));
  const [showNewNotes, setShowNewNotes] = React.useState(false);

  React.useEffect(() => {
    if (!api) return;
    let live = true;
    api.getState().then((s) => live && setState(s));
    const offState = api.onState(setState);
    const offOpen = api.onOpenRequest(() => setOpen(true));
    const onMenu = (e: Event) => {
      setOpen(true);
      if ((e as CustomEvent<{ check?: boolean }>).detail?.check !== false) api.check();
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

  const markNoticeSeen = React.useCallback((v: string | null) => {
    if (!v) return;
    setNoticeSeen(v);
    writeKey(NOTICE_KEY, v);
  }, []);

  const markUpdatedSeen = React.useCallback((v: string) => {
    setUpdatedSeen(v);
    writeKey(UPDATED_KEY, v);
  }, []);

  React.useEffect(() => {
    if (state?.currentVersion) writeKey(LAST_VERSION_KEY, state.currentVersion);
  }, [state?.currentVersion]);

  React.useEffect(() => {
    if (state?.version && state.releaseNotes) {
      writeKey(NOTES_KEY, JSON.stringify({ version: state.version, notes: state.releaseNotes }));
    }
  }, [state?.version, state?.releaseNotes]);

  // Opening the window counts as seeing the notice.
  // The Apple Silicon offer announces itself on its own, even at the version already announced.
  const noticeKey = state?.version ? (state.nativeBuild ? `${state.version}-apple-silicon` : state.version) : null;

  React.useEffect(() => {
    if (open && noticeKey && (state?.status === 'available' || state?.status === 'downloading' || state?.status === 'downloaded')) {
      markNoticeSeen(noticeKey);
    }
  }, [open, noticeKey, state?.status, markNoticeSeen]);

  // Remember when the server last answered, for the window's "Last checked …".
  const [lastChecked, setLastChecked] = React.useState(readLastChecked);
  const prevStatus = React.useRef<AppUpdateState['status'] | null>(null);
  React.useEffect(() => {
    const s = state?.status ?? null;
    if (prevStatus.current === 'checking' && (s === 'not-available' || s === 'available')) {
      const at = Date.now();
      setLastChecked(at);
      writeKey(LAST_CHECKED_KEY, String(at));
    }
    prevStatus.current = s;
  }, [state?.status]);
  const now = useNow(open);
  const rate = useDownloadRate(state?.transferred ?? 0, state?.status === 'downloading');

  if (!api || !state) return null;

  const { status, canInstall, version, currentVersion } = state;
  const nativeBuild = state.nativeBuild === true;
  const percent = Math.round(state.percent || 0);
  const offered = status === 'available' || status === 'downloading' || status === 'downloaded';

  const installing = status === 'installing';

  // The installer passes --updated; a version change since the last run also
  // covers an update installed by hand.
  const updated = state.justUpdated || (previousVersion !== null && previousVersion !== currentVersion);
  const showUpdated = updated && !installing && updatedSeen !== currentVersion;
  const newNotes = showUpdated ? readSavedNotes(currentVersion) : '';

  const showNotice = status === 'available' && !open && !showUpdated && Boolean(version) && noticeSeen !== noticeKey;

  const checking = status === 'checking';
  const upToDate = status === 'not-available';
  const failed = status === 'error';
  const downloadFailed = status === 'available' && Boolean(state.error);
  const released = releaseDay(state.releaseDate);
  const lastCheckedText = lastChecked ? `Last checked ${sinceLabel(lastChecked, now)}` : null;
  const remaining = state.total > 0 && rate > 0 ? etaLabel((state.total - state.transferred) / rate) : null;

  const title = checking
    ? 'Checking for updates'
    : upToDate
      ? 'DHVANI is up to date'
      : failed
        ? 'Couldn’t reach the update server'
        : status === 'downloading'
          ? `Downloading DHVANI ${version}`
          : status === 'downloaded'
            ? canInstall
              ? 'Ready to install'
              : 'Download complete'
            : offered
              ? nativeBuild
                ? 'Apple Silicon version available'
                : 'A new version is available'
              : 'Software update';

  const subtitle = checking
    ? 'Contacting the release server…'
    : upToDate
      ? `You have the newest version, ${currentVersion}.`
      : failed
        ? lastChecked
          ? `Last successful check ${sinceLabel(lastChecked, now)}.`
          : 'No answer from the release server.'
        : status === 'downloading'
          ? 'Keep working, it downloads in the background.'
          : status === 'downloaded'
            ? canInstall
              ? 'Restart DHVANI to finish updating.'
              : `DHVANI ${version} is saved on this computer.`
            : offered
              ? `DHVANI ${version}${released ? ` · Released ${released}` : ''}`
              : `Version ${currentVersion}`;

  const headerIcon = checking
    ? SpinningIcon
    : upToDate
      ? ShieldCheck
      : failed
        ? WifiOff
        : status === 'downloading'
          ? ArrowDownToLine
          : status === 'downloaded'
            ? PackageCheck
            : Sparkles;
  const headerTone = checking ? 'blue' : upToDate || status === 'downloaded' ? 'emerald' : failed ? 'rose' : status === 'downloading' ? 'blue' : 'indigo';

  // The status chip on the version strip.
  const chip = checking
    ? { text: 'Checking', cls: 'bg-blue-500/10 text-blue-300 ring-blue-400/20' }
    : upToDate
      ? { text: 'Up to date', cls: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20' }
      : failed
        ? { text: 'Not checked', cls: 'bg-rose-500/10 text-rose-300 ring-rose-400/20' }
        : status === 'downloading'
          ? { text: `${percent}%`, cls: 'bg-blue-500/10 text-blue-300 ring-blue-400/20' }
          : status === 'downloaded'
            ? { text: 'Downloaded', cls: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20' }
            : { text: 'New', cls: 'bg-indigo-500/15 text-indigo-200 ring-indigo-400/25' };

  /** A quiet text action at the left of the footer, with the last-checked time under it. */
  const checkAgain = (label: string) => (
    <div className="flex items-center gap-3 min-w-0">
      <button
        type="button"
        onClick={() => api.check()}
        disabled={checking}
        className="h-8 -ml-2 px-2 inline-flex items-center gap-1.5 rounded-md text-[12.5px] font-medium text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors cursor-default disabled:opacity-50 disabled:pointer-events-none"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
        {checking ? 'Checking…' : label}
      </button>
      {!checking && lastCheckedText && !failed && (
        <span className="text-[11.5px] text-slate-500 truncate tabular-nums">{lastCheckedText}</span>
      )}
    </div>
  );

  return (
    <>
      {installing &&
        createPortal(
          <ToolWindow
            // Nothing closes this window: the app is about to close itself to install.
            onClose={() => {}}
            closeDisabled
            showClose={false}
            role="alertdialog"
            title={`Installing DHVANI ${version}`}
            subtitle={
              <span className="tabular-nums">
                Installed {currentVersion} · New {version}
              </span>
            }
            icon={RotateCw}
            tone="slate"
            widthClassName="max-w-[26rem]"
            layerClassName="z-[60]"
            titleId="installing-title"
          >
            <div className="px-5 py-4" aria-live="polite">
              <ol className="flex flex-col gap-2.5 text-[13px]">
                <li className="flex items-center gap-2.5 text-slate-300">
                  <Check className="w-4 h-4 text-emerald-400" /> Update downloaded
                </li>
                <li className="flex items-center gap-2.5 text-slate-100 font-medium">
                  <span className="w-4 h-4 flex items-center justify-center text-blue-400">
                    <PillSpinner />
                  </span>
                  Closing DHVANI to install
                </li>
                <li className="flex items-center gap-2.5 text-slate-500">
                  <Circle className="w-4 h-4" /> Opening the new version
                </li>
              </ol>
              <div className="mt-4 h-1.5 rounded-full bg-slate-800 overflow-hidden" aria-hidden="true">
                <div className="h-full w-1/3 rounded-full bg-blue-500 animate-[dubsweep_1.4s_ease-in-out_infinite]" />
              </div>
              <p className="text-[12px] text-slate-400 mt-3">
                DHVANI closes for about a minute while it installs, then opens again by itself. Your keys and settings are kept.
              </p>
            </div>
          </ToolWindow>,
          document.body
        )}

      {showUpdated &&
        createPortal(
          <CornerNotice hold={showNewNotes} bar="bg-emerald-400" onGone={() => markUpdatedSeen(currentVersion)}>
            {(dismiss) => (
          <>
            <div className="w-8 h-8 rounded-[9px] bg-emerald-600 text-white keep-white flex items-center justify-center shrink-0" aria-hidden="true">
              <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold leading-snug">Updated to DHVANI {currentVersion}</p>
              <p className="text-[12px] text-slate-400 mt-0.5">Your keys, settings and projects are where you left them.</p>
              {showNewNotes && newNotes && (
                <div className="mt-2.5 max-h-48 overflow-y-auto custom-scrollbar whitespace-pre-line text-[12.5px] leading-relaxed text-slate-300 rounded-[10px] bg-slate-950/60 border border-edge px-3 py-2.5 select-text">
                  {newNotes}
                </div>
              )}
              <div className="flex gap-2 mt-3">
                {newNotes && !showNewNotes && (
                  <button
                    type="button"
                    onClick={() => setShowNewNotes(true)}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white keep-white text-[12.5px] font-semibold cursor-default"
                  >
                    See what’s new
                  </button>
                )}
                <button
                  type="button"
                  onClick={dismiss}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-default"
                >
                  Close
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="w-7 h-7 -mt-1 -mr-1 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-default"
            >
              <X className="w-4 h-4" />
            </button>
          </>
            )}
          </CornerNotice>,
          document.body
        )}

      {showNotice &&
        createPortal(
          <CornerNotice bar="bg-blue-400" onGone={() => markNoticeSeen(noticeKey)}>
            {(dismiss) => (
          <>
            <div className="w-8 h-8 rounded-[9px] bg-blue-600 text-white keep-white flex items-center justify-center shrink-0" aria-hidden="true">
              <Download className="w-4 h-4" strokeWidth={2.5} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold leading-snug">
                {nativeBuild ? 'DHVANI for Apple Silicon is available' : `DHVANI ${version} is available`}
              </p>
              <p className="text-[12px] text-slate-400 mt-0.5">
                {nativeBuild
                  ? 'This Mac is running the Intel version, which is much slower here and can freeze. Your keys and settings are kept.'
                  : 'Download it when it suits you. Your keys and settings are kept.'}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white keep-white text-[12.5px] font-semibold cursor-default"
                >
                  See what’s new
                </button>
                <button
                  type="button"
                  onClick={dismiss}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 cursor-default"
                >
                  Later
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="w-7 h-7 -mt-1 -mr-1 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-default"
            >
              <X className="w-4 h-4" />
            </button>
          </>
            )}
          </CornerNotice>,
          document.body
        )}

      {open &&
        !installing &&
        createPortal(
          <ToolWindow
            onClose={() => setOpen(false)}
            title={title}
            subtitle={subtitle}
            icon={headerIcon}
            tone={headerTone}
            widthClassName="max-w-[30rem]"
            titleId="update-title"
            bodyClassName="select-text"
            footer={
              <>
                {upToDate || failed || checking ? (
                  <>
                    {checkAgain(failed ? 'Try again' : 'Check again')}
                    <span className="flex-1" />
                    <button type="button" onClick={() => setOpen(false)} className={toolSecondaryButton}>
                      {upToDate ? 'Done' : 'Close'}
                    </button>
                  </>
                ) : status === 'available' ? (
                  <>
                    <span className="flex-1 text-[11.5px] text-slate-500 tabular-nums truncate">{lastCheckedText}</span>
                    <button type="button" onClick={() => setOpen(false)} className={toolSecondaryButton}>
                      Later
                    </button>
                    <button type="button" onClick={() => api.download()} className={toolPrimaryButton}>
                      {downloadFailed ? <RefreshCw className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
                      {downloadFailed ? 'Retry download' : canInstall ? 'Download and install' : 'Download'}
                    </button>
                  </>
                ) : status === 'downloading' ? (
                  <>
                    <span className="flex-1 text-[11.5px] text-slate-500">You can close this window, the download carries on.</span>
                    <button type="button" onClick={() => setOpen(false)} className={toolSecondaryButton}>
                      Hide
                    </button>
                  </>
                ) : status === 'downloaded' && !canInstall ? (
                  <>
                    <span className="flex-1" />
                    <button type="button" onClick={() => setOpen(false)} className={toolSecondaryButton}>
                      Close
                    </button>
                    <button type="button" onClick={() => api.showDownload()} className={toolPrimaryButton}>
                      <FolderOpen className="w-3.5 h-3.5" /> Show in folder
                    </button>
                  </>
                ) : status === 'downloaded' ? (
                  <>
                    <span className="flex-1" />
                    <button type="button" onClick={() => setOpen(false)} className={toolSecondaryButton}>
                      Install when I quit
                    </button>
                    <button
                      type="button"
                      onClick={() => !busy && api.install()}
                      aria-disabled={busy}
                      title={busy ? 'A dub or sync is running' : undefined}
                      className={`${toolPrimaryButton} aria-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:hover:bg-indigo-600`}
                    >
                      <RotateCw className="w-3.5 h-3.5" /> Restart and install
                    </button>
                  </>
                ) : (
                  <>
                    {checkAgain('Check for updates')}
                    <span className="flex-1" />
                    <button type="button" onClick={() => setOpen(false)} className={toolSecondaryButton}>
                      Close
                    </button>
                  </>
                )}
              </>
            }
          >
            <div className="px-5 py-4 flex flex-col gap-4" aria-live="polite">
              {/* Version strip: what is installed, what is newest, and where this copy stands. */}
              <div className="relative rounded-[12px] border border-edge bg-slate-950/50 px-4 py-3.5 overflow-hidden">
                <div className="flex items-center gap-4">
                  <VersionChip label="Installed" value={`${currentVersion}${nativeBuild ? ' · Intel' : ''}`} tone={offered ? 'muted' : 'ok'} />
                  <ArrowRight className={`w-4 h-4 shrink-0 ${offered ? 'text-indigo-400' : 'text-slate-600'}`} aria-hidden="true" />
                  <VersionChip
                    label={offered ? 'New version' : 'Latest'}
                    value={
                      offered && version
                        ? `${version}${nativeBuild ? ' · Apple Silicon' : ''}`
                        : upToDate
                          ? currentVersion
                          : '—'
                    }
                    tone={offered ? 'new' : 'ok'}
                  />
                  <span className="flex-1" />
                  <span className={`shrink-0 inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11.5px] font-semibold tabular-nums ring-1 ring-inset ${chip.cls}`}>
                    {upToDate && <Check className="w-3 h-3" strokeWidth={3} />}
                    {checking && <PillSpinner />}
                    {chip.text}
                  </span>
                </div>
                {checking && (
                  <div className="absolute left-0 right-0 bottom-0 h-[2px] bg-slate-800/80 overflow-hidden" aria-hidden="true">
                    <div className="h-full w-1/3 bg-blue-500 animate-[dubsweep_1.4s_ease-in-out_infinite]" />
                  </div>
                )}
              </div>

              {upToDate && (
                <p className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-slate-400">
                  <Clock className="w-3.5 h-3.5 mt-[3px] shrink-0 text-slate-500" aria-hidden="true" />
                  DHVANI looks for updates by itself when it opens and every few hours, and tells you when one is ready.
                </p>
              )}

              {state.error && (failed || status === 'available') && (
                <div className="flex items-start gap-3 rounded-[12px] border border-rose-500/20 bg-rose-500/[0.06] px-3.5 py-3">
                  <CircleAlert className="w-4 h-4 shrink-0 mt-0.5 text-rose-300" aria-hidden="true" />
                  <div className="min-w-0 text-[12.5px] leading-relaxed">
                    <p className="text-rose-200 font-medium">
                      {status === 'available' ? 'The download stopped before it finished.' : 'Check your internet connection, then try again.'}
                    </p>
                    <p className="mt-1 text-[11.5px] text-slate-500 font-mono break-words">{state.error}</p>
                  </div>
                </div>
              )}

              {offered && nativeBuild && (
                <p className="text-[13px] leading-relaxed text-slate-300">
                  This Mac has an Apple chip, but the copy of DHVANI on it is the Intel version, which macOS runs through
                  translation. That makes the whole app several times slower and is why it can freeze. Download the Apple
                  Silicon version, open it, and drag DHVANI into Applications to replace this one.
                </p>
              )}

              {status === 'downloading' && (
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[22px] font-semibold tabular-nums text-slate-100 leading-none">
                      {percent}
                      <span className="text-[13px] text-slate-400 font-medium">%</span>
                    </span>
                    <span className="text-[11.5px] text-slate-400 tabular-nums text-right">
                      {state.total > 0 && `${megabytes(state.transferred)} of ${sizeLabel(state.total)}`}
                      {rate > 0 && ` · ${megabytes(rate)}/s`}
                      {remaining && ` · ${remaining}`}
                    </span>
                  </div>
                  <div className="mt-2.5 h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-400 transition-[width] duration-300"
                      style={{ width: `${Math.max(2, percent)}%` }}
                    />
                  </div>
                </div>
              )}

              {status === 'downloaded' && canInstall && (
                <div className="flex items-start gap-3 rounded-[12px] border border-emerald-500/20 bg-emerald-500/[0.06] px-3.5 py-3 text-[12.5px] leading-relaxed">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-300" aria-hidden="true" />
                  <p className="text-slate-300">
                    {busy
                      ? 'A dub or sync is running. Restart once it finishes, or DHVANI installs the update when you quit.'
                      : 'DHVANI closes for about a minute, installs the update and opens again. Your keys, settings and projects are kept.'}
                  </p>
                </div>
              )}

              {offered && !nativeBuild && state.releaseNotes && (
                <section>
                  <div className="flex items-baseline justify-between gap-3 mb-2">
                    <h3 className="text-[12px] font-semibold text-slate-200">What’s new in {version}</h3>
                    <span className="text-[11.5px] text-slate-500 tabular-nums">
                      {[released, state.total > 0 ? sizeLabel(state.total) : null].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <div
                    className={`${status === 'available' ? 'max-h-60' : 'max-h-36'} overflow-y-auto custom-scrollbar rounded-[12px] bg-slate-950/50 border border-edge px-4 py-3`}
                  >
                    <ReleaseNotes text={state.releaseNotes} />
                  </div>
                </section>
              )}

              {offered && (!canInstall || status === 'available') && (
                <p className="text-[11.5px] leading-relaxed text-slate-500">
                  {!canInstall && status === 'downloaded' && nativeBuild
                    ? 'Saved in Downloads. Close DHVANI, open the downloaded file and drag DHVANI into Applications, replacing the old one. Your keys and settings are kept.'
                    : !canInstall && status === 'downloaded'
                      ? 'The new version is saved. Close DHVANI and open the new one; for the zip, unpack it over your DHVANI folder so your keys come along.'
                      : !canInstall
                        ? 'This copy can’t replace itself, so DHVANI downloads the new version for you to open.'
                        : 'Your keys, settings and projects are kept. You choose when to restart.'}
                </p>
              )}
            </div>
          </ToolWindow>,
          // The header's backdrop blur would otherwise pin this overlay inside it.
          document.body
        )}
    </>
  );
};
