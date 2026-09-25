import fs from 'node:fs';
import { config } from '../../env.js';
import { ApiError } from '../../errors.js';
import { elevenLabsJson, elevenLabsBinary, elevenLabsMultipart } from './client.js';

/** ElevenLabs accepts 0.7-1.2 for `speed`; anything outside is rejected. */
export const MIN_VOICE_SPEED = 0.7;
export const MAX_VOICE_SPEED = 1.2;

export const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
  // The raw model default (1.0) reads dubbing cues noticeably faster than a
  // human narrator. 0.9 lands on an unhurried, natural delivery out of the box.
  speed: 0.9,
};

/**
 * Strips SSML tags, speaker labels and bracketed stage directions so the voice
 * model receives plain spoken text.
 */
export const cleanTextForNaturalSpeech = (rawText) => {
  if (!rawText) return '';
  return String(rawText)
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\[[^\]]+\]:\s*/gm, '')
    .replace(/^\([^)]+\):\s*/gm, '')
    .replace(/\[[a-zA-Z0-9_\-\s]+\]/g, '')
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

/** Text-to-speech. Returns the raw Response so the route can stream it through. */
export const synthesizeSpeech = async (
  { voiceId, text, modelId, outputFormat = 'mp3_44100_128', voiceSettings },
  { apiKey } = {}
) => {
  const cleanVoiceId = String(voiceId || '').trim();
  if (!cleanVoiceId) {
    throw new ApiError('No ElevenLabs voice was selected.', { status: 400, code: 'missing_voice_id' });
  }

  const cleanText = cleanTextForNaturalSpeech(text);
  if (!cleanText) {
    throw new ApiError('There is no dialogue text to synthesize.', { status: 400, code: 'empty_text' });
  }

  const resolvedModel = modelId || config.elevenlabs.ttsModel;

  return elevenLabsBinary(
    `/text-to-speech/${encodeURIComponent(cleanVoiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
    {
      text: cleanText,
      model_id: resolvedModel,
      // The legacy v1 models predate the `speed` control and reject it.
      voice_settings: normalizeSettings(voiceSettings, { withSpeed: !/_v1$/.test(resolvedModel) }),
    },
    { apiKey }
  );
};

/** Speech-to-speech voice conversion. */
export const speechToSpeech = async (
  { voiceId, file, modelId = 'eleven_multilingual_sts_v2', voiceSettings, removeBackgroundNoise },
  { apiKey } = {}
) => {
  const cleanVoiceId = String(voiceId || '').trim();
  if (!cleanVoiceId) {
    throw new ApiError('No ElevenLabs voice was selected.', { status: 400, code: 'missing_voice_id' });
  }
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
