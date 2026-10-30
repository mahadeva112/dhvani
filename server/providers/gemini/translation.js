import { config } from '../../env.js';
import { ApiError, isTimeoutError } from '../../errors.js';
import { logger } from '../../logger.js';
import { parseJsonResponse } from './client.js';
import { generateText } from '../textModel.js';
import { alignScript } from '../../lib/scriptAlign.js';
import { scriptOf } from '../../lib/languages.js';
import {
  cueIssues,
  longIssues,
  issueScore,
  isOutlier,
  mergeTerms,
  termsBlock,
  termIssues,
  buildFixPrompt,
  buildMeaningReviewPrompt,
  buildMeaningFixPrompt,
  readMeaningIssues,
  readFix,
  MAX_TERMS,
} from '../../lib/translationChecks.js';
import { cuePauses, partSyllables, readPausedLine, withoutSplits, PAUSE_SPLIT } from '../../lib/translationPauses.js';

/**
 * Gemini translation.
 *
 * Cues are sent to the model as `{ id, text }` pairs only. No start time, end
 * time or duration ever appears in a prompt, so the model has nothing to shift
 * even if it tried. When the dub voice's speaking rate is known, each cue also
 * carries a syllable count: how many syllables that voice says in the time the
 * original speaker took, a length to aim for, never a time. Results are
 * merged back by id; a cue the model drops keeps its previous text rather
 * than collapsing the list and breaking cue order.
 */

const chunk = (items, size) => {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
};

/** Speaking rates outside this range (syllables a second) are not believable, and are not sent. */
const MIN_VOICE_RATE = 2.5;
const MAX_VOICE_RATE = 9;

/** A believable voice rate in syllables a second, or null. */
export const cleanVoiceRate = (value) => {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= MIN_VOICE_RATE && rate <= MAX_VOICE_RATE ? rate : null;
};

/** Believable rates of the voices speakers have of their own, by speaker name. */
export const cleanSpeakerRates = (value) =>
  Object.fromEntries(
    Object.entries(value && typeof value === 'object' ? value : {})
      .filter(([speaker]) => speaker.length <= 128)
      .map(([speaker, rate]) => [speaker, cleanVoiceRate(rate)])
      .filter(([, rate]) => rate !== null)
  );

/** The rate of the voice that speaks `cue`: its speaker's own, else the main voice's `rate`. */
export const rateForCue = (cue, rate, speakerRates = {}) => speakerRates[cue.speaker || 'Speaker'] ?? rate;

/**
 * Syllables the voice says at `rate` in the time the speaker took for `cue`,
 * or null without timings. `silent` seconds of it are pauses the dub keeps
 * (translationPauses.js): the voice is quiet then too, so they are not time
 * to talk in.
 */
export const syllableTarget = (cue, rate, silent = 0) => {
  const seconds = Number(cue.endTime) - Number(cue.startTime) - silent;
  return rate && seconds > 0 ? Math.max(1, Math.round(seconds * rate)) : null;
};

const lengthDirective = (targetLanguage) => `LENGTH FOR THE VOICE
Each cue has a "syllables" number: about how many ${targetLanguage} syllables the dub voice says in the time the original speaker took for that cue. ${targetLanguage} usually takes longer to say than English, so this is often tight.
- Keep each cue's own translation close to its own number: a little under is better than over, but far under is wrong too, because the voice then falls silent while the speaker is still talking. A sentence that fits in total but crowds one cue does not fit.
- Reach it through word choice: shorter everyday words, a tighter sentence shape, dropping filler the speaker did not stress.
- Never leave out meaning to reach it: the idea, the emphasis, a negation, a number or a name always stays. Never swap a word for a shorter one that means something else (a narrower, broader or different kind of word: "beings" are not "people", "emperors" are not "kings"), and never fold a deliberate pair ("controlled and ruled") into one word. If the meaning needs more syllables, keep the meaning.
- Never pad a short cue with words the speaker did not say. A very short cue (a word or two) takes the last word or words of its sentence, even if that runs a little long; it never gets a filler word of its own.
- A clear, natural line a little over is better than a line squeezed until it is unclear, and never invert the language's normal word order to save syllables.`;

const pauseDirective = (targetLanguage) => `PAUSES
A "${PAUSE_SPLIT}" in a cue's text is where the speaker stopped for a moment inside that cue. The dub voice stops at the same places, so its line stays with the speaker:
- Put a "${PAUSE_SPLIT}" in your translation of that cue at the matching place: the same number of "${PAUSE_SPLIT}" as the English cue, in the same order, each between the same two ideas, so what comes before each "${PAUSE_SPLIT}" says what came before it in the English.
- Each piece between the marks is a natural spoken phrase that can stand before a short silence. "partSyllables" is about how many syllables each piece has time for.
- If ${targetLanguage}'s own word order cannot keep a pause where the English has it without sounding unnatural, leave out every "${PAUSE_SPLIT}" of that cue. Never bend the word order to keep one.
- Never put a "${PAUSE_SPLIT}" in a cue that has none, and never mark a pause any other way: no "…" and no extra comma for it.`;

