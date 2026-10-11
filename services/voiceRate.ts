import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson } from './apiClient';
import { cartesiaDelivery, isCartesiaVoice, type CartesiaVoicePrefs } from './cartesiaService';
import type { ElevenLabsVoiceSettings } from './elevenLabsService';
import { syllableRate } from './speechTiming';
import { samplePassage } from './samplePassages';

/*
 * A voice's own speaking rate, measured before anything is translated or
 * synced: the voice reads a short sample passage in the dub language once,
 * and the seconds its words take give its rate. The rate is kept per voice,
 * model, speed and language, so each costs one short read (about 200
 * characters) and is never measured again unless the user asks.
 *
 * Until now the rate was only known after the first sync, and every estimate
 * before it used a typical rate. A cloned voice can be far from typical.
 */

/** A voice's measured rate in one language. */
export interface VoiceRate {
  charsPerSecond: number;
  syllablesPerSecond: number;
  language: string;
  /** ISO time of the read. */
  measuredAt: string;
}

/** The voice as it would dub: what changes its rate is part of the key, nothing else. */
export interface VoiceRateVoice {
  voiceId: string;
  modelId?: string;
  voiceSettings?: ElevenLabsVoiceSettings | null;
  /** The Cartesia delivery, for a Cartesia voice. */
  cartesia?: CartesiaVoicePrefs | null;
}

const STORAGE_KEY = 'dhvani_voice_rates';
/** Rates kept at most; the oldest go first. */
const MAX_KEPT = 200;

/** One key per voice, model, speed and language: stability or style hardly move a voice's rate. */
export const voiceRateKey = ({ voiceId, modelId, voiceSettings, cartesia }: VoiceRateVoice, language: string) =>
  isCartesiaVoice(voiceId)
    ? JSON.stringify([voiceId, cartesia?.modelId || '', cartesia?.speed ?? 1, language])
    : JSON.stringify([voiceId, modelId || '', voiceSettings?.speed ?? 'saved', language]);

// The last read of storage, so a rate read on every render is the same object while storage is unchanged.
let lastRaw: string | null = null;
let lastRates: Record<string, VoiceRate> = {};

const readAll = (): Record<string, VoiceRate> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || '{}';
    if (raw !== lastRaw) {
      const parsed = JSON.parse(raw);
      lastRates = parsed && typeof parsed === 'object' ? parsed : {};
      lastRaw = raw;
    }
    return { ...lastRates };
  } catch {
    return {};
  }
};

export const savedVoiceRate = (key: string): VoiceRate | null => {
  const rate = readAll()[key];
  return rate && rate.syllablesPerSecond > 0 && rate.charsPerSecond > 0 ? rate : null;
};

const saveVoiceRate = (key: string, rate: VoiceRate) => {
  try {
    const all = readAll();
    delete all[key];
    all[key] = rate;
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_KEPT))) delete all[old];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* Storage off: the rate lasts until the app closes. */
  }
};

/** Has the voice read `text` and works out its rate from the seconds its words took. */
export const measureVoiceRate = async (
  voice: VoiceRateVoice,
  language: string,
  text: string,
  { apiKey, signal }: { apiKey?: string; signal?: AbortSignal } = {}
): Promise<VoiceRate> => {
  const delivery =
    voice.cartesia && isCartesiaVoice(voice.voiceId)
      ? { modelId: voice.cartesia.modelId || undefined, voiceSettings: cartesiaDelivery(voice.cartesia) }
      : { modelId: voice.modelId, voiceSettings: voice.voiceSettings || undefined };
  const { characters, speech } = await apiJson<{ characters: number; speech: number; length: number }>('/sync/voice-rate', {
    body: { text, voiceId: voice.voiceId, language, ...delivery },
    keys: { elevenLabsKey: apiKey },
    signal,
  });
  const charsPerSecond = characters / speech;
  return {
    charsPerSecond: Math.round(charsPerSecond * 10) / 10,
    // Counted as the Expert estimate counts a line, so the two agree on this voice.
    syllablesPerSecond: Math.round(syllableRate([text], charsPerSecond) * 10) / 10,
    language,
    measuredAt: new Date().toISOString(),
  };
};

export type VoiceRateStatus = 'idle' | 'measuring' | 'ready' | 'error' | 'no-sample';

/** Waits this long after the voice or language changes, so clicking through voices doesn't read with each. */
const SETTLE_MS = 1200;

