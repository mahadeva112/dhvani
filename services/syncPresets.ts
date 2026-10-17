import type { SyncJoinSettings } from './syncService';

/**
 * Line-join presets, by how long the dub runs against the original: Short
 * dub, Natural (about even), Long dub (5-15% longer), Very long dub (over
 * 15% longer). Each is Natural with a few settings changed. A preset never
 * changes the voice, the precision or the words.
 */
export type SyncJoinPreset = 'short' | 'natural' | 'long' | 'vlong' | 'custom';

/** What is on screen, on top of the length preset: anything, a voice-over, or faces. */
export type SyncScreen = 'any' | 'narration' | 'camera';

const NATURAL_JOIN: SyncJoinSettings = {
    chunkSync: true,
    gateOpenDb: -40,
    gateHysteresisDb: -15,
    minSliceLength: 0.1,
    minSilenceLength: 0.15,
    leadPad: 0.01,
    trailPad: 0.02,
    chunkGapShare: 0.5,
    wordGap: 0.12,
    commaGap: 0.18,
    stopGap: 0.25,
    maxChunkGap: 1,
    punctuationPriority: true,
    speedFit: 'ask',
    maxVoiceSpeed: 1.15,
    bestTakes: 'ask',
    maxRevoice: 20,
    minGap: 0.18,
    speakerGap: 0.25,
    gapShare: 0.3,
    breathClear: true,
    removeBreaths: true,
    breathReduction: 1,
    shortenPauses: true,
    minInnerPause: 0.25,
    maxPauseTake: 0.4,
    matchSourcePauses: true,
    unmatchedPause: 0.15,
    tightenSilences: true,
    tightMinPause: 0.15,
    tightMargin: 0.08,
    checkCutWords: true,
    spliceCrossfade: 0,
    tailFloorDb: -70,
    tailHold: 0.04,
    edgeFade: 0,
    maxLateStart: 0.25,
    anchorWeight: 3,
    endByVideo: false,
    endSlack: 0.5,
    unitGap: 0.4,
    maxUnit: 12,
    flagJoin: 0.15,
    preserveLongPauses: false,
    protectedPause: 1.2,
};

const LENGTH_CHANGES: Record<Exclude<SyncJoinPreset, 'custom'>, Partial<SyncJoinSettings>> = {
  // Shorter than the original: pauses keep all they have and may grow, nothing is read faster.
  short: { chunkGapShare: 1, wordGap: 0.15, commaGap: 0.25, stopGap: 0.4, maxChunkGap: 2, speedFit: 'off', bestTakes: 'off', minGap: 0.25, gapShare: 0.5 },
  natural: {},
  // 5-15% longer: pauses shrink further, and the dub must end with the original.
  long: {
    chunkGapShare: 0.35,
    wordGap: 0.09,
    commaGap: 0.14,
    stopGap: 0.2,
    maxChunkGap: 0.7,
    minSilenceLength: 0.12,
    trailPad: 0.015,
    endByVideo: true,
    minGap: 0.12,
    speakerGap: 0.22,
    gapShare: 0.35,
    minInnerPause: 0.2,
    maxPauseTake: 0.6,
    tightMinPause: 0.12,
    tailHold: 0.025,
    unitGap: 0.3,
    flagJoin: 0.11,
  },
  // Over 15% longer: the tightest pauses, and a long line may be read up to 1.2x.
  vlong: {
    chunkGapShare: 0.25,
    wordGap: 0.07,
    commaGap: 0.11,
    stopGap: 0.16,
    maxChunkGap: 0.5,
    minSilenceLength: 0.1,
    trailPad: 0.015,
    maxVoiceSpeed: 1.2,
    endByVideo: true,
    minGap: 0.09,
    speakerGap: 0.18,
    minInnerPause: 0.18,
    maxPauseTake: 0.7,
    unmatchedPause: 0.12,
    tightMinPause: 0.1,
    tailHold: 0.015,
    unitGap: 0.25,
    flagJoin: 0.09,
  },
};

const SCREEN_CHANGES: Record<SyncScreen, Partial<SyncJoinSettings>> = {
  any: {},
  // A voice-over: every paragraph starts on time after a long pause, the lines between take the slack.
  narration: { preserveLongPauses: true, anchorWeight: 6 },
  // Faces on screen: lines start close to the original's, and joins are tight.
  camera: { anchorWeight: 6, maxLateStart: 0.2, flagJoin: 0.1 },
};

