/**
 * Audio side of a synced dub: trimming clips, shortening their pauses, and
 * rendering every placed clip into one track.
 *
 * Nothing here changes the voice. A clip's audio is copied sample for sample:
 * no speed change, no pitch change, no gain and no fades. The only edits are
 * cuts, and every cut is made inside true silence (QUIET for at least
 * QUIET_RUN_SECONDS), so a word's natural decay and every breath are kept
 * whole and no cut can be heard as a click. A word is never cut off to make
 * room.
 *
 * The one place a clip can meet the track somewhere that isn't silent is its
 * own edge: a voice that stops (or starts) with no silence around it, or a
 * line cut at 0:00. Placed against silence, a sample that isn't near zero is
 * a step, and a step clicks. There the edge moves to the nearest quiet sample
 * within EDGE_SEARCH_SECONDS, and only when there is none does the edge get a
 * MICRO_FADE_SECONDS fade, in the render, never in the clip.
 *
 * Two opt-in settings do change the audio (see syncSettings.js): a crossfade
 * at each pause cut, and a longer fade than the micro-fade for an edge that
 * stops on sound. Both are off unless asked for.
 */
import { matchingGains } from './loudness.js';

/** Raised-cosine weight for sample `i` of a fade `length` samples long, rising from 0 to 1. */
const fadeWeight = (i, length) => 0.5 - 0.5 * Math.cos((Math.PI * (i + 0.5)) / length);

/** About -50 dBFS: louder than this is speech, for finding where a line's first and last words are. */
const SPEECH_THRESHOLD = 0.0032;

/** About -60 dBFS. Audio this quiet for QUIET_RUN_SECONDS is silence, and only silence is ever cut. */
const QUIET = 0.001;
const QUIET_RUN_SECONDS = 0.02;

/**
 * About -40 dBFS: a clip that is this loud within its last CUT_OFF_WINDOW_SECONDS,
 * with no silence after its last word, was stopped by the voice mid-word. A
 * clip that only trails off in breath or room noise is not.
 */
const CUT_OFF_LEVEL = 0.01;
const CUT_OFF_WINDOW_SECONDS = 0.01;

/** A pause inside a line is never shortened below this, so the line still breathes. */
export const MIN_INNER_PAUSE_SECONDS = 0.18;

/** How far into a clip an edge may move to reach a quiet sample, so no syllable is lost. */
export const EDGE_SEARCH_SECONDS = 0.005;

/** The fade an edge gets when no quiet sample is that close: too short to hear as a fade. */
export const MICRO_FADE_SECONDS = 0.003;

/**
 * The first index at or after `from` where the audio has been quiet for
 * `run` samples, i.e. where a cut is inaudible; -1 when the audio never goes
 * quiet that long.
 */
