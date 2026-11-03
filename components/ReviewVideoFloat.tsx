import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronsLeft,
  ChevronsRight,
  GripHorizontal,
  MoreHorizontal,
  Pause,
  Play,
  SquareArrowDownLeft,
  SquareArrowOutUpRight,
  Video,
  VolumeX,
  X,
} from 'lucide-react';
import { ReviewPicture, type ReviewClock, type ReviewVideo } from './ReviewVideoPanel';
import { useLiveTime } from './useLiveTime';

type Box = { x: number; y: number; w: number; h: number };
/** `out`: in a window of its own, last left at `win` on the screen (its picture area). */
type Saved = Box & { compact: boolean; fill: boolean; out?: boolean; win?: Box };

const KEY = 'dhvani.reviewVideo.float';
const MARGIN = 8;
const MIN_W = 200;
const MIN_H = 180;
/** How close to a corner of the window a dropped player has to be to settle into it. */
const SNAP = 90;
const SIZES = { Small: [240, 280], Medium: [320, 380], Large: [460, 520] } as const;
/** The in-app box's title bar; in a window of its own the system's title bar takes its place. */
const HEADER = 36;
const BAR = 40;
/** Desktop builds let only windows with this name open blank and stay inside the app. */
const WINDOW_NAME = 'dhvani-review-video';
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

/** Where the in-app box is on the screen, near enough: its own window opens there. */
const onScreen = (b: Box): Box => ({
  x: Math.round(window.screenX + (window.outerWidth - window.innerWidth) / 2 + b.x),
  y: Math.round(window.screenY + window.outerHeight - window.innerHeight + b.y),
  w: b.w,
  h: b.h - HEADER,
});

/**
 * A window of its own for the player, styled like the app (its stylesheets
 * are copied in), or null where pop-ups are blocked. The name is new each
 * time, so a window still closing is never handed back.
 */
const openOwnWindow = (box: Box, title: string): { win: Window; host: HTMLElement } | null => {
  const win = window.open('', `${WINDOW_NAME}-${Date.now()}`, `popup,left=${box.x},top=${box.y},width=${box.w},height=${box.h}`);
  if (!win) return null;
  const doc = win.document;
  doc.title = title;
  doc.documentElement.className = document.documentElement.className;
  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    const copy = node.cloneNode(true) as HTMLElement;
    if (node instanceof HTMLLinkElement) (copy as HTMLLinkElement).href = node.href;
    doc.head.appendChild(copy);
  });
  doc.body.style.cssText = 'margin:0;background:#020617;overflow:hidden';
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  // Browsers size a new window by its page, Electron by its frame: once it is
  // up, its page is made the size it was left at, so it never creeps smaller.
  win.requestAnimationFrame(() => {
    if (win.innerWidth !== box.w || win.innerHeight !== box.h) {
      win.resizeTo(box.w + win.outerWidth - win.innerWidth, box.h + win.outerHeight - win.innerHeight);
    }
  });
  return { win, host };
};

