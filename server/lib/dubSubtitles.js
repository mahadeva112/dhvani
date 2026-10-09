import { lettersOf } from './dubTakes.js';

/**
 * Word timings for the dub's subtitles, from ElevenLabs forced alignment.
 *
 * `words` are the aligner's `[{ text, start, end }]` for the whole dub;
 * `cues` are `[{ id, text }]` in the order the dub says them. Returns
 * `[{ id, words: [{ text, start, end }] }]` with exactly one timed entry per
 * whitespace token of each cue's text, so the app can cut subtitles on the
 * dub's real word boundaries. Matching is letter by letter, so spacing and
 * punctuation never matter. Returns null when the aligned words do not spell
 * out the script — the dub says something else, and no timing is better than
 * a wrong one.
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

  let at = 0;
  for (const word of Array.isArray(words) ? words : []) {
    const letters = lettersOf(word?.text);
    if (!letters) continue;
    if (script.slice(at, at + letters.length) !== letters) return null;
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
  }
  if (at !== script.length) return null;

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
    words: tokens[c].map(({ text, start, end }) => ({ text, start: round3(start), end: round3(end) })),
  }));
};
