import { lineSyllables } from './syllables.js';
import { PAUSE_SPLIT, withoutSplits } from './translationPauses.js';
import { examplesBlock } from './translationExamples.js';
import { speakerField, speakerGenderRule, speakerGenderReview } from './speakerGender.js';
import { bookishWordsIn } from './spokenWords.js';

/**
 * Checks on a fresh translation that code can make better than the model can:
 * the model is told each cue's syllable budget but can't count syllables, and
 * it sometimes ends a sentence in a different cue than the speaker did. Both
 * show up in the dub as a line that runs long or a pause in the wrong place,
 * so they are found here, counted the way Sync counts (syllables.js), and the
 * cues that miss are sent back to the model once with the exact numbers.
 *
 * Nothing here changes a translation by itself: a fix is only taken when it
 * leaves the cues closer to their budgets and sentence ends than before.
 */

/** A cue may run this much past its budget before it counts as long: a voice's rate varies about as much from line to line. */
export const LONG_SHARE = 0.15;
/** ...and by at least this many syllables, so short cues are not sent back over one syllable. */
export const LONG_MIN_SYLLABLES = 2;
/**
 * A cue this much under its budget counts as short: the voice falls silent
 * while the speaker is still talking. Only when it is also at least
 * SHORT_MIN_SYLLABLES under, and says fewer syllables than its own English,
 * which these languages almost never do unless part of the line moved to a
 * neighbouring cue or was left out. A short English line said slowly
 * ("Nowhere.") is not short: nothing is missing from it.
 */
export const SHORT_SHARE = 0.3;
export const SHORT_MIN_SYLLABLES = 4;
/**
 * Cues with less time than this many syllables are not judged on their own: a
 * one-word cue ("situation.") carries the end of its sentence, and squeezing
 * it only makes the model move that word away and fill the cue with a word
 * the speaker never said. Such a cue is judged together with the cue before
 * it in the same sentence (lengthUnits), the way Chunk sync joins them.
 */
export const MIN_JUDGED_SYLLABLES = 4;
/** A batch whose syllables past their budgets are more than this share of its whole budget is translated once more. */
export const OUTLIER_SHARE = 0.15;

/** Square-bracketed sound notes ([laughs]) are not said, so they are not counted. */
const spoken = (text) => String(text ?? '').replace(/\[[^\]]*\]/g, ' ');

/**
 * Numbers and symbols left in a line ("100%", "&"): the voice has to guess
 * how to say them, and syllables.js counts none of their syllables, so a
 * line holding one runs longer than it is measured.
 */
