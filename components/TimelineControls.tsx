import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react';
import { useLiveFrame } from './useLiveTime';

/**
 * Controls for the sync timelines (the preview's and the report's): zoom and
 * a time ruler above, a scroll bar over the whole dub, and play / pause with
 * the clock.
 */

const formatClock = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The closest zoom: seconds of the timeline shown at once. */
const MIN_WINDOW_SECONDS = 4;
/** Each zoom button press shows this much less, or more, of the timeline. */
const ZOOM_STEP = 2;
/** Ruler steps, in seconds; the finest that keeps the labels apart is used. */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];
const MAX_TICKS = 8;
/** Gliding, the playhead stops this far across the window and the timeline moves under it. */
const GLIDE_ANCHOR = 0.4;
/** Gliding, this many windows are drawn past the right edge, so the timeline moves that far before it is drawn again. */
const GLIDE_AHEAD = 1;

export type TimelineZoom = ReturnType<typeof useTimelineZoom>;

/**
 * The part of a timeline on screen. It opens on the whole of `total`; zooming
 * in (the buttons, or Ctrl + wheel or a pinch over `lanesRef`) shows a window
 * of it, which follows playback while `follow` is on.
 * With `wheelScrollsTime`, a plain up/down wheel over the lanes moves a zoomed
 * window through time instead of scrolling the page.
 *
 * With `glide`, following playback moves the timeline smoothly under a
 * playhead that stops at GLIDE_ANCHOR, as a DAW does, instead of paging.
 * The window is drawn `ahead` seconds wider than it shows, inside elements
 * given the `strip` ref, and only those are moved, on the GPU, each frame;
 * the timeline is drawn again only once it has moved that far.
 */
