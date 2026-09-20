import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Volume2,
  VolumeX,
  Repeat,
  ZoomIn,
  ZoomOut,
  ChevronsLeft,
  ChevronsRight,
  AudioLines,
  Headphones,
  Sliders,
  LocateFixed,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Maximize2,
  Minimize2,
  ArrowLeftRight,
  ArrowUpToLine,
  GripVertical,
  X,
} from 'lucide-react';
import { AudioSegment } from '../types';
import { getSensitivityProfile } from '../services/audioService';

const VIEW_MODE_STORAGE_KEY = 'dhvani_waveform_view_mode';
const MINI_SIDE_STORAGE_KEY = 'dhvani_miniplayer_side';
const MINI_COLLAPSED_STORAGE_KEY = 'dhvani_miniplayer_collapsed';
const MINI_POS_STORAGE_KEY = 'dhvani_miniplayer_pos';

/** Keep the dragged mini player this far from every window edge. */
const MINI_EDGE_MARGIN = 8;

/** Waveform stage height per view: Compact keeps the review page tight, Pro is the full DAW stage. */
const WAVE_HEIGHT_COMPACT = 54;
const WAVE_HEIGHT_PRO = 88;

export interface ReviewWaveformPlayerProps {
  audioBuffer: AudioBuffer | null;
  segments: AudioSegment[];
  currentTime: number;
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
  sensitivity?: number;
  onSensitivityChange?: (sensitivity: number) => void;
}

