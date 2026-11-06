/**
 * How much longer or shorter the dub runs than the original, in four bands:
 * the one table Fit to this video (syncFit.js), the length preset it picks
 * when Sync runs it, and the preset suggested after a sync
 * (services/syncPresets.ts) all read. A dub 6% long is Long everywhere.
 *
 * The ratio is the dub's speech over the original speaker's, line by line
 * (1.06 = 6% longer). The numbers are first guesses from fake-voice tests,
 * kept here, and only here, so a real-voice test can retune them.
 *
 * Plain JavaScript so the server imports it as it is and the app through Vite.
 */

/** Each band runs up to (not including) `below`; the last takes everything longer. */
export const LENGTH_BANDS = Object.freeze([
  Object.freeze({ preset: 'short', below: 0.95 }),
  Object.freeze({ preset: 'natural', below: 1.05 }),
  Object.freeze({ preset: 'long', below: 1.15 }),
  Object.freeze({ preset: 'vlong', below: Infinity }),
]);

/** The band (and length preset) for a dub that runs `ratio` times as long as the original. */
export const lengthBandFor = (ratio) => {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return 'natural';
  return LENGTH_BANDS.find((band) => value < band.below).preset;
};

/**
 * What Fit moves for each band, on the pauses only. A move never goes the
 * other way: `maxPauseTake` is only raised to its value, `gapShare` lowered
 * for a long dub and raised for a short one, so a setting already past it
 * stays as the user has it.
 *
 * - Short: keep more of each pause (gapShare at least 0.4).
 * - Long: shorten pauses inside a line, up to half of one (maxPauseTake 0.5).
 * - Very long: up to 60% of one, and a long pause lends more to the line before (gapShare at most 0.25).
 */
export const BAND_PAUSE_MOVES = Object.freeze({
  short: Object.freeze({ gapShareAtLeast: 0.4 }),
  natural: Object.freeze({}),
  long: Object.freeze({ shortenPauses: true, maxPauseTakeAtLeast: 0.5 }),
  vlong: Object.freeze({ shortenPauses: true, maxPauseTakeAtLeast: 0.6, gapShareAtMost: 0.25 }),
});
