/**
 * Fit to this video, run by Sync itself.
 *
 * When Sync is pressed (and "Fit to this video when I Sync" is on), the
 * original is measured locally, as the Fit card measures it
 * (server/lib/syncFit.js): no voice, no credit. From how much longer the dub
 * runs it picks the length preset (server/lib/lengthBands.js, the same bands
 * the suggestion after a sync uses) and adds Fit's gap and pause changes.
 *
 * Applied only when it is no worse: the Sync preview
 * (server/lib/syncPreview.js) judges the lines with the settings as they are
 * and as proposed, and the proposal goes in only when it leaves no fewer cues
 * in sync. Otherwise the settings stay and the panel says why.
 *
 * Never touched: a preset the user set to Custom themselves, a length they
 * picked by hand instead of Auto (`lengthAuto: false`; only gaps and pauses
 * are fitted on it), and the
 * settings that voice lines again (REVOICE_KEYS). Line grouping
 * changes which text each clip is voiced from, and that text is part of the
 * key a voiced clip is kept under (server/lib/syncDub.js `cacheKey`), so on a
 * sync after lines were voiced grouping is left as it is and only offered,
 * with what it would voice again. Sync never changes the words; only settings.
 */
import type { SyncFit, SyncJoinSettings, SyncOptions, SyncPreview, SyncReport, SpeakerFitRates } from './syncService';
import type { AudioSegment } from '../types';
import { syncJoinPreset, type SyncJoinPreset } from './syncPresets.ts';
import { lengthBandFor } from '../server/lib/lengthBands.js';
import { buildSyncUnits as groupCues } from '../server/lib/syncUnits.js';

// The server's plain-JS grouping, typed for the settings it reads.
const buildSyncUnits = groupCues as unknown as (segments: AudioSegment[], join: SyncJoinSettings) => { text: string }[];

export type LengthPreset = Exclude<SyncJoinPreset, 'custom'>;

/** The join settings that decide which cues are voiced together as one line. */
export const GROUPING_KEYS = ['unitGap', 'maxUnit', 'preserveLongPauses', 'protectedPause'] as const satisfies readonly (keyof SyncJoinSettings)[];
/**
 * The settings that voice lines again (Read faster, Best of 3 takes): every
 * take they ask for is new credit, so Sync's own fit leaves them as the user
 * has them, whatever the length preset says. Picking a preset by hand still
 * sets them.
 */
export const REVOICE_KEYS = ['speedFit', 'maxVoiceSpeed', 'bestTakes', 'maxRevoice'] as const satisfies readonly (keyof SyncJoinSettings)[];

/** One setting the fit moves: from, to, and what in the video says so. `preset` is the length preset itself. */
export interface AutoFitChange {
  key: keyof SyncJoinSettings | 'preset';
  from: number | boolean | string;
  to: number | boolean | string;
  reason: string;
  /** Measured by Fit, or set by the length preset it picked. */
  by: 'fit' | 'preset';
}

/** What Sync's own fit did, for the What changed panel. */
export interface AutoFitOutcome {
  /**
   * applied: the changes are in. fits: nothing to change. kept: a proposal the
   * preview judged worse, or one the user undid before. custom: the user's own
   * Custom settings, left alone. error: the video couldn't be measured.
   */
  status: 'applied' | 'fits' | 'kept' | 'custom' | 'error';
  /** Why it was kept, in a sentence; null otherwise. */
  keptBecause: string | null;
  /** The changes applied (or, when kept, the ones proposed). */
  changes: AutoFitChange[];
  presetFrom: SyncJoinPreset;
  presetTo: LengthPreset | null;
  /** How long the dub runs against the original (1.08 = 8% longer), when the rate is known well enough to say. */
  ratio: number | null;
  /** Cues the preview has in sync, with the settings before and after; null when not judged. */
  inSync: { before: number; after: number; cues: number } | null;
  /** On a sync after lines were voiced: the grouping change left out, what it would voice again, and the settings with it in. */
  grouping: { changes: AutoFitChange[]; lines: number; characters: number; options: SyncOptions } | null;
  /** When this run changed the grouping (before anything was voiced): what Undo would voice again. */
  undoRevoices: { lines: number; characters: number } | null;
  /** The settings before, which Undo puts back. */
  before: Pick<SyncOptions, 'preset' | 'screen' | 'join' | 'fitted' | 'fitUndone'>;
  /** The settings it applied, so Undo only offers while they are still in. */
  applied: SyncJoinSettings | null;
  /** The proposal, as a string, so an undone one isn't applied again by the next Sync. */
  signature: string;
  /** Once the lines were voiced: the band the voice really read in, when Sync swapped the settings for it (syncRefit.js). */
  afterVoicing?: { from: LengthPreset; to: LengthPreset; ratio: number } | null;
}

