import { apiJson } from './apiClient.ts';
import type { AudioSegment } from '../types';

/**
 * Mark pauses (server/providers/gemini/pauseMarks.js): the original's pauses
 * put into dub lines that have no marks for them, words unchanged, so Sync
 * cuts the dub there and each piece sits under its piece of the original.
 */

/** A silence inside a cue at least this long is a pause (server/lib/translationPauses.js). */
const PAUSE_SECONDS = 0.3;
const PAUSE_TAG = /\[pause\s+(\d+(?:\.\d+)?)\s*s\]/gi;
const hasWord = (text: unknown) => /[\p{L}\p{N}]/u.test(String(text ?? ''));
const withoutPauseTags = (text: string) =>
  text.replace(PAUSE_TAG, ' ').replace(/\s+([,.!?;:…])/g, '$1').replace(/\s{2,}/g, ' ').trim();

const dubText = (seg: AudioSegment) => String(seg.textTarget || seg.targetText || '').trim();
const sourceText = (seg: AudioSegment) => String(seg.textSource ?? seg.originalText ?? seg.text ?? '').trim();

/** The cue's timed words when they match its original one for one, else null (as the server reads them). */
const timedWords = (seg: AudioSegment) => {
  const words = (seg.words || []).filter((w) => hasWord(w?.text) && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start);
  const tokens = sourceText(seg).split(/\s+/).filter(hasWord);
  return words.length >= 2 && words.length === tokens.length ? words : null;
};

/** A cue whose original pauses inside it, with a dub line that has no marks for those pauses. */
export const needsPauseMarks = (seg: AudioSegment): boolean => {
  const line = dubText(seg);
  const words = line ? timedWords(seg) : null;
  if (!words) return false;
  let pauses = 0;
  for (let w = 1; w < words.length; w++) if (words[w].start - words[w - 1].end >= PAUSE_SECONDS) pauses += 1;
  if (!pauses) return false;
  const paused = String(seg.pausedTarget || '').trim();
  return !(paused && withoutPauseTags(paused) === line && [...paused.matchAll(PAUSE_TAG)].length === pauses);
};

/**
 * Asks the server where the marks go in these cues' lines. `marked` holds
 * each cue that took them, with the line it was sent, so a line edited while
 * waiting keeps the edit (withPauseMarks).
 */
export const requestPauseMarks = async (
  cues: AudioSegment[],
  language: string,
  { signal }: { signal?: AbortSignal } = {}
): Promise<{ marked: { id: string; line: string; pausedTarget: string }[]; missed: string[] }> => {
  const sent = cues.filter(needsPauseMarks).map((seg) => ({ id: String(seg.id), text: sourceText(seg), line: dubText(seg), words: seg.words || [] }));
  if (!sent.length) return { marked: [], missed: [] };
  const result = await apiJson<{ marked?: { id: string; pausedTarget: string }[]; missed?: string[] }>('/translation/pause-marks', {
    body: { cues: sent, targetLanguage: language },
    signal,
  });
  const lineOf = new Map(sent.map((c) => [c.id, c.line]));
  const marked = (Array.isArray(result.marked) ? result.marked : [])
    .map((m) => ({ id: String(m.id), line: lineOf.get(String(m.id)) ?? '', pausedTarget: String(m.pausedTarget ?? '') }))
    // The same words, letter for letter: the marks never change the script.
    .filter((m) => m.line && withoutPauseTags(m.pausedTarget) === m.line);
  const got = new Set(marked.map((m) => m.id));
  return { marked, missed: sent.map((c) => c.id).filter((id) => !got.has(id)) };
};

/** `segments` with the marks on each cue that still says the line it was marked on; null when none still does. */
export const withPauseMarks = (segments: AudioSegment[], marked: { id: string; line: string; pausedTarget: string }[]): AudioSegment[] | null => {
  const byId = new Map(marked.map((m) => [m.id, m]));
  let changed = false;
  const next = segments.map((seg) => {
    const m = byId.get(String(seg.id));
    if (!m || dubText(seg) !== m.line || seg.pausedTarget === m.pausedTarget) return seg;
    changed = true;
    return { ...seg, pausedTarget: m.pausedTarget };
  });
  return changed ? next : null;
};
