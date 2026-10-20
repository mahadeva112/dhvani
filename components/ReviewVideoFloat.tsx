import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronsLeft, ChevronsRight, GripHorizontal, MoreHorizontal, Pause, Play, Video, VolumeX, X } from 'lucide-react';
import { ReviewPicture, type ReviewClock, type ReviewVideo } from './ReviewVideoPanel';
import { useLiveTime } from './useLiveTime';

type Box = { x: number; y: number; w: number; h: number };
type Saved = Box & { compact: boolean; fill: boolean };

const KEY = 'dhvani.reviewVideo.float';
const MARGIN = 8;
const MIN_W = 200;
const MIN_H = 180;
/** How close to a corner of the window a dropped player has to be to settle into it. */
const SNAP = 90;
const SIZES = { Small: [240, 280], Medium: [320, 380], Large: [460, 520] } as const;
type Edge = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';
const HANDLES: { edge: Edge; className: string }[] = [
  { edge: 'n', className: '-top-1 left-3 right-3 h-2 cursor-ns-resize' },
  { edge: 's', className: '-bottom-1 left-3 right-3 h-2 cursor-ns-resize' },
  { edge: 'w', className: '-left-1 top-3 bottom-3 w-2 cursor-ew-resize' },
  { edge: 'e', className: '-right-1 top-3 bottom-3 w-2 cursor-ew-resize' },
  { edge: 'nw', className: '-top-1 -left-1 w-3.5 h-3.5 cursor-nwse-resize' },
  { edge: 'ne', className: '-top-1 -right-1 w-3.5 h-3.5 cursor-nesw-resize' },
  { edge: 'sw', className: '-bottom-1 -left-1 w-3.5 h-3.5 cursor-nesw-resize' },
  { edge: 'se', className: '-bottom-1 -right-1 w-3.5 h-3.5 cursor-nwse-resize' },
];

const formatClock = (t: number) => {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
};

/** The box moved and shrunk so all of it is on screen. */
const clampBox = (b: Box): Box => {
  const w = Math.max(MIN_W, Math.min(b.w, window.innerWidth - 2 * MARGIN));
  const h = Math.max(MIN_H, Math.min(b.h, window.innerHeight - 2 * MARGIN));
  return {
    w,
    h,
    x: Math.max(MARGIN, Math.min(b.x, window.innerWidth - w - MARGIN)),
    y: Math.max(MARGIN, Math.min(b.y, window.innerHeight - h - MARGIN)),
  };
};

const readSaved = (): Saved => {
  const [w, h] = SIZES.Medium;
  const fallback = { x: window.innerWidth - w - 24, y: 96, w, h, compact: false, fill: false };
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && [s.x, s.y, s.w, s.h].every(Number.isFinite) ? { ...fallback, ...s, ...clampBox(s) } : fallback;
  } catch {
    return fallback;
  }
};

/**
 * The review video as a window over the page, like a video editor's video
 * window: moved by its title bar (settling into a corner when dropped near
 * one), sized from any edge or corner, and kept where it was left. The box
 * has any shape; a reel or a wide video fits inside it whole, with black
 * bars, or fills it. It plays nothing itself: its buttons drive the player.
 */
export const ReviewVideoFloat: React.FC<
  ReviewClock & {
    video: ReviewVideo;
    onTogglePlay: () => void;
    onPrevLine: () => void;
    onNextLine: () => void;
    trackMode: 'source' | 'synth' | 'both';
    onTrackMode: (mode: 'source' | 'synth' | 'both') => void;
    onReplace: () => void;
    onRemove: () => void;
    /** Hides the window; the video stays picked. */
    onHide: () => void;
  }
