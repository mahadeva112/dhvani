/**
 * Audio side of a synced dub: trimming clips, shortening their pauses, and
 * rendering every placed clip into one track.
 *
 * Nothing here changes the voice. A clip's audio is copied sample for sample:
 * no speed change, no pitch change and no fades. The only edits are cuts, and
 * every cut is made inside true silence (QUIET for at least QUIET_RUN_SECONDS),
 * so a word's natural decay and every breath are kept whole and no cut can be
 * heard as a click. A word is never cut off to make room.
 */
import { matchingGains } from './audioJoin.js';

/** About -50 dBFS: louder than this is speech, for finding where a line's first and last words are. */
const SPEECH_THRESHOLD = 0.0032;

/** About -60 dBFS. Audio this quiet for QUIET_RUN_SECONDS is silence, and only silence is ever cut. */
const QUIET = 0.001;
const QUIET_RUN_SECONDS = 0.02;

/** A pause inside a line is never shortened below this, so the line still breathes. */
export const MIN_INNER_PAUSE_SECONDS = 0.18;

/**
 * The first index at or after `from` where the audio has been quiet for
 * `run` samples, i.e. where a cut is inaudible; `samples.length` when the
 * audio never goes quiet.
 */
const quietAfter = (samples, from, run) => {
  let count = 0;
  for (let i = from; i < samples.length; i++) {
    count = Math.abs(samples[i]) < QUIET ? count + 1 : 0;
    if (count >= run) return i + 1;
  }
  return samples.length;
};

/** The last index at or before `from` such that the `run` samples after it are quiet; 0 when none are. */
const quietBefore = (samples, from, run) => {
  let count = 0;
  for (let i = from; i >= 0; i--) {
    count = Math.abs(samples[i]) < QUIET ? count + 1 : 0;
    if (count >= run) return i;
  }
  return 0;
};

/**
 * The part of a generated clip from the silence before its first sound to the
 * silence after its last one, decay and breaths included. Returns
 * `{ samples, lead, speech }` — `lead` is the seconds before the first word and
 * `speech` the seconds from first to last word — or null when the clip is silent.
 */
export const prepareClip = (samples, sampleRate) => {
  let first = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > SPEECH_THRESHOLD) {
      first = i;
      break;
    }
  }
  if (first === -1) return null;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) <= SPEECH_THRESHOLD) last--;

  const run = Math.max(1, Math.round(QUIET_RUN_SECONDS * sampleRate));
  const start = quietBefore(samples, first - 1, run);
  const end = quietAfter(samples, last + 1, run);
  return {
    samples: samples.slice(start, end),
    lead: (first - start) / sampleRate,
    speech: (last + 1 - first) / sampleRate,
  };
};

/**
 * Stretches of true silence between the words of a clip, as `{ start, end }`
 * sample ranges, longest first. A breath inside a pause is not silence, so it
 * splits the pause in two and is never cut.
 */
const innerPauses = (samples, sampleRate) => {
  const run = Math.max(1, Math.round(QUIET_RUN_SECONDS * sampleRate));
  const pauses = [];
  let runStart = -1;
  for (let i = 0; i <= samples.length; i++) {
    const quiet = i < samples.length && Math.abs(samples[i]) < QUIET;
    if (quiet && runStart === -1) runStart = i;
    if (!quiet && runStart !== -1) {
      // Silence touching the clip's start or end is its lead-in or tail, not a pause between words.
      if (runStart > 0 && i < samples.length && i - runStart >= run) pauses.push({ start: runStart, end: i });
      runStart = -1;
    }
  }
  return pauses.sort((a, b) => b.end - b.start - (a.end - a.start));
};

/**
 * Shortens the pauses between words in a clip by up to `seconds` in total,
 * taking from the longest pauses first and never leaving one shorter than
 * MIN_INNER_PAUSE_SECONDS. Only silence is removed: each pause loses its
 * middle, and the audio either side of every cut is silent, so the cut can't
 * be heard. Returns `{ samples, removed }`.
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
    const start = Math.round((pause.start + pause.end - take) / 2);
    cuts.push({ start, end: start + take });
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
 * is brought to the same speech loudness (one gain for the whole clip) and
 * copied in as it is, with no fades: each clip already starts and ends in
 * silence. Clips are mixed rather than overwritten, so even a mistaken
 * overlap would be heard rather than silently cut.
 */
export const renderTimeline = (clips, { sampleRate, length = 0, runOut = 0.3 }) => {
  const gains = matchingGains(clips.map((clip) => clip.samples), sampleRate);

  const starts = clips.map((clip) => Math.max(0, Math.round(clip.position * sampleRate)));
  const lastEnd = clips.reduce((max, clip, i) => Math.max(max, starts[i] + clip.samples.length), 0);
  const total = Math.max(Math.round(length * sampleRate), lastEnd + Math.round(runOut * sampleRate));

  const output = new Float32Array(total);
  clips.forEach((clip, n) => {
    const { samples } = clip;
    const offset = starts[n];
    const gain = gains[n];
    for (let i = 0; i < samples.length; i++) output[offset + i] += samples[i] * gain;
  });

  // Mixing can only exceed full scale where clips overlap; keep the peak legal.
  let top = 0;
  for (let i = 0; i < output.length; i++) top = Math.max(top, Math.abs(output[i]));
  if (top > 0.98) for (let i = 0; i < output.length; i++) output[i] *= 0.98 / top;

  return output;
};
