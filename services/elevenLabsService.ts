import { apiAudio, apiAudioUpload, apiGet, apiJson, apiUpload, DhvaniApiError } from './apiClient';
import { isCartesiaVoice, synthesizeWithCartesia, cartesiaDelivery, type CartesiaVoicePrefs } from './cartesiaService';

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

/** True when the settings are ElevenLabs' defaults, so there is nothing to reset. */
export const isElevenLabsDefault = (settings?: Partial<ElevenLabsVoiceSettings> | null) =>
  Boolean(settings) &&
  (['stability', 'similarity_boost', 'style', 'speed'] as const).every(
    (k) => Math.abs((settings![k] ?? DEFAULT_VOICE_SETTINGS[k]!) - DEFAULT_VOICE_SETTINGS[k]!) < 0.001
  ) &&
  settings!.use_speaker_boost !== false;

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

/** The model a dub uses until the user picks another. */
export const DEFAULT_ELEVENLABS_MODEL = 'eleven_v4';

/** Eleven v3 and v4 perform audio tags ([sighs], [whispers]) and take delivery cues. */
export const performsAudioTags = (modelId: string) => /^eleven_v[34]/.test(modelId);

/** v3 ignores speed and v4 sets its pace from audio tags; the v1 models reject it. */
export const modelTakesSpeed = (modelId: string) => !performsAudioTags(modelId) && !/_v1$/.test(modelId);

/** Eleven v3/v4 audio tags the backend keeps (mirrors server/lib/deliveryCues.js). */
export const ELEVEN_V3_AUDIO_TAGS = [
  'thoughtful',
  'curious',
  'excited',
  'calm',
  'serious',
  'warmly',
  'amused',
  'sarcastic',
  'mischievously',
  'sighs',
  'exhales',
  'chuckles',
  'laughs',
  'whispers',
];

/**
 * Synthesizes speech. The signature is unchanged from the original AI Studio
 * build so every existing call site keeps working.
 */
export const synthesizeSpeech = async (
  apiKey: string,
  voiceId: string,
  text: string,
  modelId: string = DEFAULT_ELEVENLABS_MODEL,
  outputFormat: string = 'mp3_44100_128',
  /** Null uses the voice's own ElevenLabs settings. */
  voiceSettings: ElevenLabsVoiceSettings | null = null,
  /**
   * `expressive` asks the backend to add Eleven v3/v4 delivery cues so a dub is
   * performed rather than read; `language` is the script's language.
   */
  {
    expressive = false,
    audioTags = false,
    language,
    seed,
    matchLoudness = false,
    cartesia,
    jobId,
    signal,
  }: {
    expressive?: boolean;
    /**
     * Keeps Eleven v3/v4 audio tags the author typed (`[whispers]`, `[sighs]`).
     * The backend removes anything that is not a known tag.
     */
    audioTags?: boolean;
    language?: string;
    /** Same seed, text and settings gives the same take. */
    seed?: number;
    /** Bring every passage of a long script to the same loudness. Off: each keeps the level it was voiced at. */
    matchLoudness?: boolean;
    /** How a Cartesia voice is voiced; the ElevenLabs settings don't apply to one. */
    cartesia?: CartesiaVoicePrefs;
    /** Names the dub so its progress can be polled and it can be cancelled. */
    jobId?: string;
    signal?: AbortSignal;
  } = {}
): Promise<Blob> => {
  // Audio tags look like stage directions, so leave the cleanup to the backend.
  const cleanText = audioTags ? String(text || '').trim() : cleanTextForNaturalSpeech(text);
  if (!cleanText) throw new Error('No dialogue text provided for synthesis.');

  // A Cartesia voice is spoken by Cartesia with its own model and delivery, as in
  // the studio. Delivery cues are an Eleven v3/v4 feature. Without Cartesia
  // settings, only the speed carries over from the ElevenLabs sliders.
  if (isCartesiaVoice(voiceId)) {
    const delivery = cartesia ? cartesiaDelivery(cartesia) : { speed: voiceSettings?.speed };
    return synthesizeWithCartesia(voiceId, cleanText, {
      outputFormat,
      language,
      modelId: cartesia?.modelId || undefined,
      ...delivery,
      matchLoudness,
      jobId,
      signal,
    });
  }

  return apiAudio(
    '/elevenlabs/tts',
    {
      voiceId,
      text: cleanText,
      modelId,
      outputFormat,
      voiceSettings: voiceSettings || undefined,
      expressive,
      audioTags,
      language,
      seed,
      matchLoudness,
      jobId,
    },
    { ...keys(apiKey), signal }
  );
};