export const ReviewWaveformPlayer: React.FC<ReviewWaveformPlayerProps> = ({
  audioBuffer,
  segments,
  currentTime,
  duration,
  isPlaying,
  onTogglePlay,
  onSeek,
  onSelectSegment,
  activeSegmentId,
  targetLanguage = 'Bengali',
  playbackRate = 1.0,
  onPlaybackRateChange,
  trackMode = 'source',
  onTrackModeChange,
  hasSynthesizedAudio = false,
  sensitivity = 50,
  onSensitivityChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement>(null);

  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [scrollLeft, setScrollLeft] = useState<number>(0);
  const [followPlayhead, setFollowPlayhead] = useState<boolean>(true);
  const [isDraggingScrollbar, setIsDraggingScrollbar] = useState<boolean>(false);
  const [scrollBarHoverTime, setScrollBarHoverTime] = useState<number | null>(null);
  const [isSensitivityMenuOpen, setIsSensitivityMenuOpen] = useState<boolean>(false);

  // Compact (default) vs Pro (expert) layout — Pro reveals the timeline navigator and cue strip
  const [viewMode, setViewMode] = useState<'compact' | 'pro'>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'pro' ? 'pro' : 'compact';
    } catch {
      return 'compact';
    }
  });
  const isPro = viewMode === 'pro';
  const waveHeight = isPro ? WAVE_HEIGHT_PRO : WAVE_HEIGHT_COMPACT;

  // Floating mini player shown while the main player is scrolled out of view
  const [isPlayerOffScreen, setIsPlayerOffScreen] = useState<boolean>(false);
  const [isMiniDismissed, setIsMiniDismissed] = useState<boolean>(false);
  const [miniSide, setMiniSide] = useState<'left' | 'right'>(() => {
    try {
      return localStorage.getItem(MINI_SIDE_STORAGE_KEY) === 'left' ? 'left' : 'right';
    } catch {
      return 'right';
    }
  });
  const [isMiniCollapsed, setIsMiniCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MINI_COLLAPSED_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
    } catch {
      /* storage unavailable (private mode) — view mode simply is not remembered */
    }
  }, [viewMode]);

  // Free-dragged position in viewport pixels; null means it sits in its default corner
  const miniRef = useRef<HTMLDivElement>(null);
  const miniDragOffsetRef = useRef<{ dx: number; dy: number } | null>(null);
  const [isDraggingMini, setIsDraggingMini] = useState<boolean>(false);
  const [miniPos, setMiniPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem(MINI_POS_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return typeof parsed?.x === 'number' && typeof parsed?.y === 'number'
        ? { x: parsed.x, y: parsed.y }
        : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(MINI_SIDE_STORAGE_KEY, miniSide);
      localStorage.setItem(MINI_COLLAPSED_STORAGE_KEY, String(isMiniCollapsed));
      if (miniPos) {
        localStorage.setItem(MINI_POS_STORAGE_KEY, JSON.stringify(miniPos));
      } else {
        localStorage.removeItem(MINI_POS_STORAGE_KEY);
      }
    } catch {
      /* storage unavailable — mini player position simply is not remembered */
    }
  }, [miniSide, isMiniCollapsed, miniPos]);

  // Keep the mini player fully inside the window whatever its size or the window's
  const clampMiniPos = useCallback((x: number, y: number) => {
    const el = miniRef.current;
    const w = el?.offsetWidth || 296;
    const h = el?.offsetHeight || 88;
    const maxX = Math.max(MINI_EDGE_MARGIN, window.innerWidth - w - MINI_EDGE_MARGIN);
    const maxY = Math.max(MINI_EDGE_MARGIN, window.innerHeight - h - MINI_EDGE_MARGIN);
    return {
      x: Math.min(Math.max(MINI_EDGE_MARGIN, x), maxX),
      y: Math.min(Math.max(MINI_EDGE_MARGIN, y), maxY),
    };
  }, []);

  // Drag start on the mini player's handle area — controls inside it keep working
  const handleMiniDragStart = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button, input, a, select')) return;
      const el = miniRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      miniDragOffsetRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      // Switch from corner anchoring to free positioning at the current spot
      setMiniPos(clampMiniPos(rect.left, rect.top));
      setIsDraggingMini(true);
      e.preventDefault();
    },
    [clampMiniPos]
  );

  useEffect(() => {
    if (!isDraggingMini) return;

    const handlePointerMove = (ev: PointerEvent) => {
      const offset = miniDragOffsetRef.current;
      if (!offset) return;
      setMiniPos(clampMiniPos(ev.clientX - offset.dx, ev.clientY - offset.dy));
    };

    const handlePointerUp = () => {
      miniDragOffsetRef.current = null;
      setIsDraggingMini(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDraggingMini, clampMiniPos]);

  // Re-clamp when the window resizes, or when collapsing changes the card's size
  useEffect(() => {
    const reclamp = () => setMiniPos((prev) => (prev ? clampMiniPos(prev.x, prev.y) : prev));
    window.addEventListener('resize', reclamp);
    return () => window.removeEventListener('resize', reclamp);
  }, [clampMiniPos]);

  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      setMiniPos((prev) => (prev ? clampMiniPos(prev.x, prev.y) : prev))
    );
    return () => cancelAnimationFrame(frame);
  }, [isMiniCollapsed, isPlayerOffScreen, clampMiniPos]);

  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverCue, setHoverCue] = useState<AudioSegment | null>(null);
  const [isLoopingCue, setIsLoopingCue] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1x, 1.5x, 2x, 3x, 4x, 5x
  const [hoverPause, setHoverPause] = useState<{
    id: string;
    startTime: number;
    endTime: number;
    duration: number;
  } | null>(null);

  // Scrubber bar hover state
  const [scrubberHoverTime, setScrubberHoverTime] = useState<number | null>(null);
  const scrubberTrackRef = useRef<HTMLDivElement>(null);

  const effectiveDuration = duration || (audioBuffer ? audioBuffer.duration : 60);

  // Dynamic waveform width: at 1x ('Fit') it fits containerWidth; at higher zoom levels,
  // it expands comfortably so long audio (e.g. 2m to 30m) has plenty of room to scroll and inspect.
  const waveformWidth = useMemo(() => {
    if (zoomLevel === 1.0) {
      return containerWidth;
    }
    // Scale proportionally with duration for long audio, guaranteeing ample spacing per second
    const baseZoomWidth = Math.round(containerWidth * zoomLevel);
    const durationScaledWidth = Math.round(effectiveDuration * 25 * zoomLevel);
    return Math.max(containerWidth, Math.max(baseZoomWidth, durationScaledWidth));
  }, [containerWidth, zoomLevel, effectiveDuration]);

  // Non-passive wheel event listener for ultra-smooth horizontal scrolling on long audio
  useEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;

    const handleWheel = (e: WheelEvent) => {
      if (waveformWidth <= scrollEl.clientWidth) return;
      // If user is already scrolling horizontally via trackpad (deltaX), allow default
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      e.preventDefault();
      const maxScroll = waveformWidth - scrollEl.clientWidth;
      const step = e.deltaY;
      const newScroll = Math.max(0, Math.min(maxScroll, scrollEl.scrollLeft + step));
      scrollEl.scrollLeft = newScroll;
      setScrollLeft(newScroll);
      setFollowPlayhead(false);
    };

    scrollEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      scrollEl.removeEventListener('wheel', handleWheel);
    };
  }, [waveformWidth]);

  // Compute speech pauses between segments
  const speechPauses = useMemo(() => {
    if (!segments || segments.length === 0) return [];
    const sorted = [...segments].sort((a, b) => a.startTime - b.startTime);
    const pauses: {
      id: string;
      startTime: number;
      endTime: number;
      duration: number;
      prevCueIndex: number;
      nextCueIndex: number;
    }[] = [];

    // Initial silence before speech starts
    if (sorted[0].startTime > 0.15) {
      pauses.push({
        id: 'pause-init',
        startTime: 0,
        endTime: sorted[0].startTime,
        duration: sorted[0].startTime,
        prevCueIndex: -1,
        nextCueIndex: 0,
      });
    }

    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].startTime - sorted[i].endTime;
      if (gap > 0.08) {
        pauses.push({
          id: `pause-${i}`,
          startTime: sorted[i].endTime,
          endTime: sorted[i + 1].startTime,
          duration: gap,
          prevCueIndex: i,
          nextCueIndex: i + 1,
        });
      }
    }

    const effectiveDur = duration || (audioBuffer ? audioBuffer.duration : 0);
    const lastEnd = sorted[sorted.length - 1].endTime;
    if (effectiveDur > lastEnd + 0.15) {
      pauses.push({
        id: 'pause-end',
        startTime: lastEnd,
        endTime: effectiveDur,
        duration: effectiveDur - lastEnd,
        prevCueIndex: sorted.length - 1,
        nextCueIndex: -1,
      });
    }

    return pauses;
  }, [segments, duration, audioBuffer]);

  // Current active pause based on currentTime
  const currentActivePause = useMemo(() => {
    return speechPauses.find((p) => currentTime >= p.startTime && currentTime <= p.endTime) || null;
  }, [speechPauses, currentTime]);

  // Active Segment based on currentTime
  const currentActiveSegment = useMemo(() => {
    if (!segments || segments.length === 0) return null;
    return (
      segments.find((s) => currentTime >= s.startTime && currentTime <= s.endTime) ||
      (activeSegmentId ? segments.find((s) => s.id === activeSegmentId) : null) ||
      null
    );
  }, [segments, currentTime, activeSegmentId]);

  // Smoothly center the waveform view on a given timestamp
  const scrollToTime = useCallback(
    (targetTime: number, smooth: boolean = true) => {
      const scrollEl = scrollContainerRef.current;
      if (!scrollEl) return;
      if (effectiveDuration <= 0) return;
      const targetX = (targetTime / effectiveDuration) * waveformWidth;
      const viewportW = scrollEl.clientWidth;
      const newScrollLeft = Math.max(
        0,
        Math.min(waveformWidth - viewportW, targetX - viewportW / 2)
      );
      if (smooth) {
        scrollEl.scrollTo({ left: newScrollLeft, behavior: 'smooth' });
      } else {
        scrollEl.scrollLeft = newScrollLeft;
      }
      setScrollLeft(newScrollLeft);
    },
    [effectiveDuration, waveformWidth]
  );

  // Auto-scroll with playhead during playback
  useEffect(() => {
    if (!isPlaying || !followPlayhead) return;
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;
    const viewportW = scrollEl.clientWidth;
    if (waveformWidth <= viewportW) return;
    if (effectiveDuration <= 0) return;

    const playheadX = (currentTime / effectiveDuration) * waveformWidth;
    const curScroll = scrollEl.scrollLeft;

    // If playhead moves past 75% or behind 10% of visible viewport, scroll forward smoothly
    if (playheadX > curScroll + viewportW * 0.75 || playheadX < curScroll + viewportW * 0.1) {
      const targetScroll = Math.max(
        0,
        Math.min(waveformWidth - viewportW, playheadX - viewportW * 0.35)
      );
      scrollEl.scrollTo({ left: targetScroll, behavior: 'smooth' });
      setScrollLeft(targetScroll);
    }
  }, [currentTime, isPlaying, followPlayhead, waveformWidth, effectiveDuration]);

  // Handle looping cue boundary
  useEffect(() => {
    if (!isLoopingCue || !currentActiveSegment || !isPlaying) return;
    if (currentTime >= currentActiveSegment.endTime) {
      onSeek(currentActiveSegment.startTime);
      scrollToTime(currentActiveSegment.startTime);
    }
  }, [isLoopingCue, currentActiveSegment, currentTime, isPlaying, onSeek, scrollToTime]);

  // Jump to Prev / Next Cue
  const handlePrevCue = useCallback(() => {
    if (!segments || segments.length === 0) {
      const t = Math.max(0, currentTime - 5);
      onSeek(t);
      scrollToTime(t);
      return;
    }
    const curIdx = segments.findIndex(
      (s) => currentTime >= s.startTime && currentTime <= s.endTime
    );
    if (curIdx > 0) {
      const prevSeg = segments[curIdx - 1];
      onSeek(prevSeg.startTime);
      if (onSelectSegment) onSelectSegment(prevSeg);
      scrollToTime(prevSeg.startTime);
    } else if (curIdx === 0 && currentTime > segments[0].startTime + 0.5) {
      onSeek(segments[0].startTime);
      scrollToTime(segments[0].startTime);
    } else {
      onSeek(0);
      scrollToTime(0);
    }
  }, [segments, currentTime, onSeek, onSelectSegment, scrollToTime]);

  const handleNextCue = useCallback(() => {
    if (!segments || segments.length === 0) {
      const t = Math.min(duration, currentTime + 5);
      onSeek(t);
      scrollToTime(t);
      return;
    }
    const curIdx = segments.findIndex(
      (s) => currentTime >= s.startTime && currentTime <= s.endTime
    );
    if (curIdx >= 0 && curIdx < segments.length - 1) {
      const nextSeg = segments[curIdx + 1];
      onSeek(nextSeg.startTime);
      if (onSelectSegment) onSelectSegment(nextSeg);
      scrollToTime(nextSeg.startTime);
    } else if (curIdx === -1) {
      const nextSeg = segments.find((s) => s.startTime > currentTime);
      if (nextSeg) {
        onSeek(nextSeg.startTime);
        if (onSelectSegment) onSelectSegment(nextSeg);
        scrollToTime(nextSeg.startTime);
      }
    }
  }, [segments, currentTime, duration, onSeek, onSelectSegment, scrollToTime]);

  // Format seconds to mm:ss.s
  const formatTime = (sec: number) => {
    if (isNaN(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  // Generate or extract peaks from audioBuffer adaptive to waveformWidth
  const waveformPeaks = useMemo(() => {
    // Generate bars proportional to actual pixel width (~1 bar every 3.5px)
    const barCount = Math.max(120, Math.round(waveformWidth / 3.5));
    if (!audioBuffer) {
      const synthPeaks: number[] = [];
      for (let i = 0; i < barCount; i++) {
        const t = (i / barCount) * (effectiveDuration || 60);
        const inSeg = segments.some((s) => t >= s.startTime && t <= s.endTime);
        const base = inSeg ? 0.35 + Math.sin(i * 0.4) * 0.25 + Math.cos(i * 0.1) * 0.2 : 0.08;
        synthPeaks.push(Math.max(0.05, Math.min(1, Math.abs(base))));
      }
      return synthPeaks;
    }

    try {
      const channelData = audioBuffer.getChannelData(0);
      const step = Math.floor(channelData.length / barCount);
      const peaks: number[] = [];

      for (let i = 0; i < barCount; i++) {
        let max = 0;
        const start = i * step;
        const end = Math.min(start + step, channelData.length);
        for (let j = start; j < end; j += 4) {
          const val = Math.abs(channelData[j]);
          if (val > max) max = val;
        }
        peaks.push(max);
      }

      const globalMax = Math.max(...peaks, 0.01);
      return peaks.map((p) => Math.max(0.06, p / globalMax));
    } catch (e) {
      console.warn('Waveform peaks calculation notice:', e);
      return Array(barCount).fill(0.2);
    }
  }, [audioBuffer, waveformWidth, effectiveDuration, segments]);

  // Measure container width via ResizeObserver
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width > 0) {
        setContainerWidth(rect.width);
      }
    };

    handleResize();
    const observer = new ResizeObserver(handleResize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Bring the full player back on screen from the mini player
  const scrollPlayerIntoView = useCallback(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  // Watch whether the full player is still on screen; when it scrolls away the
  // floating mini player takes over so transport stays reachable.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        const offScreen = !entry.isIntersecting;
        setIsPlayerOffScreen(offScreen);
        // Scrolling back to the player clears a manual dismissal
        if (!offScreen) setIsMiniDismissed(false);
      },
      { threshold: 0.15 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Update canvas internal pixel resolution and scale
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || containerWidth <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(waveformWidth * dpr);
    canvas.height = Math.floor(waveHeight * dpr);
    canvas.style.width = `${waveformWidth}px`;
    canvas.style.height = `${waveHeight}px`;
  }, [waveformWidth, containerWidth, waveHeight]);

  // Render Waveform on Canvas with HiDPI support and horizontal width
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const isLight = document.documentElement.classList.contains('light');

    const width = waveformWidth;
    const height = waveHeight;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // 1. Draw Background with subtle grid lines
    ctx.fillStyle = isLight ? '#f8fafc' : '#080c14';
    ctx.fillRect(0, 0, width, height);

    // Subtle background grid lines for a DAW-like feel
    ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.03)' : 'rgba(255, 255, 255, 0.02)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < width; gx += 40) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, height);
      ctx.stroke();
    }

    // 2. Draw Cue Segment Zones & Speech Pause Intervals
    if (effectiveDuration > 0 && segments.length > 0) {
      // Draw speech pause zones first
      speechPauses.forEach((pause) => {
        const pStartX = (pause.startTime / effectiveDuration) * width;
        const pEndX = (pause.endTime / effectiveDuration) * width;
        const pWidth = Math.max(1, pEndX - pStartX);

        // Pause background golden gradient tint
        const pauseGrad = ctx.createLinearGradient(pStartX, 0, pStartX + pWidth, 0);
        if (isLight) {
          pauseGrad.addColorStop(0, 'rgba(245, 158, 11, 0.02)');
          pauseGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.07)');
          pauseGrad.addColorStop(1, 'rgba(245, 158, 11, 0.02)');
        } else {
          pauseGrad.addColorStop(0, 'rgba(245, 158, 11, 0.03)');
          pauseGrad.addColorStop(0.5, 'rgba(245, 158, 11, 0.09)');
          pauseGrad.addColorStop(1, 'rgba(245, 158, 11, 0.03)');
        }
        ctx.fillStyle = pauseGrad;
        ctx.fillRect(pStartX, 0, pWidth, height);

        // Draw elegant diagonal safety stripes for pause intervals to look like a pro audio workstation!
        ctx.strokeStyle = isLight ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let offset = -height; offset < pWidth; offset += 14) {
          ctx.moveTo(Math.max(pStartX, pStartX + offset), height);
          ctx.lineTo(Math.min(pEndX, pStartX + offset + height), 0);
        }
        ctx.stroke();

        // Center dashed pause line
        ctx.strokeStyle = isLight ? 'rgba(245, 158, 11, 0.35)' : 'rgba(245, 158, 11, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(pStartX + pWidth / 2, 0);
        ctx.lineTo(pStartX + pWidth / 2, height);
        ctx.stroke();
        ctx.setLineDash([]);

        // If pause is wide enough (and the stage is tall enough) draw pause indicator text
        if (pWidth > 36 && height >= WAVE_HEIGHT_PRO) {
          ctx.fillStyle = isLight ? '#b45309' : '#fbbf24';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`⏸ ${pause.duration.toFixed(1)}s`, pStartX + pWidth / 2, height - 12);
        }
      });

      // Draw cue segments & vertical boundary markers
      segments.forEach((seg, idx) => {
        const segStartX = (seg.startTime / effectiveDuration) * width;
        const segEndX = (seg.endTime / effectiveDuration) * width;
        const segWidth = Math.max(2, segEndX - segStartX);

        const isActive =
          currentActiveSegment?.id === seg.id ||
          (currentTime >= seg.startTime && currentTime <= seg.endTime);

        // Fill cue background region
        if (isActive) {
          ctx.fillStyle = isLight ? 'rgba(99, 102, 241, 0.12)' : 'rgba(99, 102, 241, 0.18)';
          ctx.fillRect(segStartX, 0, segWidth, height);
          ctx.strokeStyle = isLight ? 'rgba(99, 102, 241, 0.5)' : 'rgba(129, 140, 248, 0.6)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(segStartX, 1, segWidth, height - 2);
        } else {
          ctx.fillStyle =
            idx % 2 === 0
              ? isLight
                ? 'rgba(226, 232, 240, 0.3)'
                : 'rgba(30, 41, 59, 0.25)'
              : isLight
              ? 'rgba(241, 245, 249, 0.3)'
              : 'rgba(15, 23, 42, 0.25)';
          ctx.fillRect(segStartX, 0, segWidth, height);
        }

        // --- VERTICAL BOUNDARY MARKERS ON WAVEFORM CANVAS ---
        // 1. Start of Speech Boundary Marker (Cyan)
        ctx.strokeStyle = isActive
          ? isLight
            ? '#4f46e5'
            : '#818cf8'
          : isLight
          ? '#0284c7'
          : '#38bdf8';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.moveTo(segStartX, 0);
        ctx.lineTo(segStartX, height);
        ctx.stroke();

        // Start Notch Pip
        ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
        ctx.beginPath();
        ctx.moveTo(segStartX - 3, 0);
        ctx.lineTo(segStartX + 3, 0);
        ctx.lineTo(segStartX, 5);
        ctx.closePath();
        ctx.fill();

        // 2. End of Speech Boundary Marker (Amber / Pause Start)
        ctx.strokeStyle = isLight ? '#d97706' : '#f59e0b';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.moveTo(segEndX, 0);
        ctx.lineTo(segEndX, height);
        ctx.stroke();

        // End Notch Pip
        ctx.fillStyle = isLight ? '#d97706' : '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(segEndX - 3, 0);
        ctx.lineTo(segEndX + 3, 0);
        ctx.lineTo(segEndX, 5);
        ctx.closePath();
        ctx.fill();

        // Draw Cue Label Badge at top of region
        if (segWidth > 26) {
          ctx.fillStyle = isActive
            ? isLight
              ? '#4338ca'
              : '#a5b4fc'
            : isLight
            ? '#475569'
            : '#cbd5e1';
          ctx.font = 'bold 9.5px monospace';
          ctx.textAlign = 'left';
          ctx.fillText(`#${idx + 1}`, segStartX + 4, 13);
        }
      });
    }

    // 3. Draw Center Baseline
    const centerY = height / 2;
    ctx.strokeStyle = isLight ? 'rgba(226, 232, 240, 0.6)' : 'rgba(51, 65, 85, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // 4. Draw Audio Waveform Bars with Reflection and Dual-Gradient Look
    const totalBars = waveformPeaks.length;
    const barSpacing = width / totalBars;
    const barWidth = Math.max(1.8, barSpacing * 0.72);
    const playheadX = effectiveDuration > 0 ? (currentTime / effectiveDuration) * width : 0;

    for (let i = 0; i < totalBars; i++) {
      const peak = waveformPeaks[i];
      const x = i * barSpacing;
      // We will split peak height into an upper peak and a slightly shorter reflected bottom peak
      const topPeakHeight = Math.max(1.5, peak * (height * 0.4)); 
      const bottomPeakHeight = topPeakHeight * 0.6; // Reflected peak is 60% of top size

      const isPlayed = x <= playheadX;

      // DRAW UPPER PEAK
      if (isPlayed) {
        const topGrad = ctx.createLinearGradient(x, centerY - topPeakHeight, x, centerY);
        if (isLight) {
          topGrad.addColorStop(0, '#6366f1');
          topGrad.addColorStop(1, '#06b6d4');
        } else {
          topGrad.addColorStop(0, '#818cf8');
          topGrad.addColorStop(1, '#22d3ee');
        }
        ctx.fillStyle = topGrad;
      } else {
        ctx.fillStyle = isLight ? '#cbd5e1' : '#334155';
      }

      ctx.beginPath();
      ctx.roundRect(x, centerY - topPeakHeight, barWidth, topPeakHeight, [1.5, 1.5, 0, 0]);
      ctx.fill();

      // DRAW LOWER REFLECTED PEAK
      if (isPlayed) {
        const bottomGrad = ctx.createLinearGradient(x, centerY, x, centerY + bottomPeakHeight);
        if (isLight) {
          bottomGrad.addColorStop(0, 'rgba(6, 182, 212, 0.4)');
          bottomGrad.addColorStop(1, 'rgba(99, 102, 241, 0.05)');
        } else {
          bottomGrad.addColorStop(0, 'rgba(34, 211, 238, 0.45)');
          bottomGrad.addColorStop(1, 'rgba(129, 140, 248, 0.05)');
        }
        ctx.fillStyle = bottomGrad;
      } else {
        ctx.fillStyle = isLight ? 'rgba(203, 213, 225, 0.25)' : 'rgba(51, 65, 85, 0.25)';
      }

      ctx.beginPath();
      ctx.roundRect(x, centerY, barWidth, bottomPeakHeight, [0, 0, 1.2, 1.2]);
      ctx.fill();
    }

    // 5. Draw Time Ruler Ticks and timecodes at the very bottom
    if (effectiveDuration > 0) {
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.06)';
      ctx.fillStyle = isLight ? 'rgba(71, 85, 105, 0.5)' : 'rgba(148, 163, 184, 0.45)';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'center';

      const tickInterval = Math.max(1, Math.floor(effectiveDuration / 20));
      const stepSec = tickInterval >= 15 ? 15 : tickInterval >= 10 ? 10 : tickInterval >= 5 ? 5 : tickInterval >= 2 ? 2 : 1;

      for (let sec = 0; sec <= effectiveDuration; sec += stepSec) {
        const tickX = (sec / effectiveDuration) * width;
        const isMajor = sec % (stepSec * 2) === 0;

        ctx.lineWidth = isMajor ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(tickX, height - (isMajor ? 6 : 3));
        ctx.lineTo(tickX, height);
        ctx.stroke();

        if (isMajor && tickX > 15 && tickX < width - 15) {
          const m = Math.floor(sec / 60);
          const s = Math.floor(sec % 60);
          ctx.fillText(`${m}:${s < 10 ? '0' : ''}${s}`, tickX, height - 8);
        }
      }
    }

    // 6. Draw Hover Indicator Line
    if (hoverTime !== null && effectiveDuration > 0) {
      const hoverX = (hoverTime / effectiveDuration) * width;
      ctx.strokeStyle = isLight ? 'rgba(99, 102, 241, 0.7)' : 'rgba(129, 140, 248, 0.6)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 7. Draw Main Playhead Scrubber Line with Neon Glow Laser effect
    if (effectiveDuration > 0) {
      ctx.save();
      ctx.shadowBlur = isLight ? 4 : 8;
      ctx.shadowColor = isLight ? 'rgba(79, 70, 229, 0.7)' : 'rgba(34, 211, 238, 0.9)';
      ctx.strokeStyle = isLight ? '#4f46e5' : '#22d3ee';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();
      ctx.restore();

      // Playhead Top Scrubber Circle
      ctx.fillStyle = isLight ? '#4f46e5' : '#22d3ee';
      ctx.beginPath();
      ctx.arc(playheadX, 6, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }, [
    waveformPeaks,
    currentTime,
    duration,
    audioBuffer,
    segments,
    currentActiveSegment,
    hoverTime,
    waveformWidth,
    effectiveDuration,
    speechPauses,
    waveHeight,
  ]);

  // Handle Zoom change while keeping the current visible center in view
  const handleZoomChange = (newZoom: number) => {
    const oldZoom = zoomLevel;
    if (newZoom === oldZoom) return;
    const scrollEl = scrollContainerRef.current;

    // Calculate current center time
    let centerTime = currentTime;
    if (scrollEl && containerWidth > 0) {
      const curScroll = scrollEl.scrollLeft;
      const centerRatio = (curScroll + containerWidth / 2) / (containerWidth * oldZoom);
      centerTime = centerRatio * effectiveDuration;
    }

    setZoomLevel(newZoom);

    setTimeout(() => {
      if (!scrollContainerRef.current) return;
      const newWaveformW = Math.max(containerWidth, Math.round(containerWidth * newZoom));
      const targetX = (centerTime / effectiveDuration) * newWaveformW;
      const newScroll = Math.max(
        0,
        Math.min(newWaveformW - containerWidth, targetX - containerWidth / 2)
      );
      scrollContainerRef.current.scrollLeft = newScroll;
      setScrollLeft(newScroll);
    }, 15);
  };

  // Canvas Mouse Seek Handlers (relative to canvas width)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetSeek = ratio * effectiveDuration;
    onSeek(targetSeek);

    // If clicked inside a cue, notify selection
    const clickedSeg = segments.find(
      (s) => targetSeek >= s.startTime && targetSeek <= s.endTime
    );
    if (clickedSeg && onSelectSegment) {
      onSelectSegment(clickedSeg);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, mouseX / rect.width));
    const t = ratio * effectiveDuration;
    setHoverTime(t);

    const matchSeg = segments.find((s) => t >= s.startTime && t <= s.endTime) || null;
    setHoverCue(matchSeg);

    if (!matchSeg) {
      const matchPause = speechPauses.find((p) => t >= p.startTime && t <= p.endTime) || null;
      setHoverPause(matchPause);
    } else {
      setHoverPause(null);
    }
  };

  const handleCanvasMouseLeave = () => {
    setHoverTime(null);
    setHoverCue(null);
    setHoverPause(null);
  };

  // Dedicated Scrollbar Thumb Drag Handler
  const handleScrollbarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingScrollbar(true);
    setFollowPlayhead(false);

    const startX = e.clientX;
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) return;
    const startScrollLeft = scrollEl.scrollLeft;
    const trackEl = scrollbarTrackRef.current;
    if (!trackEl) return;

    const trackWidth = trackEl.clientWidth;
    const maxScroll = waveformWidth - scrollEl.clientWidth;
    if (maxScroll <= 0) return;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const scrollRatio = waveformWidth / trackWidth;
      const newScrollLeft = Math.max(0, Math.min(maxScroll, startScrollLeft + deltaX * scrollRatio));
      scrollEl.scrollLeft = newScrollLeft;
      setScrollLeft(newScrollLeft);
    };

    const handleMouseUp = () => {
      setIsDraggingScrollbar(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Scrollbar Track Click to Jump
  const handleScrollbarTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.scrollbar-thumb')) return;
    const trackEl = scrollbarTrackRef.current;
    const scrollEl = scrollContainerRef.current;
    if (!trackEl || !scrollEl) return;

    const rect = trackEl.getBoundingClientRect();
    const clickRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetCenterWaveformX = clickRatio * waveformWidth;
    const viewportW = scrollEl.clientWidth;
    const newScrollLeft = Math.max(
      0,
      Math.min(waveformWidth - viewportW, targetCenterWaveformX - viewportW / 2)
    );
    scrollEl.scrollTo({ left: newScrollLeft, behavior: 'smooth' });
    setScrollLeft(newScrollLeft);
    setFollowPlayhead(false);
  };

  // Scrubber Track Mouse Handlers (Full Audio Overview bar)
  const handleScrubberMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setScrubberHoverTime(ratio * effectiveDuration);
  };

  const handleScrubberMouseLeave = () => {
    setScrubberHoverTime(null);
  };

  // Calculate viewport start and end times for the scroll indicator badge
  const visibleStartTime = (scrollLeft / waveformWidth) * effectiveDuration;
  const visibleEndTime = Math.min(
    effectiveDuration,
    ((scrollLeft + (containerWidth || 800)) / waveformWidth) * effectiveDuration
  );

  // Scrollbar Thumb Dimensions
  const viewportW = containerWidth || 800;
  const thumbWidthPct = Math.min(100, Math.max(7, (viewportW / waveformWidth) * 100));
  const maxThumbLeftPct = 100 - thumbWidthPct;
  const scrollRatio = waveformWidth - viewportW > 0 ? scrollLeft / (waveformWidth - viewportW) : 0;
  const thumbLeftPct = scrollRatio * maxThumbLeftPct;

  // Mini player only makes sense once there is something to audition
  const showMiniPlayer =
    isPlayerOffScreen && !isMiniDismissed && (Boolean(audioBuffer) || segments.length > 0);

  return (
    <div
      id="review-audio-waveform-player"
      ref={containerRef}
      className={`bg-slate-900/95 border border-slate-800 rounded-3xl shadow-xl transition-all ${
        isPro ? 'p-4 space-y-3.5' : 'p-3 space-y-2.5'
      }`}
    >
      {/* Header Bar: Status, Active Cue Meta & Speed Control */}
      <div
        className={`flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800/80 ${
          isPro ? 'pb-3' : 'pb-2'
        }`}
      >
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-indigo-950/80 border border-indigo-700/60 text-indigo-400 text-xs font-bold font-mono">
            <AudioLines className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">Interactive Waveform &amp; Audition</span>
            <span className="sm:hidden">Waveform</span>
          </div>

          {currentActiveSegment ? (
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="px-2 py-0.5 rounded-lg bg-cyan-950/90 border border-cyan-700/70 text-cyan-300 font-bold">
                Cue #{segments.findIndex((s) => s.id === currentActiveSegment.id) + 1} of{' '}
                {segments.length}
              </span>
              <span className="text-slate-400 hidden sm:inline">
                [{formatTime(currentActiveSegment.startTime)} -{' '}
                {formatTime(currentActiveSegment.endTime)}]
              </span>
              <span className="text-slate-300 font-semibold bg-slate-800/80 px-2 py-0.5 rounded text-[11px]">
                {currentActiveSegment.speaker || 'Speaker'}
              </span>
            </div>
          ) : (
            <span className="text-xs text-slate-400 font-mono">
              {segments.length} dialogue cues mapped
            </span>
          )}
        </div>

        {/* Right Tools: Track mode (if synth exists), Speed & Zoom */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {/* A/B Comparison Monitor (if synth master available) */}
          {hasSynthesizedAudio && onTrackModeChange && (
            <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => onTrackModeChange('source')}
                className={`px-2 py-1 rounded-lg transition-all ${
                  trackMode === 'source'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-indigo-200'
                }`}
                title="Listen to original audio track"
              >
                Original
              </button>
              <button
                type="button"
                onClick={() => onTrackModeChange('synth')}
                className={`px-2 py-1 rounded-lg transition-all ${
                  trackMode === 'synth'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-indigo-200'
                }`}
                title="Listen to synthesized dubbed master"
              >
                Dubbed ({targetLanguage})
              </button>
              <button
                type="button"
                onClick={() => onTrackModeChange('both')}
                className={`px-2 py-1 rounded-lg transition-all ${
                  trackMode === 'both'
                    ? 'bg-cyan-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-indigo-200'
                }`}
                title="Simultaneous dual-track mix audition"
              >
                Mix
              </button>
            </div>
          )}

          {/* Playback Rate Selector */}
          {onPlaybackRateChange && (
            <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-[11px] font-mono">
              {[0.75, 1.0, 1.25, 1.5].map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => onPlaybackRateChange(rate)}
                  className={`px-1.5 py-0.5 rounded-lg transition-all font-semibold ${
                    playbackRate === rate
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-indigo-200'
                  }`}
                  title={`Play at ${rate}x speed`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          )}

          {/* Pause Sensitivity Slider & Quick Controls */}
          {onSensitivityChange && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsSensitivityMenuOpen((prev) => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-[11px] font-semibold transition-all cursor-pointer ${
                  isSensitivityMenuOpen
                    ? 'bg-cyan-950 border-cyan-500 text-cyan-300 shadow-sm'
                    : 'bg-slate-950 hover:bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                }`}
                title="Adjust automatic pause detection sensitivity and silence threshold"
              >
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span className="hidden sm:inline">Pause Sensitivity:</span>
                <span className="font-mono text-cyan-300 font-bold">{sensitivity}%</span>
              </button>

              {/* Popover Dropdown Panel */}
              {isSensitivityMenuOpen && (
                <div
                  className="absolute right-0 top-full mt-2 w-72 sm:w-80 bg-slate-900 border border-slate-700/90 rounded-2xl p-3.5 shadow-2xl z-50 space-y-3 animate-in fade-in zoom-in-95 duration-150"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-100">
                      <Gauge className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Pause Detection Threshold</span>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-300 font-bold bg-cyan-950 px-2 py-0.5 rounded border border-cyan-800/60">
                      {sensitivity}%
                    </span>
                  </div>

                  {/* Range Slider */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-[11px] text-slate-300">
                      <span>Threshold Slider:</span>
                      <span className="text-cyan-400 font-mono font-semibold">
                        {getSensitivityProfile(sensitivity).label}
                      </span>
                    </div>

                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      value={sensitivity}
                      onChange={(e) => onSensitivityChange(Number(e.target.value))}
                      className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                      style={{
                        background: `linear-gradient(to right, #0284c7 0%, #06b6d4 ${sensitivity}%, #334155 ${sensitivity}%, #334155 100%)`,
                      }}
                    />

                    <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                      <span>0% (Coarse)</span>
                      <span>50% (Default)</span>
                      <span>100% (Micro)</span>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-[11px] text-slate-400 leading-snug">
                    {getSensitivityProfile(sensitivity).description}
                  </p>

                  {/* Presets */}
                  <div className="grid grid-cols-4 gap-1 pt-1 border-t border-slate-800">
                    {[
                      { val: 20, lbl: 'Coarse' },
                      { val: 50, lbl: 'Default' },
                      { val: 72, lbl: 'Fast' },
                      { val: 90, lbl: 'Micro' },
                    ].map((p) => (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => onSensitivityChange(p.val)}
                        className={`px-1.5 py-1 rounded-lg text-[10px] font-semibold text-center border transition-all ${
                          Math.abs(sensitivity - p.val) <= 6
                            ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {p.lbl}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400">
                    <span>
                      Min Pause: ~
                      {Math.round(getSensitivityProfile(sensitivity).minSilenceDuration * 1000)}ms
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsSensitivityMenuOpen(false)}
                      className="text-cyan-400 hover:underline font-semibold"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Waveform Zoom Controls with Fit & Fine-Grain Scaling */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-[11px]">
            <button
              type="button"
              onClick={() => handleZoomChange(Math.max(1, +(zoomLevel - 0.5).toFixed(1)))}
              disabled={zoomLevel <= 1}
              className="p-1 rounded-lg text-slate-400 hover:text-indigo-200 disabled:opacity-30 transition-colors"
              title="Zoom out waveform"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 font-mono text-slate-300 font-semibold">{zoomLevel.toFixed(1)}x</span>
            <button
              type="button"
              onClick={() => handleZoomChange(Math.min(5.0, +(zoomLevel + 0.5).toFixed(1)))}
              disabled={zoomLevel >= 5.0}
              className="p-1 rounded-lg text-slate-400 hover:text-indigo-200 disabled:opacity-30 transition-colors"
              title="Zoom in waveform for fine-grained audio scrolling (up to 5x)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            {zoomLevel > 1 && (
              <button
                type="button"
                onClick={() => handleZoomChange(1.0)}
                className="ml-1 px-1.5 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-[10px] text-indigo-300 hover:text-white font-mono transition-colors"
                title="Fit entire audio to view (1.0x)"
              >
                Fit
              </button>
            )}
          </div>

          {/* Compact / Pro (expert) layout switch */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800 text-[11px] font-semibold">
            <button
              type="button"
              onClick={() => setViewMode('compact')}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${
                !isPro
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-indigo-200'
              }`}
              title="Compact view: slim waveform and transport only"
            >
              <Minimize2 className="w-3 h-3" />
              <span className="hidden sm:inline">Compact</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('pro')}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-all ${
                isPro
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-indigo-200'
              }`}
              title="Pro view (expert): full waveform stage, timeline navigator and cue strip"
            >
              <Maximize2 className="w-3 h-3" />
              <span className="hidden sm:inline">Pro</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Interactive Waveform Stage with Horizontal Scroll & Wheel Navigation */}
      <div className="relative group">
        <div
          ref={scrollContainerRef}
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
          style={{ height: `${waveHeight + 10}px` }}
          className="w-full overflow-x-auto overflow-y-hidden select-none rounded-2xl border border-slate-800 shadow-inner bg-slate-950 custom-scrollbar-h focus:outline-hidden"
          tabIndex={0}
          title="Audio waveform: scroll horizontally using mouse wheel, trackpad, or the scrollbar below"
        >
          <div
            className="relative"
            style={{ width: `${waveformWidth}px`, minWidth: '100%', height: `${waveHeight}px` }}
          >
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={handleCanvasMouseLeave}
              className="block cursor-pointer"
            />

            {/* Floating Hover Tooltip */}
            {hoverTime !== null && effectiveDuration > 0 && (
              <div
                className="absolute top-2 pointer-events-none transform -translate-x-1/2 bg-slate-900/95 border border-indigo-500/70 text-white px-2 py-1 rounded-lg shadow-xl text-[10px] font-mono whitespace-nowrap z-20"
                style={{
                  left: `${(hoverTime / effectiveDuration) * waveformWidth}px`,
                }}
              >
                <span className="text-cyan-400 font-bold">{formatTime(hoverTime)}</span>
                {hoverCue && (
                  <span className="ml-1.5 text-indigo-300">
                    Cue #{segments.findIndex((s) => s.id === hoverCue.id) + 1}
                  </span>
                )}
                {hoverPause && (
                  <span className="ml-1.5 text-amber-400 font-bold">
                    ⏸ {hoverPause.duration.toFixed(1)}s pause
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Scroll Status & Density Badge */}
        {waveformWidth > containerWidth && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-slate-900/90 border border-indigo-500/40 text-[9px] font-mono text-indigo-300 pointer-events-none z-10 flex items-center gap-1 shadow-sm">
            <span>Scrollable Timeline ({zoomLevel.toFixed(1)}x)</span>
          </div>
        )}
      </div>

      {/* Dedicated Interactive Waveform Scrollbar & Navigation Strip (Pro view only) */}
      {isPro && (
      <div id="waveform-scrollbar-strip" className="bg-slate-950/85 p-2 sm:p-2.5 rounded-2xl border border-slate-800/90 space-y-2">
        <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1 text-slate-300 font-semibold text-xs">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              <span>Audio Timeline:</span>
            </span>
            <span className="text-indigo-600 dark:text-cyan-300 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2 py-0.5 rounded-md text-[10px] font-bold">
              View: {formatTime(visibleStartTime)} – {formatTime(visibleEndTime)}
            </span>
            <span className="text-slate-500 text-[10px] hidden sm:inline">
              (Total Duration: {formatTime(effectiveDuration)})
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Quick Zoom Presets */}
            <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-900 px-1 py-0.5 rounded-lg border border-slate-200 dark:border-slate-800 text-[10px]">
              {[1.0, 1.5, 2.0, 3.0].map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => handleZoomChange(z)}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    zoomLevel === z
                      ? 'bg-indigo-600 text-white font-bold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-200'
                  }`}
                >
                  {z === 1.0 ? 'Fit' : `${z}x`}
                </button>
              ))}
            </div>

            {/* Follow Playhead Auto-Scroll Toggle */}
            <button
              type="button"
              onClick={() => setFollowPlayhead((prev) => !prev)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold border transition-all ${
                followPlayhead
                  ? 'bg-indigo-50 dark:bg-indigo-600/20 border-indigo-200 dark:border-indigo-500/60 text-indigo-600 dark:text-indigo-300 shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-200'
              }`}
              title={followPlayhead ? 'Auto-scroll is following playback' : 'Click to enable auto-scroll with playhead'}
            >
              <LocateFixed className={`w-3 h-3 ${followPlayhead ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`} />
              <span className="hidden xs:inline">Follow</span>
              <span className="text-[9px] font-bold">({followPlayhead ? 'ON' : 'OFF'})</span>
            </button>

            {/* Snap to Playhead button */}
            <button
              type="button"
              onClick={() => {
                scrollToTime(currentTime);
                setFollowPlayhead(true);
              }}
              className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500/40 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-200 text-[10px] font-semibold transition-all"
              title="Center waveform on current playback position"
            >
              Center
            </button>
          </div>
        </div>

        {/* Scrollbar Track Bar with Jump to Start, Step Buttons, Interactive Track & Jump to End */}
        <div className="flex items-center gap-1.5">
          {/* Jump to Beginning */}
          <button
            type="button"
            onClick={() => {
              const scrollEl = scrollContainerRef.current;
              if (!scrollEl) return;
              scrollEl.scrollTo({ left: 0, behavior: 'smooth' });
              setScrollLeft(0);
              setFollowPlayhead(false);
            }}
            disabled={scrollLeft <= 0}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500/40 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-200 transition-all shrink-0"
            title="Jump to audio beginning (00:00)"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>

          {/* Nudge Left */}
          <button
            type="button"
            onClick={() => {
              const scrollEl = scrollContainerRef.current;
              if (!scrollEl) return;
              const step = scrollEl.clientWidth * 0.35;
              const newScroll = Math.max(0, scrollEl.scrollLeft - step);
              scrollEl.scrollTo({ left: newScroll, behavior: 'smooth' });
              setScrollLeft(newScroll);
              setFollowPlayhead(false);
            }}
            disabled={scrollLeft <= 0}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500/40 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-200 transition-all shrink-0"
            title="Scroll view left"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {/* The Interactive Scroll Track */}
          <div
            id="timeline-scrollbar-track"
            ref={scrollbarTrackRef}
            onClick={handleScrollbarTrackClick}
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
              setScrollBarHoverTime(ratio * effectiveDuration);
            }}
            onMouseLeave={() => setScrollBarHoverTime(null)}
            className="relative flex-1 h-8 rounded-xl bg-slate-100 dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800/90 overflow-hidden select-none cursor-pointer shadow-inner group"
            title="Click or drag thumb to scroll through long audio"
          >
            {/* Cue Ticks along track */}
            {effectiveDuration > 0 &&
              segments.map((seg) => {
                const leftPct = (seg.startTime / effectiveDuration) * 100;
                const widthPct = Math.max(0.5, ((seg.endTime - seg.startTime) / effectiveDuration) * 100);
                const isCur =
                  currentActiveSegment?.id === seg.id ||
                  (currentTime >= seg.startTime && currentTime <= seg.endTime);
                return (
                  <div
                    key={`scrollbar-cue-${seg.id}`}
                    className={`absolute top-1 bottom-1 rounded-xs pointer-events-none ${
                      isCur
                        ? 'bg-indigo-600 dark:bg-indigo-500/70 shadow-[0_0_3px_rgba(99,102,241,0.8)]'
                        : 'bg-slate-300 dark:bg-slate-700/50'
                    }`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  />
                );
              })}

            {/* Playhead position line on scroll track */}
            {effectiveDuration > 0 && (
              <div
                className="absolute top-0 bottom-0 w-[2px] bg-indigo-600 dark:bg-cyan-400 z-10 pointer-events-none shadow-[0_0_4px_rgba(99,102,241,0.9)] dark:shadow-[0_0_4px_rgba(34,211,238,0.9)]"
                style={{ left: `${(currentTime / effectiveDuration) * 100}%` }}
              />
            )}

            {/* Draggable Viewport Slider (Thumb) */}
            <div
              onMouseDown={handleScrollbarMouseDown}
              className={`timeline-scrollbar-thumb absolute top-0.5 bottom-0.5 rounded-lg bg-gradient-to-r from-indigo-500/35 via-indigo-600/50 to-cyan-500/35 border border-indigo-400/80 shadow-md cursor-grab active:cursor-grabbing transition-colors flex items-center justify-center z-20 group-hover:border-indigo-400 ${
                isDraggingScrollbar ? 'ring-2 ring-indigo-400/60 cursor-grabbing' : ''
              }`}
              style={{
                left: `${thumbLeftPct}%`,
                width: `${thumbWidthPct}%`,
              }}
            >
              {/* Grip dots inside thumb */}
              <div className="flex items-center gap-0.5 opacity-80 group-hover:opacity-100">
                <div className="w-0.5 h-3.5 bg-indigo-700 dark:bg-indigo-200 rounded-full" />
                <div className="w-0.5 h-3.5 bg-indigo-700 dark:bg-indigo-200 rounded-full" />
                <div className="w-0.5 h-3.5 bg-indigo-700 dark:bg-indigo-200 rounded-full" />
              </div>
            </div>

            {/* Scrollbar Hover Tooltip */}
            {scrollBarHoverTime !== null && (
              <div
                className="absolute -top-6 transform -translate-x-1/2 bg-slate-900 border border-indigo-500 text-white px-1.5 py-0.5 rounded text-[9px] font-mono pointer-events-none z-30 shadow-lg"
                style={{
                  left: `${Math.max(6, Math.min(94, (scrollBarHoverTime / effectiveDuration) * 100))}%`,
                }}
              >
                {formatTime(scrollBarHoverTime)}
              </div>
            )}
          </div>

          {/* Nudge Right */}
          <button
            type="button"
            onClick={() => {
              const scrollEl = scrollContainerRef.current;
              if (!scrollEl) return;
              const step = scrollEl.clientWidth * 0.35;
              const maxScroll = waveformWidth - scrollEl.clientWidth;
              const newScroll = Math.min(maxScroll, scrollEl.scrollLeft + step);
              scrollEl.scrollTo({ left: newScroll, behavior: 'smooth' });
              setScrollLeft(newScroll);
              setFollowPlayhead(false);
            }}
            disabled={scrollLeft >= waveformWidth - (containerWidth || 800) - 1}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500/40 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-200 transition-all shrink-0"
            title="Scroll view right"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* Jump to End */}
          <button
            type="button"
            onClick={() => {
              const scrollEl = scrollContainerRef.current;
              if (!scrollEl) return;
              const maxScroll = waveformWidth - scrollEl.clientWidth;
              scrollEl.scrollTo({ left: maxScroll, behavior: 'smooth' });
              setScrollLeft(maxScroll);
              setFollowPlayhead(false);
            }}
            disabled={scrollLeft >= waveformWidth - (containerWidth || 800) - 1}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-30 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500/40 text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-200 transition-all shrink-0"
            title="Jump to audio end"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      )}

      {/* Fast Jump Cue Strip below Waveform (Pro view only) */}
      {isPro && segments.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto py-1 px-0.5 scrollbar-thin">
          <span className="text-[10px] text-slate-500 font-mono shrink-0 uppercase tracking-wider font-semibold">
            Jump Cue:
          </span>
          {segments.map((seg, idx) => {
            const isCur =
              currentActiveSegment?.id === seg.id ||
              (currentTime >= seg.startTime && currentTime <= seg.endTime);
            return (
              <button
                key={seg.id}
                type="button"
                onClick={() => {
                  onSeek(seg.startTime);
                  if (onSelectSegment) onSelectSegment(seg);
                  scrollToTime(seg.startTime);
                }}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold shrink-0 transition-all border ${
                  isCur
                    ? 'bg-indigo-600 text-white border-indigo-400 shadow-sm'
                    : 'bg-slate-950 text-slate-400 hover:text-indigo-200 border-slate-800 hover:bg-slate-900 hover:border-indigo-500/40'
                }`}
                title={`[#${idx + 1}] ${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}`}
              >
                #{idx + 1}
              </button>
            );
          })}
        </div>
      )}

      {/* Primary Transport Controls & Scrubber */}
      <div className="bg-slate-950 p-3 sm:p-3.5 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 shadow-sm">
        {/* Left: Player Buttons (Play/Pause, Jump, Skip) */}
        <div className="flex items-center gap-2">
          {/* Jump to Previous Cue */}
          <button
            type="button"
            onClick={handlePrevCue}
            title="Jump to Previous Dialogue Cue"
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 transition-all active:scale-95"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>

          {/* Skip -5s */}
          <button
            type="button"
            onClick={() => onSeek(Math.max(0, currentTime - 5))}
            title="Rewind 5 seconds"
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 transition-all active:scale-95"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {/* Main Play / Pause Button */}
          <button
            type="button"
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause Audio (Space)' : 'Play Audio (Space)'}
            className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 transition-all active:scale-90"
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 text-white" />
            ) : (
              <Play className="w-5 h-5 ml-0.5 text-white" />
            )}
          </button>

          {/* Skip +5s */}
          <button
            type="button"
            onClick={() => onSeek(Math.min(duration || 100, currentTime + 5))}
            title="Fast forward 5 seconds"
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 transition-all active:scale-95"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* Jump to Next Cue */}
          <button
            type="button"
            onClick={handleNextCue}
            title="Jump to Next Dialogue Cue"
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 transition-all active:scale-95"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>

          {/* Loop Current Cue Toggle */}
          <button
            type="button"
            onClick={() => setIsLoopingCue(!isLoopingCue)}
            title={isLoopingCue ? 'Loop Cue: ACTIVE' : 'Loop Current Cue continuously'}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              isLoopingCue
                ? 'bg-amber-600/20 border-amber-500 text-amber-300 shadow-sm'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-indigo-200 hover:border-indigo-500/40'
            }`}
          >
            <Repeat className={`w-3.5 h-3.5 ${isLoopingCue ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Loop Cue</span>
          </button>
        </div>

        {/* Center: Timeline Progress & Enhanced Scrubber Bar with Vertical Markers */}
        <div className="flex-1 min-w-[280px] space-y-1.5">
          <div className="flex justify-between items-center text-[11px] font-mono">
            <div className="flex items-center gap-2">
              <span className="text-cyan-400 font-bold">{formatTime(currentTime)}</span>
              {currentActiveSegment && (
                <span className="text-indigo-400 font-semibold bg-indigo-950/80 border border-indigo-700/60 px-2 py-0.5 rounded text-[10px]">
                  Cue #{segments.findIndex((s) => s.id === currentActiveSegment.id) + 1} Active
                </span>
              )}
              {currentActivePause && (
                <span className="text-amber-400 font-semibold bg-amber-950/80 border border-amber-700/60 px-2 py-0.5 rounded text-[10px] flex items-center gap-1">
                  <span>⏸ Pause</span>
                  <span className="text-amber-300">({currentActivePause.duration.toFixed(1)}s)</span>
                </span>
              )}
            </div>

            <div className="flex items-center gap-2.5 text-[10px]">
              {/* Marker Legend */}
              <div className="hidden sm:flex items-center gap-2 text-slate-400">
                <span className="flex items-center gap-1" title="Start of dialogue cue">
                  <span className="w-1.5 h-2.5 bg-cyan-400 rounded-xs"></span>
                  <span className="text-[9px]">Cue In</span>
                </span>
                <span className="flex items-center gap-1" title="End of dialogue cue / Start of pause">
                  <span className="w-1.5 h-2.5 bg-amber-400 rounded-xs"></span>
                  <span className="text-[9px]">Cue Out (Pause)</span>
                </span>
              </div>
              <span className="text-slate-400">
                {formatTime(duration || (audioBuffer ? audioBuffer.duration : 0))}
              </span>
            </div>
          </div>

          {/* Enhanced Scrubber Bar with Vertical Markers directly on the track */}
          <div
            ref={scrubberTrackRef}
            onMouseMove={handleScrubberMouseMove}
            onMouseLeave={handleScrubberMouseLeave}
            className="relative h-7 w-full rounded-xl bg-slate-900 border border-slate-700/80 overflow-hidden select-none group shadow-inner"
          >
            {/* 1. Speech Segment Regions */}
            {(duration || (audioBuffer ? audioBuffer.duration : 0)) > 0 &&
              segments.map((seg, idx) => {
                const totalDur = duration || (audioBuffer ? audioBuffer.duration : 60);
                const leftPct = (seg.startTime / totalDur) * 100;
                const widthPct = (seg.duration / totalDur) * 100;
                const isCur =
                  currentActiveSegment?.id === seg.id ||
                  (currentTime >= seg.startTime && currentTime <= seg.endTime);

                return (
                  <div
                    key={seg.id}
                    className={`absolute top-0 bottom-0 transition-colors pointer-events-none ${
                      isCur
                        ? 'bg-indigo-600/35 border-t-2 border-b-2 border-indigo-400/80'
                        : idx % 2 === 0
                        ? 'bg-indigo-950/40'
                        : 'bg-slate-800/50'
                    }`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${Math.max(0.6, widthPct)}%`,
                    }}
                  >
                    {widthPct > 5 && (
                      <span className="absolute left-1 top-1 text-[8.5px] font-mono text-slate-300 font-bold opacity-80 pointer-events-none">
                        #{idx + 1}
                      </span>
                    )}
                  </div>
                );
              })}

            {/* 2. Speech Pause Zones between segments */}
            {(duration || (audioBuffer ? audioBuffer.duration : 0)) > 0 &&
              speechPauses.map((pause) => {
                const totalDur = duration || (audioBuffer ? audioBuffer.duration : 60);
                const leftPct = (pause.startTime / totalDur) * 100;
                const widthPct = (pause.duration / totalDur) * 100;

                return (
                  <div
                    key={pause.id}
                    className="absolute top-0 bottom-0 bg-amber-950/30 border-t border-b border-amber-800/30 flex items-center justify-center pointer-events-none overflow-hidden"
                    style={{
                      left: `${leftPct}%`,
                      width: `${Math.max(0.4, widthPct)}%`,
                    }}
                  >
                    {widthPct > 6 && (
                      <span className="text-[8px] font-mono font-bold text-amber-400/90 whitespace-nowrap">
                        ⏸ {pause.duration.toFixed(1)}s
                      </span>
                    )}
                  </div>
                );
              })}

            {/* 3. VERTICAL MARKERS FOR SEGMENT BOUNDARIES DIRECTLY ON SCRUBBER BAR */}
            {(duration || (audioBuffer ? audioBuffer.duration : 0)) > 0 &&
              segments.map((seg, idx) => {
                const totalDur = duration || (audioBuffer ? audioBuffer.duration : 60);
                const startPct = (seg.startTime / totalDur) * 100;
                const endPct = (seg.endTime / totalDur) * 100;

                return (
                  <React.Fragment key={`scrubber-marker-${seg.id}`}>
                    {/* Vertical Marker: Speech Start Boundary (Cyan line with notch) */}
                    <div
                      className="absolute top-0 bottom-0 w-[2px] bg-cyan-400 z-10 pointer-events-none shadow-[0_0_4px_rgba(56,189,248,0.7)]"
                      style={{ left: `${startPct}%` }}
                    >
                      {/* Top Notch Pip */}
                      <div className="w-1.5 h-1.5 -ml-[2px] bg-cyan-300 rounded-xs shadow-xs"></div>
                    </div>

                    {/* Vertical Marker: Speech End / Pause Start Boundary (Amber line with notch) */}
                    <div
                      className="absolute top-0 bottom-0 w-[2px] bg-amber-400 z-10 pointer-events-none shadow-[0_0_4px_rgba(245,158,11,0.7)]"
                      style={{ left: `${endPct}%` }}
                    >
                      {/* Bottom Notch Pip */}
                      <div className="w-1.5 h-1.5 -ml-[2px] absolute bottom-0 bg-amber-300 rounded-xs shadow-xs"></div>
                    </div>
                  </React.Fragment>
                );
              })}

            {/* 4. Played Audio Progress Overlay */}
            {(duration || (audioBuffer ? audioBuffer.duration : 0)) > 0 && (
              <div
                className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-indigo-500/20 to-cyan-500/30 border-r-2 border-cyan-300 pointer-events-none z-15"
                style={{
                  width: `${Math.min(
                    100,
                    (currentTime / (duration || (audioBuffer ? audioBuffer.duration : 60))) * 100
                  )}%`,
                }}
              />
            )}

            {/* 5. Playhead Needle with Glowing Cap */}
            {(duration || (audioBuffer ? audioBuffer.duration : 0)) > 0 && (
              <div
                className="absolute top-0 bottom-0 w-[2.5px] bg-white shadow-[0_0_8px_rgba(255,255,255,0.95)] z-25 pointer-events-none transform -translate-x-1/2"
                style={{
                  left: `${Math.min(
                    100,
                    (currentTime / (duration || (audioBuffer ? audioBuffer.duration : 60))) * 100
                  )}%`,
                }}
              >
                <div className="w-2.5 h-2.5 -ml-[3.5px] -mt-[1px] rounded-full bg-white border border-indigo-400 shadow-md"></div>
                <div className="w-2 h-2 -ml-[2.5px] absolute bottom-0 rounded-full bg-white border border-indigo-400 shadow-md"></div>
              </div>
            )}

            {/* 6. Scrubber Hover Indicator Line and Tooltip */}
            {scrubberHoverTime !== null && (duration || (audioBuffer ? audioBuffer.duration : 0)) > 0 && (
              <>
                <div
                  className="absolute top-0 bottom-0 w-[1.5px] bg-white/70 border-dashed border-l border-white z-20 pointer-events-none"
                  style={{
                    left: `${(scrubberHoverTime / (duration || (audioBuffer ? audioBuffer.duration : 60))) * 100}%`,
                  }}
                />
                <div
                  className="absolute -top-7 transform -translate-x-1/2 bg-slate-900/95 border border-indigo-500 text-white px-2 py-0.5 rounded-md shadow-xl text-[10px] font-mono whitespace-nowrap z-30 pointer-events-none"
                  style={{
                    left: `${Math.max(
                      8,
                      Math.min(
                        92,
                        (scrubberHoverTime / (duration || (audioBuffer ? audioBuffer.duration : 60))) * 100
                      )
                    )}%`,
                  }}
                >
                  <span className="text-cyan-400 font-bold">{formatTime(scrubberHoverTime)}</span>
                  {(() => {
                    const hSeg = segments.find(
                      (s) => scrubberHoverTime >= s.startTime && scrubberHoverTime <= s.endTime
                    );
                    if (hSeg) {
                      return (
                        <span className="ml-1 text-indigo-300">
                          Cue #{segments.indexOf(hSeg) + 1}
                        </span>
                      );
                    }
                    const hPause = speechPauses.find(
                      (p) => scrubberHoverTime >= p.startTime && scrubberHoverTime <= p.endTime
                    );
                    if (hPause) {
                      return (
                        <span className="ml-1 text-amber-300 font-bold">
                          ⏸ {hPause.duration.toFixed(1)}s pause
                        </span>
                      );
                    }
                    return null;
                  })()}
                </div>
              </>
            )}

            {/* 7. Native Draggable Transparent Slider Input Overlay */}
            <input
              type="range"
              min={0}
              max={duration || (audioBuffer ? audioBuffer.duration : 100)}
              step={0.02}
              value={currentTime}
              onChange={(e) => onSeek(parseFloat(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30 m-0 p-0"
              aria-label="Audio scrubber timeline with segment and pause markers"
            />
          </div>
        </div>
      </div>

      {/* Floating Mini Player: takes over when the full player is scrolled out of view */}
      {showMiniPlayer &&
        createPortal(
          <div
            ref={miniRef}
            style={
              miniPos
                ? { left: `${miniPos.x}px`, top: `${miniPos.y}px`, right: 'auto', bottom: 'auto' }
                : undefined
            }
            className={`fixed z-40 ${
              miniPos ? '' : `bottom-5 ${miniSide === 'left' ? 'left-5' : 'right-5'}`
            } ${
              isDraggingMini ? 'select-none cursor-grabbing' : ''
            } animate-in fade-in slide-in-from-bottom-4 duration-200`}
          >
            {isMiniCollapsed ? (
              <div
                onPointerDown={handleMiniDragStart}
                title="Drag to move the mini player"
                className={`flex items-center gap-0.5 bg-slate-900/95 border border-indigo-700/60 rounded-full p-1 shadow-2xl backdrop-blur-md touch-none ${
                  isDraggingMini ? 'cursor-grabbing' : 'cursor-grab'
                }`}
              >
                <GripVertical className="w-3 h-3 text-slate-500 shrink-0" />
                <button
                  type="button"
                  onClick={onTogglePlay}
                  title={isPlaying ? 'Pause Audio' : 'Play Audio'}
                  className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 transition-all active:scale-90"
                >
                  {isPlaying ? (
                    <Pause className="w-3.5 h-3.5 text-white" />
                  ) : (
                    <Play className="w-3.5 h-3.5 ml-0.5 text-white" />
                  )}
                </button>
                <span className="font-mono text-[9px] text-cyan-300 font-bold px-0.5">
                  {formatTime(currentTime)}
                </span>
                <button
                  type="button"
                  onClick={() => setIsMiniCollapsed(false)}
                  title="Expand mini player"
                  className="p-1 rounded-full text-slate-400 hover:text-indigo-200 hover:bg-slate-800 transition-colors"
                >
                  <Maximize2 className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <div className="w-[min(90vw,296px)] bg-slate-900/95 border border-indigo-700/60 rounded-xl shadow-2xl backdrop-blur-md p-1.5 space-y-1.5">
                {/* Mini header: drag handle, active cue meta and window controls */}
                <div
                  onPointerDown={handleMiniDragStart}
                  title="Drag to move the mini player"
                  className={`flex items-center justify-between gap-1 touch-none ${
                    isDraggingMini ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                >
                  <div className="flex items-center gap-1 min-w-0">
                    <GripVertical className="w-3 h-3 text-slate-500 shrink-0" />
                    {currentActiveSegment ? (
                      <span className="text-[9px] font-mono font-bold text-cyan-300 truncate">
                        Cue #{segments.findIndex((s) => s.id === currentActiveSegment.id) + 1}
                        <span className="text-slate-400 font-semibold">
                          {' '}
                          / {segments.length}
                          {currentActiveSegment.speaker ? ` · ${currentActiveSegment.speaker}` : ''}
                        </span>
                      </span>
                    ) : currentActivePause ? (
                      <span className="text-[9px] font-mono font-bold text-amber-400 truncate">
                        ⏸ {currentActivePause.duration.toFixed(1)}s
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono text-slate-400 truncate">
                        {segments.length} cues
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        // Dragged away: first click snaps it home, then clicks flip the corner
                        if (miniPos) {
                          setMiniPos(null);
                          return;
                        }
                        setMiniSide((prev) => (prev === 'right' ? 'left' : 'right'));
                      }}
                      title={
                        miniPos
                          ? 'Snap mini player back to its corner'
                          : `Move mini player to the ${
                              miniSide === 'right' ? 'left' : 'right'
                            } corner`
                      }
                      className="p-0.5 rounded-md text-slate-400 hover:text-indigo-200 hover:bg-slate-800 transition-colors"
                    >
                      <ArrowLeftRight className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={scrollPlayerIntoView}
                      title="Scroll back to the full waveform player"
                      className="p-0.5 rounded-md text-slate-400 hover:text-indigo-200 hover:bg-slate-800 transition-colors"
                    >
                      <ArrowUpToLine className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsMiniCollapsed(true)}
                      title="Collapse to a small bubble"
                      className="p-0.5 rounded-md text-slate-400 hover:text-indigo-200 hover:bg-slate-800 transition-colors"
                    >
                      <Minimize2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsMiniDismissed(true)}
                      title="Hide mini player (returns when you scroll back to the player)"
                      className="p-0.5 rounded-md text-slate-400 hover:text-rose-300 hover:bg-slate-800 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Mini transport */}
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={handlePrevCue}
                    title="Previous Dialogue Cue"
                    className="p-1 rounded-md bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 transition-all active:scale-95"
                  >
                    <ChevronsLeft className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSeek(Math.max(0, currentTime - 5))}
                    title="Rewind 5 seconds"
                    className="p-1 rounded-md bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 transition-all active:scale-95"
                  >
                    <SkipBack className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={onTogglePlay}
                    title={isPlaying ? 'Pause Audio' : 'Play Audio'}
                    className="w-7 h-7 rounded-lg bg-gradient-to-tr from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white flex items-center justify-center shadow-md shadow-indigo-600/30 transition-all active:scale-90 shrink-0"
                  >
                    {isPlaying ? (
                      <Pause className="w-3.5 h-3.5 text-white" />
                    ) : (
                      <Play className="w-3.5 h-3.5 ml-0.5 text-white" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSeek(Math.min(effectiveDuration, currentTime + 5))}
                    title="Fast forward 5 seconds"
                    className="p-1 rounded-md bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 transition-all active:scale-95"
                  >
                    <SkipForward className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNextCue}
                    title="Next Dialogue Cue"
                    className="p-1 rounded-md bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-indigo-200 border border-slate-800 hover:border-indigo-500/40 transition-all active:scale-95"
                  >
                    <ChevronsRight className="w-3 h-3" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsLoopingCue((prev) => !prev)}
                    title={isLoopingCue ? 'Loop Cue: ACTIVE' : 'Loop Current Cue continuously'}
                    className={`p-1 rounded-md border transition-all ${
                      isLoopingCue
                        ? 'bg-amber-600/20 border-amber-500 text-amber-300'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-indigo-200 hover:border-indigo-500/40'
                    }`}
                  >
                    <Repeat className={`w-3 h-3 ${isLoopingCue ? 'animate-spin' : ''}`} />
                  </button>

                  {onPlaybackRateChange && (
                    <button
                      type="button"
                      onClick={() => {
                        const rates = [0.75, 1.0, 1.25, 1.5];
                        const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
                        onPlaybackRateChange(rates[nextIdx]);
                      }}
                      title="Cycle playback speed"
                      className="px-1 py-0.5 rounded-md bg-slate-950 hover:bg-slate-800 border border-slate-800 hover:border-indigo-500/40 text-[9px] font-mono font-bold text-slate-300 hover:text-indigo-200 transition-all"
                    >
                      {playbackRate}x
                    </button>
                  )}

                  {/* Elapsed only, to keep the card narrow; total duration is in the tooltip */}
                  <span
                    className="ml-auto font-mono text-[9px] text-cyan-300 font-bold shrink-0"
                    title={`Elapsed of ${formatTime(effectiveDuration)}`}
                  >
                    {formatTime(currentTime)}
                  </span>
                </div>

                {/* Mini scrubber with cue markers */}
                <div className="relative h-1.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-600 to-cyan-500"
                    style={{
                      width: `${
                        effectiveDuration > 0
                          ? Math.min(100, (currentTime / effectiveDuration) * 100)
                          : 0
                      }%`,
                    }}
                  />
                  {effectiveDuration > 0 &&
                    segments.slice(0, 200).map((seg) => (
                      <div
                        key={`mini-cue-${seg.id}`}
                        className="absolute top-0 bottom-0 w-px bg-cyan-300/70"
                        style={{ left: `${(seg.startTime / effectiveDuration) * 100}%` }}
                      />
                    ))}
                  <input
                    type="range"
                    min={0}
                    max={effectiveDuration || 100}
                    step={0.02}
                    value={currentTime}
                    onChange={(e) => onSeek(parseFloat(e.target.value))}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer m-0 p-0"
                    aria-label="Mini player audio scrubber"
                  />
                </div>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
