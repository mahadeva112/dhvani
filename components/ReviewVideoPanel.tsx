import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useLiveFrame } from './useLiveTime';
import { deleteReviewVideo, getReviewVideo, saveReviewVideo } from '../services/storageService';
import { reportError } from '../services/errorPopup';

/** A local video picked for review, kept with its project until removed. */
export type ReviewVideo = { url: string; name: string };

/**
 * Picks a review video and keeps it with the project until replaced or
 * removed: a copy is saved beside the project, so it is back after the app
 * restarts. It plays through an object URL onto the file on disk, so nothing
 * is read into memory; the URL is revoked when it goes.
 */
export const useReviewVideo = (projectId: string | undefined) => {
  const [video, setVideo] = useState<ReviewVideo | null>(null);
  const urlRef = useRef<string | null>(null);
  /** The project shown now; a video read or picked for another one is dropped. */
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const show = useCallback((file: File | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = file ? URL.createObjectURL(file) : null;
    setVideo(file && urlRef.current ? { url: urlRef.current, name: file.name } : null);
  }, []);
  /** Removes the video from the project: it is gone after a restart and from its project file. */
  const clear = useCallback(() => {
    show(null);
    if (projectId) deleteReviewVideo(projectId).catch(console.warn);
  }, [projectId, show]);
  /**
   * Opens the file picker in `doc`, the window the click was in: a browser
   * shows one only from a click in its own window, so Replace in the video's
   * own window opens it there.
   */
  const pick = useCallback(
    (doc: Document = document) => {
      const input = doc.createElement('input');
      input.type = 'file';
      input.accept = 'video/*';
      input.hidden = true;
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.remove();
        if (!file || projectRef.current !== projectId) return;
        show(file);
        if (projectId) {
          saveReviewVideo(projectId, file).catch((err) =>
            reportError(err, {
              title: "The video couldn't be kept with the project",
              safe: 'It plays now, but add it again after Dhvani restarts.',
            })
          );
        }
      });
      input.addEventListener('cancel', () => input.remove());
      doc.body.appendChild(input);
      input.click();
    },
    [projectId, show]
  );
  // A review video belongs to its project: the one kept for it comes back when it opens.
  useEffect(() => {
    if (!projectId) return;
    let live = true;
    getReviewVideo(projectId)
      .then((file) => {
        // One picked while it was being read stays.
        if (live && file && !urlRef.current) show(file);
      })
      .catch(console.warn);
    return () => {
      live = false;
      show(null);
    };
  }, [projectId, show]);
  return { video, pick, clear };
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
 * Dub and Both work as they do without it. The whole picture always shows,
 * with black bars where its shape differs from the box.
 */
export const ReviewPicture: React.FC<
  ReviewClock & {
    video: ReviewVideo;
    className?: string;
    style?: React.CSSProperties;
    /** The picture's width over its height, once known. */
    onAspect?: (aspect: number) => void;
    /** The window it is shown in, when that is not the app's own. */
    view?: Window;
  }
> = ({ video, currentTime, isPlaying, getLiveTime, playbackRate, className = '', style, onAspect, view }) => {
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
  useLiveFrame(currentTime, isPlaying, getLiveTime, (t) => follow(t, isPlaying ? MAX_DRIFT : 1 / 60), view);

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
        className="w-full h-full object-contain"
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
