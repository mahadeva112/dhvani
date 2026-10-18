import type { AudioSegment } from '../types';

/** The same name services/speakers.ts gives a cue's speaker (kept here so this file runs on its own in tests). */
const speakerOf = (segment: AudioSegment): string => (segment.speaker || '').trim() || 'Speaker';

/**
 * Does one person sit under two speaker labels? Scribe sometimes splits a
 * speaker whose voice changes (loud then soft, near then far), and every
 * cue then gets the wrong name. This listens to each label's own cues and
 * says which labels sound like the same voice.
 *
 * A voice is summarised by the average and spread of its spectral shape
 * (MFCCs) over the louder frames of its cues. Everything is computed from
 * the audio already decoded in the page: nothing is uploaded and no model
 * is downloaded. It only ever suggests a merge; the user decides.
 *
 * "Same voice" is judged against the label's own wobble: how far apart two
 * halves of one speaker's cues sound. Two labels count as alike when they
 * differ by about that much, so a speaker whose voice varies a lot is
 * held to a looser bar than one who never does.
 */

export interface MonoAudio {
  sampleRate: number;
  getChannelData(channel: number): Float32Array;
}

const TARGET_RATE = 16000;
const FRAME = 400; // 25 ms
const HOP = 160; // 10 ms
const FFT = 512;
const MEL_BANDS = 26;
const COEFFS = 12; // c1..c12; c0 is loudness
const MIN_HZ = 80;
const MAX_HZ = 7600;
/** Keep this share of a label's frames, the loudest ones, so pauses and breath don't count. */
const VOICED_SHARE = 0.6;
/** At most this much audio per speaker, spread over all their cues. */
const MAX_SECONDS_PER_SPEAKER = 90;
/** Each cue's edges are trimmed this much: they hold the neighbour's tail and the breath. */
const EDGE_TRIM = 0.06;
/** Voiced frames a speaker needs before they are compared at all (about 3 s). */
export const MIN_VOICED_FRAMES = 300;
/** Share of the shorter speaker's time spent talking over the other, above which they are two people. */
const MAX_OVERLAP_SHARE = 0.12;
/** Lowest match worth suggesting a merge for. */
export const SUGGEST_MATCH = 75;
/** The floor for a label's own wobble, so a very steady voice is not held to an impossible bar. */
const MIN_WOBBLE = 0.12;

/* ------------------------------------------------------------------------ */
/* Spectral features                                                         */
/* ------------------------------------------------------------------------ */

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

let cachedBank: Float64Array[] | null = null;
let cachedWindow: Float64Array | null = null;
let cachedCos: Float64Array[] | null = null;

const melBank = (): Float64Array[] => {
  if (cachedBank) return cachedBank;
  const bins = FFT / 2 + 1;
  const points = Array.from({ length: MEL_BANDS + 2 }, (_, i) =>
    melToHz(hzToMel(MIN_HZ) + ((hzToMel(MAX_HZ) - hzToMel(MIN_HZ)) * i) / (MEL_BANDS + 1))
  );
  const bin = points.map((hz) => (hz / (TARGET_RATE / 2)) * (bins - 1));
  cachedBank = Array.from({ length: MEL_BANDS }, (_, m) => {
    const row = new Float64Array(bins);
    for (let k = 0; k < bins; k += 1) {
      if (k > bin[m] && k <= bin[m + 1]) row[k] = (k - bin[m]) / (bin[m + 1] - bin[m]);
      else if (k > bin[m + 1] && k < bin[m + 2]) row[k] = (bin[m + 2] - k) / (bin[m + 2] - bin[m + 1]);
    }
    return row;
  });
  return cachedBank;
};

const hamming = (): Float64Array => {
  if (cachedWindow) return cachedWindow;
  cachedWindow = Float64Array.from({ length: FRAME }, (_, n) => 0.54 - 0.46 * Math.cos((2 * Math.PI * n) / (FRAME - 1)));
  return cachedWindow;
};

const dctBasis = (): Float64Array[] => {
  if (cachedCos) return cachedCos;
  cachedCos = Array.from({ length: COEFFS }, (_, c) =>
    Float64Array.from({ length: MEL_BANDS }, (_, m) => Math.cos((Math.PI * (c + 1) * (m + 0.5)) / MEL_BANDS))
  );
  return cachedCos;
};

/** In-place radix-2 FFT. */
const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
};

