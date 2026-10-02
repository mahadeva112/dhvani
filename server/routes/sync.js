import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../errors.js';
import { synthesizeLines } from '../providers/elevenlabs/speech.js';
import { synthesizeLines as synthesizeCartesiaLines, toCartesiaOutputFormat } from '../providers/cartesia/speech.js';
import { decodeAudio, encodeAudio, ffmpegAvailable, parseOutputFormat } from '../lib/media.js';
import { pcmToWav } from '../lib/wav.js';
import { runSync } from '../lib/syncDub.js';
import { shortenLine, lengthenLine } from '../lib/syncRewrite.js';
import { previewSync } from '../lib/syncPreview.js';
import { startDubJob, updateDubJob, finishDubJob, getDubProgress, cancelDubJob } from '../lib/dubJobs.js';
import { logger } from '../logger.js';

export const syncRouter = Router();

/** Only whole-number seeds ElevenLabs accepts, keyed by line. */
const cleanLineSeeds = (value) =>
  Object.fromEntries(
    Object.entries(value && typeof value === 'object' ? value : {}).filter(
      ([key, seed]) => key.length <= 128 && Number.isInteger(seed) && seed >= 0 && seed < 2 ** 32
    )
  );

/**
 * The last stability adjustment per voice and settings. A sync whose lines all
 * come from the clip cache voices nothing, but its clips still carry it.
 */
const adjustments = new Map();
const adjustmentKey = (voice) => JSON.stringify([voice.voiceId, voice.modelId, voice.voiceSettings ?? null, voice.tuneStability]);

/** Clips are requested in this format when the dub's own can't be decoded here. */
const FALLBACK_FORMAT = 'mp3_44100_128';

const isCartesiaVoice = (voiceId) => String(voiceId || '').startsWith('cartesia:');

/**
 * The delivery a Cartesia voice is synced with: speed, volume and emotion, as
 * in a Cartesia dub. Anything else (ElevenLabs stability, style...) is dropped;
 * the provider clamps the values and ignores them on models that don't take them.
 */
export const cartesiaSettings = (settings) => {
  if (!settings || typeof settings !== 'object') return undefined;
  const out = {};
  for (const key of ['speed', 'volume']) {
    if (typeof settings[key] === 'number' && Number.isFinite(settings[key])) out[key] = settings[key];
  }
  if (typeof settings.emotion === 'string' && settings.emotion.trim()) out.emotion = settings.emotion.trim();
  return Object.keys(out).length ? out : undefined;
};

/**
 * Finished dubs waiting to be fetched, by id. The dub is lossless WAV, too big
 * to carry as base64 inside JSON for a long source, so it is fetched on its
 * own (GET /api/sync/audio/:audioId) and dropped once sent or after RESULT_TTL_MS.
 */
const RESULT_TTL_MS = 10 * 60 * 1000;
const results = new Map();
const keepResult = (buffer, contentType) => {
  const id = randomUUID();
  const timer = setTimeout(() => results.delete(id), RESULT_TTL_MS);
  timer.unref?.();
  results.set(id, { buffer, contentType, timer });
  return id;
};

/** Every cut, placement, gain and fade of a sync, one line each, for tracing an artifact to the step that made it. */
const logAudioDebug = ({ sampleRate, channels, resampled, matchLoudness, output, lines }) => {
  logger.info(
    `[sync audio] ${sampleRate} Hz, ${channels} ch, resampled: ${resampled}, loudness matched: ${matchLoudness}, output ${output.contentType} (${output.samples} samples, ${output.encodes} encode)`
  );
  for (const line of lines) {
    const cuts = line.pauseCuts.map((cut) => `${cut.sourceStartSample}-${cut.sourceEndSample} (join at ${cut.timelineJoinSample}, step ${cut.joinStep.toExponential(1)})`);
    logger.info(
      `[sync audio] line ${line.key}: source ${line.sourceStartSample}-${line.sourceEndSample} of ${line.voicedSamples}` +
        ` -> timeline ${line.timelineStartSample}-${line.timelineEndSample}, gain ${line.gain.toFixed(4)},` +
        ` fade in/out ${line.fadeInSamples}/${line.fadeOutSamples} (micro-fade: ${line.microFade}),` +
        ` edge moved ${line.edgeTrimStartSamples}/${line.edgeTrimEndSamples}, dropped before 0:00 ${line.droppedBeforeZeroSamples} (start delayed ${line.startDelaySamples}),` +
        ` pause cuts: ${cuts.join(', ') || 'none'}`
    );
  }
};

