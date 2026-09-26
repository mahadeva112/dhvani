import fs from 'node:fs';
import { randomInt } from 'node:crypto';
import { config } from '../../env.js';
import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { splitPassages, contextAround, MAX_TTS_CHUNK_CHARS, PASSAGE_PAUSE_SECONDS } from '../../lib/ttsText.js';
import { joinPassages } from '../../lib/audioJoin.js';
import { AUDIO_TAGS, addDeliveryCues } from '../../lib/deliveryCues.js';
import { decodeAudio, encodeAudio, parseOutputFormat } from '../../lib/media.js';
import { cancelledError } from '../../lib/http.js';
import { elevenLabsJson, elevenLabsBinary, elevenLabsMultipart, PROVIDER_LABEL } from './client.js';

/** ElevenLabs accepts 0.7-1.2 for `speed`; anything outside is rejected. */
export const MIN_VOICE_SPEED = 0.7;
export const MAX_VOICE_SPEED = 1.2;

/**
 * Fallback only. A dub normally uses the voice's own settings as saved on
 * ElevenLabs (see getVoiceSettings), which is what the ElevenLabs website does.
 * Speed stays at the model's 1.0: slowing the model down makes it drawl.
 */
export const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
  speed: 1.0,
};

/**
 * Strips SSML tags, speaker labels and bracketed stage directions so the voice
 * model receives plain spoken text. With `keepAudioTags`, the Eleven v3 audio
 * tags in AUDIO_TAGS ([curious], [sighs], ...) stay: v3 performs them.
 */
export const cleanTextForNaturalSpeech = (rawText, { keepAudioTags = false } = {}) => {
  if (!rawText) return '';
  return String(rawText)
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\[[^\]]+\]:\s*/gm, '')
    .replace(/^\([^)]+\):\s*/gm, '')
    .replace(/\[([a-zA-Z0-9_\-\s]+)\]/g, (tag, name) =>
      keepAudioTags && AUDIO_TAGS.includes(name.trim().toLowerCase()) ? tag : ''
    )
    // Collapse runs of spaces/tabs but keep line breaks: ElevenLabs uses them
    // as breathing points, and flattening a multi-cue script onto one line is
    // what makes the read sound rushed.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const clampSpeed = (value) =>
  Math.min(MAX_VOICE_SPEED, Math.max(MIN_VOICE_SPEED, value));

/**
 * `withSpeed` is false for speech-to-speech, where the source recording sets
 * the pacing and ElevenLabs rejects a `speed` in the voice settings.
 */
const normalizeSettings = (settings = {}, { withSpeed = true } = {}) => {
  const normalized = {
    stability:
      typeof settings.stability === 'number' ? settings.stability : DEFAULT_VOICE_SETTINGS.stability,
    similarity_boost:
      typeof settings.similarity_boost === 'number'
        ? settings.similarity_boost
        : DEFAULT_VOICE_SETTINGS.similarity_boost,
    style: typeof settings.style === 'number' ? settings.style : DEFAULT_VOICE_SETTINGS.style,
    use_speaker_boost: settings.use_speaker_boost !== false,
  };

  if (withSpeed) {
    normalized.speed = clampSpeed(
      typeof settings.speed === 'number' && Number.isFinite(settings.speed)
        ? settings.speed
        : DEFAULT_VOICE_SETTINGS.speed
    );
  }

  return normalized;
};

/** The settings a voice was saved with on ElevenLabs. */
export const getVoiceSettings = ({ voiceId, apiKey } = {}) =>
  elevenLabsJson(`/voices/${encodeURIComponent(String(voiceId || '').trim())}/settings`, {
    apiKey,
    timeoutMs: 20000,
  });

/** The legacy v1 models predate the `speed` control and reject it. */
const supportsSpeed = (modelId) => !/_v1$/.test(modelId);

const isV3 = (modelId) => /^eleven_v3/.test(modelId);

/** eleven_v3 does not take previous_text / next_text. */
const supportsContext = (modelId) => !isV3(modelId);

/**
 * Eleven v3 reads stability as a mode: Creative below 0.5, Natural at 0.5 and
 * Robust above, which ElevenLabs describes as "similar to v2" and less
 * responsive to direction — the flat, read-aloud sound. Saved voice settings
 * are usually tuned for v2 and sit above 0.5, so a dub on the voice's own
 * settings is held at Natural. A stability the user set explicitly is kept.
 */
const V3_NATURAL_STABILITY = 0.5;

/**
 * Request stitching: each passage is conditioned on the audio of the ones
 * before it (by request id), so voice and intonation continue across the join.
 * It is ElevenLabs' own answer to splitting a long read into requests, and is
 * not available for eleven_v3 or the legacy v1 models.
 */
const supportsStitching = (modelId) => supportsContext(modelId) && supportsSpeed(modelId);

