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
 *
 * A retake asks for its wordings with `pauseBudget`, the seconds its slot has
 * to spare: the model may mark pauses (`[pause 0.4s]`, linePauses.js) where the
 * meaning wants them, within that time. Length and meaning are judged on the
 * words alone, and a wording may keep the line's own words with pauses only.
 */
import { logger } from '../logger.js';
import { generateText } from '../providers/textModel.js';
import { parseJsonResponse } from '../providers/gemini/client.js';
import { normalizePauses, pauseSeconds, PAUSE_MARK, stripPauses } from './linePauses.js';
import { lineSyllables } from './syllables.js';

/**
 * A rewrite shorter than this share of the length asked for has probably been
 * cut off rather than reworded. Measured against the target, not the original:
 * a line that must lose three quarters of its length to fit is still a fair
 * suggestion, since the user reads it before using it.
 */
const MIN_TARGET_SHARE = 0.5;

/**
 * The most of a line a shorter wording may cut. Past a third, a line can only
 * fit by losing what it says: its timing has to change instead (a longer
 * slot, or one line with the line beside it), so no wording is offered unasked.
 */
export const MAX_CUT_SHARE = 0.35;

/**
 * A shorter wording fits when it takes at most this share of the syllables
 * asked for: a count of syllables is close to how long a line takes to say,
 * not exact. Up to LONG_SHARE it is still offered, marked as running a little
 * long, so the user has a wording to trim by a word; past that it does not fit.
 */
const FIT_SHARE = 1.1;
const LONG_SHARE = 1.15;

/**
 * The syllables a shorter wording of `original` may take: the share of its
 * syllables that `targetChars` is of its characters. The target is worked
 * out in characters (Sync measures seconds per character of the voiced line);
 * judging the wording in syllables keeps a line of joined letters (प्र, क्ष्म)
 * from passing as short while it takes as long to say.
 */
export const targetSyllables = (original, targetChars) => {
  const chars = String(original).trim().length;
  return chars > 0 ? lineSyllables(original) * Math.min(1, Number(targetChars) / chars) : 0;
};

/**
 * How a shorter wording's length compares with what was asked: `syllables`
 * it takes, `target` (rounded), `fits` within FIT_SHARE, `usable` within
 * LONG_SHARE, and `over`, the syllables still to cut when it does not fit.
 * A line with no syllables to count (no letters) is judged in characters.
 */
export const shorterFit = (original, line, targetChars) => {
  const target = targetSyllables(original, targetChars);
  if (!(target > 0)) {
    const fits = line.length <= targetChars * FIT_SHARE;
    return { syllables: 0, target: 0, fits, usable: line.length <= targetChars * LONG_SHARE, over: 0 };
  }
  const syllables = lineSyllables(line);
  const fits = syllables <= target * FIT_SHARE;
  return { syllables, target: Math.round(target), fits, usable: syllables <= target * LONG_SHARE, over: fits ? 0 : Math.max(1, Math.ceil(syllables - target)) };
};

/** True when fitting `text` into `targetChars` would cut more of it than MAX_CUT_SHARE. */
export const tooDeepCut = (text, targetChars) =>
  Number.isFinite(Number(targetChars)) && Number(targetChars) < String(text).trim().length * (1 - MAX_CUT_SHARE);

/**
 * Earlier suggestions for a line, shown to the model so a new try reads
 * differently. Every earlier one is still kept out in code, however many.
 */
const MAX_AVOID = 12;

/** What a repair try is told: the wording that changed the meaning, and how it did. */
const fixNote = (fix) =>
  fix
    ? `\nYour earlier wording changed the meaning, so it was rejected:\n${fix.line}\nWhat was wrong:\n${fix.issues
        .slice(0, 5)
        .map((issue) => `- ${issue}`)
        .join('\n')}\nWrite a new wording that fixes this and says exactly what the original line says.\n`
    : '';

/**
 * What a try after a wording of the wrong length is told: that wording, how
 * long it was and how long it had to be, so the model knows how much more to
 * cut (or that it cut too much) rather than guessing again.
 */
export const lengthNote = (miss, targetChars) =>
  miss
    ? `\nYour earlier wording was rejected as too ${miss.long ? 'long' : 'short'}: it was ${miss.chars} characters${
        miss.syllables ? ` (${miss.syllables} syllables)` : ''
      }, and it must be at most ${targetChars} characters${miss.target ? ` (about ${miss.target} syllables)` : ''}.\n${miss.line}\n${
        miss.long
          ? 'Cut more: drop filler and repetition, and use shorter words for the same ideas.'
          : 'It was cut too far: keep every idea of the line, only in fewer words.'
      }\n`
    : '';

