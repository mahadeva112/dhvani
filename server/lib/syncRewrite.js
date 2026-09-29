/**
 * Shorter wording for a dub line that runs longer than its source line.
 *
 * A line that is too long can't be made to fit by moving it, and speeding the
 * voice up is not allowed, so the only clean fix is fewer words. Dubbing
 * adaptation writers do exactly this: same meaning, said in less time. The
 * text model proposes the shorter line; `acceptRewrite` rejects anything that
 * is not actually shorter or that looks like the line was cut off.
 */
import { logger } from '../logger.js';
import { generateText } from '../providers/textModel.js';

/** A rewrite shorter than this share of the original has probably dropped meaning. */
const MIN_KEPT_SHARE = 0.4;

export const buildRewritePrompt = ({ text, sourceText, language, targetChars }) => `You are adapting a ${language || 'dubbing'} script so it can be dubbed in sync with the original video.

This dub line takes too long to say in the time the original speaker took. Rewrite it so it is at most ${targetChars} characters long (it is now ${text.length}).

Rules:
- Keep the full meaning and the speaker's intent. Drop filler and repetition first, then use shorter words or phrasing.
- It must sound like natural spoken ${language || 'language'}, as the speaker would say it.
- Keep names, numbers and key terms exactly.
- Do not add anything that is not in the line.
${sourceText ? `\nOriginal line (for meaning):\n${sourceText}\n` : ''}
Dub line to shorten:
${text}

Reply with only the rewritten line, nothing else.`;

/** The rewritten line if it is usable, otherwise null. */
export const acceptRewrite = (original, rewritten) => {
  const line = String(rewritten || '')
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line || line.length >= original.length) return null;
  if (line.length < original.length * MIN_KEPT_SHARE) return null;
  return line;
};

/**
 * Asks the configured text model for a version of `text` no longer than
 * `targetChars`. Returns the new line, or null when the model is unavailable
 * or its answer is unusable.
 */
export const shortenLine = async ({ text, sourceText, language, targetChars }, { apiKey } = {}) => {
  try {
    const { response } = await generateText({
      contents: { role: 'user', parts: [{ text: buildRewritePrompt({ text, sourceText, language, targetChars }) }] },
      generationConfig: { temperature: 0.3 },
      apiKey,
    });
    const line = acceptRewrite(text, String(response?.text || ''));
    if (!line) logger.info('A shortened dub line was not usable; the line is kept as written.');
    return line;
  } catch (err) {
    logger.warn(`Could not shorten a dub line (${err.message}); it is kept as written.`);
    return null;
  }
};
