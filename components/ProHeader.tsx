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
  RefreshCw,
} from 'lucide-react';
import { BatchJob, ProcessingStatus } from '../types';
import { UpdateControl, openUpdates, updatesSupported, useUpdateState } from './UpdateControl';
import { CenteredPanel } from './CenteredPanel';
import { HubMeter, ToolsHub, type ToolsHubItem } from './ToolsHub';
import { readOptions } from './SyncPanel';
import { SYNC_JOIN_PRESET_OPTIONS, SYNC_PRECISION_OPTIONS, SYNC_SCREEN_OPTIONS, type SyncJoinPreset, type SyncScreen } from '../services/syncService';
import { projectName } from '../services/projects';
import type { CartesiaUsage, GatewayUsage } from '../services/usageService';

/** The dub language a new install starts on. */
export const DEFAULT_TARGET_LANGUAGE = 'Hindi';

export const DEFAULT_LANGUAGES = [
  { code: 'Assamese', label: 'Assamese (অসমীয়া)' },
  { code: 'Bengali', label: 'Bengali (বাংলা)' },
  { code: 'Gujarati', label: 'Gujarati (ગુજરાતી)' },
  { code: 'Hindi', label: 'Hindi (हिन्दी)' },
  { code: 'Kannada', label: 'Kannada (ಕನ್ನಡ)' },
  { code: 'Malayalam', label: 'Malayalam (മലയാളം)' },
  { code: 'Marathi', label: 'Marathi (मराठी)' },
  { code: 'Nepali', label: 'Nepali (नेपाली)' },
  { code: 'Odia', label: 'Odia (ଓଡ଼ିଆ)' },
  { code: 'Punjabi', label: 'Punjabi (ਪੰਜਾਬੀ)' },
  { code: 'Tamil', label: 'Tamil (தமிழ்)' },
  { code: 'Telugu', label: 'Telugu (తెలుగు)' },
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
  /** The last step that may be opened (services/steps.ts openSteps), and why each later one can't be yet. */
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
  /** Cartesia credits used this month, and the LLM gateway's budget, for the balance popover. */
  cartesiaUsage?: CartesiaUsage | null;
  gatewayUsage?: GatewayUsage | null;
  /** When the balances were last fetched, and whether a fetch is running. */
  usageUpdatedAt?: number | null;
  usageLoading?: boolean;
  /** Fetches every balance again; also called when the popover opens. */
  onRefreshUsage?: () => void;
  /** The engine speaking the dub. ElevenLabs always transcribes. */
  voiceEngine?: 'elevenlabs' | 'cartesia';
  /** True when a Cartesia key is set up; shows Cartesia in the services panel. */
  cartesiaReady?: boolean;
  elevenLabsReady?: boolean;
  translationReady?: boolean;
  /** One line describing where translation runs. */
  translationSummary?: string | null;
  voiceSummary?: string | null;
  /** The voice the dub is spoken in, for Tools and settings. */
  voiceName?: string | null;
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
  /** Opens the Sync settings window: how each dub line is placed. */
  onOpenSyncSettings?: () => void;
  pauseSensitivity?: number;
  onResetSession?: () => void;
  /** Opens Your projects, the full list (the header's Projects button). */
  onOpenQueue?: () => void;
  /** Every saved project, for the count on the Projects button. */
  projects?: BatchJob[];
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

/** Colour for a share left: red under 10%, amber under 25%. */
const shareTone = (share: number | null) =>
  share === null
    ? { bar: 'bg-slate-600', text: 'text-slate-100', border: 'border-slate-800' }
    : share < 0.1
      ? { bar: 'bg-rose-400', text: 'text-rose-300', border: 'border-rose-900/60' }
      : share < 0.25
        ? { bar: 'bg-amber-400', text: 'text-amber-300', border: 'border-amber-900/60' }
        : { bar: 'bg-emerald-400', text: 'text-slate-100', border: 'border-slate-800' };

const shortDate = (when: number | string) =>
  new Date(when).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** A line-join preset's name, as Sync settings shows it. */
const presetName = (sync: { preset: SyncJoinPreset; screen?: SyncScreen }) =>
  [
    (SYNC_JOIN_PRESET_OPTIONS.find((p) => p.id === sync.preset)?.label ?? 'Custom').replace(' (recommended)', ''),
    sync.screen && sync.screen !== 'any' && SYNC_SCREEN_OPTIONS.find((s) => s.id === sync.screen)?.label,
  ].filter(Boolean).join(' · ');

const money = (n: number) => `$${Math.max(0, n).toFixed(2)}`;

const gatewayReset = (usage: GatewayUsage) =>
  usage.resetAt ? `Resets ${shortDate(usage.resetAt)}` : usage.resetPeriod ? `Resets ${usage.resetPeriod}` : undefined;

/** "Updated just now", "Updated 4 min ago". */
const updatedLabel = (at: number | null | undefined) => {
  if (!at) return '';
  const minutes = Math.floor((Date.now() - at) / 60000);
  return minutes < 1 ? 'Updated just now' : minutes < 60 ? `Updated ${minutes} min ago` : `Updated ${shortDate(at)}`;
};

/** One service in the balance popover. The border turns amber or red as its balance runs low. */
const UsageCard: React.FC<{
  name: string;
  role: string;
  chip?: string;
  ok: boolean;
  share: number | null;
  children: React.ReactNode;
}> = ({ name, role, chip, ok, share, children }) => (
  <div className={`p-3 rounded-xl border bg-slate-950/50 ${shareTone(share).border}`}>
    <div className="flex items-center gap-2 min-w-0">
      <span className={`w-2 h-2 rounded-full shrink-0 ${ok ? 'bg-emerald-400' : 'bg-slate-600'}`} />
      <span className="text-[13px] font-semibold text-slate-100 flex-1 truncate">{name}</span>
      {chip && (
        <span className="max-w-[9rem] truncate text-[10.5px] font-medium px-1.5 py-px rounded-md bg-slate-800 text-slate-400">
          {chip}
        </span>
      )}
    </div>
    <p className="text-[11px] text-slate-500 ml-4 mb-2 truncate">{role}</p>
    {children}
  </div>
);

/** A big remaining figure over a bar, with the exact numbers and the reset date beneath. */
const Balance: React.FC<{ value: string; unit: string; share: number; left: string; right?: string }> = ({
  value,
  unit,
  share,
  left,
  right,
}) => (
  <>
    <div className="flex items-baseline gap-1.5">
      <span className={`font-mono tabular-nums text-xl font-semibold ${shareTone(share).text}`}>{value}</span>
      <span className="text-xs text-slate-400">{unit}</span>
    </div>
    <div className="h-1.5 my-1.5 rounded-full bg-slate-800 overflow-hidden">
      <div className={`h-full rounded-full ${shareTone(share).bar}`} style={{ width: `${Math.min(1, share) * 100}%` }} />
    </div>
    <div className="flex justify-between gap-2 text-[11px] text-slate-500">
      <span className="font-mono tabular-nums">{left}</span>
      {right && <span className="whitespace-nowrap">{right}</span>}
    </div>
  </>
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
  cartesiaUsage = null,
  gatewayUsage = null,
  usageUpdatedAt = null,
  usageLoading = false,
  onRefreshUsage,
  voiceEngine = 'elevenlabs',
  cartesiaReady = false,
  elevenLabsReady = true,
  translationReady = true,
  translationSummary,
  voiceSummary,
  voiceName,
  translationStyleName,
  onOpenSettings,
  onOpenApiSettings,
  onOpenCustomPrompt,
  onOpenPhoneticKeyboard,
  onOpenVoiceChanger,
  onOpenTextToSpeech,
  onOpenPauseSensitivity,
  onOpenSyncSettings,
  pauseSensitivity = 50,
  onResetSession,
  onOpenQueue,
  projects = [],
}) => {
  const [toolsOpen, setToolsOpen] = React.useState(false);
  const [servicesOpen, setServicesOpen] = React.useState(false);
  const toolsRef = React.useRef<HTMLDivElement>(null);
  const closeTools = React.useCallback(() => setToolsOpen(false), []);
  const closeServices = React.useCallback(() => setServicesOpen(false), []);


  const hasCues = Boolean(activeJob && activeJob.segments.length > 0);
  const hasDub = Boolean(activeJob?.synthesizedAudioUrl || activeJob?.syncedAudioUrl);
  const hasSync = Boolean(activeJob?.syncedAudioUrl && activeJob?.syncReport);
  const servicesOk = elevenLabsReady && translationReady;
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
  const gatewayShare =
    gatewayUsage && typeof gatewayUsage.spent === 'number' && gatewayUsage.limit && gatewayUsage.limit > 0
      ? Math.max(0, gatewayUsage.limit - gatewayUsage.spent) / gatewayUsage.limit
      : null;
  // One small bar per service that reports a balance, so a low one shows without opening the popover.
  const pillBars = [
    elevenLabsReady && quotaShare !== null && { key: 'elevenlabs', share: quotaShare },
    gatewayShare !== null && { key: 'gateway', share: gatewayShare },
  ].filter(Boolean) as { key: string; share: number }[];

  // Ctrl K opens Tools and settings from anywhere, unless another window is open over the page.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'k') return;
      if (!toolsOpen && document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      setServicesOpen(false);
      setToolsOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toolsOpen]);

  /** The sync settings this project will use, read the way the Dub step reads them. */
  const sync = readOptions(activeJob?.syncOptions);
  const engineName = voiceEngine === 'cartesia' ? 'Cartesia' : 'ElevenLabs';
  const lineCount = activeJob?.segments.length ?? 0;
  const updateState = useUpdateState();
  const updateOffered = Boolean(updateState?.version) && ['available', 'downloading', 'downloaded'].includes(updateState!.status);
  const updateSummary = !updateState
    ? null
    : updateOffered
      ? `${updateState.version} available`
      : updateState.status === 'not-available'
        ? `${updateState.currentVersion} · up to date`
        : `Version ${updateState.currentVersion}`;
  const hubItems: ToolsHubItem[] = [
    onOpenPhoneticKeyboard && {
      id: 'keyboard',
      group: 'Studio',
      label: 'Phonetic keyboard',
      hint: 'Type Roman, get Indian script',
      summary: targetLanguage || DEFAULT_TARGET_LANGUAGE,
      icon: Keyboard,
      tone: 'indigo',
      facts: [
        { label: 'Script', value: targetLanguage || DEFAULT_TARGET_LANGUAGE },
        { label: "In a line's text box", value: 'Ctrl G' },
      ],
      onOpen: onOpenPhoneticKeyboard,
    },
    onOpenTextToSpeech && {
      id: 'tts',
      group: 'Studio',
      label: 'Text to speech',
      hint: 'Voice any text, compare both engines',
      summary: engineName,
      icon: Speech,
      tone: 'teal',
      facts: [
        { label: 'Engine', value: engineName },
        { label: 'Model', value: voiceSummary || '—' },
      ],
      onOpen: onOpenTextToSpeech,
    },
    onOpenVoiceChanger && {
      id: 'voice-changer',
      group: 'Studio',
      label: 'Voice changer',
      hint: 'Keep the delivery, swap the voice',
      summary: hasSync ? 'Synced dub ready' : null,
      icon: AudioWaveform,
      tone: 'pink',
      facts: [
        { label: 'Keeps', value: 'Timing and delivery' },
        { label: 'Synced dub', value: hasSync ? 'Ready to change' : 'Not synced yet', status: hasSync ? 'ok' : 'off' },
      ],
      onOpen: onOpenVoiceChanger,
    },
    onOpenPauseSensitivity && {
      id: 'pauses',
      group: 'Studio',
      label: 'Pause detection',
      hint: 'How lines are split at pauses',
      summary: `${pauseSensitivity}${hasCues ? ` · ${lineCount} lines` : ''}`,
      icon: Activity,
      tone: 'amber',
      facts: [
        { label: 'Sensitivity', value: String(pauseSensitivity) },
        { label: 'Lines now', value: hasCues ? lineCount.toLocaleString() : 'No transcript yet' },
      ],
      extra: <HubMeter share={pauseSensitivity / 100} left="Fewer, longer lines" right="More, shorter lines" tone="amber" />,
      onOpen: onOpenPauseSensitivity,
    },
    onOpenApiSettings && {
      id: 'api',
      group: 'Settings',
      label: 'API settings',
      hint: 'ElevenLabs, Cartesia and your translation engine',
      summary: translationSummary,
      icon: KeyRound,
      tone: 'slate',
      facts: [
        { label: 'ElevenLabs', value: elevenLabsReady ? 'Connected' : 'Not set up', status: elevenLabsReady ? 'ok' : 'off' },
        { label: 'Cartesia', value: cartesiaReady ? 'Connected' : 'Not set up', status: cartesiaReady ? 'ok' : 'off' },
        { label: 'Translation', value: translationSummary || (translationReady ? 'Ready' : 'Not set up'), status: translationReady ? 'ok' : 'off' },
      ],
      extra:
        quota && quotaShare !== null ? (
          <HubMeter
            share={quotaShare}
            left={`ElevenLabs: ${compact(quotaLeft!)} of ${compact(quota.limit)} characters left`}
            right={quota.resetUnix ? `Resets ${shortDate(quota.resetUnix * 1000)}` : undefined}
            tone={quotaShare < 0.1 ? 'rose' : quotaShare < 0.25 ? 'amber' : 'emerald'}
          />
        ) : undefined,
      onOpen: onOpenApiSettings,
    },
    onOpenSettings && {
      id: 'voice',
      group: 'Settings',
      label: 'Voice settings',
      hint: 'The voice engine and how the voice sounds',
      summary: [voiceName, voiceSummary].filter(Boolean).join(' · ') || null,
      icon: Mic,
      tone: 'blue',
      facts: [
        { label: 'Voice', value: voiceName || '—' },
        { label: 'Engine', value: voiceSummary || engineName },
      ],
      note: 'Used for the dub, Sync and text to speech.',
      onOpen: onOpenSettings,
    },
    onOpenSyncSettings && {
      id: 'sync',
      group: 'Settings',
      label: 'Sync settings',
      hint: 'How each dub line is placed',
      summary: `${sync.voicing === 'continuous' ? 'Continuous read' : 'Line by line'} · ${presetName(sync)}`,
      icon: SlidersHorizontal,
      tone: 'violet',
      facts: [
        { label: 'How to voice', value: sync.voicing === 'continuous' ? 'One continuous read' : 'Line by line' },
        { label: 'Precision', value: SYNC_PRECISION_OPTIONS.find((o) => o.id === sync.precision)?.label ?? sync.precision },
        { label: 'Line joins', value: presetName(sync) },
        { label: 'Chunk sync', value: sync.join.chunkSync ? 'On' : 'Off', status: sync.join.chunkSync ? 'ok' : 'off' },
      ],
      note: activeJob ? 'For this project. Changes apply to the next sync.' : 'For your next project.',
      onOpen: onOpenSyncSettings,
    },
    onOpenCustomPrompt && {
      id: 'style',
      group: 'Settings',
      label: 'Translation style',
      hint: 'The prompt and persona translation follows',
      summary: translationStyleName,
      icon: AlignLeft,
      tone: 'emerald',
      facts: [
        { label: 'Style', value: translationStyleName || '—' },
        { label: 'Dub language', value: targetLanguage || DEFAULT_TARGET_LANGUAGE },
      ],
      note: 'Used for the next translation.',
      onOpen: onOpenCustomPrompt,
    },
    updatesSupported() && {
      id: 'updates',
      group: 'App',
      label: 'Check for updates',
      hint: 'Look for a newer DHVANI and install it',
      summary: updateSummary,
      icon: RefreshCw,
      tone: 'slate',
      facts: [
        { label: 'Installed', value: updateState?.currentVersion || '—' },
        {
          label: 'Latest',
          value: updateOffered ? updateState!.version : updateState?.status === 'not-available' ? 'You have it' : 'Not checked yet',
          status: updateOffered ? 'ok' : undefined,
        },
      ],
      openLabel: 'Check now',
      onOpen: openUpdates,
    },
  ].filter(Boolean) as ToolsHubItem[];

  // Balances go stale between dubs; opening the popover fetches them again.
  React.useEffect(() => {
    if (servicesOpen) onRefreshUsage?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servicesOpen]);
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
    { n: 3, label: 'Dub', enabled: openUpTo >= 3 },
  ];
  const stepDone = (n: number) => (n === 1 ? hasCues : n === 2 ? hasDub : hasSync);

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

        {/* Centre: the three steps */}
        <nav
          aria-label="Dubbing steps"
          className="col-span-2 md:col-span-1 row-start-2 md:row-start-auto justify-self-center flex items-center gap-0.5 p-[3px] rounded-full bg-slate-900 border border-slate-800 max-w-full overflow-x-auto [scrollbar-width:none]"
        >
          {/* Every step shows as it always has; one not reached yet just can't be opened. */}
          {steps.map((s) => {
            const on = activeStep === s.n;
            const done = !on && s.enabled && stepDone(s.n);
            const next = !on && s.enabled && !done && s.n === activeStep + 1;
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
                      ? 'text-slate-200 hover:text-white cursor-default'
                      : s.enabled
                        ? 'text-slate-400 hover:text-slate-200 cursor-default'
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
                {s.n === 3 && hasSync && syncPendingCount > 0 && (
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

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setToolsOpen(false);
                setServicesOpen((o) => !o);
              }}
              aria-haspopup="dialog"
              aria-expanded={servicesOpen}
              className="flex items-center gap-2 h-[34px] px-2.5 rounded-full border border-slate-800 hover:bg-slate-800/60 text-xs text-slate-400 whitespace-nowrap transition-colors cursor-default"
              title={servicesOk ? 'Services connected. Open to see what each has left.' : 'Something needs setting up'}
            >
              <span
                className={`w-[7px] h-[7px] rounded-full ${
                  servicesOk ? 'bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.2)]' : 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.2)]'
                }`}
              />
              <span className="hidden md:inline text-slate-200">{servicesOk ? 'Online' : 'Needs setup'}</span>
              {pillBars.length > 0 && (
                <span className="hidden xl:flex items-center gap-[3px]" aria-hidden="true">
                  {pillBars.map((bar) => (
                    <span key={bar.key} className={`w-3.5 h-1 rounded-full ${shareTone(bar.share).bar}`} />
                  ))}
                </span>
              )}
            </button>

            <CenteredPanel open={servicesOpen} onClose={closeServices} label="Balance and connections" className="max-w-[26rem] p-4 gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-slate-100">Balance and connections</span>
                <span className="text-[11px] text-slate-500">{usageLoading ? 'Checking…' : updatedLabel(usageUpdatedAt)}</span>
              </div>

              <UsageCard
                name="ElevenLabs"
                role={roleOf('elevenlabs')}
                chip={elevenLabsReady && quota?.tier ? quota.tier.charAt(0).toUpperCase() + quota.tier.slice(1) : undefined}
                ok={elevenLabsReady}
                share={quotaShare}
              >
                {!elevenLabsReady ? (
                  <p className="text-[11.5px] text-amber-300">No key set up yet</p>
                ) : quota && quotaShare !== null ? (
                  <Balance
                    value={compact(quotaLeft!)}
                    unit="characters left"
                    share={quotaShare}
                    left={`${quotaLeft!.toLocaleString()} of ${quota.limit.toLocaleString()}`}
                    right={quota.resetUnix ? `Resets ${shortDate(quota.resetUnix * 1000)}` : undefined}
                  />
                ) : (
                  <p className="text-[11.5px] text-slate-400">{usageLoading ? 'Checking…' : 'Connected'}</p>
                )}
              </UsageCard>

              {cartesiaReady && (
                <UsageCard name="Cartesia" role={roleOf('cartesia')} ok={roleOf('cartesia') !== 'Off'} share={null}>
                  {cartesiaUsage?.creditsUsed !== undefined ? (
                    <>
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-mono tabular-nums text-xl font-semibold text-slate-100">
                          {compact(cartesiaUsage.creditsUsed)}
                        </span>
                        <span className="text-xs text-slate-400">credits used this month</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {cartesiaUsage.creditsUsed.toLocaleString()} since{' '}
                        {cartesiaUsage.since ? shortDate(cartesiaUsage.since) : 'the 1st'}. Cartesia doesn't share the balance.
                      </p>
                    </>
                  ) : (
                    <p className="text-[11.5px] text-slate-400">
                      {cartesiaUsage?.needsAdminKey
                        ? 'Connected. Add a Cartesia admin key in API settings to see credits used.'
                        : cartesiaUsage?.error || (usageLoading ? 'Checking…' : 'Connected')}
                    </p>
                  )}
                </UsageCard>
              )}

              {gatewayUsage?.configured ? (
                <UsageCard
                  name="Your LLM gateway"
                  role="Translation"
                  chip={gatewayUsage.model || undefined}
                  ok={translationReady}
                  share={gatewayShare}
                >
                  {typeof gatewayUsage.spent === 'number' ? (
                    gatewayShare !== null ? (
                      <Balance
                        value={money(gatewayUsage.limit! - gatewayUsage.spent)}
                        unit={`of ${money(gatewayUsage.limit!)} budget left`}
                        share={gatewayShare}
                        left={`${money(gatewayUsage.spent)} spent`}
                        right={gatewayReset(gatewayUsage)}
                      />
                    ) : (
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-mono tabular-nums text-xl font-semibold text-slate-100">
                          {money(gatewayUsage.spent)}
                        </span>
                        <span className="text-xs text-slate-400">spent, no budget limit</span>
                      </div>
                    )
                  ) : (
                    <p className="text-[11.5px] text-slate-400">Connected. Your gateway doesn't share a budget.</p>
                  )}
                </UsageCard>
              ) : (
                <UsageCard
                  name="Translation"
                  role={translationReady ? translationSummary || 'Ready' : 'No engine set up yet'}
                  ok={translationReady}
                  share={null}
                >
                  <p className="text-[11.5px] text-slate-400">{translationReady ? 'Working' : 'Not set'}</p>
                </UsageCard>
              )}

              <div className="flex items-center gap-2">
                {onRefreshUsage && (
                  <button
                    type="button"
                    onClick={onRefreshUsage}
                    disabled={usageLoading}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-default disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${usageLoading ? 'animate-spin' : ''}`} />
                    Refresh
                  </button>
                )}
                {onOpenApiSettings && (
                  <button
                    type="button"
                    onClick={() => {
                      setServicesOpen(false);
                      onOpenApiSettings();
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-xs font-medium text-slate-200 cursor-default"
                  >
                    API settings
                  </button>
                )}
              </div>
            </CenteredPanel>
          </div>

          {onOpenQueue && (
            <button
              type="button"
              onClick={() => {
                setToolsOpen(false);
                setServicesOpen(false);
                onOpenQueue();
              }}
              aria-haspopup="dialog"
              className="relative h-[34px] px-2.5 flex items-center gap-1.5 rounded-[9px] border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 text-[12.5px] font-medium whitespace-nowrap transition-colors cursor-default"
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
          )}

          <div className="relative" ref={toolsRef}>
            <button
              type="button"
              onClick={() => {
                setServicesOpen(false);
                setToolsOpen((o) => !o);
              }}
              aria-haspopup="dialog"
              aria-expanded={toolsOpen}
              className={`w-[34px] h-[34px] flex items-center justify-center rounded-[9px] border transition-colors cursor-default ${
                toolsOpen
                  ? 'bg-slate-800 border-slate-700 text-slate-100'
                  : 'border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
              }`}
              title="Tools and settings (Ctrl K)"
              aria-label="Tools and settings"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>

            <ToolsHub open={toolsOpen} onClose={closeTools} items={hubItems} />
          </div>

          {activeJob && onResetSession && (
            <button
              type="button"
              onClick={onResetSession}
              className="flex items-center gap-1.5 h-[34px] px-3 rounded-[9px] bg-slate-100 hover:bg-white text-slate-950 text-[12.5px] font-semibold whitespace-nowrap transition-colors cursor-default"
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