/** Lines around a batch, read for context only: the end of the batch before (with how it was translated) and the start of the next. */
const contextBlock = (before = [], after = []) => {
  if (!before.length && !after.length) return '';
  const lines = [];
  if (before.length) {
    lines.push('Just before these cues (translated in another part, do not translate again):');
    for (const cue of before) lines.push(cue.translatedText ? `- "${cue.text}" → "${withoutSplits(cue.translatedText)}"` : `- "${cue.text}"`);
  }
  if (after.length) {
    lines.push('Just after these cues (translated in the next part, do not translate now):');
    for (const cue of after) lines.push(`- "${cue.text}"`);
  }
  return `\nCONTEXT\n${lines.join('\n')}\n`;
};

/** A cue as the model reads it: its text with "‖" where the speaker paused, and the syllables it (and each piece) has time for. */
const promptCue = ({ id, text, pausedText, syllables, partSyllables: parts }) => ({
  id,
  text: pausedText ?? text,
  ...(syllables && { syllables }),
  ...(parts && { partSyllables: parts }),
});

const buildPrompt = ({ batch, sourceLanguage, targetLanguage, customPrompt, batchIndex, batchCount, before, after, terms = [] }) => {
  const sized = batch.some((cue) => cue.syllables);
  const paused = batch.some((cue) => cue.pausedText);
  const styleDirective = customPrompt?.trim()
    ? `TRANSLATION STYLE & PERSONA DIRECTIVE (follow strictly):\n${customPrompt.trim()}`
    : `TRANSLATION STYLE:\nNatural, idiomatic, context-aware ${targetLanguage}. Preserve meaning, register and emotional tone. Do not translate proper nouns or established technical/brand terms.`;

  const sourceNote = sourceLanguage && sourceLanguage !== 'Auto Detect'
    ? `The source language is ${sourceLanguage}.`
    : 'Infer the source language from the text itself.';

  const script = scriptOf(targetLanguage);

  return `You are a professional dubbing translator working on part ${batchIndex + 1} of ${batchCount} of one continuous transcript.

${sourceNote}
Translate every cue below into ${targetLanguage}.${script ? ` Write every line, and every key term, in the ${script} script only, never in another script.` : ''}

${styleDirective}

MEANING, NOT WORDS
- Translate sentences, not cues and not words. A sentence often runs across two or three cues: read all of it, understand what it means, then say that the way a native ${targetLanguage} speaker would say it out loud, in ${targetLanguage}'s own word order.
- Never copy the English word order or sentence shape, and never translate a cue's English words one by one.
- Rebuild each sentence the way ${targetLanguage} builds it, by whole phrases and clauses, not by moving single words:
  - A trailing "which / who / where / that" part goes where ${targetLanguage} puts it: before the word it describes, or as a sentence of its own ("a crazy thing where somebody is consciously going mad" can become "Bhakti is madness. Here a person goes mad knowingly.").
  - "realized that…", "said that…", "it doesn't matter whether X or Y", "isn't it?" and words like "just", "only", "even" take ${targetLanguage}'s own construction, particle or tag and its place for them, not the English one.
  - Moving a part never changes who does what to whom, what a word describes, how the clauses relate (because, if, although, but), the tense, a negation or the certainty.
  - This changes the shape, never the register: build it from the same everyday spoken forms a person uses talking, not the standard written ones.
- Then split your sentence over the same cues, so each cue holds about what can be said in that cue's time.
- A word may land in a different cue than its English counterpart (in ${targetLanguage} the verb may come at the end while English has it early). That is expected. Move words only to the next or previous cue of the same sentence, never further.
- Each cue's part must be a natural spoken phrase, not a broken fragment.
- A cue that holds only the last word or two of an English sentence ("situation.", "happen.") gets the last word or words of your sentence, often its verb. Never a word of its own, never a repeat of what came before: the sentence read across its cues must say it once, as one sentence.
- A sentence ends ("।", ".", "?", "!") in the same cue the English sentence ends in. A cue that ends mid-sentence in English does not end the sentence in ${targetLanguage}.

SPOKEN, NOT WRITTEN
These lines will be spoken aloud by a voice as a dub, and must sound like a person talking, not someone reading a text.
- Write the ${targetLanguage} people actually speak: everyday words and sentence shapes, not bookish, literary or officialese vocabulary. Where a common spoken word exists, prefer it over a rare formal one. Keep the English words a ${targetLanguage} speaker would naturally say in English.
- Follow the speaker's own rhythm: if they speak in short bursts, restart a sentence or trail off, keep that; do not smooth speech into polished prose.
- Punctuate for the ear: commas where the speaker breathes, "?" and "!" where their voice rises, "…" where a thought trails off.
- Write out anything a voice would stumble on: no abbreviations, symbols, brackets or slashes; numbers as they are said.
The style directive above still sets the tone (formal, witty, cinematic...) — this only makes it sound spoken.
${sized ? `\n${lengthDirective(targetLanguage)}\n` : ''}${paused ? `\n${pauseDirective(targetLanguage)}\n` : ''}${contextBlock(before, after)}${termsBlock(terms)}
HARD RULES
1. Return exactly one translation for every input id. Never merge, split, drop or reorder cues, and never leave a cue empty.
2. Copy each "id" back verbatim.
3. Translate the text only. Never output timestamps, cue numbers or timing of any kind.
4. Read the cues as consecutive lines of one conversation so pronouns and continuations stay coherent across cue boundaries.
5. Together, the cues of a sentence say everything the English sentence says, and nothing more: no idea dropped, none added.
6. If a cue cannot be translated, return its original text unchanged rather than an empty string.
7. Sound notes in square brackets, such as [laughs] or [applause], are not speech: copy each one exactly as it is, in English, where it stands. Never translate, drop or add one.

INPUT CUES (JSON):
${JSON.stringify(batch.map(promptCue), null, 2)}

KEY TERMS
A key term (a concept, a name, a technical word; not everyday words) that comes up more than once is said with the same ${targetLanguage} word each time. After translating, list up to 6 key terms of these cues that may come back later in the talk, each with the exact ${targetLanguage} word your translation used for it.

Respond with ONLY this JSON:
{"translations":[{"id":"<the same id>","translatedText":"<${targetLanguage} translation>"}],"terms":[{"english":"<key term>","translated":"<the ${targetLanguage} word used>"}]}`;
};

