import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The player's listening levels: a fader and a mute for the original and for
 * the dub. They change only what is heard in the app, never a file: the dub
 * renders and downloads stay as they are.
 *
 * Solo is not kept here. It is the player's track mode ('source' is the
 * original soloed, 'synth' the dub, 'both' neither), so a line played on the
 * original from elsewhere shows as the original soloed.
 */
export type MixerTrack = 'source' | 'synth';

export interface TrackLevel {
  /** The fader, in dB; MIN_DB and below is silence. */
  db: number;
  muted: boolean;
}

export type MixerLevels = Record<MixerTrack, TrackLevel>;

export const MIN_DB = -40;
export const MAX_DB = 6;

const STORAGE_KEY = 'dhvani_player_mixer';
const UNITY: MixerLevels = { source: { db: 0, muted: false }, synth: { db: 0, muted: false } };

export const gainOf = (level: TrackLevel) => (level.muted || level.db <= MIN_DB ? 0 : 10 ** (level.db / 20));

const readLevels = (): MixerLevels => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    const level = (v: any): TrackLevel => ({
      db: Number.isFinite(v?.db) ? Math.min(MAX_DB, Math.max(MIN_DB, v.db)) : 0,
      muted: v?.muted === true,
    });
    return saved ? { source: level(saved.source), synth: level(saved.synth) } : UNITY;
  } catch {
    return UNITY;
  }
};

interface Route {
  gain: GainNode;
  analyser: AnalyserNode;
}

/**
 * Routes each <audio> element through its own gain and level meter. An element
 * is routed the first time it plays (`prepare`, called from the play itself, so
 * the audio context starts on a click), and stays routed until it is replaced.
 * Off the steps that show the faders (`active` false) every gain is 1.
 */
export const useTrackMixer = (
  elements: Record<MixerTrack, React.RefObject<HTMLAudioElement | null>>,
  active: boolean
) => {
  const [levels, setLevels] = useState<MixerLevels>(readLevels);
  const ctxRef = useRef<AudioContext | null>(null);
  const routes = useRef(new Map<HTMLAudioElement, Route>());
  const buffers = useRef<Float32Array | null>(null);
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const activeRef = useRef(active);
  activeRef.current = active;
  /*
   * Edit timing plays the dub live from its lines (liveDubEngine.ts) rather
   * than from the synced dub's file. That dub comes in here, through the dub's
   * own fader and meter. The original stays the clock even with the dub
   * soloed, so it then plays silenced (`silenceSource`).
   */
  const live = useRef<{ route: Route | null; active: boolean; silenceSource: () => boolean }>({ route: null, active: false, silenceSource: () => false });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(levels));
    } catch {
      /* Storage off: the levels last until the app closes. */
    }
  }, [levels]);

  const apply = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const levelOf = (track: MixerTrack) => (activeRef.current ? gainOf(levelsRef.current[track]) : 1);
    // A short ramp, so a fader moved during playback doesn't click.
    (Object.keys(elements) as MixerTrack[]).forEach((track) => {
      const el = elements[track].current;
      const route = el && routes.current.get(el);
      if (!route) return;
      const silenced = track === 'source' && live.current.active && live.current.silenceSource();
      route.gain.gain.setTargetAtTime(silenced ? 0 : levelOf(track), ctx.currentTime, 0.015);
    });
    live.current.route?.gain.gain.setTargetAtTime(levelOf('synth'), ctx.currentTime, 0.015);
  }, [elements]);

  useEffect(apply, [levels, active, apply]);

  const contextOf = () => {
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return ctxRef.current;
  };

  /** Routes the elements about to play and wakes the audio context. Call from the play. */
  const prepare = useCallback(
    (els: HTMLAudioElement[]) => {
      try {
        const ctx = contextOf();
        // Elements replaced by a new file leave the graph.
        routes.current.forEach((route, el) => {
          if (el.isConnected) return;
          route.analyser.disconnect();
          routes.current.delete(el);
        });
        els.forEach((el) => {
          if (routes.current.has(el)) return;
          const gain = ctx.createGain();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 1024;
          ctx.createMediaElementSource(el).connect(gain);
          gain.connect(analyser);
          analyser.connect(ctx.destination);
          routes.current.set(el, { gain, analyser });
        });
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        apply();
      } catch (e) {
        // Without Web Audio the elements play on their own, at full level.
        console.warn('Player mixer unavailable:', e);
      }
    },
    [apply]
  );

  /**
   * Turns the live dub on or off. While it is on, the synced dub's element is
   * not played, and `silenceSource` says when the original is only the clock.
   */
  const setLive = useCallback(
    (active: boolean, silenceSource: () => boolean) => {
      live.current.active = active;
      live.current.silenceSource = silenceSource;
      apply();
    },
    [apply]
  );

  /** Where the live dub plays into, through the dub's fader and meter; null without Web Audio. */
  const liveOutput = useCallback((): { ctx: AudioContext; input: AudioNode } | null => {
    try {
      const ctx = contextOf();
      if (!live.current.route) {
        const gain = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        gain.connect(analyser);
        analyser.connect(ctx.destination);
        live.current.route = { gain, analyser };
        apply();
      }
      return { ctx, input: live.current.route.gain };
    } catch (e) {
      console.warn('Live dub unavailable:', e);
      return null;
    }
  }, [apply]);

  /** The track's peak level right now, 0 to 1 after its fader; 0 when it is not playing. */
  const peakOf = useCallback(
    (track: MixerTrack): number => {
      const el = elements[track].current;
      const liveRoute = track === 'synth' && live.current.active ? live.current.route : null;
      const route = liveRoute || (el && routes.current.get(el));
      if (!route || (!liveRoute && el?.paused)) return 0;
      const size = route.analyser.fftSize;
      if (!buffers.current || buffers.current.length !== size) buffers.current = new Float32Array(size);
      route.analyser.getFloatTimeDomainData(buffers.current);
      let peak = 0;
      for (let i = 0; i < size; i++) peak = Math.max(peak, Math.abs(buffers.current[i]));
      return peak;
    },
    [elements]
  );

  const setLevel = useCallback((track: MixerTrack, patch: Partial<TrackLevel>) => {
    setLevels((prev) => ({ ...prev, [track]: { ...prev[track], ...patch } }));
  }, []);

  return { levels, setLevel, prepare, peakOf, setLive, liveOutput };
};
