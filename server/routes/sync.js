import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../errors.js';
import { synthesizeLines, cleanTextForNaturalSpeech } from '../providers/elevenlabs/speech.js';
import { synthesizeLines as synthesizeCartesiaLines, toCartesiaOutputFormat } from '../providers/cartesia/speech.js';
import { decodeAudio, encodeAudio, ffmpegAvailable, parseOutputFormat, timeStretch } from '../lib/media.js';
import { pcmToWav, floatToWav, parseWav } from '../lib/wav.js';
import { runSync } from '../lib/syncDub.js';
import { checkParts, lineArrays, renderEdits } from '../lib/syncEdit.js';
import { runConversation } from '../lib/conversationDub.js';
import { MIX_PEAK_MODES } from '../lib/speakerMix.js';
import { shortenLine, lengthenLine, suggestLine, suggestLines, MAX_OPTIONS } from '../lib/syncRewrite.js';
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
 * One voice of a dub: what it is voiced with, in the format its engine
 * returns. An ElevenLabs model name on a Cartesia voice (or the other way
 * round) means no model was picked for that engine, so its default is used.
 */
const makeVoice = ({ voiceId, modelId, voiceSettings }, { requested, seed }) => {
  const cleanSeed = Number.isInteger(seed) ? seed : undefined;
  if (isCartesiaVoice(voiceId)) {
    return {
      voiceId,
      cartesia: true,
      modelId: modelId && !/^eleven_/.test(modelId) ? modelId : undefined,
      outputFormat: toCartesiaOutputFormat(requested).format,
      voiceSettings: cartesiaSettings(voiceSettings),
      // Cartesia takes no seed, but a retake still needs its own cache entry.
      seed: cleanSeed,
    };
  }
  return {
    voiceId,
    cartesia: false,
    modelId: modelId && /^eleven_/.test(modelId) ? modelId : undefined,
    outputFormat: requested,
    voiceSettings: voiceSettings && typeof voiceSettings === 'object' ? voiceSettings : undefined,
    seed: cleanSeed,
  };
};

/** Speakers allowed in one cast; Scribe tells apart at most 32. */
const MAX_CAST = 32;

/**
 * The voice for each speaker: `cast` maps a speaker's name to
 * `{ voiceId, modelId, voiceSettings }`; a speaker not in it, or with no
 * voice, is voiced by `main`. Every voice must decode at one sample rate,
 * since nothing is resampled.
 */
const castVoices = (cast, main, { requested, seed }) => {
  const voices = new Map();
  for (const [speaker, entry] of Object.entries(cast && typeof cast === 'object' ? cast : {}).slice(0, MAX_CAST)) {
    if (typeof speaker !== 'string' || speaker.length > 128 || !entry || typeof entry.voiceId !== 'string' || !entry.voiceId.trim()) continue;
    voices.set(speaker, makeVoice(entry, { requested, seed }));
  }
  const rates = new Set([main, ...voices.values()].map((voice) => parseOutputFormat(voice.outputFormat)?.sampleRate));
  if (rates.size > 1) {
    throw new ApiError(
      'These voices come back at different sample rates, and DHVANI never resamples a voice. Pick voices from one engine, or a PCM output format both engines produce.',
      { status: 400, code: 'cast_sample_rates' }
    );
  }
  return (speaker) => voices.get(speaker) || main;
};

/** Voices lines with whichever engine `voice` belongs to. */
const voiceLinesWith = ({ apiKey, cartesiaKey, language, signal }) => async (lines, { voice, onLine }) =>
  voice.cartesia
    ? (await synthesizeCartesiaLines({ ...voice, lines, language }, { apiKey: cartesiaKey, signal, onLine })).map((r) => r.buffer)
    : (await synthesizeLines({ ...voice, lines }, { apiKey, signal, onLine })).map((r) => r.buffer);

/** One lossless write at the clips' own rate; `float` keeps a mix above full scale exactly as summed. */
const encodeWav = (sampleRate) => async (samples, { float = false } = {}) =>
  float
    ? { buffer: floatToWav(samples, { sampleRate }), contentType: 'audio/wav' }
    : { buffer: pcmToWav(await encodeAudio(samples, `pcm_${sampleRate}`), { sampleRate }), contentType: 'audio/wav' };

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

/**
 * Banks for Edit timing, by id: every placed line of a sync, exactly as the
 * render took it (see runSync). The app keeps its own copy with the project
 * and sends it again (PUT /api/sync/edit/banks/:bankId) when this one has
 * gone: dropped after BANK_TTL_MS unused, or the oldest first past
 * BANK_BYTES_LIMIT, or with the server.
 */
