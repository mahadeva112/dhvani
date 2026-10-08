import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT_DIR } from '../../env.js';
import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { generateText } from '../textModel.js';
import { alignScriptToCues } from './translation.js';

/**
 * The 3-step dubbing translation, driven by the per-language prompt files in
 * `prompts/`:
 *
 *   Step 1 — Translation   English segments (with timing metadata) -> draft script
 *   Step 2 — Review        English segments + draft               -> optimized script
 *   Step 3 — Punctuation   optimized script                       -> dubbing script
 *
 * Each step returns free-form script text rather than per-cue JSON, so the
 * final script is spread back over the cues with `alignScriptToCues`. Timings
 * are only ever read here to describe the segments to the model; they are
 * never taken from a model response.
 */

export const PROMPTS_DIR = path.join(ROOT_DIR, 'prompts');

const STAGES = [
  { key: 'translation', label: 'translation', file: 'Step1_Translation_Prompt' },
  { key: 'review', label: 'review', file: 'Step2_Review_Prompt' },
  { key: 'punctuation', label: 'punctuation', file: 'Step3_Punctuation_Prompt' },
];

/** First line of the preset text that switches translation to this pipeline. */
export const THREE_STEP_MARKER = '#pipeline: 3-step';

const MARKER_PATTERN = /^\s*#\s*pipeline\s*:\s*3-step\b/im;

export const isThreeStepPrompt = (customPrompt) => MARKER_PATTERN.test(String(customPrompt || ''));

