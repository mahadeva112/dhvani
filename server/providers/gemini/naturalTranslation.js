import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { parseJsonResponse } from './client.js';
import { generateText } from '../textModel.js';
import { scriptOf } from '../../lib/languages.js';
import { examplesBlock } from '../../lib/translationExamples.js';
import {
  cueIssues,
  issueScore,
  mergeTerms,
  termsBlock,
  termIssues,
  bookishIssues,
  buildFixPrompt,
  buildMeaningReviewPrompt,
  readMeaningIssues,
  readRegisterIssues,
  readOfflineIssues,
  readFix,
  sentenceEnding,
  briefBlock,
  dubSyllables,
} from '../../lib/translationChecks.js';
import { PAUSE_SPLIT, TRANSLATION_PAUSE_SECONDS, cuePauses } from '../../lib/translationPauses.js';
import { normalizePauses, stripPauses } from '../../lib/linePauses.js';
import { cleanSpeakerGenders, genderOfCue, speakerField, speakerGenderRule } from '../../lib/speakerGender.js';
import {
  sentenceBatches,
  cleanVoiceRate,
  cleanSpeakerRates,
  rateForCue,
  syllableTarget,
  writeEffort,
  reviewEffort,
  translationParallel,
  readGlossary,
  withoutThreeStepNotes,
} from './translation.js';

/**
 * Natural translation: whole sentences first, cut onto the cues after.
 *
 * Today's translation (translation.js) sends every cue with its own syllable
 * budget and asks for every cue's line on its own, so the model keeps the
 * English cue cuts and, often, the English word order. Here the unit is the
 * English sentence: cues are joined until the sentence ends (across pauses up
 * to MAX_JOIN_GAP, one speaker), and the model writes each sentence the way a
 * native speaker says it ("natural"), then the same words again with a "‖"
 * where the speaker stops for TRANSLATION_PAUSE_SECONDS or more ("split"),
 * the same pauses Review's Bars split the original at and Sync cuts the dub
 * at (sourceCuts.js), so each piece of the dub lands under its piece of the
 * original. (Until 2026-11-26 only stops of 1.2 s or more were marked, so the
 * shorter ones had nowhere to cut.) The marks never bind the wording: the
 * model writes "natural" first. Code then cuts each sentence onto its cues: at the
 * "‖" marks first, the rest by each cue's share of the speaking time, at a
 * nearby comma where there is one. No word is changed by the cut.
 *
 * Checks are fewer and run together, for speed: length, sentence ends,
 * numbers, key terms, bookish words and the "‖" count are counted in code;
 * one meaning review reads the batch; one fix call takes everything found.
 * Timings are never sent to the model, only the syllable budgets.
 *
 * Three ways it runs: Natural (checks at CHECK_EFFORT), Fast (`quick`: no
 * glossary or review, only the bookish-word fix) and Full (`thorough`, since
 * 2026-11-23: glossary, review and fix at the app's full effort, a review that
 * also lists bookish words outside the fixed lists, spoken words put before a
 * syllable or two of length, and a resume after a restart). Full wrote cue by
 * cue before (translateCueTexts), which kept the English order at every pause
 * and pushed tight cues to short bookish words.
 */

/** Where a subtitle line of the sentence ends without a long stop, in the text the model reads and writes. */
export const SOFT_SPLIT = '¦';
const withoutSoft = (line) => String(line ?? '').split(SOFT_SPLIT).join(' ').replace(/\s+/g, ' ').trim();

/** A sentence is joined across pauses up to this long. */
export const MAX_JOIN_GAP = 2.5;
/** ...and never grows past this many seconds. */
const MAX_UNIT_SECONDS = 30;
/** Sentences sent in one call: small batches run side by side, so a short clip is done in a few seconds of model time. */
const NATURAL_BATCH = 5;
/**
 * Thinking for the glossary, the meaning review and the fix call. Only the
 * writing keeps the app's translation effort: lowering it brought back English
 * word order and wrong meanings on the test reel, lowering these did not, and
 * it halves the time (61 s → 30 s on a 1-minute reel).
 */
const CHECK_EFFORT = 'low';
/** Sentences of context on each side of a batch. */
const CONTEXT_UNITS = 2;

