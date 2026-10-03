/**
 * Shorter wording for a dub line that runs longer than its source line, and
 * fuller wording for one that ends well before the original speaker stops.
 *
 * A line that is too long can't be made to fit by moving it, and speeding the
 * voice up is not allowed, so the clean fix is fewer words. Dubbing adaptation
 * writers do exactly this: same meaning, said in less time. The text model
 * proposes the shorter line, which Sync only shows as a suggestion — the dub
 * is never rewritten by itself. `acceptRewrite` rejects anything that is not
 * actually shorter or that looks like the line was cut off.
 *
 * The opposite case is a line so short that the dub falls silent while the
 * speaker on screen is still talking. Adaptation writers fix that the same
 * way, from the other side: the fuller phrasing a speaker would naturally use,
 * and any nuance of the original that the translation dropped. Never padding,
 * never new content. `acceptLengthen` rejects anything not actually longer or
 * so long it would run past the line's slot.
 *
 * Neither kind of suggestion may change what the source line says. Every
 * wording that passes the length checks then goes to a second, independent
 * call (`checkMeaning`) that compares it against the source line, strictly and
 * at temperature 0. A wording that fails gets one repair: the model is told
 * exactly what changed and tries again, and that wording is checked too. If
 * it still fails, Sync's own suggestions show nothing: a doubtful one is
 * never offered unasked. When the user asked for one line, though, the last
 * wording comes back as `flagged`, with what the check found, so the user
 * gets a wording to judge and edit rather than an empty answer.
 */
import { logger } from '../logger.js';
import { generateText } from '../providers/textModel.js';
import { parseJsonResponse } from '../providers/gemini/client.js';

/**
 * A rewrite shorter than this share of the length asked for has probably been
 * cut off rather than reworded. Measured against the target, not the original:
 * a line that must lose three quarters of its length to fit is still a fair
 * suggestion, since the user reads it before using it.
 */
const MIN_TARGET_SHARE = 0.5;

/** Earlier suggestions for a line, shown to the model so a new try reads differently. */
const MAX_AVOID = 3;

/** What a repair try is told: the wording that changed the meaning, and how it did. */
const fixNote = (fix) =>
  fix
    ? `\nYour earlier wording changed the meaning, so it was rejected:\n${fix.line}\nWhat was wrong:\n${fix.issues
        .slice(0, 5)
        .map((issue) => `- ${issue}`)
        .join('\n')}\nWrite a new wording that fixes this and says exactly what the original line says.\n`
    : '';

export const buildRewritePrompt = ({ text, sourceText, language, targetChars, avoid = [], fix = null }) => `You are adapting a ${language || 'dubbing'} script so it can be dubbed in sync with the original video.

This dub line takes too long to say in the time the original speaker took. Rewrite it so it is at most ${targetChars} characters long (it is now ${text.length}).

Rules:
- The meaning must not change. ${sourceText ? 'The original line is the authority: e' : 'E'}very idea in it must still be there: who does what to whom, every negation, condition, qualifier and emphasis, the tense, and the speaker's intent.
- Drop only filler and repetition first, then use shorter words or phrasing for the same ideas.
- Shorten the dub line as it is written: keep its own word for each idea rather than translating the original again.
- It must sound like natural spoken ${language || 'language'}, as the speaker would say it.
- Keep names, numbers and key terms exactly.
- Do not add anything that is not in the original line.
${sourceText ? `\nOriginal line (for meaning):\n${sourceText}\n` : ''}${
  avoid.length > 0
    ? `\nThese wordings were already offered and not taken. Write a different one:\n${avoid.slice(0, MAX_AVOID).map((line) => `- ${line}`).join('\n')}\n`
    : ''
}${fixNote(fix)}
Dub line to shorten:
${text}

Reply with only the rewritten line, nothing else.`;

/**
 * A fuller wording longer than this share of the length asked for has run past
 * what the line's slot holds; the user would only have to shorten it again.
 */
