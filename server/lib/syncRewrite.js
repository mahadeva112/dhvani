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
 * Neither kind of suggestion may change what the source line says. A wording
 * that drops a number, a glossary term or a name the line keeps in Latin
 * letters (`missingTerms`) fails in code, without asking any model. Every
 * other wording that passes the length checks then goes to a second, independent
 * call (`checkMeaning`) that compares it against the source line, strictly and
 * at temperature 0. A wording that fails gets one repair: the model is told
 * exactly what changed and tries again, and that wording is checked too. If
 * it still fails, Sync's own suggestions show nothing: a doubtful one is
 * never offered unasked. When the user asked for one line, though, the last
 * wording comes back as `flagged`, with what the check found, so the user
 * gets a wording to judge and edit rather than an empty answer.
 *
 * Asked for one line, Review offers several wordings at once
 * (`suggestLines`), each of a different kind and each checked the same way.
 * Every prompt can carry the lines around the one being reworded, and who
 * says it, so the model reads the line in context before rewording it.
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

/**
 * The lines either side of this one, and who says it, so the model reads the
 * line as part of the conversation: what "he", "this" or "it" points to, a
 * sentence that runs on from the line before, a question being answered.
 * Context only: the model is told not to rewrite those lines or borrow from them.
 */
export const contextNote = (context) => {
  const lines = (list) => (Array.isArray(list) ? list.filter((line) => typeof line === 'string' && line.trim()) : []);
  const before = lines(context?.before);
  const after = lines(context?.after);
  const speaker = typeof context?.speaker === 'string' ? context.speaker.trim() : '';
  if (before.length === 0 && after.length === 0 && !speaker) return '';
  return `\nContext, only to understand the line. Do not rewrite these lines, and do not move anything from them into this one:\n${
    speaker ? `Speaker: ${speaker}\n` : ''
  }${before.map((line) => `Line before: ${line}\n`).join('')}${after.map((line) => `Line after: ${line}\n`).join('')}`;
};

/** Digits of every script, as ASCII, so "১২" in one wording and "12" in another are the same number. */
const asciiDigits = (text) =>
  String(text).replace(/\p{Nd}/gu, (d) => {
    const code = d.codePointAt(0);
    const zero = DIGIT_ZEROS.find((z) => code >= z && code < z + 10);
    return zero === undefined ? d : String(code - zero);
  });

/** The zero of each digit set a dub line may use: Arabic-Indic, then the Indic scripts. */
const DIGIT_ZEROS = [0x30, 0x660, 0x6f0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66, 0xde6];

/** The numbers in a text, as plain digits: "1,000" and "1000" are one number. */
const numbersIn = (text) => (asciiDigits(text).match(/\d[\d,.]*\d|\d/g) || []).map((n) => n.replace(/,/g, ''));

