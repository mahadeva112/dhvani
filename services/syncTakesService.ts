import { apiGetAudio, apiJson, apiPutBlob, DhvaniApiError } from './apiClient';
import { isCartesiaVoice, cartesiaDelivery, type CartesiaVoicePrefs } from './cartesiaService';
import { castPayload } from './castService';
import type { SyncBank, SyncBankLine } from './syncEditModel.ts';
import type { SyncJoinSettings, SyncUnitReport } from './syncService';
import type { ElevenLabsVoiceSettings } from './elevenLabsService';
import type { AudioSegment, SpeakerVoice } from '../types';
import { appendToBank, phraseOf, type SyncTake, type TakeChunk, type TakeDirection } from './syncTakes.ts';

/** Takes of a synced line (syncTakes.ts); here, voicing them on the server. */
export * from './syncTakes.ts';

/** Forced-aligned word times relative to the current bank line, never source timings. */
export const alignTakeWords = async (
  bank: SyncBank, bankBlob: Blob, line: SyncBankLine, text: string,
  { apiKey, signal }: { apiKey?: string; signal?: AbortSignal } = {}
): Promise<import('./takeRange').TakeWord[]> => {
  const send = () => apiJson<{ words: import('./takeRange').TakeWord[] }>('/sync/takes/words', {
    body: { bankId: bank.bankId, line: { bankStart: line.bankStart, length: line.length, text } },
    keys: { elevenLabsKey: apiKey }, signal,
  });
  try { return (await send()).words; }
  catch (err) {
    if (!(err instanceof DhvaniApiError) || err.code !== 'edit_bank_missing') throw err;
    await apiPutBlob(`/sync/edit/banks/${encodeURIComponent(bank.bankId)}`, bankBlob, { signal });
    return (await send()).words;
  }
};

/* ---------- Placing a used take ---------- */

export interface PlaceTakeRequest {
  bank: SyncBank;
  bankBlob: Blob;
  key: string;
  take: Pick<SyncTake, 'bankStart' | 'length' | 'lead' | 'speech'>;
  segments: AudioSegment[];
  join: SyncJoinSettings;
  tolerance: number;
  timingProtection?: 'warn' | 'strict';
  sourceDuration: number;
  multiSpeaker: boolean;
  /** Timeline seconds where the lines either side play now; they stay there. */
  prev: { start: number; end: number } | null;
  next: { start: number; end: number } | null;
}

export interface PlacedTake {
  chunks: TakeChunk[];
  /** False when the take could not fit between its neighbours and its limits; it is placed as well as it can be. */
  fits: boolean;
  cutNotMade: boolean;
  sourceCuts: { made: number; skipped: number } | null;
  /** Why its words couldn't be timed, when they couldn't: then it is not cut between them. */
  wordsError: string | null;
}

/**
 * A take just used in the dub, cut and placed as Chunk sync places a line,
 * between the lines either side (POST /api/sync/takes/place). Only the take's
 * words are aligned; nothing is voiced.
 */
export const placeTakeLikeSync = async (
  { bank, bankBlob, key, take, segments, join, tolerance, timingProtection, sourceDuration, multiSpeaker, prev, next }: PlaceTakeRequest,
  { apiKey, signal }: { apiKey?: string; signal?: AbortSignal } = {}
): Promise<PlacedTake> => {
  const send = () =>
    apiJson<PlacedTake>('/sync/takes/place', {
      body: {
        bankId: bank.bankId,
        key,
        take: { bankStart: take.bankStart, length: take.length, lead: take.lead, speech: take.speech },
        segments,
        join,
        tolerance,
        timingProtection,
        sourceDuration,
        multiSpeaker,
        prev,
        next,
      },
      keys: { elevenLabsKey: apiKey },
      signal,
    });
  try {
    return await send();
  } catch (err) {
    if (!(err instanceof DhvaniApiError) || err.code !== 'edit_bank_missing') throw err;
    await apiPutBlob(`/sync/edit/banks/${encodeURIComponent(bank.bankId)}`, bankBlob, { signal });
    return send();
  }
};

/* ---------- Asking for takes ---------- */

export interface TakesRequest {
  bank: SyncBank;
  bankBlob: Blob;
  line: SyncBankLine;
  unit: SyncUnitReport;
  /** The line as the voice reads it, with its tags (voice expression Natural); its text otherwise. */
  voiceText?: string;
  previousText?: string;
  nextText?: string;
  /** How many lines the dub has, so a take is voiced with the settings the whole read was. */
  readCount: number;
  /** Words of the line to voice again (indexes into wordsOf, inclusive), or `say` in their place; the whole line when left out. */
  phrase?: { from: number; to: number; say?: string };
  /** The current take's words (SyncTake.words), so a phrase take's words are known without aligning it. */
  lineWords?: [number, number][];
  direction: TakeDirection;
  count: number;
  join: SyncJoinSettings;
  matchLoudness: boolean;
  voiceId: string;
  modelId: string;
  outputFormat: string;
  voiceSettings: ElevenLabsVoiceSettings | null;
  cartesia?: CartesiaVoicePrefs;
  language?: string;
  tuneStability?: boolean;
  steady?: boolean;
  expressive?: boolean;
  /** The line's text carries tags the user typed: they are read as typed, and none are added. */
  ownTags?: boolean;
  /** Stability for these takes alone (0, 0.5 or 1, as Eleven v3 takes it). */
  stability?: number;
  multiSpeaker?: boolean;
  cast?: Record<string, SpeakerVoice>;
}

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

