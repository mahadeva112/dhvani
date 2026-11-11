import React, { useRef, useEffect, useLayoutEffect, useState, useMemo, useCallback } from 'react';
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
  ChevronUp,
  LocateFixed,
  CircleHelp,
} from 'lucide-react';
import { AudioSegment } from '../types';
import { useLiveFrame, useLiveTime } from './useLiveTime';
import { computePeaks, drawPeaks, WaveStyle } from '../services/waveform';
import { useWaveHeight } from './waveHeight';
import { WaveHeightButton } from './WaveHeightButton';
import { MIN_WINDOW_SECONDS, RULER_STEPS, tickDecimals, ticksBetween } from './TimelineControls';
import { LINE_HUES } from './lineColors';
import { useTheme } from './theme';

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
  targetLanguage?: string;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  /** Pause detection now lives in the review panel; kept so callers need not change. */
  sensitivity?: number;
  onSensitivityChange?: (sensitivity: number) => void;
  /**
   * Lets the cut between two touching cues be dragged, called with the left
   * cue's id and the time under the pointer. Omitted, cuts can't be dragged.
   */
  onDragCut?: (leftId: string | number, time: number, phase: 'start' | 'move' | 'end') => void;
  /** The cue left of the cut being edited, whose cut is drawn as a handle. */
  selectedCutId?: string | number | null;
  /**
   * A lane drawn under the waveform on the same clock (the Sync fit's dub
   * lane): given the window on screen and the time, in seconds.
   */
  belowWave?: (view: { start: number; span: number; time: number; layers: LaneLayers }) => React.ReactNode;
  /** Extra controls in the top bar, after the layer chips (how a stretch is shown). */
  toolbarExtra?: React.ReactNode;
  /** A row under `belowWave` on the same clock (wording suggestions for stretched lines). */
  belowLane?: (view: { start: number; span: number }) => React.ReactNode;
  /** The lane's name in the legend. */
  belowWaveLabel?: string;
  /**
   * A thin row between the waveform and `belowWave` (the lines' pauses), on
   * the same clock. With a lane below, the full view becomes a track view:
   * each row named on its left.
   */
  pausesRow?: (view: { start: number; span: number }) => React.ReactNode;
  /**
   * How a cue sits, for its mark on the waveform and its chip under the
   * player: the Sync fit of its line, when the caller has one. Without it a
   * cue is judged on its own, by characters a second.
   */
  cuePace?: (segment: AudioSegment) => { level: 'natural' | 'tight' | 'fast'; label: string };
  /** The marked cues' name in the legend: "Too fast" by characters, "Too long" by the Sync fit. */
  fastLabel?: string;
  /**
   * The original's stretch for each sync line, in that line's colour: the
   * waveform is drawn in it there, so a line's speech above and its dub chunk
   * below share one colour. Keep the array stable; a new one redraws.
   */
  lineSpans?: { from: number; to: number; color: string }[];
  /**
   * Drawn in the waveform's place, on the same clock (the original's words or
   * lines in Blocks and Bars). Clicks and drags there still seek and move cuts.
   */
  sourceLane?: (view: { start: number; span: number; layers: LaneLayers }) => React.ReactNode;
  /** A row right under the waveform on the same clock (the original in chunks, in Bars). */
  sourceRow?: (view: { start: number; span: number; layers: LaneLayers }) => React.ReactNode;
}

/** What the timeline shows besides the lines, toggled from its top bar: pause ticks, every line's fit, numbers. */
export interface LaneLayers {
  pauses: boolean;
  fit: boolean;
  numbers: boolean;
}
const LAYERS_KEY = 'dhvani.reviewLayers';
/** Off until turned on: the lines' colours alone at first. */
const NO_LAYERS: LaneLayers = { pauses: false, fit: false, numbers: false };
const LAYER_CHIPS: { id: keyof LaneLayers; label: string; hint: string }[] = [
  { id: 'pauses', label: 'Pauses', hint: "Pauses and cuts: the pauses row, the cuts in each dub line, Sync's place for a moved line, and the picked line's outline. Off, lines are told apart by colour alone" },
  { id: 'fit', label: 'Fit', hint: 'How every dub line fits its room (the line you pick, or stretch, always shows it)' },
  { id: 'numbers', label: 'Line numbers', hint: 'Cue numbers on the original, line numbers on the dub' },
];

/** Cues closer than this share a cut that can be dragged. */
const CUT_GAP_SECONDS = 0.8;
/** How near the pointer must be to a cut to grab it, in pixels. */
const CUT_GRAB_PX = 6;

const RATES = [0.75, 1, 1.25, 1.5];
/** The deepest zoom shows about this many seconds, however long the track: a few hundred samples, each one drawn. */
const MIN_VIEW_SECONDS = MIN_WINDOW_SECONDS;
/**
 * The zoom steps for a track this long: half a power of two apart, from the
 * whole track down to MIN_VIEW_SECONDS on view. A fixed list ran out at a
 * minute or more on view for a long video.
 */
const zoomLevels = (total: number) => {
  const levels = [1];
  for (let k = 1; k < 60 && total / 2 ** (k / 2) >= MIN_VIEW_SECONDS; k++) levels.push(2 ** (k / 2));
  return levels;
};
/** Each frame (at 60 a second) a glide covers this share of the way left, so a wheel or a page turn eases in, not jumps. */
const GLIDE = 0.22;
/** A trackpad's sideways swipe follows the fingers more closely. */
const GLIDE_TRACKPAD = 0.5;
/**
 * The timeline is drawn this many views wider on each side than what shows,
 * so a scroll or a glide only slides what is drawn (a transform, as REAPER
 * scrolls) and redraws once it has slid most of that far.
 */
const BUFFER_PAD = 0.75;
/** Slid this share of a view from where it was drawn, the timeline is drawn again around where it is now. */
const REDRAW_AT = 0.6;
/** The timeline opens showing about this much, so the wheel and its scroll bar move it from the start. */
const OPEN_SECONDS = 30;
/** Where the waveform's bars start below the top of its strip, under the cue numbers. */
const WAVE_TOP = 15;
/**
 * In the coloured view the original's bars sit in the same box as a dub line's
 * wave below (DubEstimateLane: a part is inset 6 px top and bottom), so the
 * two lanes' waves are the same size; cue numbers, when shown, sit over them.
 */
const LANE_INSET = 6;
/** Height of the mini player bar along the bottom of the window. */
const MINI_BAR_PX = 40;

/** Canvas colours. */
const PALETTE = {
  wave: '#64748b',
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
};

/** The same, with Graphite's neutral greys in place of slate (components/theme.ts). */
const GRAPHITE_PALETTE = { ...PALETTE, wave: '#6b6d75', hatch: '#36383e', label: '#abadb5', playhead: '#ececef' };

