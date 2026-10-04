import React, { useLayoutEffect, useRef } from 'react';
import { Pause, Play } from 'lucide-react';
import { useLiveFrame } from './useLiveTime';

/**
 * Controls under the sync timelines (the preview's and the report's): a
 * scroll bar over the whole dub, and play / pause with the clock.
 */

const formatClock = (seconds: number) => {
  const t = Math.max(0, seconds || 0);
  const m = Math.floor(t / 60);
  const s = (t % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s}`;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Playheads for a timeline that shows `windowSeconds` from `windowStart`.
 * They move every frame through refs, so each is on the painted frame and
 * nothing re-renders to move it; following playback, the window pages
 * forward the frame the playhead leaves it. Returns a ref for each playhead.
 */
export const useWindowPlayheads = ({
  reportedTime,
  isPlaying,
  getLiveTime,
  windowStart,
  windowSeconds,
  follow,
  onFollow,
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
  /** Hides the playheads: the position being heard is not on this timeline's clock. */
  hidden?: boolean;
}) => {
  const heads = useRef<(HTMLElement | null)[]>([]);
  const live = useRef(reportedTime);
  const apply = (t: number) => {
    live.current = t;
    const f = (t - windowStart) / windowSeconds;
    heads.current.forEach((el) => {
      if (!el) return;
      el.style.display = !hidden && f >= 0 && f <= 1 ? '' : 'none';
      el.style.left = `${f * 100}%`;
    });
    if (!hidden && follow && (t < windowStart || t > windowStart + windowSeconds)) onFollow(t);
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
      className="group relative h-3.5 rounded-full bg-slate-950/80 border border-slate-800 cursor-pointer touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
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
        className="absolute -top-px -bottom-px rounded-full border border-slate-400/70 bg-slate-400/25 group-hover:bg-slate-400/35 cursor-grab active:cursor-grabbing"
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