/** ElevenLabs accepts at most this many previous_request_ids. */
const MAX_STITCHED_REQUESTS = 3;

/**
 * Longest passage per request. eleven_v3 can neither stitch nor take the
 * neighbouring text, so every passage is an independent take and every join a
 * chance for the voice to shift; its passages are made as long as is safe
 * (its hard limit is 5000) so a dub has as few joins as possible. Stitched
 * models join cleanly, so they keep short passages, which avoids the drift of
 * one long generation.
 */
const passageLimit = (modelId) => (isV3(modelId) ? 3000 : MAX_TTS_CHUNK_CHARS);

/** Formats a multi-passage script can be generated in: DHVANI can decode and re-encode them. */
const isJoinable = (outputFormat) => Boolean(parseOutputFormat(outputFormat));

const requireVoiceId = (voiceId) => {
  const cleanVoiceId = String(voiceId || '').trim();
  if (!cleanVoiceId) {
    throw new ApiError('No ElevenLabs voice was selected.', { status: 400, code: 'missing_voice_id' });
  }
  return cleanVoiceId;
};

/**
 * Settings the caller chose, or else the voice's own saved settings. A voice's
 * saved settings are what it sounds like on the ElevenLabs website; replacing
 * them with one fixed set is what made voices sound flat and robotic.
 */
const resolveSettings = async (voiceId, voiceSettings, apiKey) => {
  if (voiceSettings) return voiceSettings;
  try {
    return await getVoiceSettings({ voiceId, apiKey });
  } catch (err) {
    console.warn(`[elevenlabs] Could not load settings for voice ${voiceId}; using defaults.`, err?.message);
    return DEFAULT_VOICE_SETTINGS;
  }
};

/** One text-to-speech request. Returns the raw Response so the route can stream it through. */
export const synthesizeSpeech = async (
  {
    voiceId,
    text,
    modelId,
    outputFormat = 'mp3_44100_128',
    voiceSettings,
    previousText,
    nextText,
    previousRequestIds,
    seed,
  },
  { apiKey, signal, stream = false } = {}
) => {
  const cleanVoiceId = requireVoiceId(voiceId);

  const resolvedModel = modelId || config.elevenlabs.ttsModel;
  const cleanText = cleanTextForNaturalSpeech(text, { keepAudioTags: isV3(resolvedModel) });
  if (!cleanText) {
    throw new ApiError('There is no dialogue text to synthesize.', { status: 400, code: 'empty_text' });
  }

  const settings = await resolveSettings(cleanVoiceId, voiceSettings, apiKey);

  // The streaming endpoint takes the same body and sends audio as it is generated.
  return elevenLabsBinary(
    `/text-to-speech/${encodeURIComponent(cleanVoiceId)}${stream ? '/stream' : ''}?output_format=${encodeURIComponent(outputFormat)}`,
    {
      text: cleanText,
      model_id: resolvedModel,
      voice_settings: normalizeSettings(settings, { withSpeed: supportsSpeed(resolvedModel) }),
      ...(supportsContext(resolvedModel) && previousText ? { previous_text: previousText } : {}),
      ...(supportsContext(resolvedModel) && nextText ? { next_text: nextText } : {}),
      ...(supportsStitching(resolvedModel) && previousRequestIds?.length
        ? { previous_request_ids: previousRequestIds.slice(-MAX_STITCHED_REQUESTS) }
        : {}),
      ...(Number.isInteger(seed) ? { seed } : {}),
    },
    { apiKey, signal }
  );
};

/** Seconds of audio in `bytes` of the given output format, or null when it can't be told. */
export const secondsOfAudio = (bytes, outputFormat) => {
  const format = parseOutputFormat(outputFormat);
  if (!format) return null;
  if (format.codec === 'mp3') return format.bitrate ? (bytes * 8) / (format.bitrate * 1000) : null;
  if (format.codec === 'pcm') return bytes / (format.sampleRate * 2);
  return bytes / format.sampleRate; // ulaw and alaw: one byte per sample
};

/** Statuses that mean "this model or account can't stream", as opposed to a real failure. */
const STREAM_UNSUPPORTED = new Set([400, 404, 405, 422]);

/**
 * Voices one passage, streaming it so `onBytes` can report progress as audio
 * arrives. Falls back to the plain request when streaming is refused.
 */