const hasWord = (text) => /[\p{L}\p{N}]/u.test(String(text ?? ''));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const words = (text) => String(text ?? '').trim().split(/\s+/).filter(Boolean);
const bare = (text) => String(text ?? '').normalize('NFC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

/** A cue's timed words that match its text one for one, else null (edited or untimed). */
const timedWords = (cue) => {
  const timed = (Array.isArray(cue.words) ? cue.words : []).filter((w) => hasWord(w?.text) && finite(w.start) && finite(w.end) && w.end >= w.start);
  return timed.length && timed.length === words(cue.text).filter(hasWord).length ? timed : null;
};

/**
 * The sentence units of `cues` (already sized: `syllables`, `speakerIs`): each
 * `{ id, cues, text, pausedText?, pauses, parts, syllables, partSyllables?, speakerIs? }`.
 * `parts` are the unit's pieces between hard pauses, each `{ text, talk, cues: [{ index, talk }] }`
 * with the speaking seconds of each of its cues; `pauses` their lengths.
 */
export const buildNaturalUnits = (cues, { hardPause = TRANSLATION_PAUSE_SECONDS, maxJoinGap = MAX_JOIN_GAP } = {}) => {
  const units = [];
  for (const cue of cues) {
    const unit = units.at(-1);
    const last = unit?.cues.at(-1);
    const gap = last ? cue.startTime - last.endTime : Infinity;
    const joins =
      unit &&
      sentenceEnding(unit.cues.map((c) => c.text).join(' ')) === 'open' &&
      (cue.speaker || 'Speaker') === (unit.cues[0].speaker || 'Speaker') &&
      finite(gap) && gap >= -0.05 && gap <= maxJoinGap &&
      cue.endTime - unit.cues[0].startTime <= MAX_UNIT_SECONDS;
    if (joins) unit.cues.push(cue);
    else units.push({ cues: [cue] });
  }

  return units.map((unit, u) => {
    // Every word of the unit, with the cue it belongs to; a cue without word
    // timings is one "word" spanning the cue, so it still has a place in time.
    const spans = unit.cues.flatMap((cue, index) => {
      const timed = timedWords(cue);
      if (timed) {
        const tokens = words(cue.text);
        let w = 0;
        return tokens.map((token) => {
          const at = timed[Math.min(w, timed.length - 1)];
          if (hasWord(token)) w += 1;
          return { text: token, start: at.start, end: at.end, index };
        });
      }
      return [{ text: cue.text, start: cue.startTime, end: cue.endTime, index }];
    });
    const parts = [];
    const pauses = [];
    let current = [];
    for (const [i, span] of spans.entries()) {
      const gap = i > 0 ? span.start - spans[i - 1].end : 0;
      if (current.length && hasWord(span.text) && gap >= hardPause) {
        parts.push(current);
        pauses.push(gap);
        current = [];
      }
      current.push(span);
    }
    parts.push(current);
    // Every break inside the sentence, in order: "‖" at a hard stop, "¦" where
    // a cue ends without one. The model places both in its own line, so the
    // cut follows its phrases rather than a share of the time.
    const segments = [];
    const breaks = [];
    for (const [i, span] of spans.entries()) {
      const gap = i > 0 ? span.start - spans[i - 1].end : 0;
      const hard = i > 0 && hasWord(span.text) && gap >= hardPause && segments.at(-1)?.words.length;
      const newCue = i > 0 && span.index !== spans[i - 1].index;
      if (hard || newCue) {
        segments.push({ index: span.index, words: [] });
        breaks.push(hard ? PAUSE_SPLIT : SOFT_SPLIT);
      } else if (!segments.length) segments.push({ index: span.index, words: [] });
      segments.at(-1).words.push(span.text);
    }
    const shaped = parts.map((part) => {
      const byCue = new Map();
      for (const span of part) byCue.set(span.index, (byCue.get(span.index) ?? 0) + Math.max(0.05, span.end - span.start));
      return {
        text: part.map((span) => span.text).join(' '),
        talk: [...byCue.values()].reduce((a, b) => a + b, 0),
        cues: [...byCue].map(([index, talk]) => ({ index, talk })),
      };
    });
    const text = unit.cues.map((c) => c.text).join(' ');
    const syllables = unit.cues.reduce((sum, c) => sum + (c.syllables || 0), 0) || null;
    const talk = shaped.reduce((sum, part) => sum + part.talk, 0);
    const speakerIs = unit.cues.find((c) => c.speakerIs)?.speakerIs;
    return {
      id: `n-${u + 1}`,
      cues: unit.cues,
      text,
      parts: shaped,
      pauses,
      segments: segments.map((seg) => ({ index: seg.index, text: seg.words.join(' ') })),
      breaks,
      ...(breaks.length && { markedText: segments.map((seg, i) => (i ? `${breaks[i - 1]} ` : '') + seg.words.join(' ')).join(' ') }),
      syllables,
      ...(speakerIs && { speakerIs }),
      ...(pauses.length && {
        pausedText: shaped.map((part) => part.text).join(` ${PAUSE_SPLIT} `),
        ...(syllables && { partSyllables: shaped.map((part) => Math.max(1, Math.round(syllables * (talk > 0 ? part.talk / talk : 1 / shaped.length)))) }),
      }),
    };
  });
};

/** A cut that lands after a word ending in one of these reads as a phrase break. */
const BREAK_AFTER = /[,;:।॥.!?…—–-]["'”’»)\]]*$/u;

/**
 * One piece of a translated sentence cut over the cues its English piece
 * covers (`cues`: `{ index, talk }`), by each cue's share of the speaking
 * time, moved up to two words to a phrase break. Every cue gets at least one
 * word while there are words enough. Returns `[index, text]` pairs.
 */
export const cutPiece = (text, cues) => {
  const list = words(text);
  if (cues.length === 1) return [[cues[0].index, list.join(' ')]];
  const total = cues.reduce((sum, c) => sum + c.talk, 0) || 1;
  const weights = list.map((w) => Math.max(1, dubSyllables(w)));
  const weightTotal = weights.reduce((a, b) => a + b, 0) || 1;
  const out = [];
  let from = 0;
  let share = 0;
  for (const [k, cue] of cues.entries()) {
    const left = cues.length - 1 - k;
    if (!left) {
      out.push([cue.index, list.slice(from).join(' ')]);
      break;
    }
    share += cue.talk / total;
    let sum = 0;
    let cut = list.length;
    for (let i = 0; i < list.length; i++) {
      sum += weights[i];
      if (sum / weightTotal >= share - 1e-9) {
        // Cut before or after this word, whichever lands nearer the share.
        cut = sum / weightTotal - share > share - (sum - weights[i]) / weightTotal ? i : i + 1;
        break;
      }
    }
    let best = cut;
    for (let d = 0; d <= 2 && best === cut; d++) {
      for (const c of [cut - d, cut + d]) {
        if (c > from && c < list.length && BREAK_AFTER.test(list[c - 1])) {
          best = c;
          break;
        }
      }
    }
    best = Math.max(Math.min(best, list.length - left), Math.min(from + 1, list.length));
    out.push([cue.index, list.slice(from, best).join(' ')]);
    from = best;
  }
  return out;
};

/**
 * A unit's line cut onto its cues: `{ lines: string[], paused: (string|null)[] }`,
 * one per cue. `line` holds a "‖" for each of the unit's hard pauses when the
 * model kept them; without them the whole line is cut by speaking time. A
 * hard pause inside one cue becomes a pause mark in that cue's `paused` line.
 */
export const cutUnit = (unit, line) => {
  const byMarks = cutByMarks(unit, line);
  if (byMarks) return byMarks;
  const pieces = withoutSoft(line).split(PAUSE_SPLIT).map((p) => p.trim());
  const kept = unit.pauses.length > 0 && pieces.length === unit.pauses.length + 1 && pieces.every(hasWord);
  const plan = kept
    ? pieces.map((text, k) => ({ text, cues: unit.parts[k].cues }))
    : [{ text: pieces.join(' '), cues: mergeCueTalk(unit.parts) }];
  const byCue = unit.cues.map(() => []);
  for (const [k, piece] of plan.entries()) {
    for (const [index, text] of cutPiece(piece.text, piece.cues)) if (text) byCue[index].push({ text, piece: k });
  }
  return {
    lines: byCue.map((list) => list.map((p) => p.text).join(' ').trim()),
    paused: byCue.map((list) => {
      if (list.length < 2) return null;
      const marked = list.map((p, i) => (i < list.length - 1 ? `${p.text} [pause ${unit.pauses[p.piece].toFixed(1)}s]` : p.text)).join(' ');
      return normalizePauses(marked);
    }),
  };
};

/**
 * The cut when the line has the sentence's breaks ("‖" and "¦") in the same
 * order as the English: each piece goes to the cue its English piece is in.
 * Null when the marks don't match, so the cut falls back to speaking time.
 */
const cutByMarks = (unit, line) => {
  if (!unit.breaks?.length) return null;
  const tokens = String(line ?? '').split(/\s*([‖¦])\s*/u);
  const pieces = tokens.filter((_, i) => i % 2 === 0).map((p) => p.trim());
  const marksFound = tokens.filter((_, i) => i % 2 === 1);
  if (marksFound.join('') !== unit.breaks.join('') || !pieces.every(hasWord)) return null;
  const byCue = unit.cues.map(() => []);
  let stop = 0;
  pieces.forEach((text, j) => {
    const index = unit.segments[j].index;
    const pauseBefore = j > 0 && unit.breaks[j - 1] === PAUSE_SPLIT ? unit.pauses[stop++] : null;
    byCue[index].push({ text, pauseBefore });
  });
  return {
    lines: byCue.map((list) => list.map((p) => p.text).join(' ').trim()),
    paused: byCue.map((list) =>
      list.some((p, i) => i > 0 && p.pauseBefore)
        ? normalizePauses(list.map((p, i) => (i > 0 && p.pauseBefore ? `[pause ${p.pauseBefore.toFixed(1)}s] ${p.text}` : p.text)).join(' '))
        : null
    ),
  };
};

const mergeCueTalk = (parts) => {
  const byCue = new Map();
  for (const part of parts) for (const c of part.cues) byCue.set(c.index, (byCue.get(c.index) ?? 0) + c.talk);
  return [...byCue].map(([index, talk]) => ({ index, talk }));
};

/**
 * Endings that join a pair on both of its words ("fear and resistance" in
 * Malayalam പേടിയും എതിർപ്പും, Tamil -உம் ... -உம், Kannada -ವೂ, Telugu -ూ; "a
 * mantra or a god" in Malayalam മന്ത്രമോ ദൈവമോ). The model still split such
 * pairs with "¦" in about one Malayalam sentence in three.
 */
const PAIR_ENDINGS = ['ും', 'ும்', 'ೂ', 'ూ', 'ോ', 'ோ'];
/** "and" / "or" as words in the dub languages; a subtitle line should never end on one. Words that are also pronouns or postpositions are left out. */
const PAIR_WORDS = new Set(['and', 'or', 'और', 'या', 'एवं', 'तथा', 'आणि', 'किंवा', 'আর', 'এবং', 'বা', 'কিংবা', 'অথবা', 'আৰু', 'અને', 'અથવા', 'ਅਤੇ', 'ਜਾਂ', 'र', 'वा', 'अनि', 'अथवा', 'ଓ', 'ଏବଂ', 'ବା', 'କିମ୍ବା', 'ଅଥବା', 'மற்றும்', 'அல்லது', 'మరియు', 'లేదా', 'ಮತ್ತು', 'ಅಥವಾ', 'അല്ലെങ്കിൽ']);
const bareWord = (token) => String(token).normalize('NFC').replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');
const pairEnding = (token) => PAIR_ENDINGS.find((end) => bareWord(token).endsWith(end) && bareWord(token).length > end.length);

/**
 * Moves a "¦" that splits a pair so the whole pair sits on one line: before
 * the first word of a pair joined by endings, or before the "and" / "or" a
 * line would end on. Only "¦" moves ("‖" stays at the speaker's stop) and no
 * word changes.
 */
export const mendLineSplits = (line) => {
  const tokens = String(line ?? '').split(/\s+/).filter(Boolean);
  const isMark = (t) => t === PAUSE_SPLIT || t === SOFT_SPLIT;
  for (let k = 1; k < tokens.length - 1; k++) {
    if (tokens[k] !== SOFT_SPLIT) continue;
    const before = tokens[k - 1];
    const ending = pairEnding(before);
    const pairsOn = ending && tokens.slice(k + 1, k + 3).some((t) => !isMark(t) && pairEnding(t) === ending);
    const endsOnAnd = PAIR_WORDS.has(bareWord(before).toLowerCase());
    if (!(pairsOn || endsOnAnd)) continue;
    // Room before the word: the line keeps at least one word of its own.
    if (k >= 2 && !isMark(tokens[k - 2])) {
      tokens.splice(k, 1);
      tokens.splice(k - 1, 0, SOFT_SPLIT);
    }
  }
  return tokens.join(' ');
};

/** How many "‖" a line has. */
const marks = (line) => String(line ?? '').split(PAUSE_SPLIT).length - 1;

/** The line kept from a model answer: `split` when it has the same words as `natural`, else `natural`. */
export const readNaturalLine = (item) => {
  const natural = String(item?.natural ?? item?.translatedText ?? '').trim();
  const split = String(item?.split ?? '').trim();
  if (split && (!natural || bare(split.split(PAUSE_SPLIT).join(' ')) === bare(natural))) return split;
  return natural || split;
};

/**
 * A whole sentence runs long only when it is this many syllables over (about
 * half a second at a usual pace): sending a sentence back for one or two
 * syllables cut "say" or "you believe in" out of short sentences, and Sync's
 * speed fit takes up that much anyway.
 */
export const NATURAL_LONG_MIN = 3;

/** What is off with each unit's line: everything cueIssues finds (a long line only from NATURAL_LONG_MIN over), plus a wrong "‖" count. */
export const naturalIssues = (units, lines) => {
  const issues = cueIssues(units, lines).filter((issue) => issue.kind !== 'long' || issue.syllables - issue.target >= NATURAL_LONG_MIN);
  for (const unit of units) {
    const line = lines.get(unit.id);
    if (line && marks(line) !== unit.pauses.length) issues.push({ id: unit.id, kind: 'pauses', want: unit.pauses.length, have: marks(line) });
  }
  return issues;
};

const unitScore = (unit, line) => {
  const one = new Map([[unit.id, line]]);
  return issueScore([unit], one) + (marks(line) === unit.pauses.length ? 0 : 3);
};

/**
 * How wrong a meaning review found each sentence: the key words it marked as
 * missing or changed, plus one when it found any problem (where it reads like
 * English is not counted). Sentences the review left alone are 0.
 */
export const meaningWeights = (parsed, ids) => {
  const flagged = new Set(readMeaningIssues(parsed, ids, { shape: false }).flatMap((p) => p.ids));
  const weights = new Map();
  for (const sentence of Array.isArray(parsed?.sentences) ? parsed.sentences : []) {
    const wrong = (Array.isArray(sentence?.words) ? sentence.words : []).filter((w) => w && w.same === false && String(w.english ?? '').trim()).length;
    for (const id of (Array.isArray(sentence?.ids) ? sentence.ids : []).map(String)) {
      if (flagged.has(id)) weights.set(id, Math.max(weights.get(id) ?? 0, wrong + 1));
    }
  }
  return weights;
};

const promptUnit = (unit) => ({
  id: unit.id,
  ...speakerField(unit),
  english: unit.markedText ?? unit.text,
  ...(unit.pauses.length && { pauses: unit.pauses.length }),
  ...(unit.syllables && { syllables: unit.syllables }),
  ...(unit.partSyllables && { partSyllables: unit.partSyllables }),
});

const contextBlock = (before, after) => {
  if (!before.length && !after.length) return '';
  const lines = [];
  if (before.length) {
    lines.push('Just before these sentences (written in another part, do not write again):');
    for (const u of before) lines.push(u.line ? `- "${u.text}" → "${u.line.split(PAUSE_SPLIT).join(' ').replace(/\s+/g, ' ')}"` : `- "${u.text}"`);
  }
  if (after.length) {
    lines.push('Just after these sentences (written in the next part, do not write now):');
    for (const u of after) lines.push(`- "${u.text}"`);
  }
  return `\nCONTEXT\n${lines.join('\n')}\n`;
};

export const buildNaturalPrompt = ({ batch, sourceLanguage, targetLanguage, customPrompt, before = [], after = [], terms = [], brief = null, spokenFirst = false }) => {
  const script = scriptOf(targetLanguage);
  const examples = examplesBlock(targetLanguage);
  const sized = batch.some((u) => u.syllables);
  const marked = batch.some((u) => u.breaks?.length);
  const style = customPrompt?.trim()
    ? `TRANSLATION STYLE & PERSONA (follow it for tone, voice and word choice; where it asks for something the rules below forbid, the rules below win):\n${customPrompt.trim()}`
    : `STYLE:\nNatural, warm, everyday spoken ${targetLanguage}. Keep the meaning, register and feeling.`;
  return `You write the ${targetLanguage} dubbing script of one continuous talk, sent in parts. A voice will say each sentence over the original video, so it must sound like a ${targetLanguage} speaker talking, never like a translation.${script ? ` Write only in the ${script} script.` : ''}
${sourceLanguage && sourceLanguage !== 'Auto Detect' ? `The source language is ${sourceLanguage}.` : ''}

${style}

HOW TO WRITE EACH SENTENCE
1. Read the English sentence whole and understand what it says and why.
2. "natural": say that the way a native ${targetLanguage} speaker says it out loud to people, in ${targetLanguage}'s own word order and sentence shape, with the everyday words people use when they talk (colloquial, not written, literary or bookish words; keep the English words a ${targetLanguage} speaker would say in English). Do not translate the English words one by one and do not keep the English order: rebuild the sentence the ${targetLanguage} way, by whole phrases. The verb, a "which / who / that" part, "only", "even", "just" and tag questions go where ${targetLanguage} puts them.
3. Never change the meaning while doing it: every idea, example, condition, negation, number, name, who does what to whom, the tense and the certainty stay exactly as in the English. Add nothing the speaker did not say, and drop nothing. This holds for the shortest sentence too: "the book you gave me" still says that you gave it, never "a gift book" or just "the book".
4. Follow the speaker's rhythm: short bursts stay short, a trailing thought stays. Punctuate for the ear: commas where the speaker breathes, "?" and "!" where the voice rises. Leave out hesitation sounds ("uh", "um", "er") and words the speaker repeats while searching ("a sort of a hall sort of place" is one "a hall-like place"): the voice says what he means, once.
5. Write out what a voice would stumble on: no digits, abbreviations, symbols or brackets (numbers as they are said). Sound notes in square brackets such as [laughs] are copied exactly, in English, where they stand.
6. Where "it", "that" or "this" would leave a ${targetLanguage} listener unsure what is meant, say the thing itself (a letter that "never came" is "the letter never came"). That is not adding: it is what the speaker means.
7. Pick each word for the picture it gives a ${targetLanguage} listener, not only for its dictionary meaning: a word tied to another religion, kind of place or kind of person is wrong (a village temple is not a church, a mosque, a dargah or a mazar; a monk is not a priest). Never hedge with "X or Y" when X is the wrong picture: pick the right word.
8. A person keeps one respect form every time they are spoken of (pronoun and verb forms, respectful or familiar), the one their first mention set, and the listener is addressed with one form of "you" throughout: a man in a story who "said" respectfully never turns familiar a sentence later.
9. Indian-English turns of phrase are said by what they mean, never word for word: "somewhere" in "somewhere I felt it was wrong" means "deep down, in some way", not a place; "simply" means "just, for no other reason"; "what to do" means "nothing can be done"; "itself" and "only" often just stress a word. Say that meaning the way a ${targetLanguage} speaker would.
${examples ? `\n${examples}\n(These examples show cue lines; here you write the whole sentence, so the same idea applies to the whole sentence.)\n` : ''}${marked ? `
MARKS IN THE ENGLISH
- "${PAUSE_SPLIT}" is where the speaker stops, even for a short breath; the dub voice stops at the same moments, so before each stop it should be saying what the speaker said before it.
- "${SOFT_SPLIT}" is where a subtitle line ends while the speaker talks on. It only says where the line breaks: it never binds the wording.
- "split" is "natural" again, with exactly the same words in the same order, plus the same marks as the English, the same number of each in the same order. Put each "${PAUSE_SPLIT}" where what comes before it says what came before it in the English, as near as ${targetLanguage}'s order allows. Put each "${SOFT_SPLIT}" at the natural phrase break nearest to the same point of the meaning, never between a word and its postposition, case ending or helping verb, never inside a name or a fixed phrase, and never inside a pair joined by "and" or "or" ("fear and resistance", "a mantra or a god"), also when the language marks the pair on both words instead of with a word between them: the whole pair stays on one side, even if that moves the mark a few words.
- Write "natural" first, freely; then place the marks. Never reword "natural" to make a mark fit. If the language's order moves an idea across a mark, put the mark at the nearest natural phrase break.${spokenFirst ? `
- The voice says each piece at the time of the same English piece. So when the English sentence runs over several pieces, pick, among the natural spoken orders, one that keeps each idea in its own piece: speech allows an afterthought ("most people run every day, ${SOFT_SPLIT} without knowing where they go" rather than "not knowing where they go, ${SOFT_SPLIT} most people run every day"). Only where ${targetLanguage} cannot say it in that order, use the order it needs.` : ''}
- Each piece between marks must be a phrase that can stand on its own line. Never fill a piece with a word the speaker did not say.
- A sentence without marks gets "split" equal to "natural".
` : ''}${sized ? `
LENGTH FOR THE VOICE
"syllables" is about how many ${targetLanguage} syllables the voice says in the time the speaker took for the whole sentence (stops not counted); "partSyllables" splits it over the pieces between stops. ${targetLanguage} usually takes longer than English, so this is often tight.
${spokenFirst
    ? `- Stay close to it, but the meaning comes first and spoken words second: a sentence in everyday words that runs a syllable or two over is better than a shorter one with a bookish, written or classical word in it. Far under leaves the voice silent while the speaker talks.
- Reach it by word choice: everyday words, a leaner sentence, dropping a filler or a repeat the speaker did not stress. Never by dropping meaning, never by swapping a word for one that means something else, never by a shorter bookish word, never by padding.`
    : `- Stay close to it: a little under is better than over; far under leaves the voice silent while the speaker talks.
- Reach it by word choice: shorter everyday words, a leaner sentence, dropping a filler the speaker did not stress. Never by dropping meaning, never by swapping a word for one that means something else, never by padding.`}
- Never clip a phrase below what a speaker would say: keep the noun a phrase needs ("one way is" keeps "way"), even when that runs a syllable or two over.
` : ''}
RULES
1. One answer for every input id, with the id copied verbatim. Never merge, split, drop or reorder sentences, never leave one empty.
2. Never output timestamps or timing.
3. Read the sentences as one conversation, so pronouns, "you" and continuations stay the same across them.
4. Key terms (concepts, names, technical words) that come back are said with the same word each time. After writing, list up to 6 key terms of these sentences with the exact ${targetLanguage} word you used.
${briefBlock(brief)}${speakerGenderRule(batch, targetLanguage)}${contextBlock(before, after)}${termsBlock(terms)}
INPUT SENTENCES (JSON):
${JSON.stringify(batch.map(promptUnit), null, 2)}

Respond with ONLY this JSON:
{"sentences":[{"id":"<the same id>","natural":"<the sentence as a ${targetLanguage} speaker says it>","split":"<the same words with the stop marks>"}],"terms":[{"english":"<key term>","translated":"<the ${targetLanguage} word used>"}]}`;
};

const askJson = async (generate, prompt, { apiKey, models, temperature, effort = writeEffort() }) => {
  const { response, modelUsed } = await generate({
    contents: { role: 'user', parts: [{ text: prompt }] },
    generationConfig: { responseMimeType: 'application/json', temperature },
    effort,
    models,
    apiKey,
  });
  return { parsed: parseJsonResponse(response.text, 'Natural translation'), modelUsed };
};

const writeBatch = async (generate, prompt, ids, options) => {
  const once = async () => {
    const { parsed, modelUsed } = await askJson(generate, prompt, { ...options, temperature: 0.4 });
    const list = Array.isArray(parsed?.sentences) ? parsed.sentences : Array.isArray(parsed?.translations) ? parsed.translations : Array.isArray(parsed) ? parsed : [];
    const lines = new Map();
    for (const item of list) {
      const id = String(item?.id ?? '');
      const line = readNaturalLine(item);
      if (ids.includes(id) && line) lines.set(id, line);
    }
    if (!lines.size) throw new ApiError('The translation came back without any sentences.', { status: 502, code: 'bad_model_output', retryable: true });
    return { lines, modelUsed, terms: Array.isArray(parsed?.terms) ? parsed.terms : [] };
  };
  try {
    return await once();
  } catch (err) {
    if (err?.code !== 'bad_model_output') throw err;
    logger.warn('Natural translation batch came back unreadable; asking once more.');
    return once();
  }
};

/**
 * One batch: written, then checked in code and by one meaning review at the
 * same time, then one fix call for everything found. A fixed line is kept
 * when it scores no worse (a meaning fix may run up to a few syllables longer).
 */
const translateUnitBatch = async (batch, { generate, sourceLanguage, targetLanguage, customPrompt, before, after, terms, brief, apiKey, models, quick = false, thorough = false }) => {
  const ids = batch.map((u) => u.id);
  const written = await writeBatch(generate, buildNaturalPrompt({ batch, sourceLanguage, targetLanguage, customPrompt, before, after, terms, brief, spokenFirst: thorough }), ids, { apiKey, models });
  let lines = written.lines;
  const known = mergeTerms(terms, written.terms, lines);
  const reviewOptions = { targetLanguage, apiKey, models, effort: thorough ? reviewEffort() : CHECK_EFFORT };

  // Quick (Fast translate): no meaning review, and only bookish words are sent back.
  const review = quick ? Promise.resolve(null) : reviewMeaning(generate, batch, lines, { ...reviewOptions, register: thorough, marked: thorough });
  const listed = bookishIssues(batch, lines, targetLanguage, known);
  const counted = quick ? listed : [...naturalIssues(batch, lines), ...termIssues(batch, lines, known), ...listed];
  const reviewed = await review;
  const meaning = (reviewed ? readMeaningIssues(reviewed, ids) : []).flatMap((p) => p.ids.map((id) => ({ id, kind: 'meaning', problem: p.problem })));
  // Full: bookish words the reviewer heard that the fixed lists don't know.
  const heard = thorough && reviewed
    ? readRegisterIssues(reviewed, batch, new Map([...lines].map(([id, line]) => [id, withoutSoft(line)])), targetLanguage, {
        terms: known,
        skip: new Set(listed.map((issue) => `${issue.id}|${issue.said}`)),
      })
    : [];
  // Full: an idea said in another piece than its English one, so the voice would say it at the wrong moment.
  const offline = thorough && reviewed ? readOfflineIssues(reviewed, ids) : [];
  const issues = [...meaning, ...counted, ...heard, ...offline];
  let fixed = 0;
  let reverted = 0;
  if (issues.length) {
    try {
      // Each sentence stands alone, so the fix call reads only the sentences it has to change.
      const flagged = new Set(issues.map((issue) => issue.id));
      const toFix = batch.filter((u) => flagged.has(u.id));
      const { parsed } = await askJson(generate, buildFixPrompt({ cues: toFix, translations: lines, issues, targetLanguage, customPrompt, brief, spoken: true }), { apiKey, models, temperature: 0.3, effort: thorough ? writeEffort() : CHECK_EFFORT });
      const changes = readFix(parsed, ids);
      // A meaning fix may run a few syllables longer, and so may a bookish word said the spoken way.
      const roomy = new Set([...meaning, ...listed, ...heard, ...offline].map((m) => m.id));
      const next = new Map(lines);
      for (const [id, line] of changes) {
        const unit = batch.find((u) => u.id === id);
        const was = lines.get(id) ?? '';
        if (unit.pauses.length && marks(line) !== unit.pauses.length && marks(was) === unit.pauses.length) continue;
        // A fix never brings in a listed bookish word the line did not have.
        if (bookishCount(unit, line, targetLanguage, known) > bookishCount(unit, was, targetLanguage, known)) continue;
        if (unitScore(unit, line) <= unitScore(unit, was) + (roomy.has(id) ? 3 : 0)) {
          next.set(id, line);
          fixed += 1;
        }
      }
      // A fix is read again before it is kept: fixes for length or for one
      // word cut "god" or "say" out of short sentences, and put a dargah
      // where the English has a shrine. A fixed sentence the review finds
      // more wrong than before goes back to how it was written.
      const changed = ids.filter((id) => next.get(id) !== lines.get(id));
      if (changed.length && reviewed) {
        const again = await reviewMeaning(generate, batch, next, reviewOptions);
        if (again) {
          const was = meaningWeights(reviewed, ids);
          const now = meaningWeights(again, ids);
          for (const id of changed) {
            if ((now.get(id) ?? 0) > (was.get(id) ?? 0)) {
              next.set(id, lines.get(id));
              fixed -= 1;
              reverted += 1;
            }
          }
        }
      }
      lines = next;
    } catch (err) {
      logger.warn(`Natural translation fix skipped: ${err?.message || err}`);
    }
  }
  return { lines, modelUsed: written.modelUsed, terms: written.terms, fixed, reverted, found: issues.length, meaning: meaning.length, heard: heard.length, offline: offline.length };
};

/** How many listed bookish words (spokenWords.js) a unit's line says. */
const bookishCount = (unit, line, targetLanguage, terms) => bookishIssues([unit], new Map([[unit.id, withoutSoft(line)]]), targetLanguage, terms).length;

/** One meaning review of a batch's lines (the parsed answer), or null when it fails: a failed check never stops the translation. */
const reviewMeaning = (generate, batch, lines, { targetLanguage, apiKey, models, effort = CHECK_EFFORT, register = false, marked = false }) => {
  // A `marked` review (Full) reads the lines with their marks, to see where each piece falls.
  const plain = marked ? lines : new Map([...lines].map(([id, line]) => [id, withoutSoft(line)]));
  return askJson(generate, buildMeaningReviewPrompt({ cues: batch, translations: plain, targetLanguage, spoken: true, register, marked }), { apiKey, models, temperature: 0, effort })
    .then(({ parsed }) => parsed)
    .catch((err) => {
      logger.warn(`Natural translation meaning check skipped: ${err?.message || err}`);
      return null;
    });
};

/**
 * Translates `cues` sentence by sentence and cuts each sentence back onto its
 * cues. Takes the same options as translateCueTexts and returns the same
 * shape: `translations` (cue id → line), `pausedTexts` (only cues a hard pause
 * falls inside), `modelUsed`, `missingIds`, `failedBatches`, plus `units`
 * (each sentence's line, for checking) and `fixed` / `found` counts.
 * `onBatchDone` hears each sentence's line so far (by unit id) after every
 * batch, and `resumeFrom` (what it heard, saved) skips the batches it holds.
 */
export const translateNatural = async (
  cues,
  { sourceLanguage = '', targetLanguage, customPrompt = '', apiKey, models, onProgress, voiceRate, speakerRates, speakerGenders, generate = generateText, batchSize = NATURAL_BATCH, quick = false, thorough = false, resumeFrom = null, onBatchDone } = {}
) => {
  if (!targetLanguage) throw new ApiError('No target language was selected for translation.', { status: 400, code: 'missing_target_language' });
  customPrompt = withoutThreeStepNotes(customPrompt);
  const rate = cleanVoiceRate(voiceRate);
  const ownRates = cleanSpeakerRates(speakerRates);
  const genders = cleanSpeakerGenders(speakerGenders);

  const sized = cues
    .map((cue) => {
      const text = String(cue.text ?? '').trim();
      const split = cuePauses({ ...cue, text });
      const silent = split ? split.pauses.reduce((a, b) => a + b, 0) : 0;
      const speakerIs = genderOfCue(cue, genders);
      return { ...cue, id: String(cue.id), text, syllables: syllableTarget(cue, rateForCue(cue, rate, ownRates), silent), ...(speakerIs && { speakerIs }) };
    })
    .filter((cue) => cue.text)
    .sort((a, b) => a.startTime - b.startTime);
  if (!sized.length) return { translations: new Map(), pausedTexts: new Map(), modelUsed: null, translatedCount: 0, missingIds: [], failedBatches: 0, units: [] };

  const units = buildNaturalUnits(sized);
  const batches = sentenceBatches(units, Math.max(5, batchSize));
  const say = (message, extra = {}) => onProgress?.({ stage: 'translating', batchCount: batches.length, step: 'translate', ...extra, message });

  // Sentence lines kept from before a restart: only ids this run has too.
  const unitIds = new Set(units.map((u) => u.id));
  const lines = new Map(Object.entries(resumeFrom?.translations || {}).filter(([id, line]) => unitIds.has(id) && typeof line === 'string' && line.trim()));
  let terms = lines.size && Array.isArray(resumeFrom?.terms) ? resumeFrom.terms : [];
  let brief = lines.size ? resumeFrom?.brief ?? null : null;
  if (batches.length > 1 && !quick && !lines.size) {
    say('Reading the whole talk for its key terms and tone...', { batch: 1 });
    ({ terms, brief } = await readGlossary(sized, { sourceLanguage, targetLanguage, customPrompt, apiKey, models, generate, effort: thorough ? writeEffort() : CHECK_EFFORT }));
  }

  let modelUsed = lines.size ? resumeFrom?.modelUsed ?? null : null;
  let failedBatches = 0;
  let firstError = null;
  let fixed = 0;
  let found = 0;
  let reverted = 0;
  let heard = 0;
  let offline = 0;
  let stopped = false;
  const queue = batches.map((batch, index) => ({ batch, index })).filter(({ batch }) => !batch.every((u) => lines.has(u.id)));
  let done = batches.length - queue.length;
  say(lines.size ? `Carrying on: ${lines.size} of ${units.length} sentences were already written...` : `Writing ${units.length} sentences in ${targetLanguage}...`, { batch: Math.max(1, done) });
  const worker = async () => {
    while (queue.length && !stopped) {
      const { batch } = queue.shift();
      const at = units.indexOf(batch[0]);
      const before = units.slice(Math.max(0, at - CONTEXT_UNITS), at).map((u) => ({ text: u.text, line: lines.get(u.id) }));
      const after = units.slice(at + batch.length, at + batch.length + CONTEXT_UNITS).map((u) => ({ text: u.text }));
      try {
        const out = await translateUnitBatch(batch, { generate, sourceLanguage, targetLanguage, customPrompt, before, after, terms, brief, apiKey, models, quick, thorough });
        modelUsed = out.modelUsed ?? modelUsed;
        terms = mergeTerms(terms, out.terms, out.lines);
        for (const [id, line] of out.lines) lines.set(id, line);
        heard += out.heard ?? 0;
        offline += out.offline ?? 0;
        onBatchDone?.({ translations: lines, terms, brief, modelUsed });
        fixed += out.fixed;
        found += out.found;
        reverted += out.reverted ?? 0;
      } catch (err) {
        failedBatches += 1;
        firstError ??= err;
        logger.error(`Natural translation of sentences ${at + 1}-${at + batch.length} failed: ${err?.message || err}`);
        if (err?.code === 'invalid_api_key' || err?.code === 'translation_cancelled' || err?.status === 401 || err?.status === 403 || err?.code === 'cancelled') stopped = true;
      }
      done += 1;
      say(`Written ${Math.min(units.length, lines.size)} of ${units.length} sentences...`, { batch: done });
    }
  };
  await Promise.all(Array.from({ length: Math.min(translationParallel(), batches.length) }, worker));
  if (!lines.size && firstError) throw firstError;

  const translations = new Map();
  const pausedTexts = new Map();
  const unitLines = [];
  for (const unit of units) {
    const written = lines.get(unit.id);
    if (!written) continue;
    const line = mendLineSplits(written);
    const cut = cutUnit(unit, line);
    unit.cues.forEach((cue, i) => {
      if (cut.lines[i]) translations.set(cue.id, cut.lines[i]);
      if (cut.paused[i] && stripPauses(cut.paused[i]) === cut.lines[i]) pausedTexts.set(cue.id, cut.paused[i]);
    });
    unitLines.push({ id: unit.id, cueIds: unit.cues.map((c) => c.id), english: unit.text, line, syllables: unit.syllables, said: dubSyllables(line) });
  }
  const missingIds = sized.filter((cue) => !translations.has(cue.id)).map((cue) => cue.id);
  logger.info(`${thorough ? 'Full' : quick ? 'Fast' : 'Natural'} translation: ${units.length} sentences over ${sized.length} cues; ${found} issue(s) found${thorough ? ` (${heard} bookish word(s) heard by the review, ${offline} sentence(s) with an idea in another line)` : ''}, ${fixed} line(s) fixed, ${reverted} fix(es) undone after a second read.`);
  return { translations, pausedTexts, modelUsed, translatedCount: translations.size, missingIds, failedBatches, terms, brief, units: unitLines, fixed, found, reverted, heard, offline };
};
