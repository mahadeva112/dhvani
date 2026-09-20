import fs from 'node:fs';
import { config } from '../../env.js';
import { ApiError } from '../../errors.js';
import { elevenLabsJson, elevenLabsBinary, elevenLabsMultipart } from './client.js';

export const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
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
    .replace(/\s+/g, ' ')
    .trim();
};

const normalizeSettings = (settings = {}) => ({
  stability: typeof settings.stability === 'number' ? settings.stability : DEFAULT_VOICE_SETTINGS.stability,
  similarity_boost:
    typeof settings.similarity_boost === 'number'
      ? settings.similarity_boost
      : DEFAULT_VOICE_SETTINGS.similarity_boost,
  style: typeof settings.style === 'number' ? settings.style : DEFAULT_VOICE_SETTINGS.style,
  use_speaker_boost: settings.use_speaker_boost !== false,
});

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

  return elevenLabsBinary(
    `/text-to-speech/${encodeURIComponent(cleanVoiceId)}?output_format=${encodeURIComponent(outputFormat)}`,
    {
      text: cleanText,
      model_id: modelId || config.elevenlabs.ttsModel,
      voice_settings: normalizeSettings(voiceSettings),
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
  if (voiceSettings) form.append('voice_settings', JSON.stringify(normalizeSettings(voiceSettings)));
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
