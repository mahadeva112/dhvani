/*
 * Waveforms: dense solid bars for small overviews (computeWave, drawWave),
 * and a video editor's crisp per-pixel wave at real level for the waves
 * worked on in Review, Sync and Edit timing (computePeaks, drawPeaks).
 * Nothing here touches audio.
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

/** Bar pitch and gap, in CSS pixels: dense 1.5 px bars, 2 px apart. */
const BAR_PITCH = 2;
const BAR_GAP = 0.5;

/**
 * Draws `wave` into the box as dense solid bars, one colour each: a bar is
 * its stretch's loudest sample, mirrored about the centre. Bars sit on a
 * grid fixed in time rather than on the canvas, so they hold still while the
 * view scrolls; bars sharing a style are filled as one path.
 */
export const drawWave = (ctx: CanvasRenderingContext2D, wave: Wave | null, o: DrawWaveOptions) => {
  if (o.w <= 0 || o.h <= 0 || o.to <= o.from) return;
  const dpr = ctx.getTransform().a || 1;
  const X = o.x * dpr;
  const Y = o.y * dpr;
  const W = o.w * dpr;
  const H = o.h * dpr;
  const mid = Y + H / 2;
  const pitch = BAR_PITCH * dpr;
  const barW = Math.max(1, pitch - BAR_GAP * dpr);
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
  let bars = new Path2D();
  const flush = () => {
    if (runStyle) {
      ctx.fillStyle = runStyle.color;
      ctx.globalAlpha = runStyle.alpha ?? 1;
      ctx.fill(bars);
    }
    bars = new Path2D();
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
    // At least a device pixel, so silence still shows as a dotted centre line.
    const bh = Math.max(1, p * H);
    bars.rect(X + ((t0 - o.from) / span) * W, mid - bh / 2, barW, bh);
  }
  flush();
  ctx.restore();
};

/*
 * Full-resolution peaks, for the waves an editor works on (Review's player,
 * Edit timing, the sync lanes): drawn the way DaVinci's Fairlight does, from
 * the samples themselves at their real level, so a zoom never smooths a
 * transient away and a quiet take looks quiet.
 */

/** Samples per block at each level, finest first; each is 16 of the one before. */
const LEVEL_SIZES = [64, 1024, 16384];
const Q = 32767;

/**
 * The first channel's samples, plus each block's lowest and highest sample at
 * a few block sizes (stored as 16-bit, about 11 MB for an hour at 48 kHz).
 * The samples are the buffer's own, not a copy.
 */
export type Peaks = {
  data: Float32Array;
  rate: number;
  seconds: number;
  levels: { size: number; max: Int16Array; min: Int16Array }[];
};

const quantize = (v: number) => Math.max(-Q, Math.min(Q, Math.round(v * Q)));

export const computePeaks = (buffer: AudioBuffer): Peaks => {
  const data = buffer.getChannelData(0);
  const n = data.length;
  const levels: Peaks['levels'] = [];
  // The finest level from the samples; each coarser one from the level below.
  const first = LEVEL_SIZES[0];
  const count0 = Math.ceil(n / first);
  const max0 = new Int16Array(count0);
  const min0 = new Int16Array(count0);
  for (let b = 0; b < count0; b++) {
    const end = Math.min(n, (b + 1) * first);
    let hi = -1;
    let lo = 1;
    for (let i = b * first; i < end; i++) {
      const v = data[i];
      if (v > hi) hi = v;
      if (v < lo) lo = v;
    }
    max0[b] = quantize(hi);
    min0[b] = quantize(lo);
  }
  levels.push({ size: first, max: max0, min: min0 });
  for (let k = 1; k < LEVEL_SIZES.length; k++) {
    const below = levels[k - 1];
    const ratio = LEVEL_SIZES[k] / below.size;
    const count = Math.ceil(below.max.length / ratio);
    const max = new Int16Array(count);
    const min = new Int16Array(count);
    for (let b = 0; b < count; b++) {
      const end = Math.min(below.max.length, (b + 1) * ratio);
      let hi = -Q;
      let lo = Q;
      for (let j = b * ratio; j < end; j++) {
        if (below.max[j] > hi) hi = below.max[j];
        if (below.min[j] < lo) lo = below.min[j];
      }
      max[b] = hi;
      min[b] = lo;
    }
    levels.push({ size: LEVEL_SIZES[k], max, min });
  }
  return { data, rate: buffer.sampleRate, seconds: n / buffer.sampleRate, levels };
};

/** Lowest and highest sample in [i0, i1), from the coarsest blocks that fit and the samples at the edges. */
export const peakRange = (p: Peaks, i0: number, i1: number): { hi: number; lo: number } | null => {
  const a = Math.max(0, i0);
  const b = Math.min(p.data.length, i1);
  if (b <= a) return null;
  let hi = -Infinity;
  let lo = Infinity;
  const scan = (level: number, from: number, to: number) => {
    if (to <= from) return;
    if (level < 0) {
      for (let i = from; i < to; i++) {
        const v = p.data[i];
        if (v > hi) hi = v;
        if (v < lo) lo = v;
      }
      return;
    }
    const { size, max, min } = p.levels[level];
    const b0 = Math.ceil(from / size);
    const b1 = Math.floor(to / size);
    if (b1 <= b0) return scan(level - 1, from, to);
    for (let k = b0; k < b1; k++) {
      if (max[k] / Q > hi) hi = max[k] / Q;
      if (min[k] / Q < lo) lo = min[k] / Q;
    }
    scan(level - 1, from, b0 * size);
    scan(level - 1, b1 * size, to);
  };
  scan(p.levels.length - 1, a, b);
  return { hi, lo };
};