const translateBatchOnce = async ({ batch, sourceLanguage, targetLanguage, customPrompt, batchIndex, batchCount, before, after, terms, apiKey, models, generate = generateText }) => {
  const { response, modelUsed } = await generate({
    contents: {
      role: 'user',
      parts: [
        {
          text: buildPrompt({ batch, sourceLanguage, targetLanguage, customPrompt, batchIndex, batchCount, before, after, terms }),
        },
      ],
    },
    generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
    models,
    apiKey,
  });

  const parsed = parseJsonResponse(response.text, 'Gemini translation');
  // Some models answer with the bare array instead of the wrapping object;
  // reading only `translations` silently dropped the whole batch.
  const list = Array.isArray(parsed?.translations) ? parsed.translations : Array.isArray(parsed) ? parsed : [];
  if (list.length === 0) {
    throw new ApiError('The translation came back without any cues.', {
      status: 502,
      code: 'bad_model_output',
      retryable: true,
    });
  }

  const result = new Map();
  for (const item of list) {
    if (item?.id === undefined) continue;
    const text = String(item.translatedText ?? item.text ?? '').trim();
    if (text) result.set(String(item.id), text);
  }

  return { result, modelUsed, terms: Array.isArray(parsed?.terms) ? parsed.terms : [] };
};

/**
 * A model now and then answers with broken or empty JSON; asked again it
 * almost always answers properly. Without this one retry the whole batch
 * stayed in English, and a one-batch translation failed.
 */
const translateBatch = async (options) => {
  try {
    return await translateBatchOnce(options);
  } catch (err) {
    if (err?.code !== 'bad_model_output') throw err;
    logger.warn(`Translation batch ${options.batchIndex + 1} came back unreadable; asking once more.`);
    return translateBatchOnce(options);
  }
};

/**
 * A prompt saved from the removed 3-Step style ("#pipeline: 3-step" and its
 * "#" note lines) sent by a caller that hasn't moved to a current style: only
 * the user's own lines below the notes are kept as the style directive.
 */
const THREE_STEP_MARKER = /^\s*#\s*pipeline\s*:\s*3-step\b/i;
export const withoutThreeStepNotes = (prompt = '') =>
  THREE_STEP_MARKER.test(prompt)
    ? String(prompt)
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n')
        .trim()
    : prompt;

/** One JSON answer from the text model, for the checks after a translation. */
const askJson = async (prompt, { apiKey, models, temperature, generate = generateText }) => {
  const { response } = await generate({
    contents: { role: 'user', parts: [{ text: prompt }] },
    generationConfig: { responseMimeType: 'application/json', temperature },
    models,
    apiKey,
  });
  return parseJsonResponse(response.text, 'Translation check');
};

/**
 * Checks a translated batch and fixes what it can, once each:
 * 1. Meaning: a separate strict review, sentence by sentence and key word by
 *    key word, against the English. Cues it flags get one correction, in
 *    natural wording, never by going back to word for word.
 * 2. Length and sentence ends, counted in code (translationChecks.js). Cues
 *    that miss go back to the model with the counts; the fix is kept only
 *    when it leaves the batch closer to right, and it must keep every idea.
 *    Cues still long after that go back once more, on their own.
 * 3. Key terms: a cue that says one of `terms` (the talk's key terms so far)
 *    with another word is asked to use the listed word.
 * A check that fails (the model unreachable or its answer unreadable) leaves
 * the translation as it was: the checks only ever improve it.
 *
 * @returns {Promise<{translations: Map<string,string>, lengthFixed: number, meaningFixed: number, termsFixed: number}>}
 */
