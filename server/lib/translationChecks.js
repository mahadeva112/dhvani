import { lineSyllables } from './syllables.js';

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
 * Cues with less time than this many syllables are not judged for length: a
 * one-word cue ("situation.") carries the end of its sentence, and squeezing
 * it only makes the model move that word away and fill the cue with a word
 * the speaker never said.
 */
export const MIN_JUDGED_SYLLABLES = 4;

/** Square-bracketed sound notes ([laughs]) are not said, so they are not counted. */
const spoken = (text) => String(text ?? '').replace(/\[[^\]]*\]/g, ' ');

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
 * What is off with each translated cue: `long` (with its syllables and
 * budget), `end` (the English ends a sentence here and the translation runs
 * on), `open` (the translation ends a sentence the English carries on), or
 * `empty`. Cues without a budget are only checked for sentence ends.
 *
 * @param {{id: string, text: string, syllables?: number|null}[]} cues
 * @param {Map<string,string>} translations
 * @returns {{id: string, kind: 'long'|'end'|'open'|'empty', syllables?: number, target?: number}[]}
 */
export const cueIssues = (cues, translations) => {
  const issues = [];
  for (const cue of cues) {
    const text = translations.get(cue.id);
    if (!text?.trim()) {
      issues.push({ id: cue.id, kind: 'empty' });
      continue;
    }
    if (cue.syllables >= MIN_JUDGED_SYLLABLES) {
      const syllables = lineSyllables(spoken(text));
      if (syllables > cue.syllables * (1 + LONG_SHARE) && syllables - cue.syllables >= LONG_MIN_SYLLABLES) {
        issues.push({ id: cue.id, kind: 'long', syllables, target: cue.syllables });
      }
    }
    const source = sentenceEnding(cue.text);
    const dub = sentenceEnding(text);
    if (source && dub && source !== dub) issues.push({ id: cue.id, kind: source === 'end' ? 'end' : 'open' });
  }
  return issues;
};

/**
 * How far the cues are from right, to compare a fix against what it replaces:
 * the syllables past every budget, plus a few for every misplaced sentence
 * end or empty cue. Lower is better.
 */
export const issueScore = (cues, translations) => {
  let score = 0;
  for (const issue of cueIssues(cues, translations)) {
    if (issue.kind === 'long') score += issue.syllables - issue.target;
    else if (issue.kind === 'empty') score += 20;
    else score += 3;
  }
  return score;
};

