import React, { useEffect, useMemo, useRef, useState } from 'react';
import { bufferSeconds, computePeaks } from '../services/playbackTimeline';

/** Waveform peaks per second: finer than the closest zoom needs at any width. */
const PEAKS_PER_SECOND = 100;

export type PeakData = { peaks: Float32Array; seconds: number };

/** Peaks of a whole buffer, once; drawn a window at a time. */
export const usePeaks = (buffer: AudioBuffer | null | undefined): PeakData | null =>
  useMemo(() => {
    if (!buffer) return null;
    try {
      return { peaks: computePeaks(buffer, Math.max(1, Math.ceil(bufferSeconds(buffer) * PEAKS_PER_SECOND))), seconds: bufferSeconds(buffer) };
    } catch {
      return null;
    }
  }, [buffer]);

/** A stretch of the track drawn in its own colour; `faded` draws it dimmed. */
export type WaveSpan = { from: number; to: number; color: string; faded?: boolean };

/**
 * A lane's waveform for [from, from + span]: in each span's colour, and
 * outside every span in the canvas's text colour. It fills its (positioned)
 * parent and lets clicks through.
 */
export const WindowWaveform: React.FC<{
  data: PeakData | null;
  from: number;
  span: number;
  spans: WaveSpan[];
  className: string;
}> = ({ data, from, span, spans, className }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState(0);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => setSize((n) => n + 1));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!data || data.seconds <= 0 || span <= 0) return;
    const gapColor = getComputedStyle(canvas).color;
    const bars = Math.max(1, Math.floor(w / 2));
    const barWidth = w / bars;
    const n = data.peaks.length;
    for (let i = 0; i < bars; i++) {
      const t0 = from + (span * i) / bars;
      const t1 = from + (span * (i + 1)) / bars;
      if (t1 <= 0 || t0 >= data.seconds) continue;
      const b0 = Math.max(0, Math.floor((t0 / data.seconds) * n));
      const b1 = Math.min(n, Math.max(b0 + 1, Math.floor((t1 / data.seconds) * n)));
      let a = 0;
      for (let b = b0; b < b1; b++) if (data.peaks[b] > a) a = data.peaks[b];
      const bh = Math.max(1, a * (h - 4));
      const mid = (t0 + t1) / 2;
      const line = spans.find((s) => mid >= s.from && mid < s.to);
      ctx.fillStyle = line ? line.color : gapColor;
      ctx.globalAlpha = line?.faded ? 0.35 : 1;
      ctx.fillRect(i * barWidth, (h - bh) / 2, Math.max(1, barWidth - 0.5), bh);
    }
    ctx.globalAlpha = 1;
  }, [data, from, span, spans, size]);
  return <canvas ref={ref} aria-hidden="true" className={`absolute inset-0 w-full h-full pointer-events-none ${className}`} />;
};
