import { useEffect, useState } from 'react';

/**
 * The playback position to draw a playhead at.
 *
 * An <audio> element reports its time only about four times a second, so a
 * playhead driven by that steps visibly. While playing, this reads the exact
 * position every animation frame instead, re-rendering only the component
 * that calls it. Paused, or without `getLiveTime`, it is `reportedTime`.
 */
export const useLiveTime = (
  reportedTime: number,
  isPlaying: boolean,
  getLiveTime?: () => number | null
): number => {
  const [liveTime, setLiveTime] = useState<number | null>(null);
  useEffect(() => {
    if (!isPlaying || !getLiveTime) {
      setLiveTime(null);
      return;
    }
    let frame = 0;
    const tick = () => {
      const t = getLiveTime();
      if (t !== null && Number.isFinite(t)) setLiveTime(t);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, getLiveTime]);
  return liveTime ?? reportedTime;
};
