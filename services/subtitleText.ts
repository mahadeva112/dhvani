/*
 * Subtitle text with its punctuation taken off, for "Keep punctuation" off.
 * Off means none: every Unicode punctuation mark goes, in any script
 * (। ॥ ॰ , ? ! ; : “ ” ‘ ’ … – — ؟ ، ۔ 。 、 ¿ ¡ ...), and the ASCII
 * stand-ins people type for them (| for ।, ~ ^ ` < >).
 *
 * Kept, because they are part of a word or a number rather than punctuation:
 * - an apostrophe inside a word joins it ("don't" -> "dont"), not split it;
 * - a dot, comma or colon between digits (2.5, 10,000, 10:30);
 * - symbols with a meaning of their own: % & @ # + = and currency signs.
 */

/** An apostrophe between letters: dropped, so the word stays one word. */
const INNER_APOSTROPHE = /(?<=[\p{L}\p{M}])['’ʼ`](?=\p{L})/gu;
/** A dot, comma or colon inside a number. */
const NUMBER_MARK = /(?<=\d)[.,:](?=\d)/g;
const NUMBER_HOLD = '\u0000';
const NUMBER_HOLD_RE = /\u0000(\d)/g;
/** Every punctuation mark, kept % & @ # aside, and the ASCII marks typed in their place. */
const PUNCTUATION = /(?![%&@#])[\p{P}|~^`<>¦]/gu;

/** One line without punctuation: marks become spaces, spaces collapse. */
export const stripPunctuation = (text: string): string => {
  const marks: string[] = [];
  return (text || '')
    .replace(INNER_APOSTROPHE, '')
    .replace(NUMBER_MARK, (mark) => {
      marks.push(mark);
      return NUMBER_HOLD;
    })
    .replace(PUNCTUATION, ' ')
    .replace(NUMBER_HOLD_RE, (_, digit) => `${marks.shift() ?? ''}${digit}`)
    .replace(/\s+/g, ' ')
    .trim();
};

/** A subtitle's text without punctuation, its line breaks kept; lines left empty go. */
export const stripSubtitlePunctuation = (text: string): string =>
  (text || '')
    .split(/\r?\n/)
    .map(stripPunctuation)
    .filter(Boolean)
    .join('\n');

/** True when the text still carries a mark that "Keep punctuation" off would take away. */
export const hasPunctuation = (text: string): boolean => stripSubtitlePunctuation(text) !== (text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
