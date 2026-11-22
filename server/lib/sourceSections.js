/**
 * The pure part of voice expression "Natural" (see sourceCues.js): the tags
 * it may use, the check that keeps every word, and how the script is cut into
 * sections of source audio. No Node APIs, so the app shares it: it hears the
 * sections ahead of Dub and must cut them as the server does.
 */

/**
 * The performance score's vocabulary, kept to a mild, natural delivery (voice
 * expression "Natural"). Theatrical tags the prompt warns against ([intense],
 * [authoritative]), its "[return to anchor]" placeholder, and the score's
 * own tags that push a read towards performance ([playful], [jovial],
 * [emphasize], [word-stretch], [dramatic pause]) are not in it, so they never
 * reach the voice.
 */
export const PERFORMANCE_TAGS = [
  // Thought function
  'reasoning', 'explaining', 'narrating', 'questioning', 'concluding', 'contrasting', 'illustrating',
  // Delivery
  'calm', 'serious', 'meditative', 'focused', 'matter of fact', 'firm', 'clear',
  // Pacing and prosody
  'slow', 'fast', 'normal pace', 'accelerating', 'decelerating', 'rising pitch', 'falling pitch',
  'clipped', 'rhythmic', 'flowing',
  // Pauses
  'sentence-build pause', 'audience-think pause', 'sharp pause',
];

const TAG = /\[([^\]\n]{1,120})\]/g;

/**
 * A bracketed tag reduced to its allowed parts in canonical form
 * ("[Explaining,  calm, intense]" → "[explaining, calm]"), or null if none of
 * its parts are allowed.
 */
export const performanceTag = (inner) => {
  const kept = [
    ...new Set(
      String(inner)
        .split(',')
        .map((part) => part.trim().toLowerCase().replace(/\s+/g, ' ').replace(/_/g, ' '))
        .filter((part) => PERFORMANCE_TAGS.includes(part))
    ),
  ];
  return kept.length ? `[${kept.join(', ')}]` : null;
};

/** The words of a text, ignoring tags, punctuation, symbols and spacing. */
export const wordsOf = (text) =>
  String(text || '')
    .replace(TAG, ' ')
    .normalize('NFC')
    .replace(/[\p{P}\p{S}\s]+/gu, '')
    .toLowerCase();

/**
 * The tagged line if it keeps every word of `original` exactly; otherwise the
 * original. Unknown tags are dropped and spacing is tidied.
 */
export const acceptSourceCues = (original, cued) => {
  if (!cued || typeof cued !== 'string') return original;
  const cleaned = cued
    .replace(TAG, (_, inner) => performanceTag(inner) || '')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
  return wordsOf(cleaned) === wordsOf(original) ? cleaned : original;
};

/** Longest stretch of source audio heard in one request, and most script in it. */
export const SECTION_SECONDS = 90;
export const SECTION_CHARS = 2500;

/** Audio either side of a section, so its first and last words are not clipped. */
export const SECTION_PAD_SECONDS = 0.25;

/**
 * Groups cues (in spoken order) into sections of at most SECTION_SECONDS of
 * audio and SECTION_CHARS of script. Cues without text are left out.
 */
export const groupSections = (cues) => {
  const sections = [];
  cues.forEach((cue, index) => {
    if (!String(cue.text || '').trim()) return;
    const last = sections[sections.length - 1];
    if (last && cue.end - last.start <= SECTION_SECONDS && last.chars + cue.text.length <= SECTION_CHARS) {
      last.indexes.push(index);
      last.end = Math.max(last.end, cue.end);
      last.chars += cue.text.length;
    } else {
      sections.push({ indexes: [index], start: cue.start, end: cue.end, chars: cue.text.length });
    }
  });
  return sections;
};