const BANK_TTL_MS = 3 * 60 * 60 * 1000;
const BANK_BYTES_LIMIT = 768 * 1024 * 1024;
const STRETCH_CACHE_LIMIT = 200;
const banks = new Map();

const BANK_ID = /^[A-Za-z0-9-]{8,64}$/;

const keepBank = (bankId, { sampleRate, float, samples }) => {
  banks.delete(bankId);
  banks.set(bankId, { sampleRate, float, samples, usedAt: Date.now(), arrays: null, arraysKey: '', stretched: new Map() });
  let bytes = 0;
  for (const entry of banks.values()) bytes += entry.samples.byteLength;
  for (const [id, entry] of banks) {
    if (bytes <= BANK_BYTES_LIMIT || id === bankId) break;
    bytes -= entry.samples.byteLength;
    banks.delete(id);
  }
};

const bankFor = (bankId) => {
  const now = Date.now();
  for (const [id, entry] of banks) if (now - entry.usedAt > BANK_TTL_MS) banks.delete(id);
  const entry = banks.get(bankId);
  if (!entry) return null;
  entry.usedAt = now;
  banks.delete(bankId);
  banks.set(bankId, entry);
  return entry;
};

/** A sync's locked lines, as the app sends them back: only what runSync reads. */
const cleanLocked = (value) =>
  Object.fromEntries(
    Object.entries(value && typeof value === 'object' ? value : {})
      .slice(0, 20000)
      .filter(
        ([key, lock]) =>
          key.length <= 128 &&
          lock &&
          typeof lock.hash === 'string' &&
          lock.hash.length <= 64 &&
          Number.isFinite(lock.start) &&
          Number.isFinite(lock.end) &&
          (lock.cuts === undefined || (Array.isArray(lock.cuts) && lock.cuts.length <= 10000))
      )
      .map(([key, lock]) => [key, { hash: lock.hash, cuts: lock.cuts || [], crossfade: Number(lock.crossfade) || 0, start: lock.start, end: lock.end }])
  );

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
 * voiceSettings, language, seed, lineSeeds, precision, join, suggest,
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
      join,
      suggest,
      suggestLonger,
      matchLoudness,
      debug,
      jobId,
      multiSpeaker,
      cast,
      peak,
      locked,
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
      ? { ...makeVoice({ voiceId, modelId, voiceSettings }, { requested, seed }), outputFormat: format }
      : { ...makeVoice({ voiceId, modelId, voiceSettings }, { requested, seed }), modelId, outputFormat: format };
    const several = multiSpeaker === true;
    const voiceFor = several ? castVoices(cast, voice, { requested, seed }) : undefined;
    const voiceWith = voiceLinesWith({ apiKey, cartesiaKey, language, signal: controller.signal });
    const voiceLines = (lines, { voice: lineVoice, onLine }) => voiceWith(lines, { voice: lineVoice || voice, onLine });

    try {
      const result = await runSync(
        {
          segments,
          sourceDuration: Number(sourceDuration) || 0,
          sampleRate,
          precision,
          join,
          suggest: suggest !== false,
          suggestLonger: suggestLonger !== false,
          language,
          voice,
          voiceFor,
          multiSpeaker: several,
          peak: MIX_PEAK_MODES.includes(peak) ? peak : 'float',
          lineSeeds: cleanLineSeeds(lineSeeds),
          matchLoudness: matchLoudness === true,
          locked: cleanLocked(locked),
          debug: audioDebug,
        },
        {
          voiceLines,
          decode: (buffer) => decodeAudio(buffer, format),
          // One write at the end, lossless and at the clips' own rate: encoding to
          // MP3 again would be a second lossy generation of every line.
          encode: encodeWav(sampleRate),
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
      // The bank goes out in the dub's own sample format, and what is kept here
      // is read back from that same file, so a render from this copy and from
      // one the app sends again later are the same.
      const float = Boolean(result.report.mix) && result.report.mix.peak === 'float';
      const bankFile = await encodeWav(sampleRate)(result.bank.samples, { float });
      const bankId = randomUUID();
      keepBank(bankId, parseWav(bankFile.buffer));
      res.json({
        audioId: keepResult(result.buffer, result.contentType),
        contentType: result.contentType,
        stems: (result.stems || []).map((stem) => ({ speaker: stem.speaker, audioId: keepResult(stem.buffer, stem.contentType), contentType: stem.contentType })),
        report: result.report,
        bank: {
          bankId,
          audioId: keepResult(bankFile.buffer, bankFile.contentType),
          sampleRate,
          float,
          lines: result.bank.lines,
          speakerGains: result.bank.speakerGains,
        },
      });
    } catch (err) {
      if (job) finishDubJob(jobId, controller.signal.aborted ? 'cancelled' : 'failed');
      throw err;
    }
  })
);

