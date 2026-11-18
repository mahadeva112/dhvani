import type { AudioSegment, SpeakerGender } from '../types';
import type { Voice } from './elevenLabsService';
import { apiUpload } from './apiClient.ts';
import { audioBufferToWav } from './audioService.ts';
import { INDIAN_LANGUAGE_CODES, isIndianVoice, languageFit } from './indianVoices.ts';
import { speakerOf } from './speakers.ts';

/**
 * "Listen for man / woman" in the Cast: a few of each speaker's own lines are
 * sent to the text model, which says whether the voice sounds like a man's or
 * a woman's. It is only a suggestion: the gender the translation uses is
 * still the one the user sets, and nothing is set until they accept it.
 */

/** What the model heard in one speaker's clip; `voice` is null when it was not sure. */
export interface HeardVoice {
  voice: SpeakerGender | null;
  sure: number;
}

/** About this much of a speaker is heard: enough to judge, little to send. */
const WANT_SECONDS = 12;
const MAX_SECONDS = 20;
/** Lines shorter than this are mostly breath and edges. */
const MIN_LINE_SECONDS = 0.8;
/** Rate the clip is sent at: the voice only needs to be heard, not played. */
const LISTEN_SAMPLE_RATE = 16000;
/** Quiet between the joined lines, so they don't run into each other. */
const JOIN_GAP = 0.25;

/**
 * Which parts of the file to send for `speaker`: their longest lines that no
 * one else talks over, up to about WANT_SECONDS, in file order. Falls back to
 * talked-over lines only when the speaker has nothing else.
 */
export const speakerClipRanges = (segments: AudioSegment[], speaker: string): { start: number; end: number }[] => {
  const mine = segments.filter((s) => speakerOf(s) === speaker && s.endTime - s.startTime >= MIN_LINE_SECONDS);
  const others = segments.filter((s) => speakerOf(s) !== speaker);
  const clear = mine.filter((s) => !others.some((o) => o.startTime < s.endTime && o.endTime > s.startTime));
  const pool = (clear.length ? clear : mine).slice().sort((a, b) => b.endTime - b.startTime - (a.endTime - a.startTime));
  const picked: { start: number; end: number }[] = [];
  let total = 0;
  for (const s of pool) {
    if (total >= WANT_SECONDS) break;
    const length = Math.min(s.endTime - s.startTime, MAX_SECONDS - total);
    if (length < MIN_LINE_SECONDS) break;
    picked.push({ start: s.startTime, end: s.startTime + length });
    total += length;
  }
  return picked.sort((a, b) => a.start - b.start);
};

/** The ranges joined into one small mono WAV. */
const clipOf = async (buffer: AudioBuffer, ranges: { start: number; end: number }[]): Promise<Blob> => {
  const seconds = ranges.reduce((sum, r) => sum + (r.end - r.start) + JOIN_GAP, 0);
  const context = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * LISTEN_SAMPLE_RATE)), LISTEN_SAMPLE_RATE);
  let at = 0;
  for (const r of ranges) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(at, r.start, r.end - r.start);
    at += r.end - r.start + JOIN_GAP;
  }
  return audioBufferToWav(await context.startRendering());
};

/** Hears `speaker` in the original, or null when they have no line long enough to judge. */
export const hearSpeakerVoice = async (
  buffer: AudioBuffer,
  segments: AudioSegment[],
  speaker: string,
  signal?: AbortSignal
): Promise<HeardVoice | null> => {
  const ranges = speakerClipRanges(segments, speaker);
  if (!ranges.length) return null;
  const form = new FormData();
  form.append('file', await clipOf(buffer, ranges), 'speaker.wav');
  const heard = await apiUpload<HeardVoice>('/gemini/speaker-voice', form, { signal });
  return { voice: heard.voice === 'man' || heard.voice === 'woman' ? heard.voice : null, sure: Number(heard.sure) || 0 };
};

/** A voice's gender from its ElevenLabs/Cartesia labels, or null when it has none we read. */
export const voiceGender = (voice: Pick<Voice, 'labels'>): SpeakerGender | null => {
  const g = String(voice.labels?.gender || '').trim().toLowerCase();
  return g === 'male' || g === 'man' ? 'man' : g === 'female' || g === 'woman' ? 'woman' : null;
};

/**
 * Up to `count` voices for a speaker of `gender`: from the engine in use,
 * labelled that gender, not the main voice and not another speaker's (they
 * would sound alike). The dub language's own voices first, then Indian voices
 * for an Indian language, then the library's order.
 */
export const suggestSpeakerVoices = (
  voices: Voice[],
  gender: SpeakerGender,
  { language, engine, taken, count = 3 }: { language: string; engine: 'elevenlabs' | 'cartesia'; taken: Iterable<string>; count?: number }
): Voice[] => {
  const skip = new Set(taken);
  const indianDub = Boolean(INDIAN_LANGUAGE_CODES[language]);
  return voices
    .map((voice, order) => ({ voice, order }))
    .filter(({ voice }) => (engine === 'cartesia' ? voice.provider === 'cartesia' : voice.provider !== 'cartesia'))
    .filter(({ voice }) => !skip.has(voice.voice_id) && voiceGender(voice) === gender)
    .map((v) => ({ ...v, fit: languageFit(v.voice, language), indian: indianDub && isIndianVoice(v.voice) ? 1 : 0 }))
    .sort((a, b) => b.fit - a.fit || b.indian - a.indian || a.order - b.order)
    .slice(0, count)
    .map(({ voice }) => voice);
};