const synthesizePassage = async (request, { apiKey, signal, onBytes, streamState }) => {
  if (streamState.enabled) {
    try {
      const response = await synthesizeSpeech(request, { apiKey, signal, stream: true });
      const chunks = [];
      let received = 0;
      for await (const chunk of response.body) {
        if (signal?.aborted) throw cancelledError(PROVIDER_LABEL);
        chunks.push(Buffer.from(chunk));
        received += chunk.length;
        onBytes(received);
      }
      return { response, buffer: Buffer.concat(chunks) };
    } catch (err) {
      if (signal?.aborted) throw cancelledError(PROVIDER_LABEL);
      if (!(err instanceof ApiError) || !STREAM_UNSUPPORTED.has(err.status)) throw err;
      logger.warn(`ElevenLabs refused to stream (${err.status} ${err.code}); voicing the rest without live progress.`);
      streamState.enabled = false;
      onBytes(0); // report the switch now, not once the whole passage is back
    }
  }
  const response = await synthesizeSpeech(request, { apiKey, signal });
  const buffer = Buffer.from(await response.arrayBuffer());
  onBytes(buffer.length);
  return { response, buffer };
};

/** Passages generated at once when they don't stitch; ElevenLabs' lowest paid tiers allow 2-3 concurrent requests. */
const SCRIPT_CONCURRENCY = 2;

/**
 * Joins the passages' audio into one file with a lead-in and run-out (see
 * audioJoin.js). Without ffmpeg the files are appended as they are, which
 * plays but leaves the joins and the ending abrupt.
 */
const joinAudio = async (parts, passages, outputFormat) => {
  try {
    const decoded = await Promise.all(parts.map((part) => decodeAudio(part, outputFormat)));
    const joined = joinPassages(decoded, {
      sampleRate: parseOutputFormat(outputFormat).sampleRate,
      pauses: passages.slice(0, -1).map((passage) => PASSAGE_PAUSE_SECONDS[passage.breakAfter] ?? 0),
    });
    return await encodeAudio(joined, outputFormat);
  } catch (err) {
    logger.warn(`Could not join dub passages smoothly (${err.message}); appending them as generated.`);
    return Buffer.concat(parts);
  }
};

/**
 * Text-to-speech for a whole dub script.
 *
 * A long script is generated passage by passage and joined into one file.
 * Every passage shares one seed so the voice is sampled the same way
 * throughout; on models that support it, each is also stitched to the audio
 * before it and told the text either side.
 *
 * With `expressive`, a v3 dub gets delivery cues first (see deliveryCues.js)
 * so it is performed rather than read. Returns `{ contentType, buffer }`.
 */
export const synthesizeScript = async (
  { voiceId, text, modelId, outputFormat = 'mp3_44100_128', voiceSettings, expressive = false, language },
  { apiKey, textModelKey, signal, onProgress = () => {} } = {}
) => {
  const cleanVoiceId = requireVoiceId(voiceId);
  const cleanText = cleanTextForNaturalSpeech(text);
  if (!cleanText) {
    throw new ApiError('There is no dialogue text to synthesize.', { status: 400, code: 'empty_text' });
  }

  const resolvedModel = modelId || config.elevenlabs.ttsModel;
  const passages = isJoinable(outputFormat)
    ? splitPassages(cleanText, passageLimit(resolvedModel))
    : [{ text: cleanText, breakAfter: null }];
  let chunks = passages.map((passage) => passage.text);
  // Progress is counted against the script as written, before any delivery cues are added.
  const passageChars = passages.map((passage) => passage.text.length);
  const totalChars = passageChars.reduce((sum, n) => sum + n, 0);
  onProgress({ phase: 'preparing', passageCount: chunks.length, passagesDone: 0, totalChars, charsDone: 0, secondsGenerated: 0 });

  if (expressive && isV3(resolvedModel)) {
    chunks = await Promise.all(chunks.map((chunk) => addDeliveryCues(chunk, { language, apiKey: textModelKey })));
  }
  if (signal?.aborted) throw cancelledError(PROVIDER_LABEL);

  // Load the voice's settings once instead of once per passage.
  let settings = await resolveSettings(cleanVoiceId, voiceSettings, apiKey);
  if (isV3(resolvedModel) && !voiceSettings && (settings.stability ?? V3_NATURAL_STABILITY) > V3_NATURAL_STABILITY) {
    settings = { ...settings, stability: V3_NATURAL_STABILITY };
  }
  const seed = randomInt(0, 2 ** 32 - 1);

  const parts = new Array(chunks.length);
  let contentType = 'audio/mpeg';
  const requestIds = [];
  const bytesPerPassage = new Array(chunks.length).fill(0);
  const finished = new Array(chunks.length).fill(false);
  const streamState = { enabled: true };

  const report = () =>
    onProgress({
      phase: 'voicing',
      passageCount: chunks.length,
      passagesDone: finished.filter(Boolean).length,
      totalChars,
      charsDone: passageChars.reduce((sum, n, i) => sum + (finished[i] ? n : 0), 0),
      secondsGenerated: bytesPerPassage.reduce((sum, bytes) => sum + (secondsOfAudio(bytes, outputFormat) || 0), 0),
      streaming: streamState.enabled,
    });
  report();

  const generate = async (index) => {
    const { response, buffer } = await synthesizePassage(
      {
        voiceId: cleanVoiceId,
        text: chunks[index],
        modelId: resolvedModel,
        outputFormat,
        voiceSettings: settings,
        seed,
        previousRequestIds: requestIds.slice(0, index).filter(Boolean),
        ...contextAround(chunks, index),
      },
      {
        apiKey,
        signal,
        streamState,
        onBytes: (bytes) => {
          bytesPerPassage[index] = bytes;
          report();
        },
      }
    );
    if (index === 0) contentType = response.headers.get('content-type') || contentType;
    // A stitched request may only reference a generation that has fully arrived.
    parts[index] = buffer;
    requestIds[index] = response.headers.get('request-id') || null;
    finished[index] = true;
    report();
  };

  if (supportsStitching(resolvedModel)) {
    // Stitching needs each passage finished before the next one starts.
    for (let index = 0; index < chunks.length; index++) await generate(index);
  } else {
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) await generate(next++);
    };
    await Promise.all(Array.from({ length: Math.min(SCRIPT_CONCURRENCY, chunks.length) }, worker));
  }

  if (signal?.aborted) throw cancelledError(PROVIDER_LABEL);
  onProgress({ phase: 'joining', passageCount: chunks.length, passagesDone: chunks.length, totalChars, charsDone: totalChars });
  // Even a one-passage dub goes through the join for its lead-in and run-out.
  const buffer = isJoinable(outputFormat) ? await joinAudio(parts, passages, outputFormat) : parts[0];
  return { contentType, buffer };
};

