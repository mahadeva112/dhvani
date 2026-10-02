/**
 * A preview of a sync, before anything is voiced.
 *
 * The lines are grouped exactly as Sync groups them (syncUnits.js) and each
 * gets the same slot: from its source phrase's start to where the next phrase
 * starts, less the breath Sync leaves there. How long the dub line will take
 * is only estimated, from its length in characters and a speaking rate (the
 * client measures one from the Final dub, or falls back to a typical rate).
 * Sync measures the real clips, so this is a guide to which lines to shorten
 * first, never a promise.
 */
import { buildSyncUnits, unitGapAfter } from './syncUnits.js';
import { resolveJoinSettings } from './syncSettings.js';
import { SYNC_PRECISION, SUGGESTION_MARGIN, LENGTHEN_FILL, isShortLine, lineKey } from './syncDub.js';

/** A line estimated to use more than this share of its slot is tight: it should fit, just. */
export const TIGHT_SHARE = 0.9;

/** Speaking rates outside this range are not believable; the caller's value is clamped to it. */
const MIN_CPS = 4;
const MAX_CPS = 40;

const hasWords = (text) => /[\p{L}\p{N}]/u.test(text);

/**
 * Returns `{ precision, charsPerSecond, units, summary }`. Each unit is
 * `{ index, key, cueIds, text, sourceText, srcStart, srcEnd, nextStart, slot,
 * spoken, estimate, overflow, underflow, status, targetChars }`, `status`
 * being 'fits', 'tight', 'long' or 'short'. `spoken` is how long the original
 * speaker talks for and `underflow` how much of that the dub leaves silent.
 * `targetChars` is the length a new wording should aim for: shorter for a long
 * line, worked out as Sync works it out for its own suggestions; longer for a
 * short one, filling the original speech but never past the slot. `join`
 * groups the lines and sets the gaps as it does for Sync.
 */
export const previewSync = ({ segments = [], precision, charsPerSecond, sourceDuration = 0, join: requested } = {}) => {
  const join = resolveJoinSettings(requested);
  const level = SYNC_PRECISION[precision] ? precision : 'phrase';
  const { allowedOverflow } = SYNC_PRECISION[level];
  const cps = Math.min(MAX_CPS, Math.max(MIN_CPS, Number(charsPerSecond) || 14));
  const units = buildSyncUnits(segments, join).filter((unit) => hasWords(unit.text));

  const previews = units.map((unit, index) => {
    const end =
      unit.nextStart !== null
        ? unit.nextStart - unitGapAfter(unit, join)
        : Math.max(Number(sourceDuration) || 0, unit.srcEnd) + 0.5;
    const slot = Math.max(0.05, end - unit.srcStart);
    const estimate = unit.text.length / cps;
    const overflow = estimate - slot;
    const spoken = Math.max(0, unit.srcEnd - unit.srcStart);
    const underflow = Math.max(0, spoken - estimate);
    const short = isShortLine(estimate, spoken);
    const status = overflow > allowedOverflow ? 'long' : estimate > slot * TIGHT_SHARE ? 'tight' : short ? 'short' : 'fits';
    const targetChars =
      status === 'short'
        ? Math.max(unit.text.length + 1, Math.floor(cps * Math.min(spoken * LENGTHEN_FILL, slot * SUGGESTION_MARGIN)))
        : Math.max(1, Math.floor(unit.text.length * Math.min(1, slot / estimate) * SUGGESTION_MARGIN));
    return {
      index,
      key: lineKey(unit),
      cueIds: unit.cueIds,
      text: unit.text,
      sourceText: unit.sourceText,
      srcStart: unit.srcStart,
      srcEnd: unit.srcEnd,
      nextStart: unit.nextStart,
      slot,
      spoken,
      estimate,
      overflow: Math.max(0, overflow),
      underflow: status === 'short' ? underflow : 0,
      status,
      targetChars,
    };
  });

  const count = (status) => previews.filter((p) => p.status === status).length;
  return {
    precision: level,
    charsPerSecond: cps,
    units: previews,
    summary: {
      lines: previews.length,
      // A short line fits its slot too; `short` counts the ones that end early.
      fits: count('fits') + count('short'),
      tight: count('tight'),
      long: count('long'),
      short: count('short'),
      maxOverflow: previews.reduce((max, p) => (p.status === 'long' ? Math.max(max, p.overflow) : max), 0),
    },
  };
};