/** Mono samples from `start` to `end` seconds, at 16 kHz (averaged down, which is its own low-pass). */
const cutAt16k = (audio: MonoAudio, start: number, end: number): Float32Array => {
  const data = audio.getChannelData(0);
  const from = Math.max(0, Math.floor(start * audio.sampleRate));
  const to = Math.min(data.length, Math.ceil(end * audio.sampleRate));
  if (to <= from) return new Float32Array(0);
  const ratio = audio.sampleRate / TARGET_RATE;
  const length = Math.floor((to - from) / ratio);
  const out = new Float32Array(Math.max(0, length));
  for (let i = 0; i < out.length; i += 1) {
    const a = from + Math.floor(i * ratio);
    const b = Math.max(a + 1, from + Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let k = a; k < b && k < data.length; k += 1) sum += data[k];
    out[i] = sum / (b - a);
  }
  return out;
};

interface Frame {
  energy: number;
  coeffs: Float64Array;
}

/** MFCC frames of one stretch of 16 kHz audio. */
const framesOf = (samples: Float32Array): Frame[] => {
  const frames: Frame[] = [];
  const window = hamming();
  const bank = melBank();
  const basis = dctBasis();
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  const bins = FFT / 2 + 1;
  for (let at = 0; at + FRAME <= samples.length; at += HOP) {
    re.fill(0);
    im.fill(0);
    let energy = 0;
    let previous = 0;
    for (let n = 0; n < FRAME; n += 1) {
      const sample = samples[at + n];
      const emphasised = sample - 0.97 * previous;
      previous = sample;
      re[n] = emphasised * window[n];
      energy += emphasised * emphasised;
    }
    fft(re, im);
    const logMel = new Float64Array(MEL_BANDS);
    for (let m = 0; m < MEL_BANDS; m += 1) {
      let sum = 0;
      const row = bank[m];
      for (let k = 0; k < bins; k += 1) if (row[k] !== 0) sum += row[k] * (re[k] * re[k] + im[k] * im[k]);
      logMel[m] = Math.log(sum + 1e-10);
    }
    const coeffs = new Float64Array(COEFFS);
    for (let c = 0; c < COEFFS; c += 1) {
      let sum = 0;
      for (let m = 0; m < MEL_BANDS; m += 1) sum += basis[c][m] * logMel[m];
      coeffs[c] = sum;
    }
    frames.push({ energy: Math.log(energy / FRAME + 1e-10), coeffs });
  }
  return frames;
};

/* ------------------------------------------------------------------------ */
/* Voices                                                                    */
/* ------------------------------------------------------------------------ */

export interface VoiceProfile {
  speaker: string;
  /** Loud frames that went into the profile, in two interleaved halves for the wobble. */
  halves: [Float64Array[], Float64Array[]];
  voicedFrames: number;
  seconds: number;
}

const meanOf = (frames: Float64Array[]): Float64Array => {
  const mean = new Float64Array(COEFFS);
  for (const f of frames) for (let c = 0; c < COEFFS; c += 1) mean[c] += f[c];
  for (let c = 0; c < COEFFS; c += 1) mean[c] /= Math.max(1, frames.length);
  return mean;
};

const stdOf = (frames: Float64Array[], mean: Float64Array): Float64Array => {
  const out = new Float64Array(COEFFS);
  for (const f of frames) for (let c = 0; c < COEFFS; c += 1) out[c] += (f[c] - mean[c]) ** 2;
  for (let c = 0; c < COEFFS; c += 1) out[c] = Math.sqrt(out[c] / Math.max(1, frames.length));
  return out;
};

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * One profile per speaker, from their cues. Cues are read in turn and the
 * page gets a breath between them, so a long recording never freezes the
 * window. Cues alternate between the two halves the wobble is measured on.
 */
export const profileSpeakers = async (
  audio: MonoAudio,
  segments: AudioSegment[],
  { signal }: { signal?: AbortSignal } = {}
): Promise<VoiceProfile[]> => {
  const bySpeaker = new Map<string, AudioSegment[]>();
  for (const seg of [...segments].sort((a, b) => a.startTime - b.startTime)) {
    const name = speakerOf(seg);
    bySpeaker.set(name, [...(bySpeaker.get(name) || []), seg]);
  }

  const profiles: VoiceProfile[] = [];
  for (const [speaker, cues] of bySpeaker) {
    const total = cues.reduce((sum, c) => sum + Math.max(0, c.endTime - c.startTime), 0);
    // Too much speech: every n-th cue is enough to know a voice.
    const step = total > MAX_SECONDS_PER_SPEAKER ? Math.ceil(total / MAX_SECONDS_PER_SPEAKER) : 1;
    const halves: [Frame[], Frame[]] = [[], []];
    let seconds = 0;
    for (let i = 0; i < cues.length; i += step) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const cue = cues[i];
      const start = cue.startTime + EDGE_TRIM;
      const end = cue.endTime - EDGE_TRIM;
      if (end - start < 0.3) continue;
      const frames = framesOf(cutAt16k(audio, start, end));
      halves[(i / step) % 2 === 0 ? 0 : 1].push(...frames);
      seconds += end - start;
      if ((i / step) % 6 === 5) await yieldToUi();
    }
    const all = [...halves[0], ...halves[1]];
    const cut = [...all].sort((a, b) => b.energy - a.energy)[Math.max(0, Math.floor(all.length * VOICED_SHARE) - 1)]?.energy ?? -Infinity;
    const keep = (frames: Frame[]) => frames.filter((f) => f.energy >= cut).map((f) => f.coeffs);
    const kept: [Float64Array[], Float64Array[]] = [keep(halves[0]), keep(halves[1])];
    profiles.push({ speaker, halves: kept, voicedFrames: kept[0].length + kept[1].length, seconds });
    await yieldToUi();
  }
  return profiles;
};