export const unsaidMarks = (text) => spoken(text).match(/\p{Nd}+(?:[.,:]\p{Nd}+)*|[%&@#+=/$€£₹]/gu) ?? [];

/**
 * About how many syllables a number or symbol takes to say, so a line
 * that still has one is not measured short: a number about two, plus two
 * for each further digit that is not a zero (100 "a hundred", 1947
 * "nineteen forty-seven"); "%" about three ("percent", "प्रतिशत"); other
 * symbols about two.
 */
const markSyllables = (mark) => {
  if (/\p{Nd}/u.test(mark)) {
    const digits = mark.replace(/\P{Nd}/gu, '');
    return 2 + 2 * [...digits.slice(1)].filter((d) => !/[0०০੦૦୦௦౦೦൦]/u.test(d)).length;
  }
  return mark === '%' ? 3 : 2;
};

/** Syllables the voice says for a translated line: its words (syllables.js) and an estimate for numbers and symbols left in it. */
export const dubSyllables = (text) => lineSyllables(spoken(text)) + unsaidMarks(text).reduce((sum, mark) => sum + markSyllables(mark), 0);

/** A sentence-ending mark, before any closing quotes or brackets. "..." and "…" trail off and don't count either way. */
const ENDS_SENTENCE = /(?<!\.)[.?!।॥|]["'”’»)\]]*$/u;
const TRAILS_OFF = /(\.\.\.|…)["'”’»)\]]*$/u;

/** 'end' when `text` ends a sentence, 'open' when it doesn't, null when it trails off (either reading is fine). */
export const sentenceEnding = (text) => {
  const line = String(text ?? '').trim();
  if (!line || TRAILS_OFF.test(line)) return null;
  return ENDS_SENTENCE.test(line) ? 'end' : 'open';
};

/**
 * The cues judged for length, as groups of ids with their budget: each cue
 * with a budget on its own, except that a cue under MIN_JUDGED_SYLLABLES
 * joins the cue before it when that cue's English sentence carries on into
 * it. A tiny cue that starts a sentence (or the batch) is not judged.
 *
 * @returns {{ids: string[], target: number}[]}
 */
export const lengthUnits = (cues) => {
  const units = [];
  let last = null;
  for (const [index, cue] of cues.entries()) {
    if (!cue.syllables) {
      last = null;
      continue;
    }
    const before = cues[index - 1];
    if (cue.syllables < MIN_JUDGED_SYLLABLES) {
      if (last && before && sentenceEnding(before.text) !== 'end') {
        last.ids.push(cue.id);
        last.target += cue.syllables;
      }
      continue;
    }
    last = { ids: [cue.id], target: cue.syllables };
    units.push(last);
  }
  return units;
};

const unitSyllables = (unit, translations) => unit.ids.reduce((sum, id) => sum + dubSyllables(translations.get(id)), 0);

/** Syllables in a unit's English, the most a line that kept all of it can fall below. */
const unitSourceSyllables = (unit, byId) => unit.ids.reduce((sum, id) => sum + lineSyllables(spoken(byId.get(id)?.text)), 0);

const isShort = (syllables, target, source) =>
  syllables < target * (1 - SHORT_SHARE) && target - syllables >= SHORT_MIN_SYLLABLES && syllables < source;

/**
 * What is off with each translated cue: `long` (with its syllables and
 * budget, and `ids` when a tiny cue is judged with the one before it), `short`
 * (the same, for a cue far under its budget that says less than its English), `end`
 * (the English ends a sentence here and the translation runs on), `open`
 * (the translation ends a sentence the English carries on), `unsaid` (a
 * number or symbol left as digits, with `marks`), or `empty`. Cues without a
 * budget are only checked for sentence ends and numbers.
 *
 * @param {{id: string, text: string, syllables?: number|null}[]} cues
 * @param {Map<string,string>} translations
 * @returns {{id: string, ids?: string[], kind: 'long'|'short'|'end'|'open'|'unsaid'|'empty', syllables?: number, target?: number, marks?: string[]}[]}
 */
export const cueIssues = (cues, translations) => {
  const issues = [];
  const units = new Map(lengthUnits(cues).map((unit) => [unit.ids[0], unit]));
  const byId = new Map(cues.map((cue) => [cue.id, cue]));
  for (const cue of cues) {
    const text = translations.get(cue.id);
    if (!text?.trim()) {
      issues.push({ id: cue.id, kind: 'empty' });
      continue;
    }
    const unit = units.get(cue.id);
    if (unit) {
      const syllables = unitSyllables(unit, translations);
      if (syllables > unit.target * (1 + LONG_SHARE) && syllables - unit.target >= LONG_MIN_SYLLABLES) {
        issues.push({ id: cue.id, ...(unit.ids.length > 1 && { ids: unit.ids }), kind: 'long', syllables, target: unit.target });
      } else if (isShort(syllables, unit.target, unitSourceSyllables(unit, byId))) {
        issues.push({ id: cue.id, ...(unit.ids.length > 1 && { ids: unit.ids }), kind: 'short', syllables, target: unit.target });
      }
    }
    const source = sentenceEnding(cue.text);
    const dub = sentenceEnding(text);
    if (source && dub && source !== dub) issues.push({ id: cue.id, kind: source === 'end' ? 'end' : 'open' });
    const marks = unsaidMarks(text);
    if (marks.length) issues.push({ id: cue.id, kind: 'unsaid', marks });
  }
  return issues;
};

/**
 * How far the cues are from right, to compare a fix against what it replaces:
 * the syllables past every budget, half the syllables missing from a short
 * cue (a silence is easier on the dub than a line running over the next),
 * plus a few for every misplaced sentence end, number left in digits or empty
 * cue. Lower is better.
 */
export const issueScore = (cues, translations) => {
  let score = 0;
  for (const issue of cueIssues(cues, translations)) {
    if (issue.kind === 'long') score += issue.syllables - issue.target;
    else if (issue.kind === 'short') score += (issue.target - issue.syllables) / 2;
    else if (issue.kind === 'empty') score += 20;
    else score += 3;
  }
  return score;
};

/**
 * True when a batch came back far too long to fix line by line: the
 * syllables past every judged budget add up to more than OUTLIER_SHARE of
 * the batch's whole budget. Such a batch is worth translating again.
 */
export const isOutlier = (cues, translations) => {
  const units = lengthUnits(cues);
  const budget = units.reduce((sum, unit) => sum + unit.target, 0);
  if (!budget) return false;
  const extra = units.reduce((sum, unit) => sum + Math.max(0, unitSyllables(unit, translations) - unit.target), 0);
  return extra > budget * OUTLIER_SHARE;
};

/** Just the cues that run long, for a second length pass. */
export const longIssues = (cues, translations) => cueIssues(cues, translations).filter((issue) => issue.kind === 'long');

const describeIssue = (issue) => {
  if (issue.kind === 'long' && issue.ids) {
    return `- ids ${issue.ids.join(', ')} together (the last is only a word or two, spoken straight on): ${issue.syllables} syllables, the voice has time for about ${issue.target} across them. Say the same thing in fewer syllables; keep the last cue as the end of the sentence.`;
  }
  if (issue.kind === 'long') {
    return `- id ${issue.id}: ${issue.syllables} syllables, the voice has time for about ${issue.target}. Say the same thing in fewer syllables, or move a word to the next or previous cue of the same sentence if that cue has room.`;
  }
  if (issue.kind === 'short') {
    const which = issue.ids ? `ids ${issue.ids.join(', ')} together` : `id ${issue.id}`;
    return `- ${which}: only ${issue.syllables} syllables where the voice has time for about ${issue.target}, so it falls silent while the speaker is still talking. Say all of this cue's English here: if part of it moved to the cue before or after, bring it back, and use fuller natural wording. Never add an idea the speaker did not say.`;
  }
  if (issue.kind === 'unsaid') {
    return `- id ${issue.id}: ${issue.marks.map((mark) => `"${mark}"`).join(', ')} is written in digits or symbols; write it out in words, the way it is said aloud.`;
  }
  if (issue.kind === 'term') {
    return `- id ${issue.id}: the key term "${issue.english}" is said as "${issue.translated}" elsewhere in this talk; say it with that same word here, in a natural line.`;
  }
  if (issue.kind === 'bookish') {
    return `- id ${issue.id}: "${issue.said}" is a written, bookish word that people rarely say aloud. Say that part the way a ${issue.language} speaker says it (for example ${issue.say}), as a natural line with the same meaning and about the same length.`;
  }
  if (issue.kind === 'meaning') {
    return `- id ${issue.id}: a reviewer found: ${issue.problem}. Say exactly what the English says, no more and no less, in natural spoken words and the language's own sentence shape, never the English word order.`;
  }
  if (issue.kind === 'pauses') {
    return `- id ${issue.id}: the English has ${issue.want} "${PAUSE_SPLIT}" (where the speaker stops for over a second) and the line has ${issue.have}. Put exactly ${issue.want} "${PAUSE_SPLIT}" in the line, each between the same ideas as in the English, as near as the language's word order allows.`;
  }
  if (issue.kind === 'end') return `- id ${issue.id}: the English sentence ends in this cue; end the sentence here too.`;
  if (issue.kind === 'open') return `- id ${issue.id}: the English sentence carries on into the next cue; do not end the sentence here.`;
  return `- id ${issue.id}: the translation is empty.`;
};

/**
 * Asks for the cues that missed, with the counts. The cues around them come
 * along with their syllable budgets, because a word may move to a
 * neighbouring cue of the same sentence; the model returns only the cues it
 * changes.
 */
/** The rule that keeps a fix from losing the speaker's pauses, when the cues have any. */
/** The target language's worked examples, so a fix rebuilds a line the way the translation was told to. */
const examplesSection = (targetLanguage) => {
  const examples = examplesBlock(targetLanguage);
  return examples ? `\n${examples}` : '';
};

const keepPausesRule = (cues) =>
  cues.some((cue) => cue.pausedText)
    ? `\n- A "${PAUSE_SPLIT}" is where the speaker paused, and the voice pauses there too. Keep every "${PAUSE_SPLIT}" a translation has, in the same place between the same ideas.`
    : '';

/** Natural translation's mark where one subtitle line ends and the next begins while the speaker runs on. */
const LINE_SPLIT = '¦';

const keepLineSplitsRule = (cues, translations) =>
  cues.some((cue) => String(translations.get(cue.id) ?? '').includes(LINE_SPLIT))
    ? `
- A "${LINE_SPLIT}" is where one subtitle line ends and the next begins; the English shows the same marks. Keep as many "${LINE_SPLIT}" as the line has, each at the matching place, between whole phrases: never between a word and its postposition, case ending or helper verb, and never inside a pair joined by "and" or "or" ("fear and resistance").`
    : '';

/** Natural translation's fix (`spoken`) also keeps each word's picture and every word of a short sentence. */
const spokenFixRules = () => `
- Never swap a word for one that gives another picture: a village temple is not a church, a mosque, a dargah or a mazar; a monk is not a priest.
- A short sentence keeps every noun and verb its English has: shortening "the book you gave me" never drops "gave" or turns it into "a gift book". If a sentence cannot be shorter without losing a word, leave it as long as it is.
- To shorten, first drop what only repeats or stresses what is already said (a pronoun said twice, "out" after "came", an "even" or "any" added for stress), then pick shorter everyday words. Never drop "all", "not", a number, a name, or a noun or verb the English has, and keep the joining words the language needs ("that", "who", "where").
- Never shorten by swapping an everyday word or phrase for a bookish, written or classical one: an everyday line a syllable or two long is better.`;

export const buildFixPrompt = ({ cues, translations, issues, targetLanguage, customPrompt = '', brief = null, spoken = false }) => {
  const rows = cues.map((cue) => ({
    id: cue.id,
    ...speakerField(cue),
    english: cue.markedText ?? cue.pausedText ?? cue.text,
    translation: translations.get(cue.id) ?? '',
    ...(cue.syllables && { syllables: cue.syllables, now: dubSyllables(translations.get(cue.id)) }),
  }));
  return `You are revising a ${targetLanguage} dubbing translation so it can be spoken in sync with the original video.
${customPrompt.trim() ? `\nTRANSLATION STYLE (keep following it):\n${customPrompt.trim()}\n` : ''}${briefBlock(brief)}${examplesSection(targetLanguage)}
"syllables" is about how many ${targetLanguage} syllables the voice says in the time the speaker took for that cue; "now" is what the translation has.

FIX THESE CUES
${issues.map(describeIssue).join('\n')}

RULES
- Keep every idea, emphasis, negation, number and name. Shorten by wording, never by leaving meaning out, and never by swapping a word for a shorter one that means something else ("beings" are not "people", "emperors" are not "kings"), never by folding a pair of words into one.${spoken ? spokenFixRules() : ''}
- Change only the cues listed above and, when a word moves, its neighbour in the same sentence. Do not shorten cues that already fit.
- Keep the language's normal word order; never invert it or turn poetic to save syllables. If a line cannot fit without becoming unclear or unnatural, keep a clear natural line that runs a little long.
- Never fill a cue with a word the speaker did not say. Copy sound notes in square brackets ([laughs]) exactly as they are.
- Natural spoken ${targetLanguage}, never word for word from the English.
- A word may move only to the next or previous cue of the same sentence, and only into a cue that has room.${keepPausesRule(cues)}${keepLineSplitsRule(cues, translations)}
- Return only the cues you change, each with its id copied verbatim. Never return an empty cue.
${speakerGenderRule(cues, targetLanguage)}
CUES (JSON):
${JSON.stringify(rows, null, 2)}

Respond with ONLY this JSON:
{"translations":[{"id":"<the same id>","translatedText":"<revised ${targetLanguage} line>"}]}`;
};

/**
 * Asks a strict reviewer whether the translation, sentence by sentence, still
 * says what the English says. Only meaning is judged, never style or length.
 */
/**
 * Natural translation's own review asks for more (`spoken`): a word that paints another picture, a
 * kept "uh" or search-repeat, an unclear "it", and a sentence that follows the English clause by
 * clause. Full and Fast keep the review as it was.
 */
const spokenReviewRules = (targetLanguage) => `
Also report as a problem, because a listener hears the wrong thing:
- a word that gives a different picture than the English: another religion, kind of place, person or thing, even if a dictionary allows it (a village temple said as a church, a mosque, a dargah or a mazar, also inside an "X or Y"; a monk said as a priest);
- an "it", "that" or "this" left so the listener cannot tell what it means, where the English makes it clear;
- a hesitation sound ("uh", "um", "er" or the ${targetLanguage} sound for it) or a word the speaker repeated while searching ("a sort of a hall sort of place") kept in the translation;
- a short phrase that lost one of its words or who does what ("the book you gave me" said as "a gift book" or just "the book");
- an Indian-English turn of phrase said word for word so it means something else ("somewhere I felt it was wrong" said with "somewhere" as a place, where it means "deep down, in some way").
`;

/**
 * Full translation's review also lists bookish words (`register`): the fixed
 * lists of spokenWords.js only know the plainest cases, so a written word
 * outside them (Bengali আবশ্যক, উপলব্ধি) is found by the reviewer and sent
 * back the same way (readRegisterIssues).
 */
const registerRules = (targetLanguage) => `

Separately, as "bookish", list every word of the translation that a ${targetLanguage} speaker would not say aloud in a talk or a film: a written, literary, officialese or classical (Sanskrit- or Persian-made) word where everyday speech has a common word or a short phrase for the same idea, a written verb form or ending where speech has its own, an abstract noun people would say as a short clause with a verb. Give each word exactly as the translation writes it, with what a speaker says instead. Leave out a spiritual term the speaker means as one (mukti, sadhana), a name, and a word careful speakers do say aloud. Leave it empty when every word is spoken ${targetLanguage}.`;

export const buildMeaningReviewPrompt = ({ cues, translations, targetLanguage, spoken = false, register = false }) => `You are a strict reviewer checking a ${targetLanguage} dubbing translation against the English it was translated from.

The translation is meant to be free, not word for word, and a word may sit one cue earlier or later than in the English. Judge each sentence as a whole, across its cues.

Report a problem only when the meaning changed:
- an idea, example, condition, comparison, number or name is missing, or one was added;
- a negation was lost or added, or certainty changed ("may" became "will", "some" became "all");
- a question became a statement or the other way round, or a quote has the wrong speaker;
- a key word was swapped for one that means something else, even if shorter: a narrower or broader word ("emperors" as "kings", "men" as "people", "civilization" as "culture", "revered" as "worshipped"), or a different kind of thing ("beings" as "people", "humans", "creatures" or "animals");
- a deliberate pair was folded into one word ("controlled and ruled" said only as "ruled");
- who does what to whom changed: the doer and the one it is done to swapped, or an action given to the wrong person;
- a describing word or phrase now describes something else;
- the tense or aspect changed (did, does, will do, has done, keeps doing), or how two clauses relate (because, if, although, but, so);
- the translation says something the English does not;${speakerGenderReview(cues)}
Do not report style, word choice, length or word order as a meaning problem, nor a small connective ("and", "so", "then") or a subject the language needs that the English left implicit.${spoken ? spokenReviewRules(targetLanguage) : ''}

Separately, as "englishShaped", say where a sentence keeps the English sentence shape where a native ${targetLanguage} speaker would build it differently: a "which / who / that" part left trailing after its word, "that"-clauses, tag questions or words like "just" and "only" placed as in English, an English idiom said word for word. Report it only when a native speaker would clearly not say it that way. Leave it empty when the sentence sounds the way ${targetLanguage} is spoken, even if its order is close to the English, and never for formality or word choice.${spoken ? ` Also report a sentence that follows the English clause by clause so it sounds translated ("I went there simply because somewhere, what they do, it pulled me" kept in that order), where a ${targetLanguage} speaker would first say what it is about and then the rest.` : ''}${register ? registerRules(targetLanguage) : ''}

HOW TO CHECK
For every English sentence:
1. Put its cues' translations together and translate that back into English literally: what it actually says, not what it was meant to say.
2. List the key words of the English sentence: the nouns, main verbs and qualifiers its meaning rests on (not "is", "have", "that", "a", "you", "need" and the like). Give the literal English of how the translation carries each, or "" when it has nothing for it.
3. Mark "same" false only when the idea of that word is missing or became something else, by the rules above. A natural expression of the same idea is the same: "people think you need an investigation" said as "people think you should be investigated" keeps every word; "anyone on the spiritual path" said as "spiritual seekers" keeps it.

CUES (JSON):
${JSON.stringify(cues.map((cue) => ({ id: cue.id, ...speakerField(cue), english: cue.text, translation: withoutSplits(translations.get(cue.id)) })), null, 2)}

Respond with ONLY this JSON, one entry per English sentence, "problem" empty when the sentence keeps its meaning:
{"sentences":[{"ids":["<id>", "..."],"backTranslation":"<literal English of the translation>","words":[{"english":"<word>","translatedAs":"<literal English of the translation's word, or empty>","same":true}],"problem":"<anything else missing, added or changed, in English; empty if nothing>","englishShaped":"<what follows English instead of ${targetLanguage}, in English; empty if nothing>"${register ? `,"bookish":[{"word":"<the word as the translation writes it>","say":"<what a speaker says instead>"}]` : ''}}]}`;

/** Asks for the cues the reviewer found, with what it found. */
export const buildMeaningFixPrompt = ({ cues, translations, problems, targetLanguage, customPrompt = '', brief = null }) => `You are correcting a ${targetLanguage} dubbing translation where a reviewer found the meaning changed or the sentence shaped like English.
${customPrompt.trim() ? `\nTRANSLATION STYLE (keep following it):\n${customPrompt.trim()}\n` : ''}${briefBlock(brief)}${examplesSection(targetLanguage)}
WHAT THE REVIEWER FOUND
${problems.map((p) => `- ids ${p.ids.join(', ')}: ${p.problem}`).join('\n')}

RULES
- Restore exactly what the English says, nothing more. Keep the rest of each line as it is.
- Restore the idea in natural spoken ${targetLanguage}, the way a native speaker says it: never copy the English wording, word order or sentence shape to restore it.
- Keep each line as spoken as it is now: the same everyday, colloquial forms and the English words it already uses. Never make a line bookish or formal.
- Add nothing the English does not say: no "only", "also" or "even", no verb of your own (gave, showed), no "like" or "as if" that turns what he states into a comparison.
- Where it "reads like English", build that sentence again the way ${targetLanguage} builds it, by whole phrases and clauses. Its meaning stays exactly the same: the same ideas, who does what to whom, tense, negation and certainty. A word moves only to the next or previous cue of the same sentence, and each sentence still ends in the cue it ended in.
- Stay within the time: "syllables" is about how many ${targetLanguage} syllables the voice has in that cue. Make room by tighter wording elsewhere in the line, not by running long.${keepPausesRule(cues)}
- Return only the cues you change, each with its id copied verbatim.
${speakerGenderRule(cues, targetLanguage)}
CUES (JSON):
${JSON.stringify(cues.map((cue) => ({ id: cue.id, ...speakerField(cue), english: cue.pausedText ?? cue.text, translation: translations.get(cue.id) ?? '', ...(cue.syllables && { syllables: cue.syllables }) })), null, 2)}

Respond with ONLY this JSON:
{"translations":[{"id":"<the same id>","translatedText":"<corrected ${targetLanguage} line>"}]}`;

/** A "problem" that says there is none. */
const NO_PROBLEM = /^(none|nothing|n\/a|no (problems?|issues?|changes?)( found)?)\.?$/i;

/** The words of a reviewed sentence the reviewer marked as missing or changed, as one line for the fix. */
const wordProblems = (words) =>
  (Array.isArray(words) ? words : [])
    .filter((w) => w && w.same === false && String(w.english ?? '').trim())
    .map((w) => {
      const english = String(w.english).trim();
      const as = String(w.translatedAs ?? '').trim();
      return as ? `"${english}" is said as "${as}"` : `"${english}" is missing`;
    })
    .join('; ');

/**
 * The reviewer's problems, keeping only those that name cues of this batch.
 * A sentence's problem is what the reviewer wrote plus every word it marked
 * as not the same, so a word flagged in the list is fixed even when the
 * reviewer's summary says nothing, plus where it reads like English, so the
 * fix rebuilds it in the language's own shape. Sentences with no problem are left out.
 * `shape: false` leaves out where it reads like English: only meaning counts.
 */
export const readMeaningIssues = (parsed, ids, { shape = true } = {}) => {
  const known = new Set(ids);
  const list = Array.isArray(parsed?.sentences) ? parsed.sentences : Array.isArray(parsed?.issues) ? parsed.issues : [];
  return list
    .map((issue) => {
      const said = String(issue?.problem ?? '').trim();
      const words = wordProblems(issue?.words);
      const shaped = String(issue?.englishShaped ?? '').trim();
      return {
        ids: (Array.isArray(issue?.ids) ? issue.ids : []).map(String).filter((id) => known.has(id)),
        problem: [said && !NO_PROBLEM.test(said) ? said : '', words, shape && shaped && !NO_PROBLEM.test(shaped) ? `reads like English: ${shaped}` : ''].filter(Boolean).join('; '),
      };
    })
    .filter((issue) => issue.ids.length > 0 && issue.problem);
};

/**
 * The bookish words a `register` review found (buildMeaningReviewPrompt), as
 * `bookish` issues like bookishIssues gives: only words the cue's line really
 * has, never one of the talk's key terms, and never a word the fixed list
 * already reports (`skip`: `${id}|${word}` keys).
 */
export const readRegisterIssues = (parsed, cues, translations, targetLanguage, { terms = [], skip = new Set() } = {}) => {
  const chosen = terms.map((term) => spoken(term.translated));
  const byId = new Map(cues.map((cue) => [cue.id, cue]));
  const issues = [];
  const seen = new Set();
  for (const sentence of Array.isArray(parsed?.sentences) ? parsed.sentences : []) {
    const ids = (Array.isArray(sentence?.ids) ? sentence.ids : []).map(String).filter((id) => byId.has(id));
    for (const item of Array.isArray(sentence?.bookish) ? sentence.bookish : []) {
      const said = String(item?.word ?? '').trim();
      const say = String(item?.say ?? '').trim();
      if (!said || !say || said === say) continue;
      if (chosen.some((term) => term.includes(said))) continue;
      const id = ids.find((cueId) => spoken(translations.get(cueId)).includes(said));
      if (!id || skip.has(`${id}|${said}`) || seen.has(`${id}|${said}`)) continue;
      seen.add(`${id}|${said}`);
      issues.push({ id, kind: 'bookish', word: said, said, say, language: targetLanguage });
    }
  }
  return issues;
};

/** The changed cues of a fix answer, as a Map, keeping only ids of this batch and lines that aren't empty. */
export const readFix = (parsed, ids) => {
  const known = new Set(ids);
  const list = Array.isArray(parsed?.translations) ? parsed.translations : Array.isArray(parsed) ? parsed : [];
  const changes = new Map();
  for (const item of list) {
    const id = String(item?.id ?? '');
    const text = String(item?.translatedText ?? item?.text ?? '').trim();
    if (known.has(id) && text) changes.set(id, text);
  }
  return changes;
};

/** Key terms carried from batch to batch, at most this many, so a long talk's prompts stay short. */
export const MAX_TERMS = 30;

/**
 * Adds the key terms a batch reports (`terms: [{english, translated}]`) to
 * the running list of the talk. A term the list already has keeps its first
 * word, and a reported word the batch's final lines don't contain is
 * skipped: a fix may have changed it, and the list must only hold words the
 * talk really uses. Without `translations` (the glossary read before any
 * line is translated) every well-formed term is taken.
 *
 * @param {{english: string, translated: string}[]} known
 * @returns {{english: string, translated: string}[]}
 */
export const mergeTerms = (known, reported, translations = null) => {
  const said = translations ? [...translations.values()].join(' ').toLowerCase() : null;
  const list = [...known];
  const seen = new Set(list.map((term) => term.english.toLowerCase()));
  for (const item of Array.isArray(reported) ? reported : []) {
    if (list.length >= MAX_TERMS) break;
    const english = String(item?.english ?? '').trim();
    const translated = String(item?.translated ?? item?.translatedAs ?? '').trim();
    if (!english || !translated || english.length > 60 || translated.length > 60) continue;
    if (seen.has(english.toLowerCase()) || (said !== null && !said.includes(translated.toLowerCase()))) continue;
    seen.add(english.toLowerCase());
    list.push({ english, translated });
  }
  return list;
};

/** The longest a brief's field may be, so a rambling answer cannot bloat every prompt. */
const BRIEF_CHARS = 500;

/**
 * The talk's brief from the glossary answer ({about, tone, address}), each
 * field trimmed, or null when it has none. It is what every part is told
 * about the whole talk, so parts translated at the same time sound like one
 * speaker and say "you" the same way.
 *
 * @returns {{about: string, tone: string, address: string}|null}
 */
export const readBrief = (value) => {
  const field = (key) => String(value?.[key] ?? '').trim().slice(0, BRIEF_CHARS);
  const brief = { about: field('about'), tone: field('tone'), address: field('address') };
  return brief.about || brief.tone || brief.address ? brief : null;
};

/** The talk's brief as a prompt block, or '' without one. */
export const briefBlock = (brief) => {
  if (!brief) return '';
  const lines = [];
  if (brief.about) lines.push(`About: ${brief.about}`);
  if (brief.tone) lines.push(`Tone: ${brief.tone}`);
  if (brief.address) {
    lines.push(`Addressing the listener: ${brief.address}`);
    lines.push(`Every part of the talk uses this same form of "you" and of the speaker's "I", with its matching verb forms. Change it only where the speaker clearly turns to someone else.`);
  }
  return `\nTHE WHOLE TALK (read from the full transcript before any part was translated)\n${lines.join('\n')}\n`;
};

/**
 * Asks for a smoother join where two parts of a talk, translated by separate
 * calls, meet. `cues` are the last cues of one part and the first of the
 * next; `joinId` is the first cue of the next part.
 */
export const buildSeamPrompt = ({ cues, translations, joinId, targetLanguage, customPrompt = '', brief = null }) => `You are smoothing the join between two parts of a ${targetLanguage} dubbing translation of one talk. The cues below are consecutive lines; the cues before the one marked "join" and the cues from it on were translated separately, so the talk may not read as one voice across that point.
${customPrompt.trim() ? `\nTRANSLATION STYLE (keep following it):\n${customPrompt.trim()}\n` : ''}${briefBlock(brief)}
FIX ONLY WHAT READS WRONG ACROSS THE JOIN
- a sentence that runs across the join and is broken, said twice, or has a part missing;
- a word or idea said on both sides of the join where the English says it once;
- a connective ("so", "but", "and then") or reference ("this", "he", "that one") that no longer follows from what comes before it;
- a different form of "you", or of the speaker's "I", on the two sides; a key term said one way before the join and another way after it.

RULES
- Each cue still says what its English says: no idea added or left out, the same negation, tense, certainty and who does what to whom.
- Keep each changed line about as long as it is now: "syllables" is about how many ${targetLanguage} syllables the voice has in that cue.
- Keep the everyday spoken forms the lines use now; never make a line bookish, formal or word for word from the English.
- A word may move only to the next or previous cue of the same sentence. Copy sound notes in square brackets ([laughs]) exactly as they are.${keepPausesRule(cues)}
- Most joins already read well. Return only the cues you change, each with its id copied verbatim, or an empty list when the join reads well.
${speakerGenderRule(cues, targetLanguage)}
CUES (JSON):
${JSON.stringify(
  cues.map((cue) => ({
    id: cue.id,
    ...speakerField(cue),
    ...(cue.id === joinId && { join: true }),
    english: cue.pausedText ?? cue.text,
    translation: translations.get(cue.id) ?? '',
    ...(cue.syllables && { syllables: cue.syllables }),
  })),
  null,
  2
)}

Respond with ONLY this JSON:
{"translations":[{"id":"<the same id>","translatedText":"<smoothed ${targetLanguage} line>"}]}`;

/** The running term list as a prompt block, or '' when there is none yet. */
export const termsBlock = (terms) =>
  terms?.length
    ? `\nKEY TERMS SO FAR
Earlier parts of this talk said these key terms this way. When the same idea comes back, say it with the same word, so the talk uses one word for it throughout; still let the sentence around it be natural:
${terms.map((term) => `- ${term.english} → ${term.translated}`).join('\n')}\n`
    : '';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The start of a term's word that every form of it keeps: languages add case
 * endings and postpositions to the end (জড়তা, জড়তাকে), so the first part is
 * what is looked for in a line.
 */
const termStem = (word) => {
  const chars = [...word];
  return chars.slice(0, Math.max(2, Math.ceil(chars.length * 0.6))).join('');
};

/**
 * Cues whose translation says a bookish word of `targetLanguage`
 * (spokenWords.js): `bookish` issues, one per word, to be said the spoken way.
 * A word the talk's key terms use is left alone: the talk chose it.
 *
 * @param {{english: string, translated: string}[]} terms
 * @returns {{id: string, kind: 'bookish', word: string, said: string, say: string, language: string}[]}
 */
export const bookishIssues = (cues, translations, targetLanguage, terms = []) => {
  const chosen = terms.map((term) => spoken(term.translated));
  const issues = [];
  for (const cue of cues) {
    for (const found of bookishWordsIn(spoken(translations.get(cue.id)), targetLanguage)) {
      if (chosen.some((term) => term.includes(found.said))) continue;
      issues.push({ id: cue.id, kind: 'bookish', ...found, language: targetLanguage });
    }
  }
  return issues;
};

/**
 * Cues whose English has one of the talk's key terms but whose translation
 * says it with another word: `term` issues, to be fixed so one talk uses one
 * word throughout.
 *
 * @param {{english: string, translated: string}[]} terms
 * @returns {{id: string, kind: 'term', english: string, translated: string}[]}
 */
export const termIssues = (cues, translations, terms = []) => {
  const issues = [];
  for (const term of terms) {
    const english = new RegExp(`\\b${escapeRegExp(term.english)}\\b`, 'i');
    const stem = termStem(term.translated).toLowerCase();
    for (const cue of cues) {
      const text = spoken(translations.get(cue.id)).toLowerCase();
      if (english.test(cue.text) && text.trim() && !text.includes(stem)) {
        issues.push({ id: cue.id, kind: 'term', english: term.english, translated: term.translated });
      }
    }
  }
  return issues;
};