export type DrawPeaksOptions = DrawWaveOptions & {
  /** How much taller than its real level the wave is drawn (Wave height); 1 when left out. */
  scale?: number;
};

/**
 * Draws `peaks` into the box as a video editor's timeline does: one solid
 * column per device pixel from the stretch's lowest to its highest sample at
 * its real level (full scale is the box's full height), with silence as a
 * one-pixel centre line. Zoomed in past a sample per pixel, the samples are
 * drawn as a line. Columns sharing a style are filled as one path.
 */
export const drawPeaks = (ctx: CanvasRenderingContext2D, peaks: Peaks | null, o: DrawPeaksOptions) => {
  if (!peaks || o.w <= 0 || o.h <= 0 || o.to <= o.from) return;
  const dpr = ctx.getTransform().a || 1;
  const X = Math.round(o.x * dpr);
  const W = Math.max(1, Math.round(o.w * dpr));
  const top = Math.round(o.y * dpr);
  const H = Math.round(o.h * dpr);
  const half = H / 2;
  const mid = top + Math.floor(half);
  const span = o.to - o.from;
  const scale = o.scale ?? 1;
  const fixed: WaveStyle = typeof o.style === 'string' ? { color: o.style } : null;
  const styleAt: (t: number) => WaveStyle = typeof o.style === 'string' ? () => fixed : o.style;
  const gainAt = (t: number) => (o.gain ? Math.max(0, o.gain(t)) : 1) * scale;
  const yOf = (v: number) => mid - Math.max(-1, Math.min(1, v)) * half;
  const keyOf = (s: WaveStyle) => (s ? `${s.color}|${s.alpha ?? 1}` : '');
  // A style's alpha dims on top of whatever the caller already set (a faded clip).
  const baseAlpha = ctx.globalAlpha;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.beginPath();
  ctx.rect(X, top, W, H);
  ctx.clip();

  const runs = new Map<string, { style: NonNullable<WaveStyle>; path: Path2D }>();
  const pathFor = (s: NonNullable<WaveStyle>) => {
    const key = keyOf(s);
    let run = runs.get(key);
    if (!run) runs.set(key, (run = { style: s, path: new Path2D() }));
    return run.path;
  };

  const samplesPerPx = (span * peaks.rate) / W;
  if (samplesPerPx < 1) {
    // Each sample a point on one line, in the style where it falls.
    ctx.lineWidth = Math.max(1, dpr);
    ctx.lineJoin = 'round';
    const i0 = Math.max(0, Math.floor(o.from * peaks.rate) - 1);
    const i1 = Math.min(peaks.data.length - 1, Math.ceil(o.to * peaks.rate) + 1);
    let prev: { x: number; y: number; key: string } | null = null;
    for (let i = i0; i <= i1; i++) {
      const t = i / peaks.rate;
      const s = styleAt(t);
      const x = X + ((t - o.from) / span) * W;
      const y = yOf(peaks.data[i] * gainAt(t));
      if (s) {
        const path = pathFor(s);
        path.moveTo(prev ? prev.x : x, prev ? prev.y : y);
        path.lineTo(x, y);
      }
      prev = { x, y, key: keyOf(s) };
    }
    for (const { style, path } of runs.values()) {
      ctx.strokeStyle = style.color;
      ctx.globalAlpha = baseAlpha * (style.alpha ?? 1);
      ctx.stroke(path);
    }
    ctx.restore();
    return;
  }

  for (let px = 0; px < W; px++) {
    const t0 = o.from + (span * px) / W;
    const t1 = o.from + (span * (px + 1)) / W;
    const tm = (t0 + t1) / 2;
    const s = styleAt(tm);
    if (!s) continue;
    // One sample past the column's end, so neighbouring columns join where the wave runs steep.
    const i0 = Math.floor(t0 * peaks.rate);
    const r = peakRange(peaks, i0, Math.max(i0 + 1, Math.floor(t1 * peaks.rate)) + 1);
    const g = gainAt(tm);
    let y0 = mid;
    let y1 = mid + 1;
    if (r) {
      y0 = Math.min(mid, Math.floor(yOf(r.hi * g)));
      y1 = Math.max(mid + 1, Math.ceil(yOf(r.lo * g)));
    }
    pathFor(s).rect(X + px, y0, 1, y1 - y0);
  }
  for (const { style, path } of runs.values()) {
    ctx.fillStyle = style.color;
    ctx.globalAlpha = baseAlpha * (style.alpha ?? 1);
    ctx.fill(path);
  }
  ctx.restore();
};
