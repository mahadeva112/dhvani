import { lettersOf } from './dubTakes.js';

/** An aligned word this long may pick the script up again further on. */
const RESYNC_MIN_LETTERS = 3;
/** How far ahead in the script (letters) it may look. */
const RESYNC_WINDOW = 400;
/** Below this share of the script's letters matched, the dub says something else: no timing at all. */
const MIN_MATCHED = 0.6;

/**
 * Word timings for the dub's subtitles, from ElevenLabs forced alignment.
 *
 * `words` are the aligner's `[{ text, start, end }]` for the whole dub;
 * `cues` are `[{ id, text }]` in the order the dub says them. Returns
 * `[{ id, words: [{ text, start, end }] }]` with exactly one timed entry per
 * whitespace token of each cue's text, so the app can cut subtitles on the
 * dub's real word boundaries. Matching is letter by letter, so spacing and
 * punctuation never matter. Where the words and the script part ways (a word
 * skipped or said differently), matching picks up again further on and only
 * the cues in between get no words (`words: []`), so they alone fall back to
 * estimated timing. Returns null when most of the script isn't matched — the
 * dub says something else, and no timing is better than a wrong one.
 */
export const wordTimesForCues = (words, cues) => {
  const tokens = cues.map((cue) =>
    String(cue.text || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((text) => ({ text, start: null, end: null }))
  );

  const owner = [];
  let script = '';
  tokens.forEach((list, c) =>
    list.forEach((token, t) => {
      const letters = lettersOf(token.text);
      script += letters;
      for (let k = 0; k < letters.length; k += 1) owner.push([c, t]);
    })
  );
  if (!script) return null;

  // Letters of the script no aligned word accounted for: a word the dub
  // skipped, or said differently. Their cues keep estimated timing.
  const missed = new Uint8Array(script.length);
  let at = 0;
  let matched = 0;
  for (const word of Array.isArray(words) ? words : []) {
    const letters = lettersOf(word?.text);
    if (!letters) continue;
    if (script.slice(at, at + letters.length) !== letters) {
      // Pick the thread up again a little further on, but only on a word long
      // enough not to match by chance; otherwise this word is passed over.
      const ahead = letters.length >= RESYNC_MIN_LETTERS ? script.indexOf(letters, at) : -1;
      if (ahead < 0 || ahead - at > RESYNC_WINDOW) continue;
      missed.fill(1, at, ahead);
      at = ahead;
    }
    const start = Number(word.start);
    const end = Number(word.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      const seen = new Set();
      for (const [c, t] of owner.slice(at, at + letters.length)) {
        const key = `${c}:${t}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const token = tokens[c][t];
        token.start = token.start === null ? start : Math.min(token.start, start);
        token.end = token.end === null ? end : Math.max(token.end, end);
      }
    }
    at += letters.length;
    matched += letters.length;
  }
  missed.fill(1, at);
  if (matched < MIN_MATCHED * script.length) return null;

  /** Cues with a word the dub didn't say as written: no word timings for them. */
  const unsure = new Set();
  missed.forEach((miss, k) => {
    if (miss) unsure.add(owner[k][0]);
  });

  // A token with no letters (a dash, an audio tag) is not said: it sits,
  // zero-length, where the word before it ended.
  let last = 0;
  for (const list of tokens) {
    for (const token of list) {
      if (token.start === null || token.end === null) {
        token.start = last;
        token.end = last;
      }
      last = token.end;
    }
  }

  const round3 = (value) => Math.round(value * 1000) / 1000;
  return cues.map((cue, c) => ({
    id: String(cue.id),
    words: unsure.has(c) ? [] : tokens[c].map(({ text, start, end }) => ({ text, start: round3(start), end: round3(end) })),
  }));
};
