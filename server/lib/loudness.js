/**
 * Speech loudness, and the per-clip gains that bring clips to the same
 * loudness. Only used when the user asks for loudness to be evened out: by
 * default every clip keeps exactly the level it was voiced at.
 */

/** Loudness is measured over windows of this length that contain speech. */
const LOUDNESS_WINDOW_SECONDS = 0.02;
const SPEECH_GATE = 0.01; // about -40 dBFS

/** Loudness correction is capped so an unusual clip is evened out, not flattened. */
const MAX_GAIN = 2; // +6 dB
const MIN_GAIN = 0.5; // -6 dB
const PEAK_CEILING = 0.98;

/**
 * Root-mean-square level over the windows that contain speech, so pauses
 * don't pull the measurement down. Null for a clip with no speech.
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

/** Gain per clip that brings each to the median speech loudness of all of them, never past PEAK_CEILING. */
export const matchingGains = (clips, sampleRate) => {
  const levels = clips.map((samples) => speechLoudness(samples, sampleRate));
  const measured = levels.filter((level) => level !== null);
  if (measured.length < 2) return clips.map(() => 1);

  const target = median(measured);
  return clips.map((samples, index) => {
    if (levels[index] === null) return 1;
    let gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, target / levels[index]));
    const top = peak(samples);
    if (top * gain > PEAK_CEILING) gain = Math.max(Math.min(1, gain), PEAK_CEILING / top);
    return gain;
  });
};
