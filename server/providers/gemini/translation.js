import { config } from '../../env.js';
import { ApiError, isTimeoutError } from '../../errors.js';
import { logger } from '../../logger.js';
import { parseJsonResponse } from './client.js';
import { generateText } from '../textModel.js';
import { alignScript } from '../../lib/scriptAlign.js';
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
} from '../../lib/translationChecks.js';

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

/** Syllables the voice says at `rate` in the time the speaker took for `cue`, or null without timings. */
export const syllableTarget = (cue, rate) => {
  const seconds = Number(cue.endTime) - Number(cue.startTime);
  return rate && seconds > 0 ? Math.max(1, Math.round(seconds * rate)) : null;
};

const lengthDirective = (targetLanguage) => `LENGTH FOR THE VOICE
Each cue has a "syllables" number: about how many ${targetLanguage} syllables the dub voice says in the time the original speaker took for that cue. ${targetLanguage} usually takes longer to say than English, so this is often tight.
- Keep each cue's own translation close to its own number: a little under is better than over, but far under is wrong too, because the voice then falls silent while the speaker is still talking. A sentence that fits in total but crowds one cue does not fit.
- Reach it through word choice: shorter everyday words, a tighter sentence shape, dropping filler the speaker did not stress.
- Never leave out meaning to reach it: the idea, the emphasis, a negation, a number or a name always stays. Never swap a word for a shorter one that means something else (a narrower, broader or different kind of word: "beings" are not "people", "emperors" are not "kings"), and never fold a deliberate pair ("controlled and ruled") into one word. If the meaning needs more syllables, keep the meaning.
- Never pad a short cue with words the speaker did not say. A very short cue (a word or two) takes the last word or words of its sentence, even if that runs a little long; it never gets a filler word of its own.
- A clear, natural line a little over is better than a line squeezed until it is unclear, and never invert the language's normal word order to save syllables.`;

/** Lines around a batch, read for context only: the end of the batch before (with how it was translated) and the start of the next. */
const contextBlock = (before = [], after = []) => {
  if (!before.length && !after.length) return '';
  const lines = [];
  if (before.length) {
    lines.push('Just before these cues (already translated, do not translate again):');
    for (const cue of before) lines.push(`- "${cue.text}" → "${cue.translatedText ?? ''}"`);
  }
  if (after.length) {
    lines.push('Just after these cues (translated in the next part, do not translate now):');
    for (const cue of after) lines.push(`- "${cue.text}"`);
  }
  return `\nCONTEXT\n${lines.join('\n')}\n`;
};