const MAX_TARGET_SHARE = 1.25;

export const buildLengthenPrompt = ({ text, sourceText, language, targetChars, avoid = [], fix = null }) => `You are adapting a ${language || 'dubbing'} script so it can be dubbed in sync with the original video.

This dub line is much shorter than what the original speaker says, so the dub goes silent while the speaker is still talking. Rewrite it so it is about ${targetChars} characters long (it is now ${text.length}), and no longer than that.

Rules:
- The meaning must not change. Say exactly what the original line says, in a fuller, more natural spoken way. If the dub line left out a nuance, a qualifier or an emphasis that is in the original line, put it back first.
- It must sound like natural spoken ${language || 'language'}, as the speaker would say it.
- Keep names, numbers and key terms exactly.
- Do not add any idea, fact or example that is not in the original line. Do not pad with filler sounds, repetition or empty phrases.
${sourceText ? `\nOriginal line (for meaning):\n${sourceText}\n` : ''}${
  avoid.length > 0
    ? `\nThese wordings were already offered and not taken. Write a different one:\n${avoid.slice(0, MAX_AVOID).map((line) => `- ${line}`).join('\n')}\n`
    : ''
}${fixNote(fix)}
Dub line to make fuller:
${text}

Reply with only the rewritten line, nothing else.`;

/** A model's answer as one plain line: no wrapping quotes, no line breaks. */
const cleanLine = (rewritten) =>
  String(rewritten || '')
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The rewritten line if it is usable, otherwise null. `targetChars` is the length asked for. */
export const acceptRewrite = (original, rewritten, targetChars = original.length) => {
  const line = cleanLine(rewritten);
  if (!line || line.length >= original.length) return null;
  if (line.length < Math.min(original.length, targetChars) * MIN_TARGET_SHARE) return null;
  return line;
};

/** The fuller line if it is usable, otherwise null. `targetChars` is the length asked for. */
export const acceptLengthen = (original, rewritten, targetChars = original.length) => {
  const line = cleanLine(rewritten);
  if (!line || line.length <= original.trim().length) return null;
  if (line.length > Math.max(original.length, targetChars) * MAX_TARGET_SHARE) return null;
  return line;
};

/**
 * The prompt for the meaning check: a strict reviewer comparing a suggested
 * wording against the source line (or, when there is none, the dub line as it
 * is). `direction` says what the wording was allowed to change: 'shorter' may
 * drop filler and repetition, 'longer' may restore what the source says.
 */
export const buildMeaningCheckPrompt = ({ text, sourceText, candidate, language, direction }) => `You are a strict reviewer checking a ${language || 'dubbing'} dub script against its source. A wording was ${
  direction === 'longer' ? 'made fuller' : 'shortened'
} so the dub fits the video's timing. Decide whether it still means exactly what the ${sourceText ? 'original line' : 'current dub line'} means.

${sourceText ? `Original line (the authority):\n${sourceText}\n\n` : ''}Current dub line:
${text}

Suggested wording:
${candidate}

It does NOT keep the meaning if, compared with the ${sourceText ? 'original line' : 'current dub line'}, it:
- leaves out any idea, fact, condition, qualifier or emphasis${direction === 'longer' ? '' : ' (dropping only filler words and repetition is fine)'};
- adds any idea, fact, example or opinion that is not there${direction === 'longer' ? ' (saying what is there more fully is fine)' : ''};
- changes who does what to whom, a negation, the tense, a number, a name or a key term;
- changes the tone or intent, such as a question into a statement, or a request into an order.
${
  sourceText
    ? `
Judge only what the suggested wording changes. The current dub line is the accepted translation: a word or phrasing it already uses for an idea in the original line (a near-synonym, an idiom) is not a change, even where it differs from the original line, so keeping it is fine.
`
    : ''
}
Grammar that ${language || 'the dub language'} naturally uses for the same meaning is not a change: a past or perfective form inside an "if" clause, a dropped pronoun, a different word order, a punctuation mark or a pause.

If you are not sure, it does not keep the meaning.

Respond with ONLY this JSON:
{"sameMeaning":<true|false>,"issues":["<each change, in a few English words>"]}`;