export const refineBatch = async (batch, translated, { targetLanguage, customPrompt = '', terms = [], apiKey, models, ask = askJson } = {}) => {
  let translations = new Map(translated);
  const ids = batch.map((cue) => cue.id);
  let lengthFixed = 0;
  let meaningFixed = 0;

  try {
    const review = await ask(buildMeaningReviewPrompt({ cues: batch, translations, targetLanguage }), { apiKey, models, temperature: 0 });
    const problems = readMeaningIssues(review, ids);
    if (problems.length) {
      const answer = await ask(buildMeaningFixPrompt({ cues: batch, translations, problems, targetLanguage, customPrompt }), { apiKey, models, temperature: 0.2 });
      const changes = readFix(answer, ids);
      if (changes.size) {
        translations = new Map([...translations, ...changes]);
        meaningFixed = changes.size;
      }
    }
  } catch (err) {
    logger.warn(`Translation meaning check skipped: ${err?.message || err}`);
  }

  // Length last, so a word the meaning check put back is fitted to the time
  // too. The second pass sends back only the cues still long after the first.
  for (const find of [cueIssues, longIssues]) {
    const issues = find(batch, translations);
    if (!issues.length) continue;
    try {
      const answer = await ask(buildFixPrompt({ cues: batch, translations, issues, targetLanguage, customPrompt }), { apiKey, models, temperature: 0.3 });
      const changes = readFix(answer, ids);
      const fixed = new Map([...translations, ...changes]);
      if (changes.size && issueScore(batch, fixed) < issueScore(batch, translations)) {
        translations = fixed;
        lengthFixed += changes.size;
      }
    } catch (err) {
      logger.warn(`Translation length check skipped: ${err?.message || err}`);
    }
  }

  // Key terms last: a cue that says one of the talk's terms with another word
  // gets the listed word, kept only when it fits as well as before.
  let termsFixed = 0;
  const offTerms = termIssues(batch, translations, terms);
  if (offTerms.length) {
    try {
      const answer = await ask(buildFixPrompt({ cues: batch, translations, issues: offTerms, targetLanguage, customPrompt }), { apiKey, models, temperature: 0.2 });
      const changes = readFix(answer, ids);
      const fixed = new Map([...translations, ...changes]);
      if (changes.size && termIssues(batch, fixed, terms).length < offTerms.length && issueScore(batch, fixed) <= issueScore(batch, translations)) {
        translations = fixed;
        termsFixed = changes.size;
      }
    } catch (err) {
      logger.warn(`Translation key-term check skipped: ${err?.message || err}`);
    }
  }

  return { translations, lengthFixed, meaningFixed, termsFixed };
};

/** Lines of context on each side of a batch, so a sentence cut by a batch boundary still reads whole. */
const CONTEXT_CUES = 2;

/** The fewest cues a batch is sent with, also when a timed-out batch is cut smaller. */
const MIN_BATCH = 5;

/** Batches a fast translation sends at once. */
export const FAST_PARALLEL = 3;

/** True when every cue of a batch already has its translation. */
const isDone = (batch, translations) => batch.every((cue) => translations.has(cue.id));

/** The translations, terms and model of a run being resumed, kept to the cues still asked for. */
const resumeState = (resumeFrom, translatable) => {
  const saved = resumeFrom?.translations || {};
  const translations = new Map();
  for (const cue of translatable) {
    if (typeof saved[cue.id] === 'string') translations.set(cue.id, saved[cue.id]);
  }
  return {
    translations,
    terms: Array.isArray(resumeFrom?.terms) ? resumeFrom.terms : [],
    modelUsed: resumeFrom?.modelUsed ?? null,
  };
};

/**
 * Fast translation: one model call a batch, no checks, FAST_PARALLEL batches
 * at a time. A batch sees the source text around it, and the key terms of
 * the batches already done; a batch that times out is sent again in halves.
 */
