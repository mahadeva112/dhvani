import { config } from '../../env.js';
import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { parseJsonResponse } from './client.js';
import { generateText } from '../textModel.js';

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

  return `You are a professional subtitle translator working on part ${batchIndex + 1} of ${batchCount} of one continuous transcript.

${sourceNote}
Translate every cue below into ${targetLanguage}.

${styleDirective}

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
  const list = Array.isArray(parsed.translations) ? parsed.translations : [];

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
 * Distributes a user-pasted target-language script across existing cues.
 * Cue timings are inputs here, never outputs.
 */
export const alignScriptToCues = async (
  cues,
  { pastedScript, targetLanguage, apiKey, models } = {}
) => {
  if (!cues?.length || !pastedScript?.trim()) return new Map();

  const prompt = `You are a subtitle alignment specialist.

A timed transcript has been split into exactly ${cues.length} cues. Below is the full ${targetLanguage} script for the same material, written as continuous prose.

Distribute the entire ${targetLanguage} script across the ${cues.length} cues so each cue's text corresponds in meaning to that cue's source text.

RULES
1. Output exactly ${cues.length} entries, one per input id, in the same order.
2. Copy each "id" back verbatim.
3. Use the whole pasted script. Do not add new content or omit sentences.
4. Never output timestamps or timing of any kind.

SOURCE CUES (JSON):
${JSON.stringify(cues.map((cue, i) => ({ id: String(cue.id), order: i + 1, sourceText: cue.text })), null, 2)}

PASTED ${targetLanguage.toUpperCase()} SCRIPT:
"""
${pastedScript.trim()}
"""

Respond with ONLY this JSON:
{"alignedCues":[{"id":"<the same id>","targetText":"<${targetLanguage} text for this cue>"}]}`;

  const { response } = await generateText({
    contents: { role: 'user', parts: [{ text: prompt }] },
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    models,
    apiKey,
  });

  const parsed = parseJsonResponse(response.text, 'Gemini alignment');
  const list = parsed.alignedCues || parsed.translations || [];

  const result = new Map();
  for (const item of list) {
    if (item?.id === undefined) continue;
    result.set(String(item.id), String(item.targetText ?? item.translatedText ?? '').trim());
  }
  return result;
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
