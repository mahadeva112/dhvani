import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { upload, cleanupUploads } from '../middleware/upload.js';
import { assertSupportedMedia } from '../lib/media.js';
import { runSubtitlePipeline } from '../lib/pipeline.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';
import {
  startTranslationJob,
  updateTranslationJob,
  finishTranslationJob,
  getTranslationJob,
} from '../lib/translationJobs.js';

export const pipelineRouter = Router();

const parseJsonField = (value, fallback) => {
  if (!value) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
};

const keys = (req) => ({
  elevenLabsKey: req.get('x-elevenlabs-key') || undefined,
  geminiKey: req.get('x-gemini-key') || undefined,
});

/**
 * POST /api/pipeline/subtitles
 *
 * Runs the full workflow and streams newline-delimited JSON so the UI can show
 * real stage-by-stage progress on a long file instead of a spinner. The final
 * line is `{"type":"result",...}` or `{"type":"error",...}`.
 *
 * A streaming response cannot change its status code after the first byte, so
 * errors are reported inside the stream and the client checks the last event.
 */
pipelineRouter.post(
  '/pipeline/subtitles',
  cleanupUploads,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    assertSupportedMedia(req.file);

    const {
      sourceLanguage = '',
      targetLanguage = '',
      customPrompt = '',
      translate = 'true',
      diarize = 'false',
      numSpeakers = '',
    } = req.body || {};

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };

    send({ type: 'progress', stage: 'queued', progress: 0.01, message: 'Upload received.' });

    // The app cancels a transcription by closing this request: everything after it stops.
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      const result = await runSubtitlePipeline(req.file, {
        sourceLanguage,
        targetLanguage,
        customPrompt,
        translate: translate !== 'false',
        diarize: diarize === 'true',
        numSpeakers: Number(numSpeakers) || undefined,
        cueOptions: parseJsonField(req.body?.cueOptions, {}),
        ...keys(req),
        onProgress: (event) => send({ type: 'progress', ...event }),
        signal: controller.signal,
      });

      send({ type: 'result', ...result });
    } catch (err) {
      if (controller.signal.aborted) {
        logger.info(`Transcription of "${req.file?.originalname}" cancelled.`);
        return;
      }
      const error =
        err instanceof ApiError
          ? err
          : new ApiError(err?.message || 'The subtitle pipeline failed.', { status: 500 });
      logger.error(`Pipeline failed: ${error.message}`);
      send({ type: 'error', ...error.toJSON().error });
    } finally {
      res.end();
    }
  })
);

/**
 * POST /api/pipeline/retranslate
 *
 * Re-runs translation over cues that were already transcribed, so a failed or
 * unsatisfying translation never costs another transcription. Timestamps come
 * from the caller's existing cues and are returned unchanged. `voiceRate`,
 * the dub voice's speaking rate in syllables a second, sizes each cue for it;
 * `speakerRates` does the same for the speakers who have a voice of their own.
 */
pipelineRouter.post(
  '/pipeline/retranslate',
  asyncHandler(async (req, res) => {
    const { cues, sourceLanguage = '', targetLanguage, customPrompt = '', voiceRate = null, speakerRates = null, fast = false, jobId } = req.body || {};

    if (!Array.isArray(cues) || cues.length === 0) {
      throw new ApiError('No cues were supplied to translate.', { status: 400, code: 'no_cues' });
    }
    if (!targetLanguage) {
      throw new ApiError('No target language was selected.', {
        status: 400,
        code: 'missing_target_language',
      });
    }

    const { translateCueTexts } = await import('../providers/gemini/translation.js');
    const { serializeSrt, retextCues, assertTimingsPreserved } = await import('../lib/srt.js');

    const sourceCues = cues.map((cue, index) => ({
      id: String(cue.id ?? `cue-${index + 1}`),
      index: index + 1,
      startTime: Number(cue.startTime) || 0,
      endTime: Number(cue.endTime) || 0,
      speaker: cue.speaker || 'Speaker',
      text: String(cue.text ?? cue.textSource ?? '').trim(),
      words: Array.isArray(cue.words) ? cue.words : [],
    }));

    // Streams like /pipeline/subtitles so the UI can show real batch progress.
    // Validation above still fails fast with a normal JSON error status.
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // With a jobId the translation outlives this request: a dropped connection
    // no longer loses it, and GET /pipeline/retranslate/:jobId hands it over.
    const job = startTranslationJob(jobId);

    const send = (event) => {
      if (job && event.type === 'progress') updateTranslationJob(jobId, event);
      if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}
`);
    };

    const cueCount = sourceCues.filter((cue) => cue.text).length;
    send({ type: 'progress', stage: 'translating', batch: 0, batchCount: 0, cueCount, message: 'Preparing the cues...' });

    try {
      const outcome = await translateCueTexts(sourceCues, {
        sourceLanguage,
        targetLanguage,
        customPrompt,
        voiceRate,
        speakerRates,
        // Fast translate: translation only, no checks, batches in parallel.
        fast: fast === true,
        apiKey: req.get('x-gemini-key') || undefined,
        onProgress: (event) => send({ type: 'progress', cueCount, ...event }),
      });

      const translatedCues = retextCues(sourceCues, outcome.translations, 'translatedText').map((cue) => ({
        ...cue,
        translatedText: cue.translatedText || cue.text,
      }));

      assertTimingsPreserved(sourceCues, translatedCues);

      const result = {
        type: 'result',
        cues: translatedCues,
        translatedSrt: serializeSrt(translatedCues, { field: 'translatedText' }),
        originalSrt: serializeSrt(sourceCues, { field: 'text' }),
        translationModel: outcome.modelUsed,
        untranslatedCueIds: outcome.missingIds,
        targetLanguage,
      };
      if (job) finishTranslationJob(jobId, { result });
      send(result);
    } catch (err) {
      const error =
        err instanceof ApiError
          ? err
          : new ApiError(err?.message || 'The translation failed.', { status: 500 });
      logger.error(`Retranslation failed: ${error.message}`);
      if (job) finishTranslationJob(jobId, { error: error.toJSON().error });
      send({ type: 'error', ...error.toJSON().error });
    } finally {
      res.end();
    }
  })
);

/**
 * GET /api/pipeline/retranslate/:jobId
 *
 * Where a translation started with a jobId has got: `running` with its last
 * progress, `done` with the same result the stream would have ended on, or
 * `failed` with its error. 404 means this backend never ran it (it restarted).
 */
pipelineRouter.get('/pipeline/retranslate/:jobId', (req, res) => {
  const job = getTranslationJob(req.params.jobId);
  if (!job) {
    throw new ApiError('This backend has no translation with that id - it may have restarted.', {
      status: 404,
      code: 'job_not_found',
    });
  }
  res.json(job);
});