/** The length a shorter wording is asked for, in syllables as well as characters, where the line has syllables to count. */
const shorterAsk = (text, targetChars) => {
  const target = Math.round(targetSyllables(text, targetChars));
  return target > 0
    ? `at most ${targetChars} characters, about ${target} syllables (it is now ${text.length} characters, ${lineSyllables(text)} syllables)`
    : `at most ${targetChars} characters (it is now ${text.length})`;
};

/** A wording of the wrong length, as lengthNote reads it. */
const missOf = (text, line, targetChars) => {
  const fit = shorterFit(text, line, targetChars);
  return { line, chars: line.length, syllables: fit.syllables, target: fit.target, long: !fit.fits };
};

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

/**
 * How this user reworded other lines in the project, as a guide to the style
 * they want (plainer or more formal, shorter words, word order), never to what
 * a line says: those are other lines, about other things.
 */
export const examplesNote = (examples) => {
  const pairs = Array.isArray(examples) ? examples.filter((e) => typeof e?.from === 'string' && typeof e?.to === 'string') : [];
  if (pairs.length === 0) return '';
  return `\nHow this user reworded other lines of this script before. Follow the style of their choices (how plain or formal, which kind of words, the word order); never take words, ideas or facts from them, since they are about other lines:\n${pairs
    .map((e) => `- "${e.from}" became "${e.to}"`)
    .join('\n')}\n`;
};

/** The prompt line naming what must stay exactly as it is. */
const keepNote = (text, keep) => {
  const terms = keptTerms(text, keep);
  return terms.length > 0 ? `- Keep these exactly as they are: ${terms.map((t) => `"${t}"`).join(', ')}.\n` : '';
};

/** The check's issues for a wording that dropped a kept term. */
const droppedIssues = (missing) => missing.map((term) => `leaves out "${term}"`);

export const buildRewritePrompt = ({ text, sourceText, language, targetChars, avoid = [], fix = null, miss = null, context = null, keep = [], examples = [] }) => `You are adapting a ${language || 'dubbing'} script so it can be dubbed in sync with the original video.

This dub line takes too long to say in the time the original speaker took. Rewrite it so it is ${shorterAsk(text, targetChars)}.

Rules:
- The meaning must not change. ${sourceText ? 'The original line is the authority: e' : 'E'}very idea in it must still be there: who does what to whom, every negation, condition, qualifier and emphasis, the tense, and the speaker's intent.
- Drop only filler and repetition first, then use shorter words or phrasing for the same ideas.
- Shorten the dub line as it is written: keep its own word for each idea rather than translating the original again.
- It must sound like natural spoken ${language || 'language'}, as the speaker would say it.
- Keep names, numbers and key terms exactly.
${keepNote(text, keep)}- Do not add anything that is not in the original line.
${sourceText ? `\nOriginal line (for meaning):\n${sourceText}\n` : ''}${contextNote(context)}${examplesNote(examples)}${
  avoid.length > 0
    ? `\nThese wordings were already offered and not taken. Write a different one:\n${avoid.slice(-MAX_AVOID).map((line) => `- ${line}`).join('\n')}\n`
    : ''
}${fixNote(fix)}${lengthNote(miss, targetChars)}
Dub line to shorten:
${text}

Reply with only the rewritten line, nothing else.`;

/**
 * A fuller wording longer than this share of the length asked for has run past
 * what the line's slot holds; the user would only have to shorten it again.
 */
const MAX_TARGET_SHARE = 1.25;

