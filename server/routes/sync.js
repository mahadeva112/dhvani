import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../errors.js';
import { synthesizeLines } from '../providers/elevenlabs/speech.js';
import { decodeAudio, encodeAudio, ffmpegAvailable, parseOutputFormat } from '../lib/media.js';
import { pcmToWav } from '../lib/wav.js';
import { runSync } from '../lib/syncDub.js';
import { shortenLine } from '../lib/syncRewrite.js';
import { startDubJob, updateDubJob, finishDubJob, getDubProgress, cancelDubJob } from '../lib/dubJobs.js';

export const syncRouter = Router();

/** Clips are requested in this format when the dub's own can't be decoded here. */
const FALLBACK_FORMAT = 'mp3_44100_128';

/**
 * POST /api/sync — voices the translated cues line by line and places every
 * line on its source phrase, without changing the voice's speed or fading it.
 *
 * Body: `{ segments, sourceDuration, voiceId, modelId, outputFormat,
 * voiceSettings, language, seed, precision, suggest, jobId }`. Replies with
 * `{ audio (base64), contentType, report }`. A `jobId` makes the run pollable
 * at /api/sync/jobs/:jobId and cancellable; closing the request cancels it.
 */
syncRouter.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const {
      segments,
      sourceDuration,
      voiceId,
      modelId,
      outputFormat,
      voiceSettings,
      language,
      seed,
      precision,
      suggest,
      jobId,
    } = req.body || {};

    if (!Array.isArray(segments) || segments.length === 0) {
      throw new ApiError('There are no cues to sync.', { status: 400, code: 'no_segments' });
    }

    const format = parseOutputFormat(outputFormat) ? outputFormat : FALLBACK_FORMAT;
    const { codec, sampleRate, bitrate } = parseOutputFormat(format);
    const hasFfmpeg = await ffmpegAvailable();
    if (codec !== 'pcm' && !hasFfmpeg) {
      throw new ApiError('Sync needs ffmpeg to cut and join the dub. Install ffmpeg and try again.', {
        status: 501,
        code: 'ffmpeg_missing',
      });
    }

    const job = startDubJob(jobId, { phase: 'units', step: 1, unitCount: 0, unitsVoiced: 0, unitsToVoice: 0, suggestionsTotal: 0, suggestionsDone: 0 });
    const controller = job?.controller || new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    const apiKey = req.get('x-elevenlabs-key') || undefined;
    const textModelKey = req.get('x-gemini-key') || undefined;
    const voice = { voiceId, modelId, outputFormat: format, voiceSettings: voiceSettings || undefined, seed: Number.isInteger(seed) ? seed : undefined };

    try {
      const result = await runSync(
        {
          segments,
          sourceDuration: Number(sourceDuration) || 0,
          sampleRate,
          precision,
          suggest: suggest !== false,
          language,
          voice,
        },
        {
          voiceLines: async (lines, { onLine }) =>
            (await synthesizeLines({ ...voice, lines }, { apiKey, signal: controller.signal, onLine })).map((r) => r.buffer),
          decode: (buffer) => decodeAudio(buffer, format),
          // One encode at the end. MP3 when ffmpeg can write it, otherwise lossless WAV.
          encode: async (samples) =>
            hasFfmpeg
              ? { buffer: await encodeAudio(samples, `mp3_${sampleRate}_${Math.max(128, bitrate || 0)}`), contentType: 'audio/mpeg' }
              : { buffer: pcmToWav(await encodeAudio(samples, `pcm_${sampleRate}`), { sampleRate }), contentType: 'audio/wav' },
          shorten: (request) => shortenLine(request, { apiKey: textModelKey }),
        },
        {
          signal: controller.signal,
          onProgress: (progress) => job && updateDubJob(jobId, progress),
        }
      );
      if (job) finishDubJob(jobId, 'done');
      res.json({ audio: result.buffer.toString('base64'), contentType: result.contentType, report: result.report });
    } catch (err) {
      if (job) finishDubJob(jobId, controller.signal.aborted ? 'cancelled' : 'failed');
      throw err;
    }
  })
);

/** GET /api/sync/jobs/:jobId — how far a sync has got. */
syncRouter.get('/sync/jobs/:jobId', (req, res) => {
  const progress = getDubProgress(req.params.jobId);
  if (!progress) throw new ApiError('No sync with that id is running.', { status: 404, code: 'sync_not_found' });
  res.json(progress);
});

/** POST /api/sync/jobs/:jobId/cancel — stops a sync. */
syncRouter.post('/sync/jobs/:jobId/cancel', (req, res) => {
  res.json({ cancelled: cancelDubJob(req.params.jobId) });
});
