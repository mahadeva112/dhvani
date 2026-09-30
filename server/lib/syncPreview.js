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
import { buildSyncUnits, minimumGap } from './syncUnits.js';
import { SYNC_PRECISION, SUGGESTION_MARGIN, lineKey } from './syncDub.js';

/** A line estimated to use more than this share of its slot is tight: it should fit, just. */
export const TIGHT_SHARE = 0.9;

/** Speaking rates outside this range are not believable; the caller's value is clamped to it. */
const MIN_CPS = 4;
const MAX_CPS = 40;

const hasWords = (text) => /[\p{L}\p{N}]/u.test(text);

/**
 * Returns `{ precision, charsPerSecond, units, summary }`. Each unit is
 * `{ index, key, cueIds, text, sourceText, srcStart, srcEnd, nextStart, slot,
 * estimate, overflow, status, targetChars }`, `status` being 'fits', 'tight'
 * or 'long'. `targetChars` is the length a shorter wording should aim for,
 * worked out as Sync works it out for its own suggestions.
 */
export const previewSync = ({ segments = [], precision, charsPerSecond, sourceDuration = 0 } = {}) => {
  const level = SYNC_PRECISION[precision] ? precision : 'phrase';
  const { allowedOverflow } = SYNC_PRECISION[level];
  const cps = Math.min(MAX_CPS, Math.max(MIN_CPS, Number(charsPerSecond) || 14));
  const units = buildSyncUnits(segments).filter((unit) => hasWords(unit.text));

  const previews = units.map((unit, index) => {
    const end =
      unit.nextStart !== null
        ? unit.nextStart - minimumGap(unit.gapAfter)
        : Math.max(Number(sourceDuration) || 0, unit.srcEnd) + 0.5;
    const slot = Math.max(0.05, end - unit.srcStart);
    const estimate = unit.text.length / cps;
    const overflow = estimate - slot;
    const status = overflow > allowedOverflow ? 'long' : estimate > slot * TIGHT_SHARE ? 'tight' : 'fits';
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
      estimate,
      overflow: Math.max(0, overflow),
      status,
      targetChars: Math.max(1, Math.floor(unit.text.length * Math.min(1, slot / estimate) * SUGGESTION_MARGIN)),
    };
  });

  const count = (status) => previews.filter((p) => p.status === status).length;
  return {
    precision: level,
    charsPerSecond: cps,
    units: previews,
    summary: {
      lines: previews.length,
      fits: count('fits'),
      tight: count('tight'),
      long: count('long'),
      maxOverflow: previews.reduce((max, p) => (p.status === 'long' ? Math.max(max, p.overflow) : max), 0),
    },
  };
};
