/**
 * Match source pauses: a dub line pauses only where the original speaker did.
 *
 * A voice often stops between two words for no reason the original gives: at
 * a comma, an ellipsis or a sentence end the translation has and the speaker
 * ran straight through. Each such pause makes the line longer than the
 * original, and the lines after it start late. Here every pause between the
 * dub's words is matched to the original's pauses in the same line, by where
 * in the line it falls: a pause the original has too keeps up to the
 * original's length, and one it doesn't is shortened to a word gap.
 *
 * The original's pauses come from its word timestamps (ElevenLabs). A line
 * with any cue missing them is left as it is: there is nothing to match to.
 * Only silence is ever taken out (see shortenPauses in syncRender.js).
 */

/** A gap between the original's words shorter than this is a word boundary, not a pause. */
export const SOURCE_PAUSE_SECONDS = 0.15;

/**
 * A dub pause matches an original one when they are this close, as a share
 * of each line's talking time (see pausePositions): the dub's words rarely fall exactly where
 * the original's do, and a translation may move a clause.
 */
export const PAUSE_MATCH_WINDOW = 0.12;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const spoken = (word) => /[\p{L}\p{N}]/u.test(String(word?.text ?? 'x'));

/**
 * Where each of `gaps` (`[{ start, end }]` in seconds, in order, between
 * `first` and `last`) falls in a line, as a share (0-1) of its talking time:
 * the time spent saying words before the gap starts, over all of it. Pauses
 * of SOURCE_PAUSE_SECONDS or more are not talking time, so a dub that pauses
 * where the original doesn't still lines up with it after that pause.
 */
export const pausePositions = (gaps, first, last) => {
  const isPause = (gap) => gap.end - gap.start >= SOURCE_PAUSE_SECONDS;
  const silent = gaps.reduce((sum, gap) => sum + (isPause(gap) ? gap.end - gap.start : 0), 0);
  const talk = last - first - silent;
  if (!(talk > 0)) return gaps.map(() => 0.5);
  let before = 0;
  return gaps.map((gap) => {
    const at = (gap.start - first - before) / talk;
    if (isPause(gap)) before += gap.end - gap.start;
    return Math.min(1, Math.max(0, at));
  });
};

/**
 * The original's pauses inside one line, from its cues' word timestamps:
 * `[{ at, length }]`, `at` where it falls (see pausePositions) and `length`
 * in seconds. An empty list is a line spoken in one go. Null when a cue has
 * no word timestamps.
 */
export const sourcePausesOf = (cues) => {
  const words = [];
  for (const cue of cues) {
    const timed = (Array.isArray(cue?.words) ? cue.words : []).filter((word) => spoken(word) && finite(word.start) && finite(word.end) && word.end >= word.start);
    if (timed.length === 0) return null;
    words.push(...timed);
  }
  words.sort((a, b) => a.start - b.start);
  const gaps = [];
  let lastEnd = words[0].end;
  for (const word of words.slice(1)) {
    if (word.start - lastEnd >= SOURCE_PAUSE_SECONDS) gaps.push({ start: lastEnd, end: word.start });
    lastEnd = Math.max(lastEnd, word.end);
  }
  const at = pausePositions(gaps, words[0].start, lastEnd);
  return gaps.map((gap, n) => ({ at: at[n], length: gap.end - gap.start }));
};

/**
 * How long each of the dub's pauses may stay. `pauses` are the dub's, each
 * `{ at, length }` as sourcePausesOf gives them; `source` the original's.
 * Each original pause is matched to at most one dub pause, the closest pairs
 * first. Returns, for each dub pause in order, the seconds it may keep: an
 * unmatched one `keep`, a matched one the original's length (at least
 * `keep`); never more than it has.
 */
export const pauseAllowances = (pauses, source, { keep, window = PAUSE_MATCH_WINDOW }) => {
  const pairs = [];
  pauses.forEach((pause, d) => {
    source.forEach((original, s) => {
      const distance = Math.abs(pause.at - original.at);
      if (distance <= window) pairs.push({ d, s, distance });
    });
  });
  pairs.sort((a, b) => a.distance - b.distance || a.d - b.d);
  const matched = new Map();
  const used = new Set();
  for (const { d, s } of pairs) {
    if (matched.has(d) || used.has(s)) continue;
    matched.set(d, s);
    used.add(s);
  }
  return pauses.map((pause, d) => Math.min(pause.length, matched.has(d) ? Math.max(keep, source[matched.get(d)].length) : keep));
};

/** A mark a voice tends to pause at, with more of the line after it. */
const BREAK_MARK = /(…|\.{2,}|[,;:،、।॥.!?。！？؟—–])(?=["'”’)\]]*\s+[^\s])/gu;
const LETTER = /[\p{L}\p{N}\p{M}]/gu;
const letters = (text) => (text.match(LETTER) || []).length;

/**
 * The marks inside a dub line where a voice tends to pause and the original
 * speaker doesn't, as `[{ mark, after }]`, `after` the word the mark follows:
 * the line reads more like the original without them, and Sync would cut the
 * pause they make (Match source pauses). A mark's place is its share of the
 * line's letters, matched to the original's pauses as a dub pause is
 * (PAUSE_MATCH_WINDOW). Empty when `source` is null: nothing to compare with.
 */
export const unpausedMarks = (text, source, { window = PAUSE_MATCH_WINDOW } = {}) => {
  const line = String(text || '');
  const total = letters(line);
  if (!source || total === 0) return [];
  const marks = [];
  for (const match of line.matchAll(BREAK_MARK)) {
    const before = line.slice(0, match.index);
    const at = letters(before) / total;
    if (source.some((pause) => Math.abs(pause.at - at) <= window)) continue;
    marks.push({ mark: match[1], after: before.trim().split(/\s+/).at(-1) || '' });
  }
  return marks;
};
