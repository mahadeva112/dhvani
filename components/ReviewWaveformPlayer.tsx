import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Repeat,
  ZoomIn,
  ZoomOut,
  Crosshair,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AudioSegment } from '../types';
import { useLiveTime } from './useLiveTime';

export interface ReviewWaveformPlayerProps {
  audioBuffer: AudioBuffer | null;
  segments: AudioSegment[];
  currentTime: number;
  /**
   * The playing track's exact position. While playing, the player reads it
   * every frame instead of waiting for `currentTime`, which the audio element
   * only reports about four times a second.
   */
  getLiveTime?: () => number | null;
  duration: number;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onSeek: (time: number) => void;
  onSelectSegment?: (segment: AudioSegment) => void;
  activeSegmentId?: string | number | null;
  targetLanguage?: string;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  trackMode?: 'source' | 'synth' | 'both';
  onTrackModeChange?: (mode: 'source' | 'synth' | 'both') => void;
  hasSynthesizedAudio?: boolean;
  /** Pause detection now lives in the review panel; kept so callers need not change. */
  sensitivity?: number;
  onSensitivityChange?: (sensitivity: number) => void;
}

const RATES = [0.75, 1, 1.25, 1.5];
const ZOOMS = [1, 2, 4, 8, 16, 32];
const COMPACT_KEY = 'dhvani_player_compact';

/** Canvas colours for each theme; the app's light theme is a class on <html>. */
const PALETTES = {
  dark: {
    wave: '#334155',
    played: '#22d3ee',
    cue: 'rgba(34,211,238,0.10)',
    cueEdge: 'rgba(34,211,238,0.45)',
    fast: 'rgba(251,113,133,0.16)',
    fastEdge: 'rgba(251,113,133,0.7)',
    current: 'rgba(129,140,248,0.18)',
    currentEdge: '#818cf8',
    hatch: '#1e293b',
    label: '#94a3b8',
    playhead: '#f1f5f9',
    view: '#818cf8',
  },
  light: {
    wave: '#cbd5e1',
    played: '#0891b2',
    cue: 'rgba(8,145,178,0.08)',
    cueEdge: 'rgba(8,145,178,0.45)',
    fast: 'rgba(225,29,72,0.10)',
    fastEdge: 'rgba(225,29,72,0.6)',
    current: 'rgba(79,70,229,0.12)',
    currentEdge: '#4f46e5',
    hatch: '#e2e8f0',
    label: '#64748b',
    playhead: '#0f172a',
    view: '#4f46e5',
  },
};

const targetOf = (seg: AudioSegment) => seg.textTarget || seg.targetText || '';
const sourceOf = (seg: AudioSegment) => seg.textSource || seg.originalText || '';
const cpsOf = (seg: AudioSegment) => {
  const d = seg.endTime - seg.startTime;
  return d > 0 ? targetOf(seg).length / d : 0;
};