export const buildLengthenPrompt = ({ text, sourceText, language, targetChars, avoid = [], fix = null, context = null, keep = [], examples = [] }) => `You are adapting a ${language || 'dubbing'} script so it can be dubbed in sync with the original video.

This dub line is much shorter than what the original speaker says, so the dub goes silent while the speaker is still talking. Rewrite it so it is about ${targetChars} characters long (it is now ${text.length}), and no longer than that.

Rules:
- The meaning must not change. Say exactly what the original line says, in a fuller, more natural spoken way. If the dub line left out a nuance, a qualifier or an emphasis that is in the original line, put it back first.
- It must sound like natural spoken ${language || 'language'}, as the speaker would say it.
- Keep names, numbers and key terms exactly.
${keepNote(text, keep)}- Do not add any idea, fact or example that is not in the original line. Do not pad with filler sounds, repetition or empty phrases.
${sourceText ? `\nOriginal line (for meaning):\n${sourceText}\n` : ''}${contextNote(context)}${examplesNote(examples)}${
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

export const buildRewordPrompt = ({ text, sourceText, language, targetChars, avoid = [], fix = null, context = null, keep = [], examples = [] }) => `You are adapting a ${language || 'dubbing'} script so it can be dubbed in sync with the original video.

This dub line fits its time, but the user wants another way to say it. Reword it so it reads more naturally, in about the same length: at most ${targetChars} characters (it is now ${text.length}).