const translateBatchesFast = async (batches, translatable, { sourceLanguage, targetLanguage, customPrompt, apiKey, models, onProgress, generate, resumeFrom, onBatchDone }) => {
  const { translations, terms: resumedTerms, modelUsed: resumedModel } = resumeState(resumeFrom, translatable);
  let modelUsed = resumedModel;
  let failedBatches = 0;
  let terms = resumedTerms;
  let finished = 0;
  let cuesDone = 0;
  let firstError = null;

  const sendOne = async (batch, batchIndex) => {
    const position = translatable.indexOf(batch[0]);
    const before = translatable.slice(Math.max(0, position - CONTEXT_CUES), position).map((cue) => ({ text: cue.text, translatedText: translations.get(cue.id) }));
    const after = translatable.slice(position + batch.length, position + batch.length + CONTEXT_CUES).map((cue) => ({ text: cue.text }));
    try {
      const outcome = await translateBatch({ batch, sourceLanguage, targetLanguage, customPrompt, batchIndex, batchCount: batches.length, before, after, terms, apiKey, models, generate });
      modelUsed = outcome.modelUsed;
      terms = mergeTerms(terms, outcome.terms, outcome.result);
      for (const [id, text] of outcome.result) translations.set(id, text);
      onBatchDone?.({ translations, terms, modelUsed });
    } catch (err) {
      if (isTimeoutError(err) && batch.length > MIN_BATCH) {
        const size = Math.max(MIN_BATCH, Math.ceil(batch.length / 2));
        logger.warn(`Fast translation batch ${batchIndex + 1} timed out; sending it again ${size} cues at a time.`);
        for (const part of chunk(batch, size)) await sendOne(part, batchIndex);
        return;
      }
      throw err;
    }
  };

  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batchIndex = next;
      next += 1;
      const batch = batches[batchIndex];
      try {
        // Done before a restart: kept from the saved progress, not sent again.
        if (!isDone(batch, translations)) await sendOne(batch, batchIndex);
      } catch (err) {
        failedBatches += 1;
        firstError ??= err;
        logger.error(`Fast translation batch ${batchIndex + 1}/${batches.length} failed: ${err?.message || err}`);
      }
      finished += 1;
      cuesDone += batch.length;
      onProgress?.({
        stage: 'translating',
        batch: finished + 1,
        batchCount: batches.length,
        step: 'translate',
        message: `Translated ${cuesDone} of ${translatable.length} cues to ${targetLanguage}, ${FAST_PARALLEL} batches at a time...`,
      });
    }
  };

  onProgress?.({
    stage: 'translating',
    batch: 1,
    batchCount: batches.length,
    step: 'translate',
    message: `Translating ${translatable.length} cues to ${targetLanguage}, ${FAST_PARALLEL} batches at a time...`,
  });
  await Promise.all(Array.from({ length: Math.min(FAST_PARALLEL, batches.length) }, worker));

  if (failedBatches === batches.length) throw firstError;

  const missingIds = translatable.filter((cue) => !translations.has(cue.id)).map((cue) => cue.id);
  if (missingIds.length > 0) {
    logger.warn(`${missingIds.length} cue(s) came back untranslated; keeping their source text.`);
  }

  return {
    translations,
    modelUsed,
    translatedCount: translations.size,
    missingIds,
    failedBatches,
    lengthFixed: 0,
    meaningFixed: 0,
    retriedBatches: 0,
    termsFixed: 0,
    terms,
  };
};

/** Batches a full translation (each with its checks) sends at once, after its glossary. */
export const FULL_PARALLEL = 3;

/** The most transcript text the glossary is read from: well over a two-hour talk. */
const GLOSSARY_CHARS = 200000;

const buildGlossaryPrompt = ({ translatable, sourceLanguage, targetLanguage, customPrompt }) => {
  const script = scriptOf(targetLanguage);
  let text = '';
  for (const cue of translatable) {
    if (text.length + cue.text.length > GLOSSARY_CHARS) break;
    text += `${cue.text}\n`;
  }
  return `You are preparing the glossary for a ${targetLanguage} dubbing translation of one talk, before its parts are translated at the same time by different translators.
${sourceLanguage && sourceLanguage !== 'Auto Detect' ? `The source language is ${sourceLanguage}.\n` : ''}${customPrompt?.trim() ? `\nTRANSLATION STYLE (the translators follow it):\n${customPrompt.trim()}\n` : ''}
Read the whole transcript below. List up to ${MAX_TERMS} key terms that come back more than once in it: concepts, names and technical words, not everyday words. For each, give the one ${targetLanguage} word or phrase every part will use for it: the word a native speaker would say out loud, not a bookish one. Keep a name, or a term a ${targetLanguage} speaker says in English, as they would say it.${script ? ` Write every term in the ${script} script only.` : ''}

TRANSCRIPT:
${text}
Respond with ONLY this JSON:
{"terms":[{"english":"<key term>","translated":"<the ${targetLanguage} word>"}]}`;
};

/**
 * The talk's key terms, read from the whole transcript before any batch, so
 * batches translated at once say them the same way from the first line. A
 * glossary that fails leaves the list empty: the batches still report and
 * share their own terms, as before.
 */
const readGlossary = async (translatable, { sourceLanguage, targetLanguage, customPrompt, apiKey, models, generate }) => {
  try {
    const answer = await askJson(buildGlossaryPrompt({ translatable, sourceLanguage, targetLanguage, customPrompt }), { apiKey, models, temperature: 0.2, generate });
    return mergeTerms([], answer?.terms);
  } catch (err) {
    logger.warn(`Translation glossary skipped: ${err?.message || err}`);
    return [];
  }
};