const quietAfter = (samples, from, run, quiet = QUIET) => {
  let count = 0;
  for (let i = from; i < samples.length; i++) {
    count = Math.abs(samples[i]) < quiet ? count + 1 : 0;
    if (count >= run) return i + 1;
  }
  return -1;
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
 * `{ samples, lead, speech, start, end, cutOff }` — `lead` is the seconds
 * before the first word, `speech` the seconds from first to last word,
 * `start`/`end` the range of the clip kept, and `cutOff` true when the clip
 * ends at speech level, before its last sound has died away (the voice
 * stopped mid-word; the clip is kept as it is) — or null when the clip is silent.
 *
 * `tailQuiet` is how quiet (linear) the audio after the last word must stay
 * before the tail ends; a lower level keeps more of a voice's decay.
 * `tailHold` keeps that many more seconds after it, as far as the clip goes.
 * Either way the tail ends inside silence.
 */
export const prepareClip = (samples, sampleRate, { tailQuiet = QUIET, tailHold = 0 } = {}) => {
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
  const tail = quietAfter(samples, last + 1, run, Math.min(QUIET, tailQuiet));
  let endPeak = 0;
  for (let i = Math.max(0, samples.length - Math.round(CUT_OFF_WINDOW_SECONDS * sampleRate)); i < samples.length; i++) endPeak = Math.max(endPeak, Math.abs(samples[i]));
  const end = Math.min(samples.length, (tail === -1 ? samples.length : tail) + Math.round(Math.max(0, tailHold) * sampleRate));
  return {
    samples: samples.slice(start, end),
    lead: (first - start) / sampleRate,
    speech: (last + 1 - first) / sampleRate,
    start,
    end,
    cutOff: quietAfter(samples, last + 1, run) === -1 && endPeak >= CUT_OFF_LEVEL,
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
 * `minPause` (MIN_INNER_PAUSE_SECONDS unless given) and never taking more
 * than `maxTake` of any one pause. Only silence is removed: each pause loses
 * its middle, and the audio either side of every cut is silent, so the cut
 * can't be heard. `crossfade` (seconds, 0 by default) blends the two sides of
 * each cut with an equal-power crossfade instead, for room tone that differs
 * either side; it changes those samples. Returns `{ samples, removed, cuts }`,
 * `cuts` being the sample ranges taken out, in order.
 */
export const shortenPauses = (samples, sampleRate, seconds, { minPause = MIN_INNER_PAUSE_SECONDS, maxTake = 1, crossfade = 0 } = {}) => {
  const floor = Math.round(minPause * sampleRate);
  let budget = Math.round(Math.max(0, seconds) * sampleRate);
  const cuts = [];
  for (const pause of innerPauses(samples, sampleRate)) {
    if (budget <= 0) break;
    const length = pause.end - pause.start;
    const spare = Math.min(length - floor, Math.floor(Math.max(0, maxTake) * length));
    if (spare <= 0) continue;
    const take = Math.min(spare, budget);
    const start = Math.round((pause.start + pause.end - take) / 2);
    cuts.push({ start, end: start + take });
    budget -= take;
  }
  if (cuts.length === 0) return { samples, removed: 0, cuts };

  cuts.sort((a, b) => a.start - b.start);
  const output = applyCuts(samples, cuts, Math.round(Math.max(0, crossfade) * sampleRate));
  return { samples: output, removed: (samples.length - output.length) / sampleRate, cuts };
};

/**
 * Takes `cuts` (sample ranges in order, as shortenPauses returns them) out of
 * `samples`, blending each join over `blend` samples (0 for a plain cut). The
 * same cuts and blend on the same samples give the same samples, so a sync can
 * rebuild a line exactly as an earlier one cut it.
 */
export const applyCuts = (samples, cuts, blend = 0) => {
  if (cuts.length === 0) return samples;
  const removedSamples = cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0);
  const output = new Float32Array(samples.length - removedSamples);
  let from = 0;
  let to = 0;
  for (const cut of cuts) {
    // The last `fade` samples before the cut fade out over the last `fade` samples it removes, which fade in.
    const fade = Math.min(blend, cut.end - cut.start, cut.start - from);
    output.set(samples.subarray(from, cut.start - fade), to);
    to += cut.start - fade - from;
    for (let k = 0; k < fade; k++) {
      const t = ((k + 0.5) / fade) * (Math.PI / 2);
      output[to + k] = samples[cut.start - fade + k] * Math.cos(t) + samples[cut.end - fade + k] * Math.sin(t);
    }
    to += fade;
    from = cut.end;
  }
  output.set(samples.subarray(from), to);
  return output;
};

/**
 * Where to start a clip that must lose its first `from` samples (the part
 * before 0:00). The kept part must begin on a quiet sample: the first one at
 * or after `from` but before the first word at `firstWord`, or else the last
 * one before `from`, keeping up to EDGE_SEARCH_SECONDS more and starting the
 * clip `delay` samples later. A first word's attack is never faded to hide a
 * cut. Returns `{ from, delay }`; with no quiet sample that close, `from` as
 * given and no delay.
 */
export const startAfterCut = (samples, from, firstWord, sampleRate) => {
  const limit = Math.round(EDGE_SEARCH_SECONDS * sampleRate);
  const quiet = (i) => Math.abs(samples[i]) < QUIET;
  for (let i = from; i < Math.min(firstWord, from + limit + 1); i++) if (quiet(i)) return { from: i, delay: 0 };
  for (let i = from - 1; i >= Math.max(0, from - limit); i--) if (quiet(i)) return { from: i, delay: from - i };
  return { from, delay: 0 };
};

/**
 * Where a clip may start and end so neither edge steps against silence.
 * An edge that is already quiet stays put. Otherwise it moves inward to the
 * first quiet sample within `startLimit` (start) or `endLimit` (end) samples,
 * dropping only what lies beyond it; an edge with no quiet sample that close
 * stays put and is marked for a micro-fade. An edge that is `joined` to the
 * rest of its own source (see renderTimeline) meets no silence, and is left
 * exactly as it is. Returns `{ from, to, fadeIn, fadeOut }`: the range to copy
 * and the fade lengths in samples (0 for none).
 */
export const clipEdges = (samples, { startLimit, endLimit, fadeLength, joinedStart = false, joinedEnd = false }) => {
  const quiet = (i) => Math.abs(samples[i]) < QUIET;
  const length = samples.length;

  let from = 0;
  let fadeIn = 0;
  if (length > 0 && !joinedStart && !quiet(0)) {
    let i = 1;
    while (i <= Math.min(startLimit, length - 1) && !quiet(i)) i++;
    if (i <= Math.min(startLimit, length - 1)) from = i;
    else fadeIn = fadeLength;
  }

  let to = length;
  let fadeOut = 0;
  if (length > from && !joinedEnd && !quiet(length - 1)) {
    let i = length - 2;
    while (i >= Math.max(from, length - 1 - endLimit) && !quiet(i)) i--;
    if (i >= Math.max(from, length - 1 - endLimit)) to = i + 1;
    else fadeOut = fadeLength;
  }

  const half = Math.floor((to - from) / 2);
  return { from, to, fadeIn: Math.min(fadeIn, half), fadeOut: Math.min(fadeOut, half) };
};

/**
 * Renders placed clips into one mono track at least `length` seconds long.
 * `clips[i]` is `{ samples, position | startSample, maxStartShift?, gain?,
 * fadeInSamples?, fadeOutSamples? }`: where the clip's first sample goes, in
 * seconds or as a whole sample, how many samples its start edge may move
 * (EDGE_SEARCH_SECONDS unless less is allowed), a gain asked for by the caller
 * (1 unless given) and fades the user drew on the line in Edit timing (none
 * unless given), raised-cosine, over the clip as copied.
 *
 * Each clip is copied in sample for sample at a gain of 1, at a whole-sample
 * offset (rounded once from `position`). Moving an edge (see clipEdges) only
 * drops samples at that edge; every other sample stays exactly where it was.
 * Two clips that are neighbouring views of one source (the second's samples
 * start where the first's end, in memory and on the timeline) are joined: the
 * join is left alone and plays straight through, sample N then N + 1.
 * Clips are mixed rather than overwritten, so even a mistaken overlap would
 * be heard rather than silently cut.
 *
 * `matchLoudness` first brings every clip to the same speech loudness (one
 * gain per clip). It is off unless asked for, since it changes how each line
 * was voiced. `fadeSeconds` is the fade an edge that stops on sound gets
 * (MICRO_FADE_SECONDS unless asked for longer). A mix that would clip is
 * turned down as a whole unless `limitPeak` is false. `log`, when given, is
 * called once per clip with exactly what the render did to it.
 */
export const renderTimeline = (
  clips,
  { sampleRate, length = 0, runOut = 0.3, matchLoudness = false, fadeSeconds = MICRO_FADE_SECONDS, limitPeak = true, log } = {}
) => {
  const matched = matchLoudness ? matchingGains(clips.map((clip) => clip.samples), sampleRate) : clips.map(() => 1);
  const gains = clips.map((clip, n) => matched[n] * (Number.isFinite(clip.gain) ? clip.gain : 1));
  const searchLimit = Math.round(EDGE_SEARCH_SECONDS * sampleRate);
  const fadeLength = Math.max(1, Math.round(Math.max(MICRO_FADE_SECONDS, fadeSeconds) * sampleRate));

  const starts = clips.map((clip) => Math.max(0, Number.isInteger(clip.startSample) ? clip.startSample : Math.round(clip.position * sampleRate)));
  const continues = (a, b) =>
    clips[a].samples.buffer === clips[b].samples.buffer &&
    clips[a].samples.byteOffset + clips[a].samples.byteLength === clips[b].samples.byteOffset &&
    starts[a] + clips[a].samples.length === starts[b];

  const placements = clips.map((clip, n) => {
    const edges = clipEdges(clip.samples, {
      startLimit: Math.min(searchLimit, clip.maxStartShift ?? searchLimit),
      endLimit: searchLimit,
      fadeLength,
      joinedStart: clips.some((_, m) => m !== n && continues(m, n)),
      joinedEnd: clips.some((_, m) => m !== n && continues(n, m)),
    });
    return { ...edges, start: starts[n] + edges.from };
  });
  const lastEnd = placements.reduce((max, p) => Math.max(max, p.start + p.to - p.from), 0);
  const total = Math.max(Math.round(length * sampleRate), lastEnd + Math.round(runOut * sampleRate));

  const output = new Float32Array(total);
  clips.forEach((clip, n) => {
    const { samples } = clip;
    const { from, to, fadeIn, fadeOut, start } = placements[n];
    const gain = gains[n];
    const span = to - from;
    const half = Math.floor(span / 2);
    const userIn = Math.min(half, Math.max(0, Math.round(clip.fadeInSamples || 0)));
    const userOut = Math.min(half, Math.max(0, Math.round(clip.fadeOutSamples || 0)));
    for (let i = 0; i < span; i++) {
      let weight = gain;
      if (i < fadeIn) weight *= fadeWeight(i, fadeIn);
      if (i >= span - fadeOut) weight *= fadeWeight(span - 1 - i, fadeOut);
      if (i < userIn) weight *= fadeWeight(i, userIn);
      if (i >= span - userOut) weight *= fadeWeight(span - 1 - i, userOut);
      output[start + i] += samples[from + i] * weight;
    }
  });

  // Only a mix that would clip is turned down, and then the whole track by one
  // gain. With `limitPeak` off the mix is left as summed, for a float file.
  let top = 0;
  if (limitPeak) for (let i = 0; i < output.length; i++) top = Math.max(top, Math.abs(output[i]));
  const peakGain = top > 1 ? 1 / top : 1;
  if (peakGain < 1) for (let i = 0; i < output.length; i++) output[i] *= peakGain;

  if (log) {
    placements.forEach(({ from, to, fadeIn, fadeOut, start }, n) =>
      log({
        timelineStartSample: start,
        timelineEndSample: start + to - from,
        gain: gains[n] * peakGain,
        edgeTrimStartSamples: from,
        edgeTrimEndSamples: clips[n].samples.length - to,
        fadeInSamples: fadeIn,
        fadeOutSamples: fadeOut,
        microFade: fadeIn > 0 || fadeOut > 0,
        userFadeInSamples: Math.max(0, Math.round(clips[n].fadeInSamples || 0)),
        userFadeOutSamples: Math.max(0, Math.round(clips[n].fadeOutSamples || 0)),
      })
    );
  }
  return output;
};
