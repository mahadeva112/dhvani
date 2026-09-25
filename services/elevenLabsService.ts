import { apiAudio, apiAudioUpload, apiGet, apiUpload, DhvaniApiError } from './apiClient';

/**
 * ElevenLabs client.
 *
 * Every call goes through the local backend, which holds ELEVENLABS_API_KEY.
 * The `apiKey` parameter is kept on each function so existing callers are
 * unchanged; it is now an optional override that is only sent when the user
 * typed a personal key into the settings screen.
 */

export interface ElevenLabsVoiceSettings {
  stability: number;
  similarity_boost: number;
  style?: number;
  use_speaker_boost?: boolean;
  /** ElevenLabs speaking rate. 1.0 is the model default; below 1.0 is slower. */
  speed?: number;
}

/** ElevenLabs accepts 0.7–1.2 for `speed`; anything outside is rejected. */
export const MIN_VOICE_SPEED = 0.7;
export const MAX_VOICE_SPEED = 1.2;

/**
 * Shown only while a voice's own settings are loading or unavailable. A dub
 * normally uses the voice's own ElevenLabs settings (see getVoiceSettings),
 * which is what the ElevenLabs website does. Speed stays at the model's 1.0:
 * slowing the model down makes it drawl and sound mechanical.
 */
export const DEFAULT_VOICE_SETTINGS: ElevenLabsVoiceSettings = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
  speed: 1.0,
};

const keys = (apiKey?: string) => ({ keys: { elevenLabsKey: apiKey } });

/**
 * Cleans legacy XML/SSML tags, bracketed directives and speaker labels so that
 * ElevenLabs receives pure, natural, human-readable text.
 *
 * The backend applies the same cleanup; this copy keeps client-side previews
 * (character counts, script views) consistent with what will be spoken.
 */
export const cleanTextForNaturalSpeech = (rawText: string): string => {
  if (!rawText) return '';
  return rawText
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\[[^\]]+\]:\s*/gm, '')
    .replace(/^\([^)]+\):\s*/gm, '')
    .replace(/\[[a-zA-Z0-9_\-\s]+\]/g, '')
    // Collapse runs of spaces/tabs but keep line breaks: ElevenLabs uses them
    // as breathing points, and flattening everything to one line is what makes
    // a multi-cue script sound rushed.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Synthesizes speech. The signature is unchanged from the original AI Studio
 * build so every existing call site keeps working.
 */
export const synthesizeSpeech = async (
  apiKey: string,
  voiceId: string,
  text: string,
  modelId: string = 'eleven_v3',
  outputFormat: string = 'mp3_44100_128',
  /** Null uses the voice's own ElevenLabs settings. */
  voiceSettings: ElevenLabsVoiceSettings | null = null
): Promise<Blob> => {
  const cleanText = cleanTextForNaturalSpeech(text);
  if (!cleanText) throw new Error('No dialogue text provided for synthesis.');

  return apiAudio(
    '/elevenlabs/tts',
    { voiceId, text: cleanText, modelId, outputFormat, voiceSettings: voiceSettings || undefined },
    keys(apiKey)
  );
};

/** The settings a voice was saved with on ElevenLabs — how it sounds on the website. */
export const getVoiceSettings = async (
  apiKey: string,
  voiceId: string
): Promise<ElevenLabsVoiceSettings> => {
  const data = await apiGet<{ settings: ElevenLabsVoiceSettings }>(
    `/elevenlabs/voices/${encodeURIComponent(voiceId)}/settings`,
    keys(apiKey)
  );
  return { ...DEFAULT_VOICE_SETTINGS, ...data.settings };
};

export interface Voice {
  voice_id: string;
  name: string;
  category: string;
  labels?: {
    accent?: string;
    description?: string;
    age?: string;
    gender?: string;
    use_case?: string;
    [key: string]: string | undefined;
  };
  preview_url?: string;
  high_quality_base_model_ids?: string[];
  /** Languages ElevenLabs has verified the voice in, e.g. `{ language: 'hi', locale: 'hi-IN' }`. */
  verified_languages?: { language?: string; accent?: string; locale?: string | null }[];
}

export interface ElevenLabsModel {
  model_id: string;
  name: string;
  description?: string;
  can_be_finetuned?: boolean;
  can_do_text_to_speech?: boolean;
  can_do_voice_conversion?: boolean;
  can_use_style?: boolean;
  can_use_speaker_boost?: boolean;
  token_cost_factor?: number;
  languages?: Array<{ language_id: string; name: string }>;
  max_characters_request_free_user?: number;
  max_characters_request_subscribed_user?: number;
}

export interface ElevenLabsSubscription {
  tier: string;
  character_count: number;
  character_limit: number;
  status: string;
  next_character_count_reset_unix?: number;
  voice_limit?: number;
  max_voice_add_edits?: number;
}

export interface ElevenLabsUser {
  subscription: ElevenLabsSubscription;
  is_new_user?: boolean;
  first_name?: string;
}

export interface ValidationResponse {
  isValid: boolean;
  user?: ElevenLabsUser;
  error?: string;
  /** True when the backend supplied the key, so the user need not enter one. */
  serverManaged?: boolean;
}

