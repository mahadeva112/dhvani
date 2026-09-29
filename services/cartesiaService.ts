import { apiAudio, apiGet, apiUpload } from './apiClient';
import type { Voice } from './elevenLabsService';

/**
 * Cartesia client.
 *
 * Cartesia voices live in the same voice list as ElevenLabs voices. Their IDs
 * carry a `cartesia:` prefix, which is how every caller tells which engine
 * speaks a voice without having to track it separately. The key stays in the
 * backend, like every other key.
 */

export const CARTESIA_VOICE_PREFIX = 'cartesia:';

export const isCartesiaVoice = (voiceId?: string | null): boolean =>
  String(voiceId || '').startsWith(CARTESIA_VOICE_PREFIX);

/** Cartesia accepts 0.6–1.5 for speed; the backend clamps to that as well. */
export const MIN_CARTESIA_SPEED = 0.6;
export const MAX_CARTESIA_SPEED = 1.5;

/** The Cartesia voice library, or [] when no Cartesia key is set up or it cannot be reached. */
export const getCartesiaVoices = async (): Promise<Voice[]> => {
  try {
    const data = await apiGet<{ voices: Voice[] }>('/cartesia/voices');
    return data.voices || [];
  } catch (error) {
    console.error('Error fetching Cartesia voices:', error);
    return [];
  }
};

/**
 * Voices a script with a Cartesia voice. Long scripts are split into passages
 * and joined by the backend; `jobId` makes the dub's progress pollable and
 * cancellable through the same routes as an ElevenLabs dub.
 */
export const synthesizeWithCartesia = (
  voiceId: string,
  text: string,
  {
    outputFormat = 'mp3_44100_128',
    language,
    modelId,
    speed,
    volume,
    emotion,
    matchLoudness = false,
    jobId,
    signal,
  }: {
    outputFormat?: string;
    language?: string;
    /** A Cartesia model id; omitted uses the backend's configured model. */
    modelId?: string;
    /** Only sent when set; otherwise the voice's natural pace is kept. */
    speed?: number;
    /** 0.5–2, sonic-3 models only. */
    volume?: number;
    /** A sonic-3 emotion such as `calm` or `excited`. */
    emotion?: string;
    /** Bring every passage to the same loudness. Off: each keeps the level it was voiced at. */
    matchLoudness?: boolean;
    jobId?: string;
    signal?: AbortSignal;
  } = {}
): Promise<Blob> => {
  const voiceSettings = {
    ...(typeof speed === 'number' ? { speed } : {}),
    ...(typeof volume === 'number' ? { volume } : {}),
    ...(emotion ? { emotion } : {}),
  };
  return apiAudio(
    '/cartesia/tts',
    {
      voiceId,
      text,
      modelId,
      outputFormat,
      language,
      matchLoudness,
      jobId,
      voiceSettings: Object.keys(voiceSettings).length ? voiceSettings : undefined,
    },
    { signal }
  );
};

/** Cartesia TTS models offered in the text-to-speech studio. */
export const CARTESIA_MODELS: { id: string; name: string; description: string }[] = [
  { id: 'sonic-3.6', name: 'Sonic 3.6', description: 'Latest Sonic. 44 languages, speed, volume and emotion controls.' },
  { id: 'sonic-3', name: 'Sonic 3', description: 'Expressive Sonic 3 with speed, volume and emotion controls.' },
  { id: 'sonic-2', name: 'Sonic 2', description: 'Previous generation. Speed, volume and emotion are ignored.' },
  { id: 'sonic-turbo', name: 'Sonic Turbo', description: 'Lowest latency. Speed, volume and emotion are ignored.' },
];

/** Emotions the sonic-3 family can be steered towards. */
export const CARTESIA_EMOTIONS = ['neutral', 'calm', 'content', 'happy', 'excited', 'sad', 'angry', 'scared'];

/**
 * Clones a voice on Cartesia. Cartesia learns from one clip, so only the first
 * sample is sent; `language` is the language the voice will mostly speak.
 */
export const cloneCartesiaVoice = async (
  name: string,
  samples: (File | Blob)[],
  { description, language }: { description?: string; language?: string } = {}
): Promise<{ voice_id: string; name: string }> => {
  const sample = samples[0];
  if (!sample) throw new Error('No audio sample provided for voice cloning.');

  const formData = new FormData();
  formData.append('name', name);
  formData.append('files', sample, sample instanceof File ? sample.name : 'sample.wav');
  if (description) formData.append('description', description);
  if (language) formData.append('language', language);

  return apiUpload('/cartesia/voices/clone', formData);
};
