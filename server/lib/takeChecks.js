/**
 * Checks on a new take of a line before Sync offers it in place of the one
 * it has: it must sound like the same read. A take voiced again (a better
 * fitting one, or one read faster) keeps the words, but a voice can come out
 * louder, softer, higher or lower on a new take, and that would be heard
 * next to the lines around it.
 */

/** Frames this long are measured. */
const FRAME_SECONDS = 0.04;
const HOP_SECONDS = 0.02;

/** A frame this far below full scale (dBFS, by peak) is not speech. */
const SPEECH_PEAK_DB = -40;

/** The voice's pitch is looked for between these, in Hz. */
const MIN_PITCH = 70;
const MAX_PITCH = 400;

/** A frame whose best normalised autocorrelation is below this has no clear pitch (a breath, an "s"). */
const VOICED_CORRELATION = 0.6;

/** A new take louder or softer than this (dB), or higher or lower than this share (about a semitone; one voice varies 2-4% between identical requests), is not offered. */
export const MAX_LEVEL_CHANGE_DB = 2;
export const MAX_PITCH_CHANGE = 0.06;

const frames = (samples, sampleRate, fn) => {
  const size = Math.round(FRAME_SECONDS * sampleRate);
  const hop = Math.round(HOP_SECONDS * sampleRate);
  for (let at = 0; at + size <= samples.length; at += hop) fn(samples.subarray(at, at + size));
};

/** The take's speech level: the RMS of its speech frames, in dBFS; null with no speech. */
export const speechLevelDb = (samples, sampleRate) => {
  const floor = 10 ** (SPEECH_PEAK_DB / 20);
  let sum = 0;
  let count = 0;
  frames(samples, sampleRate, (frame) => {
    let peak = 0;
    for (const x of frame) peak = Math.max(peak, Math.abs(x));
    if (peak < floor) return;
    for (const x of frame) sum += x * x;
    count += frame.length;
  });
  return count > 0 ? 10 * Math.log10(sum / count) : null;
};

/** Pitch is looked for at about this rate: plenty for a voice, and quick. */
const PITCH_RATE = 8000;

/** `samples` averaged down to about PITCH_RATE, and the rate they are at. */
const downsampled = (samples, sampleRate) => {
  const factor = Math.max(1, Math.floor(sampleRate / PITCH_RATE));
  if (factor === 1) return { samples, sampleRate };
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    for (let k = 0; k < factor; k++) sum += samples[i * factor + k];
    out[i] = sum / factor;
  }
  return { samples: out, sampleRate: sampleRate / factor };
};

/** The voice's median pitch over its voiced frames, in Hz; null when none has a clear pitch. */
export const medianPitch = (input, inputRate) => {
  const { samples, sampleRate } = downsampled(input, inputRate);
  const floor = 10 ** (SPEECH_PEAK_DB / 20);
  const minLag = Math.floor(sampleRate / MAX_PITCH);
  const maxLag = Math.ceil(sampleRate / MIN_PITCH);
  const pitches = [];
  frames(samples, sampleRate, (frame) => {
    let peak = 0;
    let energy = 0;
    for (const x of frame) {
      peak = Math.max(peak, Math.abs(x));
      energy += x * x;
    }
    if (peak < floor || maxLag >= frame.length) return;
    const r = new Float32Array(maxLag + 2);
    let best = 0;
    for (let lag = minLag; lag <= maxLag + 1; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < frame.length; i++) sum += frame[i] * frame[i + lag];
      r[lag] = sum / energy;
      if (lag <= maxLag) best = Math.max(best, r[lag]);
    }
    if (best < VOICED_CORRELATION) return;
    // The shortest lag that peaks near the best, so a frame isn't read an octave low; then between samples.
    for (let lag = minLag + 1; lag <= maxLag; lag++) {
      if (r[lag] >= 0.9 * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
        const curve = r[lag - 1] - 2 * r[lag] + r[lag + 1];
        const exact = curve < 0 ? lag + (0.5 * (r[lag - 1] - r[lag + 1])) / curve : lag;
        pitches.push(sampleRate / exact);
        return;
      }
    }
  });
  if (pitches.length === 0) return null;
  pitches.sort((a, b) => a - b);
  return pitches[Math.floor(pitches.length / 2)];
};

/**
 * Why a new take of a line should not be offered in place of `before`, or
 * null when it sounds like the same read: no more than MAX_LEVEL_CHANGE_DB
 * louder or softer (unless `level` is false: the dub's loudness is evened
 * out afterwards anyway), no more than MAX_PITCH_CHANGE higher or lower.
 */
export const takeDiffers = (before, after, sampleRate, { level = true } = {}) => {
  const levelBefore = level ? speechLevelDb(before, sampleRate) : null;
  const levelAfter = level ? speechLevelDb(after, sampleRate) : null;
  if (levelBefore !== null && levelAfter !== null && Math.abs(levelAfter - levelBefore) > MAX_LEVEL_CHANGE_DB) {
    const change = levelAfter - levelBefore;
    return `It came out ${Math.abs(change).toFixed(1)} dB ${change > 0 ? 'louder' : 'softer'} than the take it would replace.`;
  }
  const pitchBefore = medianPitch(before, sampleRate);
  const pitchAfter = medianPitch(after, sampleRate);
  if (pitchBefore && pitchAfter && Math.abs(pitchAfter / pitchBefore - 1) > MAX_PITCH_CHANGE) {
    const change = pitchAfter / pitchBefore - 1;
    return `Its voice sits ${Math.round(Math.abs(change) * 100)}% ${change > 0 ? 'higher' : 'lower'} than the take it would replace.`;
  }
  return null;
};