/** Lines not starting with `#` are the user's own additions, sent with Step 1. */
export const extraInstructions = (customPrompt) =>
  String(customPrompt || '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
    .trim();

/** Languages that have all three prompt files, e.g. `['Assamese', 'Bengali', ...]`. */
export const threeStepLanguages = () => {
  let files;
  try {
    files = new Set(fs.readdirSync(PROMPTS_DIR));
  } catch {
    return [];
  }
  const prefix = `${STAGES[0].file}_`;
  return [...files]
    .filter((name) => name.startsWith(prefix) && name.endsWith('.txt'))
    .map((name) => name.slice(prefix.length, -'.txt'.length))
    .filter((language) => STAGES.every((stage) => files.has(`${stage.file}_${language}.txt`)))
    .sort();
};

const promptCache = new Map();

/** `Hindi (हिन्दी)` -> `Hindi`, or undefined when that language has no prompts. */
const resolveLanguage = (targetLanguage, available = threeStepLanguages()) => {
  const wanted = String(targetLanguage || '').split('(')[0].trim().toLowerCase();
  return available.find((name) => name.toLowerCase() === wanted);
};

export const supportsThreeStep = (targetLanguage) => Boolean(resolveLanguage(targetLanguage));

/** Reads the three prompts for a language. */
const loadStagePrompts = (targetLanguage) => {
  const available = threeStepLanguages();
  const language = resolveLanguage(targetLanguage, available);

  if (!language) {
    throw new ApiError(
      `The 3-step translation has no prompts for ${targetLanguage}. ` +
        `It is available for: ${available.join(', ') || 'no languages (the prompts folder is missing)'}. ` +
        'Pick another translation style for this language.',
      { status: 400, code: 'three_step_unsupported_language' }
    );
  }

  return STAGES.map((stage) => {
    const file = path.join(PROMPTS_DIR, `${stage.file}_${language}.txt`);
    if (!promptCache.has(file)) promptCache.set(file, fs.readFileSync(file, 'utf8').trim());
    return { ...stage, language, text: promptCache.get(file) };
  });
};

/* --------------------------------------------------------------------- */
/* English segment metadata                                               */
/* --------------------------------------------------------------------- */

/** Rough English syllable count: vowel groups, less a silent trailing `e`. */
export const countSyllables = (text) =>
  String(text || '')
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter(Boolean)
    .reduce((total, word) => {
      if (word.length <= 3) return total + 1;
      const trimmed = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
      const groups = trimmed.match(/[aeiouy]{1,2}/g);
      return total + Math.max(1, groups ? groups.length : 0);
    }, 0);

const countWords = (text) => String(text || '').split(/\s+/).filter(Boolean).length;

const secs = (value) => `${value.toFixed(3)}s`;

const hasTimings = (cue) => Number(cue.endTime) > Number(cue.startTime);

/**
 * Measures every cue once, across the whole transcript, so "relative syllables
 * per second" means the same thing in every chunk.
 */
const measureCues = (cues) => {
  const measured = cues.map((cue, index) => {
    const start = Number(cue.startTime) || 0;
    const end = Number(cue.endTime) || 0;
    const next = cues[index + 1];
    const duration = Math.max(0, end - start);
    const gap = next && hasTimings(next) ? Number(next.startTime) - end : 0;
    const syllables = countSyllables(cue.text);
    return {
      ...cue,
      duration,
      gap,
      syllables,
      words: countWords(cue.text),
      rate: duration > 0 ? syllables / duration : 0,
    };
  });

  const timed = measured.filter((cue) => cue.duration > 0);
  const average = timed.length
    ? timed.reduce((sum, cue) => sum + cue.syllables, 0) / timed.reduce((sum, cue) => sum + cue.duration, 0)
    : 0;

  return measured.map((cue) => ({ ...cue, relativeRate: average > 0 ? cue.rate / average : 0 }));
};

/**
 * `[Segment duration][Gap after segment][Gap %][Total duration available]
 *  [Syllables] [Syllables per second] [Relative syllables per second] [Words] text`
 * — the layout the Step 1 and Step 2 prompts describe.
 */
export const formatEnglishSegments = (measuredCues) =>
  measuredCues
    .map((cue) => {
      if (cue.duration <= 0) return cue.text;
      const gapPercent = Math.round((cue.gap / cue.duration) * 100);
      const available = cue.duration + Math.max(0, cue.gap);
      return (
        `[${secs(cue.duration)}][${secs(cue.gap)}][${gapPercent}%][${secs(available)}] ` +
        `[${cue.syllables}] [${cue.rate.toFixed(2)}] [${cue.relativeRate.toFixed(2)}] [${cue.words}] ${cue.text}`
      );
    })
    .join('\n\n');

/**
 * Splits the transcript into chunks of about `size` cues, ending each chunk at
 * a sentence end followed by the longest pause in its last few cues so a
 * thought is not cut in half between two model calls.
 */
const chunkAtPauses = (cues, size) => {
  const chunks = [];
  let start = 0;
  while (start < cues.length) {
    let end = Math.min(cues.length, start + size);
    if (end < cues.length) {
      let best = -1;
      for (let i = end - 1; i >= Math.max(start + Math.ceil(size / 2), end - 15); i -= 1) {
        if (!/[.?!…]["')\]]*$/.test(cues[i].text)) continue;
        if (best === -1 || cues[i].gap > cues[best].gap) best = i;
      }
      if (best !== -1) end = best + 1;
    }
    chunks.push(cues.slice(start, end));
    start = end;
  }
  return chunks;
};

/* --------------------------------------------------------------------- */
/* Model calls                                                            */
/* --------------------------------------------------------------------- */

/** Strips a markdown fence the model sometimes wraps the script in. */
const cleanScript = (text) =>
  String(text || '')
    .trim()
    .replace(/^```[a-z]*\s*\n?/i, '')
    .replace(/\n?```\s*$/, '')
    .trim();

const runStage = async ({ prompt, apiKey, models, label }) => {
  const { response, modelUsed } = await generateText({
    contents: { role: 'user', parts: [{ text: prompt }] },
    generationConfig: { temperature: 0.3 },
    models,
    apiKey,
  });
  const script = cleanScript(response.text);
  if (!script) {
    throw new ApiError(`The ${label} step returned an empty script.`, {
      status: 502,
      code: 'bad_model_output',
      retryable: true,
    });
  }
  return { script, modelUsed };
};

/*
 * The Step prompts mark lines that had to be compressed with [fast]…[/fast].
 * The compression is kept but the tags are not: they would show in the cue
 * editor and ElevenLabs does not treat them as pacing. Emotion is added only
 * at dub time, when voice expression is "Expressive".
 */
export const stripPaceTags = (text) =>
  String(text || '')
    .replace(/\[\/?[a-z][a-z\s-]{0,30}\]/gi, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();

/**
 * Runs Steps 1–3 over one chunk of cues and aligns the result onto them.
 */
const translateChunk = async ({ chunk, stages, notes, targetLanguage, apiKey, models, report }) => {
  const english = formatEnglishSegments(chunk);
  const [translation, review, punctuation] = stages;
  const language = translation.language;

  report(0, `Step 1 of 3 — translating to ${language}`);
  const step1 = await runStage({
    label: translation.label,
    apiKey,
    models,
    prompt:
      `${translation.text}\n\n${english}` +
      (notes ? `\n\n---\nADDITIONAL INSTRUCTIONS (apply throughout):\n${notes}` : ''),
  });

  report(1, 'Step 2 of 3 — reviewing the translation');
  const step2 = await runStage({
    label: review.label,
    apiKey,
    models,
    prompt:
      `${review.text}\n\nFORMATTED ENGLISH SCRIPT:\n\n${english}\n\n` +
      `${language.toUpperCase()} TRANSLATION:\n\n${step1.script}`,
  });

  report(2, 'Step 3 of 3 — refining punctuation');
  const step3 = await runStage({
    label: punctuation.label,
    apiKey,
    models,
    prompt: `${punctuation.text}\n\n${step2.script}`,
  });

  const script = stripPaceTags(step3.script);

  report(3, 'Placing the script on the cues');
  const aligned = await alignScriptToCues(chunk, {
    pastedScript: script,
    targetLanguage,
    apiKey,
    models,
  });

  return { aligned, script, modelUsed: step3.modelUsed };
};

/**
 * Same contract as `translateCueTexts`, so every route and the pipeline can
 * use it unchanged. `script` additionally carries the full Step 3 output.
 */
export const translateCueTextsThreeStep = async (
  cues,
  { targetLanguage, customPrompt = '', apiKey, models, batchSize, onProgress } = {}
) => {
  const stages = loadStagePrompts(targetLanguage);
  const notes = extraInstructions(customPrompt);

  const measured = measureCues(
    cues
      .map((cue) => ({
        id: String(cue.id),
        text: String(cue.text ?? '').trim(),
        startTime: Number(cue.startTime) || 0,
        endTime: Number(cue.endTime) || 0,
      }))
      .filter((cue) => cue.text.length > 0)
  );

  if (measured.length === 0) {
    return { translations: new Map(), modelUsed: null, translatedCount: 0, missingIds: [], failedBatches: 0, script: '' };
  }

  if (!measured.some((cue) => cue.duration > 0)) {
    logger.warn('3-step translation received cues without timings; segment metadata is omitted.');
  }

  const size = Math.max(10, batchSize || config.threeStepBatchSize);
  const chunks = chunkAtPauses(measured, size);
  const stepsPerChunk = 4;
  const translations = new Map();
  const scripts = [];
  let modelUsed = null;
  let failedBatches = 0;

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const report = (step, message) =>
      onProgress?.({
        stage: 'translating',
        batch: chunkIndex * stepsPerChunk + step + 1,
        batchCount: chunks.length * stepsPerChunk,
        message: chunks.length > 1 ? `${message} (part ${chunkIndex + 1} of ${chunks.length})...` : `${message}...`,
      });

    try {
      const outcome = await translateChunk({ chunk, stages, notes, targetLanguage, apiKey, models, report });
      modelUsed = outcome.modelUsed;
      scripts.push(outcome.script);
      for (const [id, text] of outcome.aligned) {
        const clean = stripPaceTags(text);
        if (clean) translations.set(id, clean);
      }
    } catch (err) {
      failedBatches += 1;
      logger.error(`3-step translation part ${chunkIndex + 1}/${chunks.length} failed: ${err?.message || err}`);
      if (chunks.length === 1) throw err;
    }
  }

  const missingIds = measured.filter((cue) => !translations.has(cue.id)).map((cue) => cue.id);
  if (missingIds.length > 0) {
    logger.warn(`${missingIds.length} cue(s) got no text from the 3-step translation; keeping their source text.`);
  }

  return {
    translations,
    modelUsed,
    translatedCount: translations.size,
    missingIds,
    failedBatches,
    script: scripts.join('\n\n'),
  };
};
