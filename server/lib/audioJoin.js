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
 * The dub's own start and end are evened out the same way: generations often
 * begin on the first syllable and stop on the last one, which sounds like the
 * audio was cut off. The silence there is replaced with a fixed lead-in and
 * run-out (DUB_LEAD_IN_SECONDS / DUB_RUN_OUT_SECONDS).
 */

/** Anything quieter than this (about -50 dBFS) counts as silence when trimming a join. */
const SILENCE_THRESHOLD = 0.0032;

/**
 * Kept either side of the detected speech so soft onsets, word decays and
 * breaths are not clipped.
 */
const LEAD_KEEP_SECONDS = 0.03;
const TAIL_KEEP_SECONDS = 0.08;

/**
 * The last word of the whole dub keeps more of its decay, since nothing
 * follows it to mask a shortened ending.
 */
const END_KEEP_SECONDS = 0.15;

/** Silence before the first word and after the last, so the dub neither starts nor stops abruptly. */
export const DUB_LEAD_IN_SECONDS = 0.3;
export const DUB_RUN_OUT_SECONDS = 0.7;

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

/** Where speech starts and ends in a passage, with a margin kept each side; null if it has none. */
const trimBounds = (samples, sampleRate, { isLast }) => {
  const first = firstAbove(samples, SILENCE_THRESHOLD);
  if (first === -1) return null;
  const last = lastAbove(samples, SILENCE_THRESHOLD);
  const tailKeep = isLast ? END_KEEP_SECONDS : TAIL_KEEP_SECONDS;
  return {
    start: Math.max(0, first - Math.round(LEAD_KEEP_SECONDS * sampleRate)),
    end: Math.min(samples.length, last + 1 + Math.round(tailKeep * sampleRate)),
  };
};

/** Raised-cosine fade weight for position `i` of a fade `length` samples long. */
const fadeWeight = (i, length) => 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / length);

/**
 * Joins mono float passages into one dub. `pauses[i]` is the silence, in
 * seconds, placed between passage `i` and passage `i + 1`; `leadIn` and
 * `runOut` are the silence before the first word and after the last.
 * Returns one Float32Array. A single passage gets the same treatment.
 */
export const joinPassages = (
  passages,
  { sampleRate, pauses = [], leadIn = DUB_LEAD_IN_SECONDS, runOut = DUB_RUN_OUT_SECONDS }
) => {
  const gains = matchingGains(passages, sampleRate);
  const fadeLength = Math.max(1, Math.round(FADE_SECONDS * sampleRate));
  const lastIndex = passages.length - 1;
  const toSamples = (seconds) => Math.round(Math.max(0, seconds ?? 0) * sampleRate);

  const pieces = [];
  passages.forEach((samples, index) => {
    const bounds = trimBounds(samples, sampleRate, { isLast: index === lastIndex });
    if (!bounds) return; // a silent passage adds nothing but its pause
    pieces.push({ index, samples, ...bounds, gain: gains[index] });
  });
  if (pieces.length === 0) return new Float32Array(0);

  const lead = toSamples(leadIn);
  const gapAfter = (n) => (n < pieces.length - 1 ? toSamples(pauses[pieces[n].index]) : toSamples(runOut));

  let total = lead;
  pieces.forEach((piece, n) => {
    total += piece.end - piece.start + gapAfter(n);
  });

  const output = new Float32Array(total); // zero-filled, so every gap is already silence
  let offset = lead;
  pieces.forEach((piece, n) => {
    const length = piece.end - piece.start;
    const fade = Math.min(fadeLength, Math.floor(length / 2));

    for (let i = 0; i < length; i++) {
      let weight = piece.gain;
      if (i < fade) weight *= fadeWeight(i, fade);
      if (i >= length - fade) weight *= fadeWeight(length - 1 - i, fade);
      output[offset + i] = piece.samples[piece.start + i] * weight;
    }
    offset += length + gapAfter(n);
  });

  return output;
};
