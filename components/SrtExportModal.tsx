import React, { useState, useMemo, useEffect, useRef } from 'react';
import { X, Download, Copy, Check, Captions, Play, Pause } from 'lucide-react';
import { AudioSegment } from '../types';
import {
  SrtOptions,
  DEFAULT_SRT_OPTIONS,
  SRT_PRESETS,
  generateSrtContent,
  generateVttContent,
  downloadFile,
  SubtitleCasing,
  SubtitleExportChoice,
  SubtitleTiming,
  SubtitleTrack,
  DEFAULT_SUBTITLE_EXPORT_CHOICE,
  resolveSubtitleTiming,
  buildSubtitleSegments,
  subtitleFileLabel,
} from '../services/srtService';
import { useDubWordTimings } from '../services/dubSubtitleTiming';

/** Short names for the presets, which carry long ones for elsewhere. */
const PRESET_LABELS: Record<string, string> = {
  shorts_viral: 'Short-form',
  shorts_uppercase: 'Short-form, CAPS',
  dynamic_5words: 'One line',
  youtube_standard: 'YouTube',
  broadcast_netflix: 'Broadcast',
};

const footerGhost =
  'h-[38px] px-3 flex items-center gap-1.5 rounded-[10px] border border-slate-800 bg-slate-950/60 hover:bg-slate-800 text-[12.5px] font-medium text-slate-200 disabled:opacity-40 cursor-pointer';

/** "00:00:56,400" -> 56.4 */
const parseStamp = (stamp: string) => {
  const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(stamp);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : 0;
};

/** 56.4 -> "00:00:56,400" */
const srtStamp = (seconds: number) => {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
};

/** Splits generated .srt text back into cues for the preview list. */
const parseSrt = (srt: string) =>
  srt
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.trim().split(/\r?\n/))
    .filter((lines) => lines.length >= 3 && lines[1].includes('-->'))
    .map((lines) => {
      const [a, b] = lines[1].split('-->');
      return { index: Number(lines[0]) || 0, start: parseStamp(a), end: parseStamp(b), lines: lines.slice(2) };
    });

interface SrtExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  segments: AudioSegment[];
  targetLanguage: string;
  /** Source language ElevenLabs transcribed, used to label the original track. */
  sourceLanguage?: string;
  initialOptions?: SrtOptions;
  onOptionsChange?: (options: SrtOptions) => void;
  synthAudioDuration?: number;
  hasSynthAudio?: boolean;
  /** The cues where Sync placed them, once the dub is synced: timing that matches the synced dub exactly. */
  syncedSegments?: AudioSegment[];
  /** The saved language and timing, shared with the one-click subtitle card. */
  exportChoice?: SubtitleExportChoice;
  onExportChoiceChange?: (choice: SubtitleExportChoice) => void;
  /** What each timing is heard against: the original, the synced dub, the dub. Missing ones can't be played. */
  audio?: { original?: Blob | null; synced?: string | null; dubbed?: string | null };
  /** True when the script changed since the last Sync: the synced timing is out of date until Sync runs again. */
  syncStale?: boolean;
}

