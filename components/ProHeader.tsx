import React from 'react';
import {
  Keyboard,
  AudioWaveform,
  Activity,
  KeyRound,
  Mic,
  AlignLeft,
  FolderOpen,
  SlidersHorizontal,
  Plus,
  Check,
  AlertCircle,
  Film,
  Music,
  Speech,
  Download,
} from 'lucide-react';
import { BatchJob, ProcessingStatus } from '../types';
import { UpdateControl, openUpdates, updatesSupported } from './UpdateControl';
import { ProjectsMenu } from './ProjectsMenu';
import { projectName } from '../services/projects';

export type ThemeMode = 'auto' | 'light' | 'dark';

/** The dub language a new install starts on. */
export const DEFAULT_TARGET_LANGUAGE = 'Hindi';

export const DEFAULT_LANGUAGES = [
  { code: 'Assamese', label: 'Assamese (অসমীয়া)' },
  { code: 'Bengali', label: 'Bengali (বাংলা)' },
  { code: 'Bodo', label: 'Bodo (बड़ो)' },
  { code: 'Dogri', label: 'Dogri (डोगरी)' },
  { code: 'Gujarati', label: 'Gujarati (ગુજરાતી)' },
  { code: 'Hindi', label: 'Hindi (हिन्दी)' },
  { code: 'Kannada', label: 'Kannada (ಕನ್ನಡ)' },
  { code: 'Kashmiri', label: 'Kashmiri (کٲشُر)' },
  { code: 'Konkani', label: 'Konkani (कोंकणी)' },
  { code: 'Maithili', label: 'Maithili (मैथिली)' },
  { code: 'Malayalam', label: 'Malayalam (മലയാളം)' },
  { code: 'Manipuri', label: 'Manipuri (মৈতৈলোন্)' },
  { code: 'Marathi', label: 'Marathi (मराठी)' },
  { code: 'Nepali', label: 'Nepali (नेपाली)' },
  { code: 'Odia', label: 'Odia (ଓଡ଼ିଆ)' },
  { code: 'Punjabi', label: 'Punjabi (ਪੰਜਾਬੀ)' },
  { code: 'Sanskrit', label: 'Sanskrit (संस्कृतम्)' },
  { code: 'Santali', label: 'Santali (ᱥᱟᱱᱛᱟᱲᱤ)' },
  { code: 'Sindhi', label: 'Sindhi (سنڌي)' },
  { code: 'Tamil', label: 'Tamil (தமிழ்)' },
  { code: 'Telugu', label: 'Telugu (తెలుగు)' },
  { code: 'Urdu', label: 'Urdu (اردو)' },
];

/** Something running on the active job, for the status pill and the progress line. */
export interface HeaderActivity {
  label: string;
  /** 0 to 1, or null when the work can't say how far it has got. */
  fraction: number | null;
}

/** The ElevenLabs plan's character allowance. */
export interface HeaderQuota {
  used: number;
  limit: number;
  tier?: string;
  resetUnix?: number;
}

export interface ProHeaderProps {
  activeJob: BatchJob | null;
  /** The step on screen and how to change it. */
  activeStep: number;
  onStepChange: (step: number) => void;
  /** The last step that may be opened (services/projects.ts openSteps), and why each later one can't be yet. */
  openUpTo?: number;
  lockedWhy?: Record<number, string>;
  /** Spoken language shown next to the file; empty means auto-detect. */
  sourceLanguage?: string;
  targetLanguage?: string;
  mediaDuration?: number;
  activity?: HeaderActivity | null;
  /** Lines reworded or retaken since the last sync: Sync shows how many. */
  syncPendingCount?: number;
  quota?: HeaderQuota | null;
  /** The engine speaking the dub. ElevenLabs always transcribes. */
  voiceEngine?: 'elevenlabs' | 'cartesia';
  /** True when a Cartesia key is set up; shows Cartesia in the services panel. */
  cartesiaReady?: boolean;
  elevenLabsReady?: boolean;
  translationReady?: boolean;
  /** One line describing where translation runs. */
  translationSummary?: string | null;
  voiceSummary?: string | null;
  translationStyleName?: string | null;
  onOpenSettings?: () => void;
  /** Opens the API & translation engine dialog. Hidden when keys are env-managed. */
  onOpenApiSettings?: () => void;
  onOpenCustomPrompt?: () => void;
  onOpenPhoneticKeyboard?: () => void;
  onOpenVoiceChanger?: () => void;
  /** Opens the standalone text-to-speech studio. */
  onOpenTextToSpeech?: () => void;
  onOpenPauseSensitivity?: () => void;
  pauseSensitivity?: number;
  onResetSession?: () => void;
  /** Opens Your projects, the full list. */
  onOpenQueue?: () => void;
  /** Every saved project, newest first, for the projects menu. */
  projects?: BatchJob[];
  onSelectProject?: (id: string) => void;
  onRenameProject?: (id: string, name: string) => void;
  onRemoveProject?: (id: string) => void;
  themeMode?: ThemeMode;
  onThemeModeChange?: (mode: ThemeMode) => void;
}