/**
 * POST /api/dub/conversation — a dub with one voice per speaker, not synced:
 * the script read turn by turn, the pause between turns following the
 * original. Body: `{ turns, cast, voiceId, modelId, outputFormat,
 * voiceSettings, language, seed, matchSpeakers, peak, jobId }`, `turns` being
 * `[{ speaker, text, gapAfter }]` in spoken order and `cast` as for /sync.
 * Replies `{ audioId, contentType, stems, report }` as /sync does; progress is
 * polled like a one-voice dub, at /api/elevenlabs/tts/jobs/:jobId.
 */
syncRouter.post(
  '/dub/conversation',
  asyncHandler(async (req, res) => {
    const { turns, cast, voiceId, modelId, outputFormat, voiceSettings, language, seed, matchSpeakers, peak, jobId } = req.body || {};
    if (!Array.isArray(turns) || turns.length === 0) {
      throw new ApiError('There is no dialogue to dub.', { status: 400, code: 'no_turns' });
    }

    const requested = parseOutputFormat(outputFormat) ? outputFormat : FALLBACK_FORMAT;
    const main = makeVoice({ voiceId, modelId, voiceSettings }, { requested, seed });
    const voiceFor = castVoices(cast, main, { requested, seed });
    const { codec, sampleRate } = parseOutputFormat(main.outputFormat);
    if (codec !== 'pcm' && !(await ffmpegAvailable())) {
      throw new ApiError("A dub with several voices needs ffmpeg to join the voices' MP3 passages. Install ffmpeg and try again.", {
        status: 501,
        code: 'ffmpeg_missing',
      });
    }

    const job = startDubJob(jobId);
    const controller = job?.controller || new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) controller.abort();
    });

    try {
      const result = await runConversation(
        {
          turns: turns.slice(0, 20000).map((turn) => ({
            speaker: String(turn?.speaker || 'Speaker').slice(0, 128),
            text: cleanTextForNaturalSpeech(String(turn?.text || '')),
            gapAfter: Number(turn?.gapAfter),
          })),
          sampleRate,
          voiceFor,
          matchSpeakers: matchSpeakers === true,
          peak: MIX_PEAK_MODES.includes(peak) ? peak : 'float',
        },
        {
          voiceLines: (voice, lines, { onLine }) =>
            voiceLinesWith({
              apiKey: req.get('x-elevenlabs-key') || undefined,
              cartesiaKey: req.get('x-cartesia-key') || undefined,
              language,
              signal: controller.signal,
            })(lines, { voice, onLine }),
          decode: (buffer, voice) => decodeAudio(buffer, voice.outputFormat),
        },
        { signal: controller.signal, onProgress: (progress) => job && updateDubJob(jobId, progress) }
      );
      const encode = encodeWav(sampleRate);
      const float = result.report.peak === 'float';
      const mix = await encode(result.mix, { float });
      const stems = [];
      for (const stem of result.stems) {
        const encoded = await encode(stem.samples, { float });
        stems.push({ speaker: stem.speaker, audioId: keepResult(encoded.buffer, encoded.contentType), contentType: encoded.contentType });
      }
      if (job) finishDubJob(jobId, 'done');
      res.json({ audioId: keepResult(mix.buffer, mix.contentType), contentType: mix.contentType, stems, report: result.report });
    } catch (err) {
      if (job) finishDubJob(jobId, controller.signal.aborted ? 'cancelled' : 'failed');
      throw err;
    }
  })
);

/**
 * POST /api/sync/preview — which lines are likely to fit before anything is
 * voiced. Body: `{ segments, precision, charsPerSecond, sourceDuration, join }`.
 * Pure arithmetic on the cues: no voice and no text model is called.
 */
syncRouter.post('/sync/preview', (req, res) => {
  const { segments, precision, charsPerSecond, sourceDuration, join } = req.body || {};
  if (!Array.isArray(segments)) throw new ApiError('There are no cues to preview.', { status: 400, code: 'no_segments' });
  res.json(previewSync({ segments, precision, charsPerSecond, sourceDuration, join }));
});

/** Most earlier wordings a rewording request may list, to be told apart from. */
const MAX_AVOID_LINES = 6;
/** Lines of context either side, and the longest one kept. */
const MAX_CONTEXT_LINES = 2;
const MAX_CONTEXT_CHARS = 500;

