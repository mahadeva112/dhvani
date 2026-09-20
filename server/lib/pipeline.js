import { config } from '../env.js';
import { logger } from '../logger.js';
import { ApiError } from '../errors.js';
import { getProvider, activeProviders } from '../providers/index.js';
import { serializeSrt, retextCues, assertTimingsPreserved } from './srt.js';

/**
 * The end-to-end subtitle workflow:
 *
 *   media -> ElevenLabs transcription + word timestamps -> original SRT
 *         -> Gemini translation of cue TEXT ONLY -> translated SRT
 *
 * Two properties this function guarantees:
 *
 * 1. Every timestamp originates from ElevenLabs. The translated cue list is
 *    built by copying the source cues and swapping only their text, then
 *    verified by `assertTimingsPreserved`.
 * 2. A translation failure never destroys transcription work. The transcript,
 *    the cues and the original SRT are returned regardless, with the
 *    translation problem reported alongside them.
 */
export const runSubtitlePipeline = async (
  file,
  {
    sourceLanguage = '',
    targetLanguage = '',
    customPrompt = '',
    translate = true,
    cueOptions = {},
    diarize = false,
    transcriptionProvider = activeProviders.transcription,
    translationProvider = activeProviders.translation,
    elevenLabsKey,
    geminiKey,
    onProgress = () => {},
  } = {}
) => {
  const startedAt = Date.now();

  /* ---------------- Stage 1 — transcription (source of truth) ------------ */

  onProgress({ stage: 'transcribing', progress: 0.05, message: 'Preparing media for transcription...' });

  const transcriber = getProvider('transcription', transcriptionProvider);
  const transcription = await transcriber.transcribe(file, {
    sourceLanguage,
    diarize,
    cueOptions,
    apiKey: elevenLabsKey,
    onStatus: (message) => onProgress({ stage: 'transcribing', progress: 0.2, message }),
  });

  const sourceCues = transcription.cues;

  onProgress({
    stage: 'transcribed',
    progress: 0.55,
    message: `Transcribed ${sourceCues.length} cues in ${transcription.languageName}.`,
    detectedLanguage: transcription.languageName,
    cueCount: sourceCues.length,
  });

  /* ---------------- Stage 2 — original-language SRT ---------------------- */

  const originalSrt = serializeSrt(sourceCues, { field: 'text' });

  onProgress({ stage: 'srt_generated', progress: 0.6, message: 'Original-language SRT generated.' });

  const baseResult = {
    detectedLanguage: transcription.languageName,
    detectedLanguageCode: transcription.languageCode,
    languageProbability: transcription.languageProbability,
    duration: transcription.duration,
    audioExtracted: transcription.audioExtracted,
    transcript: transcription.text,
    words: transcription.words,
    cues: sourceCues,
    originalSrt,
    translatedSrt: '',
    targetLanguage: targetLanguage || null,
    translationModel: null,
    translationWarning: null,
    untranslatedCueIds: [],
    timingSource: transcriber.providesWordTimestamps ? 'elevenlabs_word_timestamps' : 'provider',
    elapsedMs: 0,
  };

  const shouldTranslate =
    translate &&
    Boolean(targetLanguage) &&
    targetLanguage.toLowerCase() !== transcription.languageName.toLowerCase();

  if (!shouldTranslate) {
    if (translate && targetLanguage) {
      // Source and target match: the "translation" is the transcript itself.
      const sameLanguageCues = sourceCues.map((cue) => ({ ...cue, translatedText: cue.text }));
      baseResult.translatedSrt = serializeSrt(sameLanguageCues, { field: 'translatedText' });
      baseResult.cues = sameLanguageCues;
      baseResult.translationWarning =
        `Source and target language are both ${transcription.languageName}, so the transcript was kept as-is.`;
    }
    baseResult.elapsedMs = Date.now() - startedAt;
    return baseResult;
  }

  /* ---------------- Stage 3 — translation (text only) -------------------- */

  onProgress({
    stage: 'translating',
    progress: 0.65,
    message: `Translating ${sourceCues.length} cues to ${targetLanguage}...`,
  });

  try {
    const translator = getProvider('translation', translationProvider);
    const outcome = await translator.translate(sourceCues, {
      sourceLanguage: transcription.languageName,
      targetLanguage,
      customPrompt,
      apiKey: geminiKey,
      batchSize: config.translationBatchSize,
      onProgress: (event) =>
        onProgress({
          ...event,
          progress: 0.65 + 0.3 * (event.batch / Math.max(1, event.batchCount)),
        }),
    });

    // Cue text is replaced; startTime, endTime and words are carried over
    // untouched from the ElevenLabs cues.
    const translatedCues = retextCues(sourceCues, outcome.translations, 'translatedText').map((cue) => ({
      ...cue,
      // A cue the model skipped keeps its source text so the SRT stays complete
      // and cue numbering never shifts.
      translatedText: cue.translatedText || cue.text,
    }));

    assertTimingsPreserved(sourceCues, translatedCues);

    baseResult.cues = translatedCues;
    baseResult.translatedSrt = serializeSrt(translatedCues, { field: 'translatedText' });
    baseResult.translationModel = outcome.modelUsed;
    baseResult.untranslatedCueIds = outcome.missingIds;

    if (outcome.missingIds.length > 0 || outcome.failedBatches > 0) {
      baseResult.translationWarning =
        `${outcome.missingIds.length} of ${sourceCues.length} cues could not be translated and kept their original text. ` +
        'Timestamps are unaffected — you can retry the translation without re-transcribing.';
    }

    onProgress({
      stage: 'completed',
      progress: 1,
      message: `Translated ${outcome.translatedCount} cues to ${targetLanguage}.`,
    });
  } catch (err) {
    // Transcription survives a translation failure — that is the whole point of
    // returning `baseResult` here instead of rethrowing.
    const message = err instanceof ApiError ? err.message : err?.message || 'Translation failed.';
    logger.error(`Translation stage failed, returning transcription only: ${message}`);

    baseResult.translationWarning =
      `Transcription succeeded and your timestamps are safe, but translation to ${targetLanguage} failed: ${message} ` +
      'Retry the translation from the review screen — the audio does not need to be re-transcribed.';

    onProgress({ stage: 'translation_failed', progress: 1, message: baseResult.translationWarning });
  }

  baseResult.elapsedMs = Date.now() - startedAt;
  return baseResult;
};
