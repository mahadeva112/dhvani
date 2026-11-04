import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronsLeft,
  ChevronsRight,
  GripHorizontal,
  MoreHorizontal,
  Pause,
  Play,
  Video,
  VolumeX,
  X,
} from 'lucide-react';
import { ReviewPicture, type ReviewClock, type ReviewVideo } from './ReviewVideoPanel';
import { useLiveTime } from './useLiveTime';

type Box = { x: number; y: number; w: number; h: number };
/** `win`: where its own window was last left on the screen (its page area). */
type Saved = Box & { compact: boolean; win?: Box };

const KEY = 'dhvani.reviewVideo.float';
const MARGIN = 8;
const MIN_W = 200;
const MIN_H = 180;
/** How close to a corner of the window a dropped player has to be to settle into it. */
const SNAP = 90;
/** A new box's size; after that it is the size it was left at. */
const START: Box = { x: 0, y: 96, w: 320, h: 380 };
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
  const fallback = { ...START, x: window.innerWidth - START.w - 24, compact: false };
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
type OwnWindow = { win: Window; host: HTMLElement };
const openOwnWindow = (box: Box, title: string): OwnWindow | null => {
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

/** The desktop app opens a window whenever asked; a browser only straight from a click. */
const IN_BROWSER = !navigator.userAgent.includes('Electron');
let reserved: OwnWindow | null = null;
let reservedTimer = 0;

/** The window opened for a picker that was cancelled, or never taken, closes. */
export const releaseReviewWindow = () => {
  window.clearTimeout(reservedTimer);
  reserved?.win.close();
  reserved = null;
};

/**
 * Called in the click that shows the video (Add video, Show video). The
 * player comes a moment later, after a file is picked, when a browser would
 * no longer let it open a window; so in a browser its window opens now, in
 * the click, and the player takes it. The desktop app needs none of this.
 */
export const reserveReviewWindow = () => {
  if (!IN_BROWSER || (reserved && !reserved.win.closed)) return;
  const saved = readSaved();
  reserved = openOwnWindow(saved.win ?? onScreen(saved), 'Review video');
  if (!reserved) return;
  const note = reserved.win.document.createElement('p');
  note.textContent = 'Pick a video…';
  note.style.cssText = 'margin:0;padding-top:40vh;text-align:center;font:13px system-ui,sans-serif;color:#64748b';
  reserved.host.appendChild(note);
  window.clearTimeout(reservedTimer);
  reservedTimer = window.setTimeout(releaseReviewWindow, 5 * 60_000);
};

const takeReserved = (): OwnWindow | null => {
  const taken = reserved && !reserved.win.closed ? reserved : null;
  window.clearTimeout(reservedTimer);
  reserved = null;
  taken?.host.replaceChildren();
  return taken;
};

/**
 * The review video in a window of its own, like REAPER's video window: moved
 * anywhere, onto another screen, sized by the system, and opened again where
 * it was left. Closing it hides the video; Show video opens it again. A reel
 * or a wide video always fits inside it whole, with black bars. It
 * plays nothing itself: its buttons drive the player.
 *
 * Only where a window can't open (a browser blocking pop-ups) does it show as
 * a box over the page instead: moved by its title bar (settling into a corner
 * when dropped near one), sized from any edge or corner; its menu tries the
 * window again.
 */
export const ReviewVideoFloat: React.FC<
  ReviewClock & {
    video: ReviewVideo;
    onTogglePlay: () => void;
    onPrevLine: () => void;
    onNextLine: () => void;
    trackMode: 'source' | 'synth' | 'both';
    onTrackMode: (mode: 'source' | 'synth' | 'both') => void;
    /** Opens the file picker in the given window's document. */
    onReplace: (doc: Document) => void;
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
  /** The window couldn't open, so it is the box over the page; `attempt` tries again. */
  const [blocked, setBlocked] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
    const opened = takeReserved() ?? openOwnWindow(live.current.win ?? onScreen(live.current), video.name);
    setBlocked(!opened);
    if (!opened) return;
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
  }, [attempt]);

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

  /**
   * The box made the picture's shape: no bars. At its current width when that
   * fits; a reel too tall for that is made narrower instead, so all of it,
   * controls included, stays on the screen (or in the app's window).
   */
  const fitToPicture = () => {
    if (!aspect) return;
    const bar = saved.compact ? 0 : BAR;
    if (!own) {
      const h = Math.min(saved.w / aspect + HEADER + bar, window.innerHeight - 2 * MARGIN);
      return update(clampBox({ ...saved, w: Math.round(Math.min(saved.w, (h - HEADER - bar) * aspect)), h: Math.round(h) }));
    }
    const { win } = own;
    const frameW = win.outerWidth - win.innerWidth;
    const frameH = win.outerHeight - win.innerHeight;
    const screen = win.screen as Screen & { availLeft?: number; availTop?: number };
    const left = screen.availLeft ?? 0;
    const top = screen.availTop ?? 0;
    const h = Math.min(win.innerWidth / aspect + bar, screen.availHeight - frameH);
    const w = Math.round(Math.min(win.innerWidth, (h - bar) * aspect));
    win.resizeTo(w + frameW, Math.round(h) + frameH);
    // Moved up or left if the new size would run off the screen.
    const x = Math.min(win.screenX, left + screen.availWidth - w - frameW);
    const y = Math.min(win.screenY, top + screen.availHeight - Math.round(h) - frameH);
    if (x !== win.screenX || y !== win.screenY) win.moveTo(Math.max(left, x), Math.max(top, y));
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
          className={`${
            own ? 'fixed right-1 bottom-11 max-w-[calc(100vw-8px)] max-h-[calc(100vh-52px)] overflow-y-auto' : 'absolute right-0 top-8'
          } z-10 w-52 rounded-lg border border-slate-700 bg-slate-900 p-1 text-[12px] shadow-xl shadow-black/50`}
        >
          <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); onReplace(own?.win.document ?? document); }}>
            Replace video…
          </button>
          <div className="my-1 border-t border-slate-800" />
          <button type="button" role="menuitem" className={menuItem} disabled={!aspect} onClick={() => { setMenuOpen(false); fitToPicture(); }}>
            {own ? 'Fit the window to the video' : 'Fit the box to the video'}
          </button>
          <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); update({ compact: !saved.compact }); }}>
            {saved.compact ? 'Show the controls' : 'Video only'}
          </button>
          {!own && (
            <button type="button" role="menuitem" className={menuItem} onClick={() => { setMenuOpen(false); setAttempt((a) => a + 1); }}>
              Open in its own window
            </button>
          )}
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

  /** In a narrow window the clock goes first, then the line jumps; play, Listen to and the menu always fit. */
  const controls = (end?: React.ReactNode) => (
    <div className="@container shrink-0 border-t border-slate-800">
      <div className="flex items-center gap-1.5 px-2 h-10 min-w-0">
        <button type="button" onClick={press(onPrevLine)} aria-label="Previous line" className="hidden @[17rem]:flex shrink-0 w-6 h-6 rounded-full items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-default">
          <ChevronsLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={press(onTogglePlay)}
          aria-label={clock.isPlaying ? 'Pause' : 'Play'}
          className="shrink-0 w-7 h-7 rounded-full bg-slate-100 hover:bg-white text-slate-950 flex items-center justify-center cursor-default"
        >
          {clock.isPlaying ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current ml-0.5" />}
        </button>
        <button type="button" onClick={press(onNextLine)} aria-label="Next line" className="hidden @[17rem]:flex shrink-0 w-6 h-6 rounded-full items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-default">
          <ChevronsRight className="w-3.5 h-3.5" />
        </button>
        <span className="hidden @[20rem]:inline shrink-0 font-mono text-[11px] text-slate-200 tabular-nums">{formatClock(time)}</span>
        <div role="group" aria-label="Listen to" className="ml-auto shrink-0 flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 gap-0.5 text-[10.5px]">
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
    </div>
  );

  if (own) {
    return createPortal(
      <section aria-label="Review video" className="h-screen flex flex-col bg-slate-950 select-none">
        {/* The picture takes the room left over, so a reel fits whole and never covers the bar. */}
        <div
          className="flex-1 min-h-0 flex flex-col"
          onDoubleClick={() => update({ compact: !saved.compact })}
          title={saved.compact ? 'Double-click for the controls' : 'Double-click for the video only'}
        >
          <ReviewPicture video={video} {...clock} onAspect={setAspect} view={own.win} className="flex-1 min-h-0" />
        </div>
        {!saved.compact && controls(menu)}
      </section>,
      own.host
    );
  }
  if (!blocked) return null;

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
