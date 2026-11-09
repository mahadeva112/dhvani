/**
 * A take's words, from the timing the voice gives with its audio, so a take
 * used in the dub can be cut between its words without asking forced
 * alignment for them (and paying for it).
 *
 * ElevenLabs' with-timestamps endpoint says when each character of the text
 * it was sent is spoken. That timing is a little coarse (tens of
 * milliseconds), so it only says roughly where each word is: the take's own
 * samples then say where to cut, at the quietest point between two words,
 * and where each word's sound starts and ends either side of that cut.
 */
import { stripTags } from './lineTags.js';
import { stripPauses } from './linePauses.js';
import { quietestPoint } from './dubTakes.js';

/** Sound above this is speech (as syncRender.js reads a clip). */
const SPEECH_LEVEL = 0.0032;
/** How far the voice's timing of a word's edge may be off, looked past when finding the pause after it. */
const EDGE_SLOP_SECONDS = 0.08;
/** The window the quietest point is looked for with. */
const QUIET_WINDOW_SECONDS = 0.01;

const spoken = (token) => /[\p{L}\p{N}]/u.test(token);

/** The words `text` says, as a dub line counts them: tags, pause marks and lone punctuation left out. */
export const sayWords = (text) => stripTags(stripPauses(String(text || ''))).split(/\s+/).filter(spoken);

/**
 * The words of `text`, `{ start, end }` seconds into the audio, from the
 * voice's character timing (`alignment`, for the text as sent: tags in
 * square brackets, SSML in angle brackets and pause marks are left out).
 * Null when there is no timing or its words are not the text's.
 */
export const wordsFromAlignment = (alignment, text) => {
  if (!alignment) return null;
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  if (!Array.isArray(characters) || characters.length !== starts?.length || characters.length !== ends?.length) return null;
  const words = [];
  let word = null;
  let inside = null;
  const close = () => {
    if (word && spoken(word.text)) words.push({ start: word.start, end: Math.max(word.start, word.end) });
    word = null;
  };
  characters.forEach((ch, i) => {
    if (inside) {
      if (ch === inside) inside = null;
      return;
    }
    if (ch === '[' || ch === '<') {
      close();
      inside = ch === '[' ? ']' : '>';
      return;
    }
    if (/\s/.test(ch)) return close();
    if (!Number.isFinite(starts[i]) || !Number.isFinite(ends[i])) return;
    if (!word) word = { text: '', start: starts[i], end: ends[i] };
    word.text += ch;
    word.end = ends[i];
  });
  close();
  return words.length > 0 && words.length === sayWords(text).length ? words : null;
};

/**
 * `words` (seconds into `samples`, roughly) made exact from the take's own
 * sound: `gaps[w]`, the quietest point between word w and the next, where a
 * take may be cut without cutting a word; and each word's first and last
 * sound either side of those points. `lead` and `speech` are the take's first
 * sound and how long it speaks (prepareClip). Returns `{ words, gaps }`,
 * `words` as `[start, end]` pairs.
 */
export const refineWords = (samples, sampleRate, words, { lead, speech }) => {
  const length = samples.length / sampleRate;
  const window = Math.max(1, Math.round(QUIET_WINDOW_SECONDS * sampleRate));
  const gaps = [];
  for (let w = 0; w < words.length - 1; w++) {
    const now = words[w];
    const next = words[w + 1];
    let from = Math.max(now.start, Math.min(now.end, next.start) - EDGE_SLOP_SECONDS);
    let to = Math.min(next.end, Math.max(next.start, now.end) + EDGE_SLOP_SECONDS);
    if (!(to > from)) [from, to] = [Math.min(now.end, next.start), Math.max(now.end, next.start)];
    const cut = quietestPoint(samples, from * sampleRate, to * sampleRate, window) / sampleRate;
    gaps.push(Math.max(gaps.at(-1) ?? 0, Math.min(length, cut)));
  }
  const loud = (i) => Math.abs(samples[i]) > SPEECH_LEVEL;
  const out = words.map((word, w) => {
    const low = w === 0 ? 0 : gaps[w - 1];
    const high = w === words.length - 1 ? length : gaps[w];
    // Its first sound after the cut before it, and its last before the cut after it.
    let start = w === 0 ? lead : null;
    if (start === null) {
      for (let i = Math.round(low * sampleRate); i < Math.round(high * sampleRate); i++) {
        if (loud(i)) {
          start = i / sampleRate;
          break;
        }
      }
    }
    let end = w === words.length - 1 ? lead + speech : null;
    if (end === null) {
      for (let i = Math.round(high * sampleRate) - 1; i >= Math.round(low * sampleRate); i--) {
        if (loud(i)) {
          end = (i + 1) / sampleRate;
          break;
        }
      }
    }
    start = Math.min(Math.max(low, start ?? word.start), high);
    end = Math.min(Math.max(start, end ?? word.end), high);
    return [round(start), round(end)];
  });
  return { words: out, gaps: gaps.map(round) };
};

const round = (seconds) => Math.round(seconds * 10000) / 10000;

/**
 * The words of a line whose phrase was read again (splicePhrase): the old
 * take's words before the phrase and after it moved by how much longer the
 * new reading is, with the phrase's own words between. `oldWords` are the old
 * take's `[start, end]` pairs, `before` and `after` how many of them stay
 * either side, `cut` the samples kept `{ from, to }` (phraseCut),
 * `phraseWords` the new reading's words in its own clip and `phraseLength` its
 * samples, `start` the samples the spliced line was trimmed by. Null when the
 * words don't add up.
 */
export const splicedWords = ({ oldWords, before, after, cut, phraseWords, phraseLength, start, sampleRate }) => {
  if (!Array.isArray(oldWords) || before + after > oldWords.length || !phraseWords) return null;
  const head = cut.from / sampleRate;
  const shift = (phraseLength - (cut.to - cut.from)) / sampleRate;
  const trim = start / sampleRate;
  const kept = oldWords.slice(0, before).map(([s, e]) => ({ start: s, end: e }));
  if (kept.some((word) => word.end > head + 1e-3)) return null;
  const tail = oldWords.slice(oldWords.length - after).map(([s, e]) => ({ start: s + shift, end: e + shift }));
  const read = phraseWords.map((word) => ({ start: word.start + head, end: word.end + head }));
  return [...kept, ...read, ...tail].map((word) => ({ start: Math.max(0, word.start - trim), end: Math.max(0, word.end - trim) }));
};
