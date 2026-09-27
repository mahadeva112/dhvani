import { config } from '../../env.js';
import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { parseJsonResponse } from './client.js';
import { generateText } from '../textModel.js';
import {
  isThreeStepPrompt,
  supportsThreeStep,
  extraInstructions,
  translateCueTextsThreeStep,
} from './threeStepTranslation.js';
import { alignScript } from '../../lib/scriptAlign.js';

/**
 * Gemini translation.
 *
 * Cues are sent to the model as `{ id, text }` pairs only. No start time, end
 * time or duration ever appears in a prompt, so the model has nothing to shift
 * even if it tried. Results are merged back by id; a cue the model drops keeps
 * its previous text rather than collapsing the list and breaking cue order.
 */

const chunk = (items, size) => {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
};

const buildPrompt = ({ batch, sourceLanguage, targetLanguage, customPrompt, batchIndex, batchCount }) => {
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

SPOKEN, NOT WRITTEN
These lines will be spoken aloud by a voice as a dub, and must sound like a person talking, not someone reading a text.
- Write the ${targetLanguage} people actually speak: everyday words and sentence shapes, not bookish, literary or officialese vocabulary. Where a common spoken word exists, prefer it over a rare formal one. Keep the English words a ${targetLanguage} speaker would naturally say in English.
- Follow the speaker's own rhythm: if they speak in short bursts, restart a sentence or trail off, keep that; do not smooth speech into polished prose.
- Punctuate for the ear: commas where the speaker breathes, "?" and "!" where their voice rises, "…" where a thought trails off.
- Write out anything a voice would stumble on: no abbreviations, symbols, brackets or slashes; numbers as they are said.
The style directive above still sets the tone (formal, witty, cinematic...) — this only makes it sound spoken.

HARD RULES
1. Return exactly one translation for every input id. Never merge, split, drop or reorder cues.
2. Copy each "id" back verbatim.
3. Translate the text only. Never output timestamps, cue numbers or timing of any kind.
4. Read the cues as consecutive lines of one conversation so pronouns and continuations stay coherent across cue boundaries.
5. If a cue is a fragment of a sentence continued in the next cue, translate it as that fragment — do not borrow words from neighbouring cues.
6. If a cue cannot be translated, return its original text unchanged rather than an empty string.

INPUT CUES (JSON):
${JSON.stringify(batch.map(({ id, text }) => ({ id, text })), null, 2)}

Respond with ONLY this JSON:
{"translations":[{"id":"<the same id>","translatedText":"<${targetLanguage} translation>"}]}`;
};

const translateBatch = async ({ batch, sourceLanguage, targetLanguage, customPrompt, batchIndex, batchCount, apiKey, models }) => {
  const { response, modelUsed } = await generateText({
    contents: {
      role: 'user',
      parts: [
        {
          text: buildPrompt({ batch, sourceLanguage, targetLanguage, customPrompt, batchIndex, batchCount }),
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

  return { result, modelUsed };
};

/**
 * Translates cue texts, batching long transcripts so a single request never
 * grows unbounded.
 *
 * @returns {Promise<{translations: Map<string,string>, modelUsed: string|null,
 *   translatedCount: number, missingIds: string[], failedBatches: number}>}
 */
export const translateCueTexts = async (
  cues,
  { sourceLanguage = '', targetLanguage, customPrompt = '', apiKey, models, batchSize, onProgress } = {}
) => {
  if (!targetLanguage) {
    throw new ApiError('No target language was selected for translation.', {
      status: 400,
      code: 'missing_target_language',
    });
  }

  // The 3-step preset runs the per-language prompt files instead of the
  // one-shot prompt below; it needs the cue timings, so it gets the raw cues.
  if (isThreeStepPrompt(customPrompt)) {
    if (supportsThreeStep(targetLanguage)) {
      return translateCueTextsThreeStep(cues, { targetLanguage, customPrompt, apiKey, models, onProgress });
    }
    // It is the default style, so a language without prompt files falls back
    // to the one-shot translation, keeping only the user's own additions.
    logger.warn(`No 3-step prompts for ${targetLanguage}; using the standard translation instead.`);
    customPrompt = extraInstructions(customPrompt);
  }

  const translatable = cues
    .map((cue) => ({ id: String(cue.id), text: String(cue.text ?? '').trim() }))
    .filter((cue) => cue.text.length > 0);

  if (translatable.length === 0) {
    return { translations: new Map(), modelUsed: null, translatedCount: 0, missingIds: [], failedBatches: 0 };
  }

  const batches = chunk(translatable, Math.max(5, batchSize || config.translationBatchSize));
  const translations = new Map();
  let modelUsed = null;
  let failedBatches = 0;

  for (const [batchIndex, batch] of batches.entries()) {
    onProgress?.({
      stage: 'translating',
      batch: batchIndex + 1,
      batchCount: batches.length,
      message: `Translating cues ${batchIndex * batch.length + 1}-${batchIndex * batch.length + batch.length} of ${translatable.length} to ${targetLanguage}...`,
    });

    try {
      const outcome = await translateBatch({
        batch,
        sourceLanguage,
        targetLanguage,
        customPrompt,
        batchIndex,
        batchCount: batches.length,
        apiKey,
        models,
      });
      modelUsed = outcome.modelUsed;
      for (const [id, text] of outcome.result) translations.set(id, text);
    } catch (err) {
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

  return {
    translations,
    modelUsed,
    translatedCount: translations.size,
    missingIds,
    failedBatches,
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
  { pastedScript, targetLanguage, apiKey, models, extraRules = '', onProgress, isCancelled } = {}
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
