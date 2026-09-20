import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { upload, cleanupUploads } from '../middleware/upload.js';
import { assertSupportedMedia } from '../lib/media.js';
import { runSubtitlePipeline } from '../lib/pipeline.js';
import { ApiError } from '../errors.js';
import { logger } from '../logger.js';

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
    } = req.body || {};

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };

    send({ type: 'progress', stage: 'queued', progress: 0.01, message: 'Upload received.' });

    try {
      const result = await runSubtitlePipeline(req.file, {
        sourceLanguage,
        targetLanguage,
        customPrompt,
        translate: translate !== 'false',
        diarize: diarize === 'true',
        cueOptions: parseJsonField(req.body?.cueOptions, {}),
        ...keys(req),
        onProgress: (event) => send({ type: 'progress', ...event }),
      });

      send({ type: 'result', ...result });
    } catch (err) {
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
 * from the caller's existing cues and are returned unchanged.
 */
pipelineRouter.post(
  '/pipeline/retranslate',
  asyncHandler(async (req, res) => {
    const { cues, sourceLanguage = '', targetLanguage, customPrompt = '' } = req.body || {};

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

    const outcome = await translateCueTexts(sourceCues, {
      sourceLanguage,
      targetLanguage,
      customPrompt,
      apiKey: req.get('x-gemini-key') || undefined,
    });

    const translatedCues = retextCues(sourceCues, outcome.translations, 'translatedText').map((cue) => ({
      ...cue,
      translatedText: cue.translatedText || cue.text,
    }));

    assertTimingsPreserved(sourceCues, translatedCues);

    res.json({
      cues: translatedCues,
      translatedSrt: serializeSrt(translatedCues, { field: 'translatedText' }),
      originalSrt: serializeSrt(sourceCues, { field: 'text' }),
      translationModel: outcome.modelUsed,
      untranslatedCueIds: outcome.missingIds,
      targetLanguage,
    });
  })
);
