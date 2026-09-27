import fs from 'node:fs';
import { config } from '../../env.js';
import { ApiError } from '../../errors.js';
import { logger } from '../../logger.js';
import { requestWithRetry, cancelledError } from '../../lib/http.js';
import { splitPassages, MAX_TTS_CHUNK_CHARS, PASSAGE_PAUSE_SECONDS } from '../../lib/ttsText.js';
import { joinPassages } from '../../lib/audioJoin.js';
import { decodeAudio, encodeAudio, parseOutputFormat } from '../../lib/media.js';
import { cleanTextForNaturalSpeech, secondsOfAudio } from '../elevenlabs/speech.js';
import {
  cartesiaJson,
  cartesiaBinary,
  cartesiaMultipart,
  cartesiaFetch,
  toCartesiaVoiceId,
  toDhvaniVoiceId,
  toCartesiaLanguage,
  PROVIDER_LABEL,
} from './client.js';

/** Cartesia accepts 0.6-1.5 for `generation_config.speed`. */
export const MIN_CARTESIA_SPEED = 0.6;
export const MAX_CARTESIA_SPEED = 1.5;

/** Sample rates Cartesia can produce. */
const SAMPLE_RATES = [8000, 16000, 22050, 24000, 44100, 48000];
const MP3_BIT_RATES = [32000, 64000, 96000, 128000, 192000];

const nearest = (value, options) =>
  options.reduce((best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best));

/**
 * The app names formats the ElevenLabs way (`mp3_44100_128`, `pcm_24000`).
 * Returns the Cartesia `output_format` for one, plus the DHVANI format string
 * that describes what actually comes back (a rate Cartesia lacks is rounded).
 */
export const toCartesiaOutputFormat = (outputFormat = 'mp3_44100_128') => {
  const parsed = parseOutputFormat(outputFormat) || { codec: 'mp3', sampleRate: 44100, bitrate: 128 };
  const sampleRate = nearest(parsed.sampleRate, SAMPLE_RATES);

  if (parsed.codec === 'pcm') {
    return {
      body: { container: 'raw', encoding: 'pcm_s16le', sample_rate: sampleRate },
      format: `pcm_${sampleRate}`,
      contentType: 'audio/pcm',
    };
  }
  if (parsed.codec === 'ulaw' || parsed.codec === 'alaw') {
    return {
      body: { container: 'raw', encoding: parsed.codec === 'ulaw' ? 'pcm_mulaw' : 'pcm_alaw', sample_rate: sampleRate },
      format: `${parsed.codec}_${sampleRate}`,
      contentType: 'audio/basic',
    };
  }
  const bitRate = nearest((parsed.bitrate || 128) * 1000, MP3_BIT_RATES);
  return {
    body: { container: 'mp3', sample_rate: sampleRate, bit_rate: bitRate },
    format: `mp3_${sampleRate}_${bitRate / 1000}`,
    contentType: 'audio/mpeg',
  };
};

const requireVoiceId = (voiceId) => {
  const id = toCartesiaVoiceId(voiceId);
  if (!id) throw new ApiError('No Cartesia voice was selected.', { status: 400, code: 'missing_voice_id' });
  return id;
};

/**
 * Speed, volume and emotion, for the sonic-3 family (the only models that
 * take generation_config). Unset values are left for the model to choose.
 */
const generationConfig = (settings = {}, modelId) => {
  if (!/^sonic-3/.test(modelId || '')) return undefined;
  const out = {};
  if (typeof settings.speed === 'number' && Number.isFinite(settings.speed)) {
    out.speed = Math.min(MAX_CARTESIA_SPEED, Math.max(MIN_CARTESIA_SPEED, settings.speed));
  }
  if (typeof settings.volume === 'number' && Number.isFinite(settings.volume)) {
    out.volume = Math.min(2, Math.max(0.5, settings.volume));
  }
  if (typeof settings.emotion === 'string' && settings.emotion.trim()) out.emotion = settings.emotion.trim();
  return Object.keys(out).length ? out : undefined;
};

/** One text-to-speech request. Returns the raw Response. */
export const synthesizeSpeech = async (
  { voiceId, text, modelId, outputFormat = 'mp3_44100_128', language, voiceSettings },
  { apiKey, signal } = {}
) => {
  const id = requireVoiceId(voiceId);
  const transcript = cleanTextForNaturalSpeech(text);
  if (!transcript) {
    throw new ApiError('There is no dialogue text to synthesize.', { status: 400, code: 'empty_text' });
  }
  const model = modelId || config.cartesia.ttsModel;
  const code = toCartesiaLanguage(language);
  const generation = generationConfig(voiceSettings, model);

  return cartesiaBinary(
    '/tts/bytes',
    {
      model_id: model,
      transcript,
      voice: { id },
      output_format: toCartesiaOutputFormat(outputFormat).body,
      ...(code ? { language: code } : {}),
      ...(generation ? { generation_config: generation } : {}),
    },
    { apiKey, signal }
  );
};