/** The request's lines around the one being reworded, and its speaker, held to what a prompt needs. */
const lineContextOf = (context) => {
  const lines = (list) =>
    Array.isArray(list) ? list.filter((line) => typeof line === 'string' && line.trim()).map((line) => line.slice(0, MAX_CONTEXT_CHARS)) : [];
  return {
    before: lines(context?.before).slice(-MAX_CONTEXT_LINES),
    after: lines(context?.after).slice(0, MAX_CONTEXT_LINES),
    speaker: typeof context?.speaker === 'string' ? context.speaker.slice(0, 80) : '',
  };
};

/**
 * One rewording request: `count` 1 asks for the single best wording
 * (suggestLine), more asks for that many wordings of different kinds at once
 * (suggestLines). Replies `{ options, line, reason, flagged }`: `options` the
 * wordings, those that passed the meaning check first and any that did not
 * with their `issues`; `line`, `reason` and `flagged` as suggestLine gives them,
 * for one wording.
 */
const rewordRoute = (direction) =>
  asyncHandler(async (req, res) => {
    const { text, sourceText, language, targetChars, avoid, count, context } = req.body || {};
    const longer = direction === 'longer';
    if (typeof text !== 'string' || !text.trim()) {
      throw new ApiError(longer ? 'There is no line to make fuller.' : 'There is no line to shorten.', { status: 400, code: 'no_text' });
    }
    const target = longer
      ? // At most three times the line: past that it is a new line, not a fuller one.
        Math.max(text.length + 1, Math.min(text.length * 3, Math.floor(Number(targetChars) || text.length * 1.5)))
      : Math.max(1, Math.min(text.length, Math.floor(Number(targetChars) || text.length * 0.8)));
    const earlier = Array.isArray(avoid) ? avoid.filter((line) => typeof line === 'string' && line.length <= 2000).slice(-MAX_AVOID_LINES) : [];
    const request = {
      text,
      sourceText: typeof sourceText === 'string' ? sourceText : '',
      language,
      targetChars: target,
      avoid: earlier,
      direction,
      context: lineContextOf(context),
    };
    const options = { apiKey: req.get('x-gemini-key') || undefined };
    const wanted = Math.max(1, Math.min(MAX_OPTIONS, Math.floor(Number(count)) || 1));
    if (wanted > 1) {
      const result = await suggestLines({ ...request, count: wanted }, options);
      const first = result.options[0];
      res.json({
        options: result.options,
        line: first && !first.issues ? first.line : null,
        reason: result.options.length === 0 ? 'unusable' : first.issues ? 'meaning' : null,
        flagged: first?.issues ? first : null,
      });
      return;
    }
    const { line, reason, flagged } = await suggestLine(request, options);
    res.json({ options: line ? [{ line }] : flagged ? [flagged] : [], line, reason, flagged });
  });

/**
 * POST /api/sync/shorten — shorter wordings for one line, from the text
 * model. Body: `{ text, sourceText, language, targetChars, avoid, count,
 * context }`: `avoid` earlier suggestions to differ from, `count` how many
 * wordings (1 to 3), `context` `{ before, after, speaker }`, the lines around
 * it for the model to read it in. Replies as rewordRoute says. Every wording
 * without `issues` has passed the meaning check (syncRewrite.js). The script
 * is never changed here.
 */
syncRouter.post('/sync/shorten', rewordRoute('shorter'));

/**
 * POST /api/sync/lengthen — fuller wordings for one line that ends well
 * before the original speaker does. Body and reply as for /sync/shorten;
 * `targetChars` is the length to aim for, more than the line has now. The
 * script is never changed here.
 */
syncRouter.post('/sync/lengthen', rewordRoute('longer'));

/**
 * PUT /api/sync/edit/banks/:bankId — the bank of a sync again, as the app saved
 * it (the WAV /sync gave it), for when this server no longer has it.
 */
