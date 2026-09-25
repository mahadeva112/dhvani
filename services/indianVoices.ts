import type { Voice } from './elevenLabsService';

/**
 * Which ElevenLabs voices to suggest for an Indian-language dub.
 *
 * A voice counts as Indian by its own labels (an Indian accent, or an Indian
 * language as its language) or, for clones that carry no labels, by its name
 * ("Hindi dub 2"). The languages ElevenLabs has verified a voice in are not
 * used for this: large multilingual voices are verified in Hindi and Tamil
 * alongside twenty others, which would make half the library "Indian". They
 * only help rank voices for the dub language.
 */

/** ISO 639 codes ElevenLabs uses for a voice's language, by DHVANI's language name. */
export const INDIAN_LANGUAGE_CODES: Record<string, string> = {
  Hindi: 'hi',
  Bengali: 'bn',
  Tamil: 'ta',
  Telugu: 'te',
  Marathi: 'mr',
  Gujarati: 'gu',
  Kannada: 'kn',
  Malayalam: 'ml',
  Punjabi: 'pa',
  Urdu: 'ur',
  Odia: 'or',
  Assamese: 'as',
  Nepali: 'ne',
  Sanskrit: 'sa',
  Sindhi: 'sd',
  Konkani: 'kok',
  Maithili: 'mai',
};

const INDIAN_CODES = new Set(Object.values(INDIAN_LANGUAGE_CODES));

const INDIAN_WORDS =
  'indian|hindi|hinglish|desi|bengali|bangla|tamil|telugu|marathi|gujarati|kannada|malayalam|punjabi|urdu|odia|assamese';
const INDIAN_ACCENT = new RegExp(INDIAN_WORDS, 'i');
const INDIAN_NAME = new RegExp(`\\b(${INDIAN_WORDS})\\b`, 'i');

type VoiceLike = Pick<Voice, 'name' | 'labels' | 'verified_languages'>;

const baseCode = (code?: string | null) => String(code || '').toLowerCase().split(/[-_]/)[0];

/** Accents that mark a voice as not Indian, whatever its name says. */
const NON_INDIAN_ACCENT = /american|british|latin|australian|canadian|irish|scottish|african|spanish|mexican|argentin/i;

export const isIndianVoice = (voice: VoiceLike): boolean => {
  const labels = voice.labels || {};
  const accent = labels.accent || '';
  if (INDIAN_ACCENT.test(accent) || INDIAN_CODES.has(baseCode(labels.language))) return true;
  // The name only decides for voices whose labels don't say otherwise.
  return !NON_INDIAN_ACCENT.test(accent) && INDIAN_NAME.test(voice.name || '');
};

/**
 * How well a voice fits a dub language: 2 if it is the voice's own language
 * (by label, or named for it), 1 if ElevenLabs has verified it in the
 * language, 0 otherwise.
 */
export const languageFit = (voice: VoiceLike, languageName: string): number => {
  const code = INDIAN_LANGUAGE_CODES[languageName];
  if (!code) return 0;
  if (baseCode(voice.labels?.language) === code) return 2;
  if (new RegExp(`\\b${languageName}\\b`, 'i').test(voice.name || '')) return 2;
  return (voice.verified_languages || []).some((l) => baseCode(l.language) === code) ? 1 : 0;
};