const LATIN_WORD = /[A-Za-z][A-Za-z'’-]*[A-Za-z]/g;

/** A text compared for a term: same Unicode form, case and spacing. */
const normal = (text) => String(text).normalize('NFC').toLowerCase().replace(/\s+/g, ' ');

/**
 * What a new wording of `text` must keep word for word: every number, every
 * term from `keep` (the glossary) that the line uses, and, in a line written in
 * another script, every word left in Latin letters, which is a name or a term
 * the translation kept as it is. These are checked in code, not by the text
 * model, so a wording that drops one is never offered as keeping the meaning.
 */
export const keptTerms = (text, keep = []) => {
  const terms = [];
  const add = (term) => {
    if (term && !terms.some((t) => normal(t) === normal(term))) terms.push(term);
  };
  numbersIn(text).forEach(add);
  const line = normal(text);
  for (const term of Array.isArray(keep) ? keep : []) {
    if (typeof term === 'string' && term.trim() && line.includes(normal(term.trim()))) add(term.trim());
  }
  // Latin words in a line that is also written in another script; a word a glossary term already covers is not named twice.
  if (/[^\P{L}\p{Script=Latin}]/u.test(String(text))) {
    for (const word of String(text).match(LATIN_WORD) || []) {
      if (!terms.some((t) => normal(t).split(/[^\p{L}\p{N}'’-]+/u).includes(normal(word)))) add(word);
    }
  }
  return terms;
};

/** The terms of `keptTerms(text, keep)` that `candidate` leaves out. */
export const missingTerms = (text, candidate, keep = []) => {
  const numbers = new Set(numbersIn(candidate));
  const line = normal(asciiDigits(candidate));
  return keptTerms(text, keep).filter((term) => (/^\d/.test(term) ? !numbers.has(term) : !line.includes(normal(term))));
};

/** The prompt line naming what must stay exactly as it is. */
const keepNote = (text, keep) => {
  const terms = keptTerms(text, keep);
  return terms.length > 0 ? `- Keep these exactly as they are: ${terms.map((t) => `"${t}"`).join(', ')}.\n` : '';
};

/** The check's issues for a wording that dropped a kept term. */
const droppedIssues = (missing) => missing.map((term) => `leaves out "${term}"`);

export const buildRewritePrompt = ({ text, sourceText, language, targetChars, avoid = [], fix = null, context = null, keep = [] }) => `You are adapting a ${language || 'dubbing'} script so it can be dubbed in sync with the original video.

This dub line takes too long to say in the time the original speaker took. Rewrite it so it is at most ${targetChars} characters long (it is now ${text.length}).

Rules:
- The meaning must not change. ${sourceText ? 'The original line is the authority: e' : 'E'}very idea in it must still be there: who does what to whom, every negation, condition, qualifier and emphasis, the tense, and the speaker's intent.
- Drop only filler and repetition first, then use shorter words or phrasing for the same ideas.
- Shorten the dub line as it is written: keep its own word for each idea rather than translating the original again.
- It must sound like natural spoken ${language || 'language'}, as the speaker would say it.
- Keep names, numbers and key terms exactly.
${keepNote(text, keep)}- Do not add anything that is not in the original line.
${sourceText ? `\nOriginal line (for meaning):\n${sourceText}\n` : ''}${contextNote(context)}${
  avoid.length > 0
    ? `\nThese wordings were already offered and not taken. Write a different one:\n${avoid.slice(-MAX_AVOID).map((line) => `- ${line}`).join('\n')}\n`
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

export const buildLengthenPrompt = ({ text, sourceText, language, targetChars, avoid = [], fix = null, context = null, keep = [] }) => `You are adapting a ${language || 'dubbing'} script so it can be dubbed in sync with the original video.

This dub line is much shorter than what the original speaker says, so the dub goes silent while the speaker is still talking. Rewrite it so it is about ${targetChars} characters long (it is now ${text.length}), and no longer than that.

Rules:
- The meaning must not change. Say exactly what the original line says, in a fuller, more natural spoken way. If the dub line left out a nuance, a qualifier or an emphasis that is in the original line, put it back first.
- It must sound like natural spoken ${language || 'language'}, as the speaker would say it.
- Keep names, numbers and key terms exactly.
${keepNote(text, keep)}- Do not add any idea, fact or example that is not in the original line. Do not pad with filler sounds, repetition or empty phrases.
${sourceText ? `\nOriginal line (for meaning):\n${sourceText}\n` : ''}${contextNote(context)}${
  avoid.length > 0
    ? `\nThese wordings were already offered and not taken. Write a different one:\n${avoid.slice(-MAX_AVOID).map((line) => `- ${line}`).join('\n')}\n`
    : ''
}${fixNote(fix)}
Dub line to make fuller:
${text}

Reply with only the rewritten line, nothing else.`;

/**
 * A reworded line that fits its slot keeps about its length: shorter than this
 * share of it is a cut, longer than the other runs toward the slot's end.
 */
const SAME_MIN_SHARE = 0.85;
const SAME_MAX_SHARE = 1.15;

/**
 * The longest a reworded line may be: about its own length, and never more
 * than `targetChars`, what its slot holds.
 */
export const rewordLimit = (text, targetChars) =>
  Math.max(text.trim().length, Math.floor(Math.min(text.trim().length * SAME_MAX_SHARE, Number(targetChars) || Infinity)));

export const buildRewordPrompt = ({ text, sourceText, language, targetChars, avoid = [], fix = null, context = null, keep = [] }) => `You are adapting a ${language || 'dubbing'} script so it can be dubbed in sync with the original video.

This dub line fits its time, but the user wants another way to say it. Reword it so it reads more naturally, in about the same length: at most ${targetChars} characters (it is now ${text.length}).

Rules:
- The meaning must not change. ${sourceText ? 'The original line is the authority: e' : 'E'}very idea in it must still be there, and nothing new: who does what to whom, every negation, condition, qualifier and emphasis, the tense, and the speaker's intent.
- It must sound like natural spoken ${language || 'language'}, as the speaker would say it.
- Keep names, numbers and key terms exactly.
${keepNote(text, keep)}- Change the words or their order, not what is said.
${sourceText ? `\nOriginal line (for meaning):\n${sourceText}\n` : ''}${contextNote(context)}${
  avoid.length > 0
    ? `\nThese wordings were already offered and not taken. Write a different one:\n${avoid.slice(-MAX_AVOID).map((line) => `- ${line}`).join('\n')}\n`
    : ''
}${fixNote(fix)}
Dub line to reword:
${text}

Reply with only the reworded line, nothing else.`;

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

/** The reworded line if it is usable, otherwise null: a new wording of about the same length, within `targetChars`. */
export const acceptReword = (original, rewritten, targetChars = original.length) => {
  const line = cleanLine(rewritten);
  const length = original.trim().length;
  if (!line || line === cleanLine(original)) return null;
  if (line.length < length * SAME_MIN_SHARE || line.length > rewordLimit(original, targetChars)) return null;
  return line;
};

/** How each direction writes and accepts a wording, and what it calls one. */
const DIRECTIONS = {
  shorter: { build: buildRewritePrompt, accept: acceptRewrite, kind: 'shorter' },
  longer: { build: buildLengthenPrompt, accept: acceptLengthen, kind: 'fuller' },
  same: { build: buildRewordPrompt, accept: acceptReword, kind: 'reworded' },
};
const directionOf = (direction) => DIRECTIONS[direction] || DIRECTIONS.shorter;

/**
 * The prompt for the meaning check: a strict reviewer comparing a suggested
 * wording against the source line (or, when there is none, the dub line as it
 * is). `direction` says what the wording was allowed to change: 'shorter' may
 * drop filler and repetition, 'longer' may restore what the source says,
 * 'same' (reworded) may change only the words and their order.
 */
export const buildMeaningCheckPrompt = ({ text, sourceText, candidate, language, direction }) => `You are a strict reviewer checking a ${language || 'dubbing'} dub script against its source. A wording was ${
  direction === 'longer' ? 'made fuller' : direction === 'same' ? 'reworded' : 'shortened'
} so the dub fits the video's timing. Decide whether it still means exactly what the ${sourceText ? 'original line' : 'current dub line'} means.

${sourceText ? `Original line (the authority):\n${sourceText}\n\n` : ''}Current dub line:
${text}

Suggested wording:
${candidate}

It does NOT keep the meaning if, compared with the ${sourceText ? 'original line' : 'current dub line'}, it:
- leaves out any idea, fact, condition, qualifier or emphasis${direction === 'longer' || direction === 'same' ? '' : ' (dropping only filler words and repetition is fine)'};
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
 * Writes a new wording of a line, `direction` 'shorter', 'longer' or 'same', and only
 * returns it as `line` once the meaning check passed. Returns
 * `{ line, reason, flagged }`: the line, or null with `reason` 'unusable' (no
 * answer passed the length checks) or 'meaning' (every wording changed what
 * the source line says). With 'meaning', `flagged` is the last wording and the
 * check's issues, `{ line, issues }`, for a caller that shows it marked as
 * such; null otherwise. Throws when the text model can't be reached or
 * refuses, so the caller can say why.
 */
export const suggestLine = async (
  { text, sourceText, language, targetChars, avoid = [], direction, context = null, keep = [] },
  { apiKey, generate = generateText } = {}
) => {
  const { build, accept, kind } = directionOf(direction);
  let fix = null;
  let flagged = null;
  let retried = false;
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const { response } = await generate({
      contents: { role: 'user', parts: [{ text: build({ text, sourceText, language, targetChars, avoid, fix, context, keep }) }] },
      // A second try at the same line is asked to differ, and given more room to.
      generationConfig: { temperature: avoid.length > 0 || fix || retried ? 0.7 : 0.3 },
      apiKey,
    });
    const line = accept(text, String(response?.text || ''), targetChars);
    retried = true;
    // An answer of the wrong length gets the same second try as one that changed the meaning.
    if (!line) continue;
    // A dropped name, number or term fails in code, before any model is asked.
    const missing = missingTerms(text, line, keep);
    const check =
      missing.length > 0
        ? { ok: false, issues: droppedIssues(missing) }
        : await checkMeaning({ text, sourceText, candidate: line, language, direction }, { apiKey, generate });
    if (check.ok) return { line, reason: null, flagged: null };
    const issues = check.issues.length > 0 ? check.issues : ['The meaning is not the same as the original line.'];
    logger.info(`A suggested ${kind} dub line changed the meaning (${issues.join('; ')}); ${attempt < MAX_REPAIRS ? 'asking again' : 'it is only offered flagged'}.`);
    flagged = { line, issues };
    fix = flagged;
  }
  if (!flagged) logger.info(`A suggested ${kind} dub line was not usable; none is shown for that line.`);
  return { line: null, reason: flagged ? 'meaning' : 'unusable', flagged };
};

/** Most wordings one line is offered at once. */
export const MAX_OPTIONS = 3;

/**
 * What each of several wordings is asked to be, so they differ in kind and the
 * user has a real choice rather than three near-copies.
 */
const OPTION_STYLES = [
  "Closest: keep the dub line's own words and order, and change as little as you can.",
  'Natural: how a native speaker would actually say it aloud in this moment, in everyday spoken words.',
  'Recast: a different sentence shape or word order from the first two, still natural and spoken.',
];

/** Earlier wordings a request for several shows the model, so new ones read differently. */
const MAX_AVOID_OPTIONS = 6;

/**
 * The prompt for several wordings of one line at once, as JSON. Before the
 * wordings the model writes down what the original line means, in one English
 * sentence, with the lines around it in view: working the meaning out first is
 * what keeps every wording on it. `fixes` are earlier wordings the meaning
 * check rejected, with what it found.
 */
export const buildOptionsPrompt = ({ text, sourceText, language, targetChars, direction, count, avoid = [], fixes = [], context = null, keep = [] }) => {
  const longer = direction === 'longer';
  const same = direction === 'same';
  const lang = language || 'the dub language';
  const styles = OPTION_STYLES.slice(0, count);
  return `You are a dubbing adaptation writer for ${language || 'a dub'}. The dub must stay in sync with the original video.

${
  same
    ? `This dub line fits its time, but the user wants other ways to say it. Write ${count} new wordings of it that read naturally, each about as long as it is: at most ${targetChars} characters (it is now ${text.length}).`
    : longer
    ? `This dub line is much shorter than what the original speaker says, so the dub goes silent while the speaker is still talking. Write ${count} fuller wordings of it, each about ${targetChars} characters long (it is now ${text.length}), and no longer than that.`
    : `This dub line takes too long to say in the time the original speaker took. Write ${count} shorter wordings of it, each at most ${targetChars} characters long (it is now ${text.length}).`
}

First, understand the line. Read the ${sourceText ? 'original line' : 'dub line'}${contextNote(context) ? ' and the context below it' : ''}, and work out exactly what it says: who does what to whom, what any "he", "she", "this" or "it" refers to, every negation, condition, number and emphasis, and the speaker's intent (a question, a request, a joke, a warning). Write that down in one plain English sentence as "meaning".

Then write the wordings. Each one must:
- say exactly what the ${sourceText ? 'original' : 'dub'} line says: no idea, fact or example left out or added${
    same
      ? '. Change the words or their order, not what is said'
      : longer
      ? '. If the dub line left out a nuance, a qualifier or an emphasis that is in the original line, put it back first. No filler sounds, repetition or empty phrases'
      : '. Drop only filler and repetition, then use shorter words or phrasing for the same ideas'
  };
- sound like natural spoken ${lang}, as this speaker would say it, fitting the lines around it;
- keep names, numbers and key terms exactly;
${keepNote(text, keep)}- differ clearly from the others${avoid.length > 0 ? ' and from the wordings listed below' : ''}.

Make them different in kind:
${styles.map((style, i) => `${i + 1}. ${style}`).join('\n')}
${sourceText ? `\nOriginal line (the authority on meaning):\n${sourceText}\n` : ''}${contextNote(context)}${
    avoid.length > 0
      ? `\nThese wordings were already offered and not taken. Do not repeat them:\n${avoid.slice(-MAX_AVOID_OPTIONS).map((line) => `- ${line}`).join('\n')}\n`
      : ''
  }${
    fixes.length > 0
      ? `\nThese earlier wordings changed the meaning, so they were rejected. Do not make the same mistakes:\n${fixes
          .map((fix) => `- ${fix.line}\n  What was wrong: ${fix.issues.slice(0, 3).join('; ')}`)
          .join('\n')}\n`
      : ''
  }
Dub line to ${same ? 'reword' : longer ? 'make fuller' : 'shorten'}:
${text}

Respond with ONLY this JSON:
{"meaning":"<what the original line says, in one English sentence>","options":[${styles.map(() => '"<wording>"').join(',')}]}`;
};

/**
 * Up to `count` new wordings of one line, `direction` 'shorter', 'longer' or 'same',
 * from one call to the text model, each checked against the source line
 * (checkMeaning) on its own. Wordings that failed the check get one more round:
 * the model is told what each changed and asked for the ones still missing.
 * Returns `{ options }`, wordings that passed first, then any that did not,
 * with the check's `issues`, so the user always has something to judge when
 * the model offered anything at all. Throws when the text model can't be reached.
 */
export const suggestLines = async (
  { text, sourceText, language, targetChars, avoid = [], direction, context = null, keep = [], count = MAX_OPTIONS },
  { apiKey, generate = generateText } = {}
) => {
  const { accept, kind } = directionOf(direction);
  const want = Math.max(1, Math.min(MAX_OPTIONS, Math.floor(count) || 1));
  const passed = [];
  const flagged = [];
  const seen = new Set([cleanLine(text), ...avoid.map(cleanLine)]);
  let fixes = [];
  for (let attempt = 0; attempt <= MAX_REPAIRS && passed.length < want; attempt++) {
    const { response } = await generate({
      contents: {
        role: 'user',
        parts: [
          {
            text: buildOptionsPrompt({
              text,
              sourceText,
              language,
              targetChars,
              direction,
              count: want - passed.length,
              avoid: [...avoid, ...passed.map((o) => o.line)],
              fixes,
              context,
              keep,
            }),
          },
        ],
      },
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
      apiKey,
    });
    let parsed = null;
    try {
      parsed = parseJsonResponse(response?.text, 'Line wordings');
    } catch {
      // Unreadable: counts as a round with nothing usable.
    }
    const candidates = [];
    for (const raw of Array.isArray(parsed?.options) ? parsed.options : []) {
      const line = accept(text, String(raw ?? ''), targetChars);
      if (line && !seen.has(line)) {
        seen.add(line);
        candidates.push(line);
      }
    }
    const checks = await Promise.all(
      candidates.map((candidate) => {
        const missing = missingTerms(text, candidate, keep);
        return missing.length > 0
          ? { ok: false, issues: droppedIssues(missing) }
          : checkMeaning({ text, sourceText, candidate, language, direction }, { apiKey, generate });
      })
    );
    fixes = [];
    candidates.forEach((line, i) => {
      if (checks[i].ok) passed.push({ line });
      else {
        const issues = checks[i].issues.length > 0 ? checks[i].issues : ['The meaning is not the same as the original line.'];
        flagged.push({ line, issues });
        fixes.push({ line, issues });
      }
    });
  }
  const options = [...passed, ...flagged].slice(0, want);
  logger.info(
    `Suggested ${options.length} ${kind} wording(s) of a dub line: ${Math.min(passed.length, want)} kept the meaning.`
  );
  return { options };
};

/** A shorter wording of `text`, no longer than `targetChars`, that keeps its meaning. See suggestLine. */
export const shortenLine = (request, options) => suggestLine({ ...request, direction: 'shorter' }, options);

/** A fuller wording of `text`, about `targetChars` long, that keeps its meaning. See suggestLine. */
export const lengthenLine = (request, options) => suggestLine({ ...request, direction: 'longer' }, options);

/** Another wording of `text`, about as long and within `targetChars`, that keeps its meaning. See suggestLine. */
export const rewordLine = (request, options) => suggestLine({ ...request, direction: 'same' }, options);
