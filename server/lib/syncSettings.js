/**
 * How a synced dub joins its lines: the gaps left between them, how far the
 * pauses inside a line may be shortened, where a line's tail ends, and when a
 * join is tight enough to flag. Times are in seconds, shares from 0 to 1.
 *
 * The defaults are the Natural preset (services/syncService.ts keeps the
 * presets the user picks from): every line gets room to breathe, and a breath
 * before a line never plays over the line before. `removeBreaths` silences
 * the voice's breaths (on by default, at the user's request); `spliceCrossfade`
 * and `edgeFade` change the audio too, and are off unless asked for; every
 * other setting only moves or trims clips inside silence, so the render
 * stays sample for sample what the voice made.
 */

export const DEFAULT_JOIN_SETTINGS = Object.freeze({
  /** Smallest silence between one line's tail and the next line's first sound. */
  minGap: 0.18,
  /** The same, where the speaker changes. */
  speakerGap: 0.25,
  /**
   * Share of the source pause the dub keeps at least (up to MAX_KEPT_PAUSE_SECONDS).
   * It only matters after a line that runs long, and the less it keeps, the more of
   * the pause that line may use before its own pauses are cut or the next line moves.
   */
  gapShare: 0.3,
  /** Space a line's whole pre-roll (breath, room noise) clear of the line before, instead of mixing it over its tail. */
  breathClear: true,
  /** Silence the breaths the voice makes before, between and after its words. Changes the audio. */
  removeBreaths: true,
  /** Take silence out of the pauses inside a line that runs long. */
  shortenPauses: true,
  /** A pause inside a line is never shortened below this. */
  minInnerPause: 0.25,
  /** The most of any one pause that may be taken out. */
  maxPauseTake: 0.4,
  /** Equal-power crossfade at each pause cut; 0 is a plain cut inside silence. Changes the audio. */
  spliceCrossfade: 0,
  /** A line's tail runs until the audio stays below this level, in dBFS. */
  tailFloorDb: -70,
  /** Silence kept after a line's tail before the line counts as finished. */
  tailHold: 0.04,
  /** Fade for an edge that stops on sound; 0 keeps the 3 ms micro-fade. Changes the audio. */
  edgeFade: 0,
  /** A line whose first word lands later than this after its source line is flagged. */
  maxLateStart: 0.25,
  /** Cues closer together than this, by the same speaker, are voiced as one line. */
  unitGap: 0.4,
  /** A joined line is never longer than this. */
  maxUnit: 12,
  /** A join with less than this between one line's last word and the next one's first is flagged. */
  flagJoin: 0.15,
});

/** A long source pause lends everything past this to a line that runs long. */
export const MAX_KEPT_PAUSE_SECONDS = 0.6;

/** What each setting may be set to; anything outside is brought back inside. */
const RANGES = {
  minGap: [0.04, 0.6],
  speakerGap: [0.04, 1],
  gapShare: [0, 1],
  minInnerPause: [0.08, 0.6],
  maxPauseTake: [0.05, 1],
  spliceCrossfade: [0, 0.02],
  tailFloorDb: [-90, -50],
  tailHold: [0, 0.2],
  edgeFade: [0, 0.03],
  maxLateStart: [0.05, 1.5],
  unitGap: [0, 1.2],
  maxUnit: [3, 30],
  flagJoin: [0, 0.5],
};

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

/** The join settings to sync with: `requested` where it gives a usable value, the default everywhere else. */
export const resolveJoinSettings = (requested) => {
  const settings = { ...DEFAULT_JOIN_SETTINGS };
  if (!requested || typeof requested !== 'object') return settings;
  for (const [key, range] of Object.entries(RANGES)) {
    const value = Number(requested[key]);
    if (requested[key] !== undefined && requested[key] !== null && Number.isFinite(value)) settings[key] = clamp(value, range);
  }
  for (const key of ['breathClear', 'removeBreaths', 'shortenPauses']) {
    if (typeof requested[key] === 'boolean') settings[key] = requested[key];
  }
  return settings;
};

/** Linear amplitude of a level in dBFS. */
export const dbToAmplitude = (db) => 10 ** (db / 20);
