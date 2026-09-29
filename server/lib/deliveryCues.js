/**
 * Delivery cues for Eleven v3.
 *
 * Given plain script text, v3 reads it evenly, like someone reading aloud.
 * It performs a line when the text carries direction: audio tags such as
 * [curious] or [sighs], and punctuation that marks how the words are said
 * (a "…" for a trailing thought, "?" and "!" for their intonation). The
 * ElevenLabs website's Enhance button adds exactly these, and so does this.
 *
 * A text model proposes the cues; `acceptCues` then guarantees the words are
 * untouched — only tags from AUDIO_TAGS and punctuation may differ — and
 * anything else is thrown away in favour of the original text.
 */
import { logger } from '../logger.js';
import { generateText } from '../providers/textModel.js';

/** Tags v3 performs that suit spoken dialogue. Anything else the model writes is removed. */
export const AUDIO_TAGS = [
  'thoughtful',
  'curious',
  'excited',
  'calm',
  'serious',
  'warmly',
  'amused',
  'sarcastic',
  'mischievously',
  'sighs',
  'exhales',
  'chuckles',
  'laughs',
  'whispers',
];

const TAG = /\[([^\]\n]{1,40})\]/g;

/** The words of a text, ignoring audio tags, punctuation, symbols and spacing. */
const wordsOf = (text) =>
  String(text || '')
    .replace(TAG, ' ')
    .normalize('NFC')
    .replace(/[\p{P}\p{S}\s]+/gu, '')
    .toLowerCase();

/** Removes tags v3 should not see, keeping the allowed ones in canonical form. */
const keepAllowedTags = (text) =>
  text.replace(TAG, (_, name) => {
    const tag = name.trim().toLowerCase();
    return AUDIO_TAGS.includes(tag) ? `[${tag}]` : '';
  });

/**
 * The cued text if it keeps every word of `original` exactly; otherwise the
 * original. Unknown tags are dropped and spacing is tidied.
 */
export const acceptCues = (original, cued) => {
  if (!cued || typeof cued !== 'string') return original;
  const cleaned = keepAllowedTags(cued)
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
  return wordsOf(cleaned) === wordsOf(original) ? cleaned : original;
};

export const buildCuePrompt = (text, language, { before } = {}) => `You are a dubbing director preparing a ${language || 'dialogue'} script for the ElevenLabs Eleven v3 voice model, so that it sounds like a person talking, not someone reading aloud.

The script is one continuous read by the same speaker. Keep the delivery consistent from start to end: settle on one overall tone that suits the script and depart from it only where a line clearly calls for it.

Add delivery direction to the script below. You may ONLY:
1. Insert audio tags, in English, in square brackets, chosen from: ${AUDIO_TAGS.map((t) => `[${t}]`).join(' ')}.
   Place a tag right before the words it colours. Use them sparingly — at most one every two or three sentences, and only where the line clearly calls for it. A calm explanation needs few or none.
2. Adjust punctuation so it shows how the line is spoken: commas where a speaker breathes, "…" for a trailing or hesitant thought, "?" and "!" where the intonation rises or lifts, a dash for a sudden turn.

You must NOT add, remove, reorder, translate or respell any word. Keep every line break exactly where it is.

${before ? `The script so far, already directed (for continuity only; do not repeat it):
${before}

` : ''}SCRIPT:
${text}

Reply with only the directed script, nothing else.`;

/**
 * `text` with delivery cues added by the configured text model, or `text`
 * unchanged if the model is unavailable, fails, or changes any word.
 */
export const addDeliveryCues = async (text, { language, apiKey, before } = {}) => {
  try {
    const { response } = await generateText({
      contents: { role: 'user', parts: [{ text: buildCuePrompt(text, language, { before }) }] },
      generationConfig: { temperature: 0.4 },
      apiKey,
    });
    const cued = acceptCues(text, String(response?.text || '').trim());
    if (cued === text) logger.info('Delivery cues left a passage as written (the suggestion changed words or added nothing).');
    return cued;
  } catch (err) {
    logger.warn(`Could not add delivery cues (${err.message}); the passage is spoken as written.`);
    return text;
  }
};

/** Longest stretch of script cued in one request; most scripts fit in one. */
export const CUE_SECTION_CHARS = 6000;

/** Directed text carried into the next section's request so its tone continues. */
const CUE_CONTINUITY_CHARS = 600;

const NON_WORD = /[\p{P}\p{S}\s]/u;
const TAG_AT = /\[([^\]\n]{1,40})\]/y;

/** How many word characters `text` has, counted as wordsOf counts them (before lowercasing). */
const wordCount = (text) =>
  String(text || '')
    .replace(TAG, ' ')
    .normalize('NFC')
    .replace(/[\p{P}\p{S}\s]+/gu, '').length;

/**
 * Cuts `cued` into pieces holding the same words as each of `originals`, so
 * cues added to a whole section land back on the passages it was made from.
 * A passage's trailing punctuation stays with it; a tag goes with the words
 * after it. Returns null if the words don't line up.
 */
export const splitLike = (cued, originals) => {
  const text = String(cued || '').normalize('NFC');
  const targets = [];
  let total = 0;
  for (const original of originals) targets.push((total += wordCount(original)));
  if (wordCount(text) !== total) return null;

  const pieces = [];
  let start = 0;
  let count = 0;
  let index = 0;
  for (let k = 0; k < targets.length - 1; k++) {
    while (count < targets[k] && index < text.length) {
      TAG_AT.lastIndex = index;
      const tag = text[index] === '[' ? TAG_AT.exec(text) : null;
      if (tag) {
        index += tag[0].length;
        continue;
      }
      const ch = String.fromCodePoint(text.codePointAt(index));
      if (!NON_WORD.test(ch)) count += ch.length;
      index += ch.length;
    }
    // Keep closing punctuation and quotes with the passage they end.
    while (index < text.length && text[index] !== '[' && !/\s/.test(text[index]) && NON_WORD.test(text[index])) index++;
    pieces.push(text.slice(start, index).trim());
    start = index;
  }
  pieces.push(text.slice(start).trim());
  return pieces.every((piece, i) => piece || !originals[i].trim()) ? pieces : null;
};

/**
 * Delivery cues for a script already split into `passages`. Cueing each
 * passage on its own let the text model pick a different tone for each, which
 * the voice then followed from one passage to the next. Instead the script is
 * cued as a whole (in sections of CUE_SECTION_CHARS for very long scripts,
 * each told how the one before it was directed) and the result cut back into
 * the same passages. A section whose cues can't be used is spoken as written.
 */
export const addDeliveryCuesToPassages = async (passages, { language, apiKey } = {}) => {
  const sections = [];
  for (let i = 0; i < passages.length; i++) {
    const last = sections[sections.length - 1];
    if (last && last.chars + passages[i].length <= CUE_SECTION_CHARS) {
      last.indexes.push(i);
      last.chars += passages[i].length;
    } else {
      sections.push({ indexes: [i], chars: passages[i].length });
    }
  }

  const result = [...passages];
  let before;
  for (const { indexes } of sections) {
    const originals = indexes.map((i) => passages[i]);
    const whole = originals.join('\n');
    const cued = await addDeliveryCues(whole, { language, apiKey, before });
    const pieces = cued === whole ? null : splitLike(cued, originals);
    if (cued !== whole && !pieces) logger.info('Delivery cues could not be matched back to the passages; this section is spoken as written.');
    if (pieces) indexes.forEach((i, k) => (result[i] = pieces[k]));
    before = (pieces ? pieces.join('\n') : whole).slice(-CUE_CONTINUITY_CHARS);
  }
  return result;
};
