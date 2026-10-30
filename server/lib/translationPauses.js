/**
 * Pause-aware translation: where the original speaker stops inside a cue,
 * the translation stops too, so the dub needs no "..." typed in by hand.
 *
 * A cue's word timestamps show where its speaker went quiet for a moment
 * (cuePauses). The cue goes to the model with a "‖" at each such place and
 * the syllables each piece has time for, and the model puts a "‖" at the
 * matching place of its line (the PAUSES directive in
 * providers/gemini/translation.js). A line that comes back with one "‖" for
 * each pause keeps them as pause marks (`[pause 0.6s]`, linePauses.js), each
 * as long as the original's silence: only the voice hears them, the script
 * and subtitles never do (readPausedLine). A line with any other count keeps
 * none, as every line did before.
 */
import { normalizePauses, stripPauses } from './linePauses.js';

/** A silence between a cue's words at least this long is a pause the translation keeps. */
export const TRANSLATION_PAUSE_SECONDS = 0.3;

/** Where the speaker paused, in the text the model reads and writes. */
export const PAUSE_SPLIT = '‖';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const hasWord = (text) => /[\p{L}\p{N}]/u.test(String(text ?? ''));

/**
 * A cue's pauses: `{ parts, pauses }`, its text cut where the speaker paused
 * (`parts`, each `{ text, talk }`, `talk` the seconds spent saying it) and
 * each pause's length in seconds. Null when the cue has no such pause, no
 * word timestamps, or a text whose words no longer match them (edited).
 */
export const cuePauses = (cue, { minPause = TRANSLATION_PAUSE_SECONDS } = {}) => {
  const words = (Array.isArray(cue?.words) ? cue.words : []).filter(
    (word) => hasWord(word?.text) && finite(word.start) && finite(word.end) && word.end >= word.start
  );
  const tokens = String(cue?.text ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || tokens.filter(hasWord).length !== words.length) return null;

  const parts = [];
  const pauses = [];
  let current = [];
  let w = 0;
  let partStart = 0;
  for (const token of tokens) {
    if (hasWord(token)) {
      const gap = w > 0 ? words[w].start - words[w - 1].end : 0;
      if (current.some(hasWord) && gap >= minPause) {
        parts.push({ text: current.join(' '), talk: Math.max(0.05, words[w - 1].end - words[partStart].start) });
        pauses.push(gap);
        current = [];
        partStart = w;
      }
      w += 1;
    }
    // A mark standing on its own ("—") stays with the words before it.
    current.push(token);
  }
  parts.push({ text: current.join(' '), talk: Math.max(0.05, words[w - 1].end - words[partStart].start) });
  return pauses.length ? { parts, pauses } : null;
};

/** The syllables each piece of a cue has time for, out of `total`, by how long its speaker took to say it. */
export const partSyllables = (parts, total) => {
  const talk = parts.reduce((sum, part) => sum + part.talk, 0);
  return parts.map((part) => Math.max(1, Math.round(total * (talk > 0 ? part.talk / talk : 1 / parts.length))));
};

/** A line without its "‖" marks, as the script keeps it. */
export const withoutSplits = (line) => (String(line ?? '').includes(PAUSE_SPLIT) ? stripPauses(String(line).split(PAUSE_SPLIT).join(' ')) : String(line ?? '').trim());

/**
 * A translated line read back: `text`, the line without "‖" (what the script
 * and subtitles keep), and `paused`, the same line with each "‖" as a pause
 * mark as long as the original's (`pauses`, seconds), or null when its marks
 * don't match `pauses` one for one: the model left them out because the
 * language's word order can't keep them, or wrote another number. `text` is
 * always `paused` without its marks (stripPauses), so Sync can tell a line
 * still says its translation.
 */
export const readPausedLine = (line, pauses = []) => {
  const raw = String(line ?? '');
  const pieces = raw.split(PAUSE_SPLIT).map((piece) => piece.trim());
  if (!pauses.length || pieces.length !== pauses.length + 1 || !pieces.every(hasWord)) {
    return { text: withoutSplits(raw), paused: null };
  }
  const paused = normalizePauses(pieces.map((piece, i) => (i < pauses.length ? `${piece} [pause ${pauses[i].toFixed(1)}s]` : piece)).join(' '));
  return { text: stripPauses(paused), paused };
};
