/**
 * Fit to this video: join settings worked out from how the original speaker
 * paused, and how much longer or shorter the dub runs.
 *
 * Everything is measured from the cues: their timings and speakers, and the
 * word timings inside them. How long the dub takes is estimated from its
 * text and a speaking rate, as the preview does (syncPreview.js). Only the
 * settings these measurements say something about are proposed: grouping,
 * the gaps between lines, how far a long line's pauses may be shortened, and
 * the review flag that follows the gap. Line edges, breaths and the two
 * settings that change the audio are left as they are, since the source's
 * timing says nothing about how the dub's voice ends a line.
 *
 * Nothing is applied here: the app shows each change with its reason and the
 * user applies them or not.
 */
import { buildSyncUnits } from './syncUnits.js';
import { resolveJoinSettings } from './syncSettings.js';

/** Fewer measured pauses than this say too little to go on; that setting is left as it is. */
export const MIN_SAMPLES = 5;

/** Pauses longer than this are scene breaks, not the speaker's rhythm. */
const LONGEST_PAUSE = 3;
/** Word gaps shorter than this are word boundaries, not pauses. */
const SHORTEST_WORD_PAUSE = 0.03;
/** Lines spoken for less than this say little about how much longer the dub runs. */
const SHORTEST_SPOKEN = 0.3;

/** The step each setting moves in on its slider, so a proposal lands on a value the slider can show. */
const STEPS = { unitGap: 0.05, minGap: 0.01, speakerGap: 0.01, gapShare: 0.05, maxPauseTake: 0.05, flagJoin: 0.01 };

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const snap = (key, value) => Number((Math.round(value / STEPS[key]) * STEPS[key]).toFixed(3));
const ms = (seconds) => `${Math.round(seconds * 1000)} ms`;

/** The value at share `q` (0-1) of the sorted values, between neighbours. */
export const quantile = (values, q) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
};

/** The pauses the speaker made between words inside each cue. */
const innerPausesOf = (cues) =>
  cues.flatMap((cue) => {
    const words = (Array.isArray(cue.words) ? cue.words : []).filter((w) => finite(w?.start) && finite(w?.end)).sort((a, b) => a.start - b.start);
    return words.slice(1).map((word, n) => word.start - words[n].end).filter((gap) => gap >= SHORTEST_WORD_PAUSE && gap <= LONGEST_PAUSE);
  });

/**
 * Proposes join settings for these cues. `join` is what the user has now;
 * every setting not proposed keeps its value. `charsPerSecond` is the dub's
 * speaking rate (`rateMeasured` says whether it was measured from this dub).
 *
 * Returns `{ join, changes, measured, note }`: `join` with the changes in it;
 * `changes` as `{ key, from, to, reason }`, only for settings that move;
 * `measured` the counts behind them; `note` set when there was too little to
 * measure anything.
 */
export const fitJoinSettings = ({ segments = [], join: current, charsPerSecond, rateMeasured = false } = {}) => {
  const from = resolveJoinSettings(current);
  const proposed = { ...from };
  const reasons = {};
  const propose = (key, value, reason) => {
    proposed[key] = typeof value === 'number' ? snap(key, value) : value;
    reasons[key] = reason;
  };

  const cues = segments
    .filter((segment) => finite(segment?.startTime) && finite(segment?.endTime) && segment.endTime > segment.startTime)
    .sort((a, b) => a.startTime - b.startTime);

  // 1. Grouping: cues closer than the speaker's own mid-phrase pauses were said as one phrase.
  const inner = innerPausesOf(cues);
  if (inner.length >= MIN_SAMPLES) {
    const longInner = quantile(inner, 0.9);
    propose('unitGap', clamp(longInner + 0.05, 0.25, 0.7), `The speaker's pauses inside a phrase run up to about ${ms(longInner)}.`);
  }

  // 2. Gaps: the pauses between lines of one speaker, and at a speaker change.
  const linePauses = [];
  const handovers = [];
  cues.slice(1).forEach((cue, n) => {
    const gap = cue.startTime - cues[n].endTime;
    if (gap < 0 || gap > LONGEST_PAUSE) return;
    if ((cue.speaker || null) !== (cues[n].speaker || null)) handovers.push(gap);
    else if (gap >= proposed.unitGap) linePauses.push(gap);
  });
  if (linePauses.length >= MIN_SAMPLES) {
    const quick = quantile(linePauses, 0.2);
    propose('minGap', clamp(quick * 0.6, 0.1, 0.3), `The speaker's quicker pauses between lines are about ${ms(quick)}.`);
  }
  if (handovers.length >= Math.min(3, MIN_SAMPLES)) {
    const handover = quantile(handovers, 0.5);
    propose(
      'speakerGap',
      clamp(handover * 0.6, Math.max(0.15, proposed.minGap), 0.5),
      `At a speaker change the original leaves about ${ms(handover)}.`
    );
  }
  if (proposed.minGap !== from.minGap) {
    propose('flagJoin', clamp(proposed.minGap * 0.85, 0.08, 0.2), 'Follows the new minimum gap, so only joins well under it are flagged.');
  }

  // 3. Length: how much longer or shorter the dub runs than the original speaker.
  const cps = Number(charsPerSecond);
  let ratio = NaN;
  if (cps > 0) {
    const units = buildSyncUnits(cues, { unitGap: proposed.unitGap, maxUnit: proposed.maxUnit });
    const ratios = units
      .map((unit) => ({ spoken: unit.srcEnd - unit.srcStart, estimate: unit.text.length / cps }))
      .filter(({ spoken, estimate }) => spoken >= SHORTEST_SPOKEN && estimate > 0)
      .map(({ spoken, estimate }) => estimate / spoken);
    if (ratios.length >= MIN_SAMPLES) ratio = quantile(ratios, 0.5);
  }
  if (finite(ratio)) {
    const percent = Math.round(Math.abs(ratio - 1) * 100);
    const basis = rateMeasured ? '' : ', at a typical speaking rate';
    const longer = `The dub runs about ${percent}% longer than the original${basis}.`;
    if (ratio >= 1.08) {
      if (!from.shortenPauses) propose('shortenPauses', true, longer);
      const take = ratio >= 1.2 ? 0.6 : 0.5;
      if (take > from.maxPauseTake) propose('maxPauseTake', take, longer);
      if (ratio >= 1.15 && from.gapShare > 0.25) propose('gapShare', 0.25, `${longer} A long pause lends more of its time to the line before.`);
    } else if (ratio <= 0.9 && from.gapShare < 0.4) {
      propose('gapShare', 0.4, `The dub runs about ${percent}% shorter than the original${basis}, so more of each pause can be kept.`);
    }
  }

  const changes = Object.keys(reasons)
    .filter((key) => (typeof proposed[key] === 'number' ? Math.abs(proposed[key] - from[key]) > 1e-9 : proposed[key] !== from[key]))
    .map((key) => ({ key, from: from[key], to: proposed[key], reason: reasons[key] }));
  const join = { ...from, ...Object.fromEntries(changes.map((c) => [c.key, c.to])) };
  const speakers = new Set(cues.map((cue) => cue.speaker || null)).size;
  const lines = buildSyncUnits(cues, join).length;
  const measuredAnything = Object.keys(reasons).length > 0;

  return {
    join,
    changes,
    measured: { lines, speakers, pauses: linePauses.length, handovers: handovers.length, wordPauses: inner.length, lengthRatio: finite(ratio) ? ratio : null },
    note: measuredAnything ? null : 'Too few cues with timings to measure. Transcribe the original first, or keep the preset.',
  };
};