Rules:
- The meaning must not change. ${sourceText ? 'The original line is the authority: e' : 'E'}very idea in it must still be there, and nothing new: who does what to whom, every negation, condition, qualifier and emphasis, the tense, and the speaker's intent.
- It must sound like natural spoken ${language || 'language'}, as the speaker would say it.
- Keep names, numbers and key terms exactly.
${keepNote(text, keep)}- Change the words or their order, not what is said.
${sourceText ? `\nOriginal line (for meaning):\n${sourceText}\n` : ''}${contextNote(context)}${examplesNote(examples)}${
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

/**
 * The rewritten line if it is usable, otherwise null. `targetChars` is the
 * length asked for: a wording well past it (shorterFit) is no fix, however
 * much shorter than the line it is.
 */
export const acceptRewrite = (original, rewritten, targetChars = original.length) => {
  const line = cleanLine(rewritten);
  if (!line || line.length >= original.length) return null;
  if (line.length < Math.min(original.length, targetChars) * MIN_TARGET_SHARE) return null;
  if (!shorterFit(original, line, targetChars).usable) return null;
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
 * 'same' (reworded) may change only the words and their order. With a source
 * line, the same call first puts the wording into English literally, on its
 * own, before reading the original, and then sets that English against it:
 * one call where a separate back-translation used to be a second, in series.
 */
export const buildMeaningCheckPrompt = ({ text, sourceText, candidate, language, direction }) => `You are a strict reviewer checking a ${language || 'dubbing'} dub script against its source. A wording was ${
  direction === 'longer' ? 'made fuller' : direction === 'same' ? 'reworded' : 'shortened'
} so the dub fits the video's timing. Decide whether it still means exactly what the ${sourceText ? 'original line' : 'current dub line'} means.

Suggested wording:
${candidate}
${
  sourceText
    ? `
First, translate the suggested wording into English literally, on its own, as if you had never seen the lines below: what it says, word for word in meaning, keeping every negation, condition, number, name and emphasis, and its tone (a question stays a question). Do not improve it or fix it. Write that as "backTranslation".

Then set that English against the original line: it shows what the suggested wording actually says.

Original line (the authority):
${sourceText}
`
    : ''
}
Current dub line:
${text}

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
{${sourceText ? '"backTranslation":"<the literal English of the suggested wording>",' : ''}"sameMeaning":<true|false>,"issues":["<each change, in a few English words>"]}`;

/** How many repair tries a wording that changed the meaning gets. */
const MAX_REPAIRS = 1;

/**
 * Checks that `candidate` means what the source line means, in one call to the
 * text model. With a source line, the answer also carries the wording's
 * literal English (buildMeaningCheckPrompt). Returns `{ ok, issues,
 * backTranslation }`, `backTranslation` the English or null, for the user to
 * read beside the wording. An answer that can't be read counts as a failure:
 * a suggestion is only shown when the check positively passed.
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
    return { ok: false, issues: ['The meaning check gave no readable answer.'], backTranslation: null };
  }
  const issues = Array.isArray(parsed?.issues) ? parsed.issues.filter((i) => typeof i === 'string' && i.trim()).map((i) => i.trim()) : [];
  const backTranslation = (sourceText && typeof parsed?.backTranslation === 'string' && cleanLine(parsed.backTranslation)) || null;
  return { ok: parsed?.sameMeaning === true, issues, backTranslation };
};

/**
 * Writes a new wording of a line, `direction` 'shorter', 'longer' or 'same', and only
 * returns it as `line` once the meaning check passed. Returns
 * `{ line, reason, flagged, backTranslation }`: the line (and its English), or null with `reason` 'unusable' (no
 * answer passed the length checks) or 'meaning' (every wording changed what
 * the source line says). With 'meaning', `flagged` is the last wording and the
 * check's issues, `{ line, issues, backTranslation }`, for a caller that shows it marked as
 * such; null otherwise. A shorter wording that still runs a little past its
 * target (shorterFit) comes back only when no try fit, with `over`, the
 * syllables still to cut. Throws when the text model can't be reached or
 * refuses, so the caller can say why.
 */
export const suggestLine = async (
  { text, sourceText, language, targetChars, avoid = [], direction, context = null, keep = [], examples = [] },
  { apiKey, generate = generateText } = {}
) => {
  const { build, accept, kind } = directionOf(direction);
  const shorter = kind === 'shorter';
  let fix = null;
  let miss = null;
  let flagged = null;
  let retried = false;
  // A shorter wording that runs a little past its target: offered, marked, only if no try fits.
  let nearly = null;
  const isNew = (line) => !avoid.some((earlier) => cleanLine(earlier) === line);
  /** The meaning check, after the terms a wording must keep are checked in code. */
  const check = async (line) => {
    // A dropped name, number or term fails in code, before any model is asked.
    const missing = missingTerms(text, line, keep);
    return missing.length > 0
      ? { ok: false, issues: droppedIssues(missing) }
      : await checkMeaning({ text, sourceText, candidate: line, language, direction }, { apiKey, generate });
  };
  const issuesOf = (result) => (result.issues.length > 0 ? result.issues : ['The meaning is not the same as the original line.']);
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const { response } = await generate({
      contents: { role: 'user', parts: [{ text: build({ text, sourceText, language, targetChars, avoid, fix, miss, context, keep, examples }) }] },
      // A second try at the same line is asked to differ, and given more room to.
      generationConfig: { temperature: avoid.length > 0 || fix || retried ? 0.7 : 0.3 },
      apiKey,
    });
    const raw = cleanLine(response?.text);
    const answer = accept(text, raw, targetChars);
    // A wording already offered is no new one, however many were.
    const line = answer && isNew(answer) ? answer : null;
    retried = true;
    // An answer of the wrong length, or one offered before, gets the same second try as one that changed the meaning;
    // a wrong length is told how far off it was.
    if (!line) {
      if (shorter && raw && isNew(raw)) miss = missOf(text, raw, targetChars);
      continue;
    }
    if (shorter) {
      const fit = shorterFit(text, line, targetChars);
      if (!fit.fits) {
        miss = missOf(text, line, targetChars);
        if (!nearly || fit.over < nearly.over) nearly = { line, over: fit.over };
        continue;
      }
    }
    const result = await check(line);
    const backTranslation = result.backTranslation ?? null;
    if (result.ok) return { line, reason: null, flagged: null, backTranslation };
    const issues = issuesOf(result);
    logger.info(`A suggested ${kind} dub line changed the meaning (${issues.join('; ')}); ${attempt < MAX_REPAIRS ? 'asking again' : 'it is only offered flagged'}.`);
    flagged = { line, issues, backTranslation };
    fix = flagged;
  }
  // No try fit: the closest one that runs only a little long, marked with the syllables still to cut.
  if (nearly) {
    const result = await check(nearly.line);
    const backTranslation = result.backTranslation ?? null;
    if (result.ok) {
      logger.info(`A suggested shorter dub line still runs about ${nearly.over} syllable(s) long; it is offered marked as such.`);
      return { line: nearly.line, reason: null, flagged: null, backTranslation, over: nearly.over };
    }
    flagged ??= { line: nearly.line, issues: issuesOf(result), backTranslation, over: nearly.over };
  }
  if (!flagged) logger.info(`A suggested ${kind} dub line was not usable; none is shown for that line.`);
  return { line: null, reason: flagged ? 'meaning' : 'unusable', flagged };
};

/** Most wordings one line is offered at once. */
export const MAX_OPTIONS = 2;

/**
 * What each of several wordings is asked to be, so they differ in kind and the
 * user has a real choice rather than near-copies. Only the first MAX_OPTIONS are
 * asked for; Recast stays for a caller that wants a third kind.
 */
const OPTION_STYLES = [
  "Closest: keep the dub line's own words and order, and change as little as you can.",
  'Natural: how a native speaker would actually say it aloud in this moment, in everyday spoken words.',
  'Recast: a different sentence shape or word order from the first two, still natural and spoken.',
];

/** Earlier wordings a request for several shows the model, so new ones read differently. */
const MAX_AVOID_OPTIONS = 12;

/** Below this, a slot has no time for a pause. */
const MIN_PAUSE_BUDGET = 0.15;

/** What a retake's prompt says about pauses, for the seconds its slot has to spare. */
export const pauseNote = (budget) =>
  budget < MIN_PAUSE_BUDGET
    ? '\nDo not add pauses: this line has no time to spare.\n'
    : `
Pauses: read at its natural pace, this line leaves about ${budget.toFixed(1)} s of its time unspoken. Understand what the line means, then mark a pause where a native speaker saying it would pause: between two thoughts, before the word that carries the weight, after a question or a name addressed. Write a pause as [pause 0.3s] (seconds, 0.1 to 2), between words, never at the start or the end. All the pauses in one wording together come to at most ${budget.toFixed(1)} s. Add no pause the meaning does not call for. One wording may keep the dub line's own words exactly, with pauses only.
`;

/**
 * The prompt for several wordings of one line at once, as JSON. Before the
 * wordings the model writes down what the original line means, in one English
 * sentence, with the lines around it in view: working the meaning out first is
 * what keeps every wording on it. `fixes` are earlier wordings the meaning
 * check rejected, with what it found; `misses` earlier shorter wordings
 * rejected as too long, each with how long it was (missOf).
 */
export const buildOptionsPrompt = ({ text, sourceText, language, targetChars, direction, count, avoid = [], fixes = [], misses = [], context = null, keep = [], examples = [], pauseBudget = null }) => {
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
    : `This dub line takes too long to say in the time the original speaker took. Write ${count} shorter wordings of it, each ${shorterAsk(text, targetChars)}.`
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
${sourceText ? `\nOriginal line (the authority on meaning):\n${sourceText}\n` : ''}${contextNote(context)}${examplesNote(examples)}${
    avoid.length > 0
      ? `\nThese wordings were already offered and not taken. Do not repeat them:\n${avoid.slice(-MAX_AVOID_OPTIONS).map((line) => `- ${line}`).join('\n')}\n`
      : ''
  }${
    fixes.length > 0
      ? `\nThese earlier wordings changed the meaning, so they were rejected. Do not make the same mistakes:\n${fixes
          .map((fix) => `- ${fix.line}\n  What was wrong: ${fix.issues.slice(0, 3).join('; ')}`)
          .join('\n')}\n`
      : ''
  }${
    misses.length > 0
      ? `\nThese earlier wordings were still too long, so they were rejected. Cut more than they did:\n${misses
          .map((miss) => `- ${miss.line}\n  ${miss.chars} characters${miss.syllables ? `, ${miss.syllables} syllables` : ''}`)
          .join('\n')}\n`
      : ''
  }
${pauseBudget === null ? '' : pauseNote(pauseBudget)}
Dub line to ${same ? 'reword' : longer ? 'make fuller' : 'shorten'}:
${text}

Respond with ONLY this JSON:
{"meaning":"<what the original line says, in one English sentence>","options":[${styles.map(() => '"<wording>"').join(',')}]}`;
};

/**
 * A wording's pauses scaled down so together they take at most `budget`
 * seconds, and none at all when it has none to give.
 */
export const fitPauses = (line, budget) => {
  const total = pauseSeconds(line);
  if (total <= budget + 1e-6) return line;
  if (budget < MIN_PAUSE_BUDGET) return stripPauses(line);
  const scale = budget / total;
  return normalizePauses(line.replace(PAUSE_MARK, (_mark, seconds) => `[pause ${Math.max(0.1, Math.floor(Number(seconds) * scale * 10) / 10)}s]`));
};

/**
 * Up to `count` new wordings of one line, `direction` 'shorter', 'longer' or 'same',
 * from one call to the text model, each checked against the source line
 * (checkMeaning) on its own. Wordings that failed the check get one more round:
 * the model is told what each changed and asked for the ones still missing.
 * Returns `{ options }`, wordings that passed first, then any that did not,
 * with the check's `issues`, so the user always has something to judge when
 * the model offered anything at all. A shorter wording that runs a little
 * past its target (shorterFit) carries `over`, the syllables still to cut,
 * and comes after those that fit; while fewer than `count` fit, the next round
 * is told how long the too-long ones were. Throws when the text model can't be reached.
 */
export const suggestLines = async (
  { text: asked, sourceText, language, targetChars, avoid = [], direction, context = null, keep = [], examples = [], count = MAX_OPTIONS, pauseBudget = null },
  { apiKey, generate = generateText } = {}
) => {
  const { accept, kind } = directionOf(direction);
  const shorter = kind === 'shorter';
  const pauses = pauseBudget !== null;
  // Length and meaning are judged on the words: a draft's own pause marks are not words.
  const text = pauses ? stripPauses(asked) : asked;
  /** Syllables a shorter wording still runs past its target: 0 when it fits, and for any other direction. */
  const overOf = (words) => (shorter ? shorterFit(text, words, targetChars).over : 0);
  /** A wording as offered (with its pauses), its words alone and `over`, or null when unusable. */
  const usable = (raw) => {
    if (!pauses) {
      const line = accept(text, raw, targetChars);
      return line ? { offered: line, words: line, over: overOf(line) } : null;
    }
    const offered = fitPauses(normalizePauses(cleanLine(raw)), pauseBudget);
    const words = stripPauses(offered);
    // The line's own words with pauses added is a wording a retake can use.
    if (words === cleanLine(text)) return pauseSeconds(offered) > 0 ? { offered, words, same: true, over: 0 } : null;
    return accept(text, words, targetChars) === words ? { offered, words, over: overOf(words) } : null;
  };
  /** The words of a model's wording, for a wording too long to use. */
  const wordsOf = (raw) => (pauses ? stripPauses(normalizePauses(cleanLine(raw))) : cleanLine(raw));
  const want = Math.max(1, Math.min(MAX_OPTIONS, Math.floor(count) || 1));
  const passed = [];
  const flagged = [];
  const seen = new Set([cleanLine(text), ...avoid.map(cleanLine)]);
  let fixes = [];
  let misses = [];
  // Wordings that passed and fit; one that runs a little long is kept, but another round looks for one that fits.
  const fitting = () => passed.filter((o) => !o.over).length;
  for (let attempt = 0; attempt <= MAX_REPAIRS && fitting() < want; attempt++) {
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
              count: want - fitting(),
              avoid: [...avoid, ...passed.map((o) => o.line)],
              fixes,
              misses,
              context,
              keep,
              examples,
              pauseBudget,
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
    misses = [];
    for (const raw of Array.isArray(parsed?.options) ? parsed.options : []) {
      const found = usable(String(raw ?? ''));
      if (shorter && !found) {
        // Too long to use: the next round is told how long it was.
        const words = wordsOf(String(raw ?? ''));
        if (words && words.length < text.length && !shorterFit(text, words, targetChars).usable && !seen.has(words)) misses.push(missOf(text, words, targetChars));
      }
      // With pauses, the same words paused differently are no new wording either.
      const key = found && (found.same ? found.offered : found.words);
      if (found && !seen.has(key)) {
        seen.add(key);
        candidates.push(found);
      }
    }
    const checks = await Promise.all(
      candidates.map((candidate) => {
        // The line's own words need no check of their meaning.
        if (candidate.same) return { ok: true, issues: [] };
        const missing = missingTerms(text, candidate.words, keep);
        return missing.length > 0
          ? { ok: false, issues: droppedIssues(missing) }
          : checkMeaning({ text, sourceText, candidate: candidate.words, language, direction }, { apiKey, generate });
      })
    );
    fixes = [];
    candidates.forEach(({ offered: line, words, over }, i) => {
      const backTranslation = checks[i].backTranslation ?? null;
      const extra = { ...(backTranslation && { backTranslation }), ...(over > 0 && { over }) };
      if (checks[i].ok) {
        passed.push({ line, ...extra });
        if (over > 0) misses.push(missOf(text, words, targetChars));
      } else {
        const issues = checks[i].issues.length > 0 ? checks[i].issues : ['The meaning is not the same as the original line.'];
        flagged.push({ line, issues, ...extra });
        fixes.push({ line, issues });
      }
    });
  }
  // Those that fit first, then those a little long, closest first; then any that changed the meaning.
  const byFit = (list) => [...list].sort((a, b) => (a.over || 0) - (b.over || 0));
  const options = [...byFit(passed), ...flagged].slice(0, want);
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