const buildPrompt = ({ batch, sourceLanguage, targetLanguage, customPrompt, batchIndex, batchCount, before, after, terms = [] }) => {
  const sized = batch.some((cue) => cue.syllables);
  const styleDirective = customPrompt?.trim()
    ? `TRANSLATION STYLE & PERSONA DIRECTIVE (follow strictly):\n${customPrompt.trim()}`
    : `TRANSLATION STYLE:\nNatural, idiomatic, context-aware ${targetLanguage}. Preserve meaning, register and emotional tone. Do not translate proper nouns or established technical/brand terms.`;

  const sourceNote = sourceLanguage && sourceLanguage !== 'Auto Detect'
    ? `The source language is ${sourceLanguage}.`
    : 'Infer the source language from the text itself.';

  return `You are a professional dubbing translator working on part ${batchIndex + 1} of ${batchCount} of one continuous transcript.

${sourceNote}
Translate every cue below into ${targetLanguage}.

${styleDirective}

MEANING, NOT WORDS
- Translate sentences, not cues and not words. A sentence often runs across two or three cues: read all of it, understand what it means, then say that the way a native ${targetLanguage} speaker would say it out loud, in ${targetLanguage}'s own word order.
- Never copy the English word order or sentence shape, and never translate a cue's English words one by one.
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
${sized ? `\n${lengthDirective(targetLanguage)}\n` : ''}${contextBlock(before, after)}${termsBlock(terms)}
HARD RULES
1. Return exactly one translation for every input id. Never merge, split, drop or reorder cues, and never leave a cue empty.
2. Copy each "id" back verbatim.
3. Translate the text only. Never output timestamps, cue numbers or timing of any kind.
4. Read the cues as consecutive lines of one conversation so pronouns and continuations stay coherent across cue boundaries.
5. Together, the cues of a sentence say everything the English sentence says, and nothing more: no idea dropped, none added.
6. If a cue cannot be translated, return its original text unchanged rather than an empty string.
7. Sound notes in square brackets, such as [laughs] or [applause], are not speech: copy each one exactly as it is, in English, where it stands. Never translate, drop or add one.

INPUT CUES (JSON):
${JSON.stringify(batch.map(({ id, text, syllables }) => (syllables ? { id, text, syllables } : { id, text })), null, 2)}

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

/**
 * Fast translation: one model call a batch, no checks, FAST_PARALLEL batches
 * at a time. A batch sees the source text around it, and the key terms of
 * the batches already done; a batch that times out is sent again in halves.
 */
const translateBatchesFast = async (batches, translatable, { sourceLanguage, targetLanguage, customPrompt, apiKey, models, onProgress, generate }) => {
  const translations = new Map();
  let modelUsed = null;
  let failedBatches = 0;
  let terms = [];
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
        await sendOne(batch, batchIndex);
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

/**
 * Translates cue texts, batching long transcripts so a single request never
 * grows unbounded. `voiceRate` is the dub voice's speaking rate in syllables a
 * second, when the app has measured it: each cue is then sized for that voice.
 * `speakerRates` holds the rates of the voices speakers have of their own, by
 * speaker name; their cues are sized for those. `check` (on by default)
 * runs refineBatch on every batch: a meaning review, then length and
 * sentence ends counted in code; a batch still far too long after that is
 * translated once more and the better version kept. Each batch reports how
 * it said the talk's key terms, and later batches are asked to say them the
 * same way. `fast` skips all of that for speed: one call a batch, no
 * checks, several batches at once (translateBatchesFast). `generate` stands
 * in for the text model in tests.
 *
 * @returns {Promise<{translations: Map<string,string>, modelUsed: string|null,
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
    .map((cue) => ({ id: String(cue.id), text: String(cue.text ?? '').trim(), syllables: syllableTarget(cue, rateForCue(cue, rate, ownRates)) }))
    .filter((cue) => cue.text.length > 0);

  if (translatable.length === 0) {
    return { translations: new Map(), modelUsed: null, translatedCount: 0, missingIds: [], failedBatches: 0 };
  }

  const batches = chunk(translatable, Math.max(MIN_BATCH, batchSize || config.translationBatchSize));
  if (fast) {
    return translateBatchesFast(batches, translatable, { sourceLanguage, targetLanguage, customPrompt, apiKey, models, onProgress, generate });
  }
  const translations = new Map();
  let modelUsed = null;
  let failedBatches = 0;
  let lengthFixed = 0;
  let meaningFixed = 0;
  let retriedBatches = 0;
  let termsFixed = 0;
  // How earlier batches said the talk's key terms, so later ones use the same words.
  let terms = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    // Cues in the batches before this one, for the progress message.
    const done = batches.slice(0, batchIndex).reduce((sum, earlier) => sum + earlier.length, 0);
    onProgress?.({
      stage: 'translating',
      batch: batchIndex + 1,
      batchCount: batches.length,
      step: 'translate',
      message: `Translating cues ${done + 1}-${done + batch.length} of ${translatable.length} to ${targetLanguage}...`,
    });

    try {
      const before = (batches[batchIndex - 1] ?? []).slice(-CONTEXT_CUES).map((cue) => ({ text: cue.text, translatedText: translations.get(cue.id) }));
      const after = (batches[batchIndex + 1] ?? []).slice(0, CONTEXT_CUES).map((cue) => ({ text: cue.text }));
      const attempt = async () => {
        const outcome = await translateBatch({
          batch,
          sourceLanguage,
          targetLanguage,
          customPrompt,
          batchIndex,
          batchCount: batches.length,
          before,
          after,
          terms,
          apiKey,
          models,
          generate,
        });
        modelUsed = outcome.modelUsed;
        if (!check) return { translations: outcome.result, lengthFixed: 0, meaningFixed: 0, termsFixed: 0, terms: outcome.terms };
        onProgress?.({
          stage: 'translating',
          batch: batchIndex + 1,
          batchCount: batches.length,
          step: 'check',
          message: `Checking length and meaning of cues ${done + 1}-${done + batch.length}...`,
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
          logger.warn(`Translation batch ${batchIndex + 1} retry skipped: ${err?.message || err}`);
        }
      }
      lengthFixed += kept.lengthFixed;
      meaningFixed += kept.meaningFixed;
      termsFixed += kept.termsFixed;
      terms = mergeTerms(terms, kept.terms, kept.translations);
      for (const [id, text] of kept.translations) translations.set(id, text);
    } catch (err) {
      /*
       * A slow model can take longer to write a batch than the gateway (or
       * the proxy in front of it) waits. Asking again for the same long
       * answer times out again, so this batch and every one after it are cut
       * to half the size and this one is sent again.
       */
      if (isTimeoutError(err) && batch.length > MIN_BATCH) {
        const size = Math.max(MIN_BATCH, Math.ceil(batch.length / 2));
        logger.warn(`Translation batch ${batchIndex + 1} timed out; sending ${size} cues at a time from here on.`);
        onProgress?.({
          stage: 'translating',
          batch: batchIndex + 1,
          batchCount: batches.length,
          step: 'translate',
          message: `The model is slow; sending ${size} cues at a time...`,
        });
        batches.splice(batchIndex, Infinity, ...chunk(batches.slice(batchIndex).flat(), size));
        batchIndex -= 1;
        continue;
      }
      // One bad batch must not discard the batches that already succeeded.
      failedBatches += 1;
      logger.error(
        `Translation batch ${batchIndex + 1}/${batches.length} failed: ${err?.message || err}`
      );
      if (batches.length === 1) throw err;
    }
  }

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