> = ({ video, onTogglePlay, onPrevLine, onNextLine, trackMode, onTrackMode, onReplace, onRemove, onHide, ...clock }) => {
  const [saved, setSaved] = useState<Saved>(readSaved);
  const [snapTo, setSnapTo] = useState<Box | null>(null);
  const [sizing, setSizing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const live = useRef(saved);
  live.current = saved;
  const time = useLiveTime(clock.currentTime, clock.isPlaying, clock.getLiveTime, 0.1);

  const update = (next: Partial<Saved>, keep = true) => {
    const merged = { ...live.current, ...next };
    live.current = merged;
    setSaved(merged);
    if (!keep) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      /* Where it was left is a convenience; it just isn't kept. */
    }
  };

  useLayoutEffect(() => {
    const onResize = () => update(clampBox(live.current), false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => setAspect(null), [video.url]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const drag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const dx = e.clientX - live.current.x;
    const dy = e.clientY - live.current.y;
    let corner: Box | null = null;
    const move = (ev: PointerEvent) => {
      const b = clampBox({ ...live.current, x: ev.clientX - dx, y: ev.clientY - dy });
      update(b, false);
      const { w, h } = b;
      const corners = [
        { x: 16, y: 16 },
        { x: window.innerWidth - w - 16, y: 16 },
        { x: 16, y: window.innerHeight - h - 16 },
        { x: window.innerWidth - w - 16, y: window.innerHeight - h - 16 },
      ];
      const near = corners.find((c) => Math.hypot(c.x - b.x, c.y - b.y) < SNAP);
      corner = near ? { ...near, w, h } : null;
      setSnapTo(corner);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSnapTo(null);
      update(corner ? { x: corner.x, y: corner.y } : {});
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** Any edge or corner: the opposite side stays where it is. */
  const resize = (edge: Edge) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const start = { ...live.current };
    const x0 = e.clientX;
    const y0 = e.clientY;
    setSizing(true);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      let { x, y, w, h } = start;
      if (edge.includes('e')) w = Math.min(window.innerWidth - start.x - MARGIN, start.w + dx);
      if (edge.includes('s')) h = Math.min(window.innerHeight - start.y - MARGIN, start.h + dy);
      if (edge.includes('w')) {
        x = Math.max(MARGIN, Math.min(start.x + start.w - MIN_W, start.x + dx));
        w = start.x + start.w - x;
      }
      if (edge.includes('n')) {
        y = Math.max(MARGIN, Math.min(start.y + start.h - MIN_H, start.y + dy));
        h = start.y + start.h - y;
      }
      update({ x, y, w: Math.max(MIN_W, Math.round(w)), h: Math.max(MIN_H, Math.round(h)) }, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSizing(false);
      update({});
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** The box made the picture's shape at its current width: no bars. */
  const fitToPicture = () => {
    if (!aspect) return;
    const chrome = saved.compact ? 36 : 36 + 40;
    update(clampBox({ ...saved, h: Math.round(saved.w / aspect + chrome) }));
  };

  /** Clicks on its buttons leave the keyboard to the page, so Space still plays. */
  const press = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    fn();
  };
  const menuItem = 'w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-800 text-slate-200 cursor-default';

  return (
    <>
      {snapTo && (
        <div
          aria-hidden="true"
          className="fixed z-40 rounded-xl border-2 border-dashed border-indigo-400/70 bg-indigo-500/10 pointer-events-none"
          style={{ left: snapTo.x, top: snapTo.y, width: snapTo.w, height: snapTo.h }}
        />
      )}
      <section
        aria-label="Review video"
        className="fixed z-50 flex flex-col rounded-xl border border-slate-600 bg-slate-950 shadow-2xl shadow-black/60 select-none"
        style={{ left: saved.x, top: saved.y, width: saved.w, height: saved.h }}
      >
        <div
          onPointerDown={drag}
          onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && update({ compact: !saved.compact })}
          title="Drag to move · double-click for the video only"
          className="flex items-center gap-1.5 pl-2.5 pr-1.5 h-9 shrink-0 rounded-t-xl border-b border-slate-800 bg-slate-900 cursor-default touch-none"
        >
          <GripHorizontal className="w-4 h-4 shrink-0 text-slate-500" aria-hidden="true" />
          <Video className="w-3.5 h-3.5 shrink-0 text-slate-400" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-100" title={video.name}>
            {video.name}
          </span>
          <span title="The video is always silent; you hear what Listen to picks">
            <VolumeX className="w-3.5 h-3.5 shrink-0 text-slate-500" aria-label="Muted" />
          </span>
          <div ref={menuRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="More"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-default"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 top-8 z-10 w-48 rounded-lg border border-slate-700 bg-slate-900 p-1 text-[12px] shadow-xl shadow-black/50">
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); onReplace(); }}>
                  Replace video…
                </button>
                <div className="my-1 border-t border-slate-800" />
                {(Object.keys(SIZES) as (keyof typeof SIZES)[]).map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="menuitem"
                    className={menuItem}
                    onClick={() => { setMenuOpen(false); update(clampBox({ ...saved, w: SIZES[name][0], h: SIZES[name][1] })); }}
                  >
                    {name}
                  </button>
                ))}
                <button type="button" role="menuitem" className={menuItem} disabled={!aspect} onClick={() => { setMenuOpen(false); fitToPicture(); }}>
                  Fit the box to the video
                </button>
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); update({ fill: !saved.fill }); }}>
                  {saved.fill ? 'Show the whole picture' : 'Fill the box (crops)'}
                </button>
                <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); update({ compact: !saved.compact }); }}>
                  {saved.compact ? 'Show the controls' : 'Video only'}
                </button>
                <div className="my-1 border-t border-slate-800" />
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-800 text-rose-300 cursor-default"
                  onClick={() => { setMenuOpen(false); onRemove(); }}
                >
                  Remove video
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onHide}
            title="Hide (Show video brings it back)"
            aria-label="Hide the video"
            className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-default"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <ReviewPicture
          video={video}
          {...clock}
          fit={saved.fill ? 'cover' : 'contain'}
          onAspect={setAspect}
          className={`flex-1 min-h-0 ${saved.compact ? 'rounded-b-xl' : ''}`}
        />
        {!saved.compact && (
          <div className="flex items-center gap-1.5 px-2 h-10 shrink-0 border-t border-slate-800">
            <button type="button" onClick={press(onPrevLine)} aria-label="Previous line" className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-default">
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={press(onTogglePlay)}
              aria-label={clock.isPlaying ? 'Pause' : 'Play'}
              className="w-7 h-7 rounded-full bg-slate-100 hover:bg-white text-slate-950 flex items-center justify-center cursor-default"
            >
              {clock.isPlaying ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
            </button>
            <button type="button" onClick={press(onNextLine)} aria-label="Next line" className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-default">
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] text-slate-200 tabular-nums">{formatClock(time)}</span>
            <div role="group" aria-label="Listen to" className="ml-auto flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 gap-0.5 text-[10.5px]">
              {([
                ['source', 'Orig'],
                ['synth', 'Dub'],
                ['both', 'Both'],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={trackMode === mode}
                  onClick={press(() => onTrackMode(mode))}
                  className={`px-1.5 py-0.5 rounded-md cursor-default ${trackMode === mode ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {HANDLES.map(({ edge, className }) => (
          <div key={edge} aria-hidden="true" onPointerDown={resize(edge)} className={`absolute touch-none ${className}`} />
        ))}
        {sizing && (
          <span className="absolute left-1/2 top-12 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-200 pointer-events-none">
            {saved.w} × {saved.h}
          </span>
        )}
      </section>
    </>
  );
};