const formatClock = (seconds: number) => {
  const t = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

/** 61840 -> "62k", 5895000 -> "5.9M" */
const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);

/** Closes a popover on an outside click or Escape. */
const useDismiss = (open: boolean, close: () => void, ref: React.RefObject<HTMLElement>) => {
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close, ref]);
};

/** One row in the Tools menu: icon, label, the current value and an optional trailing hint. */
const MenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint?: string | null;
  end?: React.ReactNode;
  onClick: () => void;
}> = ({ icon, label, hint, end, onClick }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left hover:bg-slate-800/70 transition-colors cursor-pointer"
  >
    <span className="w-8 h-8 rounded-lg bg-slate-950/70 border border-slate-800 text-slate-400 flex items-center justify-center shrink-0">
      {icon}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-[13px] font-semibold text-slate-100 leading-tight">{label}</span>
      {hint && <span className="block text-[11.5px] text-slate-400 truncate mt-0.5">{hint}</span>}
    </span>
    {end}
  </button>
);

const MenuHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="px-2.5 pt-2 pb-1 text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">{children}</p>
);

export const ProHeader: React.FC<ProHeaderProps> = ({
  activeJob,
  activeStep,
  onStepChange,
  openUpTo = 4,
  lockedWhy: lockReasons = {},
  sourceLanguage,
  targetLanguage,
  mediaDuration,
  activity = null,
  syncPendingCount = 0,
  quota = null,
  voiceEngine = 'elevenlabs',
  cartesiaReady = false,
  elevenLabsReady = true,
  translationReady = true,
  translationSummary,
  voiceSummary,
  translationStyleName,
  onOpenSettings,
  onOpenApiSettings,
  onOpenCustomPrompt,
  onOpenPhoneticKeyboard,
  onOpenVoiceChanger,
  onOpenTextToSpeech,
  onOpenPauseSensitivity,
  pauseSensitivity = 50,
  onResetSession,
  onOpenQueue,
  projects = [],
  onSelectProject,
  onRenameProject,
  onRemoveProject,
  themeMode = 'auto',
  onThemeModeChange,
}) => {
  const [toolsOpen, setToolsOpen] = React.useState(false);
  const [servicesOpen, setServicesOpen] = React.useState(false);
  const [projectsOpen, setProjectsOpen] = React.useState(false);
  const toolsRef = React.useRef<HTMLDivElement>(null);
  const servicesRef = React.useRef<HTMLDivElement>(null);
  const projectsRef = React.useRef<HTMLDivElement>(null);
  const closeTools = React.useCallback(() => setToolsOpen(false), []);
  const closeServices = React.useCallback(() => setServicesOpen(false), []);
  const closeProjects = React.useCallback(() => setProjectsOpen(false), []);
  useDismiss(toolsOpen, closeTools, toolsRef);
  useDismiss(servicesOpen, closeServices, servicesRef);
  useDismiss(projectsOpen, closeProjects, projectsRef);

  const runAndClose = (fn?: () => void) => () => {
    setToolsOpen(false);
    fn?.();
  };

  const hasCues = Boolean(activeJob && activeJob.segments.length > 0);
  const hasDub = Boolean(activeJob?.synthesizedAudioUrl);
  const hasSync = Boolean(activeJob?.syncedAudioUrl && activeJob?.syncReport);
  const servicesOk = elevenLabsReady && translationReady;
  const voiceEngineName = voiceEngine === 'cartesia' ? 'Cartesia' : 'ElevenLabs';
  /** What an engine is doing right now, e.g. "Transcription and voice", or "Off". */
  const roleOf = (engine: 'elevenlabs' | 'cartesia') => {
    // ElevenLabs always transcribes; the voice engine is the user's choice.
    const roles = [engine === 'elevenlabs' && 'Transcription', voiceEngine === engine && 'voice'].filter(Boolean) as string[];
    if (roles.length === 0) return 'Off';
    const text = roles.join(' and ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const quotaLeft = quota ? Math.max(0, quota.limit - quota.used) : null;
  const quotaShare = quota && quota.limit > 0 ? quotaLeft! / quota.limit : null;
  const isVideo = activeJob?.file
    ? activeJob.file.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi)$/i.test(activeJob.file.name)
    : false;

  const statusPill = (() => {
    if (!activeJob) return null;
    if (activity) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 text-[11px] font-semibold whitespace-nowrap">
          <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-current border-r-transparent animate-spin" />
          <span className="tabular-nums">
            {activity.label}
            {activity.fraction !== null && ` ${Math.round(activity.fraction * 100)}%`}
          </span>
        </span>
      );
    }
    if (activeJob.status === ProcessingStatus.ERROR) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 text-[11px] font-semibold" title={activeJob.errorMsg || undefined}>
          <AlertCircle className="w-3 h-3" /> Error
        </span>
      );
    }
    if (hasDub) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[11px] font-semibold">
          <Check className="w-3 h-3" /> Dub ready
        </span>
      );
    }
    return null;
  })();

  // Each step opens once the one before it is done, and can't be opened while that one's work runs.
  const lockedWhy = (n: number) => lockReasons[n] || 'Finish the step before it first';
  const steps = [
    { n: 1, label: 'Source & voice', enabled: true },
    { n: 2, label: 'Review', enabled: openUpTo >= 2 },
    { n: 3, label: 'Final dub', enabled: openUpTo >= 3 },
    { n: 4, label: 'Sync', enabled: openUpTo >= 4 },
  ];
  const stepDone = (n: number) => (n === 1 ? hasCues : n === 2 || n === 3 ? hasDub : hasSync);

  return (
    <header className="relative z-20 w-full bg-slate-950/95 border-b border-slate-800/80 backdrop-blur-md select-none">
      <div className="min-h-[60px] px-4 sm:px-6 lg:px-8 py-2.5 grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5">
        {/* Left: brand and the project in hand */}
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-[9px] bg-slate-100 text-slate-950 flex items-center justify-center" aria-hidden="true">
              <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="6" width="2" height="4" rx="1" />
                <rect x="4.5" y="3" width="2" height="10" rx="1" />
                <rect x="8" y="1" width="2" height="14" rx="1" />
                <rect x="11.5" y="4.5" width="2" height="7" rx="1" />
              </svg>
            </div>
            <div className="leading-tight">
              <span className="block text-[13px] font-bold tracking-[0.16em] text-slate-100">DHVANI</span>
              <span className="hidden sm:block text-[10.5px] text-slate-500">Dubbing studio</span>
            </div>
          </div>
          <span className="hidden sm:block w-px h-7 bg-slate-800 shrink-0" />

          {activeJob?.file ? (
            <div className="hidden sm:flex items-center gap-2.5 min-w-0" title={activeJob.file.name}>
              <span className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 flex items-center justify-center shrink-0">
                {isVideo ? <Film className="w-4 h-4" /> : <Music className="w-4 h-4" />}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-slate-100 truncate max-w-[16rem]">{projectName(activeJob)}</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-slate-400 whitespace-nowrap">
                  <span className="hidden sm:inline truncate">
                    {[
                      `${sourceLanguage || 'Auto'} → ${targetLanguage || DEFAULT_TARGET_LANGUAGE}`,
                      mediaDuration ? formatClock(mediaDuration) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {statusPill}
                </span>
              </span>
            </div>
          ) : (
            <span className="hidden sm:block text-[12.5px] text-slate-500 truncate">No media yet. Drop a file to start.</span>
          )}
        </div>

        {/* Centre: the four steps */}
        <nav
          aria-label="Dubbing steps"
          className="col-span-2 md:col-span-1 row-start-2 md:row-start-auto justify-self-center flex items-center gap-0.5 p-[3px] rounded-full bg-slate-900 border border-slate-800 max-w-full overflow-x-auto [scrollbar-width:none]"
        >
          {/* Every step shows as it always has; one not reached yet just can't be opened. */}
          {steps.map((s) => {
            const on = activeStep === s.n;
            const done = !on && s.enabled && stepDone(s.n);
            const next = !on && s.enabled && !done && s.n === activeStep + 1 && (s.n !== 4 || hasDub);
            return (
              <button
                key={s.n}
                type="button"
                onClick={() => s.enabled && onStepChange(s.n)}
                disabled={!s.enabled}
                aria-current={on ? 'step' : undefined}
                aria-label={s.enabled ? undefined : `${s.label}, not available yet. ${lockedWhy(s.n)}.`}
                title={s.enabled ? (next ? `Next: ${s.label}` : s.label) : lockedWhy(s.n)}
                className={`flex items-center gap-2 pl-1 pr-3 lg:pr-3.5 py-1 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors ${
                  on
                    ? 'bg-slate-800 text-slate-100 shadow-sm'
                    : next
                      ? 'text-slate-200 hover:text-white cursor-pointer'
                      : s.enabled
                        ? 'text-slate-400 hover:text-slate-200 cursor-pointer'
                        : 'text-slate-400 cursor-default'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10.5px] font-mono border ${
                    on
                      ? 'bg-indigo-500 border-indigo-500 text-white'
                      : done
                        ? 'bg-emerald-500/15 border-transparent text-emerald-300'
                        : next
                          ? 'border-indigo-500 text-indigo-300'
                          : s.enabled
                            ? 'border-slate-700'
                            : 'border-slate-700'
                  }`}
                >
                  {done ? <Check className="w-3 h-3" /> : s.n}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
                {s.n === 2 && hasCues && s.enabled && (
                  <span className="hidden lg:inline font-mono text-[10px] text-cyan-300 tabular-nums">
                    {activeJob!.segments.length} cues
                  </span>
                )}
                {s.n === 4 && hasSync && syncPendingCount > 0 && (
                  <span
                    className="hidden lg:inline font-mono text-[10px] text-amber-300 tabular-nums"
                    title="Lines changed since the last sync. Sync again to hear them."
                  >
                    {syncPendingCount} changed
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right: update, services, queue, tools, new dub */}
        <div className="flex items-center justify-end gap-2 min-w-0">
          {/* Desktop app only. A running dub or sync holds back the restart. */}
          <UpdateControl busy={Boolean(activity)} />

          <div className="relative" ref={servicesRef}>
            <button
              type="button"
              onClick={() => {
                setToolsOpen(false);
                setProjectsOpen(false);
                setServicesOpen((o) => !o);
              }}
              aria-haspopup="dialog"
              aria-expanded={servicesOpen}
              className="flex items-center gap-2 h-[34px] px-2.5 rounded-full border border-slate-800 hover:bg-slate-800/60 text-xs text-slate-400 whitespace-nowrap transition-colors cursor-pointer"
              title={servicesOk ? 'Services connected' : 'Something needs setting up'}
            >
              <span
                className={`w-[7px] h-[7px] rounded-full ${
                  servicesOk ? 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.2)]' : 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.2)]'
                }`}
              />
              <span className="hidden md:inline">{voiceEngineName}</span>
              {quotaShare !== null && (
                <span className="hidden xl:flex items-center gap-1.5">
                  <span className="w-11 h-1 rounded-full bg-slate-800 overflow-hidden">
                    <span
                      className={`block h-full rounded-full ${quotaShare < 0.1 ? 'bg-rose-400' : quotaShare < 0.25 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                      style={{ width: `${quotaShare * 100}%` }}
                    />
                  </span>
                  <span className="font-mono tabular-nums">{compact(quotaLeft!)} left</span>
                </span>
              )}
            </button>

            {servicesOpen && (
              <div
                role="dialog"
                aria-label="Services"
                className="fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 top-28 sm:top-auto sm:mt-2 sm:w-[19rem] p-3.5 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl z-50 flex flex-col gap-3 animate-in fade-in zoom-in-95"
              >
                <div className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${elevenLabsReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-slate-100">ElevenLabs</span>
                    <span className="block text-[11.5px] text-slate-400">{roleOf('elevenlabs')}</span>
                  </span>
                  <span className="text-[11.5px] text-slate-400 capitalize">
                    {elevenLabsReady ? quota?.tier || 'Connected' : 'Not set'}
                  </span>
                </div>
                {cartesiaReady && (
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${roleOf('cartesia') === 'Off' ? 'bg-slate-600' : 'bg-emerald-400'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-100">Cartesia</span>
                      <span className="block text-[11.5px] text-slate-400">{roleOf('cartesia')}</span>
                    </span>
                    <span className="text-[11.5px] text-slate-400">Connected</span>
                  </div>
                )}
                {quota && quotaShare !== null && (
                  <div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${quotaShare < 0.1 ? 'bg-rose-400' : quotaShare < 0.25 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${quotaShare * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between gap-2 mt-1.5 text-[11.5px] text-slate-400">
                      <span className="font-mono tabular-nums">
                        {quotaLeft!.toLocaleString()} of {quota.limit.toLocaleString()} characters left
                      </span>
                      {quota.resetUnix && (
                        <span className="whitespace-nowrap">
                          Resets{' '}
                          {new Date(quota.resetUnix * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2.5">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${translationReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-slate-100">Translation</span>
                    <span className="block text-[11.5px] text-slate-400 truncate">
                      {translationReady ? translationSummary || 'Ready' : 'No engine set up yet'}
                    </span>
                  </span>
                  <span className="text-[11.5px] text-slate-400">{translationReady ? 'Working' : 'Not set'}</span>
                </div>
                {onOpenApiSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      setServicesOpen(false);
                      onOpenApiSettings();
                    }}
                    className="self-start px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-pointer"
                  >
                    API settings
                  </button>
                )}
              </div>
            )}
          </div>

          {onSelectProject && (
            <div className="relative" ref={projectsRef}>
              <button
                type="button"
                onClick={() => {
                  setToolsOpen(false);
                  setServicesOpen(false);
                  setProjectsOpen((o) => !o);
                }}
                aria-haspopup="dialog"
                aria-expanded={projectsOpen}
                className={`relative h-[34px] px-2.5 flex items-center gap-1.5 rounded-[9px] border text-[12.5px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  projectsOpen
                    ? 'bg-slate-800 border-slate-700 text-slate-100'
                    : 'border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                }`}
                title="Your projects"
                aria-label={projects.length > 0 ? `Your projects, ${projects.length}` : 'Your projects'}
              >
                <FolderOpen className="w-4 h-4" />
                <span className="hidden lg:inline">Projects</span>
                {projects.length > 0 && (
                  <span className="min-w-[17px] h-[17px] px-1 rounded-full bg-indigo-500 text-white text-[10px] font-mono font-semibold flex items-center justify-center">
                    {projects.length}
                  </span>
                )}
              </button>
              {projectsOpen && (
                <ProjectsMenu
                  projects={projects}
                  activeJobId={activeJob?.id ?? null}
                  onSelect={onSelectProject}
                  onRename={(id, name) => onRenameProject?.(id, name)}
                  onRemove={(id) => onRemoveProject?.(id)}
                  onNewDub={activeJob ? onResetSession : undefined}
                  onSeeAll={onOpenQueue}
                  onClose={closeProjects}
                />
              )}
            </div>
          )}

          <div className="relative" ref={toolsRef}>
            <button
              type="button"
              onClick={() => {
                setServicesOpen(false);
                setProjectsOpen(false);
                setToolsOpen((o) => !o);
              }}
              aria-haspopup="menu"
              aria-expanded={toolsOpen}
              className={`w-[34px] h-[34px] flex items-center justify-center rounded-[9px] border transition-colors cursor-pointer ${
                toolsOpen
                  ? 'bg-slate-800 border-slate-700 text-slate-100'
                  : 'border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
              }`}
              title="Tools and settings"
              aria-label="Tools and settings"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>

            {toolsOpen && (
              <div
                role="menu"
                className="fixed sm:absolute left-4 right-4 sm:left-auto sm:right-0 top-28 sm:top-auto sm:mt-2 sm:w-80 p-1.5 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl z-50 animate-in fade-in zoom-in-95"
              >
                {(onOpenPhoneticKeyboard || onOpenTextToSpeech || onOpenVoiceChanger || onOpenPauseSensitivity) && (
                  <>
                    <MenuHeading>Studio</MenuHeading>
                    {onOpenPhoneticKeyboard && (
                      <MenuItem
                        icon={<Keyboard className="w-4 h-4" />}
                        label="Phonetic keyboard"
                        hint="Type Roman, get Indian script"
                        end={<span className="font-mono text-[10.5px] text-slate-500 shrink-0">Ctrl G</span>}
                        onClick={runAndClose(onOpenPhoneticKeyboard)}
                      />
                    )}
                    {onOpenTextToSpeech && (
                      <MenuItem
                        icon={<Speech className="w-4 h-4" />}
                        label="Text to speech"
                        hint="Voice any text, compare both engines"
                        onClick={runAndClose(onOpenTextToSpeech)}
                      />
                    )}
                    {onOpenVoiceChanger && (
                      <MenuItem
                        icon={<AudioWaveform className="w-4 h-4" />}
                        label="Voice changer"
                        hint="Keep the delivery, swap the voice"
                        onClick={runAndClose(onOpenVoiceChanger)}
                      />
                    )}
                    {onOpenPauseSensitivity && (
                      <MenuItem
                        icon={<Activity className="w-4 h-4" />}
                        label="Pause detection"
                        hint="How lines are split at pauses"
                        end={
                          <span className="font-mono text-[10.5px] px-1.5 py-px rounded-md bg-slate-950 border border-slate-800 text-slate-300 shrink-0">
                            {pauseSensitivity}
                          </span>
                        }
                        onClick={runAndClose(onOpenPauseSensitivity)}
                      />
                    )}
                    <div className="h-px bg-slate-800 my-1.5 mx-1" />
                  </>
                )}

                {(onOpenApiSettings || onOpenSettings || onOpenCustomPrompt) && (
                  <>
                    <MenuHeading>Settings</MenuHeading>
                    {onOpenApiSettings && (
                      <MenuItem
                        icon={<KeyRound className="w-4 h-4" />}
                        label="API settings"
                        hint={translationSummary || 'ElevenLabs, Gemini or your own gateway'}
                        onClick={runAndClose(onOpenApiSettings)}
                      />
                    )}
                    {onOpenSettings && (
                      <MenuItem
                        icon={<Mic className="w-4 h-4" />}
                        label="Voice settings"
                        hint={voiceSummary || 'ElevenLabs voice engine'}
                        onClick={runAndClose(onOpenSettings)}
                      />
                    )}
                    {onOpenCustomPrompt && (
                      <MenuItem
                        icon={<AlignLeft className="w-4 h-4" />}
                        label="Translation style"
                        hint={translationStyleName || 'Prompt and persona'}
                        onClick={runAndClose(onOpenCustomPrompt)}
                      />
                    )}
                  </>
                )}

                {updatesSupported() && (
                  <>
                    <div className="h-px bg-slate-800 my-1.5 mx-1" />
                    <MenuItem
                      icon={<Download className="w-4 h-4" />}
                      label="Check for updates"
                      hint="Get the latest version"
                      onClick={runAndClose(openUpdates)}
                    />
                  </>
                )}

                {onThemeModeChange && (
                  <>
                    <div className="h-px bg-slate-800 my-1.5 mx-1" />
                    <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
                      <span className="text-[12.5px] text-slate-400">Theme</span>
                      <div role="group" aria-label="Theme" className="flex bg-slate-950 border border-slate-800 rounded-lg p-0.5 gap-0.5">
                        {(['auto', 'light', 'dark'] as const).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={themeMode === mode}
                            onClick={() => onThemeModeChange(mode)}
                            className={`px-2.5 py-1 rounded-md text-xs capitalize transition-colors cursor-pointer ${
                              themeMode === mode ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {mode}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {activeJob && onResetSession && (
            <button
              type="button"
              onClick={onResetSession}
              className="flex items-center gap-1.5 h-[34px] px-3 rounded-[9px] bg-slate-100 hover:bg-white text-slate-950 text-[12.5px] font-semibold whitespace-nowrap transition-colors cursor-pointer"
              title="Start a new dub"
            >
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
              <span className="hidden sm:inline">New dub</span>
            </button>
          )}
        </div>
      </div>

      {/* Live progress along the bottom edge while anything runs */}
      {activity && (
        <div className="absolute left-0 right-0 -bottom-px h-0.5 overflow-hidden" aria-hidden="true">
          {activity.fraction === null ? (
            <div className="h-full w-1/3 bg-gradient-to-r from-indigo-500 to-cyan-400 animate-[dubsweep_1.4s_ease-in-out_infinite]" />
          ) : (
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-[width] duration-500"
              style={{ width: `${Math.max(2, activity.fraction * 100)}%` }}
            />
          )}
        </div>
      )}
    </header>
  );
};
