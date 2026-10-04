import { apiGetAudio, apiJson } from './apiClient';
import { DubMixReport, DubStem, MixPeakMode, SpeakerVoice } from '../types';
import { ElevenLabsVoiceSettings } from './elevenLabsService';
import { isCartesiaVoice, cartesiaDelivery, type CartesiaVoicePrefs } from './cartesiaService';
import { ConversationTurn } from './speakers';

/**
 * Dubbing with one voice per speaker. The cast maps a speaker's name to a
 * voice; each voice is sent with the model and delivery of its own engine,
 * so a cast may mix ElevenLabs and Cartesia voices that share a sample rate.
 */

/** How the main voice settings carry over to each voice in a cast. */
export interface CastVoicing {
  modelId: string;
  voiceSettings: ElevenLabsVoiceSettings | null;
  cartesia?: CartesiaVoicePrefs;
}

/** What the server needs for one voice: its engine's model and delivery. */
const voicePayload = (voiceId: string, { modelId, voiceSettings, cartesia }: CastVoicing) =>
  isCartesiaVoice(voiceId)
    ? { voiceId, modelId: cartesia?.modelId || undefined, voiceSettings: cartesia ? cartesiaDelivery(cartesia) : undefined }
    : { voiceId, modelId, voiceSettings: voiceSettings || undefined };

/** The cast as the server reads it. A speaker with no voice of their own is left out: the main voice speaks for them. */
export const castPayload = (cast: Record<string, SpeakerVoice> | undefined, voicing: CastVoicing) =>
  Object.fromEntries(
    Object.entries(cast || {})
      .filter(([, voice]) => Boolean(voice?.voiceId))
      .map(([speaker, voice]) => [speaker, voicePayload(voice.voiceId, voicing)])
  );

/** The main voice, as the server reads it. */
export const mainVoicePayload = (voiceId: string, voicing: CastVoicing) => voicePayload(voiceId, voicing);

interface MixedResponse<R> {
  audioId: string;
  contentType: string;
  stems: { speaker: string; audioId: string; contentType: string }[];
  report: R;
}

/** Fetches a finished mix and its stems, each on its own (lossless WAV is too big to ride inside JSON). */
export const fetchMixed = async <R>(data: MixedResponse<R>, signal?: AbortSignal): Promise<{ blob: Blob; stems: DubStem[]; report: R }> => {
  const blob = await apiGetAudio(`/sync/audio/${encodeURIComponent(data.audioId)}`, { signal });
  const stems: DubStem[] = [];
  for (const stem of data.stems || []) {
    stems.push({ speaker: stem.speaker, blob: await apiGetAudio(`/sync/audio/${encodeURIComponent(stem.audioId)}`, { signal }) });
  }
  return { blob, stems, report: data.report };
};

export interface ConversationDubRequest {
  turns: ConversationTurn[];
  cast: Record<string, SpeakerVoice> | undefined;
  voiceId: string;
  voicing: CastVoicing;
  outputFormat: string;
  language?: string;
  seed?: number;
  /** One gain per speaker so every voice sits at one level. Off: each is kept as voiced. */
  matchSpeakers?: boolean;
  peak: MixPeakMode;
}

/**
 * A dub with one voice per speaker, read turn by turn. Progress is polled
 * with getDubProgress(jobId), as for a one-voice dub, and cancelDub stops it.
 */
export const dubConversation = async (
  request: ConversationDubRequest,
  { apiKey, jobId, signal }: { apiKey?: string; jobId?: string; signal?: AbortSignal } = {}
): Promise<{ blob: Blob; stems: DubStem[]; report: DubMixReport }> => {
  const main = mainVoicePayload(request.voiceId, request.voicing);
  const data = await apiJson<MixedResponse<DubMixReport>>('/dub/conversation', {
    body: {
      turns: request.turns,
      cast: castPayload(request.cast, request.voicing),
      ...main,
      outputFormat: request.outputFormat,
      language: request.language,
      seed: request.seed,
      matchSpeakers: request.matchSpeakers === true,
      peak: request.peak,
      jobId,
    },
    keys: { elevenLabsKey: apiKey },
    signal,
  });
  return fetchMixed(data, signal);
};
