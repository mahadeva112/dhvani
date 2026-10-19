/**
 * Voice change line by line: each synced line of the dub put through the
 * voice changer on its own and fitted back to its old length, so it lands
 * exactly where it was. Edit timing's moves, trims, splits and fades name
 * samples inside a line; a line that keeps its length keeps every one of them.
 *
 * The fit is a stretch with the pitch kept (ffmpeg's atempo, passed in as
 * `stretch`), the same one Edit timing uses, and the app shows how much each
 * line was fitted. A line the voice changer gave back much longer or shorter
 * is fitted all the same and flagged, for the user to check.
 */

/** A line whose new take was off by more than this share of its length is flagged for the user to check. */
export const FLAG_SHARE = 0.05;

/** atempo's range; a take further off than this is padded or cut after the stretch. */
const MIN_RATE = 0.5;
const MAX_RATE = 2;

/** Under this share the take is only padded or cut by a few samples at its end, which is silence. */
const EXACT_SHARE = 0.0005;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** `samples` padded with silence, or cut, to exactly `length`. */
export const toLength = (samples, length) => {
  if (samples.length === length) return samples;
  const out = new Float32Array(length);
  out.set(samples.length > length ? samples.subarray(0, length) : samples, 0);
  return out;
};

/**
 * The take fitted to `length` samples. `stretch(samples, rate)` plays them
 * at `rate` with the pitch kept. Returns `{ samples, change }`, `change` how
 * much longer (positive) or shorter the take was than the line, as a share.
 */
export const fitToLength = async (samples, length, stretch) => {
  if (!(length > 0)) throw new Error('A line has no length to fit to.');
  const change = samples.length / length - 1;
  if (Math.abs(change) <= EXACT_SHARE) return { samples: toLength(samples, length), change };
  const rate = clamp(samples.length / length, MIN_RATE, MAX_RATE);
  const stretched = await stretch(samples, rate);
  return { samples: toLength(stretched, length), change };
};

/** Whether a line's change is big enough for the user to check it. */
export const needsCheck = (change) => Math.abs(change) > FLAG_SHARE;

/** The PCM rates ElevenLabs gives a voice change back in; a bank at another rate can't be changed without resampling. */
export const STS_PCM_RATES = [16000, 22050, 24000, 44100, 48000];
