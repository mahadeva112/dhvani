import { useSyncExternalStore } from 'react';

/**
 * The open project's dub language, for text boxes that type in it without
 * being handed it: App sets it, any box reads it.
 */
let current = '';
const listeners = new Set<() => void>();

export const setDubLanguage = (language: string) => {
  if (language === current) return;
  current = language;
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useDubLanguage = () => useSyncExternalStore(subscribe, () => current);
