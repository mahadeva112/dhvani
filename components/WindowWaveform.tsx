import React, { useEffect, useMemo, useRef, useState } from 'react';
import { bufferSeconds } from '../services/playbackTimeline';
import { computeWave, drawWave, drawWaveLines, type Wave } from '../services/waveform';
import { shadeOf, tintOf } from './lineColors';

/** Waveform buckets per second: finer than the closest zoom needs at any width. */
const PEAKS_PER_SECOND = 200;

export type PeakData = Wave;

/** Peaks of a whole buffer, once; drawn a window at a time. */
export const usePeaks = (buffer: AudioBuffer | null | undefined): PeakData | null =>
  useMemo(() => {
    if (!buffer) return null;
    try {
      return computeWave(buffer, Math.max(1, Math.ceil(bufferSeconds(buffer) * PEAKS_PER_SECOND)));
    } catch {
      return null;
    }
  }, [buffer]);

/** A stretch of the track drawn in its own colour; `faded` draws it dimmed. With `look="clips"` the colour must be a hex. */
export type WaveSpan = { from: number; to: number; color: string; faded?: boolean };

/**
 * A lane's waveform for [from, from + span]: in each span's colour, and
 * outside every span in the canvas's text colour. It fills its (positioned)
 * parent and lets clicks through. `look="clips"` draws each span as a video
 * editor's clip: a solid body in its colour with a pale, crisp waveform.
 * `shade` changes how they sit: 'quiet' darker and softer, for a lane behind
 * another; 'vivid' with the waveform in its colour rather than near white.
 */
export const WindowWaveform: React.FC<{
  data: PeakData | null;
  from: number;
  span: number;
  spans: WaveSpan[];
  className: string;
  look?: 'bars' | 'clips';
  shade?: ClipShade;
}> = ({ data, from, span, spans, className, look = 'bars', shade = 'pale' }) => {
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
    if (look === 'clips') {
      drawClips(ctx, data, from, span, spans, gapColor, w, h, dpr, shade);
      return;
    }
    drawWave(ctx, data, {
      x: 0,
      y: 2,
      w,
      h: h - 4,
      from,
      to: from + span,
      style: (t) => {
        const line = spans.find((s) => t >= s.from && t < s.to);
        return line ? { color: line.color, alpha: line.faded ? 0.35 : 1 } : { color: gapColor };
      },
    });
  }, [data, from, span, spans, size, look, shade]);
  return <canvas ref={ref} aria-hidden="true" className={`absolute inset-0 w-full h-full pointer-events-none ${className}`} />;
};

type ClipShade = 'pale' | 'quiet' | 'vivid';
/** Each clip shade: the body and edge as a share of the colour's brightness, the waveform as a tint toward white. */
const CLIP_SHADES: Record<ClipShade, { body: number; edge: number; wave: { mix: number; alpha: number } }> = {
  pale: { body: 0.5, edge: 0.3, wave: { mix: 0.82, alpha: 1 } },
  quiet: { body: 0.28, edge: 0.18, wave: { mix: 0.35, alpha: 0.6 } },
  vivid: { body: 0.4, edge: 0.26, wave: { mix: 0.3, alpha: 0.95 } },
};

/** Clip bodies, guides and pale waveforms for `look="clips"`; between clips, the wave in `gapColor`. */
const drawClips = (
  ctx: CanvasRenderingContext2D,
  data: PeakData,
  from: number,
  span: number,
  spans: WaveSpan[],
  gapColor: string,
  w: number,
  h: number,
  dpr: number,
  shade: ClipShade = 'pale'
) => {
  const { body, edge, wave } = CLIP_SHADES[shade];
  const to = from + span;
  const x = (t: number) => ((t - from) / span) * w;
  const top = 3;
  const height = h - 6;
  const mid = top + height / 2;
  const hair = 1 / dpr;
  const snap = (y: number) => Math.round(y * dpr) / dpr;
  drawWaveLines(ctx, data, { x: 0, y: top, w, h: height, from, to, color: gapColor });
  for (const s of spans) {
    if (s.to <= from || s.from >= to) continue;
    const a = Math.round(x(s.from) * dpr) / dpr;
    const b = Math.round(x(s.to) * dpr) / dpr;
    ctx.save();
    ctx.globalAlpha = s.faded ? 0.35 : 1;
    ctx.beginPath();
    ctx.roundRect(a, 1, b - a, h - 2, 3);
    ctx.fillStyle = shadeOf(s.color, body);
    ctx.fill();
    ctx.strokeStyle = shadeOf(s.color, edge);
    ctx.lineWidth = hair;
    ctx.stroke();
    ctx.clip();
    ctx.fillStyle = tintOf(s.color, 0.6, 0.45);
    ctx.fillRect(a, snap(mid), b - a, hair);
    ctx.fillStyle = tintOf(s.color, 0.6, 0.22);
    ctx.fillRect(a, snap(mid - height / 4), b - a, hair);
    ctx.fillRect(a, snap(mid + height / 4), b - a, hair);
    drawWaveLines(ctx, data, { x: a, y: top, w: b - a, h: height, from: from + (a / w) * span, to: from + (b / w) * span, color: tintOf(s.color, wave.mix, wave.alpha) });
    ctx.restore();
  }
};
