import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Video, VolumeX } from 'lucide-react';
import { useLiveFrame } from './useLiveTime';

/** A local video picked for review: played from its own file, never copied or saved with the project. */
export type ReviewVideo = { url: string; name: string };

/**
 * Picks a review video and keeps it until replaced, removed or the project
 * changes. The file plays through an object URL onto the file on disk, so
 * nothing is read into memory or stored; the URL is revoked when it goes.
 */
export const useReviewVideo = (projectId: string | undefined) => {
  const [video, setVideo] = useState<ReviewVideo | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<string | null>(null);
  const clear = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setVideo(null);
  }, []);
  const pick = useCallback(() => inputRef.current?.click(), []);
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared so picking the same file again still fires a change.
    e.target.value = '';
    if (!file) return;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = URL.createObjectURL(file);
    setVideo({ url: urlRef.current, name: file.name });
  };
  // A review video belongs to the project it was picked for.
  useEffect(() => clear, [projectId, clear]);
  const input = <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={onFile} />;
  return { video, pick, clear, input };
};

const WIDTH_KEY = 'dhvani.reviewVideo.width';
const MIN_WIDTH = 260;
const DEFAULT_WIDTH = 420;
/** How far the picture may drift from the clock while playing before it is put back. */
const MAX_DRIFT = 0.2;

const readWidth = () => {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(w) && w >= MIN_WIDTH ? w : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
};

const ERROR_TEXT: Record<number, string> = {
  3: "The video couldn't be decoded.",
  4: "This video's format can't play here.",
};

/**
 * A silent picture that follows the player's clock (the original's): it only
 * mirrors play, pause and position, and the audio stays the player's, so
 * Original, Dub and Both work as they do without it.
 */
export const ReviewVideoPanel: React.FC<{
  video: ReviewVideo;
  /** The player's position on the original's clock. */
  currentTime: number;
  isPlaying: boolean;
  getLiveTime?: () => number | null;
  playbackRate: number;
  onReplace: () => void;
  onRemove: () => void;
}> = ({ video, currentTime, isPlaying, getLiveTime, playbackRate, onReplace, onRemove }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(readWidth);
  const lastSeek = useRef(0);

  useEffect(() => setError(null), [video.url]);

  /** Puts the picture at `t`, unless it is already there or still getting to the last place asked. */
  const follow = (t: number, tolerance: number) => {
    const v = ref.current;
    if (!v || error || v.readyState < 1 || v.seeking) return;
    const target = Math.min(Math.max(0, t), v.duration || t);
    if (isPlaying) {
      // Past the picture's end it holds the last frame; back inside, it plays again.
      const past = Boolean(v.duration) && t >= v.duration;
      if (past && !v.paused) v.pause();
      if (!past && v.paused) v.play().catch(() => {});
    }
    if (Math.abs(v.currentTime - target) <= tolerance) return;
    // While playing, one correction at a time: a seek takes a moment to land.
    if (isPlaying && performance.now() - lastSeek.current < 500) return;
    lastSeek.current = performance.now();
    v.currentTime = target;
  };

  // The player's own clock drives it: every frame while playing, on each change while paused.
  useLiveFrame(currentTime, isPlaying, getLiveTime, (t) => follow(t, isPlaying ? MAX_DRIFT : 1 / 60));

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // Pausing is immediate; playing starts from the frame loop, which knows the clock.
    if (!isPlaying || error) v.pause();
  }, [isPlaying, error, video.url]);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = playbackRate;
  }, [playbackRate, video.url]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = width;
    const max = () => (ref.current?.closest('main, body') as HTMLElement | null)?.clientWidth || window.innerWidth;
    let next = w0;
    const move = (ev: PointerEvent) => {
      next = Math.round(Math.max(MIN_WIDTH, Math.min(max() - 16, w0 + ev.clientX - x0)));
      setWidth(next);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem(WIDTH_KEY, String(next));
      } catch {
        /* The width is a convenience; it just isn't kept. */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section
      aria-label="Review video"
      className="relative self-start bg-slate-900/90 border border-slate-800 rounded-2xl p-2 flex flex-col gap-2 max-w-full"
      style={{ width }}
    >
      <div className="flex items-center gap-2 px-1 min-w-0">
        <Video className="w-3.5 h-3.5 shrink-0 text-slate-500" aria-hidden="true" />
        <span className="flex-1 min-w-0 truncate text-xs text-slate-200" title={video.name}>
          {video.name}
        </span>
        <span className="shrink-0 flex items-center gap-1 text-[10.5px] text-slate-500" title="The video is always silent; you hear what Listen to picks">
          <VolumeX className="w-3 h-3" aria-hidden="true" /> Muted
        </span>
        <button type="button" onClick={onReplace} className="shrink-0 h-7 px-2 rounded-md text-[11px] text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer">
          Replace
        </button>
        <button type="button" onClick={onRemove} className="shrink-0 h-7 px-2 rounded-md text-[11px] text-slate-400 hover:text-rose-300 hover:bg-slate-800 cursor-pointer">
          Remove
        </button>
      </div>
      <div className="relative rounded-lg overflow-hidden bg-black aspect-video">
        <video
          ref={ref}
          src={video.url}
          muted
          playsInline
          preload="auto"
          disablePictureInPicture
          className="w-full h-full object-contain"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            v.muted = true;
            v.playbackRate = playbackRate;
            v.currentTime = Math.min(currentTime, v.duration || currentTime);
            if (!v.videoWidth) setError('This file has no picture to show.');
          }}
          onEnded={(e) => e.currentTarget.pause()}
          onError={(e) => setError(ERROR_TEXT[e.currentTarget.error?.code ?? 0] || "This video can't be opened.")}
        />
        {error && (
          <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center bg-slate-950">
            <AlertTriangle className="w-6 h-6 text-amber-400" aria-hidden="true" />
            <p className="text-[13px] text-slate-200">{error}</p>
            <p className="text-[11.5px] text-slate-500">Export it as an H.264 .mp4 or a .webm and choose Replace.</p>
          </div>
        )}
      </div>
      <p className="px-1 text-[10.5px] text-slate-500">Follows the player · nothing in the project changes</p>
      <div
        role="separator"
        aria-label="Resize the video"
        title="Drag to resize"
        onPointerDown={startResize}
        className="absolute right-0.5 bottom-0.5 w-3.5 h-3.5 cursor-nwse-resize touch-none"
      >
        <svg viewBox="0 0 10 10" className="w-full h-full text-slate-600" aria-hidden="true">
          <path d="M9 3 3 9M9 6 6 9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </div>
    </section>
  );
};
