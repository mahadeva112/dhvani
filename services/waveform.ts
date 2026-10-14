/*
 * Waveforms as bars, each a stretch's peak with its RMS as a solid core, so
 * loudness reads at a glance and transients still show. Nothing here touches
 * audio.
 */

/** Per-bucket signed peaks and RMS of a buffer, scaled so its loudest sample is 1. */
export type Wave = { max: Float32Array; min: Float32Array; rms: Float32Array; seconds: number };

/**
 * `buckets` equal slices of the buffer's first channel. Slice edges are
 * fractional, as in computePeaks, so bucket b sits at time b/buckets of the
 * buffer exactly.
 */
export const computeWave = (buffer: AudioBuffer, buckets: number, stride = 4): Wave => {
  const data = buffer.getChannelData(0);
  const n = data.length;
  const count = Math.max(1, Math.floor(buckets));
  const max = new Float32Array(count);
  const min = new Float32Array(count);
  const rms = new Float32Array(count);
  let loudest = 0;
  for (let b = 0; b < count; b++) {
    const start = Math.floor((b * n) / count);
    const end = Math.min(n, Math.max(start + 1, Math.floor(((b + 1) * n) / count)));
    let hi = 0;
    let lo = 0;
    let sum = 0;
    let taken = 0;
    for (let i = start; i < end; i += stride) {
      const v = data[i];
      if (v > hi) hi = v;
      if (v < lo) lo = v;
      sum += v * v;
      taken++;
    }
    max[b] = hi;
    min[b] = lo;
    rms[b] = taken ? Math.sqrt(sum / taken) : 0;
    if (hi > loudest) loudest = hi;
    if (-lo > loudest) loudest = -lo;
  }
  if (loudest > 0) {
    for (let b = 0; b < count; b++) {
      max[b] /= loudest;
      min[b] /= loudest;
      rms[b] /= loudest;
    }
  }
  return { max, min, rms, seconds: n / buffer.sampleRate };
};

type Sample = { hi: number; lo: number; rms: number };
const SILENT: Sample = { hi: 0, lo: 0, rms: 0 };

/**
 * The wave over [t0, t1): the extremes and power of the buckets under it, or,
 * zoomed in past the buckets, eased between neighbours instead of stepping.
 */
const sampleWave = (wave: Wave, t0: number, t1: number): Sample => {
  const n = wave.max.length;
  if (n === 0 || wave.seconds <= 0 || t1 <= 0 || t0 >= wave.seconds) return SILENT;
  const f0 = (t0 / wave.seconds) * n;
  const f1 = (t1 / wave.seconds) * n;
  const b0 = Math.max(0, Math.floor(f0));
  const b1 = Math.min(n, Math.floor(f1));
  if (b1 - b0 >= 2) {
    let hi = 0;
    let lo = 0;
    let sq = 0;
    for (let b = b0; b < b1; b++) {
      if (wave.max[b] > hi) hi = wave.max[b];
      if (wave.min[b] < lo) lo = wave.min[b];
      sq += wave.rms[b] * wave.rms[b];
    }
    return { hi, lo, rms: Math.sqrt(sq / (b1 - b0)) };
  }
  const fm = Math.max(0, Math.min(n - 1, (f0 + f1) / 2 - 0.5));
  const a = Math.floor(fm);
  const c = Math.min(n - 1, a + 1);
  const k = fm - a;
  return {
    hi: wave.max[a] + (wave.max[c] - wave.max[a]) * k,
    lo: wave.min[a] + (wave.min[c] - wave.min[a]) * k,
    rms: wave.rms[a] + (wave.rms[c] - wave.rms[a]) * k,
  };
};

/** How a stretch of the wave is painted; null leaves it out. */
export type WaveStyle = { color: string; alpha?: number } | null;

export type DrawWaveOptions = {
  /** Box to draw in, in the context's (CSS pixel) units. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Seconds into the wave at the box's left and right edges. */
  from: number;
  to: number;
  /** One colour, or the style at time t. */
  style: string | ((t: number) => WaveStyle);
  /** Linear gain at time t (fades, clip gain); 1 when left out. */
  gain?: (t: number) => number;
};

/** Bar pitch and gap, in CSS pixels: a 2 px bar with a 1 px gap. */
const BAR_PITCH = 3;
const BAR_GAP = 1;
/** Opacity of a bar's peak tip; its RMS core is drawn solid inside it. */
const PEAK_ALPHA = 0.45;