/** Passages voiced at once; Cartesia's lower plans allow a few concurrent requests. */
const SCRIPT_CONCURRENCY = 2;

/** Joins passages with the same lead-in, pauses and run-out as an ElevenLabs dub. */
const joinAudio = async (parts, passages, format) => {
  try {
    const decoded = await Promise.all(parts.map((part) => decodeAudio(part, format)));
    const joined = joinPassages(decoded, {
      sampleRate: parseOutputFormat(format).sampleRate,
      pauses: passages.slice(0, -1).map((passage) => PASSAGE_PAUSE_SECONDS[passage.breakAfter] ?? 0),
    });
    return await encodeAudio(joined, format);
  } catch (err) {
    logger.warn(`Could not join Cartesia passages smoothly (${err.message}); appending them as generated.`);
    return Buffer.concat(parts);
  }
};

/**
 * Text-to-speech for a whole dub script, passage by passage, joined into one
 * file. Reports progress in the same shape as the ElevenLabs dub so the UI's
 * progress bar and cancel button work unchanged. Returns `{ contentType, buffer }`.
 */
export const synthesizeScript = async (
  { voiceId, text, modelId, outputFormat = 'mp3_44100_128', language, voiceSettings },
  { apiKey, signal, onProgress = () => {} } = {}
) => {
  requireVoiceId(voiceId);
  const cleanText = cleanTextForNaturalSpeech(text);
  if (!cleanText) {
    throw new ApiError('There is no dialogue text to synthesize.', { status: 400, code: 'empty_text' });
  }

  const { format, contentType } = toCartesiaOutputFormat(outputFormat);
  const passages = splitPassages(cleanText, MAX_TTS_CHUNK_CHARS);
  const chunks = passages.map((passage) => passage.text);
  const passageChars = chunks.map((chunk) => chunk.length);
  const totalChars = passageChars.reduce((sum, n) => sum + n, 0);

  const parts = new Array(chunks.length);
  const finished = new Array(chunks.length).fill(false);
  const bytesPerPassage = new Array(chunks.length).fill(0);

  const report = (phase = 'voicing') =>
    onProgress({
      phase,
      passageCount: chunks.length,
      passagesDone: finished.filter(Boolean).length,
      totalChars,
      charsDone: passageChars.reduce((sum, n, i) => sum + (finished[i] ? n : 0), 0),
      secondsGenerated: bytesPerPassage.reduce((sum, bytes) => sum + (secondsOfAudio(bytes, format) || 0), 0),
      streaming: false,
    });
  report('preparing');
  report();

  const generate = async (index) => {
    const response = await synthesizeSpeech(
      { voiceId, text: chunks[index], modelId, outputFormat: format, language, voiceSettings },
      { apiKey, signal }
    );
    parts[index] = Buffer.from(await response.arrayBuffer());
    bytesPerPassage[index] = parts[index].length;
    finished[index] = true;
    report();
  };

  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      if (signal?.aborted) throw cancelledError(PROVIDER_LABEL);
      await generate(next++);
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCRIPT_CONCURRENCY, chunks.length) }, worker));

  if (signal?.aborted) throw cancelledError(PROVIDER_LABEL);
  report('joining');
  const buffer = await joinAudio(parts, passages, format);
  return { contentType, buffer };
};

/* --------------------------------------------------------------------- */
/* Voices                                                                 */
/* --------------------------------------------------------------------- */

/** Preview URLs from the last voice listing, so a preview needs no extra lookup. */
const previewUrls = new Map();

const GENDERS = { feminine: 'female', masculine: 'male', gender_neutral: 'neutral' };

/**
 * Reshapes a Cartesia voice into the voice shape the app already renders
 * (ElevenLabs' fields), so one picker, one search and one favourites list
 * cover both engines.
 */
const toAppVoice = (voice) => {
  const accent = Array.isArray(voice.accents) ? voice.accents.find((a) => a?.is_native) || voice.accents[0] : null;
  const locale = accent?.locale || voice.language || '';
  return {
    voice_id: toDhvaniVoiceId(voice.id),
    name: voice.name || voice.id,
    category: voice.is_owner ? 'cloned' : 'premade',
    provider: 'cartesia',
    labels: {
      gender: GENDERS[voice.gender] || voice.gender || '',
      accent: accent?.accent || voice.country || '',
      language: String(locale).split(/[-_]/)[0] || '',
      description: voice.tagline || voice.description || '',
    },
    preview_url: `/api/cartesia/voices/${encodeURIComponent(voice.id)}/preview`,
    verified_languages: (voice.accents || [])
      .filter((a) => a?.locale)
      .map((a) => ({ language: String(a.locale).split(/[-_]/)[0], locale: a.locale, accent: a.accent })),
  };
};