/** How many repair tries a wording that changed the meaning gets. */
const MAX_REPAIRS = 1;

/**
 * Checks that `candidate` means what the source line means. Returns
 * `{ ok, issues }`. An answer that can't be read counts as a failure: a
 * suggestion is only shown when the check positively passed.
 */
export const checkMeaning = async ({ text, sourceText, candidate, language, direction }, { apiKey, generate = generateText } = {}) => {
  const { response } = await generate({
    contents: { role: 'user', parts: [{ text: buildMeaningCheckPrompt({ text, sourceText, candidate, language, direction }) }] },
    generationConfig: { responseMimeType: 'application/json', temperature: 0 },
    apiKey,
  });
  let parsed;
  try {
    parsed = parseJsonResponse(response?.text, 'Meaning check');
  } catch {
    return { ok: false, issues: ['The meaning check gave no readable answer.'] };
  }
  const issues = Array.isArray(parsed?.issues) ? parsed.issues.filter((i) => typeof i === 'string' && i.trim()).map((i) => i.trim()) : [];
  return { ok: parsed?.sameMeaning === true, issues };
};

/**
 * Writes a new wording of a line, `direction` 'shorter' or 'longer', and only
 * returns it as `line` once the meaning check passed. Returns
 * `{ line, reason, flagged }`: the line, or null with `reason` 'unusable' (no
 * answer passed the length checks) or 'meaning' (every wording changed what
 * the source line says). With 'meaning', `flagged` is the last wording and the
 * check's issues, `{ line, issues }`, for a caller that shows it marked as
 * such; null otherwise. Throws when the text model can't be reached or
 * refuses, so the caller can say why.
 */
export const suggestLine = async (
  { text, sourceText, language, targetChars, avoid = [], direction },
  { apiKey, generate = generateText } = {}
) => {
  const longer = direction === 'longer';
  const build = longer ? buildLengthenPrompt : buildRewritePrompt;
  const accept = longer ? acceptLengthen : acceptRewrite;
  const kind = longer ? 'fuller' : 'shorter';
  let fix = null;
  let flagged = null;
  let retried = false;
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const { response } = await generate({
      contents: { role: 'user', parts: [{ text: build({ text, sourceText, language, targetChars, avoid, fix }) }] },
      // A second try at the same line is asked to differ, and given more room to.
      generationConfig: { temperature: avoid.length > 0 || fix || retried ? 0.7 : 0.3 },
      apiKey,
    });
    const line = accept(text, String(response?.text || ''), targetChars);
    retried = true;
    // An answer of the wrong length gets the same second try as one that changed the meaning.
    if (!line) continue;
    const check = await checkMeaning({ text, sourceText, candidate: line, language, direction }, { apiKey, generate });
    if (check.ok) return { line, reason: null, flagged: null };
    const issues = check.issues.length > 0 ? check.issues : ['The meaning is not the same as the original line.'];
    logger.info(`A suggested ${kind} dub line changed the meaning (${issues.join('; ')}); ${attempt < MAX_REPAIRS ? 'asking again' : 'it is only offered flagged'}.`);
    flagged = { line, issues };
    fix = flagged;
  }
  if (!flagged) logger.info(`A suggested ${kind} dub line was not usable; none is shown for that line.`);
  return { line: null, reason: flagged ? 'meaning' : 'unusable', flagged };
};

/** A shorter wording of `text`, no longer than `targetChars`, that keeps its meaning. See suggestLine. */
export const shortenLine = (request, options) => suggestLine({ ...request, direction: 'shorter' }, options);

/** A fuller wording of `text`, about `targetChars` long, that keeps its meaning. See suggestLine. */
export const lengthenLine = (request, options) => suggestLine({ ...request, direction: 'longer' }, options);