/* ------------------------------------------------------------------------ */
/* Comparing                                                                 */
/* ------------------------------------------------------------------------ */

export interface VoiceMatch {
  /** The smaller of the two speakers: the one a merge would fold away. */
  from: string;
  /** The speaker with more speech: the one that keeps the name. */
  into: string;
  /** 0-100: how alike the voices sound, against how much each varies on its own. */
  match: number;
}

/** Distance between two sets of frames: their averages, in units of how much frames vary overall. */
const gap = (a: Float64Array[], b: Float64Array[], scale: Float64Array): number => {
  if (a.length === 0 || b.length === 0) return Infinity;
  const ma = meanOf(a);
  const mb = meanOf(b);
  const sa = stdOf(a, ma);
  const sb = stdOf(b, mb);
  let sum = 0;
  for (let c = 0; c < COEFFS; c += 1) {
    const meanGap = (ma[c] - mb[c]) / scale[c];
    const spreadGap = (sa[c] - sb[c]) / scale[c];
    sum += meanGap * meanGap + 0.25 * spreadGap * spreadGap;
  }
  return Math.sqrt(sum / COEFFS);
};

/** 0-100 from how many times the label's own wobble two voices are apart. */
const matchPercent = (ratio: number): number => Math.round(100 / (1 + (ratio / 1.6) ** 3));

/** How much frames vary across all the speech: the yardstick for every distance. */
const globalScale = (profiles: VoiceProfile[]): Float64Array => {
  const everything = profiles.flatMap((p) => [...p.halves[0], ...p.halves[1]]);
  const scale = stdOf(everything, meanOf(everything));
  for (let c = 0; c < COEFFS; c += 1) scale[c] = Math.max(scale[c], 1e-6);
  return scale;
};

/** Seconds two speakers talk over each other. */
const overlapSeconds = (segments: AudioSegment[], a: string, b: string): number => {
  const ours = segments.filter((s) => speakerOf(s) === a);
  const theirs = segments.filter((s) => speakerOf(s) === b);
  let sum = 0;
  for (const x of ours) {
    for (const y of theirs) {
      const overlap = Math.min(x.endTime, y.endTime) - Math.max(x.startTime, y.startTime);
      if (overlap > 0) sum += overlap;
    }
  }
  return sum;
};

/** How alike every pair of speakers sounds, most alike first. Pairs too short to judge, or who talk over each other, are left out. */
export const compareVoices = (profiles: VoiceProfile[], segments: AudioSegment[]): VoiceMatch[] => {
  const usable = profiles.filter((p) => p.voicedFrames >= MIN_VOICED_FRAMES);
  if (usable.length < 2) return [];

  const scale = globalScale(usable);

  const wobble = new Map(
    usable.map((p) => [p.speaker, Math.max(MIN_WOBBLE, p.halves[0].length && p.halves[1].length ? gap(p.halves[0], p.halves[1], scale) : MIN_WOBBLE)])
  );

  const matches: VoiceMatch[] = [];
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      const a = usable[i];
      const b = usable[j];
      const shorter = Math.min(a.seconds, b.seconds);
      if (shorter > 0 && overlapSeconds(segments, a.speaker, b.speaker) / shorter > MAX_OVERLAP_SHARE) continue;
      const apart = gap([...a.halves[0], ...a.halves[1]], [...b.halves[0], ...b.halves[1]], scale);
      const ratio = apart / Math.max(wobble.get(a.speaker)!, wobble.get(b.speaker)!);
      const [from, into] = a.seconds <= b.seconds ? [a, b] : [b, a];
      matches.push({ from: from.speaker, into: into.speaker, match: matchPercent(ratio) });
    }
  }
  return matches.sort((x, y) => y.match - x.match);
};