export interface VoiceRateState {
  rate: VoiceRate | null;
  status: VoiceRateStatus;
  error: string | null;
  measureAgain: () => void;
}

const NO_VOICE: VoiceRateState = { rate: null, status: 'idle', error: null, measureAgain: () => {} };

/**
 * The rates of the dub's voices in the dub language: `main`, and `speakers`
 * (each speaker with a voice of their own, by name). Each is kept from an
 * earlier read, else measured on its own once the pick has settled, one voice
 * at a time and the main voice first; a voice two speakers share is read once.
 * A read that failed is not retried until the user asks (`measureAgain`), so
 * it never spends credits in a loop.
 */
export const useVoiceRates = (
  main: VoiceRateVoice | null,
  speakers: Record<string, VoiceRateVoice>,
  language: string,
  { apiKey }: { apiKey?: string } = {}
): { main: VoiceRateState; speakers: Record<string, VoiceRateState> } => {
  const text = samplePassage(language);
  const keyOf = (voice: VoiceRateVoice | null) => (voice?.voiceId ? voiceRateKey(voice, language) : null);
  const mainKey = keyOf(main);
  const speakerKeys = Object.entries(speakers).map(([speaker, voice]) => [speaker, keyOf(voice)] as const);
  // Every voice to know, main first, each once; the voice behind each key is read through the ref when its read starts.
  const voiceByKey = new Map<string, VoiceRateVoice>();
  if (main && mainKey) voiceByKey.set(mainKey, main);
  for (const [speaker, key] of speakerKeys) if (key && !voiceByKey.has(key)) voiceByKey.set(key, speakers[speaker]);
  const voicesRef = useRef(voiceByKey);
  voicesRef.current = voiceByKey;

  const [rates, setRates] = useState<Record<string, VoiceRate>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const rateOf = (key: string) => rates[key] ?? savedVoiceRate(key);
  const next = text ? [...voiceByKey.keys()].find((key) => !rateOf(key) && !errors[key]) ?? null : null;

  useEffect(() => {
    if (!next || !text) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const voice = voicesRef.current.get(next);
      if (!voice) return;
      try {
        const measured = await measureVoiceRate(voice, language, text, { apiKey, signal: controller.signal });
        saveVoiceRate(next, measured);
        setRates((all) => ({ ...all, [next]: measured }));
      } catch (err: any) {
        if (!controller.signal.aborted) setErrors((all) => ({ ...all, [next]: err?.message || 'The voice could not be measured.' }));
      }
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [next, text, language, apiKey, attempt]);

  const measureAgain = useCallback((key: string) => {
    setRates((all) => {
      const { [key]: _, ...rest } = all;
      return rest;
    });
    setErrors((all) => {
      const { [key]: _, ...rest } = all;
      return rest;
    });
    try {
      const all = readAll();
      delete all[key];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch {
      /* Nothing kept to drop. */
    }
    setAttempt((n) => n + 1);
  }, []);

  const stateOf = (key: string | null): VoiceRateState => {
    if (!key) return NO_VOICE;
    const rate = rateOf(key);
    // Waiting for the pick to settle, or for the voices before it, counts as measuring: a read follows.
    const status: VoiceRateStatus = !text ? 'no-sample' : rate ? 'ready' : errors[key] ? 'error' : 'measuring';
    return { rate, status, error: errors[key] ?? null, measureAgain: () => measureAgain(key) };
  };
  // The same objects while nothing about them changes, for the memos and callbacks that depend on them.
  const states = [mainKey, ...speakerKeys.map(([, key]) => key)].map(stateOf);
  const signature = JSON.stringify([speakerKeys, states.map((s) => [s.status, s.rate?.measuredAt ?? null, s.error])]);
  return useMemo(
    () => ({ main: states[0], speakers: Object.fromEntries(speakerKeys.map(([speaker], n) => [speaker, states[n + 1]])) }),
    // `signature` holds everything the states are made from.
    [signature]
  );
};

/** The syllables a second of each speaker whose own voice has been measured. */
export const speakerSyllableRates = (states: Record<string, VoiceRateState>): Record<string, number> =>
  Object.fromEntries(
    Object.entries(states).flatMap(([speaker, state]) => (state.rate ? [[speaker, state.rate.syllablesPerSecond] as const] : []))
  );

/** Where an estimate's speaking rate came from: the last sync or dub, a sample read of the voice, or a typical rate. */
export type RateBasis = 'sync' | 'sample' | 'typical';