/** What Sync sends to fit the settings again once the lines are voiced: the band they were made for, and each band's settings. */
export interface SyncRefitRequest {
  from: LengthPreset;
  candidates: Partial<Record<LengthPreset, SyncJoinSettings>>;
}

const joinKeys = (join: SyncJoinSettings) => Object.keys(join) as (keyof SyncJoinSettings)[];

export const sameJoin = (a: SyncJoinSettings, b: SyncJoinSettings) =>
  joinKeys(a).length === joinKeys(b).length && joinKeys(a).every((key) => a[key] === b[key]);

/** True for the user's own Custom settings: Custom, and not exactly what Fit to this video left. */
export const isOwnCustom = (options: Pick<SyncOptions, 'preset' | 'join' | 'fitted'>) =>
  options.preset === 'custom' && !(options.fitted && sameJoin(options.fitted.join, options.join));

/** The length preset the settings came from: the preset itself, or the one Fit started from. */
export const lengthPresetOf = (options: Pick<SyncOptions, 'preset' | 'join' | 'fitted'>): LengthPreset =>
  options.preset !== 'custom' ? options.preset : options.fitted && !isOwnCustom(options) ? options.fitted.preset : 'natural';

/** Lines each grouping makes that the other doesn't, and their characters: what a sync would voice anew. */
export const regroupCost = (segments: AudioSegment[], from: SyncJoinSettings, to: SyncJoinSettings) => {
  const texts = (join: SyncJoinSettings) =>
    buildSyncUnits(segments, join)
      .map((unit) => unit.text)
      .filter((text) => /[\p{L}\p{N}]/u.test(text));
  const before = new Set(texts(from));
  const fresh = texts(to).filter((text) => !before.has(text));
  return { lines: fresh.length, characters: fresh.reduce((sum, text) => sum + text.length, 0) };
};

/** Cues the preview has in sync: every cue of a line not called long. Counted in cues, since a new grouping makes other lines. */
export const cuesInSync = (preview: Pick<SyncPreview, 'units'>) =>
  preview.units.reduce((sum, unit) => sum + (unit.status === 'long' ? 0 : unit.cueIds.length), 0);

const cuesIn = (preview: Pick<SyncPreview, 'units'>) => preview.units.reduce((sum, unit) => sum + unit.cueIds.length, 0);

/** The changes as a string: the same proposal gives the same string. */
const signatureOf = (preset: LengthPreset, join: SyncJoinSettings) => JSON.stringify([preset, joinKeys(join).sort().map((key) => [key, join[key]])]);

const presetLabel: Record<SyncJoinPreset, string> = { short: 'Short dub', natural: 'Natural', long: 'Long dub', vlong: 'Very long dub', custom: 'Custom' };

/** "8% longer", "6% shorter", "about as long". */
const lengthWords = (ratio: number) =>
  Math.abs(ratio - 1) < 0.01 ? 'about as long as the original' : `about ${Math.round(Math.abs(ratio - 1) * 100)}% ${ratio > 1 ? 'longer' : 'shorter'} than the original`;

