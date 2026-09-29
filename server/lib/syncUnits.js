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

/** Cues closer together than this were spoken as one phrase. */
export const UNIT_GAP_SECONDS = 0.4;

/**
 * A unit that starts after at least this much silence, or with a new speaker,
 * is a hard anchor: the dub must be back in step there, so the placer pulls
 * it harder than a phrase in the middle of a thought.
 */
export const HARD_ANCHOR_GAP_SECONDS = 1.2;

/** Longer units are split at the next cue, so one late line can't drag a whole paragraph. */
export const MAX_UNIT_SECONDS = 12;

const cueText = (segment) => String(segment?.textTarget || segment?.targetText || '').trim();
const cueSourceText = (segment) => String(segment?.textSource || segment?.originalText || '').trim();

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * Groups cues into sync units. Cues with no translated text are skipped: they
 * have nothing to voice. Returns units in source order, each with
 * `{ index, cueIds, text, sourceText, srcStart, srcEnd, speaker, gapBefore, gapAfter, nextStart, hardAnchor }`.
 * `nextStart` is null for the last unit; `gapBefore` is null for the first.
 */
export const buildSyncUnits = (segments = []) => {
  const cues = segments
    .filter((segment) => cueText(segment) && finite(segment.startTime) && finite(segment.endTime))
    .sort((a, b) => a.startTime - b.startTime);

  const units = [];
  let current = null;

  for (const cue of cues) {
    const joins =
      current &&
      cue.startTime - current.srcEnd < UNIT_GAP_SECONDS &&
      (cue.speaker || null) === current.speaker &&
      cue.endTime - current.srcStart <= MAX_UNIT_SECONDS;

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
      hardAnchor: !previous || gapBefore >= HARD_ANCHOR_GAP_SECONDS || previous.speaker !== unit.speaker,
    };
  });
};

/**
 * The smallest pause the dub may leave after a unit, from the pause the source
 * speaker left there. A third of the source pause, never below a breath and
 * never more than the source pause itself: a long source pause can lend most
 * of its time to a dub line that runs long.
 */
export const minimumGap = (sourceGap) => {
  if (!finite(sourceGap)) return 0;
  const gap = Math.max(0, sourceGap);
  return Math.min(gap, Math.max(0.08, Math.min(0.3 * gap, 0.6)));
};