/** 57.1 -> "00:57.1", 3725 -> "1:02:05.0" */
const formatTime = (seconds: number, tenths = true) => {
  const t = Math.max(0, seconds || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const sec = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
};

const useIsLightTheme = () => {
  const [light, setLight] = useState(() => document.documentElement.classList.contains('light'));
  useEffect(() => {
    const observer = new MutationObserver(() => setLight(document.documentElement.classList.contains('light')));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return light;
};

/** Sizes a canvas to its box at device resolution and hands back a drawing context. */
const prepareCanvas = (canvas: HTMLCanvasElement | null) => {
  if (!canvas) return null;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return null;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
};

export const ReviewWaveformPlayer: React.FC<ReviewWaveformPlayerProps> = ({
  audioBuffer,
  segments,
  currentTime: reportedTime,
  getLiveTime,
  duration,
  isPlaying,
  onTogglePlay,
  onSeek,
  onSelectSegment,
  activeSegmentId,
  targetLanguage = 'Hindi',
  playbackRate = 1,
  onPlaybackRateChange,
  trackMode = 'source',
  onTrackModeChange,
  hasSynthesizedAudio = false,
}) => {
  const currentTime = useLiveTime(reportedTime, isPlaying, getLiveTime);

  const total = duration || audioBuffer?.duration || segments[segments.length - 1]?.endTime || 0;
  const light = useIsLightTheme();
  const palette = light ? PALETTES.light : PALETTES.dark;

  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStart] = useState(0);
  const [follow, setFollow] = useState(true);
  const [loop, setLoop] = useState(false);
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem(COMPACT_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [showMini, setShowMini] = useState(false);

  const sectionRef = useRef<HTMLElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const compactRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<'wave' | 'overview' | null>(null);
  const [redrawTick, setRedrawTick] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(COMPACT_KEY, String(compact));
    } catch {}
  }, [compact]);

  const span = total > 0 ? total / zoom : 1;
  const clampStart = useCallback((start: number, s = span) => Math.max(0, Math.min(Math.max(0, total - s), start)), [total, span]);

  /*
   * Peaks for the whole file, computed once per buffer. About forty per
   * second, capped, is fine enough for the deepest zoom and cheap to redraw.
   */
  const peaks = useMemo(() => {
    if (!audioBuffer) return null;
    try {
      const data = audioBuffer.getChannelData(0);
      const buckets = Math.max(200, Math.min(60000, Math.ceil(audioBuffer.duration * 40)));
      const size = Math.max(1, Math.floor(data.length / buckets));
      const out = new Float32Array(buckets);
      let max = 0.0001;
      for (let b = 0; b < buckets; b++) {
        let peak = 0;
        const start = b * size;
        const end = Math.min(start + size, data.length);
        for (let i = start; i < end; i += 8) {
          const v = Math.abs(data[i]);
          if (v > peak) peak = v;
        }
        out[b] = peak;
        if (peak > max) max = peak;
      }
      for (let b = 0; b < buckets; b++) out[b] = out[b] / max;
      return out;
    } catch (e) {
      console.warn('Could not read the waveform:', e);
      return null;
    }
  }, [audioBuffer]);

  const activeIndex = useMemo(() => {
    const byId = activeSegmentId != null ? segments.findIndex((s) => s.id === activeSegmentId) : -1;
    if (byId >= 0) return byId;
    // Between cues, the next one is the one about to be heard.
    const next = segments.findIndex((s) => s.endTime >= currentTime);
    return next >= 0 ? next : segments.length - 1;
  }, [segments, activeSegmentId, currentTime]);
  const activeCue = activeIndex >= 0 ? segments[activeIndex] : null;
  const insideCue = Boolean(activeCue && currentTime >= activeCue.startTime && currentTime <= activeCue.endTime);

  // ---------- navigation ----------
  const seekTo = useCallback(
    (time: number, select = true) => {
      const t = Math.max(0, Math.min(total, time));
      onSeek(t);
      if (select && onSelectSegment) {
        const seg = segments.find((s) => t >= s.startTime && t <= s.endTime);
        if (seg) onSelectSegment(seg);
      }
    },
    [total, onSeek, onSelectSegment, segments]
  );

  const goToCue = useCallback(
    (index: number) => {
      const seg = segments[Math.max(0, Math.min(segments.length - 1, index))];
      if (!seg) return;
      onSeek(seg.startTime);
      onSelectSegment?.(seg);
      // Bring the cue into the zoomed view.
      setViewStart((vs) => (seg.startTime < vs || seg.endTime > vs + span ? clampStart(seg.startTime - span * 0.25) : vs));
    },
    [segments, onSeek, onSelectSegment, span, clampStart]
  );

  const prevCue = useCallback(() => {
    if (!segments.length) return;
    // A second into a cue, "previous" restarts it, as a media player's back button does.
    if (activeCue && insideCue && currentTime - activeCue.startTime > 1) return goToCue(activeIndex);
    let prev = -1;
    segments.forEach((s, i) => {
      if (s.startTime < currentTime - 0.05) prev = i;
    });
    goToCue(Math.max(0, insideCue ? activeIndex - 1 : prev));
  }, [segments, activeCue, insideCue, currentTime, activeIndex, goToCue]);

  const nextCue = useCallback(() => {
    const next = segments.findIndex((s) => s.startTime > currentTime + 0.05);
    if (next >= 0) goToCue(next);
  }, [segments, currentTime, goToCue]);

  const changeZoom = useCallback(
    (dir: 1 | -1, anchor?: number) => {
      setZoom((z) => {
        const i = ZOOMS.indexOf(z);
        const nz = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 0 : i) + dir))];
        const ns = total / nz;
        const focus = anchor ?? currentTime;
        setViewStart(Math.max(0, Math.min(Math.max(0, total - ns), focus - ns * 0.35)));
        return nz;
      });
    },
    [total, currentTime]
  );

  // Loop the current cue.
  useEffect(() => {
    if (!loop || !activeCue || !isPlaying) return;
    if (currentTime >= activeCue.endTime) onSeek(activeCue.startTime);
  }, [loop, activeCue, currentTime, isPlaying, onSeek]);

  // Follow playback: keep the playhead in the view while zoomed in.
  useEffect(() => {
    if (!follow || zoom === 1) return;
    if (currentTime < viewStart + span * 0.05 || currentTime > viewStart + span * 0.85) {
      setViewStart(clampStart(currentTime - span * 0.25));
    }
  }, [follow, zoom, currentTime, viewStart, span, clampStart]);

  // Keyboard: arrows move 5 s, comma and full stop step cues, L loops. Space is the app's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.key === 'ArrowLeft') seekTo(currentTime - 5, false);
      else if (e.key === 'ArrowRight') seekTo(currentTime + 5, false);
      else if (e.key === ',') prevCue();
      else if (e.key === '.') nextCue();
      else if (e.key === 'l' || e.key === 'L') setLoop((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentTime, seekTo, prevCue, nextCue]);

  // Mini player: shown once the player has scrolled up out of sight.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const above = !entry.isIntersecting && entry.boundingClientRect.bottom < 0;
        setShowMini(above);
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Redraw when any canvas changes size.
  useEffect(() => {
    const observer = new ResizeObserver(() => setRedrawTick((t) => t + 1));
    [waveRef, overviewRef, compactRef, miniRef].forEach((r) => r.current && observer.observe(r.current));
    return () => observer.disconnect();
  }, [compact, showMini]);

  // ---------- drawing ----------
  const drawBars = (
    ctx: CanvasRenderingContext2D,
    w: number,
    top: number,
    height: number,
    from: number,
    to: number,
    step = 3
  ) => {
    const bars = Math.max(1, Math.floor(w / step));
    for (let i = 0; i < bars; i++) {
      const t0 = from + ((to - from) * i) / bars;
      const t1 = from + ((to - from) * (i + 1)) / bars;
      let a = 0.06;
      if (peaks && total > 0) {
        const b0 = Math.floor((t0 / total) * peaks.length);
        const b1 = Math.max(b0 + 1, Math.floor((t1 / total) * peaks.length));
        for (let b = b0; b < b1 && b < peaks.length; b++) if (peaks[b] > a) a = peaks[b];
      }
      const bh = Math.max(2, a * height);
      ctx.fillStyle = t1 <= currentTime ? palette.played : palette.wave;
      ctx.fillRect(i * step, top + (height - bh) / 2, Math.max(1, step - 1), bh);
    }
  };

  useEffect(() => {
    if (compact) return;
    const c = prepareCanvas(waveRef.current);
    if (!c) return;
    const { ctx, w, h } = c;
    const vs = zoom === 1 ? 0 : viewStart;
    const ve = vs + span;
    const x = (t: number) => ((t - vs) / span) * w;

    // Pauses: hatching behind everything; cues paint over it.
    ctx.strokeStyle = palette.hatch;
    ctx.lineWidth = 1;
    for (let p = -h; p < w; p += 6) {
      ctx.beginPath();
      ctx.moveTo(p, h);
      ctx.lineTo(p + h, 0);
      ctx.stroke();
    }
    segments.forEach((seg, i) => {
      if (seg.endTime < vs || seg.startTime > ve) return;
      const a = x(seg.startTime);
      const b = x(seg.endTime);
      const isCurrent = i === activeIndex;
      const fast = cpsOf(seg) > 18;
      ctx.fillStyle = isCurrent ? palette.current : fast ? palette.fast : palette.cue;
      ctx.fillRect(a, 0, b - a, h);
      ctx.fillStyle = isCurrent ? palette.currentEdge : fast ? palette.fastEdge : palette.cueEdge;
      ctx.fillRect(a, 0, 1.5, h);
      if (b - a > 20) {
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = isCurrent ? palette.currentEdge : palette.label;
        ctx.fillText(String(i + 1).padStart(2, '0'), a + 5, 14);
      }
    });
    drawBars(ctx, w, 24, h - 30, vs, ve);
    if (activeCue) {
      ctx.strokeStyle = palette.currentEdge;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x(activeCue.startTime), 0.75, x(activeCue.endTime) - x(activeCue.startTime), h - 1.5);
    }
    const ph = x(currentTime);
    if (ph >= 0 && ph <= w) {
      ctx.fillStyle = palette.playhead;
      ctx.fillRect(ph - 1, 0, 2, h);
      ctx.beginPath();
      ctx.arc(ph, 4, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, peaks, segments, currentTime, activeIndex, zoom, viewStart, span, palette, redrawTick]);

  // Whole-file overview (full view), and the compact and mini strips.
  useEffect(() => {
    const draw = (canvas: HTMLCanvasElement | null, marks: boolean) => {
      const c = prepareCanvas(canvas);
      if (!c || total <= 0) return;
      const { ctx, w, h } = c;
      if (marks) {
        ctx.fillStyle = palette.fastEdge;
        segments.forEach((seg) => {
          if (cpsOf(seg) > 18) ctx.fillRect((seg.startTime / total) * w, 0, Math.max(1.5, ((seg.endTime - seg.startTime) / total) * w), 3);
        });
      }
      drawBars(ctx, w, marks ? 4 : 2, h - (marks ? 6 : 4), 0, total, 2);
      ctx.fillStyle = palette.playhead;
      ctx.fillRect((currentTime / total) * w - 1, 0, 2, h);
    };
    if (!compact) draw(overviewRef.current, true);
    if (compact) draw(compactRef.current, true);
    if (showMini) draw(miniRef.current, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact, showMini, peaks, segments, currentTime, total, palette, redrawTick]);

  // ---------- pointer ----------
  const timeAt = (e: React.PointerEvent | React.MouseEvent, el: HTMLElement, whole: boolean) => {
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return whole ? f * total : (zoom === 1 ? 0 : viewStart) + f * span;
  };

  const onWavePointer = (e: React.PointerEvent<HTMLDivElement>, kind: 'down' | 'move' | 'up') => {
    const el = e.currentTarget;
    const t = timeAt(e, el, false);
    if (kind === 'down') {
      dragRef.current = 'wave';
      el.setPointerCapture(e.pointerId);
      seekTo(t);
    } else if (kind === 'move') {
      setHoverTime(t);
      if (dragRef.current === 'wave') seekTo(t, false);
    } else {
      dragRef.current = null;
    }
  };

  const onOverviewPointer = (e: React.PointerEvent<HTMLDivElement>, kind: 'down' | 'move' | 'up') => {
    const el = e.currentTarget;
    const t = timeAt(e, el, true);
    if (kind === 'down') {
      dragRef.current = 'overview';
      el.setPointerCapture(e.pointerId);
    }
    if (kind === 'up') {
      dragRef.current = null;
      return;
    }
    if (dragRef.current !== 'overview') return;
    if (zoom === 1) {
      seekTo(t);
      return;
    }
    // Zoomed in, the overview moves the view rather than the playhead.
    setFollow(false);
    setViewStart(clampStart(t - span / 2));
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      changeZoom(e.deltaY < 0 ? 1 : -1, timeAt(e, el, false));
    } else if (zoom > 1 && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
      e.preventDefault();
      setFollow(false);
      const delta = (e.shiftKey ? e.deltaY : e.deltaX) / 600;
      setViewStart((vs) => clampStart(vs + delta * span));
    }
  };

  // Ctrl+wheel must be cancellable, so it is bound without React's passive listener.
  const waveBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = waveBoxRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || (zoom > 1 && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)))) e.preventDefault();
    };
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, [zoom, compact]);

  // ---------- pieces ----------
  const vs = zoom === 1 ? 0 : viewStart;
  const rulerStep = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].find((s) => span / s <= 10) || 600;
  const ticks: number[] = [];
  for (let t = Math.ceil(vs / rulerStep) * rulerStep; t <= vs + span; t += rulerStep) ticks.push(t);

  const cps = activeCue ? cpsOf(activeCue) : 0;
  const paceClass = cps > 18 ? 'bg-rose-500/15 text-rose-300' : cps > 14 ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300';

  const iconBtn = (pressed = false) =>
    `w-[30px] h-[30px] flex items-center justify-center rounded-lg border transition-colors cursor-pointer ${
      pressed
        ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300'
        : 'border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800'
    }`;
  const segBtn = (on: boolean) =>
    `flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
      on ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
    } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400 cursor-pointer`;
  const roundBtn = 'w-[34px] h-[34px] rounded-full border border-slate-800 text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center shrink-0 cursor-pointer';

  const playButton = (size: string) => (
    <button
      type="button"
      onClick={onTogglePlay}
      className={`${size} rounded-full bg-slate-100 hover:bg-white text-slate-950 flex items-center justify-center shrink-0 cursor-pointer`}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
    >
      {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
    </button>
  );

  const loopButton = (
    <button
      type="button"
      onClick={() => setLoop((v) => !v)}
      aria-pressed={loop}
      title="Loop the current cue (L)"
      className={`h-8 px-3 flex items-center gap-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
        loop ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300' : 'border-slate-800 text-slate-400 hover:text-slate-200'
      }`}
    >
      <Repeat className="w-3.5 h-3.5" /> Loop cue
    </button>
  );

  return (
    <>
      <section ref={sectionRef} aria-label="Playback" className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden">
        {/* Top bar: the current cue, then how you listen */}
        <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-2.5 border-b border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0 flex-1 basis-full sm:basis-auto">
            <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 whitespace-nowrap">
              {activeCue ? `Cue ${String(activeIndex + 1).padStart(2, '0')} of ${segments.length}` : `${segments.length} cues`}
            </span>
            {activeCue && (
              <span className="font-mono text-xs text-slate-400 whitespace-nowrap tabular-nums">
                {formatTime(activeCue.startTime)} – {formatTime(activeCue.endTime)}
              </span>
            )}
            {activeCue?.speaker && (
              <span className="hidden sm:inline text-[11px] uppercase tracking-wide font-semibold text-slate-500 truncate">{activeCue.speaker}</span>
            )}
          </div>

          {onTrackModeChange && (
            <div role="group" aria-label="Listen to" className="flex p-0.5 gap-0.5 rounded-lg bg-slate-950/60 border border-slate-800">
              {([
                ['source', 'Original', 'bg-cyan-400'],
                ['synth', 'Dub', 'bg-indigo-400'],
                ['both', 'Both', ''],
              ] as const).map(([mode, label, dot]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={trackMode === mode}
                  disabled={mode !== 'source' && !hasSynthesizedAudio}
                  onClick={() => onTrackModeChange(mode)}
                  title={mode !== 'source' && !hasSynthesizedAudio ? 'Available once there is a dub' : undefined}
                  className={segBtn(trackMode === mode)}
                >
                  {dot && <span className={`w-[7px] h-[7px] rounded-sm ${dot}`} />}
                  {label}
                </button>
              ))}
            </div>
          )}

          {onPlaybackRateChange && (
            <div role="group" aria-label="Speed" className="flex p-0.5 gap-0.5 rounded-lg bg-slate-950/60 border border-slate-800">
              {RATES.map((r) => (
                <button key={r} type="button" aria-pressed={playbackRate === r} onClick={() => onPlaybackRateChange(r)} className={`${segBtn(playbackRate === r)} font-mono`}>
                  {r}×
                </button>
              ))}
            </div>
          )}

          {!compact && (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => changeZoom(-1)} disabled={zoom === 1} className={`${iconBtn()} disabled:opacity-40`} aria-label="Zoom out">
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="w-9 text-center font-mono text-[11.5px] text-slate-400 tabular-nums">{zoom}×</span>
              <button type="button" onClick={() => changeZoom(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} className={`${iconBtn()} disabled:opacity-40`} aria-label="Zoom in">
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setFollow((v) => !v);
                  if (!follow) setViewStart(clampStart(currentTime - span * 0.25));
                }}
                aria-pressed={follow}
                className={iconBtn(follow)}
                aria-label="Follow playback"
                title="Keep the playhead in view while zoomed in"
              >
                <Crosshair className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setCompact((v) => !v)}
            className={iconBtn()}
            aria-label={compact ? 'Full view' : 'Compact view'}
            title={compact ? 'Full view' : 'Compact view'}
          >
            {compact ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>

        {compact ? (
          <div className="flex flex-wrap items-center gap-3 px-3.5 py-2.5">
            <button type="button" onClick={prevCue} className={roundBtn} aria-label="Previous cue">
              <SkipBack className="w-3.5 h-3.5 fill-current" />
            </button>
            {playButton('w-[38px] h-[38px]')}
            <button type="button" onClick={nextCue} className={roundBtn} aria-label="Next cue">
              <SkipForward className="w-3.5 h-3.5 fill-current" />
            </button>
            <span className="font-mono text-[13px] text-slate-100 tabular-nums whitespace-nowrap">
              {formatTime(currentTime)} <span className="text-slate-500">/ {formatTime(total, false)}</span>
            </span>
            <div
              ref={waveBoxRef}
              className="relative flex-1 min-w-[12rem] h-10 rounded-lg bg-slate-950/60 overflow-hidden cursor-pointer"
              onPointerDown={(e) => {
                dragRef.current = 'overview';
                e.currentTarget.setPointerCapture(e.pointerId);
                seekTo(timeAt(e, e.currentTarget, true));
              }}
              onPointerMove={(e) => dragRef.current === 'overview' && seekTo(timeAt(e, e.currentTarget, true), false)}
              onPointerUp={() => (dragRef.current = null)}
            >
              <canvas ref={compactRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
            </div>
            {loopButton}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-3.5 pt-2 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-cyan-400/20 border border-cyan-400/50" /> Cue
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-[repeating-linear-gradient(135deg,rgb(51_65_85)_0_2px,transparent_2px_5px)]" /> Pause
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-indigo-400/20 border border-indigo-400" /> Current cue
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2 rounded-sm bg-rose-400/30" /> Too fast
              </span>
              <span className="ml-auto hidden md:inline">Click to jump · drag to scrub · Ctrl+scroll to zoom</span>
            </div>

            <div className="px-3.5">
              <div className="relative h-[22px] font-mono text-[10px] text-slate-500" aria-hidden="true">
                {ticks.map((t) => (
                  <span key={t} className="absolute top-1.5 -translate-x-1/2 tabular-nums" style={{ left: `${((t - vs) / span) * 100}%` }}>
                    {formatTime(t, false)}
                  </span>
                ))}
              </div>
              <div
                ref={waveBoxRef}
                role="slider"
                tabIndex={0}
                aria-label="Waveform with cues and pauses"
                aria-valuemin={0}
                aria-valuemax={Math.round(total)}
                aria-valuenow={Math.round(currentTime)}
                aria-valuetext={formatTime(currentTime)}
                className="relative h-[132px] rounded-[10px] bg-slate-950/60 overflow-hidden cursor-crosshair touch-none"
                onPointerDown={(e) => onWavePointer(e, 'down')}
                onPointerMove={(e) => onWavePointer(e, 'move')}
                onPointerUp={(e) => onWavePointer(e, 'up')}
                onPointerLeave={() => setHoverTime(null)}
                onWheel={onWheel}
              >
                <canvas ref={waveRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
                {!audioBuffer && (
                  <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Reading the audio…</span>
                )}
                {hoverTime !== null && (
                  <span
                    className="absolute top-1.5 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-950 font-mono text-[10.5px] pointer-events-none whitespace-nowrap"
                    style={{ left: `${((hoverTime - vs) / span) * 100}%` }}
                  >
                    {formatTime(hoverTime)}
                  </span>
                )}
              </div>
              <div
                className="relative mt-2.5 h-[26px] rounded-[7px] bg-slate-950/60 overflow-hidden cursor-pointer touch-none"
                title={zoom === 1 ? 'The whole file' : 'The whole file. Drag the box to move around.'}
                onPointerDown={(e) => onOverviewPointer(e, 'down')}
                onPointerMove={(e) => onOverviewPointer(e, 'move')}
                onPointerUp={(e) => onOverviewPointer(e, 'up')}
              >
                <canvas ref={overviewRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
                {zoom > 1 && total > 0 && (
                  <span
                    className="absolute top-0 bottom-0 rounded-md border-[1.5px] border-indigo-400 bg-indigo-400/10 pointer-events-none"
                    style={{ left: `${(vs / total) * 100}%`, width: `${Math.max(1.5, (span / total) * 100)}%` }}
                  />
                )}
              </div>
            </div>

            {/* Transport and the live caption */}
            <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => seekTo(currentTime - 5, false)} className="w-[30px] h-[30px] rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-pointer" aria-label="Back 5 seconds" title="Back 5 seconds (←)">
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button type="button" onClick={prevCue} className={roundBtn} aria-label="Previous cue" title="Previous cue (,)">
                  <SkipBack className="w-3.5 h-3.5 fill-current" />
                </button>
                {playButton('w-[46px] h-[46px]')}
                <button type="button" onClick={nextCue} className={roundBtn} aria-label="Next cue" title="Next cue (.)">
                  <SkipForward className="w-3.5 h-3.5 fill-current" />
                </button>
                <button type="button" onClick={() => seekTo(currentTime + 5, false)} className="w-[30px] h-[30px] rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center cursor-pointer" aria-label="Forward 5 seconds" title="Forward 5 seconds (→)">
                  <RotateCw className="w-4 h-4" />
                </button>
              </div>
              {loopButton}
              <span className="font-mono text-sm text-slate-100 tabular-nums whitespace-nowrap">
                {formatTime(currentTime)} <span className="text-slate-500">/ {formatTime(total)}</span>
              </span>
              <div className="order-last lg:order-none basis-full lg:basis-auto flex-1 min-w-0 flex items-center gap-3 px-3 py-2 rounded-[10px] bg-slate-950/60 border border-slate-800 min-h-[3.25rem]" aria-live="polite">
                {activeCue ? (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] leading-snug text-slate-100">{targetOf(activeCue) || <span className="text-slate-500">No {targetLanguage} line yet</span>}</span>
                      <span className="block text-[11.5px] text-slate-400 truncate">{sourceOf(activeCue)}</span>
                    </span>
                    {targetOf(activeCue) && (
                      <span className={`shrink-0 font-mono text-[10.5px] px-2 py-0.5 rounded-full ${paceClass}`}>{cps.toFixed(1)} cps</span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-slate-500">Press play to follow the cues line by line.</span>
                )}
              </div>
            </div>
            <div className="hidden md:flex flex-wrap gap-3 px-3.5 pb-3 text-[11px] text-slate-500">
              {[
                [['Space'], 'play'],
                [['←', '→'], '5 s'],
                [[',', '.'], 'previous / next cue'],
                [['L'], 'loop cue'],
              ].map(([keys, label]) => (
                <span key={label as string} className="flex items-center gap-1">
                  {(keys as string[]).map((k) => (
                    <kbd key={k} className="font-mono text-[10px] px-1.5 rounded border border-slate-700 text-slate-400">
                      {k}
                    </kbd>
                  ))}
                  {label}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Mini player, once the full one has scrolled out of sight */}
      {showMini && (
        <div role="region" aria-label="Mini player" className="fixed right-4 sm:right-6 bottom-4 sm:bottom-6 z-40 w-[22.5rem] max-w-[calc(100vw-2rem)] rounded-[14px] bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            {playButton('w-[38px] h-[38px]')}
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-semibold text-slate-100">
                <span className="font-mono">{activeCue ? `Cue ${String(activeIndex + 1).padStart(2, '0')}` : 'Playback'}</span>
                <span className="font-mono font-normal text-slate-400"> · {formatTime(currentTime, false)} / {formatTime(total, false)}</span>
              </span>
              {activeCue && <span className="block text-[13px] text-slate-400 truncate">{targetOf(activeCue) || sourceOf(activeCue)}</span>}
            </span>
            <button type="button" onClick={prevCue} className={iconBtn()} aria-label="Previous cue">
              <SkipBack className="w-3 h-3 fill-current" />
            </button>
            <button type="button" onClick={nextCue} className={iconBtn()} aria-label="Next cue">
              <SkipForward className="w-3 h-3 fill-current" />
            </button>
            <button
              type="button"
              onClick={() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={iconBtn()}
              aria-label="Back to the full player"
              title="Back to the full player"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>
          <div
            className="relative h-[26px] mx-3 mb-2.5 rounded-md bg-slate-950/60 overflow-hidden cursor-pointer"
            onPointerDown={(e) => seekTo(timeAt(e, e.currentTarget, true))}
          >
            <canvas ref={miniRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
          </div>
        </div>
      )}
    </>
  );
};
