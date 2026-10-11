import { useCallback, useEffect, useRef, useState } from 'react';
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

const readAll = (): Record<string, VoiceRate> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
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

/**
 * The dub voice's rate in the dub language: kept from an earlier read, else
 * measured on its own once the pick has settled. `measureAgain` reads it again.
 * A read that failed is not retried until the user asks, so it never spends
 * credits in a loop.
 */
export const useVoiceRate = (voice: VoiceRateVoice | null, language: string, { apiKey }: { apiKey?: string } = {}) => {
  const key = voice?.voiceId ? voiceRateKey(voice, language) : null;
  const text = samplePassage(language);
  const [rates, setRates] = useState<Record<string, VoiceRate>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const rate = key ? rates[key] ?? savedVoiceRate(key) : null;

  useEffect(() => {
    if (!key || !text || rate || errors[key]) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const current = voiceRef.current;
      if (!current) return;
      try {
        const measured = await measureVoiceRate(current, language, text, { apiKey, signal: controller.signal });
        saveVoiceRate(key, measured);
        setRates((all) => ({ ...all, [key]: measured }));
      } catch (err: any) {
        if (!controller.signal.aborted) setErrors((all) => ({ ...all, [key]: err?.message || 'The voice could not be measured.' }));
      }
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // `rate` and `errors[key]` gate the read; the voice itself is read through the ref when it starts.
  }, [key, text, language, apiKey, attempt, Boolean(rate), Boolean(key && errors[key])]);

  const measureAgain = useCallback(() => {
    if (!key) return;
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
  }, [key]);

  // Waiting for the pick to settle counts as measuring: a read follows unless the pick changes.
  const status: VoiceRateStatus = !key ? 'idle' : !text ? 'no-sample' : rate ? 'ready' : errors[key] ? 'error' : 'measuring';
  return { rate, status, error: key ? errors[key] ?? null : null, measureAgain };
};

export type VoiceRateState = ReturnType<typeof useVoiceRate>;

/** Where an estimate's speaking rate came from: the last sync or dub, a sample read of the voice, or a typical rate. */
export type RateBasis = 'sync' | 'sample' | 'typical';