syncRouter.put(
  '/sync/edit/banks/:bankId',
  express.raw({ type: () => true, limit: '2gb' }),
  (req, res) => {
    const { bankId } = req.params;
    if (!BANK_ID.test(bankId)) throw new ApiError('That is not a bank id.', { status: 400, code: 'bad_bank_id' });
    let bank;
    try {
      bank = parseWav(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    } catch (err) {
      throw new ApiError(`The saved lines could not be read: ${err.message}`, { status: 400, code: 'bad_bank' });
    }
    keepBank(bankId, bank);
    res.json({ bankId, samples: bank.samples.length });
  }
);

/**
 * POST /api/sync/edit/render — a synced dub rendered again with the user's
 * edits (see syncEdit.js). Body: `{ bankId, sampleRate, lines, speakerGains,
 * parts, sourceDuration, edgeFade, multiSpeaker, peak }`: `lines` as the bank
 * gave them (only `bankStart`, `length`, `maxStartShift`, `gain` and
 * `speaker` are read) and `parts` as checkParts takes them. Replies as /sync
 * does, `{ audioId, contentType, stems, report }`, `report` holding the mix
 * report with several speakers. A bank this server no longer has is a 404
 * with code `edit_bank_missing`: send it again and retry.
 */
syncRouter.post(
  '/sync/edit/render',
  asyncHandler(async (req, res) => {
    const { bankId, sampleRate, lines, speakerGains, parts, sourceDuration, edgeFade, multiSpeaker, peak } = req.body || {};
    const entry = typeof bankId === 'string' ? bankFor(bankId) : null;
    if (!entry) throw new ApiError('The saved lines of this sync are not on the server.', { status: 404, code: 'edit_bank_missing' });
    if (Number(sampleRate) !== entry.sampleRate) {
      throw new ApiError('The saved lines are at a different sample rate from this sync.', { status: 400, code: 'bank_sample_rate' });
    }
    if (!Array.isArray(lines) || lines.length > 20000) throw new ApiError('The lines of the sync are missing.', { status: 400, code: 'no_lines' });

    const bankLines = lines.map((line, n) => {
      const bankStart = Number(line?.bankStart);
      const length = Number(line?.length);
      if (!Number.isInteger(bankStart) || !Number.isInteger(length) || bankStart < 0 || length < 0 || bankStart + length > entry.samples.length) {
        throw new ApiError(`Line ${n + 1} is not in the saved lines.`, { status: 400, code: 'bad_bank_line' });
      }
      return {
        bankStart,
        length,
        ...(Number.isInteger(line.maxStartShift) && line.maxStartShift >= 0 && { maxStartShift: line.maxStartShift }),
        gain: Number.isFinite(line.gain) && line.gain > 0 ? line.gain : 1,
        speaker: typeof line.speaker === 'string' ? line.speaker.slice(0, 128) : 'Speaker',
      };
    });
    const bank = {
      sampleRate: entry.sampleRate,
      samples: entry.samples,
      lines: bankLines,
      speakerGains: Object.fromEntries(
        Object.entries(speakerGains && typeof speakerGains === 'object' ? speakerGains : {}).filter(([, gain]) => Number.isFinite(gain) && gain > 0)
      ),
    };
    const linesKey = bankLines.map((line) => `${line.bankStart}:${line.length}`).join(',');
    if (!entry.arrays || entry.arraysKey !== linesKey) {
      entry.arrays = lineArrays(bank);
      entry.arraysKey = linesKey;
      entry.stretched.clear();
    }

    let checked;
    try {
      checked = checkParts(parts, bank);
    } catch (err) {
      throw new ApiError(`These edits can't be rendered: ${err.message}.`, { status: 400, code: 'bad_edit' });
    }
    const several = multiSpeaker === true;
    // A stretched part is the same until its line, its samples or its speed change.
    const stretch = async (samples, rate, { line, from, to }) => {
      const key = `${line}:${from}:${to}:${rate}`;
      const hit = entry.stretched.get(key);
      if (hit) return hit;
      const out = await timeStretch(samples, entry.sampleRate, rate);
      entry.stretched.set(key, out);
      if (entry.stretched.size > STRETCH_CACHE_LIMIT) entry.stretched.delete(entry.stretched.keys().next().value);
      return out;
    };
    const result = await renderEdits(
      {
        bank,
        arrays: entry.arrays,
        parts: checked,
        sourceDuration: Number(sourceDuration) || 0,
        edgeFade: Math.max(0, Number(edgeFade) || 0),
        multiSpeaker: several,
        peak: MIX_PEAK_MODES.includes(peak) ? peak : 'float',
      },
      { stretch }
    );
    const float = several && result.report.peak === 'float';
    const encode = encodeWav(entry.sampleRate);
    const mix = await encode(result.track, { float });
    const stems = [];
    for (const stem of result.stems || []) {
      const encoded = await encode(stem.samples, { float });
      stems.push({ speaker: stem.speaker, audioId: keepResult(encoded.buffer, encoded.contentType), contentType: encoded.contentType });
    }
    res.json({ audioId: keepResult(mix.buffer, mix.contentType), contentType: mix.contentType, stems, report: result.report ? { mix: result.report } : {} });
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