/** The join settings of a length preset with what is on screen. */
export const syncJoinPreset = (preset: Exclude<SyncJoinPreset, 'custom'>, screen: SyncScreen = 'any'): SyncJoinSettings => ({
  ...NATURAL_JOIN,
  ...LENGTH_CHANGES[preset],
  ...SCREEN_CHANGES[screen],
});

/** The length presets as they are with nothing on screen. Natural is also what the server syncs with when no settings are sent. */
export const SYNC_JOIN_PRESETS: Record<Exclude<SyncJoinPreset, 'custom'>, SyncJoinSettings> = {
  short: syncJoinPreset('short'),
  natural: syncJoinPreset('natural'),
  long: syncJoinPreset('long'),
  vlong: syncJoinPreset('vlong'),
};

/**
 * What else a preset sets: for faces on screen, Strict timing. Wording
 * suggestions are left as the user set them (off unless turned on).
 */
export const presetExtras = (screen: SyncScreen) => ({
  timingProtection: screen === 'camera' ? ('strict' as const) : ('warn' as const),
});

export const SYNC_JOIN_PRESET_OPTIONS: { id: SyncJoinPreset; label: string; sub: string; hint: string }[] = [
  { id: 'short', label: 'Short dub', sub: 'dub shorter', hint: 'The dub runs shorter than the original. Pauses keep all they have and may grow.' },
  { id: 'natural', label: 'Natural (recommended)', sub: 'about even', hint: 'The dub runs about as long as the original. Room to breathe between lines.' },
  { id: 'long', label: 'Long dub', sub: '5-15% longer', hint: 'The dub runs 5-15% longer. Pauses shrink further, and the dub ends with the original.' },
  { id: 'vlong', label: 'Very long dub', sub: 'over 15% longer', hint: 'The dub runs over 15% longer. The tightest pauses, and a long line may be read up to 1.2x.' },
  { id: 'custom', label: 'Custom', sub: 'your settings', hint: 'Your own settings, in the sections of this window.' },
];

export const SYNC_SCREEN_OPTIONS: { id: SyncScreen; label: string; sub: string; hint: string }[] = [
  { id: 'any', label: 'Any', sub: 'no extra rule', hint: '' },
  { id: 'narration', label: 'Narration', sub: 'voice-over', hint: 'A voice-over: after a long pause every paragraph starts on time, and the lines between take up the slack.' },
  { id: 'camera', label: 'On-camera', sub: 'faces on screen', hint: 'Faces on screen: lines must start within 200 ms of the original (Strict), with tight joins. Visual lip-sync is not checked.' },
];

/** The dub's lines can run this much longer (or shorter) than the original's before another preset suits it better. */
const PRESET_RATIOS: [Exclude<SyncJoinPreset, 'custom'>, number][] = [
  ['short', 0.97],
  ['natural', 1.05],
  ['long', 1.15],
  ['vlong', Infinity],
];

/**
 * How long the dub's lines run against the original's, from a sync report:
 * the seconds each line takes as voiced, from its first word to its last,
 * over the seconds the original speaker took for it. Null with nothing voiced.
 */
export const dubLengthRatio = (units: { silent?: boolean; speech: number; srcStart: number; srcEnd: number }[]) => {
  const voiced = units.filter((unit) => !unit.silent && unit.speech > 0 && unit.srcEnd > unit.srcStart);
  const original = voiced.reduce((sum, unit) => sum + unit.srcEnd - unit.srcStart, 0);
  return original > 0 ? voiced.reduce((sum, unit) => sum + unit.speech, 0) / original : null;
};

/** The length preset for a dub that runs `ratio` times as long as the original. */
export const presetForRatio = (ratio: number): Exclude<SyncJoinPreset, 'custom'> => PRESET_RATIOS.find(([, below]) => ratio < below)![0];

/** The preset a synced dub suits, and how much longer or shorter it runs (+0.25 for 25% longer); null before a sync. */
export const presetSuggestion = (units: Parameters<typeof dubLengthRatio>[0] | null | undefined) => {
  const ratio = units ? dubLengthRatio(units) : null;
  return ratio === null ? null : { preset: presetForRatio(ratio), change: ratio - 1 };
};
