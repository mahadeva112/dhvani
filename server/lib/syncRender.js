/**
 * Audio side of a synced dub: trimming clips, shortening their pauses, and
 * rendering every placed clip into one track.
 *
 * Nothing here changes the speed or pitch of the voice. A clip's words are
 * copied sample for sample; only silence is removed or added, every cut falls
 * inside silence, and every clip edge is faded so no join clicks.
 */
import { matchingGains, fadeWeight } from './audioJoin.js';

/** About -50 dBFS: quieter than this is silence when finding where speech starts and ends. */
const SILENCE_THRESHOLD = 0.0032;

/** Kept before the first word (soft onsets, plosives) and after the last (the word's decay). */
export const CLIP_LEAD_SECONDS = 0.03;
export const CLIP_TAIL_SECONDS = 0.08;

/** Fade at each clip edge: inaudible, but enough to stop a click. */
const FADE_SECONDS = 0.008;

/** A pause is found over windows this long whose level stays under PAUSE_GATE (about -48 dBFS). */
const PAUSE_WINDOW_SECONDS = 0.01;
const PAUSE_GATE = 0.004;

/** A pause inside a line is never shortened below this, so the line still breathes. */
export const MIN_INNER_PAUSE_SECONDS = 0.18;

/**
 * The part of a generated clip that holds speech, with a margin either side.
 * Returns `{ samples, lead, speech }` — `lead` is the seconds before the first
 * word and `speech` the seconds from first to last word — or null when the
 * clip is silent.
 */
export const prepareClip = (samples, sampleRate) => {
  let first = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > SILENCE_THRESHOLD) {
      first = i;
      break;
    }
  }
  if (first === -1) return null;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) <= SILENCE_THRESHOLD) last--;

  const start = Math.max(0, first - Math.round(CLIP_LEAD_SECONDS * sampleRate));
  const end = Math.min(samples.length, last + 1 + Math.round(CLIP_TAIL_SECONDS * sampleRate));
  return {
    samples: samples.slice(start, end),
    lead: (first - start) / sampleRate,
    speech: (last + 1 - first) / sampleRate,
  };
};

/** Silent stretches inside a clip, as `{ start, end }` sample ranges, longest first. */
const innerPauses = (samples, sampleRate) => {
  const size = Math.max(1, Math.round(PAUSE_WINDOW_SECONDS * sampleRate));
  const pauses = [];
  let runStart = -1;
  for (let start = 0; start < samples.length; start += size) {
    const end = Math.min(samples.length, start + size);
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    const silent = Math.sqrt(sum / (end - start)) < PAUSE_GATE;
    if (silent && runStart === -1) runStart = start;
    if (!silent && runStart !== -1) {
      // A run touching the clip's start is its lead-in, not a pause between words.
      if (runStart > 0) pauses.push({ start: runStart, end: start });
      runStart = -1;
    }
  }
  // A run still open at the end is the tail, not a pause.
  return pauses.sort((a, b) => b.end - b.start - (a.end - a.start));
};

/**
 * Shortens the pauses inside a clip by up to `seconds` in total, taking from
 * the longest pauses first and never leaving one shorter than
 * MIN_INNER_PAUSE_SECONDS. Each pause loses its middle, so the silence either
 * side of the words is untouched. Returns `{ samples, removed }`.
 */
export const shortenPauses = (samples, sampleRate, seconds) => {
  const floor = Math.round(MIN_INNER_PAUSE_SECONDS * sampleRate);
  let budget = Math.round(Math.max(0, seconds) * sampleRate);
  const cuts = [];
  for (const pause of innerPauses(samples, sampleRate)) {
    if (budget <= 0) break;
    const spare = pause.end - pause.start - floor;
    if (spare <= 0) continue;
    const take = Math.min(spare, budget);
    const middle = Math.round((pause.start + pause.end) / 2);
    cuts.push({ start: middle - Math.floor(take / 2), end: middle - Math.floor(take / 2) + take });
    budget -= take;
  }
  if (cuts.length === 0) return { samples, removed: 0 };

  cuts.sort((a, b) => a.start - b.start);
  const removedSamples = cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0);
  const output = new Float32Array(samples.length - removedSamples);
  let from = 0;
  let to = 0;
  for (const cut of cuts) {
    output.set(samples.subarray(from, cut.start), to);
    to += cut.start - from;
    from = cut.end;
  }
  output.set(samples.subarray(from), to);
  return { samples: output, removed: removedSamples / sampleRate };
};

/**
 * Renders placed clips into one mono track at least `length` seconds long.
 * `clips[i]` is `{ samples, position }` with `position` in seconds. Every clip
 * is brought to the same speech loudness and faded at its edges. Clips are
 * mixed rather than overwritten, so even a mistaken overlap would be heard
 * rather than silently cut.
 */
export const renderTimeline = (clips, { sampleRate, length = 0, runOut = 0.3 }) => {
  const gains = matchingGains(clips.map((clip) => clip.samples), sampleRate);
  const fadeLength = Math.max(1, Math.round(FADE_SECONDS * sampleRate));

  const starts = clips.map((clip) => Math.max(0, Math.round(clip.position * sampleRate)));
  const lastEnd = clips.reduce((max, clip, i) => Math.max(max, starts[i] + clip.samples.length), 0);
  const total = Math.max(Math.round(length * sampleRate), lastEnd + Math.round(runOut * sampleRate));

  const output = new Float32Array(total);
  clips.forEach((clip, n) => {
    const { samples } = clip;
    const fade = Math.min(fadeLength, Math.floor(samples.length / 2));
    const offset = starts[n];
    for (let i = 0; i < samples.length; i++) {
      let weight = gains[n];
      if (i < fade) weight *= fadeWeight(i, fade);
      if (i >= samples.length - fade) weight *= fadeWeight(samples.length - 1 - i, fade);
      output[offset + i] += samples[i] * weight;
    }
  });

  // Mixing can only exceed full scale where clips overlap; keep the peak legal.
  let top = 0;
  for (let i = 0; i < output.length; i++) top = Math.max(top, Math.abs(output[i]));
  if (top > 0.98) for (let i = 0; i < output.length; i++) output[i] *= 0.98 / top;

  return output;
};
