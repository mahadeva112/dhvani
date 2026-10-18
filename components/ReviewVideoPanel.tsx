import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
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

/** Where the picture's clock comes from: the player's position on the original's clock. */
export type ReviewClock = {
  currentTime: number;
  isPlaying: boolean;
  getLiveTime?: () => number | null;
  playbackRate: number;
};

/** How far the picture may drift from the clock while playing before it is put back. */
const MAX_DRIFT = 0.2;

const ERROR_TEXT: Record<number, string> = {
  3: "The video couldn't be decoded.",
  4: "This video's format can't play here.",
};

/**
 * The silent picture itself, following the player's clock: it only mirrors
 * play, pause and position, and the audio stays the player's, so Original,
 * Dub and Both work as they do without it. `fit` contains the whole picture
 * (black bars where its shape differs from the box) or fills the box.
 */
export const ReviewPicture: React.FC<
  ReviewClock & {
    video: ReviewVideo;
    fit?: 'contain' | 'cover';
    className?: string;
    style?: React.CSSProperties;
    /** The picture's width over its height, once known. */
    onAspect?: (aspect: number) => void;
  }
> = ({ video, currentTime, isPlaying, getLiveTime, playbackRate, fit = 'contain', className = '', style, onAspect }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
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
    // Pausing is immediate; playing starts from the frame loop, which knows the clock.
    if (ref.current && (!isPlaying || error)) ref.current.pause();
  }, [isPlaying, error, video.url]);

  useEffect(() => {
    if (ref.current) ref.current.playbackRate = playbackRate;
  }, [playbackRate, video.url]);

  return (
    <div className={`relative overflow-hidden bg-black ${className}`} style={style}>
      <video
        ref={ref}
        src={video.url}
        muted
        playsInline
        preload="auto"
        disablePictureInPicture
        className={`w-full h-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          v.muted = true;
          v.playbackRate = playbackRate;
          v.currentTime = Math.min(currentTime, v.duration || currentTime);
          if (!v.videoWidth) setError('This file has no picture to show.');
          else onAspect?.(v.videoWidth / v.videoHeight);
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
  );
};
