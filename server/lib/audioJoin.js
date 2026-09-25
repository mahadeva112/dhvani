/**
 * Joins separately generated speech passages into one continuous read.
 *
 * Appending the passages' files as they come back leaves every join audible:
 * each generation carries its own lead-in and tail silence (sometimes almost
 * none, which sounds like a cut, sometimes far too much), its own MP3 encoder
 * padding, and its own loudness, so the voice seems to step between sections.
 * Here the passages are joined as audio instead:
 *
 * - silence at each join is trimmed and replaced by a pause sized to the
 *   boundary in the script, so a join sounds like any other pause;
 * - the trimmed edges are faded over a few milliseconds so no join clicks;
 * - every passage is brought to the same speech loudness.
 *
 * The start of the first passage and the end of the last are left as generated.
 */

/** Anything quieter than this (about -50 dBFS) counts as silence when trimming a join. */
const SILENCE_THRESHOLD = 0.0032;

/**
 * Kept either side of the detected speech so soft onsets, word decays and
 * breaths are not clipped.
 */
const LEAD_KEEP_SECONDS = 0.03;
const TAIL_KEEP_SECONDS = 0.08;

/** Fade over the trimmed edges; short enough to be inaudible, long enough to stop a click. */
const FADE_SECONDS = 0.012;

/** Loudness is measured over windows of this length that contain speech. */
const LOUDNESS_WINDOW_SECONDS = 0.02;
const SPEECH_GATE = 0.01; // about -40 dBFS

/** Loudness correction is capped so an unusual passage is evened out, not flattened. */
const MAX_GAIN = 2; // +6 dB
const MIN_GAIN = 0.5; // -6 dB
const PEAK_CEILING = 0.98;

const firstAbove = (samples, threshold) => {
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > threshold) return i;
  return -1;
};

const lastAbove = (samples, threshold) => {
  for (let i = samples.length - 1; i >= 0; i--) if (Math.abs(samples[i]) > threshold) return i;
  return -1;
};

/**
 * Root-mean-square level over the windows that contain speech, so pauses
 * don't pull the measurement down. Null for a passage with no speech.
 */
export const speechLoudness = (samples, sampleRate) => {
  const size = Math.max(1, Math.round(LOUDNESS_WINDOW_SECONDS * sampleRate));
  let sum = 0;
  let count = 0;
  for (let start = 0; start < samples.length; start += size) {
    const end = Math.min(samples.length, start + size);
    let windowSum = 0;
    for (let i = start; i < end; i++) windowSum += samples[i] * samples[i];
    if (Math.sqrt(windowSum / (end - start)) >= SPEECH_GATE) {
      sum += windowSum;
      count += end - start;
    }
  }
  return count > 0 ? Math.sqrt(sum / count) : null;
};

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const peak = (samples) => {
  let max = 0;
  for (let i = 0; i < samples.length; i++) max = Math.max(max, Math.abs(samples[i]));
  return max;
};

/** Gain per passage that brings each to the median speech loudness of all of them. */
const matchingGains = (passages, sampleRate) => {
  const levels = passages.map((samples) => speechLoudness(samples, sampleRate));
  const measured = levels.filter((level) => level !== null);
  if (measured.length < 2) return passages.map(() => 1);

  const target = median(measured);
  return passages.map((samples, index) => {
    if (levels[index] === null) return 1;
    let gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, target / levels[index]));
    const top = peak(samples);
    if (top * gain > PEAK_CEILING) gain = Math.max(Math.min(1, gain), PEAK_CEILING / top);
    return gain;
  });
};

/**
 * Where to cut a passage: silence is trimmed from the start unless it is the
 * first passage and from the end unless it is the last.
 */
const trimBounds = (samples, sampleRate, { trimStart, trimEnd }) => {
  const first = firstAbove(samples, SILENCE_THRESHOLD);
  if (first === -1) return null; // no speech at all
  const last = lastAbove(samples, SILENCE_THRESHOLD);
  return {
    start: trimStart ? Math.max(0, first - Math.round(LEAD_KEEP_SECONDS * sampleRate)) : 0,
    end: trimEnd ? Math.min(samples.length, last + 1 + Math.round(TAIL_KEEP_SECONDS * sampleRate)) : samples.length,
  };
};

/** Raised-cosine fade weight for position `i` of a fade `length` samples long. */
const fadeWeight = (i, length) => 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / length);

/**
 * Joins mono float passages. `pauses[i]` is the silence, in seconds, placed
 * between passage `i` and passage `i + 1`. Returns one Float32Array.
 */
export const joinPassages = (passages, { sampleRate, pauses = [] }) => {
  if (passages.length === 0) return new Float32Array(0);
  if (passages.length === 1) return passages[0];

  const gains = matchingGains(passages, sampleRate);
  const fadeLength = Math.max(1, Math.round(FADE_SECONDS * sampleRate));
  const last = passages.length - 1;

  const pieces = [];
  passages.forEach((samples, index) => {
    const bounds = trimBounds(samples, sampleRate, { trimStart: index > 0, trimEnd: index < last });
    if (!bounds) return; // a silent passage adds nothing but its pause
    pieces.push({ index, samples, ...bounds, gain: gains[index] });
  });

  const gapSamples = (index) => Math.round(Math.max(0, pauses[index] ?? 0) * sampleRate);

  let total = 0;
  pieces.forEach((piece, n) => {
    total += piece.end - piece.start;
    if (n < pieces.length - 1) total += gapSamples(piece.index);
  });

  const output = new Float32Array(total);
  let offset = 0;
  pieces.forEach((piece, n) => {
    const length = piece.end - piece.start;
    const fadeIn = piece.index > 0 ? Math.min(fadeLength, Math.floor(length / 2)) : 0;
    const fadeOut = piece.index < last ? Math.min(fadeLength, Math.floor(length / 2)) : 0;

    for (let i = 0; i < length; i++) {
      let weight = piece.gain;
      if (i < fadeIn) weight *= fadeWeight(i, fadeIn);
      if (i >= length - fadeOut) weight *= fadeWeight(length - 1 - i, fadeOut);
      output[offset + i] = piece.samples[piece.start + i] * weight;
    }
    offset += length;
    if (n < pieces.length - 1) offset += gapSamples(piece.index); // already zero
  });

  return output;
};