/** An error no other batch can get past: every batch after it would fail the same way. */
const stopsAll = (err) => err?.code === 'invalid_api_key' || err?.status === 401 || err?.status === 403;

/**
 * Full translation: every batch is translated and then checked (refineBatch),
 * FULL_PARALLEL batches at a time, after one call reads the whole talk for its
 * key terms (readGlossary). A batch still far too long after its checks is
 * translated once more and the better version kept. A batch that times out
 * is sent again in halves, and the batches not yet sent are cut to that size
 * too: a model that is slow on one batch is slow on all of them.
 */
const translateBatchesChecked = async (
  batches,
  translatable,
  { sourceLanguage, targetLanguage, customPrompt, apiKey, models, check, onProgress, generate, resumeFrom, onBatchDone }
) => {
  const { translations, terms: resumedTerms, modelUsed: resumedModel } = resumeState(resumeFrom, translatable);
  let modelUsed = resumedModel;
  let failedBatches = 0;
  let firstError = null;
  let lengthFixed = 0;
  let meaningFixed = 0;
  let retriedBatches = 0;
  let termsFixed = 0;
  // How the talk says its key terms, so every batch uses the same words.
  let terms = resumedTerms;

  const queue = batches.filter((batch) => !isDone(batch, translations));
  let batchCount = batches.length;
  let finished = batches.length - queue.length;

  // A run carried on after a restart keeps the terms it had; so does a talk of one batch.
  if (queue.length > 1 && !resumeFrom) {
    onProgress?.({ stage: 'translating', batch: 1, batchCount, step: 'translate', message: `Reading the whole talk for its key terms...` });
    terms = await readGlossary(translatable, { sourceLanguage, targetLanguage, customPrompt, apiKey, models, generate });
  }

  const sendOne = async (batch) => {
    const position = translatable.indexOf(batch[0]);
    const span = `${position + 1}-${position + batch.length}`;
    onProgress?.({
      stage: 'translating',
      batch: finished + 1,
      batchCount,
      step: 'translate',
      message: `Translating cues ${span} of ${translatable.length} to ${targetLanguage}...`,
    });
    const before = translatable.slice(Math.max(0, position - CONTEXT_CUES), position).map((cue) => ({ text: cue.text, translatedText: translations.get(cue.id) }));
    const after = translatable.slice(position + batch.length, position + batch.length + CONTEXT_CUES).map((cue) => ({ text: cue.text }));
    const batchIndex = Math.floor(position / Math.max(1, batch.length));
    const attempt = async () => {
      const outcome = await translateBatch({ batch, sourceLanguage, targetLanguage, customPrompt, batchIndex, batchCount, before, after, terms, apiKey, models, generate });
      modelUsed = outcome.modelUsed;
      if (!check) return { translations: outcome.result, lengthFixed: 0, meaningFixed: 0, termsFixed: 0, terms: outcome.terms };
      onProgress?.({
        stage: 'translating',
        batch: finished + 1,
        batchCount,
        step: 'check',
        message: `Checking length and meaning of cues ${span}...`,
      });
      const ask = (prompt, options) => askJson(prompt, { ...options, generate });
      const known = mergeTerms(terms, outcome.terms, outcome.result);
      const refined = await refineBatch(batch, outcome.result, { targetLanguage, customPrompt, terms: known, apiKey, models, ask });
      return { ...refined, terms: outcome.terms };
    };
    let kept = await attempt();
    // A batch still far too long after its fixes is translated once more,
    // and the better of the two is kept.
    if (check && isOutlier(batch, kept.translations)) {
      try {
        const again = await attempt();
        if (issueScore(batch, again.translations) < issueScore(batch, kept.translations)) kept = again;
        retriedBatches += 1;
      } catch (err) {
        logger.warn(`Translation of cues ${span} retry skipped: ${err?.message || err}`);
      }
    }
    lengthFixed += kept.lengthFixed;
    meaningFixed += kept.meaningFixed;
    termsFixed += kept.termsFixed;
    terms = mergeTerms(terms, kept.terms, kept.translations);
    for (const [id, text] of kept.translations) translations.set(id, text);
    onBatchDone?.({ translations, terms, modelUsed });
  };

  const worker = async () => {
    while (queue.length) {
      const batch = queue.shift();
      try {
        await sendOne(batch);
        finished += 1;
      } catch (err) {
        /*
         * A slow model can take longer to write a batch than the gateway (or
         * the proxy in front of it) waits. Asking again for the same long
         * answer times out again, so this batch and every one not yet sent
         * are cut to half the size, and this one goes first.
         */
        if (isTimeoutError(err) && batch.length > MIN_BATCH) {
          const size = Math.max(MIN_BATCH, Math.ceil(batch.length / 2));
          logger.warn(`Translation of ${batch.length} cues timed out; sending ${size} cues at a time from here on.`);
          onProgress?.({ stage: 'translating', batch: finished + 1, batchCount, step: 'translate', message: `The model is slow; sending ${size} cues at a time...` });
          const waiting = queue.splice(0, Infinity).flat();
          queue.push(...chunk(batch, size), ...chunk(waiting, size));
          batchCount = finished + queue.length + (running - 1);
          continue;
        }
        // One bad batch must not discard the batches that already succeeded.
        failedBatches += 1;
        finished += 1;
        firstError ??= err;
        logger.error(`Translation of cues ${translatable.indexOf(batch[0]) + 1}-${translatable.indexOf(batch[0]) + batch.length} failed: ${err?.message || err}`);
        if (stopsAll(err)) queue.length = 0;
      }
    }
  };
  // Workers busy on a batch, so a cut can count the batches still to come.
  let running = 0;
  const counted = async () => {
    running += 1;
    try {
      await worker();
    } finally {
      running -= 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(FULL_PARALLEL, queue.length) }, counted));

  if (failedBatches > 0 && translations.size === 0) throw firstError;

  const missingIds = translatable.filter((cue) => !translations.has(cue.id)).map((cue) => cue.id);
  if (missingIds.length > 0) {
    logger.warn(`${missingIds.length} cue(s) came back untranslated; keeping their source text.`);
  }
  if (lengthFixed || meaningFixed || retriedBatches || termsFixed) {
    logger.info(
      `Translation checks refit ${lengthFixed} cue(s) for length, restored the meaning of ${meaningFixed} and made ${termsFixed} use the talk's key term` +
        (retriedBatches ? `; ${retriedBatches} batch(es) far too long were translated again.` : '.')
    );
  }

  return {
    translations,
    modelUsed,
    translatedCount: translations.size,
    missingIds,
    failedBatches,
    lengthFixed,
    meaningFixed,
    retriedBatches,
    termsFixed,
    terms,
  };
};

