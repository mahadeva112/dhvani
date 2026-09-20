import React from 'react';
import {
  Settings,
  SlidersHorizontal,
  Radio,
  FileAudio,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  Layers,
  Sun,
  Moon,
  Monitor,
  Keyboard,
  AudioWaveform,
  Sliders,
  Key,
  Wrench,
  ChevronDown,
} from 'lucide-react';
import { BatchJob, ProcessingStatus } from '../types';

export type ThemeMode = 'auto' | 'light' | 'dark';

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

export interface ProHeaderProps {
  activeJob: BatchJob | null;
  onOpenSettings?: () => void;
  /** Opens the API & translation engine dialog. Hidden when keys are env-managed. */
  onOpenApiSettings?: () => void;
  /** One line describing where translation runs, shown on the API Settings item. */
  translationSummary?: string | null;
  onOpenCustomPrompt?: () => void;
  onOpenPhoneticKeyboard?: () => void;
  onOpenVoiceChanger?: () => void;
  onOpenPauseSensitivity?: () => void;
  pauseSensitivity?: number;
  onResetSession?: () => void;
  onOpenQueue?: () => void;
  queueCount?: number;
  targetLanguage?: string;
  language?: string;
  onTargetLanguageChange?: (lang: string) => void;
  onLanguageChange?: (lang: string) => void;
  languages?: { code: string; label: string }[] | string[];
  theme?: 'dark' | 'light';
  themeMode?: ThemeMode;
  onThemeModeChange?: (mode: ThemeMode) => void;
  onToggleTheme?: () => void;
}

/** One row in the Tools menu: icon, label, a hint line and an optional trailing badge. */
const ToolsMenuItem: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint?: string | null;
  badge?: React.ReactNode;
  title?: string;
  onClick: () => void;
}> = ({ icon, label, hint, badge, title, onClick }) => (
  <button
    type="button"
    role="menuitem"
    onClick={onClick}
    title={title}
    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left text-slate-200 hover:bg-slate-800/90 hover:text-white transition-colors cursor-pointer"
  >
    <span className="shrink-0">{icon}</span>
    <span className="min-w-0 flex-1">
      <span className="block text-xs font-semibold leading-tight">{label}</span>
      {hint ? (
        <span className="block text-[10px] font-mono text-slate-500 truncate leading-tight mt-0.5">{hint}</span>
      ) : null}
    </span>
    {badge}
  </button>
);

