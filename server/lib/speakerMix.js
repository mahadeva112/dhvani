/**
 * Mixing a dub voiced by several speakers.
 *
 * Every speaker's lines are placed exactly as for a one-voice dub; here they
 * are summed into one mix and also rendered as one stem per speaker, so the
 * dub can be finished in an editor. Nothing is hidden from the user:
 *
 * - every clip goes in at a gain of 1 unless `matchSpeakers` asks for one
 *   gain per speaker (each voice keeps its own dynamics, line to line);
 * - where speakers talk over each other the mix can peak above full scale.
 *   With `peak: 'float'` (the default) it is kept exactly as summed and
 *   written as 32-bit float, so nothing clips and nothing is turned down; with
 *   'lower' the whole mix is turned down by one gain, and the report says by
 *   how much;
 * - stems are never turned down: each is its speaker exactly as placed, all
 *   the same length, so they line up at 0:00 and sum to the mix.
 */
import { renderTimeline } from './syncRender.js';

/** How a mix that peaks above full scale is handled. */
export const MIX_PEAK_MODES = ['float', 'lower'];

/** A speaker's gain is capped so an unusual voice is evened out, not flattened (as in loudness.js). */
const MAX_GAIN = 2; // +6 dB
const MIN_GAIN = 0.5; // -6 dB
const PEAK_CEILING = 0.98;

const LOUDNESS_WINDOW_SECONDS = 0.02;
const SPEECH_GATE = 0.01; // about -40 dBFS

const toDb = (amplitude) => (amplitude > 0 ? Math.round(20 * Math.log10(amplitude) * 10) / 10 : null);

/** Sum of squares and sample count over the windows of `samples` that hold speech. */
const speechEnergy = (samples, sampleRate) => {
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
  return { sum, count };
};

const peakOf = (samples) => {
  let top = 0;
  for (let i = 0; i < samples.length; i++) top = Math.max(top, Math.abs(samples[i]));
  return top;
};

/**
 * One gain per speaker, bringing each speaker's speech (over all their
 * lines) to the median loudness of the speakers, within ±6 dB and never
 * pushing that speaker's loudest line past PEAK_CEILING. A speaker with no
 * measurable speech, or a dub with one speaker, keeps a gain of 1.
 * `clips[i]` is `{ samples, speaker }`. Returns a Map speaker → gain.
 */
export const speakerGains = (clips, sampleRate) => {
  const bySpeaker = new Map();
  for (const clip of clips) {
    const entry = bySpeaker.get(clip.speaker) || { sum: 0, count: 0, peak: 0 };
    const energy = speechEnergy(clip.samples, sampleRate);
    entry.sum += energy.sum;
    entry.count += energy.count;
    entry.peak = Math.max(entry.peak, peakOf(clip.samples));
    bySpeaker.set(clip.speaker, entry);
  }
  const gains = new Map([...bySpeaker.keys()].map((speaker) => [speaker, 1]));
  const levels = [...bySpeaker.entries()].filter(([, e]) => e.count > 0).map(([speaker, e]) => [speaker, Math.sqrt(e.sum / e.count)]);
  if (levels.length < 2) return gains;

  const sorted = levels.map(([, level]) => level).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const target = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  for (const [speaker, level] of levels) {
    let gain = Math.min(MAX_GAIN, Math.max(MIN_GAIN, target / level));
    const top = bySpeaker.get(speaker).peak;
    if (top * gain > PEAK_CEILING) gain = Math.max(Math.min(1, gain), PEAK_CEILING / top);
    gains.set(speaker, gain);
  }
  return gains;
};

/**
 * Renders placed clips into a mix and one stem per speaker.
 *
 * `clips[i]` is a renderTimeline clip plus `speaker`; a clip's own `gain`
 * (one the user set on the line) goes on top of its speaker's. Options are
 * those of renderTimeline plus `peak` (see MIX_PEAK_MODES), `matchSpeakers`
 * and `gains`: speaker gains already worked out (a Map, as speakerGains
 * returns), used as they are, so a re-render of edited lines keeps the gains
 * the sync chose. `log` receives what the mix render did to each clip. Returns
 * `{ mix, stems: [{ speaker, samples }], report }`, `report` being
 * `{ speakers, peakDb, peakAt, overFullScale, peak, loweredDb, gains }`.
 */
export const mixSpeakers = (
  clips,
  { sampleRate, length = 0, runOut = 0.3, fadeSeconds, peak = 'float', matchSpeakers = false, gains: given, log } = {}
) => {
  const mode = MIX_PEAK_MODES.includes(peak) ? peak : 'float';
  const gains = given instanceof Map ? given : matchSpeakers ? speakerGains(clips, sampleRate) : new Map();
  const placed = clips.map((clip) => ({ ...clip, gain: (gains.get(clip.speaker) ?? 1) * (Number.isFinite(clip.gain) ? clip.gain : 1) }));

  const mix = renderTimeline(placed, { sampleRate, length, runOut, fadeSeconds, limitPeak: false, log });

  let top = 0;
  let topAt = 0;
  for (let i = 0; i < mix.length; i++) {
    const level = Math.abs(mix[i]);
    if (level > top) {
      top = level;
      topAt = i;
    }
  }
  const overFullScale = top > 1;
  let loweredDb = 0;
  if (overFullScale && mode === 'lower') {
    const gain = 1 / top;
    for (let i = 0; i < mix.length; i++) mix[i] *= gain;
    loweredDb = toDb(top);
  }

  const speakers = [...new Set(clips.map((clip) => clip.speaker))];
  const stems = speakers.map((speaker) => ({
    speaker,
    samples: renderTimeline(
      placed.filter((clip) => clip.speaker === speaker),
      { sampleRate, length: mix.length / sampleRate, runOut: 0, fadeSeconds, limitPeak: false }
    ),
  }));

  return {
    mix,
    stems,
    report: {
      speakers,
      peakDb: toDb(top),
      peakAt: topAt / sampleRate,
      overFullScale,
      peak: mode,
      loweredDb,
      gains: Object.fromEntries([...gains.entries()].map(([speaker, gain]) => [speaker, toDb(gain) ?? 0])),
    },
  };
};