/** The matches worth offering as a merge, one per speaker, strongest first. */
export const mergeSuggestions = (matches: VoiceMatch[]): VoiceMatch[] => {
  const folded = new Set<string>();
  const kept = new Set<string>();
  const out: VoiceMatch[] = [];
  for (const m of matches) {
    // A speaker is either folded into another or kept by others, never both.
    if (m.match < SUGGEST_MATCH || folded.has(m.from) || folded.has(m.into) || kept.has(m.from)) continue;
    folded.add(m.from);
    kept.add(m.into);
    out.push(m);
  }
  return out;
};

/* ------------------------------------------------------------------------ */
/* One cue at a time                                                         */
/* ------------------------------------------------------------------------ */

export interface CueVoice {
  /** 0-100: how much this cue sounds like the speaker it is labelled with. */
  match: number;
  /** Set when another speaker's voice fits this cue clearly better than its own label does. */
  suggested?: string;
}

/** Cues shorter than this say too little to tell whose voice it is. */
const MIN_CUE_SECONDS = 0.8;
/** A cue is an outlier for its label when it is this many times further from the label than its cues usually are. */
const OUTLIER_RATIO = 1.9;
/** ...and it must sit at least this much nearer to another speaker. */
const BETTER_BY = 0.75;

const vectorGap = (a: Float64Array, b: Float64Array, scale: Float64Array): number => {
  let sum = 0;
  for (let c = 0; c < COEFFS; c += 1) sum += ((a[c] - b[c]) / scale[c]) ** 2;
  return Math.sqrt(sum / COEFFS);
};

/**
 * For each cue, whether it sounds like the speaker it is labelled as. A cue
 * is measured against each speaker's average voice, in units of how far that
 * speaker's own cues usually sit from it, so a speaker who varies a lot is
 * not flagged for varying. Cues the labels got wrong show up as clear outliers
 * that sit nearer to somebody else. Keyed by cue id.
 */
export const scoreCues = async (
  audio: MonoAudio,
  segments: AudioSegment[],
  profiles: VoiceProfile[],
  { signal }: { signal?: AbortSignal } = {}
): Promise<Map<string, CueVoice>> => {
  const out = new Map<string, CueVoice>();
  const usable = profiles.filter((p) => p.voicedFrames >= MIN_VOICED_FRAMES);
  if (usable.length < 2) return out;
  const scale = globalScale(usable);
  const centre = new Map(usable.map((p) => [p.speaker, meanOf([...p.halves[0], ...p.halves[1]])]));

  // Each cue's average voice, from its louder frames.
  const vectors = new Map<string, Float64Array>();
  let done = 0;
  for (const seg of segments) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const start = seg.startTime + EDGE_TRIM;
    const end = seg.endTime - EDGE_TRIM;
    if (end - start >= MIN_CUE_SECONDS) {
      const frames = framesOf(cutAt16k(audio, start, end));
      if (frames.length >= 20) {
        const cut = [...frames].sort((a, b) => b.energy - a.energy)[Math.max(0, Math.floor(frames.length * VOICED_SHARE) - 1)].energy;
        vectors.set(String(seg.id), meanOf(frames.filter((f) => f.energy >= cut).map((f) => f.coeffs)));
      }
    }
    done += 1;
    if (done % 12 === 0) await yieldToUi();
  }

  // How far each speaker's own cues usually sit from their average voice.
  const typical = new Map<string, number>();
  for (const p of usable) {
    const gaps = segments
      .filter((s) => speakerOf(s) === p.speaker && vectors.has(String(s.id)))
      .map((s) => vectorGap(vectors.get(String(s.id))!, centre.get(p.speaker)!, scale))
      .sort((a, b) => a - b);
    if (gaps.length) typical.set(p.speaker, Math.max(MIN_WOBBLE, gaps[Math.floor(gaps.length / 2)]));
  }

  for (const seg of segments) {
    const vector = vectors.get(String(seg.id));
    const own = speakerOf(seg);
    if (!vector || !centre.has(own) || !typical.has(own)) continue;
    const ratio = (name: string) => vectorGap(vector, centre.get(name)!, scale) / typical.get(name)!;
    const ownRatio = ratio(own);
    let best: { name: string; ratio: number } | null = null;
    for (const p of usable) {
      if (p.speaker === own || !typical.has(p.speaker)) continue;
      const r = ratio(p.speaker);
      if (!best || r < best.ratio) best = { name: p.speaker, ratio: r };
    }
    const flagged = best !== null && ownRatio > OUTLIER_RATIO && best.ratio < ownRatio * BETTER_BY;
    out.set(String(seg.id), { match: matchPercent(ownRatio), ...(flagged && best ? { suggested: best.name } : {}) });
  }
  return out;
};