/**
 * The finished lines without their "‖" marks, as the script keeps them, and
 * `pausedTexts`: each line as the voice says it, with a pause where its
 * speaker paused (translationPauses.js), or the line itself where it keeps
 * none. Only cues that came back are in either.
 */
const readBack = (translatable, translations) => {
  const clean = new Map();
  const pausedTexts = new Map();
  let kept = 0;
  let asked = 0;
  for (const cue of translatable) {
    if (!translations.has(cue.id)) continue;
    const { text, paused } = readPausedLine(translations.get(cue.id), cue.pauses);
    clean.set(cue.id, text);
    pausedTexts.set(cue.id, paused ?? text);
    if (cue.pauses) asked += 1;
    if (paused) kept += 1;
  }
  if (asked) logger.info(`Translation kept the speaker's pauses in ${kept} of ${asked} cue(s) that have them.`);
  return { translations: clean, pausedTexts };
};

/**
 * Translates cue texts, batching long transcripts so a single request never
 * grows unbounded. `voiceRate` is the dub voice's speaking rate in syllables a
 * second, when the app has measured it: each cue is then sized for that voice.
 * `speakerRates` holds the rates of the voices speakers have of their own, by
 * speaker name; their cues are sized for those. A cue whose word timestamps
 * show its speaker pausing inside it is sent with those pauses
 * (translationPauses.js), and comes back in `pausedTexts` with them as pause
 * marks for the voice; `translations` never carries them. `check` (on by
 * default) runs refineBatch on every batch: a meaning review, then length and
 * sentence ends counted in code (translateBatchesChecked). `fast` skips all
 * of that for speed: one call a batch, no checks (translateBatchesFast).
 * `onBatchDone` hears the translations so far after every finished batch,
 * and `resumeFrom` (what it last heard) skips the batches already done, so a
 * run cut off by a backend restart carries on instead of starting over.
 * `generate` stands in for the text model in tests.
 *
 * @returns {Promise<{translations: Map<string,string>, pausedTexts: Map<string,string>, modelUsed: string|null,
 *   translatedCount: number, missingIds: string[], failedBatches: number}>}
 */
