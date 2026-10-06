/*
 * How long a dub line takes to say, counted the way speech is timed: in
 * syllables at the voice's own rate, plus the pauses its punctuation asks
 * for. Characters are a poor measure for Indian scripts, where one syllable
 * can be three or four characters (प्र, स्व, क्ष्म) and a word's last
 * consonant is often said without its vowel.
 *
 * Also where the lips close (p, b, m and their Indian-script letters) in a
 * line, which shows on screen on close-ups: a dub with no closure where the
 * original speaker's mouth closes reads as out of sync even when its timing is.
 *
 * Pure functions, no audio: the Expert estimate of the Sync preview.
 */

/** One word of a line, timed from the line's start. */
export interface TimedWord {
  text: string;
  start: number;
  end: number;
  syllables: number;
}

export interface LineTiming {
  /** Seconds to say the line: its syllables at the rate, plus its pauses. */
  seconds: number;
  syllables: number;
  words: TimedWord[];
  /** Seconds from the line's start where the lips close. */
  lips: number[];
}

/** Pause after a comma, semicolon, colon or dash inside a line. */
const COMMA_PAUSE = 0.25;
/** Pause after a full stop, danda, question or exclamation mark inside a line. */
const STOP_PAUSE = 0.35;
/** The small gap between two words said in one breath. */
const WORD_GAP = 0.03;

/** Fastest and slowest believable rates, in syllables a second. */
const MIN_RATE = 2.5;
const MAX_RATE = 9;
/** A typical dub rate, used when there is nothing to measure one from. */
export const TYPICAL_SYLLABLES_PER_SECOND = 4.5;

/** A read can run this much faster or slower than the estimate: the range shown around it. */
export const READ_SPREAD = 0.1;

/*
 * The Brahmic scripts share one layout inside their Unicode blocks, so one
 * reading of the offsets serves Devanagari, Bengali, Gurmukhi, Gujarati,
 * Oriya, Tamil, Telugu, Kannada and Malayalam.
 */
const BRAHMIC_BLOCKS = [0x0900, 0x0980, 0x0a00, 0x0a80, 0x0b00, 0x0b80, 0x0c00, 0x0c80, 0x0d00];
/** Scripts whose words drop the vowel after their last consonant (Hindi कमल is "ka-mal", not "ka-ma-la"). */
const FINAL_SCHWA_DROPPED = new Set([0x0900, 0x0980, 0x0a00, 0x0a80]);
const blockOf = (ch: string) => {
  const code = ch.codePointAt(0) ?? 0;
  const base = code & ~0x7f;
  return BRAHMIC_BLOCKS.includes(base) ? base : null;
};
const isConsonant = (o: number) => (o >= 0x15 && o <= 0x39) || (o >= 0x58 && o <= 0x5f);
const isIndependentVowel = (o: number) => (o >= 0x05 && o <= 0x14) || o === 0x60 || o === 0x61;
const isVowelSign = (o: number) => (o >= 0x3e && o <= 0x4c) || o === 0x62 || o === 0x63;
const VIRAMA = 0x4d;
const NUKTA = 0x3c;
/** प फ ब भ म, and the same letters in every Brahmic block. */
const isLabial = (o: number) => o >= 0x2a && o <= 0x2e;

const brahmicSyllables = (word: string, base: number): number => {
  const offsets = [...word].map((ch) => (ch.codePointAt(0) ?? 0) - base);
  // 'V' a syllable with its own vowel, 'A' a consonant with the inherent "a",
  // 'C' a joined cluster with it, whose "a" is said even at a word's end (मित्र, স্বাস্থ্য).
  const units: ('V' | 'A' | 'C')[] = [];
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
export const syllablesIn = (word: string): number => {
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

/** Where in a word the lips close, as fractions of the word. */
export const lipClosuresIn = (word: string): number[] => {
  const chars = [...word];
  const out: number[] = [];
  chars.forEach((ch, i) => {
    const base = blockOf(ch);
    if (base !== null) {
      // फ़ with a nukta is an "f", said with the teeth, not the lips.
      if (isLabial((ch.codePointAt(0) ?? 0) - base) && chars[i + 1]?.codePointAt(0) !== base + NUKTA) out.push(i / chars.length);
    } else if (/[bm]/i.test(ch) || (/p/i.test(ch) && !/h/i.test(chars[i + 1] || ''))) {
      out.push(i / chars.length);
    }
  });
  return out;
};

const trailingPause = (word: string) => (/[,;:—–]$/.test(word) ? COMMA_PAUSE : /[.!?।॥]$/.test(word) ? STOP_PAUSE : WORD_GAP);
const bare = (word: string) => word.replace(/[,;:.!?।॥—–"'“”‘’()]+/g, '');

/** A line timed word by word at `rate` syllables a second. */
export const timeLine = (text: string, rate: number): LineTiming => {
  const parts = text.trim().split(/\s+/).filter((p) => bare(p));
  const words: TimedWord[] = [];
  const lips: number[] = [];
  let t = 0;
  parts.forEach((part, k) => {
    // A hyphenated word (धीरे-धीरे) is said as its parts.
    const syllables = bare(part)
      .split('-')
      .filter(Boolean)
      .reduce((sum, w) => sum + syllablesIn(w), 0);
    const seconds = syllables / rate;
    lipClosuresIn(bare(part)).forEach((f) => lips.push(t + f * seconds));
    words.push({ text: part, start: t, end: t + seconds, syllables });
    t += seconds;
    if (k < parts.length - 1) t += trailingPause(part);
  });
  return { seconds: t, syllables: words.reduce((sum, w) => sum + w.syllables, 0), words, lips };
};

/** Seconds of pauses a text's punctuation asks for, between its words. */
const pausesIn = (text: string) => {
  const parts = text.trim().split(/\s+/).filter((p) => bare(p));
  return parts.slice(0, -1).reduce((sum, part) => sum + trailingPause(part), 0);
};

/**
 * The voice's rate in syllables a second, from its rate in characters: the
 * script's syllables over the seconds those characters take, less the pauses
 * the Expert estimate adds back. So over the whole script the two estimates
 * agree, and only how the time is shared between lines differs.
 */
export const syllableRate = (texts: string[], charsPerSecond: number): number => {
  const lines = texts.map((t) => t.trim()).filter(Boolean);
  const characters = lines.reduce((sum, t) => sum + t.length, 0);
  const syllables = lines.reduce((sum, t) => sum + timeLine(t, 1).syllables, 0);
  if (!characters || !syllables || !(charsPerSecond > 0)) return TYPICAL_SYLLABLES_PER_SECOND;
  const speech = characters / charsPerSecond;
  const pauses = lines.reduce((sum, t) => sum + pausesIn(t), 0);
  const rate = syllables / Math.max(speech * 0.6, speech - pauses);
  return Math.min(MAX_RATE, Math.max(MIN_RATE, rate));
};

/** Where the lips close in the original, from its words' timings. */
export const sourceLipTimes = (words: { text: string; start: number; end: number }[] | undefined): number[] =>
  (words || []).flatMap((w) => lipClosuresIn(bare(w.text)).map((f) => w.start + f * Math.max(0, w.end - w.start)));

/** A dub closure this close to one in the original matches it. */
export const LIP_MATCH_SECONDS = 0.3;

/** How many of the original's closures have one in the dub near them. */
export const matchedLips = (sourceLips: number[], dubLips: number[]) =>
  sourceLips.filter((s) => dubLips.some((d) => Math.abs(d - s) <= LIP_MATCH_SECONDS)).length;
