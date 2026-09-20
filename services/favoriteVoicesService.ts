/**
 * Favourite voices, shared by the text-to-speech voice picker and the
 * speech-to-speech (Voice Changer) picker.
 *
 * Favourites live in localStorage so they survive reloads, and every change is
 * broadcast on a window event so both pickers stay in sync while open.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'dhvani_favorite_voices';
const CHANGE_EVENT = 'dhvani:favorite-voices-changed';

/**
 * A favourited voice. The name is kept alongside the id so the quick-pick row
 * can render before (or without) the ElevenLabs voice library having loaded.
 */
export interface FavoriteVoice {
  id: string;
  name: string;
  /** 'premade' | 'cloned' | … — whatever the provider reported when starred. */
  category?: string;
  gender?: string;
  accent?: string;
  previewUrl?: string;
}

function read(): FavoriteVoice[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is FavoriteVoice => !!v && typeof v.id === 'string');
  } catch {
    return [];
  }
}

function write(list: FavoriteVoice[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked; favourites stay in memory for this session only.
  }
  try {
    window.dispatchEvent(new CustomEvent<FavoriteVoice[]>(CHANGE_EVENT, { detail: list }));
  } catch {
    // ignore
  }
}

export function getFavoriteVoices(): FavoriteVoice[] {
  return read();
}

export function isFavoriteVoice(voiceId: string): boolean {
  return read().some((v) => v.id === voiceId);
}

/** Adds the voice if missing, removes it if present. Returns the new list. */
export function toggleFavoriteVoice(voice: FavoriteVoice): FavoriteVoice[] {
  const current = read();
  const exists = current.some((v) => v.id === voice.id);
  const next = exists
    ? current.filter((v) => v.id !== voice.id)
    : [...current, { ...voice, name: (voice.name || '').trim() || voice.id }];
  write(next);
  return next;
}

export function removeFavoriteVoice(voiceId: string): FavoriteVoice[] {
  const next = read().filter((v) => v.id !== voiceId);
  write(next);
  return next;
}

export function clearFavoriteVoices(): void {
  write([]);
}

/**
 * React binding. Re-renders whenever favourites change anywhere in the app —
 * including from another component, or another tab via the `storage` event.
 */
export function useFavoriteVoices() {
  const [favorites, setFavorites] = useState<FavoriteVoice[]>(() => read());

  useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<FavoriteVoice[]>).detail;
      setFavorites(Array.isArray(detail) ? detail : read());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === STORAGE_KEY) setFavorites(read());
    };

    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const isFavorite = useCallback(
    (voiceId: string) => favorites.some((v) => v.id === voiceId),
    [favorites]
  );

  const toggleFavorite = useCallback((voice: FavoriteVoice) => {
    setFavorites(toggleFavoriteVoice(voice));
  }, []);

  const removeFavorite = useCallback((voiceId: string) => {
    setFavorites(removeFavoriteVoice(voiceId));
  }, []);

  const clearFavorites = useCallback(() => {
    clearFavoriteVoices();
    setFavorites([]);
  }, []);

  return { favorites, isFavorite, toggleFavorite, removeFavorite, clearFavorites };
}
