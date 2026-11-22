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
  readFix,
  sentenceEnding,
  briefBlock,
  dubSyllables,
} from '../../lib/translationChecks.js';
import { PAUSE_SPLIT, cuePauses } from '../../lib/translationPauses.js';
import { normalizePauses, stripPauses } from '../../lib/linePauses.js';
import { HARD_ANCHOR_GAP_SECONDS } from '../../lib/syncUnits.js';
import { cleanSpeakerGenders, genderOfCue, speakerField, speakerGenderRule } from '../../lib/speakerGender.js';
import {
  sentenceBatches,
  cleanVoiceRate,
  cleanSpeakerRates,
  rateForCue,
  syllableTarget,
  writeEffort,
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
 * where the speaker stops for HARD_ANCHOR_GAP_SECONDS or more ("split"),
 * the same pauses Sync treats as hard anchors (syncUnits.js). Shorter pauses
 * don't bind the wording. Code then cuts each sentence onto its cues: at the
 * "‖" marks first, the rest by each cue's share of the speaking time, at a
 * nearby comma where there is one. No word is changed by the cut.
 *
 * Checks are fewer and run together, for speed: length, sentence ends,
 * numbers, key terms, bookish words and the "‖" count are counted in code;
 * one meaning review reads the batch; one fix call takes everything found.
 * Timings are never sent to the model, only the syllable budgets.
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
export const buildNaturalUnits = (cues, { hardPause = HARD_ANCHOR_GAP_SECONDS, maxJoinGap = MAX_JOIN_GAP } = {}) => {
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

/** How many "‖" a line has. */
const marks = (line) => String(line ?? '').split(PAUSE_SPLIT).length - 1;

/** The line kept from a model answer: `split` when it has the same words as `natural`, else `natural`. */
export const readNaturalLine = (item) => {
  const natural = String(item?.natural ?? item?.translatedText ?? '').trim();
  const split = String(item?.split ?? '').trim();
  if (split && (!natural || bare(split.split(PAUSE_SPLIT).join(' ')) === bare(natural))) return split;
  return natural || split;
};

/** What is off with each unit's line: everything cueIssues finds, plus a wrong "‖" count. */
export const naturalIssues = (units, lines) => {
  const issues = cueIssues(units, lines);
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

export const buildNaturalPrompt = ({ batch, sourceLanguage, targetLanguage, customPrompt, before = [], after = [], terms = [], brief = null }) => {
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
3. Never change the meaning while doing it: every idea, example, condition, negation, number, name, who does what to whom, the tense and the certainty stay exactly as in the English. Add nothing the speaker did not say, and drop nothing.
4. Follow the speaker's rhythm: short bursts stay short, a restart or a trailing thought stays. Punctuate for the ear: commas where the speaker breathes, "?" and "!" where the voice rises, "…" only for a real hesitation.
5. Write out what a voice would stumble on: no digits, abbreviations, symbols or brackets (numbers as they are said). Sound notes in square brackets such as [laughs] are copied exactly, in English, where they stand.
${examples ? `\n${examples}\n(These examples show cue lines; here you write the whole sentence, so the same idea applies to the whole sentence.)\n` : ''}${marked ? `
MARKS IN THE ENGLISH
- "${PAUSE_SPLIT}" is where the speaker stops for over a second; the dub voice stops at the same moments, so before each stop it should be saying what the speaker said before it.
- "${SOFT_SPLIT}" is where a subtitle line ends while the speaker talks on. It only says where the line breaks: it never binds the wording.
- "split" is "natural" again, with exactly the same words in the same order, plus the same marks as the English, the same number of each in the same order. Put each "${PAUSE_SPLIT}" where what comes before it says what came before it in the English, as near as ${targetLanguage}'s order allows. Put each "${SOFT_SPLIT}" at the natural phrase break nearest to the same point of the meaning, never between a word and its postposition, case ending or helping verb, never inside a name or a fixed phrase, and never inside a pair joined by "and" or "or" ("fear and resistance", "a mantra or a god"), also when the language marks the pair on both words instead of with a word between them: the whole pair stays on one side, even if that moves the mark a few words.
- Write "natural" first, freely; then place the marks. Never reword "natural" to make a mark fit. If the language's order moves an idea across a mark, put the mark at the nearest natural phrase break.
- Each piece between marks must be a phrase that can stand on its own line. Never fill a piece with a word the speaker did not say.
- A sentence without marks gets "split" equal to "natural".
` : ''}${sized ? `
LENGTH FOR THE VOICE
"syllables" is about how many ${targetLanguage} syllables the voice says in the time the speaker took for the whole sentence (stops not counted); "partSyllables" splits it over the pieces between stops. ${targetLanguage} usually takes longer than English, so this is often tight.
- Stay close to it: a little under is better than over; far under leaves the voice silent while the speaker talks.
- Reach it by word choice: shorter everyday words, a leaner sentence, dropping a filler the speaker did not stress. Never by dropping meaning, never by swapping a word for one that means something else, never by padding.
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
const translateUnitBatch = async (batch, { generate, sourceLanguage, targetLanguage, customPrompt, before, after, terms, brief, apiKey, models }) => {
  const ids = batch.map((u) => u.id);
  const written = await writeBatch(generate, buildNaturalPrompt({ batch, sourceLanguage, targetLanguage, customPrompt, before, after, terms, brief }), ids, { apiKey, models });
  let lines = written.lines;
  const known = mergeTerms(terms, written.terms, lines);

  const plain = new Map([...lines].map(([id, line]) => [id, withoutSoft(line)]));
  const review = askJson(generate, buildMeaningReviewPrompt({ cues: batch, translations: plain, targetLanguage }), { apiKey, models, temperature: 0, effort: CHECK_EFFORT })
    .then(({ parsed }) => readMeaningIssues(parsed, ids))
    .catch((err) => {
      logger.warn(`Natural translation meaning check skipped: ${err?.message || err}`);
      return [];
    });
  const counted = [...naturalIssues(batch, lines), ...termIssues(batch, lines, known), ...bookishIssues(batch, lines, targetLanguage, known)];
  const meaning = (await review).flatMap((p) => p.ids.map((id) => ({ id, kind: 'meaning', problem: p.problem })));
  const issues = [...meaning, ...counted];
  let fixed = 0;
  if (issues.length) {
    try {
      // Each sentence stands alone, so the fix call reads only the sentences it has to change.
      const flagged = new Set(issues.map((issue) => issue.id));
      const toFix = batch.filter((u) => flagged.has(u.id));
      const { parsed } = await askJson(generate, buildFixPrompt({ cues: toFix, translations: lines, issues, targetLanguage, customPrompt, brief }), { apiKey, models, temperature: 0.3, effort: CHECK_EFFORT });
      const changes = readFix(parsed, ids);
      const meant = new Set(meaning.map((m) => m.id));
      const next = new Map(lines);
      for (const [id, line] of changes) {
        const unit = batch.find((u) => u.id === id);
        const was = lines.get(id) ?? '';
        if (unit.pauses.length && marks(line) !== unit.pauses.length && marks(was) === unit.pauses.length) continue;
        if (unitScore(unit, line) <= unitScore(unit, was) + (meant.has(id) ? 3 : 0)) {
          next.set(id, line);
          fixed += 1;
        }
      }
      lines = next;
    } catch (err) {
      logger.warn(`Natural translation fix skipped: ${err?.message || err}`);
    }
  }
  return { lines, modelUsed: written.modelUsed, terms: written.terms, fixed, found: issues.length, meaning: meaning.length };
};

/**
 * Translates `cues` sentence by sentence and cuts each sentence back onto its
 * cues. Takes the same options as translateCueTexts (no resume) and returns
 * the same shape: `translations` (cue id → line), `pausedTexts` (only cues a
 * hard pause falls inside), `modelUsed`, `missingIds`, `failedBatches`, plus
 * `units` (each sentence's line, for checking) and `fixed` / `found` counts.
 */
export const translateNatural = async (
  cues,
  { sourceLanguage = '', targetLanguage, customPrompt = '', apiKey, models, onProgress, voiceRate, speakerRates, speakerGenders, generate = generateText, batchSize = NATURAL_BATCH } = {}
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

  let terms = [];
  let brief = null;
  if (batches.length > 1) {
    say('Reading the whole talk for its key terms and tone...', { batch: 1 });
    ({ terms, brief } = await readGlossary(sized, { sourceLanguage, targetLanguage, customPrompt, apiKey, models, generate, effort: CHECK_EFFORT }));
  }

  const lines = new Map();
  let modelUsed = null;
  let failedBatches = 0;
  let firstError = null;
  let fixed = 0;
  let found = 0;
  let done = 0;
  let stopped = false;
  const queue = batches.map((batch, index) => ({ batch, index }));
  say(`Writing ${units.length} sentences in ${targetLanguage}...`, { batch: 1 });
  const worker = async () => {
    while (queue.length && !stopped) {
      const { batch } = queue.shift();
      const at = units.indexOf(batch[0]);
      const before = units.slice(Math.max(0, at - CONTEXT_UNITS), at).map((u) => ({ text: u.text, line: lines.get(u.id) }));
      const after = units.slice(at + batch.length, at + batch.length + CONTEXT_UNITS).map((u) => ({ text: u.text }));
      try {
        const out = await translateUnitBatch(batch, { generate, sourceLanguage, targetLanguage, customPrompt, before, after, terms, brief, apiKey, models });
        modelUsed = out.modelUsed ?? modelUsed;
        terms = mergeTerms(terms, out.terms, out.lines);
        for (const [id, line] of out.lines) lines.set(id, line);
        fixed += out.fixed;
        found += out.found;
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
    const line = lines.get(unit.id);
    if (!line) continue;
    const cut = cutUnit(unit, line);
    unit.cues.forEach((cue, i) => {
      if (cut.lines[i]) translations.set(cue.id, cut.lines[i]);
      if (cut.paused[i] && stripPauses(cut.paused[i]) === cut.lines[i]) pausedTexts.set(cue.id, cut.paused[i]);
    });
    unitLines.push({ id: unit.id, cueIds: unit.cues.map((c) => c.id), english: unit.text, line, syllables: unit.syllables, said: dubSyllables(line) });
  }
  const missingIds = sized.filter((cue) => !translations.has(cue.id)).map((cue) => cue.id);
  logger.info(`Natural translation: ${units.length} sentences over ${sized.length} cues; ${found} issue(s) found, ${fixed} line(s) fixed.`);
  return { translations, pausedTexts, modelUsed, translatedCount: translations.size, missingIds, failedBatches, terms, brief, units: unitLines, fixed, found };
};