/**
 * The review video as a window over the page, like a video editor's video
 * window: moved by its title bar (settling into a corner when dropped near
 * one), sized from any edge or corner, and kept where it was left. The box
 * has any shape; a reel or a wide video fits inside it whole, with black
 * bars, or fills it. It plays nothing itself: its buttons drive the player.
 *
 * It can also leave the app for a window of its own, like REAPER's video
 * window: moved anywhere, onto another screen, sized by the system. Closing
 * that window hides the video, and Show video opens it there again.
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
  const [own, setOwn] = useState<{ win: Window; host: HTMLElement } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const live = useRef(saved);
  live.current = saved;
  const hideRef = useRef(onHide);
  hideRef.current = onHide;
  const time = useLiveTime(clock.currentTime, clock.isPlaying, clock.getLiveTime, 0.1, own?.win);

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
    if (!saved.out) return;
    const opened = openOwnWindow(live.current.win ?? onScreen(live.current), video.name);
    if (!opened) {
      update({ out: false });
      return;
    }
    const { win } = opened;
    setOwn(opened);
    /** Kept while it is open: moving a window on screen fires nothing to listen for. */
    const keepPlace = () => {
      if (win.closed) return;
      const b = { x: win.screenX, y: win.screenY, w: win.innerWidth, h: win.innerHeight };
      const was = live.current.win;
      if (!was || was.x !== b.x || was.y !== b.y || was.w !== b.w || was.h !== b.h) update({ win: b });
    };
    const watch = window.setInterval(() => {
      if (!win.closed) return keepPlace();
      window.clearInterval(watch);
      hideRef.current();
    }, 500);
    // Keys pressed over it do what they do over the app: Space plays.
    const forward = (e: KeyboardEvent) => {
      const copy = new KeyboardEvent('keydown', {
        key: e.key,
        code: e.code,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(copy);
      if (copy.defaultPrevented) e.preventDefault();
    };
    win.addEventListener('keydown', forward);
    const closeWithApp = () => win.close();
    window.addEventListener('pagehide', closeWithApp);
    return () => {
      window.clearInterval(watch);
      window.removeEventListener('pagehide', closeWithApp);
      keepPlace();
      win.close();
      setOwn(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.out]);

  useEffect(() => {
    if (own) own.win.document.title = video.name;
  }, [own, video.name]);

  useEffect(() => {
    if (!menuOpen) return;
    const doc = menuRef.current?.ownerDocument ?? document;
    const close = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    doc.addEventListener('pointerdown', close);
    doc.addEventListener('keydown', onKey);
    return () => {
      doc.removeEventListener('pointerdown', close);
      doc.removeEventListener('keydown', onKey);
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

  /** In its own window, `h` is the in-app box's: the window has no title bar of ours. */
  const sizeTo = (w: number, h: number) => {
    if (!own) return update(clampBox({ ...saved, w, h }));
    const { win } = own;
    win.resizeTo(w + win.outerWidth - win.innerWidth, h - HEADER + win.outerHeight - win.innerHeight);
  };

  /** The box made the picture's shape at its current width: no bars. */
  const fitToPicture = () => {
    if (!aspect) return;
    const bar = saved.compact ? 0 : BAR;
    if (!own) return update(clampBox({ ...saved, h: Math.round(saved.w / aspect + HEADER + bar) }));
    sizeTo(own.win.innerWidth, Math.round(own.win.innerWidth / aspect + HEADER + bar));
  };

  /** Clicks on its buttons leave the keyboard to the page, so Space still plays. */
  const press = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    fn();
  };
  const menuItem = 'w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-800 text-slate-200 cursor-default';

  const iconButton = 'w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-default';

  /** Opens below the in-app title bar, or above the controls in its own window. */
  const menu = (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        onClick={press(() => setMenuOpen((o) => !o))}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="More"
        className={iconButton}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {menuOpen && (
        <div
          role="menu"
          className={`absolute right-0 ${own ? 'bottom-8' : 'top-8'} z-10 w-52 rounded-lg border border-slate-700 bg-slate-900 p-1 text-[12px] shadow-xl shadow-black/50`}
        >
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
              onClick={() => { setMenuOpen(false); sizeTo(SIZES[name][0], SIZES[name][1]); }}
            >
              {name}
            </button>
          ))}
          <button type="button" role="menuitem" className={menuItem} disabled={!aspect} onClick={() => { setMenuOpen(false); fitToPicture(); }}>
            {own ? 'Fit the window to the video' : 'Fit the box to the video'}
          </button>
          <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); update({ fill: !saved.fill }); }}>
            {saved.fill ? 'Show the whole picture' : `Fill the ${own ? 'window' : 'box'} (crops)`}
          </button>
          <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); update({ compact: !saved.compact }); }}>
            {saved.compact ? 'Show the controls' : 'Video only'}
          </button>
          <div className="my-1 border-t border-slate-800" />
          <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); update({ out: !saved.out }); }}>
            {own ? 'Put back in the app' : 'Open in its own window'}
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
  );

  const controls = (end?: React.ReactNode) => (
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
      {end}
    </div>
  );

  if (saved.out) {
    if (!own) return null;
    return createPortal(
      <section aria-label="Review video" className="h-screen flex flex-col bg-slate-950 select-none">
        <div
          className="relative flex-1 min-h-0"
          onDoubleClick={() => update({ compact: !saved.compact })}
          title={saved.compact ? 'Double-click for the controls' : 'Double-click for the video only'}
        >
          <ReviewPicture video={video} {...clock} fit={saved.fill ? 'cover' : 'contain'} onAspect={setAspect} view={own.win} className="absolute inset-0" />
        </div>
        {!saved.compact &&
          controls(
            <>
              <button
                type="button"
                onClick={press(() => update({ out: false }))}
                title="Put back in the app"
                aria-label="Put back in the app"
                className={iconButton}
              >
                <SquareArrowDownLeft className="w-4 h-4" />
              </button>
              {menu}
            </>
          )}
      </section>,
      own.host
    );
  }

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
          <button
            type="button"
            onClick={press(() => update({ out: true }))}
            title="Open in its own window, to move anywhere (even another screen)"
            aria-label="Open in its own window"
            className={iconButton}
          >
            <SquareArrowOutUpRight className="w-3.5 h-3.5" />
          </button>
          {menu}
          <button
            type="button"
            onClick={onHide}
            title="Hide (Show video brings it back)"
            aria-label="Hide the video"
            className={iconButton}
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
        {!saved.compact && controls()}
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