const targetOf = (seg: AudioSegment) => seg.textTarget || seg.targetText || '';
const sourceOf = (seg: AudioSegment) => seg.textSource || seg.originalText || '';
const cpsOf = (seg: AudioSegment) => {
  const d = seg.endTime - seg.startTime;
  return d > 0 ? targetOf(seg).length / d : 0;
};

/** 57.1 -> "00:57.1", 3725 -> "1:02:05.0" */
const formatTime = (seconds: number, tenths: boolean | number = true) => {
  const t = Math.max(0, seconds || 0);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  // A number is how many decimals: the ruler's labels zoomed in past a second.
  const places = tenths === true ? 1 : tenths === false ? 0 : tenths;
  const sec = places > 0 ? s.toFixed(places).padStart(3 + places, '0') : String(Math.floor(s)).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${String(m).padStart(2, '0')}:${sec}`;
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

/** The cue being heard at `t`, or between cues the one about to be heard. */
const cueIndexAt = (segments: AudioSegment[], t: number) => {
  const inside = segments.findIndex((s) => t >= s.startTime && t <= s.endTime);
  if (inside >= 0) return inside;
  const next = segments.findIndex((s) => s.endTime >= t);
  return next >= 0 ? next : segments.length - 1;
};

/** Puts a playhead at fraction `f` of its box, and shows the played layer up to it. */
const placePlayhead = (head: HTMLElement | null, played: HTMLElement | null, f: number) => {
  if (head) {
    head.style.display = f >= 0 && f <= 1 ? '' : 'none';
    head.style.left = `${f * 100}%`;
  }
  if (played) played.style.clipPath = `inset(0 ${(1 - Math.max(0, Math.min(1, f))) * 100}% 0 0)`;
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
  targetLanguage = 'Hindi',
  playbackRate = 1,
  onPlaybackRateChange,
  onDragCut,
  selectedCutId = null,
  belowWave,
  belowWaveLabel,
  belowLane,
  toolbarExtra,
  pausesRow,
  cuePace,
  fastLabel = 'Too fast',
  lineSpans,
  sourceLane,
  sourceRow,
}) => {
  /*
   * Two clocks for two jobs. Playheads and the played colour move every frame
   * through refs (applyFrame below), so they sit on the frame being painted
   * and the waveform is never redrawn to move them. The clock text and the
   * logic use the position in tenths, re-rendering ten times a second.
   */
  const currentTime = useLiveTime(reportedTime, isPlaying, getLiveTime, 0.1);
  const liveRef = useRef(reportedTime);

  const total = duration || audioBuffer?.duration || segments[segments.length - 1]?.endTime || 0;
  const paceOf = (seg: AudioSegment) => {
    if (cuePace) return cuePace(seg);
    const cps = cpsOf(seg);
    return cps > 18 ? { level: 'fast' as const, label: 'Too fast' } : cps > 14 ? { level: 'tight' as const, label: 'Tight' } : { level: 'natural' as const, label: 'Natural' };
  };
  // The marked cues by id, so the waveforms redraw when a mark changes and not on every render.
  const fastIds = segments.filter((seg) => paceOf(seg).level === 'fast').map((seg) => String(seg.id)).join('|');
  const fastSet = useMemo(() => new Set(fastIds.split('|')), [fastIds]);
  const palette = useTheme() === 'graphite' ? GRAPHITE_PALETTE : PALETTE;
  /** The timeline's layers, remembered across sessions. */
  const [layers, setLayers] = useState<LaneLayers>(() => {
    try {
      return { ...NO_LAYERS, ...JSON.parse(localStorage.getItem(LAYERS_KEY) || '{}') };
    } catch {
      return NO_LAYERS;
    }
  });
  const toggleLayer = (id: keyof LaneLayers) =>
    setLayers((was) => {
      const next = { ...was, [id]: !was[id] };
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify(next));
      } catch {
        /* Storage off: the layers last until the app closes. */
      }
      return next;
    });
  // Layers belong to the coloured lines; without them the timeline shows everything, as before.
  const layered = Boolean(lineSpans?.length && belowWave);
  const showNumbers = !layered || layers.numbers;

  const [zoom, setZoom] = useState(1);
  const [viewStart, setViewStartState] = useState(0);
  /*
   * A glide toward a new view start: the wheel and following playback ease
   * the view there over a few frames. Anything that sets the view outright
   * (zoom, the scroll bar, a cue jump) stops a glide first.
   */
  const glideRef = useRef<{ at: number; target: number; raf: number; ease: number; last: number } | null>(null);
  const viewStartRef = useRef(0);
  viewStartRef.current = viewStart;
  /*
   * How far the view has slid past `viewStart` without a re-render: the
   * timeline's tracks (drawn BUFFER_PAD views wider each side) are moved by
   * it with a transform, the playhead and scroll bar with it. viewStart is
   * set, and the tracks drawn again around it, only when a glide ends or has
   * slid REDRAW_AT of a view.
   */
  const shiftRef = useRef(0);
  const timelineRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const slideRef = useRef<() => void>(() => {});
  const stopGlide = () => {
    const g = glideRef.current;
    if (!g) return;
    cancelAnimationFrame(g.raf);
    glideRef.current = null;
    // Stopped where it is: that is the view now.
    setViewStartState(g.at);
  };
  const setViewStart: typeof setViewStartState = (value) => {
    stopGlide();
    setViewStartState(value);
  };
  const glideTo = (target: number, close: number, ease = GLIDE) => {
    const g = glideRef.current;
    if (g) {
      g.target = target;
      g.ease = ease;
      return;
    }
    const glide = { at: viewStartRef.current + shiftRef.current, target, raf: 0, ease, last: performance.now() };
    glideRef.current = glide;
    const step = (now: number) => {
      // The same speed whatever the screen's frame rate.
      const k = 1 - Math.pow(1 - glide.ease, Math.min(4, Math.max(0.25, (now - glide.last) / (1000 / 60))));
      glide.last = now;
      const left = glide.target - glide.at;
      const done = Math.abs(left) <= close;
      glide.at = done ? glide.target : glide.at + left * k;
      if (done) glideRef.current = null;
      else glide.raf = requestAnimationFrame(step);
      shiftRef.current = glide.at - viewStartRef.current;
      slideRef.current();
      if (done || Math.abs(shiftRef.current) > spanRef.current * REDRAW_AT) setViewStartState(glide.at);
    };
    glide.raf = requestAnimationFrame(step);
  };
  useEffect(() => stopGlide, []);
  const [follow, setFollow] = useState(true);
  const [loop, setLoop] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [showMini, setShowMini] = useState(false);
  // While the bar shows, the page ends that much further down, so the last cues can still be scrolled clear of it.
  useEffect(() => {
    if (!showMini) return;
    const body = document.body;
    const before = body.style.paddingBottom;
    body.style.paddingBottom = `${MINI_BAR_PX}px`;
    return () => {
      body.style.paddingBottom = before;
    };
  }, [showMini]);
  const [activeIndex, setActiveIndex] = useState(() => cueIndexAt(segments, reportedTime));
  const activeIndexRef = useRef(activeIndex);

  const sectionRef = useRef<HTMLElement>(null);
  /** The row with the play button: the mini player stands in for it once it is out of sight. */
  const [transportEl, transportRef] = useState<HTMLDivElement | null>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const wavePlayedRef = useRef<HTMLCanvasElement>(null);
  const waveHeadRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const miniPlayedRef = useRef<HTMLCanvasElement>(null);
  const miniHeadRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'wave' | 'cut' | null>(null);
  /** The left cue of the cut being dragged. */
  const cutDragRef = useRef<string | number | null>(null);
  const [redrawTick, setRedrawTick] = useState(0);
  const waveHeight = useWaveHeight();

  const span = total > 0 ? total / zoom : 1;
  const spanRef = useRef(span);
  spanRef.current = span;
  /** What the tracks are drawn over for a view from `start`: BUFFER_PAD views more each side, inside the track. */
  const bufferOf = (start: number) => {
    const from0 = zoom === 1 ? 0 : start;
    const pad = zoom === 1 ? 0 : span * BUFFER_PAD;
    const from = Math.max(0, from0 - pad);
    const to = Math.min(Math.max(total, from0 + span), from0 + span + pad);
    return { from, span: Math.max(span, to - from), view: from0 };
  };
  /** Where the view starts this instant, glide included. */
  const liveStart = () => (zoom === 1 ? 0 : viewStartRef.current + shiftRef.current);
  const ZOOMS = useMemo(() => zoomLevels(total), [total]);
  // A track longer than OPEN_SECONDS opens zoomed in on where playback is.
  const openedZoomRef = useRef(false);
  useEffect(() => {
    if (openedZoomRef.current || total <= 0) return;
    openedZoomRef.current = true;
    const z = ZOOMS.find((x) => total / x <= OPEN_SECONDS) ?? ZOOMS[ZOOMS.length - 1];
    if (z === 1) return;
    const ns = total / z;
    setZoom(z);
    setViewStart(Math.max(0, Math.min(total - ns, liveRef.current - ns * 0.25)));
  }, [total]);
  const clampStart = useCallback((start: number, s = span) => Math.max(0, Math.min(Math.max(0, total - s), start)), [total, span]);
  /** Where playback is this instant, not as of the last re-render. */
  const timeNow = () => liveRef.current;

  /*
   * Full-resolution peaks for the whole file, computed once per buffer, so
   * the deepest zoom still shows every transient, as DaVinci does. They are
   * placed by the buffer's own length, so they line up with the audio
   * whatever `duration` the caller passes.
   */
  const peaks = useMemo(() => {
    if (!audioBuffer || audioBuffer.length === 0) return null;
    try {
      return computePeaks(audioBuffer);
    } catch (e) {
      console.warn('Could not read the waveform:', e);
      return null;
    }
  }, [audioBuffer]);

  const activeCue = activeIndex >= 0 ? segments[activeIndex] ?? null : null;

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

  const prevCue = () => {
    if (!segments.length) return;
    const t = timeNow();
    const index = cueIndexAt(segments, t);
    const cue = segments[index];
    const inside = Boolean(cue && t >= cue.startTime && t <= cue.endTime);
    // A second into a cue, "previous" restarts it, as a media player's back button does.
    if (cue && inside && t - cue.startTime > 1) return goToCue(index);
    let prev = -1;
    segments.forEach((s, i) => {
      if (s.startTime < t - 0.05) prev = i;
    });
    goToCue(Math.max(0, inside ? index - 1 : prev));
  };

  const nextCue = () => {
    const t = timeNow();
    const next = segments.findIndex((s) => s.startTime > t + 0.05);
    if (next >= 0) goToCue(next);
  };

  const changeZoom = useCallback(
    (dir: 1 | -1, anchor?: number) => {
      // The point zoomed at stays under the pointer, as in REAPER; zoomed by key, the playhead stays put.
      const startNow = liveStart();
      const focus = anchor ?? liveRef.current;
      const share = zoom === 1 && anchor === undefined ? 0.35 : Math.max(0, Math.min(1, (focus - startNow) / span));
      stopGlide();
      setZoom((z) => {
        const i = ZOOMS.indexOf(z);
        const nz = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (i < 0 ? 0 : i) + dir))];
        const ns = total / nz;
        setViewStartState(Math.max(0, Math.min(Math.max(0, total - ns), focus - ns * share)));
        return nz;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [total, ZOOMS, zoom, span]
  );

  /*
   * Every frame while playing, and after every render: playheads, played
   * colour, the current cue, looping and following, all from the exact
   * position. Looping happens on the frame playback crosses the cue's end,
   * not up to a quarter-second later.
   */
  const applyFrame = (t: number) => {
    const prev = liveRef.current;
    liveRef.current = t;
    const vs = liveStart();
    const drawn = bufferOf(viewStartRef.current);
    placePlayhead(waveHeadRef.current, null, (t - vs) / span);
    placePlayhead(null, wavePlayedRef.current, (t - drawn.from) / drawn.span);
    placePlayhead(miniHeadRef.current, miniPlayedRef.current, total > 0 ? t / total : 0);

    const looped = segments[activeIndexRef.current];
    if (loop && isPlaying && looped && prev < looped.endTime && t >= looped.endTime && t - prev < 0.5) {
      onSeek(looped.startTime);
      return;
    }
    const index = cueIndexAt(segments, t);
    if (index !== activeIndexRef.current) {
      activeIndexRef.current = index;
      setActiveIndex(index);
    }
    // Follow playback: keep the playhead in the view while zoomed in, gliding a page on rather than jumping.
    if (follow && zoom > 1 && !dragRef.current) {
      if (t < vs + span * 0.05 || t > vs + span * 0.85) glideTo(clampStart(t - span * 0.25), span * 0.001);
      // A seek far off view isn't glided to through everything between: it is shown at once.
      if (Math.abs(t - prev) > span && (t < vs || t > vs + span)) setViewStart(clampStart(t - span * 0.25));
    }
  };
  useLiveFrame(reportedTime, isPlaying, getLiveTime, applyFrame);
  /** Slides the tracks, the playhead and the scroll bar to where the view is this instant. */
  slideRef.current = () => {
    const w = waveBoxRef.current?.clientWidth || 0;
    timelineRef.current?.style.setProperty('--track-shift', `${(-shiftRef.current / span) * w}px`);
    if (thumbRef.current && total > 0) thumbRef.current.style.left = `${(liveStart() / total) * 100}%`;
    applyFrame(liveRef.current);
  };
  // Drawn again around a new view start: what is left of a glide is the slide now.
  useLayoutEffect(() => {
    shiftRef.current = glideRef.current && zoom > 1 ? glideRef.current.at - viewStart : 0;
    slideRef.current();
  }, [viewStart, zoom, span]);
  // Zoom, scroll, resizes and new cues move what the position maps to.
  useLayoutEffect(() => {
    applyFrame(liveRef.current);
  });

  // Keyboard: arrows move 5 s, comma and full stop step cues, L loops, + and − zoom, F shows the whole track. Space is the app's.
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    if (e.key === 'ArrowLeft') seekTo(timeNow() - 5, false);
    else if (e.key === 'ArrowRight') seekTo(timeNow() + 5, false);
    else if (e.key === ',') prevCue();
    else if (e.key === '.') nextCue();
    else if (e.key === 'l' || e.key === 'L') setLoop((v) => !v);
    else if (e.key === '+' || e.key === '=') changeZoom(1);
    else if (e.key === '-') changeZoom(-1);
    else if (e.key === 'f' || e.key === 'F') setZoom(1);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /*
    Mini player: shown once the play button has scrolled up out of sight. Not
    the whole player: with one speaker the page can end before the player's
    last strip leaves the window, and then no play button was in reach. Nor
    the whole row: with one speaker the page can end with that row only
    partly clipped at the top, so the bar shows as soon as any of it is cut
    off above.
  */
  useEffect(() => {
    const el = transportEl;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const clippedAbove = entry.intersectionRatio < 1 && entry.boundingClientRect.top < 0;
        setShowMini(clippedAbove);
      },
      { threshold: [0, 1] }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [transportEl]);

  // Redraw when any canvas changes size.
  useEffect(() => {
    const observer = new ResizeObserver(() => setRedrawTick((t) => t + 1));
    [waveRef, miniRef].forEach((r) => r.current && observer.observe(r.current));
    return () => observer.disconnect();
  }, [showMini]);

  // ---------- drawing ----------
  /*
   * The waveform is drawn twice per strip: once in the unplayed colour, and
   * once in the played colour on a layer above that applyFrame clips at the
   * playhead. Neither is redrawn as playback moves.
   */
  const drawBars = (
    ctx: CanvasRenderingContext2D,
    w: number,
    top: number,
    height: number,
    from: number,
    to: number,
    color: string | ((t: number) => WaveStyle)
  ) => drawPeaks(ctx, peaks, { x: 0, y: top, w, h: height, from, to, style: color, scale: waveHeight });
  /** Bars in their line's colour inside a line (dimmed until played), `base` between lines. */
  const lineBars = (base: string, played: boolean): string | ((t: number) => WaveStyle) => {
    if (!lineSpans?.length) return base;
    const fixed = { color: base };
    return (t: number) => {
      const line = lineSpans.find((l) => t >= l.from && t <= l.to);
      return line ? { color: line.color, alpha: played ? 1 : 0.5 } : fixed;
    };
  };

  useEffect(() => {
    const c = prepareCanvas(waveRef.current);
    if (!c) return;
    const { ctx, w, h } = c;
    // The whole drawn stretch, wider than the view: a scroll slides it (see shiftRef).
    const { from: vs, span: drawnSpan } = bufferOf(viewStart);
    const ve = vs + drawnSpan;
    const x = (t: number) => ((t - vs) / drawnSpan) * w;

    // With the sync lines' colours, each line's speech is told apart by its colour alone, as its dub
    // below is: no cue boxes, no pause hatching and no mark over the cue being heard (the playhead is
    // there). Without them, the cues are boxes on hatched pauses, as before.
    const coloured = Boolean(lineSpans?.length);
    if (!coloured) {
      ctx.strokeStyle = palette.hatch;
      ctx.lineWidth = 1;
      for (let p = -h; p < w; p += 6) {
        ctx.beginPath();
        ctx.moveTo(p, h);
        ctx.lineTo(p + h, 0);
        ctx.stroke();
      }
    }
    segments.forEach((seg, i) => {
      if (seg.endTime < vs || seg.startTime > ve) return;
      const a = x(seg.startTime);
      const b = x(seg.endTime);
      const isCurrent = i === activeIndex;
      const fast = fastSet.has(String(seg.id));
      if (!coloured) {
        ctx.fillStyle = isCurrent ? palette.current : fast ? palette.fast : palette.cue;
        ctx.fillRect(a, 0, b - a, h);
        ctx.fillStyle = isCurrent ? palette.currentEdge : fast ? palette.fastEdge : palette.cueEdge;
        ctx.fillRect(a, 0, 1.5, h);
      }
      if (b - a > 20 && showNumbers) {
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.fillStyle = isCurrent ? palette.currentEdge : palette.label;
        ctx.fillText(String(i + 1).padStart(2, '0'), a + (coloured ? 1 : 5), 11);
      }
    });
    const top = coloured ? LANE_INSET : WAVE_TOP;
    drawBars(ctx, w, top, h - top - (coloured ? LANE_INSET : 3), vs, ve, lineBars(palette.wave, false));
    const cue = segments[activeIndex];
    if (cue && !coloured) {
      ctx.strokeStyle = palette.currentEdge;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x(cue.startTime), 0.75, x(cue.endTime) - x(cue.startTime), h - 1.5);
    }
    // The cut being edited: a bar with a grip, to show it can be dragged.
    const left = selectedCutId === null ? -1 : segments.findIndex((seg) => String(seg.id) === String(selectedCutId));
    if (left >= 0 && segments[left + 1]) {
      const cx = x((segments[left].endTime + segments[left + 1].startTime) / 2);
      ctx.fillStyle = palette.view;
      ctx.fillRect(cx - 1, 0, 2.5, h);
      ctx.fillRect(cx - 4, h / 2 - 10, 8.5, 20);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peaks, segments, activeIndex, zoom, viewStart, span, palette, redrawTick, selectedCutId, fastSet, lineSpans, showNumbers, waveHeight]);

  useEffect(() => {
    const c = prepareCanvas(wavePlayedRef.current);
    if (!c) return;
    const { from: vs, span: drawnSpan } = bufferOf(viewStart);
    const top = lineSpans?.length ? LANE_INSET : WAVE_TOP;
    drawBars(c.ctx, c.w, top, c.h - top - (lineSpans?.length ? LANE_INSET : 3), vs, vs + drawnSpan, lineBars(palette.played, true));
    applyFrame(liveRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peaks, zoom, viewStart, span, palette, redrawTick, lineSpans, waveHeight]);

  // The mini player's strip: the whole file.
  useEffect(() => {
    if (!showMini || total <= 0) return;
    const c = prepareCanvas(miniRef.current);
    if (c) drawBars(c.ctx, c.w, 2, c.h - 4, 0, total, palette.wave);
    const p = prepareCanvas(miniPlayedRef.current);
    if (p) drawBars(p.ctx, p.w, 2, p.h - 4, 0, total, palette.played);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMini, peaks, total, palette, redrawTick, waveHeight]);

  // ---------- pointer ----------
  const timeAt = (e: React.PointerEvent | React.MouseEvent, el: HTMLElement, whole: boolean) => {
    const r = el.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return whole ? f * total : liveStart() + f * span;
  };

  /** The left cue of the cut under the pointer, when cuts can be dragged. */
  const cutUnder = (e: React.PointerEvent, el: HTMLElement): string | number | null => {
    if (!onDragCut) return null;
    const r = el.getBoundingClientRect();
    const vs = liveStart();
    for (let i = 0; i < segments.length - 1; i++) {
      const a = segments[i];
      const b = segments[i + 1];
      if (b.startTime - a.endTime >= CUT_GAP_SECONDS) continue;
      const cx = r.left + (((a.endTime + b.startTime) / 2 - vs) / span) * r.width;
      if (Math.abs(e.clientX - cx) <= CUT_GRAB_PX) return a.id;
    }
    return null;
  };

  const onWavePointer = (e: React.PointerEvent<HTMLDivElement>, kind: 'down' | 'move' | 'up') => {
    const el = e.currentTarget;
    const t = timeAt(e, el, false);
    if (dragRef.current === 'cut' && cutDragRef.current !== null) {
      if (kind === 'up') {
        dragRef.current = null;
        onDragCut?.(cutDragRef.current, t, 'end');
        cutDragRef.current = null;
      } else if (kind === 'move') onDragCut?.(cutDragRef.current, t, 'move');
      return;
    }
    const cut = kind === 'up' ? null : cutUnder(e, el);
    el.style.cursor = cut !== null ? 'ew-resize' : '';
    if (kind === 'down' && cut !== null) {
      dragRef.current = 'cut';
      cutDragRef.current = cut;
      el.setPointerCapture(e.pointerId);
      onDragCut?.(cut, t, 'start');
      return;
    }
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

  /** Double-click a line on the dub lane: zoom until it fills most of the view. */
  const zoomToBox = (e: React.MouseEvent<HTMLDivElement>) => {
    const lane = e.currentTarget;
    let box = e.target as HTMLElement | null;
    // A line is a child of the lane's track (the drawn stretch that slides), not of the lane.
    while (box && box !== lane && !box.parentElement?.hasAttribute('data-track')) box = box.parentElement;
    if (!box || box === lane || total <= 0) return;
    const r = lane.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const vs = liveStart();
    const from = vs + ((b.left - r.left) / r.width) * span;
    const to = vs + ((b.right - r.left) / r.width) * span;
    const want = Math.max(0.5, (to - from) * 1.5);
    const nz = [...ZOOMS].reverse().find((z) => total / z >= want) ?? 1;
    const ns = total / nz;
    setFollow(false);
    setZoom(nz);
    setViewStart(Math.max(0, Math.min(Math.max(0, total - ns), (from + to) / 2 - ns / 2)));
  };

  /** The timeline's scroll bar: drag the thumb, or press the track to bring that part into view. */
  const thumbGrabRef = useRef<number | null>(null);
  const onScrollbarPointer = (e: React.PointerEvent<HTMLDivElement>, kind: 'down' | 'move' | 'up') => {
    if (total <= 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * total;
    if (kind === 'down') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const vs = liveStart();
      // Grabbed on the thumb, it keeps the point grabbed under the pointer; on the track, it centres there.
      thumbGrabRef.current = t >= vs && t <= vs + span ? t - vs : span / 2;
    }
    if (kind === 'up') {
      thumbGrabRef.current = null;
      return;
    }
    if (thumbGrabRef.current === null || zoom === 1) return;
    setFollow(false);
    setViewStart(clampStart(t - thumbGrabRef.current));
  };

  /*
   * The ruler over the timeline: a click moves the playhead there, and a drag
   * scrubs it along, as DaVinci Resolve's timecode ruler does. It only moves
   * the playhead: no cue is picked and the view stays where it is.
   */
  const rulerDragRef = useRef(false);
  const onRulerPointer = (e: React.PointerEvent<HTMLDivElement>, kind: 'down' | 'move' | 'up') => {
    if (kind === 'down') {
      if (e.button !== 0) return;
      rulerDragRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // A pointer that is already gone: the click still moves the playhead.
      }
    }
    if (!rulerDragRef.current) return;
    if (kind === 'up') {
      rulerDragRef.current = false;
      return;
    }
    // Scrubbing by hand: the view doesn't run after the playhead meanwhile.
    if (kind === 'down' && zoom > 1) setFollow(false);
    seekTo(timeAt(e, e.currentTarget, false), false);
  };

  // The page's own scroll is stopped by the native listeners below: React's wheel listener is passive and can't.
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const el = e.currentTarget as HTMLElement;
      changeZoom(e.deltaY < 0 ? 1 : -1, timeAt(e, el, false));
    } else if (zoom > 1) {
      // Zoomed in, any wheel moves through time, as in a timeline editor: up/down, sideways or Shift + wheel.
      setFollow(false);
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      const lines = e.deltaMode === 1 ? 16 : 1;
      const width = (e.currentTarget as HTMLElement).clientWidth || 600;
      // A sideways swipe moves the timeline as far as the fingers went; a wheel's turn a sixth of the view.
      const seconds = sideways ? ((e.deltaX * lines) / width) * span : ((e.deltaY * lines) / 600) * span;
      // Eased over a few frames from where the last turn of the wheel was headed, so quick turns add up smoothly.
      const from = glideRef.current?.target ?? liveStart();
      glideTo(clampStart(from + seconds), span * 0.0002, sideways && e.deltaMode === 0 ? GLIDE_TRACKPAD : GLIDE);
    }
  };

  // Ctrl+wheel and a zoomed-in wheel must be cancellable, so they are bound without React's passive listener.
  const waveBoxRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<HTMLDivElement>(null);
  const pausesRef = useRef<HTMLDivElement>(null);
  const sourceRowRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const suggestRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = waveBoxRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => {
      // Showing the whole track, a plain wheel is the page's.
      if (e.ctrlKey || e.metaKey || zoom > 1) e.preventDefault();
    };
    el.addEventListener('wheel', stop, { passive: false });
    const rows = [rulerRef.current, sourceRowRef.current, laneRef.current, pausesRef.current, suggestRef.current, scrollbarRef.current].filter((row): row is HTMLDivElement => Boolean(row));
    rows.forEach((row) => row.addEventListener('wheel', stop, { passive: false }));
    return () => {
      el.removeEventListener('wheel', stop);
      rows.forEach((row) => row.removeEventListener('wheel', stop));
    };
  }, [zoom, Boolean(sourceRow), Boolean(belowWave), Boolean(pausesRow), Boolean(belowLane), layers.pauses]);

  // The hints close on a click outside them, or Esc.
  const helpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showHelp) return;
    const onDown = (e: PointerEvent) => {
      if (!helpRef.current?.contains(e.target as Node)) setShowHelp(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowHelp(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [showHelp]);

  // ---------- pieces ----------
  const vs = zoom === 1 ? 0 : viewStart;
  // The drawn stretch: the view and BUFFER_PAD views each side, slid by --track-shift while scrolling.
  const drawn = bufferOf(viewStart);
  const trackStyle: React.CSSProperties = {
    left: `${((drawn.from - vs) / span) * 100}%`,
    width: `${(drawn.span / span) * 100}%`,
    transform: 'translateX(var(--track-shift, 0px))',
  };
  const rulerStep = RULER_STEPS.find((s) => span / s <= 10) || 600;
  const ticks = ticksBetween(drawn.from, drawn.from + drawn.span, rulerStep);
  const tickPlaces = tickDecimals(rulerStep);

  const onView = zoom === 1 ? 'whole' : span < 1 ? `${Math.round(span * 1000)} ms` : `${span < 10 ? span.toFixed(1) : Math.round(span)} s`;
  const playheadOffView = zoom > 1 && (currentTime < vs || currentTime > vs + span);
  const activePace = activeCue ? paceOf(activeCue) : null;
  const paceClass =
    activePace?.level === 'fast' ? 'bg-rose-500/15 text-rose-300' : activePace?.level === 'tight' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300';

  const iconBtn = (pressed = false) =>
    `w-[30px] h-[30px] flex items-center justify-center rounded-lg border transition-colors cursor-default ${
      pressed
        ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300'
        : 'border-edge text-slate-400 hover:text-slate-100 hover:bg-slate-800'
    }`;
  const segBtn = (on: boolean) =>
    `flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
      on ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:text-slate-200'
    } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400 cursor-default`;
  const smallRoundBtn = 'w-[30px] h-[30px] rounded-full border border-edge text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center shrink-0 cursor-default';
  const stepBtn = 'w-7 h-7 rounded-full text-slate-400 hover:text-slate-100 hover:bg-slate-800 flex items-center justify-center shrink-0 cursor-default';

  const miniBtn =
    'w-7 h-7 shrink-0 flex items-center justify-center rounded-lg border border-edge text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-default';
  const playButton = (size: string) => (
    <button
      type="button"
      onClick={onTogglePlay}
      className={`${size} rounded-full bg-slate-100 hover:bg-white text-slate-950 flex items-center justify-center shrink-0 cursor-default`}
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
      className={`h-7 px-2.5 flex items-center gap-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-colors cursor-default ${
        loop ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300' : 'border-edge text-slate-400 hover:text-slate-200'
      }`}
    >
      <Repeat className="w-3.5 h-3.5" /> Loop cue
    </button>
  );

  const legend = lineSpans?.length ? (
    <>
      <span className="flex items-center gap-1.5">
        <span className="flex gap-px">
          {LINE_HUES.map((c) => (
            <span key={c} className="w-1.5 h-2 rounded-[1px]" style={{ background: c }} />
          ))}
        </span>
        Each line in its own colour, its dub below in the same
      </span>
      {belowWave && (
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded-full bg-rose-400" /> {fastLabel}
        </span>
      )}
    </>
  ) : (
    <>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-2 rounded-sm bg-cyan-400/20 border border-cyan-400/50" /> Cue
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-2 rounded-sm bg-[repeating-linear-gradient(135deg,rgb(51_65_85)_0_2px,transparent_2px_5px)]" /> Pause
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3 h-2 rounded-sm bg-rose-400/30" /> {fastLabel}
      </span>
      {belowWave && (
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-2 rounded-sm border border-dashed border-indigo-300 bg-indigo-300/15" /> {belowWaveLabel || 'Dub, est.'}
        </span>
      )}
    </>
  );
  const keyHints: [string[], string][] = [
    [['Space'], 'play / pause'],
    [['←', '→'], '5 s back / forward'],
    [[',', '.'], 'previous / next cue'],
    [['L'], 'loop cue'],
    [['+', '−'], 'zoom in / out'],
    [['F'], 'the whole track'],
  ];

  return (
    <>
      <section ref={sectionRef} aria-label="Playback" className="bg-slate-900/90 border border-edge rounded-2xl">
        {/* Top bar: the current cue, then how you listen and look */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3.5 py-2 border-b border-edge">
          <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
            <span className="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-300 whitespace-nowrap">
              {activeCue ? `Cue ${String(activeIndex + 1).padStart(2, '0')} of ${segments.length}` : `${segments.length} cues`}
            </span>
            {activeCue && (
              <span className="hidden sm:inline font-mono text-xs text-slate-400 whitespace-nowrap tabular-nums">
                {formatTime(activeCue.startTime)} – {formatTime(activeCue.endTime)}
              </span>
            )}
            {activeCue?.speaker && (
              <span className="hidden sm:inline text-[11px] uppercase tracking-wide font-semibold text-slate-500 truncate">{activeCue.speaker}</span>
            )}
            <span className="hidden xl:flex items-center gap-x-3 ml-1 text-[11px] text-slate-500 whitespace-nowrap">{legend}</span>
          </div>

          {layered && (
            <div role="group" aria-label="Show on the timeline" className="flex items-center gap-1">
              {LAYER_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={layers[chip.id]}
                  title={chip.hint}
                  onClick={() => toggleLayer(chip.id)}
                  className={`h-6 px-2.5 rounded-full border text-[11px] whitespace-nowrap cursor-default transition-colors ${
                    layers[chip.id] ? 'border-slate-500 bg-slate-800 text-slate-100' : 'border-edge text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
              {toolbarExtra}
            </div>
          )}

          {onPlaybackRateChange && (
            <div role="group" aria-label="Speed" className="flex p-0.5 gap-0.5 rounded-lg bg-slate-950/60 border border-edge">
              {RATES.map((r) => (
                <button key={r} type="button" aria-pressed={playbackRate === r} onClick={() => onPlaybackRateChange(r)} className={`${segBtn(playbackRate === r)} font-mono !py-0.5 !px-2`}>
                  {r}×
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1">
            <button type="button" onClick={() => changeZoom(-1)} disabled={zoom === 1} className={`${iconBtn()} disabled:opacity-40`} aria-label="Zoom out" title="Zoom out (−)">
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <input
              type="range"
              min={0}
              max={ZOOMS.length - 1}
              step={1}
              value={Math.max(0, ZOOMS.indexOf(zoom))}
              onChange={(e) => {
                const next = ZOOMS[Number(e.target.value)] ?? 1;
                const ns = total / next;
                setViewStart(Math.max(0, Math.min(Math.max(0, total - ns), liveRef.current - ns * 0.35)));
                setZoom(next);
              }}
              className="hidden md:block w-20 accent-indigo-500"
              aria-label="Zoom"
              title="Zoom (Ctrl + scroll over the timeline)"
            />
            <button type="button" onClick={() => changeZoom(1)} disabled={zoom === ZOOMS[ZOOMS.length - 1]} className={`${iconBtn()} disabled:opacity-40`} aria-label="Zoom in" title="Zoom in (+)">
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="w-14 text-center font-mono text-[11px] text-slate-400 tabular-nums" title="How much of the track is on view">
              {onView}
            </span>
            <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1} className={`${segBtn(false)} disabled:opacity-40`} title="Show the whole track (F)">
              Fit
            </button>
            <WaveHeightButton />
            <button
              type="button"
              onClick={() => {
                setFollow((v) => !v);
                if (!follow) setViewStart(clampStart(timeNow() - span * 0.25));
              }}
              aria-pressed={follow}
              className={iconBtn(follow)}
              aria-label="Follow playback"
              title="Keep the playhead in view while zoomed in"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
            {/* The keys, the mouse and the colours, out of the way until asked for */}
            <div ref={helpRef} className="relative">
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                aria-expanded={showHelp}
                aria-haspopup="dialog"
                className={iconBtn(showHelp)}
                aria-label="Keyboard and mouse hints"
                title="Hints"
              >
                <CircleHelp className="w-3.5 h-3.5" />
              </button>
              {showHelp && (
                <div
                  role="dialog"
                  aria-label="Hints"
                  className="absolute right-0 top-full mt-1.5 z-30 w-72 p-3 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60 text-[11.5px] text-slate-300 animate-in fade-in zoom-in-95 duration-100"
                >
                  <div className="grid gap-1.5">
                    {keyHints.map(([keys, label]) => (
                      <span key={label} className="flex items-center gap-1.5">
                        {keys.map((k) => (
                          <kbd key={k} className="font-mono text-[10px] px-1.5 rounded border border-slate-700 text-slate-400">
                            {k}
                          </kbd>
                        ))}
                        {label}
                      </span>
                    ))}
                  </div>
                  <div className="mt-2.5 pt-2.5 border-t border-edge grid gap-1 text-slate-400">
                    <span>Click to jump · drag to scrub</span>
                    {onDragCut && <span>Drag a cut between cues to move it</span>}
                    <span>Ctrl + scroll to zoom · scroll to move once zoomed in</span>
                    {belowWave && <span>Double-click a dub line to zoom to it · in Bars, to type its words in the bar (Enter saves, Esc puts it back)</span>}
                    {belowWave && <span>Drag a dub line to where it should be heard · point between two words and the knife shows: click (or S) cuts there, cyan dots are the original's pauses · double-click a cut to join · Backspace puts it back</span>}
                    <span>Drag the bar under the timeline to move along the track</span>
                  </div>
                  <div className="mt-2.5 pt-2.5 border-t border-edge flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {legend}
                    {belowWave && pausesRow && (
                      <>
                        <span className="flex items-center gap-1.5">
                          <span className="w-0 h-0 border-x-[4px] border-x-transparent border-t-[6px] border-t-cyan-300" /> The original pauses
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="w-0 h-0 border-x-[4px] border-x-transparent border-b-[7px] border-b-amber-400" /> The dub may pause where the original runs on
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/*
          The timeline: one lane on one clock. The original's waveform and cues
          on top, its pauses on the line between, the dub as Sync will place it
          below; then a plain scroll bar for the whole track.
        */}
        <div ref={timelineRef} className="px-3.5">
          <div
            ref={rulerRef}
            className="relative h-5 overflow-hidden font-mono text-[10px] text-slate-500 cursor-pointer touch-none select-none hover:bg-slate-800/40 rounded-md"
            title="Click or drag to move the playhead"
            onPointerDown={(e) => onRulerPointer(e, 'down')}
            onPointerMove={(e) => onRulerPointer(e, 'move')}
            onPointerUp={(e) => onRulerPointer(e, 'up')}
            onPointerCancel={(e) => onRulerPointer(e, 'up')}
            onWheel={onWheel}
          >
            <div className="absolute inset-y-0 will-change-transform" style={trackStyle}>
              {ticks.map((t) => (
                <span key={t} className="absolute top-1 -translate-x-1/2 tabular-nums pointer-events-none" style={{ left: `${((t - drawn.from) / drawn.span) * 100}%` }}>
                  {formatTime(t, rulerStep >= 1 ? false : tickPlaces)}
                </span>
              ))}
            </div>
          </div>
          <div className="relative rounded-[10px] bg-slate-950/60 overflow-hidden">
            <div
              ref={waveBoxRef}
              id="review-timeline"
              role="slider"
              tabIndex={0}
              aria-label="Waveform with cues and pauses"
              aria-valuemin={0}
              aria-valuemax={Math.round(total)}
              aria-valuenow={Math.round(currentTime)}
              aria-valuetext={formatTime(currentTime)}
              className={`relative ${belowWave ? 'h-14' : 'h-[72px]'} cursor-default touch-none`}
              onPointerDown={(e) => onWavePointer(e, 'down')}
              onPointerMove={(e) => onWavePointer(e, 'move')}
              onPointerUp={(e) => onWavePointer(e, 'up')}
              onPointerLeave={() => setHoverTime(null)}
              onWheel={onWheel}
            >
              <div className={`absolute inset-y-0 will-change-transform pointer-events-none ${sourceLane ? 'invisible' : ''}`} style={trackStyle}>
                <canvas ref={waveRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
                <canvas ref={wavePlayedRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
              </div>
              {sourceLane && (
                <div className="absolute inset-y-0 will-change-transform pointer-events-none" style={trackStyle}>
                  {sourceLane({ start: drawn.from, span: drawn.span, layers })}
                </div>
              )}
              {!audioBuffer && !sourceLane && (
                <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Reading the audio…</span>
              )}
              {hoverTime !== null && (
                <span
                  className="absolute z-30 top-1 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-950 font-mono text-[10.5px] pointer-events-none whitespace-nowrap"
                  style={{ left: `${((hoverTime - liveStart()) / span) * 100}%` }}
                >
                  {formatTime(hoverTime)}
                </span>
              )}
            </div>
            {sourceRow && (
              <div ref={sourceRowRef} className="relative h-14 border-t border-edge overflow-hidden cursor-default" onWheel={onWheel}>
                <div data-track="" className="absolute inset-y-0 will-change-transform pointer-events-none" style={trackStyle}>
                  {sourceRow({ start: drawn.from, span: drawn.span, layers })}
                </div>
              </div>
            )}
            {belowWave && pausesRow && (!layered || layers.pauses) && (
              <div ref={pausesRef} className="relative h-3.5 border-t border-edge overflow-hidden cursor-default" onWheel={onWheel}>
                <div data-track="" className="absolute inset-y-0 will-change-transform" style={trackStyle}>
                  {pausesRow({ start: drawn.from, span: drawn.span })}
                </div>
              </div>
            )}
            {belowWave && (
              <div
                ref={laneRef}
                className={`relative h-14 overflow-hidden cursor-default ${pausesRow ? '' : 'border-t border-edge'}`}
                onWheel={onWheel}
                onDoubleClick={zoomToBox}
              >
                <div data-track="" className="absolute inset-y-0 will-change-transform" style={trackStyle}>
                  {belowWave({ start: drawn.from, span: drawn.span, time: currentTime, layers })}
                </div>
              </div>
            )}
            {belowWave && belowLane && (
              <div ref={suggestRef} className="relative h-7 overflow-hidden cursor-default" onWheel={onWheel}>
                <div data-track="" className="absolute inset-y-0 will-change-transform" style={trackStyle}>
                  {belowLane({ start: drawn.from, span: drawn.span })}
                </div>
              </div>
            )}
            <div ref={waveHeadRef} className="absolute z-20 top-0 bottom-0 w-0.5 -ml-px pointer-events-none" style={{ background: palette.playhead }}>
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full" style={{ background: palette.playhead }} />
            </div>
            {!follow && playheadOffView && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setFollow(true);
                  setViewStart(clampStart(timeNow() - span * 0.25));
                }}
                className="absolute z-30 right-1.5 top-1.5 h-6 px-2 flex items-center gap-1 rounded-md border border-indigo-500/50 bg-indigo-950/90 text-[11px] text-indigo-200 cursor-default"
                title="Back to the playhead, and keep it in view"
              >
                <LocateFixed className="w-3 h-3" /> Playhead
              </button>
            )}
          </div>
          <div
            ref={scrollbarRef}
            role="scrollbar"
            aria-orientation="horizontal"
            aria-controls="review-timeline"
            aria-valuemin={0}
            aria-valuemax={Math.round(total)}
            aria-valuenow={Math.round(vs)}
            aria-label="Move along the track"
            className="group relative mt-1.5 h-4 rounded-full bg-slate-950/60 border border-edge/80 cursor-default touch-none"
            title={zoom === 1 ? 'The whole track is on view' : 'Drag to move along the track (or scroll over the timeline)'}
            onPointerDown={(e) => onScrollbarPointer(e, 'down')}
            onPointerMove={(e) => onScrollbarPointer(e, 'move')}
            onPointerUp={(e) => onScrollbarPointer(e, 'up')}
            onWheel={onWheel}
          >
            {total > 0 && (
              <>
                <span
                  ref={thumbRef}
                  className="absolute top-0.5 bottom-0.5 rounded-full bg-slate-600 group-hover:bg-slate-500 pointer-events-none"
                  style={{ left: `${(vs / total) * 100}%`, width: `${Math.max(2, (span / total) * 100)}%` }}
                />
                <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -bottom-0.5 w-0.5 -ml-px rounded-full bg-slate-100 pointer-events-none"
                  style={{ left: `${(Math.max(0, Math.min(total, currentTime)) / total) * 100}%` }}
                />
              </>
            )}
          </div>
        </div>

        {/* Transport and the live caption */}
        <div ref={transportRef} className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-3.5 py-2">
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={() => seekTo(timeNow() - 5, false)} className={stepBtn} aria-label="Back 5 seconds" title="Back 5 seconds (←)">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <button type="button" onClick={prevCue} className={smallRoundBtn} aria-label="Previous cue" title="Previous cue (,)">
              <SkipBack className="w-3 h-3 fill-current" />
            </button>
            {playButton('w-9 h-9')}
            <button type="button" onClick={nextCue} className={smallRoundBtn} aria-label="Next cue" title="Next cue (.)">
              <SkipForward className="w-3 h-3 fill-current" />
            </button>
            <button type="button" onClick={() => seekTo(timeNow() + 5, false)} className={stepBtn} aria-label="Forward 5 seconds" title="Forward 5 seconds (→)">
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          </div>
          {loopButton}
          <span className="font-mono text-[13px] text-slate-100 tabular-nums whitespace-nowrap">
            {formatTime(currentTime)} <span className="text-slate-500">/ {formatTime(total)}</span>
          </span>
          <div className="order-last md:order-none basis-full md:basis-auto flex-1 min-w-0 flex items-center gap-3 md:pl-1" aria-live="polite">
            {activeCue ? (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] leading-snug text-slate-100">{targetOf(activeCue) || <span className="text-slate-500">No {targetLanguage} line yet</span>}</span>
                  <span className="block text-[11.5px] leading-snug text-slate-400 truncate" title={sourceOf(activeCue)}>
                    {sourceOf(activeCue)}
                  </span>
                </span>
                {targetOf(activeCue) && <span className={`shrink-0 text-[10.5px] font-medium px-2 py-0.5 rounded-full ${paceClass}`}>{activePace?.label}</span>}
              </>
            ) : (
              <span className="text-xs text-slate-500">Press play to follow the cues line by line.</span>
            )}
          </div>
        </div>
      </section>

      {/*
        Mini player, once the full one has scrolled out of sight: one slim bar
        along the bottom of the window. The page keeps that much room below its
        content while it shows (see MINI_BAR_PX), so it never covers a cue.
      */}
      {showMini && (
        <div
          role="region"
          aria-label="Mini player"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-700 bg-slate-900/95 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-1"
          style={{ height: MINI_BAR_PX }}
        >
          <div className="h-full mx-auto flex items-center gap-2 px-3 sm:px-6">
            {playButton('w-7 h-7')}
            <button type="button" onClick={prevCue} className={miniBtn} aria-label="Previous cue" title="Previous cue (,)">
              <SkipBack className="w-3 h-3 fill-current" />
            </button>
            <button type="button" onClick={nextCue} className={miniBtn} aria-label="Next cue" title="Next cue (.)">
              <SkipForward className="w-3 h-3 fill-current" />
            </button>
            <span className="shrink-0 font-mono text-[11.5px] text-slate-100 tabular-nums whitespace-nowrap">
              {activeCue ? `Cue ${String(activeIndex + 1).padStart(2, '0')}` : 'Playback'}
              <span className="text-slate-500"> · {formatTime(currentTime, false)} / {formatTime(total, false)}</span>
            </span>
            <div
              className="relative flex-1 min-w-0 h-5 rounded-md bg-slate-950/60 overflow-hidden cursor-default"
              onPointerDown={(e) => seekTo(timeAt(e, e.currentTarget, true))}
              title={activeCue ? targetOf(activeCue) || sourceOf(activeCue) : undefined}
            >
              <canvas ref={miniRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
              <canvas ref={miniPlayedRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
              <div ref={miniHeadRef} className="absolute top-0 bottom-0 w-0.5 -ml-px pointer-events-none" style={{ background: palette.playhead }} />
            </div>
            <button
              type="button"
              onClick={() => sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className={miniBtn}
              aria-label="Back to the full player"
              title="Back to the full player"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};