export const useTimelineZoom = (total: number, currentTime: number, { wheelScrollsTime = false, glide = false } = {}) => {
  const fullSpan = Math.max(MIN_WINDOW_SECONDS, total);
  // Seconds on screen; null is the whole timeline.
  const [zoomSpan, setZoomSpan] = useState<number | null>(null);
  const windowSeconds = zoomSpan === null ? fullSpan : Math.min(zoomSpan, fullSpan);
  const maxStart = Math.max(0, total - windowSeconds);
  const [rawStart, setRawStart] = useState(0);
  // Where the drawn window starts; while gliding, what is on screen may have moved on from it.
  const windowStart = clamp(rawStart, 0, maxStart);
  const [follow, setFollow] = useState(true);
  const ahead = glide && windowSeconds < fullSpan ? windowSeconds * GLIDE_AHEAD : 0;

  // What is on screen starts here: windowStart, or further on while gliding.
  const view = useRef(windowStart);
  const strips = useRef(new Set<HTMLElement | SVGElement>());
  const paint = () => {
    const moved = ((view.current - windowStart) / windowSeconds) * 100;
    const transform = Math.abs(moved) < 1e-4 ? '' : `translate3d(${-moved}%, 0, 0)`;
    strips.current.forEach((el) => {
      if (el.style.transform !== transform) el.style.transform = transform;
    });
  };
  /** For each element drawn in window time that moves while gliding: it must be as wide as the window. */
  const strip = useCallback((el: HTMLElement | SVGElement | null) => {
    if (!el) return;
    strips.current.add(el);
    return () => {
      strips.current.delete(el);
    };
  }, []);
  // Drawn again: what is on screen is what was drawn.
  useLayoutEffect(() => {
    view.current = windowStart;
  }, [windowStart, windowSeconds]);
  useLayoutEffect(paint);
  /** Where what is on screen starts: for turning a pointer into a time, and for a scroll bar or clock read as the playback clock re-renders. */
  const viewStart = () => view.current;

  /**
   * Moves what is on screen with playback at `time` while `on`, and returns
   * where it starts. The playhead walks to GLIDE_ANCHOR, then the timeline
   * moves under it; once that passes what is drawn, it is drawn again there.
   * Off, a glide left part way is drawn where it stopped.
   */
  const glideTo = (time: number, on: boolean) => {
    let start = view.current;
    if (on) {
      const anchor = GLIDE_ANCHOR * windowSeconds;
      if (time < start || time > start + windowSeconds || time - start > anchor) start = clamp(time - anchor, 0, maxStart);
      view.current = start;
      const moved = start - windowStart;
      if (moved < 0 || moved > ahead * 0.75) setRawStart(start);
    } else if (Math.abs(start - windowStart) > 1e-6) {
      setRawStart(start);
    }
    paint();
    return start;
  };

  /** Shows `span` seconds, keeping `anchor` (a time) at `at` (0-1 across the lanes). */
  const zoomTo = (span: number, anchor: number, at: number) => {
    const next = clamp(span, MIN_WINDOW_SECONDS, fullSpan);
    if (next >= fullSpan - 1e-6) {
      setZoomSpan(null);
      setRawStart(0);
      return;
    }
    setZoomSpan(next);
    setRawStart(clamp(anchor - at * next, 0, total - next));
  };
  // The buttons zoom about the playhead when it is on screen, else the middle.
  const zoomBy = (factor: number) => {
    const start = view.current;
    const onScreen = currentTime >= start && currentTime <= start + windowSeconds;
    const anchor = onScreen ? currentTime : start + windowSeconds / 2;
    zoomTo(windowSeconds * factor, anchor, (anchor - start) / windowSeconds);
  };
  const fitAll = () => {
    setZoomSpan(null);
    setRawStart(0);
  };
  // Scrolling by hand stops the window following playback until play is pressed or a lane clicked.
  const scrollTo = (start: number) => {
    setFollow(false);
    setRawStart(clamp(start, 0, maxStart));
  };
  /** Pages the window to `time` while following playback. */
  const followTo = (time: number) => setRawStart(clamp(time - windowSeconds * (glide ? GLIDE_ANCHOR : 1 / 15), 0, maxStart));

  // Ctrl + wheel (and a trackpad pinch, which arrives as one) zooms about the
  // pointer. Listened for natively: React's wheel listener is passive, so it
  // can't keep the browser from zooming the page.
  const lanesRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const wheelZoom = useRef<(e: WheelEvent) => void>(() => {});
  wheelZoom.current = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      // Shift + wheel and sideways swipes are wheelScroll's; the whole timeline on screen has nowhere to go.
      if (!wheelScrollsTime || e.shiftKey || maxStart <= 0 || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const width = lanesRef.current?.getBoundingClientRect().width;
      if (!width) return;
      e.preventDefault();
      const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? width : 1;
      scrollTo(view.current + ((e.deltaY * lines) / width) * windowSeconds);
      return;
    }
    const r = rulerRef.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    e.preventDefault();
    const at = clamp((e.clientX - r.left) / r.width, 0, 1);
    setFollow(false);
    zoomTo(windowSeconds * Math.exp(e.deltaY * 0.0025), view.current + at * windowSeconds, at);
  };
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const listener = (e: WheelEvent) => wheelZoom.current(e);
    el.addEventListener('wheel', listener, { passive: false });
    return () => el.removeEventListener('wheel', listener);
  }, []);

  return {
    windowStart,
    windowSeconds,
    ahead,
    viewStart,
    strip,
    glideTo: glide ? glideTo : undefined,
    zoomed: zoomSpan !== null && windowSeconds < fullSpan,
    canZoomIn: windowSeconds > MIN_WINDOW_SECONDS + 1e-6,
    follow,
    setFollow,
    scrollTo,
    followTo,
    zoomTo,
    zoomBy,
    fitAll,
    lanesRef,
    rulerRef,
  };
};

const ZOOM_BUTTON =
  'h-7 min-w-7 px-1.5 rounded-md flex items-center justify-center gap-1.5 text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-35 disabled:hover:bg-transparent disabled:cursor-default cursor-pointer';

/** Zoom in / out and back to the whole timeline, with how else to zoom. */
export const TimelineZoomControls: React.FC<{ zoom: TimelineZoom }> = ({ zoom }) => (
  <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px] text-slate-500">
    <span className="hidden sm:inline">Ctrl + scroll to zoom</span>
    <div className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-950/60 p-0.5" role="group" aria-label="Zoom">
      <button type="button" className={ZOOM_BUTTON} onClick={() => zoom.zoomBy(1 / ZOOM_STEP)} disabled={!zoom.canZoomIn} aria-label="Zoom in" title="Zoom in">
        <ZoomIn className="w-4 h-4" />
      </button>
      <button type="button" className={ZOOM_BUTTON} onClick={() => zoom.zoomBy(ZOOM_STEP)} disabled={!zoom.zoomed} aria-label="Zoom out" title="Zoom out">
        <ZoomOut className="w-4 h-4" />
      </button>
      <button type="button" className={ZOOM_BUTTON} onClick={zoom.fitAll} disabled={!zoom.zoomed} title="Show the whole track">
        <Maximize2 className="w-3.5 h-3.5" /> Whole track
      </button>
    </div>
  </div>
);

