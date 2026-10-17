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
  /**
   * Chunk sync: each line is split where it goes quiet, as REAPER's Dynamic
   * split does, and its chunks placed one by one on the original's words, as
   * Samanvaya places them (see chunkSync.js). Off: each line is placed whole.
   */
  chunkSync: true,
  /** The gate opens at this level (dBFS)... */
  gateOpenDb: -40,
  /** ...and closes this far below it, so a word's dying sound stays in its chunk. */
  gateHysteresisDb: -15,
  /** A slice shorter than this is not cut out on its own. */
  minSliceLength: 0.1,
  /** A silence shorter than this doesn't split. */
  minSilenceLength: 0.15,
  /** Kept before each chunk's first sound, and after its last. */
  leadPad: 0.01,
  trailPad: 0.02,
  /** A pause between chunks may shrink to this share of what the voice left (Samanvaya: half)... */
  chunkGapShare: 0.5,
  /** ...but never below this between words, at a comma, or at a sentence end... */
  wordGap: 0.12,
  commaGap: 0.18,
  stopGap: 0.25,
  /** ...and no chunk need wait longer than this after the one before. */
  maxChunkGap: 1,
  /** Shrink pauses between words first, then at commas, sentence ends last. */
  punctuationPriority: true,
  /**
   * Fit by voice speed: a line still too long with every pause shrunk is
   * voiced again, read faster by the voice itself (its speed setting, not a
   * stretch), up to `maxVoiceSpeed` times its own speed. Chunk sync only.
   */
  speedFit: true,
  maxVoiceSpeed: 1.15,
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
  breathReduction: 1,
  /** Take silence out of the pauses inside a line that runs long. */
  shortenPauses: true,
  /** A pause inside a line is never shortened below this. */
  minInnerPause: 0.25,
  /** The most of any one pause that may be taken out. */
  maxPauseTake: 0.4,
  /**
   * Pause only where the original speaker did: a pause inside a line that the
   * original has no pause for is cut to `unmatchedPause`, and one it has is
   * kept to the original's length, whether the line fits or not (see sourcePauses.js).
   */
  matchSourcePauses: true,
  /** What a pause the original doesn't have is cut to. */
  unmatchedPause: 0.15,
  /**
   * A line still too long once its pauses are shortened loses silence measured
   * against its own room tone: its tail, then its pauses (see tightenSilences).
   * Words are never cut. Blends each cut inside a pause over 5 ms.
   */
  tightenSilences: true,
  /** A pause Tighten silences shortens keeps at least this. */
  tightMinPause: 0.15,
  /** Silence Tighten silences leaves either side of every sound. */
  tightMargin: 0.08,
  /** Time the words of a line with forced alignment before Tighten silences cuts it, and keep every cut clear of them. */
  checkCutWords: true,
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
  /**
   * How much harder a line after a long pause, or by a new speaker, pulls to
   * start on time than a line in the middle of a thought: the lines around it
   * take up the difference.
   */
  anchorWeight: 3,
  /** Must end by: the dub's last line ends by the original's end, give or take `endSlack` seconds. */
  endByVideo: false,
  endSlack: 0.5,
  /** Cues closer together than this, by the same speaker, are voiced as one line. */
  unitGap: 0.4,
  /** A joined line is never longer than this. */
  maxUnit: 12,
  /** A join with less than this between one line's last word and the next one's first is flagged. */
  flagJoin: 0.15,
  preserveLongPauses: false,
  protectedPause: 1.2,
});

/** A long source pause lends everything past this to a line that runs long. */
export const MAX_KEPT_PAUSE_SECONDS = 0.6;

/**
 * What each setting may be set to; anything outside is brought back inside.
 * The app reads saved settings with this same table (components/SyncJoinSettings.tsx),
 * so this module stays free of imports.
 */
export const JOIN_SETTING_RANGES = {
  minGap: [0.04, 0.6],
  speakerGap: [0.04, 1],
  gapShare: [0, 1],
  minInnerPause: [0.08, 0.6],
  maxPauseTake: [0.05, 1],
  unmatchedPause: [0.06, 0.6],
  gateOpenDb: [-70, -10],
  gateHysteresisDb: [-40, 0],
  minSliceLength: [0.02, 1],
  minSilenceLength: [0.05, 1],
  leadPad: [0, 0.2],
  trailPad: [0, 0.3],
  chunkGapShare: [0, 1],
  wordGap: [0.03, 0.5],
  commaGap: [0.03, 0.8],
  stopGap: [0.03, 1],
  maxChunkGap: [0.2, 3],
  maxVoiceSpeed: [1, 1.2],
  tightMinPause: [0.06, 0.4],
  tightMargin: [0.03, 0.2],
  spliceCrossfade: [0, 0.02],
  tailFloorDb: [-90, -50],
  tailHold: [0, 0.2],
  edgeFade: [0, 0.03],
  maxLateStart: [0.05, 1.5],
  anchorWeight: [1, 20],
  endSlack: [0, 5],
  unitGap: [0, 1.2],
  maxUnit: [3, 30],
  flagJoin: [0, 0.5],
  protectedPause: [0.5, 5],
  breathReduction: [0, 1],
};

const clamp = (value, [low, high]) => Math.min(high, Math.max(low, value));

/** The join settings to sync with: `requested` where it gives a usable value, the default everywhere else. */
export const resolveJoinSettings = (requested) => {
  const settings = { ...DEFAULT_JOIN_SETTINGS };
  if (!requested || typeof requested !== 'object') return settings;
  for (const [key, range] of Object.entries(JOIN_SETTING_RANGES)) {
    const value = Number(requested[key]);
    if (requested[key] !== undefined && requested[key] !== null && Number.isFinite(value)) settings[key] = clamp(value, range);
  }
  for (const key of ['chunkSync', 'punctuationPriority', 'speedFit', 'endByVideo', 'breathClear', 'removeBreaths', 'shortenPauses', 'matchSourcePauses', 'tightenSilences', 'checkCutWords', 'preserveLongPauses']) {
    if (typeof requested[key] === 'boolean') settings[key] = requested[key];
  }
  return settings;
};

/** Linear amplitude of a level in dBFS. */
export const dbToAmplitude = (db) => 10 ** (db / 20);