export interface AutoFitRequest {
  options: SyncOptions;
  segments: AudioSegment[];
  /** What Fit measures from: the dub's rate and each speaker's (as the Fit card sends). */
  source: { charsPerSecond: number; rateMeasured: boolean; rateSample?: boolean; speakerRates?: SpeakerFitRates };
  /** True once lines of this project were voiced by a sync: grouping is then frozen. */
  voicedBefore: boolean;
  /** Sync from scratch voices every line anew, so grouping may change. */
  fresh?: boolean;
  fit: (request: { segments: AudioSegment[]; join: SyncJoinSettings; charsPerSecond: number; rateMeasured: boolean; rateSample?: boolean; speakerRates?: SpeakerFitRates }) => Promise<SyncFit>;
  preview: (join: SyncJoinSettings) => Promise<Pick<SyncPreview, 'units'>>;
}

/**
 * The settings Sync should run with, and what it did. Never throws: when the
 * video can't be measured, the settings go as they are with status 'error'.
 * Returns null when Fit on Sync is turned off.
 */
export const autoFitForSync = async (request: AutoFitRequest): Promise<{ options: SyncOptions; outcome: AutoFitOutcome } | null> => {
  const { options, segments, source, voicedBefore, fresh = false, fit, preview } = request;
  if (options.fitOnSync === false) return null;
  const before = { preset: options.preset, screen: options.screen, join: options.join, fitted: options.fitted, fitUndone: options.fitUndone };
  const base: AutoFitOutcome = {
    status: 'fits',
    keptBecause: null,
    changes: [],
    presetFrom: options.preset,
    presetTo: null,
    ratio: null,
    inSync: null,
    grouping: null,
    undoRevoices: null,
    before,
    applied: null,
    signature: '',
  };
  if (isOwnCustom(options)) return { options, outcome: { ...base, status: 'custom' } };

  try {
    const screen = options.screen ?? 'any';
    const fromPreset = lengthPresetOf(options);
    // 1. How long the dub runs. Only a measured rate (the last sync's, or a sample read of the voice) picks a preset:
    // a typical rate says too little about one voice reading one of twelve languages.
    const measured = await fit({ segments, ...source, join: options.join });
    const ratio = measured.measured.lengthRatio;
    const trusted = ratio !== null && Number.isFinite(ratio) && measured.measured.rateBasis !== 'estimated';
    const band = trusted ? (lengthBandFor(ratio) as LengthPreset) : fromPreset;
    // A short sample read says too little to make a dub Short before it is voiced: a wrong Short keeps every pause and
    // runs lines long. After voicing, Sync measures the real length and may still pick Short (syncRefit.js).
    const fromSync =
      (source.rateMeasured && source.rateSample !== true) ||
      Object.values(source.speakerRates ?? {}).some((rate) => rate && rate.sample !== true && rate.lines >= 5);
    // A length the user picked by hand stays: the fit only tunes gaps and pauses on it.
    const byHand = options.lengthAuto === false;
    const heldFromShort = !byHand && trusted && band === 'short' && !fromSync;
    const preset: LengthPreset = byHand ? fromPreset : heldFromShort ? 'natural' : band;

    // 2. That preset, with Fit's gaps and pauses measured on top of it.
    const start = syncJoinPreset(preset, screen);
    const fitted = await fit({ segments, ...source, charsPerSecond: trusted ? source.charsPerSecond : 0, join: start });
    const join: SyncJoinSettings = { ...fitted.join };
    REVOICE_KEYS.forEach((key) => ((join as unknown as Record<string, unknown>)[key] = options.join[key]));
    const reasons = new Map(fitted.changes.map((change) => [change.key, change.reason]));
    const presetReason = byHand
      ? `Part of ${presetLabel[preset]}, the length you picked.`
      : heldFromShort
      ? `At the voice's sample read the dub runs ${lengthWords(ratio!)}; Short waits until Sync has measured the voiced lines.`
      : trusted
        ? `The dub runs ${lengthWords(ratio!)}, which is ${presetLabel[preset]}.`
        : `Part of ${presetLabel[preset]}.`;

    // 3. Grouping stays as it is once lines were voiced; it is offered with what it would voice again.
    // New grouping values that still make the very same lines voice nothing anew, so they go in like any other.
    const groupingWanted = { ...join };
    const freezeGrouping = voicedBefore && !fresh && regroupCost(segments, options.join, groupingWanted).lines > 0;
    if (freezeGrouping) GROUPING_KEYS.forEach((key) => ((join as unknown as Record<string, unknown>)[key] = options.join[key]));

    const changeOf = (key: keyof SyncJoinSettings, to: SyncJoinSettings): AutoFitChange => ({
      key,
      from: options.join[key],
      to: to[key],
      reason: reasons.get(key) ?? presetReason,
      by: reasons.has(key) ? 'fit' : 'preset',
    });
    const presetChange: AutoFitChange[] =
      preset !== fromPreset ? [{ key: 'preset', from: fromPreset, to: preset, reason: heldFromShort ? presetReason : `The dub runs ${lengthWords(ratio!)}.`, by: 'preset' }] : [];
    const changes = [...presetChange, ...joinKeys(join).filter((key) => join[key] !== options.join[key]).map((key) => changeOf(key, join))];
    const groupingChanges = freezeGrouping
      ? GROUPING_KEYS.filter((key) => groupingWanted[key] !== options.join[key]).map((key) => changeOf(key, groupingWanted))
      : [];

    const nextOptions = (to: SyncJoinSettings): SyncOptions => ({
      ...options,
      preset: sameJoin(to, start) ? preset : 'custom',
      join: to,
      fitted: { preset, join: to },
      fitUndone: undefined,
    });
    const grouping =
      groupingChanges.length > 0
        ? { changes: groupingChanges, ...regroupCost(segments, join, groupingWanted), options: nextOptions(groupingWanted) }
        : null;
    const outcome: AutoFitOutcome = {
      ...base,
      presetTo: preset,
      ratio: trusted ? ratio : null,
      changes,
      grouping,
      signature: signatureOf(preset, join),
    };

    if (sameJoin(join, options.join)) return { options, outcome: { ...outcome, status: 'fits', changes: [] } };
    if (options.fitUndone && options.fitUndone === outcome.signature) {
      return { options, outcome: { ...outcome, status: 'kept', keptBecause: 'You undid these changes before, so your settings stay as they are.' } };
    }

    // 4. Only if it is no worse: no fewer cues in sync in the preview.
    const [now, proposed] = await Promise.all([preview(options.join), preview(join)]);
    const inSync = { before: cuesInSync(now), after: cuesInSync(proposed), cues: cuesIn(now) };
    if (inSync.after < inSync.before) {
      return {
        options,
        outcome: {
          ...outcome,
          status: 'kept',
          inSync,
          keptBecause: `The preview had ${inSync.after} of ${inSync.cues} cues in sync with the changes, against ${inSync.before} without, so your settings stay as they are.`,
        },
      };
    }
    const groupingChanged = !freezeGrouping && GROUPING_KEYS.some((key) => join[key] !== options.join[key]);
    return {
      options: nextOptions(join),
      outcome: {
        ...outcome,
        status: 'applied',
        inSync,
        applied: join,
        undoRevoices: groupingChanged ? regroupCost(segments, join, options.join) : null,
      },
    };
  } catch {
    return { options, outcome: { ...base, status: 'error', keptBecause: "This video couldn't be measured, so Sync used your settings as they are." } };
  }
};