const describeIssue = (issue) => {
  if (issue.kind === 'long') {
    return `- id ${issue.id}: ${issue.syllables} syllables, the voice has time for about ${issue.target}. Say the same thing in fewer syllables, or move a word to the next or previous cue of the same sentence if that cue has room.`;
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
export const buildFixPrompt = ({ cues, translations, issues, targetLanguage, customPrompt = '' }) => {
  const rows = cues.map((cue) => ({
    id: cue.id,
    english: cue.text,
    translation: translations.get(cue.id) ?? '',
    ...(cue.syllables && { syllables: cue.syllables, now: lineSyllables(spoken(translations.get(cue.id))) }),
  }));
  return `You are revising a ${targetLanguage} dubbing translation so it can be spoken in sync with the original video.
${customPrompt.trim() ? `\nTRANSLATION STYLE (keep following it):\n${customPrompt.trim()}\n` : ''}
"syllables" is about how many ${targetLanguage} syllables the voice says in the time the speaker took for that cue; "now" is what the translation has.

FIX THESE CUES
${issues.map(describeIssue).join('\n')}

RULES
- Keep every idea, emphasis, negation, number and name. Shorten by wording, never by leaving meaning out, and never by swapping a word for a shorter one that means something else ("beings" are not "people", "emperors" are not "kings"), never by folding a pair of words into one.
- Change only the cues listed above and, when a word moves, its neighbour in the same sentence. Do not shorten cues that already fit.
- Keep the language's normal word order; never invert it or turn poetic to save syllables. If a line cannot fit without becoming unclear or unnatural, keep a clear natural line that runs a little long.
- Never fill a cue with a word the speaker did not say. Copy sound notes in square brackets ([laughs]) exactly as they are.
- Natural spoken ${targetLanguage}, never word for word from the English.
- A word may move only to the next or previous cue of the same sentence, and only into a cue that has room.
- Return only the cues you change, each with its id copied verbatim. Never return an empty cue.

CUES (JSON):
${JSON.stringify(rows, null, 2)}

Respond with ONLY this JSON:
{"translations":[{"id":"<the same id>","translatedText":"<revised ${targetLanguage} line>"}]}`;
};

/**
 * Asks a strict reviewer whether the translation, sentence by sentence, still
 * says what the English says. Only meaning is judged, never style or length.
 */
export const buildMeaningReviewPrompt = ({ cues, translations, targetLanguage }) => `You are a strict reviewer checking a ${targetLanguage} dubbing translation against the English it was translated from.

The translation is meant to be free, not word for word, and a word may sit one cue earlier or later than in the English. Judge each sentence as a whole, across its cues.

Report a problem only when the meaning changed:
- an idea, example, condition, comparison, number or name is missing, or one was added;
- a negation was lost or added, or certainty changed ("may" became "will", "some" became "all");
- a question became a statement or the other way round, or a quote has the wrong speaker;
- a key word was swapped for one that means something else, even if shorter: a narrower or broader word ("emperors" as "kings", "men" as "people", "civilization" as "culture", "revered" as "worshipped"), or a different kind of thing ("beings" as "people", "humans", "creatures" or "animals");
- a deliberate pair was folded into one word ("controlled and ruled" said only as "ruled");
- the translation says something the English does not.
Do not report style, word choice, length or word order, nor a small connective ("and", "so", "then") or a subject the language needs that the English left implicit.

HOW TO CHECK
For every English sentence:
1. Put its cues' translations together and translate that back into English literally: what it actually says, not what it was meant to say.
2. List the key words of the English sentence: the nouns, main verbs and qualifiers its meaning rests on (not "is", "have", "that", "a", "you", "need" and the like). Give the literal English of how the translation carries each, or "" when it has nothing for it.
3. Mark "same" false only when the idea of that word is missing or became something else, by the rules above. A natural expression of the same idea is the same: "people think you need an investigation" said as "people think you should be investigated" keeps every word; "anyone on the spiritual path" said as "spiritual seekers" keeps it.

CUES (JSON):
${JSON.stringify(cues.map((cue) => ({ id: cue.id, english: cue.text, translation: translations.get(cue.id) ?? '' })), null, 2)}

Respond with ONLY this JSON, one entry per English sentence, "problem" empty when the sentence keeps its meaning:
{"sentences":[{"ids":["<id>", "..."],"backTranslation":"<literal English of the translation>","words":[{"english":"<word>","translatedAs":"<literal English of the translation's word, or empty>","same":true}],"problem":"<anything else missing, added or changed, in English; empty if nothing>"}]}`;

/** Asks for the cues the reviewer found, with what it found. */
export const buildMeaningFixPrompt = ({ cues, translations, problems, targetLanguage, customPrompt = '' }) => `You are correcting a ${targetLanguage} dubbing translation where a reviewer found the meaning changed.
${customPrompt.trim() ? `\nTRANSLATION STYLE (keep following it):\n${customPrompt.trim()}\n` : ''}
WHAT THE REVIEWER FOUND
${problems.map((p) => `- ids ${p.ids.join(', ')}: ${p.problem}`).join('\n')}

RULES
- Restore exactly what the English says, nothing more. Keep the rest of each line as it is.
- Restore the idea in natural spoken ${targetLanguage}, the way a native speaker says it: never copy the English wording, word order or sentence shape to restore it.
- Stay within the time: "syllables" is about how many ${targetLanguage} syllables the voice has in that cue. Make room by tighter wording elsewhere in the line, not by running long.
- Return only the cues you change, each with its id copied verbatim.

CUES (JSON):
${JSON.stringify(cues.map((cue) => ({ id: cue.id, english: cue.text, translation: translations.get(cue.id) ?? '', ...(cue.syllables && { syllables: cue.syllables }) })), null, 2)}

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
 * reviewer's summary says nothing. Sentences with no problem are left out.
 */
export const readMeaningIssues = (parsed, ids) => {
  const known = new Set(ids);
  const list = Array.isArray(parsed?.sentences) ? parsed.sentences : Array.isArray(parsed?.issues) ? parsed.issues : [];
  return list
    .map((issue) => {
      const said = String(issue?.problem ?? '').trim();
      const words = wordProblems(issue?.words);
      return {
        ids: (Array.isArray(issue?.ids) ? issue.ids : []).map(String).filter((id) => known.has(id)),
        problem: [said && !NO_PROBLEM.test(said) ? said : '', words].filter(Boolean).join('; '),
      };
    })
    .filter((issue) => issue.ids.length > 0 && issue.problem);
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