/**
 * POST /api/sync — voices the translated cues line by line and places every
 * line on its source phrase, without changing the voice's speed or gain or
 * fading it.
 *
 * Body: `{ segments, sourceDuration, voiceId, modelId, outputFormat,
 * voiceSettings, language, seed, lineSeeds, precision, suggest,
 * suggestLonger, matchLoudness, debug, jobId }`. `suggest` and `suggestLonger`
 * (both on unless false) ask for shorter wordings of long lines and fuller
 * wordings of lines that end early. `lineSeeds` maps a line's key to the seed
 * of a retake of it; `matchLoudness` evens out the lines' loudness (off
 * unless asked for); `debug`, or DHVANI_AUDIO_DEBUG=1, adds
 * `report.audioDebug` and logs it. Replies with `{ audioId, contentType,
 * report }`; the dub itself, lossless WAV, is fetched from
 * /api/sync/audio/:audioId. A `jobId` makes the run pollable at
 * /api/sync/jobs/:jobId and cancellable; closing the request cancels it.
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
      lineSeeds,
      precision,
      suggest,
      suggestLonger,
      matchLoudness,
      tuneStability,
      debug,
      jobId,
    } = req.body || {};

    if (!Array.isArray(segments) || segments.length === 0) {
      throw new ApiError('There are no cues to sync.', { status: 400, code: 'no_segments' });
    }

    const cartesia = isCartesiaVoice(voiceId);
    const requested = parseOutputFormat(outputFormat) ? outputFormat : FALLBACK_FORMAT;
    // Cartesia rounds to the rates it has, so decode what actually comes back.
    const format = cartesia ? toCartesiaOutputFormat(requested).format : requested;
    const { codec, sampleRate } = parseOutputFormat(format);
    const hasFfmpeg = await ffmpegAvailable();
    if (codec !== 'pcm' && !hasFfmpeg) {
      throw new ApiError("Sync needs ffmpeg to read the voice's MP3 clips. Install ffmpeg and try again.", {
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
    const audioDebug = debug === true || process.env.DHVANI_AUDIO_DEBUG === '1';
    const cartesiaKey = req.get('x-cartesia-key') || undefined;
    const voice = cartesia
      ? {
          voiceId,
          // An ElevenLabs model name means the caller did not pick a Cartesia one.
          modelId: modelId && !/^eleven_/.test(modelId) ? modelId : undefined,
          outputFormat: format,
          voiceSettings: cartesiaSettings(voiceSettings),
          // Cartesia takes no seed, but a retake still needs its own cache entry.
          seed: Number.isInteger(seed) ? seed : undefined,
        }
      : {
          voiceId,
          modelId,
          outputFormat: format,
          voiceSettings: voiceSettings || undefined,
          seed: Number.isInteger(seed) ? seed : undefined,
          tuneStability: tuneStability !== false,
        };
    // What was changed about the voice's saved stability, reported with the sync.
    let stabilityAdjustment = cartesia ? null : adjustments.get(adjustmentKey(voice)) ?? null;
    const voiceLines = cartesia
      ? async (lines, { onLine }) =>
          (await synthesizeCartesiaLines({ ...voice, lines, language }, { apiKey: cartesiaKey, signal: controller.signal, onLine })).map((r) => r.buffer)
      : async (lines, { onLine, readCount }) =>
          (
            await synthesizeLines(
              { ...voice, lines, readCount },
              {
                apiKey,
                signal: controller.signal,
                onLine,
                onStabilityAdjustment: (adjustment) => {
                  stabilityAdjustment = adjustment;
                  adjustments.set(adjustmentKey(voice), adjustment);
                },
              }
            )
          ).map((r) => r.buffer);

    try {
      const result = await runSync(
        {
          segments,
          sourceDuration: Number(sourceDuration) || 0,
          sampleRate,
          precision,
          suggest: suggest !== false,
          suggestLonger: suggestLonger !== false,
          language,
          voice,
          lineSeeds: cleanLineSeeds(lineSeeds),
          matchLoudness: matchLoudness === true,
          debug: audioDebug,
        },
        {
          voiceLines,
          decode: (buffer) => decodeAudio(buffer, format),
          // One write at the end, lossless and at the clips' own rate: encoding to
          // MP3 again would be a second lossy generation of every line.
          encode: async (samples) => ({ buffer: pcmToWav(await encodeAudio(samples, `pcm_${sampleRate}`), { sampleRate }), contentType: 'audio/wav' }),
          shorten: (request) => shortenLine(request, { apiKey: textModelKey }),
          lengthen: (request) => lengthenLine(request, { apiKey: textModelKey }),
        },
        {
          signal: controller.signal,
          onProgress: (progress) => job && updateDubJob(jobId, progress),
        }
      );
      if (job) finishDubJob(jobId, 'done');
      if (result.report.audioDebug) logAudioDebug(result.report.audioDebug);
      res.json({
        audioId: keepResult(result.buffer, result.contentType),
        contentType: result.contentType,
        report: { ...result.report, stabilityAdjustment },
      });
    } catch (err) {
      if (job) finishDubJob(jobId, controller.signal.aborted ? 'cancelled' : 'failed');
      throw err;
    }
  })
);

/**
 * POST /api/sync/preview — which lines are likely to fit before anything is
 * voiced. Body: `{ segments, precision, charsPerSecond, sourceDuration }`.
 * Pure arithmetic on the cues: no voice and no text model is called.
 */
