// Actual dub word timings compared at translated cue boundaries. Words in
// different languages are not assumed to correspond one for one.
const clean = (text) => String(text || '').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

export const validateAlignedWords = (words, text, duration) => {
  if (!Array.isArray(words) || !words.length) throw new Error('No word timings were returned.');
  let previous = 0;
  for (const word of words) {
    if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.start < previous - 0.001 || word.end <= word.start || word.end > duration + 0.02) {
      throw new Error('The returned word timings are incomplete or outside the audio.');
    }
    previous = word.end;
  }
  if (words.map((word) => clean(word.text)).join('') !== clean(text)) throw new Error('The returned words do not cover the complete script.');
  return words;
};

export const measureWordTiming = (words, unit, cues, origin, tolerance) => {
  let cursor = 0;
  const spans = words.map((word) => {
    const from = cursor;
    cursor += clean(word.text).length;
    return { ...word, from, to: cursor };
  }).filter((word) => word.to > word.from);
  cursor = 0;
  const anchors = cues.map((cue) => {
    const from = cursor;
    cursor += clean(cue.textTarget || cue.targetText).length;
    const first = spans.find((word) => word.to > from);
    const last = spans.findLast((word) => word.from < cursor);
    const sourceWords = (Array.isArray(cue.words) ? cue.words : []).filter((word) => Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start).sort((a, b) => a.start - b.start);
    return first && last ? {
      cueId: String(cue.id),
      startError: origin + first.start - (sourceWords[0]?.start ?? cue.startTime),
      endError: origin + last.end - (sourceWords.at(-1)?.end ?? cue.endTime),
    } : null;
  }).filter(Boolean);
  const internal = anchors.flatMap((anchor, i) => [
    ...(i > 0 ? [Math.abs(anchor.startError)] : []),
    ...(i < anchors.length - 1 ? [Math.abs(anchor.endError)] : []),
  ]);
  return {
    status: 'measured',
    startError: origin + words[0].start - unit.srcStart,
    endError: origin + words.at(-1).end - unit.srcEnd,
    endMismatch: Math.abs(origin + words.at(-1).end - unit.srcEnd) > tolerance,
    boundaryMaxError: internal.length ? Math.max(...internal) : null,
    anchors,
    words: words.map(({ text, start, end }) => ({ text, start: origin + start, end: origin + end })),
    boundaryMismatch: internal.some((error) => error > tolerance),
  };
};