/** Offline catalog used when the live model list cannot be fetched. */
export const ALL_ELEVENLABS_MODELS: ElevenLabsModel[] = [
  {
    model_id: 'eleven_v3',
    name: 'Eleven v3',
    description:
      'The most expressive model, supporting 70+ languages. The Speaking Speed slider has no effect on it.',
    can_do_text_to_speech: true,
    token_cost_factor: 1.0,
  },
  {
    model_id: 'eleven_multilingual_v2',
    name: 'Eleven Multilingual v2',
    description: 'Cutting-edge multilingual speech synthesis supporting 29 languages with authentic emotions & accents.',
    can_do_text_to_speech: true,
    token_cost_factor: 1.0,
  },
  {
    model_id: 'eleven_flash_v2_5',
    name: 'Eleven Flash v2.5',
    description: 'Ultra-low latency (~75ms) multilingual synthesis optimized for real-time applications and conversational speed.',
    can_do_text_to_speech: true,
    token_cost_factor: 0.5,
  },
  {
    model_id: 'eleven_flash_v2',
    name: 'Eleven Flash v2',
    description: 'Fastest real-time generation model designed for high throughput and responsive playback.',
    can_do_text_to_speech: true,
    token_cost_factor: 0.5,
  },
  {
    model_id: 'eleven_turbo_v2_5',
    name: 'Eleven Turbo v2.5',
    description: 'High-quality, low-latency multilingual model balancing premium acoustic fidelity and rendering speed.',
    can_do_text_to_speech: true,
    token_cost_factor: 0.5,
  },
  {
    model_id: 'eleven_turbo_v2',
    name: 'Eleven Turbo v2',
    description: 'High quality and low latency model specifically optimized for English speech.',
    can_do_text_to_speech: true,
    token_cost_factor: 0.5,
  },
  {
    model_id: 'eleven_multilingual_v1',
    name: 'Eleven Multilingual v1',
    description: 'Legacy multilingual model supporting English, German, Polish, Spanish, Italian, French, Portuguese, and Hindi.',
    can_do_text_to_speech: true,
    token_cost_factor: 1.0,
  },
  {
    model_id: 'eleven_monolingual_v1',
    name: 'Eleven English v1',
    description: 'Classic first-generation English speech generation engine.',
    can_do_text_to_speech: true,
    token_cost_factor: 1.0,
  },
];

/**
 * Validates the active ElevenLabs credential and reports the subscription tier.
 *
 * With a server-managed key this confirms the backend's key works; with a
 * pasted key it validates that key instead.
 */
export const validateApiKey = async (apiKey: string): Promise<ValidationResponse> => {
  try {
    const data = await apiGet<ValidationResponse>('/elevenlabs/user', keys(apiKey));
    return data;
  } catch (err: any) {
    return {
      isValid: false,
      error:
        err instanceof DhvaniApiError
          ? err.message
          : err?.message || 'Could not reach the local DHVANI backend.',
    };
  }
};

/** Fetches the available voices, sorted by name. Returns [] on failure. */
export const getVoices = async (apiKey: string): Promise<Voice[]> => {
  try {
    const data = await apiGet<{ voices: Voice[] }>('/elevenlabs/voices', keys(apiKey));
    return data.voices || [];
  } catch (error) {
    console.error('Error fetching voices:', error);
    return [];
  }
};

/** Fetches the live TTS model list, falling back to the built-in catalog. */
export const getModels = async (apiKey?: string): Promise<ElevenLabsModel[]> => {
  try {
    const data = await apiGet<{ models: ElevenLabsModel[] }>('/elevenlabs/models', keys(apiKey));
    if (data.models?.length) return data.models;
  } catch (err) {
    console.warn('Could not fetch the live ElevenLabs model list; using the built-in catalog:', err);
  }
  return ALL_ELEVENLABS_MODELS;
};

/** Short TTS sample used to audition a voice. */
export const synthesizeSamplePreview = async (
  apiKey: string,
  voiceId: string,
  sampleText: string = 'Hello! This is a real-time preview of my dubbed voice in ElevenLabs.',
  modelId: string = 'eleven_v3'
): Promise<Blob> => synthesizeSpeech(apiKey, voiceId, sampleText, modelId, 'mp3_44100_128');

/** Speech-to-speech voice conversion. */
export const speechToSpeech = async (
  apiKey: string,
  voiceId: string,
  audioBlob: Blob,
  modelId: string = 'eleven_multilingual_sts_v2',
  voiceSettings?: ElevenLabsVoiceSettings,
  removeBackgroundNoise?: boolean
): Promise<Blob> => {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'audio.wav');
  formData.append('voiceId', voiceId);
  formData.append('modelId', modelId);
  if (voiceSettings) formData.append('voiceSettings', JSON.stringify(voiceSettings));
  if (removeBackgroundNoise !== undefined) {
    formData.append('removeBackgroundNoise', String(removeBackgroundNoise));
  }

  return apiAudioUpload('/elevenlabs/speech-to-speech', formData, keys(apiKey));
};

/** Clones a voice from one or more audio samples. */
export const cloneVoiceFromAudio = async (
  apiKey: string,
  name: string,
  samples: (File | Blob)[],
  description?: string,
  labels?: Record<string, string>
): Promise<{ voice_id: string; name: string }> => {
  if (!samples?.length) throw new Error('No audio samples provided for voice cloning.');

  const formData = new FormData();
  formData.append('name', name);
  samples.forEach((sample, index) => {
    const fileName = sample instanceof File ? sample.name : `sample_${index}.wav`;
    formData.append('files', sample, fileName);
  });
  if (description) formData.append('description', description);
  if (labels) formData.append('labels', JSON.stringify(labels));

  return apiUpload('/elevenlabs/voices/add', formData, keys(apiKey));
};