syncRouter.post('/sync/preview', (req, res) => {
  const { segments, precision, charsPerSecond, sourceDuration } = req.body || {};
  if (!Array.isArray(segments)) throw new ApiError('There are no cues to preview.', { status: 400, code: 'no_segments' });
  res.json(previewSync({ segments, precision, charsPerSecond, sourceDuration }));
});

/**
 * POST /api/sync/shorten — a shorter wording for one line, from the text
 * model. Body: `{ text, sourceText, language, targetChars, avoid }`, `avoid`
 * being earlier suggestions to differ from. Replies `{ line, reason }`: `line`
 * is null when no wording passed, `reason` then being 'unusable' or 'meaning'
 * (every wording changed what the source line says). Every line returned has
 * passed the meaning check (syncRewrite.js). The script is never changed here.
 */
syncRouter.post(
  '/sync/shorten',
  asyncHandler(async (req, res) => {
    const { text, sourceText, language, targetChars, avoid } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) throw new ApiError('There is no line to shorten.', { status: 400, code: 'no_text' });
    const target = Math.max(1, Math.min(text.length, Math.floor(Number(targetChars) || text.length * 0.8)));
    const earlier = Array.isArray(avoid) ? avoid.filter((line) => typeof line === 'string' && line.length <= 2000).slice(0, 3) : [];
    const { line, reason } = await shortenLine(
      { text, sourceText: typeof sourceText === 'string' ? sourceText : '', language, targetChars: target, avoid: earlier },
      { apiKey: req.get('x-gemini-key') || undefined }
    );
    res.json({ line, reason });
  })
);

/**
 * POST /api/sync/lengthen — a fuller wording for one line that ends well
 * before the original speaker does, from the text model. Body as for
 * /sync/shorten; `targetChars` is the length to aim for, more than the line
 * has now. Replies `{ line, reason }` as /sync/shorten does, every line
 * returned having passed the meaning check. The script is never changed here.
 */
syncRouter.post(
  '/sync/lengthen',
  asyncHandler(async (req, res) => {
    const { text, sourceText, language, targetChars, avoid } = req.body || {};
    if (typeof text !== 'string' || !text.trim()) throw new ApiError('There is no line to make fuller.', { status: 400, code: 'no_text' });
    // At most three times the line: past that it is a new line, not a fuller one.
    const target = Math.max(text.length + 1, Math.min(text.length * 3, Math.floor(Number(targetChars) || text.length * 1.5)));
    const earlier = Array.isArray(avoid) ? avoid.filter((line) => typeof line === 'string' && line.length <= 2000).slice(0, 3) : [];
    const { line, reason } = await lengthenLine(
      { text, sourceText: typeof sourceText === 'string' ? sourceText : '', language, targetChars: target, avoid: earlier },
      { apiKey: req.get('x-gemini-key') || undefined }
    );
    res.json({ line, reason });
  })
);

/** GET /api/sync/audio/:audioId — a finished dub, once. */
syncRouter.get('/sync/audio/:audioId', (req, res) => {
  const result = results.get(req.params.audioId);
  if (!result) throw new ApiError('That synced dub is no longer here. Sync again.', { status: 404, code: 'sync_audio_not_found' });
  res.on('finish', () => {
    clearTimeout(result.timer);
    results.delete(req.params.audioId);
  });
  res.type(result.contentType).send(result.buffer);
});

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
