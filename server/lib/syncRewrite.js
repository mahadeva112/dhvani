/**
 * Shorter wording for a dub line that runs longer than its source line.
 *
 * A line that is too long can't be made to fit by moving it, and speeding the
 * voice up is not allowed, so the clean fix is fewer words. Dubbing adaptation
 * writers do exactly this: same meaning, said in less time. The text model
 * proposes the shorter line, which Sync only shows as a suggestion — the dub
 * is never rewritten by itself. `acceptRewrite` rejects anything that is not
 * actually shorter or that looks like the line was cut off.
 */
import { logger } from '../logger.js';
import { generateText } from '../providers/textModel.js';

/**
 * A rewrite shorter than this share of the length asked for has probably been
 * cut off rather than reworded. Measured against the target, not the original:
 * a line that must lose three quarters of its length to fit is still a fair
 * suggestion, since the user reads it before using it.
 */
const MIN_TARGET_SHARE = 0.5;

/** Earlier suggestions for a line, shown to the model so a new try reads differently. */
const MAX_AVOID = 3;

export const buildRewritePrompt = ({ text, sourceText, language, targetChars, avoid = [] }) => `You are adapting a ${language || 'dubbing'} script so it can be dubbed in sync with the original video.

This dub line takes too long to say in the time the original speaker took. Rewrite it so it is at most ${targetChars} characters long (it is now ${text.length}).

Rules:
- Keep the full meaning and the speaker's intent. Drop filler and repetition first, then use shorter words or phrasing.
- It must sound like natural spoken ${language || 'language'}, as the speaker would say it.
- Keep names, numbers and key terms exactly.
- Do not add anything that is not in the line.
${sourceText ? `\nOriginal line (for meaning):\n${sourceText}\n` : ''}${
  avoid.length > 0
    ? `\nThese wordings were already offered and not taken. Write a different one:\n${avoid.slice(0, MAX_AVOID).map((line) => `- ${line}`).join('\n')}\n`
    : ''
}
Dub line to shorten:
${text}

Reply with only the rewritten line, nothing else.`;

/** The rewritten line if it is usable, otherwise null. `targetChars` is the length asked for. */
export const acceptRewrite = (original, rewritten, targetChars = original.length) => {
  const line = String(rewritten || '')
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line || line.length >= original.length) return null;
  if (line.length < Math.min(original.length, targetChars) * MIN_TARGET_SHARE) return null;
  return line;
};

/**
 * Asks the configured text model for a version of `text` no longer than
 * `targetChars`. Returns the new line, or null when the model's answer is
 * unusable. Throws when the model can't be reached or refuses, so the caller
 * can tell the user why there is no suggestion.
 */
export const shortenLine = async ({ text, sourceText, language, targetChars, avoid = [] }, { apiKey } = {}) => {
  const { response } = await generateText({
    contents: { role: 'user', parts: [{ text: buildRewritePrompt({ text, sourceText, language, targetChars, avoid }) }] },
    // A second try at the same line is asked to differ, and given more room to.
    generationConfig: { temperature: avoid.length > 0 ? 0.7 : 0.3 },
    apiKey,
  });
  const line = acceptRewrite(text, String(response?.text || ''), targetChars);
  if (!line) logger.info('A suggested shorter dub line was not usable; none is shown for that line.');
  return line;
};
