/**
 * Syllables in a dub line, the measure a new wording's length is judged by.
 * Characters are a poor one for Indian scripts, where one syllable can be
 * three or four characters (प्र, स्व, क्ष्म) and a word's last consonant is
 * often said without its vowel, so a wording can be "short enough" in
 * characters and still take longer to say.
 *
 * Mirrors syllablesIn and the counting in timeLine (services/speechTiming.ts),
 * which the app's Expert estimate uses; syllables.test.js holds the two to
 * the same counts.
 */

/*
 * The Brahmic scripts share one layout inside their Unicode blocks, so one
 * reading of the offsets serves Devanagari, Bengali, Gurmukhi, Gujarati,
 * Oriya, Tamil, Telugu, Kannada and Malayalam.
 */
const BRAHMIC_BLOCKS = [0x0900, 0x0980, 0x0a00, 0x0a80, 0x0b00, 0x0b80, 0x0c00, 0x0c80, 0x0d00];
/** Scripts whose words drop the vowel after their last consonant (Hindi कमल is "ka-mal", not "ka-ma-la"). */
const FINAL_SCHWA_DROPPED = new Set([0x0900, 0x0980, 0x0a00, 0x0a80]);
const blockOf = (ch) => {
  const base = (ch.codePointAt(0) ?? 0) & ~0x7f;
  return BRAHMIC_BLOCKS.includes(base) ? base : null;
};
const isConsonant = (o) => (o >= 0x15 && o <= 0x39) || (o >= 0x58 && o <= 0x5f);
const isIndependentVowel = (o) => (o >= 0x05 && o <= 0x14) || o === 0x60 || o === 0x61;
const isVowelSign = (o) => (o >= 0x3e && o <= 0x4c) || o === 0x62 || o === 0x63;
const VIRAMA = 0x4d;
const NUKTA = 0x3c;

const brahmicSyllables = (word, base) => {
  const offsets = [...word].map((ch) => (ch.codePointAt(0) ?? 0) - base);
  // 'V' a syllable with its own vowel, 'A' a consonant with the inherent "a",
  // 'C' a joined cluster with it, whose "a" is said even at a word's end (मित्र, স্বাস্থ্য).
  const units = [];
  let joined = false;
  for (let i = 0; i < offsets.length; i++) {
    const o = offsets[i];
    if (isIndependentVowel(o)) units.push('V');
    else if (isConsonant(o)) {
      if (offsets[i + 1] === NUKTA) i++;
      // A consonant with a virama joins the next one: प्र is one syllable.
      if (offsets[i + 1] === VIRAMA) {
        i++;
        joined = true;
        continue;
      }
      if (isVowelSign(offsets[i + 1])) {
        units.push('V');
        i++;
      } else units.push(joined ? 'C' : 'A');
      joined = false;
    }
  }
  if (FINAL_SCHWA_DROPPED.has(base) && units.length > 1 && units[units.length - 1] === 'A') units.pop();
  // Hindi also drops one inherent "a" between two vowels in longer words: सेहत is "seh-at" → "se-hat".
  if (base === 0x0900 && units.length > 3) {
    const at = units.findIndex((u, i) => i > 0 && i < units.length - 1 && u === 'A' && units[i - 1] === 'V' && units[i + 1] === 'V');
    if (at > 0) units.splice(at, 1);
  }
  return Math.max(1, units.length);
};

/** Syllables in one word, in any script: Brahmic by its letters, Latin by vowel groups, others roughly. */
export const syllablesIn = (word) => {
  const first = [...word].find((ch) => /\p{L}/u.test(ch));
  if (!first) return 0;
  const base = blockOf(first);
  if (base !== null) return brahmicSyllables(word, base);
  if (/\p{Script=Latin}/u.test(first)) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    // A silent final e (made, time) is not a syllable of its own.
    return Math.max(1, (w.replace(/(?<=[^aeiouy])e$/, '').match(/[aeiouy]+/g) || []).length);
  }
  // Scripts not read here: about one syllable for every two and a half letters.
  const letters = [...word].filter((ch) => /\p{L}/u.test(ch)).length;
  return Math.max(1, Math.round(letters / 2.5));
};

const bare = (word) => word.replace(/[,;:.!?।॥—–"'“”‘’()]+/g, '');

/** Syllables in a whole line; a hyphenated word (धीरे-धीरे) is said as its parts. */
export const lineSyllables = (text) =>
  String(text ?? '')
    .trim()
    .split(/\s+/)
    .map(bare)
    .filter(Boolean)
    .reduce((sum, part) => sum + part.split('-').filter(Boolean).reduce((s, w) => s + syllablesIn(w), 0), 0);