/**
 * Undo: the settings from before the fit, with the fit remembered as undone,
 * so the next Sync doesn't apply the same changes again.
 */
export const undoAutoFit = (options: SyncOptions, outcome: AutoFitOutcome): SyncOptions => ({
  ...options,
  preset: outcome.before.preset,
  screen: outcome.before.screen,
  join: outcome.before.join,
  fitted: outcome.before.fitted,
  fitUndone: outcome.signature,
});

/** True while the settings are still the ones the fit applied, so Undo still means something. */
export const canUndoAutoFit = (options: Pick<SyncOptions, 'join'>, outcome: AutoFitOutcome | null) =>
  Boolean(outcome && outcome.status === 'applied' && outcome.applied && sameJoin(options.join, outcome.applied));

/**
 * For Sync to fit the settings again once the lines are voiced: each band's
 * preset with Fit's measured gaps on it (the server adds the band's pause
 * moves, and keeps grouping and the settings that voice lines again). None
 * for the user's own Custom settings, a length picked by hand, or with Fit on
 * Sync turned off.
 */
export const refitRequestFor = async (
  options: SyncOptions,
  { segments, source, fit }: Pick<AutoFitRequest, 'segments' | 'source' | 'fit'>
): Promise<SyncRefitRequest | null> => {
  if (options.fitOnSync === false || options.lengthAuto === false || isOwnCustom(options)) return null;
  try {
    const screen = options.screen ?? 'any';
    const bands: LengthPreset[] = ['short', 'natural', 'long', 'vlong'];
    const fitted = await Promise.all(bands.map((band) => fit({ segments, ...source, charsPerSecond: 0, join: syncJoinPreset(band, screen) })));
    return { from: lengthPresetOf(options), candidates: Object.fromEntries(bands.map((band, n) => [band, fitted[n].join])) };
  } catch {
    return null;
  }
};