/** How far a dub started with a `jobId` has got. */
export interface DubProgress {
  phase: 'preparing' | 'voicing' | 'joining' | 'done' | 'cancelled' | 'failed';
  passageCount: number;
  passagesDone: number;
  /** Characters of the script, and those in passages already voiced. */
  totalChars: number;
  charsDone: number;
  /** Seconds of dub audio received so far, across all passages. */
  secondsGenerated: number;
  /** False once ElevenLabs refuses to stream, so progress only moves per passage. */
  streaming: boolean;
}

export const getDubProgress = (jobId: string): Promise<DubProgress> =>
  apiGet<DubProgress>(`/elevenlabs/tts/jobs/${encodeURIComponent(jobId)}`);

/** Stops a dub. No passage after the one in flight is requested. */
export const cancelDub = (jobId: string): Promise<{ cancelled: boolean }> =>
  apiJson(`/elevenlabs/tts/jobs/${encodeURIComponent(jobId)}/cancel`, { body: {} });

/** The settings a voice was saved with on ElevenLabs — how it sounds on the website. */
export const getVoiceSettings = async (
  apiKey: string,
  voiceId: string
): Promise<ElevenLabsVoiceSettings> => {
  // Cartesia voices have no saved ElevenLabs settings.
  if (isCartesiaVoice(voiceId)) return { ...DEFAULT_VOICE_SETTINGS };
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
  /** Which engine speaks the voice. Absent means ElevenLabs. */
  provider?: 'elevenlabs' | 'cartesia';
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
    model_id: 'eleven_v4',
    name: 'Eleven v4',
    description:
      'The flagship model: the most emotive voices, 90+ languages, and passages stitched into one steady read. Pace comes from audio tags, not the speed slider.',
    can_do_text_to_speech: true,
    token_cost_factor: 1.0,
  },
  {
    model_id: 'eleven_v4_turbo',
    name: 'Eleven v4 Turbo',
    description: 'Low-latency v4 (~100ms) with audio tags, 90+ languages.',
    can_do_text_to_speech: true,
    token_cost_factor: 1.0,
  },
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
  modelId: string = DEFAULT_ELEVENLABS_MODEL,
  /** Null or omitted uses the voice's own settings, as a dub would. */
  voiceSettings: ElevenLabsVoiceSettings | null = null,
  /** How a Cartesia voice is voiced, as a dub would. */
  cartesia?: CartesiaVoicePrefs
): Promise<Blob> => synthesizeSpeech(apiKey, voiceId, sampleText, modelId, 'mp3_44100_128', voiceSettings, { cartesia });

/** Speech-to-speech voice conversion. */
export const speechToSpeech = async (
  apiKey: string,
  voiceId: string,
  audioBlob: Blob,
  modelId: string = 'eleven_multilingual_sts_v2',
  voiceSettings?: ElevenLabsVoiceSettings,
  removeBackgroundNoise?: boolean,
  /** `outputFormat` is an ElevenLabs format id; the same `seed` repeats a take. */
  { outputFormat, seed }: { outputFormat?: string; seed?: number } = {}
): Promise<Blob> => {
  if (isCartesiaVoice(voiceId)) {
    throw new Error(
      'Cartesia retired its voice changer in August 2026. Pick an ElevenLabs voice to change the voice of a recording.'
    );
  }
  const formData = new FormData();
  formData.append('audio', audioBlob, 'audio.wav');
  formData.append('voiceId', voiceId);
  formData.append('modelId', modelId);
  if (voiceSettings) formData.append('voiceSettings', JSON.stringify(voiceSettings));
  if (removeBackgroundNoise !== undefined) {
    formData.append('removeBackgroundNoise', String(removeBackgroundNoise));
  }
  if (outputFormat) formData.append('outputFormat', outputFormat);
  if (seed !== undefined) formData.append('seed', String(seed));

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