/**
 * Voices new takes of a line. Returns the bank they were added to (its id and
 * its samples, the old bank's plus theirs) and the takes, ready to keep with
 * the line's others.
 */
export const voiceTakes = async (
  request: TakesRequest,
  { apiKey, signal }: { apiKey?: string; signal?: AbortSignal } = {}
): Promise<{ bankId: string; bankBlob: Blob; takes: SyncTake[] }> => {
  const { bank, bankBlob, line, unit, phrase, cartesia } = request;
  const words = phrase ? phraseOf(unit.text, phrase.from, phrase.to) : null;
  const say = phrase?.say?.trim() && phrase.say.trim() !== words?.words ? phrase.say.trim() : null;
  const voice =
    cartesia && isCartesiaVoice(request.voiceId)
      ? { modelId: cartesia.modelId || undefined, voiceSettings: cartesiaDelivery(cartesia) }
      : { modelId: request.modelId, voiceSettings: request.voiceSettings || undefined };
  const seeds = Array.from({ length: Math.max(1, Math.min(5, request.count)) }, randomSeed);
  type Voiced = {
    bankId: string;
    baseLength: number;
    audioId: string;
    takes: { seed: number; bankStart: number; length: number; lead: number; speech: number; cutOff: boolean; gain: number; hash: string; words?: [number, number][]; gaps?: number[] }[];
  };
  const send = () =>
    apiJson<Voiced>('/sync/takes', {
      body: {
        bankId: bank.bankId,
        line: {
          bankStart: line.bankStart,
          length: line.length,
          gain: line.gain,
          text: unit.text,
          ...(request.voiceText && request.voiceText !== unit.text && { voiceText: request.voiceText }),
          speaker: line.speaker,
          previousText: request.previousText,
          nextText: request.nextText,
          readCount: request.readCount,
          ...(words && request.lineWords?.length && { words: request.lineWords }),
        },
        ...(words && { phrase: { ...words, ...(say && { say }) } }),
        seeds,
        direction: request.direction,
        join: request.join,
        matchLoudness: request.matchLoudness,
        voiceId: request.voiceId,
        outputFormat: request.outputFormat,
        ...voice,
        language: request.language,
        tuneStability: request.tuneStability,
        ...(request.steady && { steady: true }),
        ...(request.expressive && { expressive: true }),
        ...(request.ownTags && { ownTags: true }),
        ...(typeof request.stability === 'number' && { stability: request.stability }),
        ...(request.voiceText && request.voiceText !== unit.text && { performanceTags: true }),
        ...(request.multiSpeaker && {
          multiSpeaker: true,
          cast: castPayload(request.cast, { modelId: request.modelId, voiceSettings: request.voiceSettings, cartesia }),
        }),
      },
      keys: { elevenLabsKey: apiKey },
      signal,
    });
  let data: Voiced;
  try {
    data = await send();
  } catch (err) {
    // The server keeps a bank a few hours, and not across a restart: send it again.
    if (!(err instanceof DhvaniApiError) || err.code !== 'edit_bank_missing') throw err;
    await apiPutBlob(`/sync/edit/banks/${encodeURIComponent(bank.bankId)}`, bankBlob, { signal });
    data = await send();
  }
  const added = await apiGetAudio(`/sync/audio/${encodeURIComponent(data.audioId)}`, { signal });
  const nextBlob = await appendToBank(bankBlob, added, { sampleRate: bank.sampleRate, float: bank.float, baseLength: data.baseLength });
  return {
    bankId: data.bankId,
    bankBlob: nextBlob,
    takes: data.takes.map((take) => ({
      id: `${take.seed.toString(36)}-${take.bankStart.toString(36)}`,
      kind: words ? 'phrase' : 'line',
      bankStart: take.bankStart,
      length: take.length,
      lead: take.lead,
      speech: take.speech,
      gain: take.gain,
      hash: take.hash,
      cutOff: take.cutOff,
      cuts: [],
      crossfade: 0,
      dropped: 0,
      seed: take.seed,
      direction: request.direction,
      ...(words && { phrase: say ?? words.words }),
      ...(take.words?.length && { words: take.words, ...(take.gaps && { gaps: take.gaps }) }),
      text: unit.text,
    })),
  };
};
