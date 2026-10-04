import type { AudioSegment } from '../types';

/*
 * Helpers that keep what is drawn on the same clock as what is heard.
 */

/**
 * The peak of each of `buckets` equal slices of the buffer, scaled so the
 * loudest is 1. Slice edges are fractional (bucket b covers samples
 * floor(b*n/buckets) to floor((b+1)*n/buckets)), so the buckets span the
 * whole file exactly: bucket b is at time b/buckets of the buffer's
 * duration. Rounding the slice size down instead would shrink the drawing
 * against the audio, by about 1.6 s over an hour at 44.1 kHz.
 */
export const computePeaks = (buffer: AudioBuffer, buckets: number, stride = 8): Float32Array => {
  const data = buffer.getChannelData(0);
  const n = data.length;
  const count = Math.max(1, Math.floor(buckets));
  const out = new Float32Array(count);
  let max = 0;
  for (let b = 0; b < count; b++) {
    const start = Math.floor((b * n) / count);
    const end = Math.max(start + 1, Math.floor(((b + 1) * n) / count));
    let peak = 0;
    for (let i = start; i < end && i < n; i += stride) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
    out[b] = peak;
    if (peak > max) max = peak;
  }
  if (max > 0) for (let b = 0; b < count; b++) out[b] /= max;
  return out;
};

/** The buffer's exact length in seconds, from its samples. */
export const bufferSeconds = (buffer: AudioBuffer) => buffer.length / buffer.sampleRate;

/**
 * Maps a time on one cue timeline to the same moment of speech on another,
 * matching cues by id: inside a cue it keeps the same fraction of the way
 * through, between cues the same fraction of the gap, and past the last cue
 * it runs on one to one. Used to move between the original and an unsynced
 * dub, whose lines sit at different times. Built once per pair of
 * timelines; the returned function is cheap enough to call every frame.
 */
export const timelineMapper = (from: AudioSegment[], to: AudioSegment[]): ((time: number) => number) => {
  const toById = new Map(to.map((seg) => [seg.id, seg]));
  const fromTimes: number[] = [0];
  const toTimes: number[] = [0];
  [...from]
    .sort((a, b) => a.startTime - b.startTime)
    .forEach((f) => {
      const t = toById.get(f.id);
      if (!t) return;
      const points: [number, number][] = [
        [f.startTime, t.startTime],
        [f.endTime, t.endTime],
      ];
      for (const [a, b] of points) {
        // Only points that move forward on both timelines; anything else would fold time back.
        if (a >= fromTimes[fromTimes.length - 1] && b >= toTimes[toTimes.length - 1]) {
          fromTimes.push(a);
          toTimes.push(b);
        }
      }
    });
  const last = fromTimes.length - 1;
  return (time: number) => {
    if (!isFinite(time) || time <= 0) return 0;
    if (time >= fromTimes[last]) return Math.max(0, toTimes[last] + (time - fromTimes[last]));
    // The first anchor at or after `time`.
    let lo = 1;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fromTimes[mid] >= time) hi = mid;
      else lo = mid + 1;
    }
    const a0 = fromTimes[lo - 1];
    const a1 = fromTimes[lo];
    const b0 = toTimes[lo - 1];
    const b1 = toTimes[lo];
    return Math.max(0, a1 === a0 ? b1 : b0 + ((time - a0) * (b1 - b0)) / (a1 - a0));
  };
};