/** The settings once Sync swapped them after voicing (`report.refit`), as they are kept for the next Sync; null when it didn't. */
export const refittedOptions = (options: SyncOptions, report: Pick<SyncReport, 'join' | 'refit'>): SyncOptions | null => {
  const refit = report.refit;
  if (!refit || refit.status !== 'applied' || !refit.to) return null;
  const to = refit.to as LengthPreset;
  return {
    ...options,
    preset: sameJoin(report.join, syncJoinPreset(to, options.screen ?? 'any')) ? to : 'custom',
    join: report.join,
    fitted: { preset: to, join: report.join },
    fitUndone: undefined,
  };
};

/** The What changed panel once Sync swapped the settings after voicing: every change from before the press, and Undo of all of it. */
export const withRefit = (outcome: AutoFitOutcome, report: Pick<SyncReport, 'join' | 'refit'>): AutoFitOutcome => {
  const refit = report.refit;
  if (!refit || refit.status !== 'applied' || !refit.to || !refit.from || !(refit.ratio! > 0)) return outcome;
  const from = refit.from as LengthPreset;
  const to = refit.to as LengthPreset;
  const before = outcome.before.join;
  const after = report.join;
  const reasons = new Map(outcome.changes.filter((c) => c.by === 'fit').map((c) => [c.key, c.reason]));
  const why = `Measured once voiced: the voice ran ${lengthWords(refit.ratio!)}, which is ${presetLabel[to]}.`;
  const presetFrom = outcome.changes.find((c) => c.key === 'preset')?.from ?? lengthPresetOf({ preset: outcome.before.preset, join: before, fitted: outcome.before.fitted });
  const changes: AutoFitChange[] = [
    ...(presetFrom !== to ? [{ key: 'preset' as const, from: presetFrom, to, reason: why, by: 'preset' as const }] : []),
    ...joinKeys(after)
      .filter((key) => after[key] !== before[key])
      .map((key) => ({ key, from: before[key], to: after[key], reason: reasons.get(key) ?? why, by: reasons.has(key) ? ('fit' as const) : ('preset' as const) })),
  ];
  return {
    ...outcome,
    status: 'applied',
    keptBecause: null,
    changes,
    presetTo: to,
    ratio: refit.ratio!,
    applied: after,
    signature: signatureOf(to, after),
    afterVoicing: { from, to, ratio: refit.ratio! },
  };
};
