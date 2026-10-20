/**
 * Pauses written into a dub line as `[pause 0.4s]`: what a retake suggestion
 * puts where the meaning wants a breath, and what the user sees and edits.
 * The script and the subtitles never carry them (stripPauses); only the voice
 * hears them, in the form its engine performs (see cleanTextForNaturalSpeech).
 */

/** One pause mark. Global: use with replace or matchAll, never test or exec. */
export const PAUSE_MARK = /\[pause\s+(\d+(?:\.\d+)?)\s*s\]/gi;

export const MIN_PAUSE_SECONDS = 0.1;
export const MAX_PAUSE_SECONDS = 2;

const clampPause = (seconds) => Math.min(MAX_PAUSE_SECONDS, Math.max(MIN_PAUSE_SECONDS, Math.round(Number(seconds) * 10) / 10));

/** The line as it is said, without its pause marks: what the script keeps. */
export const stripPauses = (text) =>
  String(text || '')
    .replace(PAUSE_MARK, ' ')
    .replace(/\s+([,.!?;:…])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** Seconds of pause marked in a line, each as clampPause reads it. */
export const pauseSeconds = (text) =>
  Math.round([...String(text || '').matchAll(PAUSE_MARK)].reduce((sum, m) => sum + clampPause(m[1]), 0) * 10) / 10;

/**
 * The line with its pause marks tidied: one decimal, within the limits, one
 * space either side, and none at the start or end, where a pause is only silence.
 */
export const normalizePauses = (text) =>
  String(text || '')
    .replace(PAUSE_MARK, (_mark, seconds) => ` [pause ${clampPause(seconds).toFixed(1)}s] `)
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^(\[pause [\d.]+s\]\s*)+/, '')
    .replace(/(\s*\[pause [\d.]+s\])+$/, '')
    .trim();

/** The pause a typed ellipsis stands for. */
export const DOTS_PAUSE_SECONDS = 0.4;

/**
 * The line with each ellipsis typed between words (`...` or `…`) written as a
 * pause mark, so it is timed and kept out of the script like one. An ellipsis
 * at the start or the end is left as it is: there it is not a pause.
 */
export const dotsToPauses = (text) =>
  String(text || '').replace(/(?<=[^\s.…])\s*(?:\.{2,}|…+)\s*(?=[^\s.…])/g, ` [pause ${DOTS_PAUSE_SECONDS.toFixed(1)}s] `);

/**
 * A pause as an engine performs it: an SSML break for ElevenLabs models that
 * take one and for Cartesia, an ellipsis for Eleven v3 and v4, which read SSML
 * aloud, and nothing at all when `style` is null.
 */
export const spokenPause = (seconds, style) => {
  const s = clampPause(seconds);
  if (style === 'break') return ` <break time="${s.toFixed(1)}s" /> `;
  if (style === 'cartesia') return ` <break time="${Math.round(s * 1000)}ms"/> `;
  if (style === 'ellipsis') return '… ';
  return ' ';
};