export const translateCueTexts = async (
  cues,
  {
    sourceLanguage = '',
    targetLanguage,
    customPrompt = '',
    apiKey,
    models,
    batchSize,
    onProgress,
    voiceRate,
    speakerRates,
    check = true,
    fast = false,
    resumeFrom,
    onBatchDone,
    generate = generateText,
  } = {}
) => {
  if (!targetLanguage) {
    throw new ApiError('No target language was selected for translation.', {
      status: 400,
      code: 'missing_target_language',
    });
  }
  const rate = cleanVoiceRate(voiceRate);
  const ownRates = cleanSpeakerRates(speakerRates);

  customPrompt = withoutThreeStepNotes(customPrompt);

  const translatable = cues
    .map((cue) => {
      const text = String(cue.text ?? '').trim();
      const split = cuePauses({ ...cue, text });
      const silent = split ? split.pauses.reduce((sum, pause) => sum + pause, 0) : 0;
      const syllables = syllableTarget(cue, rateForCue(cue, rate, ownRates), silent);
      return {
        id: String(cue.id),
        text,
        syllables,
        ...(split && {
          pauses: split.pauses,
          pausedText: split.parts.map((part) => part.text).join(` ${PAUSE_SPLIT} `),
          ...(syllables && { partSyllables: partSyllables(split.parts, syllables) }),
        }),
      };
    })
    .filter((cue) => cue.text.length > 0);

  if (translatable.length === 0) {
    return { translations: new Map(), pausedTexts: new Map(), modelUsed: null, translatedCount: 0, missingIds: [], failedBatches: 0 };
  }

  const batches = chunk(translatable, Math.max(MIN_BATCH, batchSize || config.translationBatchSize));
  const options = { sourceLanguage, targetLanguage, customPrompt, apiKey, models, onProgress, generate, resumeFrom, onBatchDone };
  const outcome = fast ? await translateBatchesFast(batches, translatable, options) : await translateBatchesChecked(batches, translatable, { ...options, check });
  return { ...outcome, ...readBack(translatable, outcome.translations) };
};

/**
 * Places a target-language script onto existing cues by meaning. The model
 * only chooses where each cue ends, so the script comes back word for word
 * (see `server/lib/scriptAlign.js`). Cue timings are never sent or changed.
 *
 * @returns {Promise<{cues: {id: string, text: string, fit?: 'full'|'partial'|'none', estimated: boolean}[],
 *   wordCount: number, windows: number, failedWindows: number, modelUsed: string|null}>}
 */
export const alignScriptToCuesDetailed = async (
  cues,
  { pastedScript, targetLanguage, apiKey, models, extraRules = '', coverage, onProgress, isCancelled } = {}
) => {
  let modelUsed = null;
  const callModel = async (prompt) => {
    const outcome = await generateText({
      contents: { role: 'user', parts: [{ text: prompt }] },
      generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      models,
      apiKey,
    });
    modelUsed = outcome.modelUsed ?? modelUsed;
    return parseJsonResponse(outcome.response.text, 'Script alignment');
  };

  let lastFailure = null;
  try {
    const result = await alignScript(
      cues.map((cue) => ({ id: String(cue.id), text: String(cue.text ?? '') })),
      pastedScript,
      {
        callModel,
        targetLanguage,
        extraRules,
        coverage,
        onProgress,
        isCancelled,
        onWindowError: (err, { from, to }) => {
          lastFailure = err;
          logger.warn(`Script alignment for cues ${from + 1}-${to} fell back to length: ${err?.message || err}`);
        },
      }
    );
    // Every window failing means the model is unreachable, not that the
    // script is hard to place, so report that rather than a guess.
    if (lastFailure && result.failedWindows === result.windows) throw lastFailure;
    onProgress?.({ done: cues.length, total: cues.length, message: 'Every cue has its part of the script' });
    return { ...result, modelUsed };
  } catch (err) {
    if (err?.code === 'cancelled') {
      throw new ApiError('The alignment was cancelled.', { status: 499, code: 'cancelled' });
    }
    throw err;
  }
};

/** Same placement as a Map of cue id to text, for callers that only need the text. */
export const alignScriptToCues = async (cues, options = {}) => {
  if (!cues?.length || !options.pastedScript?.trim()) return new Map();
  const { cues: placed } = await alignScriptToCuesDetailed(cues, options);
  return new Map(placed.map((cue) => [cue.id, cue.text]));
};

/**
 * Repairs phonetically typed Indic text (matras, conjuncts, halants) without
 * changing its meaning.
 */
export const polishIndicText = async ({ text, targetLanguage, context, apiKey, models } = {}) => {
  if (!text?.trim()) return { originalText: text, correctedText: text, changesMade: false };

  const prompt = `You are a native ${targetLanguage} dubbing-script editor.

A phonetic typist produced the dialogue line below. It may contain wrong matras, broken conjuncts (yuktakshar), stray halants, untransliterated Roman fragments, awkward literal phrasing, or missing punctuation.

Return the line as correct, natural, idiomatic ${targetLanguage} in native script. Preserve meaning, register and emotional weight. If the line is already correct, return it with only essential punctuation refinement.

LINE:
"${text}"
${context ? `\nSURROUNDING CONTEXT: "${context}"` : ''}

Respond with ONLY this JSON:
{"correctedText":"<polished ${targetLanguage} line>","changesMade":<true|false>,"notes":"<short English note on what changed>"}`;

  const { response } = await generateText({
    contents: { role: 'user', parts: [{ text: prompt }] },
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    models,
    apiKey,
  });

  const parsed = parseJsonResponse(response.text, 'Gemini polish');
  return {
    originalText: text,
    correctedText: String(parsed.correctedText || text),
    changesMade: Boolean(parsed.changesMade),
    notes: parsed.notes || undefined,
  };
};