export const ProHeader: React.FC<ProHeaderProps> = ({
  activeJob,
  onOpenSettings,
  onOpenApiSettings,
  translationSummary,
  onOpenCustomPrompt,
  onOpenPhoneticKeyboard,
  onOpenVoiceChanger,
  onOpenPauseSensitivity,
  pauseSensitivity = 50,
  onResetSession,
  onOpenQueue,
  queueCount = 0,
  targetLanguage,
  language,
  onTargetLanguageChange,
  onLanguageChange,
  languages,
  theme = 'dark',
  themeMode = 'auto',
  onThemeModeChange,
  onToggleTheme,
}) => {
  const currentLanguage = targetLanguage || language || activeJob?.language || 'Bengali';
  const handleLangChange = onTargetLanguageChange || onLanguageChange || (() => {});

  // Tools menu: collapses the six tool/settings dialogs into a single header control.
  const [toolsOpen, setToolsOpen] = React.useState(false);
  const toolsRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!toolsOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setToolsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [toolsOpen]);

  /** Runs a menu action and closes the menu behind it. */
  const runAndClose = (fn?: () => void) => () => {
    setToolsOpen(false);
    fn?.();
  };

  const getStatusBadge = () => {
    if (!activeJob) return null;
    switch (activeJob.status) {
      case ProcessingStatus.COMPLETED:
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-800/60">
            <CheckCircle2 className="w-2.5 h-2.5" /> Dub Ready
          </span>
        );
      case ProcessingStatus.ERROR:
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded-full border border-rose-800/60">
            <AlertCircle className="w-2.5 h-2.5" /> Error
          </span>
        );
      case ProcessingStatus.IDLE:
        return (
          <span className="text-[10px] font-mono text-slate-600 bg-slate-100 dark:text-slate-400 dark:bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-300 dark:border-slate-700/50">
            Standby
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded-full border border-indigo-800/60 animate-pulse">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
            {activeJob.status.replace(/_/g, ' ')}
          </span>
        );
    }
  };

  const hasStudioTools = Boolean(onOpenPhoneticKeyboard || onOpenVoiceChanger || onOpenPauseSensitivity);
  const hasSettings = Boolean(onOpenApiSettings || onOpenSettings || onOpenCustomPrompt);

  return (
    <header className="w-full bg-slate-950/95 border-b border-slate-800/80 px-4 sm:px-6 lg:px-8 py-2.5 sm:py-3 flex items-center justify-between gap-3 select-none z-20 backdrop-blur-md">
      {/* Left: Brand Identity & Active Audio Info */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-md shadow-indigo-500/20 ring-1 ring-white/20 shrink-0">
            <Radio className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="text-sm sm:text-base font-bold tracking-tight text-white font-display">DHVANI</span>
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-700/50">
                AI DUBBING
              </span>
            </div>
            <p className="text-[9px] font-mono text-slate-400 leading-none mt-1 hidden sm:block">
              Audio ➔ Translation Review ➔ ElevenLabs Dub
            </p>
          </div>
        </div>

        {activeJob?.file?.name ? (
          <div className="hidden md:flex items-center gap-2 bg-slate-900/90 border border-slate-800 px-2.5 py-1 rounded-xl">
            <FileAudio className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-xs font-semibold text-slate-200 max-w-[160px] truncate" title={activeJob.file.name}>
              {activeJob.file.name}
            </span>
            {getStatusBadge()}
          </div>
        ) : null}
      </div>

      {/* Right: Batch Queue, Tools menu, theme, Reset */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Batch Queue Manager Button */}
        {onOpenQueue && (
          <button
            onClick={onOpenQueue}
            title="Batch Queue Manager"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/40 text-slate-200 hover:text-indigo-200 transition-all text-xs font-semibold cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden lg:inline">Batch Queue</span>
            {queueCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-indigo-600 text-white font-mono text-[10px] font-bold">
                {queueCount}
              </span>
            )}
          </button>
        )}

        {/* Tools & Settings: one menu for the keyboard, voice, pause and API dialogs */}
        {(hasStudioTools || hasSettings) && (
          <div className="relative" ref={toolsRef}>
            <button
              type="button"
              onClick={() => setToolsOpen((open) => !open)}
              title="Tools & Settings"
              aria-haspopup="menu"
              aria-expanded={toolsOpen}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border transition-all text-xs font-semibold cursor-pointer ${
                toolsOpen
                  ? 'bg-slate-800 border-indigo-500/50 text-white'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-800 hover:border-indigo-500/40 text-slate-200 hover:text-indigo-200'
              }`}
            >
              <Wrench className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Tools</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${toolsOpen ? 'rotate-180' : ''}`} />
            </button>

            {toolsOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-2 w-64 p-1.5 rounded-2xl bg-slate-950 border border-slate-800 shadow-2xl shadow-black/50 z-50"
              >
                {hasStudioTools && (
                  <>
                    <p className="px-2.5 pt-1.5 pb-1 text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase">
                      Studio
                    </p>
                    {onOpenPhoneticKeyboard && (
                      <ToolsMenuItem
                        icon={<Keyboard className="w-4 h-4 text-indigo-400" />}
                        label="Phonetic Keyboard"
                        hint="Roman to Indian script"
                        onClick={runAndClose(onOpenPhoneticKeyboard)}
                      />
                    )}
                    {onOpenVoiceChanger && (
                      <ToolsMenuItem
                        icon={<AudioWaveform className="w-4 h-4 text-purple-400" />}
                        label="Voice Changer"
                        hint="Speech-to-speech, clone, filters"
                        onClick={runAndClose(onOpenVoiceChanger)}
                      />
                    )}
                    {onOpenPauseSensitivity && (
                      <ToolsMenuItem
                        icon={<Sliders className="w-4 h-4 text-cyan-400" />}
                        label="Pause Sensitivity"
                        hint="Dialogue pause detection (VAD)"
                        badge={
                          <span className="px-1.5 py-0.5 rounded-full bg-cyan-900/70 text-cyan-200 font-mono text-[10px] font-bold shrink-0">
                            {pauseSensitivity}%
                          </span>
                        }
                        onClick={runAndClose(onOpenPauseSensitivity)}
                      />
                    )}
                  </>
                )}

                {hasStudioTools && hasSettings && <div className="my-1 mx-2 h-px bg-slate-800" />}

                {hasSettings && (
                  <>
                    <p className="px-2.5 pt-1.5 pb-1 text-[9px] font-mono font-bold tracking-wider text-slate-500 uppercase">
                      Settings
                    </p>
                    {onOpenApiSettings && (
                      <ToolsMenuItem
                        icon={<Key className="w-4 h-4 text-emerald-400" />}
                        label="API Settings"
                        hint={translationSummary || 'ElevenLabs, Gemini or LLM gateway'}
                        title={
                          translationSummary
                            ? `API Settings - ${translationSummary}`
                            : 'API Settings: ElevenLabs key, Gemini key, or your own LLM gateway'
                        }
                        onClick={runAndClose(onOpenApiSettings)}
                      />
                    )}
                    {onOpenSettings && (
                      <ToolsMenuItem
                        icon={<Settings className="w-4 h-4 text-cyan-400" />}
                        label="Voice Settings"
                        hint="ElevenLabs voice engine"
                        onClick={runAndClose(onOpenSettings)}
                      />
                    )}
                    {onOpenCustomPrompt && (
                      <ToolsMenuItem
                        icon={<SlidersHorizontal className="w-4 h-4 text-indigo-400" />}
                        label="Custom Prompt"
                        hint="Translation prompt & persona"
                        onClick={runAndClose(onOpenCustomPrompt)}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Single Theme Cycle Button: Auto -> Light -> Dark -> Auto */}
        {(onThemeModeChange || onToggleTheme) && (
          <button
            type="button"
            onClick={() => {
              if (onThemeModeChange) {
                if (themeMode === 'auto') onThemeModeChange('light');
                else if (themeMode === 'light') onThemeModeChange('dark');
                else onThemeModeChange('auto');
              } else if (onToggleTheme) {
                onToggleTheme();
              }
            }}
            title={
              themeMode === 'auto'
                ? `Theme: Auto (${theme === 'dark' ? 'Dark' : 'Light'} from system) - Click for Light`
                : themeMode === 'light'
                ? 'Theme: Light - Click for Dark'
                : 'Theme: Dark - Click for Auto'
            }
            className="flex items-center justify-center w-8 h-8 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/40 text-slate-200 hover:text-indigo-200 transition-all select-none cursor-pointer"
            aria-label="Cycle theme mode"
          >
            {themeMode === 'auto' && <Monitor className="w-3.5 h-3.5 text-indigo-400" />}
            {themeMode === 'light' && <Sun className="w-3.5 h-3.5 text-amber-500" />}
            {themeMode === 'dark' && <Moon className="w-3.5 h-3.5 text-indigo-400" />}
          </button>
        )}

        {/* New Dub Button */}
        {activeJob && onResetSession && (
          <button
            onClick={onResetSession}
            title="Start new dubbing project"
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/40 text-slate-400 hover:text-indigo-200 transition-all text-xs font-medium cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span className="hidden lg:inline">New Dub</span>
          </button>
        )}
      </div>
    </header>
  );
};
