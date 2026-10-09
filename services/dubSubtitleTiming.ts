import { useEffect, useState } from 'react';
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

const dubText = (segment: AudioSegment) => String(segment.textTarget || segment.targetText || '').trim();

/** The lines the dub says, in the order it says them. */
const alignmentCues = (segments: AudioSegment[]) =>
  segments
    .map((segment) => ({ id: String(segment.id), text: dubText(segment) }))
    .filter((cue) => cue.text);

/** One alignment per dub audio and script: it costs an ElevenLabs request. */
const cache = new Map<string, Promise<DubWordTimings | null>>();

export const getDubWordTimings = (audioUrl: string, segments: AudioSegment[]): Promise<DubWordTimings | null> => {
  const cues = alignmentCues(segments);
  if (!audioUrl || cues.length === 0) return Promise.resolve(null);
  const key = `${audioUrl}\n${JSON.stringify(cues)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const audio = await (await fetch(audioUrl)).blob();
    const form = new FormData();
    form.append('file', audio, audio.type.includes('mpeg') ? 'dub.mp3' : 'dub.wav');
    form.append('cues', JSON.stringify(cues));
    const result = await apiUpload<{ cues: { id: string; words: WordTimestamp[] }[] }>('/subtitles/dub-timing', form);
    return new Map(result.cues.map((cue) => [cue.id, cue.words]));
  })().catch((err) => {
    console.warn('Dub subtitles keep their estimated timing:', err);
    // A failed request may succeed later (network, key); only a dub that
    // cannot be lined up with its script is remembered as such.
    if (err?.code !== 'dub_alignment_failed') cache.delete(key);
    return null;
  });
  cache.set(key, pending);
  return pending;
};

/** The dub's word timings for `segments` once they are in; null until then or if they can't be had. */
export const useDubWordTimings = (audioUrl: string | null | undefined, segments: AudioSegment[], enabled: boolean) => {
  const [state, setState] = useState<{ key: string; timings: DubWordTimings | null; loading: boolean }>({
    key: '',
    timings: null,
    loading: false,
  });
  const key = enabled && audioUrl ? `${audioUrl}\n${JSON.stringify(alignmentCues(segments))}` : '';

  useEffect(() => {
    if (!key || !audioUrl) return setState({ key: '', timings: null, loading: false });
    let live = true;
    setState({ key, timings: null, loading: true });
    getDubWordTimings(audioUrl, segments).then((timings) => {
      if (live) setState({ key, timings, loading: false });
    });
    return () => {
      live = false;
    };
    // `key` captures everything about `segments` the alignment reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state.key === key ? { timings: state.timings, loading: state.loading } : { timings: null, loading: Boolean(key) };
};
