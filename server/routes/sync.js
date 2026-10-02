import { createHash, randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { ApiError } from '../errors.js';
import { synthesizeLines, cleanTextForNaturalSpeech, performsTags } from '../providers/elevenlabs/speech.js';
import { synthesizeLines as synthesizeCartesiaLines, toCartesiaOutputFormat } from '../providers/cartesia/speech.js';
import { decodeAudio, encodeAudio, ffmpegAvailable, parseOutputFormat, timeStretch } from '../lib/media.js';
import { pcmToWav, floatToWav, parseWav } from '../lib/wav.js';
import { runSync } from '../lib/syncDub.js';
import { checkParts, lineArrays, ORIGINAL_SPEAKER, renderEdits } from '../lib/syncEdit.js';
import { runConversation } from '../lib/conversationDub.js';
import { MIX_PEAK_MODES } from '../lib/speakerMix.js';
import { shortenLine, lengthenLine, suggestLine, suggestLines, rewordLimit, MAX_OPTIONS } from '../lib/syncRewrite.js';
import { previewSync } from '../lib/syncPreview.js';
import { fitJoinSettings } from '../lib/syncFit.js';
import { startDubJob, updateDubJob, finishDubJob, getDubProgress, cancelDubJob } from '../lib/dubJobs.js';
import { logger } from '../logger.js';
import { config } from '../env.js';
import { addDeliveryCuesToPassages } from '../lib/deliveryCues.js';
import { alignmentText, cueSpans, cutDubTakes } from '../lib/dubTakes.js';
import { forceAlign } from '../providers/elevenlabs/alignment.js';

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
 * One voice of a dub: what it is voiced with, in the format its engine
 * returns. An ElevenLabs model name on a Cartesia voice (or the other way
 * round) means no model was picked for that engine, so its default is used.
 */
const makeVoice = ({ voiceId, modelId, voiceSettings }, { requested, seed, steady = false, tuneStability = true }) => {
  const cleanSeed = Number.isInteger(seed) ? seed : undefined;
  if (isCartesiaVoice(voiceId)) {
    return {
      voiceId,
      cartesia: true,
      modelId: modelId && !/^eleven_/.test(modelId) ? modelId : undefined,
      outputFormat: toCartesiaOutputFormat(requested).format,
      // Voice expression Neutral: the sonic-3 emotion is held at neutral.
      voiceSettings: steady ? { ...cartesiaSettings(voiceSettings), emotion: 'neutral' } : cartesiaSettings(voiceSettings),
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
    // Voice expression Neutral: a calm, even read (see NEUTRAL_VOICE in speech.js).
    ...(steady && { steady: true }),
    // Off: the saved stability is used as it is (see readSettings in speech.js).
    tuneStability,
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
const castVoices = (cast, main, { requested, seed, steady, tuneStability }) => {
  const voices = new Map();
  for (const [speaker, entry] of Object.entries(cast && typeof cast === 'object' ? cast : {}).slice(0, MAX_CAST)) {
    if (typeof speaker !== 'string' || speaker.length > 128 || !entry || typeof entry.voiceId !== 'string' || !entry.voiceId.trim()) continue;
    voices.set(speaker, makeVoice(entry, { requested, seed, steady, tuneStability }));
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

/**
 * Delivery cues already added to a set of lines, by language and text. The
 * text model words its cues a little differently each time, so a second Sync
 * reuses the first one's cues and finds its takes in the clip cache.
 */
const CUE_CACHE_LIMIT = 50;
const cueCache = new Map();

/** Voice expression Expressive for a sync: `texts` with delivery cues, cued as one script as a dub is (see deliveryCues.js). */
const cueLinesWith = ({ language, apiKey }) => async (texts) => {
  const key = createHash('sha256').update(JSON.stringify([language || '', texts])).digest('hex');
  if (cueCache.has(key)) return cueCache.get(key);
  const cued = await addDeliveryCuesToPassages(texts, { language, apiKey });
  // Lines left as written (the text model failed or added nothing) are asked again next time.
  if (cued.some((text, i) => text !== texts[i])) cueCache.set(key, cued);
  if (cueCache.size > CUE_CACHE_LIMIT) cueCache.delete(cueCache.keys().next().value);
  return cued;
};

/**
 * Voices lines with whichever engine `voice` belongs to. `readCount` is how
 * many lines the whole dub has, and `onStabilityAdjustment` hears what an
 * ElevenLabs voice's saved stability was changed to (see readSettings).
 */
const voiceLinesWith = ({ apiKey, cartesiaKey, language, signal }) => async (lines, { voice, onLine, readCount, onStabilityAdjustment }) =>
  voice.cartesia
    ? (await synthesizeCartesiaLines({ ...voice, lines, language }, { apiKey: cartesiaKey, signal, onLine })).map((r) => r.buffer)
    : (await synthesizeLines({ ...voice, lines, readCount }, { apiKey, signal, onLine, onStabilityAdjustment })).map((r) => r.buffer);

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

/**
 * Final dubs a sync may cut its lines from (see dubTakes.js), by id. The app
 * sends its dub (PUT /api/sync/dubs/:dubId) when the server doesn't have it;
 * each is kept with the word times forced alignment found in it, so the
 * alignment is paid for once per script.
 */
const DUB_TTL_MS = 3 * 60 * 60 * 1000;
const DUB_BYTES_LIMIT = 768 * 1024 * 1024;
const dubs = new Map();

const dubBytes = (entry) => entry.buffer.byteLength + entry.samples.byteLength;

const keepDub = (dubId, buffer, { sampleRate, samples }) => {
  dubs.delete(dubId);
  dubs.set(dubId, { buffer, sampleRate, samples, usedAt: Date.now(), spans: new Map() });
  let bytes = 0;
  for (const entry of dubs.values()) bytes += dubBytes(entry);
  for (const [id, entry] of dubs) {
    if (bytes <= DUB_BYTES_LIMIT || id === dubId) break;
    bytes -= dubBytes(entry);
    dubs.delete(id);
  }
};

const dubFor = (dubId) => {
  const now = Date.now();
  for (const [id, entry] of dubs) if (now - entry.usedAt > DUB_TTL_MS) dubs.delete(id);
  const entry = dubs.get(dubId);
  if (entry) entry.usedAt = now;
  return entry || null;
};

/** The dub a sync was asked to cut from: `{ dubId, cues: [{ id, text }] }`, the cues as the dub said them, in order. */
const cleanDub = (value) => {
  if (!value || typeof value !== 'object' || !BANK_ID.test(String(value.dubId || '')) || !Array.isArray(value.cues)) return null;
  const cues = value.cues
    .filter((cue) => cue && (typeof cue.id === 'string' || typeof cue.id === 'number') && typeof cue.text === 'string')
    .map((cue) => ({ id: String(cue.id), text: cue.text }));
  return cues.length ? { dubId: value.dubId, cues } : null;
};

/**
 * `dubTakes` for runSync: each unit cut from dub `dub`, where every cue in it
 * still reads as the dub said it. Any failure (another sample rate, words the
 * alignment can't place) leaves every line to be voiced, as before.
 */
const dubTakesWith = ({ dub, segments, sampleRate, apiKey, signal }) => async (units) => {
  const entry = dubFor(dub.dubId);
  if (!entry) return [];
  if (entry.sampleRate !== sampleRate) {
    logger.info(`The dub is at ${entry.sampleRate} Hz and the sync at ${sampleRate} Hz; every line is voiced again.`);
    return [];
  }
  const key = createHash('sha256').update(JSON.stringify(dub.cues)).digest('hex');
  if (!entry.spans.has(key)) {
    try {
      const { words } = await forceAlign({ buffer: entry.buffer, text: alignmentText(dub.cues) }, { apiKey, signal });
      const spans = cueSpans(words, dub.cues);
      if (!spans) logger.info('The dub could not be lined up with its script; every line is voiced again.');
      entry.spans.set(key, spans);
    } catch (err) {
      if (signal?.aborted) throw err;
      logger.warn(`Could not align the dub with its script (${err.message}); every line is voiced again.`);
      return [];
    }
  }
  const spans = entry.spans.get(key);
  if (!spans) return [];
  const dubbed = new Map(dub.cues.map((cue) => [cue.id, cue.text.trim()]));
  const current = new Map(
    segments.map((segment) => [String(segment?.id), String(segment?.textTarget || segment?.targetText || '').trim()])
  );
  return cutDubTakes({
    units,
    spans,
    usable: (id) => dubbed.has(id) && current.get(id) === dubbed.get(id),
    samples: entry.samples,
    sampleRate,
  });
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
 * line on its source phrase, without stretching the voice, changing its gain or
 * fading it.
 *
 * Body: `{ segments, sourceDuration, voiceId, modelId, outputFormat,
 * voiceSettings, language, seed, lineSeeds, precision, join, suggest,
 * suggestLonger, keep, matchLoudness, expressive, performanceTags, steady, debug, jobId }`.
 * As in a dub, `performanceTags` voices each cue's `voiceText` (its text
 * tagged for voice expression Natural) and `expressive` (Expressive) adds
 * delivery cues first; both only on a model that performs tags, and the
 * words are never changed. `steady` (voice expression Neutral) holds every
 * voice calm and even (a Cartesia one at emotion neutral). With `dub` (`{ dubId, cues }`, one voice only) every
 * line that still reads as the Final dub said it is cut from that dub rather
 * than voiced again (see dubTakes.js); a 409 `sync_dub_missing` asks for the
 * dub at PUT /api/sync/dubs/:dubId first. `suggest` and `suggestLonger`
 * (both on unless false) ask for shorter wordings of long lines and fuller
 * wordings of lines that end early, keeping every term in `keep` (the
 * glossary) exactly. `lineSeeds` maps a line's key to the seed
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
      keep,
      matchLoudness,
      tuneStability,
      debug,
      jobId,
      multiSpeaker,
      cast,
      peak,
      locked,
      expressive,
      performanceTags,
      steady,
      dub,
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

    // The Final dub to cut lines from, with one voice only; the app sends it again when this server lost it.
    const fromDub = multiSpeaker === true ? null : cleanDub(dub);
    if (fromDub && !dubFor(fromDub.dubId)) {
      throw new ApiError('The server no longer has the dub to sync from.', { status: 409, code: 'sync_dub_missing' });
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
    const voiceOptions = { requested, seed, steady: steady === true, tuneStability: tuneStability !== false };
    const voice = cartesia
      ? { ...makeVoice({ voiceId, modelId, voiceSettings }, voiceOptions), outputFormat: format }
      : { ...makeVoice({ voiceId, modelId, voiceSettings }, voiceOptions), modelId, outputFormat: format };
    const several = multiSpeaker === true;
    const voiceFor = several ? castVoices(cast, voice, voiceOptions) : undefined;
    // Emotion follows the dub: one voice on a model that performs tags (ElevenLabs) or takes an emotion (Cartesia sonic-3).
    const tags =
      !several &&
      (cartesia ? /^sonic-3/.test(voice.modelId || config.cartesia.ttsModel) : performsTags(voice.modelId || config.elevenlabs.ttsModel));
    const sourceTagged = tags && performanceTags === true;
    if (sourceTagged) voice.performanceTags = true;
    const lineSegments = sourceTagged ? segments : segments.map((segment) => (segment && typeof segment === 'object' ? { ...segment, voiceText: undefined } : segment));
    // Expressive on Cartesia needs no cues: with no emotion set, sonic-3 takes it from the words.
    const cueLines = tags && !cartesia && !sourceTagged && expressive === true ? cueLinesWith({ language, apiKey: textModelKey }) : undefined;
    const voiceWith = voiceLinesWith({ apiKey, cartesiaKey, language, signal: controller.signal });
    // What was changed about the main voice's saved stability, reported with the sync.
    let stabilityAdjustment = cartesia ? null : adjustments.get(adjustmentKey(voice)) ?? null;
    const voiceLines = (lines, { voice: lineVoice, onLine, readCount }) =>
      voiceWith(lines, {
        voice: lineVoice || voice,
        onLine,
        readCount,
        onStabilityAdjustment: (adjustment) => {
          if ((lineVoice || voice) !== voice) return;
          stabilityAdjustment = adjustment;
          adjustments.set(adjustmentKey(voice), adjustment);
        },
      });

    try {
      const result = await runSync(
        {
          segments: lineSegments,
          sourceDuration: Number(sourceDuration) || 0,
          sampleRate,
          precision,
          join,
          suggest: suggest !== false,
          suggestLonger: suggestLonger !== false,
          keep: keepTermsOf(keep),
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
          cue: cueLines,
          dubTakes: fromDub
            ? dubTakesWith({ dub: fromDub, segments, sampleRate, apiKey, signal: controller.signal })
            : undefined,
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
        report: { ...result.report, stabilityAdjustment },
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
 * voiceSettings, language, seed, matchSpeakers, peak, steady, jobId }`, `turns` being
 * `[{ speaker, text, gapAfter }]` in spoken order and `cast` as for /sync.
 * Replies `{ audioId, contentType, stems, report }` as /sync does; progress is
 * polled like a one-voice dub, at /api/elevenlabs/tts/jobs/:jobId.
 */
syncRouter.post(
  '/dub/conversation',
  asyncHandler(async (req, res) => {
    const { turns, cast, voiceId, modelId, outputFormat, voiceSettings, language, seed, matchSpeakers, peak, steady, jobId } = req.body || {};
    if (!Array.isArray(turns) || turns.length === 0) {
      throw new ApiError('There is no dialogue to dub.', { status: 400, code: 'no_turns' });
    }

    const requested = parseOutputFormat(outputFormat) ? outputFormat : FALLBACK_FORMAT;
    const main = makeVoice({ voiceId, modelId, voiceSettings }, { requested, seed, steady: steady === true });
    const voiceFor = castVoices(cast, main, { requested, seed, steady: steady === true });
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

/**
 * POST /api/sync/fit — join settings measured from this video: the speaker's
 * pauses and how much longer the dub runs. Body: `{ segments, join,
 * charsPerSecond, rateMeasured }`. Pure arithmetic on the cues; nothing is
 * applied, the app shows the changes for the user to apply.
 */
syncRouter.post('/sync/fit', (req, res) => {
  const { segments, join, charsPerSecond, rateMeasured } = req.body || {};
  if (!Array.isArray(segments)) throw new ApiError('There are no cues to measure.', { status: 400, code: 'no_segments' });
  res.json(fitJoinSettings({ segments, join, charsPerSecond, rateMeasured: rateMeasured === true }));
});

/** Most earlier wordings a rewording request may list, to be told apart from. */
const MAX_AVOID_LINES = 30;
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

/** Most earlier choices a request may carry as style examples, and the longest line kept. */
const MAX_EXAMPLES = 5;
const MAX_EXAMPLE_CHARS = 300;

/** The user's earlier wordings the request carries, held to short plain pairs. */
const examplesOf = (examples) =>
  Array.isArray(examples)
    ? examples
        .filter((e) => typeof e?.from === 'string' && typeof e?.to === 'string' && e.from.trim() && e.to.trim())
        .filter((e) => e.from.length <= MAX_EXAMPLE_CHARS && e.to.length <= MAX_EXAMPLE_CHARS)
        .map((e) => ({ from: e.from.trim(), to: e.to.trim() }))
        .slice(-MAX_EXAMPLES)
    : [];

/** Most glossary terms a request may name, and the longest one kept. */
const MAX_KEEP_TERMS = 200;
const MAX_KEEP_CHARS = 120;

/** The glossary terms a wording must keep, as the request names them, held to plain short strings. */
const keepTermsOf = (keep) =>
  Array.isArray(keep)
    ? keep
        .filter((term) => typeof term === 'string' && term.trim() && term.length <= MAX_KEEP_CHARS)
        .map((term) => term.trim())
        .slice(0, MAX_KEEP_TERMS)
    : [];

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
    const { text, sourceText, language, targetChars, avoid, count, context, keep, examples } = req.body || {};
    const longer = direction === 'longer';
    if (typeof text !== 'string' || !text.trim()) {
      throw new ApiError(longer ? 'There is no line to make fuller.' : direction === 'same' ? 'There is no line to reword.' : 'There is no line to shorten.', {
        status: 400,
        code: 'no_text',
      });
    }
    const target =
      direction === 'same'
        ? // About the line's own length, and never past what its slot holds.
          rewordLimit(text, targetChars)
        : longer
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
      keep: keepTermsOf(keep),
      examples: examplesOf(examples),
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
    const { line, reason, flagged, backTranslation } = await suggestLine(request, options);
    res.json({ options: line ? [backTranslation ? { line, backTranslation } : { line }] : flagged ? [flagged] : [], line, reason, flagged });
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
 * POST /api/sync/reword — other wordings of a line that already fits, for a
 * user who wants it said another way. Body and reply as for /sync/shorten;
 * `targetChars` is the most its slot holds, and every wording stays about the
 * line's own length. The script is never changed here.
 */
syncRouter.post('/sync/reword', rewordRoute('same'));

/**
 * PUT /api/sync/dubs/:dubId — the Final dub (mono WAV, as the dub gave it),
 * for a sync to cut its lines from.
 */
syncRouter.put(
  '/sync/dubs/:dubId',
  express.raw({ type: () => true, limit: '2gb' }),
  (req, res) => {
    const { dubId } = req.params;
    if (!BANK_ID.test(dubId)) throw new ApiError('That is not a dub id.', { status: 400, code: 'bad_dub_id' });
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    let wav;
    try {
      wav = parseWav(buffer);
    } catch (err) {
      throw new ApiError(`The dub could not be read: ${err.message}`, { status: 400, code: 'bad_dub' });
    }
    keepDub(dubId, buffer, wav);
    res.json({ dubId, samples: wav.samples.length });
  }
);

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
 * parts, sourceDuration, edgeFade, multiSpeaker, peak, original? }`: `lines`
 * as the bank gave them (only `bankStart`, `length`, `maxStartShift`, `gain`
 * and `speaker` are read) and `parts` as checkParts takes them. `original`,
 * `{ bankId, lines }`, holds the clips of the original put on the dub: a bank
 * of their own, sent as a sync's is, its lines numbered after the bank's (a
 * 404 with code `edit_original_missing` when this server doesn't have it).
 * Replies as /sync
 * does, `{ audioId, contentType, stems, report }`, `report` holding the mix
 * report with several speakers. A bank this server no longer has is a 404
 * with code `edit_bank_missing`: send it again and retry.
 */
syncRouter.post(
  '/sync/edit/render',
  asyncHandler(async (req, res) => {
    const { bankId, sampleRate, lines, speakerGains, parts, sourceDuration, edgeFade, multiSpeaker, peak, original } = req.body || {};
    const entry = typeof bankId === 'string' ? bankFor(bankId) : null;
    if (!entry) throw new ApiError('The saved lines of this sync are not on the server.', { status: 404, code: 'edit_bank_missing' });
    if (Number(sampleRate) !== entry.sampleRate) {
      throw new ApiError('The saved lines are at a different sample rate from this sync.', { status: 400, code: 'bank_sample_rate' });
    }
    // Clips of the original on the dub come as a bank of their own, sent like a sync's (PUT /sync/edit/banks/:bankId).
    const originalEntry = original ? (typeof original.bankId === 'string' && BANK_ID.test(original.bankId) ? bankFor(original.bankId) : null) : null;
    if (original && !originalEntry) throw new ApiError('The clips of the original are not on the server.', { status: 404, code: 'edit_original_missing' });
    if (originalEntry && originalEntry.sampleRate !== entry.sampleRate) {
      throw new ApiError('The clips of the original are at a different sample rate from this sync.', { status: 400, code: 'bank_sample_rate' });
    }
    const originalLines = originalEntry
      ? (Array.isArray(original.lines) ? original.lines.slice(0, 20000) : []).map((line, n) => {
          const bankStart = Number(line?.bankStart);
          const length = Number(line?.length);
          if (!Number.isInteger(bankStart) || !Number.isInteger(length) || bankStart < 0 || length < 0 || bankStart + length > originalEntry.samples.length) {
            throw new ApiError(`Clip ${n + 1} of the original is not in its saved samples.`, { status: 400, code: 'bad_bank_line' });
          }
          return { bankStart, length, gain: 1, speaker: ORIGINAL_SPEAKER };
        })
      : [];
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

    // The clips of the original are lines after the bank's, cut from their own samples.
    const renderBank = originalLines.length ? { ...bank, lines: [...bankLines, ...originalLines] } : bank;
    const arrays = originalLines.length
      ? [...entry.arrays, ...originalLines.map((line) => originalEntry.samples.subarray(line.bankStart, line.bankStart + line.length))]
      : entry.arrays;

    let checked;
    try {
      checked = checkParts(parts, renderBank);
    } catch (err) {
      throw new ApiError(`These edits can't be rendered: ${err.message}.`, { status: 400, code: 'bad_edit' });
    }
    const several = multiSpeaker === true;
    // A stretched part is the same until its line, its samples or its speed change.
    const stretch = async (samples, rate, { line, from, to }) => {
      const clip = originalLines[line - bankLines.length];
      const cache = clip ? originalEntry.stretched : entry.stretched;
      const key = clip ? `${clip.bankStart}:${clip.length}:${from}:${to}:${rate}` : `${line}:${from}:${to}:${rate}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const out = await timeStretch(samples, entry.sampleRate, rate);
      cache.set(key, out);
      if (cache.size > STRETCH_CACHE_LIMIT) cache.delete(cache.keys().next().value);
      return out;
    };
    const result = await renderEdits(
      {
        bank: renderBank,
        arrays,
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