/** Speech-to-speech voice conversion. */
export const speechToSpeech = async (
  { voiceId, file, modelId = 'eleven_multilingual_sts_v2', voiceSettings, removeBackgroundNoise },
  { apiKey } = {}
) => {
  const cleanVoiceId = requireVoiceId(voiceId);
  if (!file) {
    throw new ApiError('No source audio was uploaded for voice conversion.', {
      status: 400,
      code: 'no_file',
    });
  }

  const form = new FormData();
  form.append(
    'audio',
    new Blob([await fs.promises.readFile(file.path)], { type: file.mimetype || 'audio/wav' }),
    file.originalname || 'audio.wav'
  );
  form.append('model_id', modelId);
  if (voiceSettings) {
    form.append('voice_settings', JSON.stringify(normalizeSettings(voiceSettings, { withSpeed: false })));
  }
  if (removeBackgroundNoise !== undefined) {
    form.append('remove_background_noise', String(removeBackgroundNoise));
  }

  return elevenLabsMultipart(`/speech-to-speech/${encodeURIComponent(cleanVoiceId)}`, form, { apiKey });
};

/** Creates a cloned voice from one or more audio samples. */
export const cloneVoice = async ({ name, files, description, labels }, { apiKey } = {}) => {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    throw new ApiError('A name is required for the cloned voice.', { status: 400, code: 'missing_name' });
  }
  if (!files || files.length === 0) {
    throw new ApiError('Upload at least one audio sample to clone a voice.', {
      status: 400,
      code: 'no_samples',
    });
  }

  const form = new FormData();
  form.append('name', cleanName);
  for (const [index, file] of files.entries()) {
    form.append(
      'files',
      new Blob([await fs.promises.readFile(file.path)], { type: file.mimetype || 'audio/wav' }),
      file.originalname || `sample_${index}.wav`
    );
  }
  if (description) form.append('description', description);
  if (labels) form.append('labels', typeof labels === 'string' ? labels : JSON.stringify(labels));

  const response = await elevenLabsMultipart('/voices/add', form, { apiKey });
  const data = await response.json();

  if (!data.voice_id) {
    throw new ApiError('ElevenLabs did not return a voice ID for the cloned voice.', {
      status: 502,
      code: 'clone_failed',
      provider: 'elevenlabs',
    });
  }

  return { voice_id: data.voice_id, name: cleanName };
};

/**
 * Account lookup, also used as the key check on the settings screen.
 *
 * `baseUrl` lets that check run against a candidate endpoint the user is still
 * typing, rather than the one currently configured.
 */
export const getUser = ({ apiKey, baseUrl } = {}) =>
  elevenLabsJson('/user', { apiKey, baseUrl, timeoutMs: 20000 });

export const getVoices = async ({ apiKey } = {}) => {
  const data = await elevenLabsJson('/voices', { apiKey, timeoutMs: 30000 });
  const voices = Array.isArray(data.voices) ? data.voices : [];
  return voices.sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
  );
};

export const getModels = async ({ apiKey } = {}) => {
  const data = await elevenLabsJson('/models', { apiKey, timeoutMs: 30000 });
  const models = Array.isArray(data) ? data : data.models || [];
  return models.filter((model) => model.can_do_text_to_speech !== false);
};
