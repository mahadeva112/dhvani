import { Readable } from 'node:stream';
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { upload, cleanupUploads } from '../middleware/upload.js';
import { config } from '../env.js';
import { ApiError } from '../errors.js';
import { getVoices, synthesizeScript, fetchVoicePreview, cloneVoice } from '../providers/cartesia/speech.js';
import { startDubJob, updateDubJob, finishDubJob } from '../lib/dubJobs.js';

export const cartesiaRouter = Router();

const apiKey = (req) => req.get('x-cartesia-key') || undefined;

/** GET /api/cartesia/voices — the Cartesia library, shaped like the ElevenLabs voice list. */
cartesiaRouter.get(
  '/cartesia/voices',
  asyncHandler(async (req, res) => {
    if (!config.cartesia.apiKey && !apiKey(req)) {
      res.json({ voices: [], configured: false });
      return;
    }
    res.json({ voices: await getVoices({ apiKey: apiKey(req) }), configured: true });
  })
);

/** GET /api/cartesia/voices/:voiceId/preview — the preview clip, fetched with the key the browser never sees. */
cartesiaRouter.get(
  '/cartesia/voices/:voiceId/preview',
  asyncHandler(async (req, res) => {
    const response = await fetchVoicePreview({ voiceId: req.params.voiceId, apiKey: apiKey(req) });
    res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    const length = response.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);
    if (response.body) Readable.fromWeb(response.body).pipe(res);
    else res.end();
  })
);

/**
 * POST /api/cartesia/tts — a whole dub script (or a short preview).
 *
 * Tracked with the same job registry as ElevenLabs dubs, so the existing
 * progress and cancel routes work for either engine.
 */
cartesiaRouter.post(
  '/cartesia/tts',
  asyncHandler(async (req, res) => {
    const { voiceId, text, modelId, outputFormat, voiceSettings, language, matchLoudness, jobId } = req.body || {};
    const job = startDubJob(jobId);
    const controller = job?.controller || new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      const { contentType, buffer } = await synthesizeScript(
        {
          voiceId,
          text,
          // An ElevenLabs model name means the caller did not pick a Cartesia one.
          modelId: modelId && !/^eleven_/.test(modelId) ? modelId : undefined,
          outputFormat,
          language,
          voiceSettings: voiceSettings || undefined,
          matchLoudness: matchLoudness === true,
        },
        {
          apiKey: apiKey(req),
          signal: controller.signal,
          onProgress: (progress) => job && updateDubJob(jobId, progress),
        }
      );
      if (job) finishDubJob(jobId, 'done');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', buffer.length);
      res.end(buffer);
    } catch (err) {
      if (job) finishDubJob(jobId, controller.signal.aborted ? 'cancelled' : 'failed');
      throw err;
    }
  })
);

/** POST /api/cartesia/voices/clone — instant clone from one sample. */
cartesiaRouter.post(
  '/cartesia/voices/clone',
  cleanupUploads,
  upload.array('files', 5),
  asyncHandler(async (req, res) => {
    const { name, description, language } = req.body || {};
    res.json(await cloneVoice({ name, files: req.files, description, language }, { apiKey: apiKey(req) }));
  })
);

/**
 * Cartesia retired its voice changer on 20 August 2026. The route answers
 * with that, rather than a generic 404, in case an older page still calls it.
 */
cartesiaRouter.post('/cartesia/speech-to-speech', () => {
  throw new ApiError(
    'Cartesia no longer offers a voice changer. Pick an ElevenLabs voice to change the voice of a recording.',
    { status: 410, code: 'feature_retired', provider: 'cartesia' }
  );
});
