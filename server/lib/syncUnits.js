/**
 * Sync units: the phrases a synced dub is lined up on.
 *
 * Subtitle cues are cut for reading, so one spoken phrase is often split
 * across two or three cues with almost no gap between them. Voicing each cue
 * alone would put a breath in the middle of a phrase, so cues the speaker ran
 * together are grouped into one unit, and each unit is voiced as one clip and
 * placed where its phrase starts in the source.
 *
 * All timings come from the cues, which carry ElevenLabs' word timestamps.
 */

import { DEFAULT_JOIN_SETTINGS, MAX_KEPT_PAUSE_SECONDS } from './syncSettings.js';
import { endsSentence } from './ttsText.js';

/** Cues closer together than this were spoken as one phrase (the default; see syncSettings.js). */
export const UNIT_GAP_SECONDS = DEFAULT_JOIN_SETTINGS.unitGap;

/**
 * A unit that starts after at least this much silence, or with a new speaker,
 * is a hard anchor: the dub must be back in step there, so the placer pulls
 * it harder than a phrase in the middle of a thought.
 */
export const HARD_ANCHOR_GAP_SECONDS = 1.2;

/** Longer units are split at the next cue, so one late line can't drag a whole paragraph (the default). */
export const MAX_UNIT_SECONDS = DEFAULT_JOIN_SETTINGS.maxUnit;

/**
 * A sentence is never cut in two to keep a unit short: a unit whose text
 * hasn't ended a sentence takes the next cue even past `maxUnit`, up to this
 * length, and across a pause up to HARD_ANCHOR_GAP_SECONDS. Voiced in two
 * halves, each half ends as if the sentence were over, and the voice often
 * cuts the first one off before its last word is finished.
 */
export const MAX_SENTENCE_UNIT_SECONDS = 30;

const cueText = (segment) => String(segment?.textTarget || segment?.targetText || '').trim();
const cueSourceText = (segment) => String(segment?.textSource || segment?.originalText || '').trim();

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Groups cues into sync units. Cues with no translated text are skipped: they
 * have nothing to voice. Returns units in source order, each with
 * `{ index, cueIds, text, sourceText, srcStart, srcEnd, speaker, gapBefore, gapAfter, nextStart, speakerChangeAfter, hardAnchor }`.
 * `nextStart` is null for the last unit; `gapBefore` is null for the first.
 * `unitGap` and `maxUnit` (seconds) decide which cues are joined; a sentence
 * left open is finished in the same unit (see MAX_SENTENCE_UNIT_SECONDS),
 * unless `unitGap` is 0 or the text has no sentence marks at all.
 */
export const buildSyncUnits = (segments = [], { unitGap = UNIT_GAP_SECONDS, maxUnit = MAX_UNIT_SECONDS } = {}) => {
  const cues = segments
    .filter((segment) => cueText(segment) && finite(segment.startTime) && finite(segment.endTime))
    .sort((a, b) => a.startTime - b.startTime);
  // Text with no sentence marks says nothing about where sentences end.
  const keepSentences = unitGap > 0 && cues.some((cue) => endsSentence(cueText(cue)));

  const units = [];
  let current = null;

  for (const cue of cues) {
    const open = keepSentences && current && !endsSentence(current.text);
    const gap = current ? cue.startTime - current.srcEnd : 0;
    const joins =
      current &&
      (cue.speaker || null) === current.speaker &&
      (gap < unitGap || (open && gap < HARD_ANCHOR_GAP_SECONDS)) &&
      cue.endTime - current.srcStart <= (open ? Math.max(maxUnit, MAX_SENTENCE_UNIT_SECONDS) : maxUnit);

    if (joins) {
      current.cueIds.push(cue.id);
      current.text += ` ${cueText(cue)}`;
      current.sourceText = [current.sourceText, cueSourceText(cue)].filter(Boolean).join(' ');
      current.srcEnd = Math.max(current.srcEnd, cue.endTime);
    } else {
      current = {
        cueIds: [cue.id],
        text: cueText(cue),
        sourceText: cueSourceText(cue),
        srcStart: cue.startTime,
        srcEnd: cue.endTime,
        speaker: cue.speaker || null,
      };
      units.push(current);
    }
  }

  return units.map((unit, index) => {
    const previous = units[index - 1];
    const next = units[index + 1];
    const gapBefore = previous ? unit.srcStart - previous.srcEnd : null;
    return {
      index,
      ...unit,
      gapBefore,
      gapAfter: next ? next.srcStart - unit.srcEnd : null,
      nextStart: next ? next.srcStart : null,
      speakerChangeAfter: Boolean(next) && next.speaker !== unit.speaker,
      hardAnchor: !previous || gapBefore >= HARD_ANCHOR_GAP_SECONDS || previous.speaker !== unit.speaker,
    };
  });
};

/**
 * The smallest pause the dub may leave after a unit. Never less than
 * `minGap` (`speakerGap` where the speaker changes), so the next line never
 * runs straight into this one however little the source speaker paused, and
 * at least `gapShare` of the source pause, up to MAX_KEPT_PAUSE_SECONDS: a
 * long source pause lends the rest of its time to a dub line that runs long.
 */
export const minimumGap = (sourceGap, { minGap, speakerGap, gapShare } = DEFAULT_JOIN_SETTINGS, speakerChange = false) => {
  if (!finite(sourceGap)) return 0;
  const floor = speakerChange ? Math.max(minGap, speakerGap) : minGap;
  return Math.max(floor, Math.min(gapShare * Math.max(0, sourceGap), MAX_KEPT_PAUSE_SECONDS));
};

/** The smallest pause the dub may leave after `unit`. */
export const unitGapAfter = (unit, settings = DEFAULT_JOIN_SETTINGS) => minimumGap(unit.gapAfter, settings, unit.speakerChangeAfter);
