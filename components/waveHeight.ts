import { useEffect, useState } from 'react';

/*
 * Wave height: how much taller than its real level every editing wave is
 * drawn (Review's player, Sync's lanes, Edit timing), as DaVinci's waveform
 * zoom does. Only the picture changes, never the audio. One choice for the
 * whole app, kept between sessions.
 */

export const WAVE_HEIGHTS = [1, 2, 4] as const;
export type WaveHeight = (typeof WAVE_HEIGHTS)[number];

const KEY = 'dhvani_wave_height';
const EVENT = 'dhvani-wave-height';

const read = (): WaveHeight => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return (WAVE_HEIGHTS as readonly number[]).includes(v) ? (v as WaveHeight) : 1;
  } catch {
    return 1;
  }
};

export const setWaveHeight = (v: WaveHeight) => {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* kept for this session only */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: v }));
};

/** The next height up, back to ×1 after ×4. */
export const nextWaveHeight = (v: WaveHeight): WaveHeight => WAVE_HEIGHTS[(WAVE_HEIGHTS.indexOf(v) + 1) % WAVE_HEIGHTS.length];

export const useWaveHeight = (): WaveHeight => {
  const [v, setV] = useState<WaveHeight>(read);
  useEffect(() => {
    const on = (e: Event) => setV((e as CustomEvent<WaveHeight>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return v;
};
