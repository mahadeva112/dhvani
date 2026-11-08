import { useSyncExternalStore } from 'react';

/**
 * The app's colour theme, picked under Tools and settings > Appearance and
 * remembered on this computer. Classic is the original slate and indigo look;
 * Graphite is a neutral charcoal. The theme sits on <html data-theme>, where
 * index.css swaps the colours the Tailwind classes read; index.html sets it
 * before the first paint so the app never flashes the other theme.
 */
export type ThemeId = 'classic' | 'graphite';

export const THEMES: { id: ThemeId; label: string; hint: string; swatch: string[] }[] = [
  { id: 'classic', label: 'Classic', hint: 'Deep slate with indigo', swatch: ['#020617', '#0f172a', '#2b3a52', '#5b5ef0', '#f1f5f9'] },
  { id: 'graphite', label: 'Graphite', hint: 'Neutral charcoal, no blue tint', swatch: ['#161719', '#212226', '#36383e', '#5361d6', '#ececef'] },
];

const KEY = 'dhvani_theme';
const isTheme = (v: unknown): v is ThemeId => v === 'classic' || v === 'graphite';

const stored = (): ThemeId => {
  try {
    const v = localStorage.getItem(KEY);
    return isTheme(v) ? v : 'classic';
  } catch {
    return 'classic';
  }
};

let current: ThemeId = stored();
const listeners = new Set<() => void>();

const paint = (id: ThemeId) => {
  if (typeof document === 'undefined') return;
  if (id === 'classic') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
};

paint(current);

export const getTheme = () => current;

export const setTheme = (id: ThemeId) => {
  if (id === current) return;
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* Not remembered, but still shown. */
  }
  paint(id);
  listeners.forEach((fn) => fn());
};

// Another window of the app (the popped-out review player) follows a change made here.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const next = isTheme(e.newValue) ? e.newValue : 'classic';
    if (next === current) return;
    current = next;
    paint(next);
    listeners.forEach((fn) => fn());
  });
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** The theme now; a component using it re-renders when it changes. */
export const useTheme = () => useSyncExternalStore(subscribe, getTheme, getTheme);
