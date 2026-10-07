import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Captions, ChevronDown, ChevronUp, Film, GripHorizontal, Maximize2, Minimize2, Plus, Replace, Trash2 } from 'lucide-react';

export const isVideoFile = (file: File | null | undefined): file is File =>
  Boolean(file) && (file!.type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(file!.name));

const readPref = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};
const writePref = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

const formatClock = (seconds: number) => {
  const s = Math.max(0, seconds || 0);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

/** How far the picture may drift from the sound before it is nudged, and before it jumps. */
const NUDGE = 0.03;
const JUMP = 0.15;

export interface SyncVideoPanelProps {
  /** The picture to watch: the source itself when it is a video, or one added here. */
  video: File | null;
  /** True when `video` was added here rather than being the source, so it can be removed. */
  removable: boolean;
  onPick: (file: File) => void;
  onRemove: () => void;
  /** Floating over the page, as while editing timing; otherwise docked above the lanes. */
  floating: boolean;
  /** Everything below is on the original's clock, which is the video's. */
  currentTime: number;
  isPlaying: boolean;
  getLiveTime?: () => number | null;
  playbackRate: number;
  onSeek: (time: number) => void;
  /** The line playing now, for the caption and the line card. */
  caption?: { index: number; count: number; source: string; target: string; start: number; end: number } | null;
}

/*
 * A muted picture that follows the player. The sound is always the audio
 * elements' (bit-exact, through the mixer); the video only watches their
 * clock and keeps up with it, so nothing about playback changes when it is
 * open, closed or missing.
 */
export const SyncVideoPanel: React.FC<SyncVideoPanelProps> = ({
  video,
  removable,
  onPick,
  onRemove,
  floating,
  currentTime,
  isPlaying,
  getLiveTime,
  playbackRate,
  onSeek,
  caption,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [collapsed, setCollapsed] = useState(() => readPref('dhvani.syncVideo.collapsed', false));
  const [showCaption, setShowCaption] = useState(() => readPref('dhvani.syncVideo.caption', true));
  const [large, setLarge] = useState(() => readPref('dhvani.syncVideo.large', false));
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => readPref('dhvani.syncVideo.pos', null));
  const [unplayable, setUnplayable] = useState(false);

  useEffect(() => writePref('dhvani.syncVideo.collapsed', collapsed), [collapsed]);
  useEffect(() => writePref('dhvani.syncVideo.caption', showCaption), [showCaption]);
  useEffect(() => writePref('dhvani.syncVideo.large', large), [large]);

  const url = useMemo(() => (video ? URL.createObjectURL(video) : null), [video]);
  useEffect(() => {
    setUnplayable(false);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  const clamp = (t: number) => {
    const d = videoRef.current?.duration;
    return Math.max(0, d && isFinite(d) ? Math.min(t, d - 0.01) : t);
  };

  // Playing: start with the sound, then keep within NUDGE of it.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url || !isPlaying || collapsed) return;
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const target = clamp(getLiveTime?.() ?? currentTime);
      if (v.paused) {
        v.currentTime = target;
        v.playbackRate = playbackRate;
        v.play().catch(() => {});
      } else if (!v.seeking && now - last > 100) {
        last = now;
        const drift = v.currentTime - target;
        if (Math.abs(drift) > JUMP) {
          v.currentTime = target;
          v.playbackRate = playbackRate;
        } else if (Math.abs(drift) > NUDGE) {
          v.playbackRate = playbackRate * (drift > 0 ? 0.97 : 1.03);
        } else if (v.playbackRate !== playbackRate) {
          v.playbackRate = playbackRate;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      v.pause();
      v.playbackRate = playbackRate;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isPlaying, collapsed, getLiveTime, playbackRate]);

  // Paused: show the frame under the playhead.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !url || isPlaying || collapsed) return;
    const target = clamp(currentTime);
    if (Math.abs(v.currentTime - target) > 0.02) v.currentTime = target;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, isPlaying, currentTime, collapsed]);

  // Dragging the floating window by its bar.
  const dragFrom = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const startDrag = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    dragFrom.current = { px: e.clientX, py: e.clientY, x: box.left, y: box.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent) => {
    const from = dragFrom.current;
    const box = boxRef.current;
    if (!from || !box) return;
    const x = Math.min(Math.max(0, from.x + e.clientX - from.px), window.innerWidth - box.offsetWidth);
    const y = Math.min(Math.max(0, from.y + e.clientY - from.py), window.innerHeight - 40);
    setPos({ x, y });
  };
  const endDrag = () => {
    if (!dragFrom.current) return;
    dragFrom.current = null;
    writePref('dhvani.syncVideo.pos', pos);
  };

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="video/*,.mkv,.mov,.m4v"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) onPick(file);
      }}
    />
  );

  const picture = (
    <div className="relative bg-black rounded-xl overflow-hidden aspect-video">
      {url && (
        <video
          key={url}
          ref={videoRef}
          src={url}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          className="w-full h-full object-contain"
          onClick={() => videoRef.current && onSeek(videoRef.current.currentTime)}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (!v.videoWidth) setUnplayable(true);
            v.currentTime = clamp(getLiveTime?.() ?? currentTime);
          }}
          onError={() => setUnplayable(true)}
        />
      )}
      <span className="absolute top-2 left-2 font-mono text-[11px] text-slate-100 bg-black/60 px-1.5 py-0.5 rounded tabular-nums pointer-events-none">
        {formatClock(currentTime)}
      </span>
      {showCaption && caption?.target && !unplayable && (
        <span
          className={`absolute left-1/2 -translate-x-1/2 max-w-[92%] text-center leading-snug text-white bg-black/65 rounded-md pointer-events-none ${
            floating && !large ? 'bottom-1.5 text-[11px] px-1.5 py-0.5 line-clamp-2' : 'bottom-3 text-[13px] px-2.5 py-1'
          }`}
        >
          {caption.target}
        </span>
      )}
      {unplayable && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center text-[12px] text-slate-300">
          <Film className="w-5 h-5 text-slate-500" />
          This video's format can't be shown here. Add an MP4 (H.264) or WebM copy of it.
        </div>
      )}
    </div>
  );

  // No picture yet: a small invitation, docked only.
  if (!video) {
    if (floating) return null;
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-700 px-3 py-2.5">
        {fileInput}
        <div className="w-16 aspect-video rounded-md border border-dashed border-slate-700 flex items-center justify-center text-slate-500 shrink-0">
          <Film className="w-4 h-4" />
        </div>
        <p className="flex-1 min-w-0 text-[12.5px] text-slate-400">
          Add the video to watch lips and scenes while you check the timing. It's only for watching; the dub's audio doesn't change.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="h-8 px-3 rounded-lg border border-slate-700 text-xs font-medium text-slate-200 hover:text-white hover:bg-slate-800 cursor-pointer flex items-center gap-1.5 shrink-0"
        >
          <Plus className="w-3.5 h-3.5" /> Add video
        </button>
      </div>
    );
  }

  const captionToggle = (
    <button
      type="button"
      aria-pressed={showCaption}
      onClick={() => setShowCaption((v) => !v)}
      title={showCaption ? 'Hide the line on the picture' : 'Show the line on the picture'}
      className={`w-7 h-7 rounded-md flex items-center justify-center cursor-pointer ${showCaption ? 'text-slate-100 bg-slate-800' : 'text-slate-500 hover:text-slate-200'}`}
    >
      <Captions className="w-3.5 h-3.5" />
    </button>
  );

  if (floating) {
    const width = large ? 480 : 300;
    const style: React.CSSProperties = pos
      ? { left: Math.min(pos.x, window.innerWidth - width), top: Math.min(pos.y, window.innerHeight - 60), width }
      : { right: 24, bottom: 24, width };
    return (
      <div ref={boxRef} style={style} className="fixed z-40 bg-slate-900 border border-slate-700 rounded-2xl p-1.5 shadow-2xl shadow-black/50">
        {fileInput}
        <div
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="flex items-center gap-1 px-1 pb-1.5 text-[11px] text-slate-400 cursor-grab active:cursor-grabbing select-none touch-none"
        >
          <GripHorizontal className="w-3.5 h-3.5" />
          <span>Video</span>
          {caption && <span className="text-slate-500 tabular-nums">· line {caption.index + 1}</span>}
          <span className="ml-auto flex items-center gap-0.5">
            {captionToggle}
            <button
              type="button"
              onClick={() => setLarge((v) => !v)}
              title={large ? 'Smaller' : 'Larger'}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              {large ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? 'Show the video' : 'Hide the video'}
              className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-100 cursor-pointer"
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </span>
        </div>
        {!collapsed && picture}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {fileInput}
      <div className="flex items-center gap-2">
        <Film className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-[10.5px] uppercase tracking-wider font-semibold text-slate-500">Video</span>
        <span className="text-[11px] text-slate-500 truncate min-w-0">{video.name}</span>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Show the video' : 'Hide the video'}
          className="ml-auto w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
        >
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
      </div>
      {!collapsed && (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-stretch">
          {picture}
          <div className="flex flex-col gap-2 min-w-0">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5 text-[12px] text-slate-400 min-h-[5.5rem]">
              {caption ? (
                <>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-slate-200">Line {caption.index + 1}</span>
                    <span className="text-slate-500">of {caption.count}</span>
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">
                      {formatClock(caption.start)}–{formatClock(caption.end)}
                    </span>
                  </div>
                  {caption.source && <p className="text-slate-500 line-clamp-2">{caption.source}</p>}
                  {caption.target && <p className="text-slate-200 line-clamp-3 mt-0.5">{caption.target}</p>}
                </>
              ) : (
                <p>Press play to watch the picture with the dub. Click the picture to put the playhead there.</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 mt-auto">
              {captionToggle}
              <span className="text-[11.5px] text-slate-500 mr-auto">Line on the picture</span>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="h-7 px-2.5 rounded-md border border-slate-700 text-[11.5px] text-slate-300 hover:text-white hover:bg-slate-800 cursor-pointer flex items-center gap-1.5"
              >
                <Replace className="w-3.5 h-3.5" /> Use another video
              </button>
              {removable && (
                <button
                  type="button"
                  onClick={onRemove}
                  title="Remove this video from the project"
                  className="w-7 h-7 rounded-md border border-slate-700 text-slate-400 hover:text-rose-300 hover:bg-slate-800 cursor-pointer flex items-center justify-center"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
