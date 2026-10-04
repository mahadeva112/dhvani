import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Calls `onFrame` with the playback position to draw: every animation frame
 * while playing (read straight from the audio through `getLiveTime`), and
 * whenever `reportedTime` changes while paused.
 *
 * It never re-renders on its own. A playhead moved here through a ref is on
 * the frame that is painted, where one moved through React state lands a
 * frame or two later and re-renders everything around it.
 */
export const useLiveFrame = (
  reportedTime: number,
  isPlaying: boolean,
  getLiveTime: (() => number | null) | undefined,
  onFrame: (time: number) => void
) => {
  const callback = useRef(onFrame);
  const reported = useRef(reportedTime);
  useLayoutEffect(() => {
    callback.current = onFrame;
    reported.current = reportedTime;
  });
  const live = isPlaying && Boolean(getLiveTime);
  useLayoutEffect(() => {
    if (!live) callback.current(reportedTime);
  }, [reportedTime, live]);
  useEffect(() => {
    if (!isPlaying || !getLiveTime) return;
    let frame = 0;
    const tick = () => {
      const t = getLiveTime();
      callback.current(t !== null && Number.isFinite(t) ? t : reported.current);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, getLiveTime]);
};

/**
 * The playback position as state, for text and logic rather than playheads.
 *
 * An <audio> element reports its time only about four times a second, so
 * while playing this reads the exact position every frame instead. `step`
 * rounds it down (0.1 for a clock in tenths), so the component re-renders
 * only when what it shows changes. Paused, or without `getLiveTime`, it is
 * `reportedTime`.
 */
export const useLiveTime = (
  reportedTime: number,
  isPlaying: boolean,
  getLiveTime?: () => number | null,
  step = 0
): number => {
  const [time, setTime] = useState(reportedTime);
  useLiveFrame(reportedTime, isPlaying, getLiveTime, (t) => {
    // The epsilon keeps 0.3 / 0.1 = 2.9999… from showing 0.2.
    const shown = step > 0 ? Math.floor(t / step + 1e-6) * step : t;
    setTime((prev) => (prev === shown ? prev : shown));
  });
  return time;
};