/** Pages through the whole voice library. Capped so a runaway cursor cannot loop forever. */
const MAX_VOICE_PAGES = 40;

export const getVoices = async ({ apiKey } = {}) => {
  const voices = [];
  let cursor = null;
  for (let page = 0; page < MAX_VOICE_PAGES; page++) {
    const query = new URLSearchParams({ limit: '100' });
    query.append('expand[]', 'preview_file_url');
    if (cursor) query.set('starting_after', cursor);
    const data = await cartesiaJson(`/voices?${query}`, { apiKey, timeoutMs: 30000 });
    const batch = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
    voices.push(...batch);
    const nextCursor = data?.next_page || batch.at(-1)?.id || null;
    if (!data?.has_more || !nextCursor || batch.length === 0) break;
    cursor = nextCursor;
  }

  for (const voice of voices) {
    if (voice.preview_file_url) previewUrls.set(voice.id, voice.preview_file_url);
  }
  return voices
    .filter((voice) => voice.status !== 'archived')
    .map(toAppVoice)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
};

/** One voice, used to look up a preview the listing did not include. */
export const getVoice = ({ voiceId, apiKey } = {}) =>
  cartesiaJson(`/voices/${encodeURIComponent(requireVoiceId(voiceId))}?expand[]=preview_file_url`, {
    apiKey,
    timeoutMs: 20000,
  });

/**
 * A voice's preview clip. Cartesia serves previews behind the API key, so the
 * browser cannot load them itself; the key is only sent to Cartesia's own hosts.
 */
export const fetchVoicePreview = async ({ voiceId, apiKey } = {}) => {
  const id = requireVoiceId(voiceId);
  let previewUrl = previewUrls.get(id);
  if (!previewUrl) {
    previewUrl = (await getVoice({ voiceId: id, apiKey }))?.preview_file_url;
    if (previewUrl) previewUrls.set(id, previewUrl);
  }
  if (!previewUrl) {
    throw new ApiError('This Cartesia voice has no preview clip.', { status: 404, code: 'no_preview', provider: 'cartesia' });
  }

  const host = (() => {
    try {
      return new URL(previewUrl).hostname;
    } catch {
      return '';
    }
  })();
  return /(^|\.)cartesia\.ai$/i.test(host)
    ? cartesiaFetch(previewUrl, { apiKey })
    : requestWithRetry(previewUrl, { method: 'GET' }, { provider: PROVIDER_LABEL, timeoutMs: 30000, retries: 1 });
};

/** Cartesia accepts one clip of up to 16 MB per clone. */
const MAX_CLONE_BYTES = 16 * 1024 * 1024;

/**
 * Clones a voice from a sample. Cartesia takes a single clip, so the first
 * sample is used; `language` is required and defaults to the dub language.
 */
export const cloneVoice = async ({ name, files, description, language }, { apiKey } = {}) => {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    throw new ApiError('A name is required for the cloned voice.', { status: 400, code: 'missing_name' });
  }
  const file = files?.[0];
  if (!file) {
    throw new ApiError('Upload an audio sample to clone a voice.', { status: 400, code: 'no_samples' });
  }
  if (file.size > MAX_CLONE_BYTES) {
    throw new ApiError('Cartesia accepts clone samples of up to 16 MB. Trim the sample and try again.', {
      status: 413,
      code: 'payload_too_large',
      provider: 'cartesia',
    });
  }

  const form = new FormData();
  form.append(
    'clip',
    new Blob([await fs.promises.readFile(file.path)], { type: file.mimetype || 'audio/wav' }),
    file.originalname || 'sample.wav'
  );
  form.append('name', cleanName);
  form.append('language', toCartesiaLanguage(language) || String(language || '').trim().toLowerCase() || 'en');
  if (description) form.append('description', String(description));

  const response = await cartesiaMultipart('/voices/clone', form, { apiKey, timeoutMs: 180000 });
  const data = await response.json();
  if (!data?.id) {
    throw new ApiError('Cartesia did not return a voice ID for the cloned voice.', {
      status: 502,
      code: 'clone_failed',
      provider: 'cartesia',
    });
  }
  return { voice_id: toDhvaniVoiceId(data.id), name: data.name || cleanName };
};

/** Key check for the settings screen: one cheap authenticated call. */
export const checkKey = async ({ apiKey, baseUrl } = {}) => {
  await cartesiaJson('/voices?limit=1', { apiKey, baseUrl, timeoutMs: 20000 });
  return { valid: true };
};
