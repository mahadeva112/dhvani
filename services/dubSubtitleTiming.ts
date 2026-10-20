import { useCallback, useEffect, useRef, useState } from 'react';
import type { AudioSegment, WordTimestamp } from '../types';
import { apiUpload } from './apiClient';

/**
 * Subtitles timed to the dub's own words.
 *
 * The dub's cues otherwise only know where their LINE sits (Sync's placement)
 * or an estimate from line lengths, so every cue inside a line was a share of
 * it by character count. Here the dub audio and its lines go to ElevenLabs
 * forced alignment, which says where each word is actually spoken; the app
 * then cuts the dub's subtitles on those words like it does the original's.
 */

/** Cue id → one timing per whitespace token of the cue's dub text. */
export type DubWordTimings = Map<string, WordTimestamp[]>;

/** A timing request that runs longer than this is given up, and the subtitles keep their estimated timing. */
export const DUB_TIMING_LIMIT_MS = 90_000;

const dubText = (segment: AudioSegment) => String(segment.textTarget || segment.targetText || '').trim();

/** The lines the dub says, in the order it says them. */
const alignmentCues = (segments: AudioSegment[]) =>
  segments
    .map((segment) => ({ id: String(segment.id), text: dubText(segment) }))
    .filter((cue) => cue.text);

/**
 * Finished alignments, one per dub audio and script: each costs an ElevenLabs
 * request. Only settled answers are kept — a request still running is never
 * shared, so one that hangs can't hold every later opening of the window.
 * Null is a dub that can't be lined up with its script.
 */
const settled = new Map<string, DubWordTimings | null>();

const requestDubWordTimings = async (
  audioUrl: string,
  cues: { id: string; text: string }[],
  signal: AbortSignal
): Promise<DubWordTimings> => {
  const audio = await (await fetch(audioUrl, { signal })).blob();
  const form = new FormData();
  form.append('file', audio, audio.type.includes('mpeg') ? 'dub.mp3' : 'dub.wav');
  form.append('cues', JSON.stringify(cues));
  const result = await apiUpload<{ cues: { id: string; words: WordTimestamp[] }[] }>('/subtitles/dub-timing', form, { signal });
  return new Map(result.cues.map((cue) => [cue.id, cue.words]));
};

/**
 * `timing` while the request runs, `done` once the words are in, `failed` when
 * it failed, was stopped or ran past DUB_TIMING_LIMIT_MS (`reason` says which).
 */
export type DubTimingStatus = 'idle' | 'timing' | 'done' | 'failed';
export type DubTimingFailure = 'stopped' | 'timeout' | 'unaligned' | 'error';

interface TimingState {
  key: string;
  timings: DubWordTimings | null;
  status: DubTimingStatus;
  reason?: DubTimingFailure;
  startedAt: number;
}

const IDLE: TimingState = { key: '', timings: null, status: 'idle', startedAt: 0 };

/**
 * The dub's word timings for `segments`, with where the request stands.
 * `retry` always sends a new request; `stop` gives up the running one.
 */
export const useDubWordTimings = (audioUrl: string | null | undefined, segments: AudioSegment[], enabled: boolean) => {
  const [state, setState] = useState<TimingState>(IDLE);
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);
  const key = enabled && audioUrl ? `${audioUrl}\n${JSON.stringify(alignmentCues(segments))}` : '';

  useEffect(() => {
    if (!key || !audioUrl) return setState(IDLE);
    if (settled.has(key)) {
      const timings = settled.get(key) ?? null;
      return setState({ key, timings, status: timings ? 'done' : 'failed', reason: timings ? undefined : 'unaligned', startedAt: 0 });
    }
    const cues = alignmentCues(segments);
    if (cues.length === 0) return setState(IDLE);

    const controller = new AbortController();
    controllerRef.current = controller;
    let timedOut = false;
    const limit = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, DUB_TIMING_LIMIT_MS);
    setState({ key, timings: null, status: 'timing', startedAt: Date.now() });

    requestDubWordTimings(audioUrl, cues, controller.signal)
      .then((timings) => {
        settled.set(key, timings);
        setState({ key, timings, status: 'done', startedAt: 0 });
      })
      .catch((err) => {
        // Stopped by hand (stop sets its own state) or the window closed.
        if (controller.signal.aborted && !timedOut) return;
        console.warn('Dub subtitles keep their estimated timing:', err);
        // A failed request may succeed later (network, key); only a dub that
        // cannot be lined up with its script is remembered as such.
        const unaligned = err?.code === 'dub_alignment_failed';
        if (unaligned) settled.set(key, null);
        setState({ key, timings: null, status: 'failed', reason: timedOut ? 'timeout' : unaligned ? 'unaligned' : 'error', startedAt: 0 });
      })
      .finally(() => clearTimeout(limit));

    return () => {
      clearTimeout(limit);
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
    // `key` captures everything about `segments` the alignment reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => {
    if (!key) return;
    settled.delete(key);
    setAttempt((n) => n + 1);
  }, [key]);

  const stop = useCallback(() => {
    controllerRef.current?.abort();
    setState((s) => (s.status === 'timing' ? { ...s, status: 'failed', reason: 'stopped', startedAt: 0 } : s));
  }, []);

  const current = state.key === key ? state : key ? { ...IDLE, key, status: 'timing' as const, startedAt: Date.now() } : IDLE;
  return {
    timings: current.timings,
    status: current.status,
    reason: current.reason,
    startedAt: current.startedAt,
    loading: current.status === 'timing',
    retry,
    stop,
  };
};
