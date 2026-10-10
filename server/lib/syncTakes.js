/**
 * Takes: new readings of one synced line, voiced on demand after Sync, for
 * the user to hear side by side and pick from. Nothing here places a line or
 * renders the dub: a take goes into the dub's bank as a line of its own, and
 * Edit timing renders the dub with whichever take the user picked.
 *
 * - A whole-line take is voiced and fitted exactly as Sync fits a line
 *   (breaths silenced when the sync did, trimmed to the silence around it).
 * - A phrase take voices only some words of the line, read with the words
 *   either side as context, and puts them in place of those words in the
 *   line's current take. Both joins are at the quietest point of the pause
 *   between words, so every sample either side is copied untouched: no fade,
 *   no gain and no resample.
 * - A direction (faster, slower, calmer, more energy) changes how the voice is
 *   asked to read the line, never its words, and never the audio afterwards.
 */
import { prepareClip, removeBreaths } from './syncRender.js';
import { dbToAmplitude } from './syncSettings.js';
import { speechLoudness, matchGainTo } from './loudness.js';
import { quietestPoint } from './dubTakes.js';

/** How a take may be read differently from the line as Sync voiced it. */
export const TAKE_DIRECTIONS = ['same', 'faster', 'slower', 'calmer', 'energy'];

/** Takes voiced per request, at most. Each costs a voicing of the line (or phrase). */
export const MAX_TAKES_PER_REQUEST = 5;

/** ElevenLabs takes 0.7-1.2 for `speed`, Cartesia 0.6-1.5. */
const SPEED_RANGE = { elevenlabs: [0.7, 1.2], cartesia: [0.6, 1.5] };
/** How much faster or slower a directed take is asked to read. */
const SPEED_STEP = 0.08;
/** How far a calmer or livelier take moves ElevenLabs stability and style. */
const SETTLE_STEP = 0.15;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const round2 = (value) => Math.round(value * 100) / 100;

/**
 * The voice settings a directed take is read with. `settings` are the ones the
 * line was voiced with (already tuned as the sync tuned them); `engine` is
 * 'elevenlabs' or 'cartesia'. 'same' changes nothing.
 */
export const directedSettings = (settings, direction, engine) => {
  const base = settings && typeof settings === 'object' ? { ...settings } : {};
  if (!TAKE_DIRECTIONS.includes(direction) || direction === 'same') return settings;
  const [low, high] = SPEED_RANGE[engine] || SPEED_RANGE.elevenlabs;
  const speed = typeof base.speed === 'number' && Number.isFinite(base.speed) ? base.speed : 1;
  if (direction === 'faster') return { ...base, speed: round2(clamp(speed + SPEED_STEP, low, high)) };
  if (direction === 'slower') return { ...base, speed: round2(clamp(speed - SPEED_STEP, low, high)) };
  if (engine === 'cartesia') return { ...base, emotion: direction === 'calmer' ? 'calm' : 'confident' };
  const stability = typeof base.stability === 'number' ? base.stability : 0.5;
  const style = typeof base.style === 'number' ? base.style : 0;
  return direction === 'calmer'
    ? { ...base, stability: round2(clamp(stability + SETTLE_STEP, 0, 1)), style: round2(clamp(style - SETTLE_STEP, 0, 1)) }
    : { ...base, stability: round2(clamp(stability - SETTLE_STEP, 0, 1)), style: round2(clamp(style + SETTLE_STEP * 2, 0, 1)) };
};

/**
 * A voiced take fitted as Sync fits a line: breaths silenced when `join` says
 * so, then trimmed to the silence around it. Null for a take with no sound.
 */
export const fitTake = (decoded, sampleRate, join) => {
  const { samples } = join.removeBreaths ? removeBreaths(decoded, sampleRate) : { samples: decoded };
  const clip = prepareClip(samples, sampleRate, { tailQuiet: dbToAmplitude(join.tailFloorDb), tailHold: join.tailHold });
  return clip ? { samples: clip.samples, lead: clip.lead, speech: clip.speech, cutOff: clip.cutOff } : null;
};

/** Length of the window the quietest join is looked for with (as dubTakes.js cuts lines). */
const QUIET_WINDOW_SECONDS = 0.01;

/**
 * Where the phrase sits in the line's take: the samples to keep before it
 * (`[0, from)`) and after it (`[to, end)`), each join at the quietest point
 * of the half of the pause nearer the phrase, so the pauses either side stay
 * as the line had them. `spans` maps 'before', 'phrase' and 'after' to
 * `{ start, end }` seconds (forced alignment, see cueSpans); a missing side
 * keeps nothing on that side.
 */
export const phraseCut = (samples, spans, sampleRate) => {
  const window = Math.max(1, Math.round(QUIET_WINDOW_SECONDS * sampleRate));
  const phrase = spans.get('phrase');
  if (!phrase) return null;
  const before = spans.get('before');
  const after = spans.get('after');
  const from = before
    ? quietestPoint(samples, ((before.end + Math.max(before.end, phrase.start)) / 2) * sampleRate, phrase.start * sampleRate, window)
    : 0;
  const to = after
    ? quietestPoint(samples, phrase.end * sampleRate, ((phrase.end + Math.max(phrase.end, after.start)) / 2) * sampleRate, window)
    : samples.length;
  return to > from ? { from, to } : null;
};

/**
 * The line with its phrase read again: the take's samples before `cut.from`,
 * the new reading, and the take's samples from `cut.to`, each copied as it
 * is. The result is fitted again (trimmed to the silence around it, never
 * inside) so its lead and speech are measured as any line's are.
 */
export const splicePhrase = (lineSamples, cut, phraseClip, sampleRate, join) => {
  const head = lineSamples.subarray(0, cut.from);
  const tail = lineSamples.subarray(cut.to);
  const out = new Float32Array(head.length + phraseClip.samples.length + tail.length);
  out.set(head, 0);
  out.set(phraseClip.samples, head.length);
  out.set(tail, head.length + phraseClip.samples.length);
  const clip = prepareClip(out, sampleRate, { tailQuiet: dbToAmplitude(join.tailFloorDb), tailHold: join.tailHold });
  return clip ? { samples: clip.samples, lead: clip.lead, speech: clip.speech, cutOff: clip.cutOff } : null;
};

/**
 * The gain that brings a take to the level its line had in the dub, when the
 * sync evened out loudness: the old take's speech loudness times the gain the
 * sync gave it. 1 when there is nothing to match.
 */
export const takeGain = (takeSamples, lineSamples, lineGain, sampleRate) => {
  const level = speechLoudness(lineSamples, sampleRate);
  if (level === null || !(lineGain > 0)) return 1;
  return matchGainTo(takeSamples, sampleRate, level * lineGain);
};