/**
 * Times across the window on screen. As in DaVinci Resolve, a click puts the
 * playhead there and a drag scrubs it along; the window holds still meanwhile
 * and follows playback again when the drag ends.
 */
export const TimelineRuler: React.FC<{ zoom: TimelineZoom; onSeek: (time: number) => void }> = ({ zoom, onSeek }) => {
  const { windowStart, windowSeconds, ahead, rulerRef } = zoom;
  const scrubbing = useRef(false);
  const pct = (t: number) => ((t - windowStart) / windowSeconds) * 100;
  const timeAt = (clientX: number) => {
    const r = rulerRef.current!.getBoundingClientRect();
    return zoom.viewStart() + clamp((clientX - r.left) / r.width, 0, 1) * windowSeconds;
  };
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    scrubbing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    zoom.setFollow(false);
    onSeek(timeAt(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) onSeek(timeAt(e.clientX));
  };
  const endScrub = () => {
    if (!scrubbing.current) return;
    scrubbing.current = false;
    zoom.setFollow(true);
  };

  const step = TICK_STEPS.find((s) => windowSeconds / s <= MAX_TICKS) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.ceil(windowStart / step) * step; t <= windowStart + windowSeconds + ahead + 1e-6; t += step) ticks.push(t);

  return (
    <div
      ref={rulerRef}
      className="relative h-4 font-mono text-[10px] text-slate-500 tabular-nums cursor-default select-none touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      title="Click to put the playhead here; drag to scrub"
    >
      <div ref={zoom.strip} className="absolute inset-0 pointer-events-none">
        {ticks.map((t) => (
          <span key={t} aria-hidden="true" className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${pct(t)}%` }}>
            {formatClock(t).replace(/\.0$/, '')}
          </span>
        ))}
      </div>
    </div>
  );
};

/**
 * Playheads for a timeline that shows `windowSeconds` from `windowStart`.
 * They move every frame through refs, so each is on the painted frame and
 * nothing re-renders to move it; following playback, the window pages
 * forward the frame the playhead leaves it, or with `glideTo` moves along
 * under it. Returns a ref for each playhead.
 */
export const useWindowPlayheads = ({
  reportedTime,
  isPlaying,
  getLiveTime,
  windowStart,
  windowSeconds,
  follow,
  onFollow,
  glideTo,
  hidden = false,
}: {
  reportedTime: number;
  isPlaying: boolean;
  getLiveTime?: () => number | null;
  windowStart: number;
  windowSeconds: number;
  follow: boolean;
  /** Called with the position when following playback and it has left the window. */
  onFollow: (time: number) => void;
  /** The zoom's `glideTo`: following playback, the timeline moves under the playhead instead of paging. */
  glideTo?: (time: number, on: boolean) => number;
  /** Hides the playheads: the position being heard is not on this timeline's clock. */
  hidden?: boolean;
}) => {
  const heads = useRef<(HTMLElement | null)[]>([]);
  const live = useRef(reportedTime);
  const apply = (t: number) => {
    live.current = t;
    const gliding = !hidden && follow && isPlaying;
    const start = glideTo ? glideTo(t, gliding) : windowStart;
    const f = (t - start) / windowSeconds;
    heads.current.forEach((el) => {
      if (!el) return;
      el.style.display = !hidden && f >= 0 && f <= 1 ? '' : 'none';
      el.style.left = `${f * 100}%`;
    });
    if (!hidden && follow && !(glideTo && gliding) && (t < start || t > start + windowSeconds)) onFollow(t);
  };
  useLiveFrame(reportedTime, isPlaying, getLiveTime, apply);
  // Scrolling the window moves where the position falls in it.
  useLayoutEffect(() => {
    apply(live.current);
  });
  return (index: number) => (el: HTMLElement | null) => {
    heads.current[index] = el;
  };
};

export interface TimelineMarker {
  time: number;
  /** 'warn' for a line to look at (amber), 'soft' for a tight one. */
  tone: 'warn' | 'soft';
}

/**
 * A horizontal scroll bar for a timeline that shows `windowSeconds` of
 * `total` at once. The thumb is the window on screen: drag it, click the
 * track to jump there, or use the arrow, Page and Home / End keys. The track
 * doubles as an overview, with a tick for every flagged line and the
 * playhead, so the lines to look at can be found without paging.
 */
export const TimelineScrollbar: React.FC<{
  total: number;
  windowStart: number;
  windowSeconds: number;
  currentTime: number;
  markers?: TimelineMarker[];
  onScroll: (start: number) => void;
}> = ({ total, windowStart, windowSeconds, currentTime, markers = [], onScroll }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);
  const maxStart = Math.max(0, total - windowSeconds);
  if (total <= windowSeconds) return null;

  const pct = (t: number) => (t / total) * 100;
  const timeAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return clamp((clientX - r.left) / r.width, 0, 1) * total;
  };
  const scrollTo = (start: number) => onScroll(clamp(start, 0, maxStart));

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = timeAt(e.clientX);
    const onThumb = t >= windowStart && t <= windowStart + windowSeconds;
    // On the thumb it moves with the pointer; elsewhere the window centres on the click first.
    drag.current = onThumb ? t - windowStart : windowSeconds / 2;
    if (!onThumb) scrollTo(t - windowSeconds / 2);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current === null) return;
    scrollTo(timeAt(e.clientX) - drag.current);
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === 'ArrowLeft' ? -windowSeconds * 0.25
      : e.key === 'ArrowRight' ? windowSeconds * 0.25
      : e.key === 'PageUp' ? -windowSeconds * 0.8
      : e.key === 'PageDown' ? windowSeconds * 0.8
      : null;
    if (step !== null) scrollTo(windowStart + step);
    else if (e.key === 'Home') scrollTo(0);
    else if (e.key === 'End') scrollTo(maxStart);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-label="Timeline position"
      aria-orientation="horizontal"
      aria-controls={undefined}
      aria-valuemin={0}
      aria-valuemax={Math.round(maxStart)}
      aria-valuenow={Math.round(windowStart)}
      aria-valuetext={`${formatClock(windowStart)} to ${formatClock(windowStart + windowSeconds)} of ${formatClock(total)}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className="group relative h-3.5 rounded-full bg-slate-950/80 border border-slate-800 cursor-default touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
    >
      {markers.map((m, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`absolute top-0.5 bottom-0.5 w-0.5 rounded-full pointer-events-none ${m.tone === 'warn' ? 'bg-amber-400' : 'bg-amber-200/40'}`}
          style={{ left: `${pct(m.time)}%` }}
        />
      ))}
      <span
        aria-hidden="true"
        className="absolute -top-px -bottom-px rounded-full border border-slate-400/70 bg-slate-400/25 group-hover:bg-slate-400/35"
        style={{ left: `${pct(windowStart)}%`, width: `${Math.max(2, pct(windowSeconds))}%` }}
      />
      <span
        aria-hidden="true"
        className="absolute -top-1 -bottom-1 w-0.5 rounded-full bg-slate-100 pointer-events-none"
        style={{ left: `${pct(clamp(currentTime, 0, total))}%` }}
      />
    </div>
  );
};

/** Play / pause for the timeline, with where playback is and the window on screen. */
export const TimelineTransport: React.FC<{
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentTime: number;
  total: number;
  windowStart: number;
  windowSeconds: number;
  /** The legend, shown at the right. */
  children?: React.ReactNode;
}> = ({ isPlaying, onTogglePlay, currentTime, total, windowStart, windowSeconds, children }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-slate-500">
    <button
      type="button"
      onClick={onTogglePlay}
      aria-label={isPlaying ? 'Pause' : 'Play'}
      className="w-8 h-8 shrink-0 rounded-full bg-slate-100 hover:bg-white text-slate-950 flex items-center justify-center cursor-pointer active:translate-y-px"
    >
      {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
    </button>
    <span className="font-mono text-[12px] text-slate-200 tabular-nums">
      {formatClock(currentTime)} <span className="text-slate-500">/ {formatClock(total)}</span>
    </span>
    <span className="font-mono tabular-nums text-slate-500" title="The part of the timeline on screen">
      Showing {formatClock(windowStart)} – {formatClock(Math.min(windowStart + windowSeconds, total))}
    </span>
    {children && <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">{children}</span>}
  </div>
);

/**
 * Horizontal wheel or trackpad swipe over a lane scrolls the timeline.
 * Vertical wheel is left to the page.
 */
export const wheelScroll = (windowSeconds: number, scrollBy: (seconds: number) => void) => (e: React.WheelEvent<HTMLDivElement>) => {
  const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
  if (Math.abs(dx) < 1 || (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY))) return;
  const width = e.currentTarget.getBoundingClientRect().width || 1;
  scrollBy((dx / width) * windowSeconds);
};
