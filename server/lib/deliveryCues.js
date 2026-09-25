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

export const buildCuePrompt = (text, language) => `You are a dubbing director preparing a ${language || 'dialogue'} script for the ElevenLabs Eleven v3 voice model, so that it sounds like a person talking, not someone reading aloud.

Add delivery direction to the script below. You may ONLY:
1. Insert audio tags, in English, in square brackets, chosen from: ${AUDIO_TAGS.map((t) => `[${t}]`).join(' ')}.
   Place a tag right before the words it colours. Use them sparingly — at most one every two or three sentences, and only where the line clearly calls for it. A calm explanation needs few or none.
2. Adjust punctuation so it shows how the line is spoken: commas where a speaker breathes, "…" for a trailing or hesitant thought, "?" and "!" where the intonation rises or lifts, a dash for a sudden turn.

You must NOT add, remove, reorder, translate or respell any word. Keep every line break exactly where it is.

SCRIPT:
${text}

Reply with only the directed script, nothing else.`;

/**
 * `text` with delivery cues added by the configured text model, or `text`
 * unchanged if the model is unavailable, fails, or changes any word.
 */
export const addDeliveryCues = async (text, { language, apiKey } = {}) => {
  try {
    const { response } = await generateText({
      contents: { role: 'user', parts: [{ text: buildCuePrompt(text, language) }] },
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