export const SrtExportModal: React.FC<SrtExportModalProps> = ({
  isOpen,
  onClose,
  segments,
  targetLanguage,
  sourceLanguage = '',
  initialOptions,
  onOptionsChange,
  synthAudioDuration = 0,
  hasSynthAudio = false,
  syncedSegments,
  exportChoice = DEFAULT_SUBTITLE_EXPORT_CHOICE,
  onExportChoiceChange,
  audio,
  syncStale = false,
}) => {
  const [options, setOptions] = useState<SrtOptions>(() => {
    try {
      const saved = localStorage.getItem('dhvani_srt_options');
      if (saved) return JSON.parse(saved);
    } catch {}
    return initialOptions || DEFAULT_SRT_OPTIONS;
  });

  const [activePresetId, setActivePresetId] = useState<string>('shorts_viral');
  const [copied, setCopied] = useState<boolean>(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'srt' | 'vtt'>('srt');
  /*
   * Which language track to export and what it is timed to. Both are saved, so
   * the subtitle card downloads exactly what this modal last showed. A saved
   * timing this project lacks falls back to the most exact one it has.
   */
  const hasSynced = Boolean(syncedSegments && syncedSegments.length > 0);
  const scriptTrack = exportChoice.track;
  const syncMode = resolveSubtitleTiming(exportChoice.timing, hasSynced, hasSynthAudio);
  const setScriptTrack = (track: SubtitleTrack) => onExportChoiceChange?.({ track, timing: exportChoice.timing });
  const setSyncMode = (timing: SubtitleTiming) => onExportChoiceChange?.({ track: scriptTrack, timing });

  /*
   * The player: the subtitles are heard against what they are timed to, so
   * the frame shows each one as it is said. Its own audio, paused on close.
   */
  const audioRef = useRef<HTMLAudioElement>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen || !audio?.original) return setOriginalUrl(null);
    const url = URL.createObjectURL(audio.original);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [isOpen, audio?.original]);
  const playUrl = (syncMode === 'synced' ? audio?.synced : syncMode === 'dubbed' ? audio?.dubbed : originalUrl) || null;
  const listRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [playDuration, setPlayDuration] = useState(0);
  useEffect(() => {
    setPlaying(false);
    setPlayTime(0);
  }, [playUrl]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let heard: Element | null = null;
    const tick = () => {
      const time = audioRef.current?.currentTime ?? 0;
      setPlayTime(time);
      // Keeps the subtitle being said in view in the list.
      const row = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-start]') ?? [])].find(
        (el) => time >= Number(el.dataset.start) && time < Number(el.dataset.end)
      );
      // Scrolls whichever holds the list (the list itself, or the dialog on a
      // wide screen) and leaves the frame where it is, over the list.
      const list = listRef.current;
      if (list && row && row !== heard) {
        const scroller = list.scrollHeight > list.clientHeight + 1 ? list : list.closest<HTMLElement>('[data-scroller]');
        const frameBox = scroller === list ? null : frameRef.current;
        if (scroller) {
          const box = scroller.getBoundingClientRect();
          const top = frameBox && getComputedStyle(frameBox).position === 'sticky' ? frameBox.getBoundingClientRect().bottom : box.top;
          const at = row.getBoundingClientRect();
          if (at.top < top || at.bottom > box.bottom) scroller.scrollTop += at.top - (top + (box.bottom - top - at.height) / 2);
        }
      }
      heard = row ?? heard;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  // Closing the modal, or changing what it plays, stops the old audio.
  useEffect(() => {
    const el = audioRef.current;
    return () => el?.pause();
  }, [playUrl, isOpen]);
  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(console.warn);
    else el.pause();
  };
  const seekTo = (seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    setPlayTime(el.currentTime);
  };

  // Sync state if initialOptions changes
  useEffect(() => {
    if (initialOptions) {
      setOptions(initialOptions);
    }
  }, [initialOptions]);

  // Save to localStorage & notify parent
  const handleUpdateOptions = (newOptions: SrtOptions, presetId: string = 'custom') => {
    setOptions(newOptions);
    setActivePresetId(presetId);
    try {
      localStorage.setItem('dhvani_srt_options', JSON.stringify(newOptions));
    } catch {}
    if (onOptionsChange) {
      onOptionsChange(newOptions);
    }
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = SRT_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      handleUpdateOptions({ ...preset.options }, preset.id);
    }
  };

  const handleResetDefaults = () => {
    handleUpdateOptions({ ...DEFAULT_SRT_OPTIONS }, 'shorts_viral');
  };

  /* Dub timings cut on the dub's own words, once ElevenLabs has placed them in the dub. */
  const dubAudioUrl = syncMode === 'synced' ? audio?.synced : syncMode === 'dubbed' ? audio?.dubbed : null;
  const { timings: dubWordTimings, loading: aligningDub } = useDubWordTimings(
    dubAudioUrl,
    syncMode === 'synced' ? syncedSegments ?? [] : segments,
    isOpen && syncMode !== 'original'
  );

  const processedSegments = useMemo(
    () =>
      buildSubtitleSegments({
        segments,
        syncedSegments,
        timing: syncMode,
        track: scriptTrack,
        synthAudioDuration: hasSynthAudio ? synthAudioDuration : 0,
        options,
        dubWordTimings,
      }),
    [segments, syncedSegments, syncMode, scriptTrack, hasSynthAudio, synthAudioDuration, options, dubWordTimings]
  );

  /** True when every exported cue boundary is a measured ElevenLabs word. */
  const hasExactTimings = useMemo(
    () =>
      processedSegments.length > 0 &&
      processedSegments.every((segment) => {
        const tokens = (segment.textTarget || segment.targetText || '').split(/\s+/).filter(Boolean).length;
        return tokens === 0 || tokens === (segment.words?.length ?? 0);
      }),
    [processedSegments]
  );

  // Generate real-time preview content
  const previewSrt = useMemo(() => {
    if (!processedSegments || processedSegments.length === 0) return '';
    return generateSrtContent(processedSegments, options);
  }, [processedSegments, options]);

  const previewVtt = useMemo(() => {
    if (!processedSegments || processedSegments.length === 0) return '';
    return generateVttContent(processedSegments, options);
  }, [processedSegments, options]);


  const activePreviewText = activeTab === 'srt' ? previewSrt : previewVtt;

  // Compute live statistics
  const previewStats = useMemo(() => {
    if (!previewSrt) return { cueCount: 0, totalWords: 0, avgWordsPerCue: 0 };
    const cues = previewSrt.split(/\n\n+/).filter(Boolean);
    const cueCount = cues.length;
    let totalWords = 0;
    cues.forEach((cue) => {
      const lines = cue.split('\n').slice(2); // Skip index & timestamps
      const words = lines.join(' ').split(/\s+/).filter(Boolean);
      totalWords += words.length;
    });
    const avgWordsPerCue = cueCount > 0 ? (totalWords / cueCount).toFixed(1) : '0';
    return { cueCount, totalWords, avgWordsPerCue };
  }, [previewSrt]);

  const handleCopy = () => {
    if (!activePreviewText) return;
    try {
      navigator.clipboard.writeText(activePreviewText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Copy failed', e);
    }
  };

  /** Names the file after the track actually being exported. */
  const exportLabel = subtitleFileLabel(scriptTrack === 'source' ? sourceLanguage || 'original' : targetLanguage, syncMode);

  const handleDownloadSrt = () => {
    if (!previewSrt) return;
    downloadFile(previewSrt, `dhvani_${exportLabel}_subtitles.srt`, 'text/srt;charset=utf-8');
    onClose();
  };

  const handleDownloadVtt = () => {
    if (!previewVtt) return;
    downloadFile(previewVtt, `dhvani_${exportLabel}_subtitles.vtt`, 'text/vtt;charset=utf-8');
    onClose();
  };

  if (!isOpen) return null;

  const playLabel = syncMode === 'synced' ? 'synced dub' : syncMode === 'dubbed' ? 'dub' : 'original';

  const setOpt = (patch: Partial<SrtOptions>) => handleUpdateOptions({ ...options, ...patch });
  const cues = parseSrt(previewSrt);
  // While playing, the frame shows what is said now, and nothing between subtitles.
  const heardIndex = playing || playTime > 0 ? cues.findIndex((c) => playTime >= c.start && playTime < c.end) : -1;
  const following = playing || playTime > 0;
  const shown = following ? cues[heardIndex] : cues[Math.min(previewIndex, Math.max(0, cues.length - 1))];
  const activeRow = following ? heardIndex : previewIndex;

  const longest = cues.reduce((m, c) => Math.max(m, c.end - c.start), 0);
  const widest = cues.reduce((m, c) => Math.max(m, ...c.lines.map((l) => l.length)), 0);
  const trackName = scriptTrack === 'source' ? sourceLanguage || 'Original' : targetLanguage;

  const seg = (on: boolean) =>
    `flex-1 px-2.5 py-1.5 rounded-[7px] text-[12.5px] font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
      on ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
    }`;
  const segWrap = 'flex p-[3px] gap-0.5 rounded-[10px] bg-slate-950/60 border border-slate-700';
  const sw = (on: boolean) => (
    <span className={`relative w-[34px] h-5 rounded-full shrink-0 transition-colors ${on ? 'bg-indigo-500' : 'bg-slate-700'}`}>
      <span className={`absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white transition-all ${on ? 'left-[17px]' : 'left-[3px]'}`} />
    </span>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center sm:p-6 bg-slate-950/80 backdrop-blur-sm overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="srt-title"
        className="w-full max-w-[62.5rem] min-h-full sm:min-h-0 sm:my-auto sm:max-h-[calc(100vh-3rem)] flex flex-col sm:rounded-[18px] bg-slate-900 border border-slate-700/80 shadow-2xl text-slate-100 overflow-hidden"
      >
        <div className="flex items-center gap-3.5 px-5 sm:px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="w-[38px] h-[38px] rounded-[10px] bg-slate-100 text-slate-950 flex items-center justify-center shrink-0" aria-hidden="true">
            <Captions className="w-[18px] h-[18px]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="srt-title" className="text-lg font-semibold text-slate-100 leading-tight">
              Export subtitles
            </h2>
            <p className="text-[12.5px] text-slate-400 mt-0.5">
              How the {trackName} breaks into subtitles. Cuts land between measured words.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div data-scroller className="flex-1 min-h-0 overflow-y-auto grid md:grid-cols-[21.25rem_minmax(0,1fr)]">
          {/* Controls */}
          <div className="px-5 py-4 border-b md:border-b-0 md:border-r border-slate-800 flex flex-col gap-4 min-w-0">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-400">Start from</span>
              <div className="flex flex-wrap gap-1.5">
                {SRT_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleApplyPreset(p.id)}
                    title={p.description}
                    className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors cursor-pointer ${
                      activePresetId === p.id
                        ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-300'
                        : 'border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    {PRESET_LABELS[p.id] || p.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-400">Language</span>
              <div className={segWrap} role="group" aria-label="Language">
                <button type="button" aria-pressed={scriptTrack === 'target'} onClick={() => setScriptTrack('target')} className={seg(scriptTrack === 'target')}>
                  {targetLanguage}
                </button>
                <button type="button" aria-pressed={scriptTrack === 'source'} onClick={() => setScriptTrack('source')} className={seg(scriptTrack === 'source')}>
                  {sourceLanguage || 'Original'}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-slate-400">Lines per subtitle</span>
                <div className={segWrap} role="group" aria-label="Lines per subtitle">
                  {[1, 2, 3].map((n) => (
                    <button key={n} type="button" aria-pressed={options.maxLinesPerCue === n} onClick={() => setOpt({ maxLinesPerCue: n })} className={seg(options.maxLinesPerCue === n)}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-slate-400">Words per line</span>
                <div className="flex items-center h-[38px] rounded-[10px] border border-slate-700 bg-slate-950/60 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpt({ maxWordsPerLine: Math.max(1, options.maxWordsPerLine - 1) })}
                    className="w-9 h-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
                    aria-label="Fewer words per line"
                  >
                    −
                  </button>
                  <span className="flex-1 text-center font-mono text-[13px] tabular-nums">{options.maxWordsPerLine}</span>
                  <button
                    type="button"
                    onClick={() => setOpt({ maxWordsPerLine: Math.min(15, options.maxWordsPerLine + 1) })}
                    className="w-9 h-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
                    aria-label="More words per line"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {[
              {
                id: 'srt-chars',
                label: 'Characters per line',
                hint: 'A hard limit. Longer lines move to the next subtitle.',
                value: options.maxCharsPerLine,
                min: 15,
                max: 50,
                step: 1,
                show: String(options.maxCharsPerLine),
                ends: ['15', '50'],
                set: (v: number) => setOpt({ maxCharsPerLine: v }),
              },
              {
                id: 'srt-duration',
                label: 'Longest time on screen',
                hint: 'A subtitle that would stay longer is split.',
                value: options.maxDurationSeconds,
                min: 1,
                max: 7,
                step: 0.1,
                show: `${options.maxDurationSeconds.toFixed(1)} s`,
                ends: ['1 s', '7 s'],
                set: (v: number) => setOpt({ maxDurationSeconds: v }),
              },
            ].map((s) => (
              <div key={s.id}>
                <div className="flex items-baseline justify-between">
                  <label htmlFor={s.id} className="text-[13px] font-semibold text-slate-100">
                    {s.label}
                  </label>
                  <span className="font-mono text-xs tabular-nums">{s.show}</span>
                </div>
                <p className="text-[11.5px] text-slate-400 mt-0.5 mb-2">{s.hint}</p>
                <input
                  id={s.id}
                  type="range"
                  min={s.min}
                  max={s.max}
                  step={s.step}
                  value={s.value}
                  onChange={(e) => s.set(Number(e.target.value))}
                  className="w-full accent-indigo-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10.5px] text-slate-500 mt-0.5">
                  <span>{s.ends[0]}</span>
                  <span>{s.ends[1]}</span>
                </div>
              </div>
            ))}

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-400">Timed to</span>
              <div className={segWrap} role="group" aria-label="Timed to">
                <button type="button" aria-pressed={syncMode === 'original'} onClick={() => setSyncMode('original')} className={seg(syncMode === 'original')}>
                  Original speech
                </button>
                <button
                  type="button"
                  aria-pressed={syncMode === 'synced'}
                  onClick={() => setSyncMode('synced')}
                  disabled={!hasSynced}
                  title={hasSynced ? 'Where Sync placed each line: matches the synced dub exactly' : 'Available once the dub is synced'}
                  className={seg(syncMode === 'synced')}
                >
                  Synced dub
                </button>
                <button
                  type="button"
                  aria-pressed={syncMode === 'dubbed'}
                  onClick={() => setSyncMode('dubbed')}
                  disabled={!hasSynthAudio}
                  title={hasSynthAudio ? undefined : 'Available once there is a dub'}
                  className={seg(syncMode === 'dubbed')}
                >
                  The dub
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-slate-400">Letters</span>
              <div className={segWrap} role="group" aria-label="Letters">
                {([
                  ['original', 'As written'],
                  ['capitalize', 'Capitalised'],
                  ['uppercase', 'UPPERCASE'],
                ] as [SubtitleCasing, string][]).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={(options.casing || 'original') === value} onClick={() => setOpt({ casing: value })} className={seg((options.casing || 'original') === value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {[
              {
                label: 'Keep punctuation',
                hint: '। , ? and ! stay in the subtitle',
                on: options.includePunctuation,
                toggle: () => setOpt({ includePunctuation: !options.includePunctuation }),
              },
              {
                label: 'Hide speaker names',
                hint: 'Drops “HOST:” and similar labels',
                on: Boolean(options.removeSpeakerLabel),
                toggle: () => setOpt({ removeSpeakerLabel: !options.removeSpeakerLabel }),
              },
            ].map((t) => (
              <button key={t.label} type="button" role="switch" aria-checked={t.on} onClick={t.toggle} className="flex items-center gap-3 text-left cursor-pointer">
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-slate-100">{t.label}</span>
                  <span className="block text-[11.5px] text-slate-400">{t.hint}</span>
                </span>
                {sw(t.on)}
              </button>
            ))}
          </div>

          {/* Preview */}
          <div className="px-5 py-4 flex flex-col gap-3 min-w-0 bg-slate-950/40">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Preview</span>
              <span className="text-[11.5px] text-slate-400">{playUrl ? 'Click a subtitle to play from it' : 'Click a subtitle to see it on the frame'}</span>
            </div>

            {/* The frame and its player stay in view while the subtitles below scroll. */}
            <div ref={frameRef} className="md:sticky md:-top-4 z-10 -mx-5 -mt-4 px-5 pt-4 pb-1 flex flex-col gap-3 bg-[#0f1524]">
              <div className="relative aspect-video max-w-full rounded-xl overflow-hidden bg-[radial-gradient(120%_90%_at_30%_20%,#3a4660_0%,#1c2333_45%,#0d1119_100%)]" aria-hidden="true">
                <span className="absolute top-2.5 left-3 font-mono text-[11px] text-white/75">{following ? srtStamp(playTime) : shown ? srtStamp(shown.start) : '00:00:00,000'}</span>
                <span className="absolute left-1/2 bottom-0 -translate-x-1/2 w-[34%] h-[78%] rounded-t-[50%] bg-gradient-to-b from-[#5b4a3c] to-[#2b2622]" />
                <span className="absolute left-1/2 top-[8%] -translate-x-1/2 w-[15%] aspect-square rounded-full bg-[#7a5f4a]" />
                {shown && (
                  <span className="absolute left-1/2 bottom-[9%] -translate-x-1/2 max-w-[86%] text-center text-[clamp(15px,2.2vw,22px)] leading-snug text-white bg-black/55 px-3 py-1 rounded-md">
                    {shown.lines.map((l, i) => (
                      <span key={i} className="block">
                        {l}
                      </span>
                    ))}
                  </span>
                )}
              </div>

              {playUrl ? (
                <div className="flex items-center gap-2.5">
                  <audio
                    key={playUrl}
                    ref={audioRef}
                    src={playUrl}
                    preload="metadata"
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                    onLoadedMetadata={(e) => setPlayDuration(e.currentTarget.duration || 0)}
                    onTimeUpdate={(e) => !playing && setPlayTime(e.currentTarget.currentTime)}
                  />
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={playing ? 'Pause' : `Play the ${playLabel}`}
                    title={playing ? 'Pause' : `Play the ${playLabel} with these subtitles`}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-100 text-slate-950 hover:bg-white shrink-0 cursor-pointer"
                  >
                    {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={playDuration || 0}
                    step={0.01}
                    value={Math.min(playTime, playDuration || 0)}
                    onChange={(e) => seekTo(Number(e.target.value))}
                    aria-label={`Position in the ${playLabel}`}
                    className="flex-1 min-w-0 accent-indigo-500 cursor-pointer"
                  />
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums shrink-0">
                    {srtStamp(playTime).slice(3, 8)} / {srtStamp(playDuration).slice(3, 8)}
                  </span>
                </div>
              ) : (
                <p className="text-[11.5px] text-slate-500">Nothing to play for this timing yet.</p>
              )}
              {syncMode === 'synced' && syncStale && (
                <p className="text-[11.5px] text-amber-300">The script changed since the last Sync. Sync again for subtitles that match it.</p>
              )}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span>
                <span className="font-semibold text-slate-100 tabular-nums">{cues.length}</span> subtitles from{' '}
                <span className="font-semibold text-slate-100 tabular-nums">{segments.length}</span> cues
              </span>
              <span>
                longest <span className="font-semibold text-slate-100 tabular-nums">{longest.toFixed(1)} s</span>
              </span>
              <span>
                widest line <span className="font-semibold text-slate-100 tabular-nums">{widest}</span> characters
              </span>
              {hasExactTimings && <span className="text-emerald-300">Every cut on a measured word</span>}
              {aligningDub && <span className="text-slate-300">Timing to the dub's own words…</span>}
            </div>

            <div ref={listRef} className="relative flex-1 min-h-[12rem] max-h-[18rem] md:max-h-none overflow-y-auto custom-scrollbar rounded-xl border border-slate-800 bg-slate-900">
              {cues.length === 0 ? (
                <p className="p-6 text-center text-xs text-slate-500">No cues to show yet.</p>
              ) : (
                cues.map((c, i) => (
                  <button
                    key={c.index}
                    type="button"
                    data-start={c.start}
                    data-end={c.end}
                    onClick={() => {
                      setPreviewIndex(i);
                      if (playUrl) seekTo(c.start);
                    }}
                    className={`w-full text-left grid grid-cols-[2.25rem_minmax(0,1fr)] sm:grid-cols-[2.25rem_11.5rem_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 px-3 py-2 border-t border-slate-800 first:border-t-0 items-baseline cursor-pointer ${
                      i === activeRow ? 'bg-indigo-500/15' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">{c.index}</span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {srtStamp(c.start)} → {srtStamp(c.end)}
                    </span>
                    <span className="col-span-2 sm:col-span-1 text-[14px] text-slate-100 leading-snug">
                      {c.lines.map((l, j) => (
                        <span key={j} className="block">
                          {l}
                        </span>
                      ))}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 px-5 sm:px-6 py-3.5 border-t border-slate-800 shrink-0">
          <button type="button" onClick={handleResetDefaults} className="text-[12.5px] text-slate-400 hover:text-slate-200 px-1 cursor-pointer">
            Reset to defaults
          </button>
          <span className="flex-1" />
          <span className="text-[11.5px] text-slate-500">Saved for every project</span>
          <button type="button" onClick={handleCopy} disabled={!previewSrt} className={footerGhost}>
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={handleDownloadVtt} disabled={!previewVtt} className={footerGhost}>
            <Download className="w-3.5 h-3.5" /> .vtt
          </button>
          <button
            type="button"
            onClick={handleDownloadSrt}
            disabled={!previewSrt}
            className="h-[38px] px-4 flex items-center gap-2 rounded-[10px] bg-indigo-600 hover:bg-indigo-500 text-white text-[13px] font-semibold disabled:bg-slate-800 disabled:text-slate-500 cursor-pointer"
          >
            <Download className="w-4 h-4" /> Download .srt
          </button>
        </div>
      </section>
    </div>
  );
};