/**
 * Draws `wave` into the box as bars. Each bar is its stretch's peak, with the
 * stretch's RMS as a solid core inside it, so loudness reads at a glance and
 * transients still show. Bars sit on a grid fixed in time rather than on the
 * canvas, so they hold still while the view scrolls; bars sharing a style are
 * filled as one path.
 */
export const drawWave = (ctx: CanvasRenderingContext2D, wave: Wave | null, o: DrawWaveOptions) => {
  if (o.w <= 0 || o.h <= 0 || o.to <= o.from) return;
  const dpr = ctx.getTransform().a || 1;
  const X = o.x * dpr;
  const Y = o.y * dpr;
  const W = o.w * dpr;
  const H = o.h * dpr;
  const mid = Y + H / 2;
  const half = H / 2;
  const pitch = Math.max(2, Math.round(BAR_PITCH * dpr));
  const barW = Math.max(1, pitch - Math.max(1, Math.round(BAR_GAP * dpr)));
  const radius = Math.min(barW / 2, dpr);
  const span = o.to - o.from;
  const barSeconds = (span * pitch) / W;
  const fixed: WaveStyle = typeof o.style === 'string' ? { color: o.style } : null;
  const styleAt: (t: number) => WaveStyle = typeof o.style === 'string' ? () => fixed : o.style;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(X, Y - 1, W, H + 2);
  ctx.clip();

  let runKey = '';
  let runStyle: WaveStyle = null;
  let peaks = new Path2D();
  let cores = new Path2D();
  const flush = () => {
    if (runStyle) {
      const alpha = runStyle.alpha ?? 1;
      ctx.fillStyle = runStyle.color;
      ctx.globalAlpha = alpha * PEAK_ALPHA;
      ctx.fill(peaks);
      ctx.globalAlpha = alpha;
      ctx.fill(cores);
    }
    peaks = new Path2D();
    cores = new Path2D();
  };
  const bar = (path: Path2D, x: number, top: number, height: number) => {
    if (height > 2 * radius) path.roundRect(x, top, barW, height, radius);
    else path.rect(x, top, barW, height);
  };

  const first = Math.floor(o.from / barSeconds);
  const last = Math.ceil(o.to / barSeconds);
  for (let k = first; k < last; k++) {
    const t0 = k * barSeconds;
    const t1 = t0 + barSeconds;
    const tm = (t0 + t1) / 2;
    const style = styleAt(tm);
    const key = style ? `${style.color}|${style.alpha ?? 1}` : '';
    if (key !== runKey) {
      flush();
      runKey = key;
      runStyle = style;
    }
    if (!style) continue;

    const s = wave ? sampleWave(wave, t0, t1) : SILENT;
    const g = o.gain ? Math.max(0, o.gain(tm)) : 1;
    const p = Math.min(1, Math.max(s.hi, -s.lo) * g);
    const r = Math.min(p, s.rms * g);

    const x = Math.round(X + ((t0 - o.from) / span) * W);
    // At least a device pixel, so silence still shows as a dotted centre line.
    const ph = Math.max(1, 2 * p * half);
    bar(peaks, x, mid - ph / 2, ph);
    if (r > 0) {
      const rh = Math.max(1, 2 * r * half);
      bar(cores, x, mid - rh / 2, rh);
    }
  }
  flush();
  ctx.restore();
};

/**
 * Draws `wave` into the box the way a video editor's timeline does: one
 * solid column per device pixel from the stretch's lowest to its highest
 * sample, with no gaps and no smoothing, so every transient stays sharp.
 */
export const drawWaveLines = (
  ctx: CanvasRenderingContext2D,
  wave: Wave | null,
  o: Omit<DrawWaveOptions, 'style'> & { color: string }
) => {
  if (!wave || o.w <= 0 || o.h <= 0 || o.to <= o.from) return;
  const dpr = ctx.getTransform().a || 1;
  const X = Math.round(o.x * dpr);
  const W = Math.round(o.w * dpr);
  const top = o.y * dpr;
  const half = (o.h * dpr) / 2;
  const mid = Math.round(top + half);
  const span = o.to - o.from;
  const path = new Path2D();
  for (let px = 0; px < W; px++) {
    const t0 = o.from + (span * px) / W;
    const t1 = o.from + (span * (px + 1)) / W;
    const s = sampleWave(wave, t0, t1);
    const g = o.gain ? Math.max(0, o.gain((t0 + t1) / 2)) : 1;
    const y0 = Math.round(mid - Math.min(1, s.hi * g) * half);
    const y1 = Math.round(mid - Math.max(-1, s.lo * g) * half);
    if (y1 > y0) path.rect(X + px, y0, 1, y1 - y0);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = o.color;
  ctx.fill(path);
  ctx.restore();
};
