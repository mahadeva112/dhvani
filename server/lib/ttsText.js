/**
 * Text preparation for long text-to-speech requests.
 *
 * ElevenLabs quality drifts over one very long generation: the voice goes
 * flat, pacing wanders and artifacts creep in towards the end. The website
 * avoids this by generating in short passages, so a long script is cut here
 * into passages that each end on a natural boundary.
 */

/** Longest passage sent in one request. Well under every model's hard limit. */
export const MAX_TTS_CHUNK_CHARS = 1000;

/** Context passed as previous_text / next_text so intonation carries across passages. */
export const TTS_CONTEXT_CHARS = 300;

/** Sentence-ending punctuation across the scripts DHVANI dubs into, plus trailing quotes. */
const SENTENCE_END = /[.!?…।॥。！？؟]+["'”’)\]]*(?=\s)/gu;

/** Last index in `window` just past a match of `pattern`, or -1. */
const lastBoundary = (window, pattern) => {
  let cut = -1;
  for (const match of window.matchAll(pattern)) cut = match.index + match[0].length;
  return cut;
};

/**
 * Picks where to end a passage inside `window`, preferring (in order) a
 * paragraph break, a sentence end, a line break, then a word gap. Cuts too
 * close to the start are skipped so passages don't become tiny fragments.
 */
const findCut = (window) => {
  const floor = Math.floor(window.length * 0.4);
  const candidates = [
    lastBoundary(window, /\n\s*\n/g),
    lastBoundary(window, SENTENCE_END),
    lastBoundary(window, /\n/g),
    lastBoundary(window, / /g),
  ];
  for (const cut of candidates) {
    if (cut > floor) return cut;
  }
  return window.length;
};

/**
 * What separated a passage from the next one in the script. The join between
 * the two passages' audio gets a pause of matching length (see PASSAGE_PAUSE_SECONDS).
 *
 * buildSpeechScript writes a blank line where the source audio paused for a
 * paragraph and a single line break for a breath after a sentence.
 */
const breakAfter = (chunk, separator) => {
  if (/\n\s*\n/.test(separator)) return 'paragraph';
  if (/\n/.test(separator)) return 'line';
  if (!separator) return 'none';
  return /[.!?…।॥。！？؟]+["'”’)\]]*$/u.test(chunk) ? 'sentence' : 'word';
};

/**
 * Silence placed between two passages, by what separated them. Roughly what
 * ElevenLabs itself leaves at the same boundary inside one generation, so a
 * join sounds like any other pause in the read.
 */
export const PASSAGE_PAUSE_SECONDS = {
  paragraph: 0.8,
  line: 0.55,
  sentence: 0.35,
  word: 0.08,
  none: 0,
};

/**
 * Splits `text` into passages of at most `maxChars`, each ending on a natural
 * boundary. Every passage but the last reports the boundary it ends on as
 * `breakAfter`.
 */
export const splitPassages = (text, maxChars = MAX_TTS_CHUNK_CHARS) => {
  let remaining = String(text || '').trim();
  const passages = [];

  while (remaining.length > maxChars) {
    const cut = findCut(remaining.slice(0, maxChars));
    const head = remaining.slice(0, cut);
    const rest = remaining.slice(cut);
    const chunk = head.trim();
    // The whitespace either side of the cut is what separated the passages.
    const separator = head.slice(head.trimEnd().length) + rest.slice(0, rest.length - rest.trimStart().length);
    if (chunk) passages.push({ text: chunk, breakAfter: breakAfter(chunk, separator) });
    remaining = rest.trim();
  }
  if (remaining) passages.push({ text: remaining, breakAfter: null });

  return passages;
};

/** Splits `text` into passages of at most `maxChars`, each ending on a natural boundary. */
export const splitTextForSpeech = (text, maxChars = MAX_TTS_CHUNK_CHARS) =>
  splitPassages(text, maxChars).map((passage) => passage.text);

/** The tail of the passage before `index` and the head of the one after it. */
export const contextAround = (chunks, index, contextChars = TTS_CONTEXT_CHARS) => ({
  previousText: index > 0 ? chunks[index - 1].slice(-contextChars) : undefined,
  nextText: index < chunks.length - 1 ? chunks[index + 1].slice(0, contextChars) : undefined,
});
