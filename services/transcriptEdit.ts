import type { AudioSegment, WordTimestamp } from '../types';
import { sourceOf } from './transcriptSegments.ts';

/** A word as compared: lower case, punctuation gone. */
const plain = (word: string) => word.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

const measured = (words: WordTimestamp[] | undefined) =>
  (words || []).filter((w) => w && w.text && Number.isFinite(w.start) && Number.isFinite(w.end));

/** `tokens` spread over `from`..`to` by their length, so a long word gets more of it. */
const spread = (tokens: string[], from: number, to: number): WordTimestamp[] => {
  const end = Math.max(from, to);
  const weights = tokens.map((t) => Math.max(1, t.length));
  const total = weights.reduce((a, b) => a + b, 0);
  let at = from;
  return tokens.map((text, i) => {
    const start = at;
    at = i === tokens.length - 1 ? end : at + ((end - from) * weights[i]) / total;
    return { text, start, end: at };
  });
};

/**
 * The word timings for a line whose words were changed by hand. Words still
 * there keep the times they were heard at; new or changed words share the
 * time of the words they took the place of (or the gap they went into), by
 * length. Without measured words there is nothing to keep, so none are made.
 */
export const retimeWords = (old: WordTimestamp[] | undefined, text: string, start: number, end: number): WordTimestamp[] => {
  const was = measured(old);
  const tokens = text.split(/\s+/).filter(Boolean);
  if (was.length === 0 || tokens.length === 0) return [];
  const a = was.map((w) => plain(w.text));
  const b = tokens.map(plain);
  const n = a.length;
  const m = b.length;
  // Longest run of words kept in order.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1)
    for (let j = m - 1; j >= 0; j -= 1)
      lcs[i][j] = a[i] && a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const kept: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] && a[i] === b[j]) kept.push([i++, j++]);
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) i += 1;
    else j += 1;
  }
  const out: WordTimestamp[] = [];
  let pi = -1;
  let pj = -1;
  for (const [i, j] of [...kept, [n, m] as [number, number]]) {
    const added = tokens.slice(pj + 1, j);
    if (added.length > 0) {
      const replaced = was.slice(pi + 1, i);
      const from = replaced.length ? replaced[0].start : pi >= 0 ? was[pi].end : Math.min(start, was[0].start);
      const to = replaced.length ? replaced[replaced.length - 1].end : i < n ? was[i].start : Math.max(end, was[n - 1].end);
      out.push(...spread(added, from, to));
    }
    if (i < n) out.push({ ...was[i], text: tokens[j] });
    pi = i;
    pj = j;
  }
  return out;
};

/** The line with new words, its word timings kept where the words are. */
export const withSourceWords = (seg: AudioSegment, text: string): AudioSegment => {
  const next = text.replace(/\s+/g, ' ').trim();
  if (next === sourceOf(seg).trim()) return seg;
  const out: AudioSegment = { ...seg, textSource: next };
  if (seg.originalText !== undefined) out.originalText = next;
  if (seg.text !== undefined) out.text = next;
  if (seg.words && seg.words.length > 0) out.words = retimeWords(seg.words, next, seg.startTime, seg.endTime);
  return out;
};

/** What the Original transcript window holds for one line while it is open. */
export type TranscriptDraftLine = { id: string; text: string; speaker: string; removed: boolean };

/** The lines as saved from the window: removed ones gone, the rest with their words and speaker. */
export const applyTranscriptDraft = (segments: AudioSegment[], draft: TranscriptDraftLine[], speakerOf: (s: AudioSegment) => string): AudioSegment[] => {
  const byId = new Map(draft.map((d) => [d.id, d]));
  const out: AudioSegment[] = [];
  for (const seg of segments) {
    const d = byId.get(String(seg.id));
    if (!d) {
      out.push(seg);
      continue;
    }
    if (d.removed) continue;
    let next = withSourceWords(seg, d.text);
    if (d.speaker !== speakerOf(seg)) next = { ...next, speaker: d.speaker };
    out.push(next);
  }
  return out;
};

/** How many lines the draft changes, by kind. */
export const draftChanges = (segments: AudioSegment[], draft: TranscriptDraftLine[], speakerOf: (s: AudioSegment) => string) => {
  const byId = new Map(segments.map((s) => [String(s.id), s]));
  let edited = 0;
  let removed = 0;
  let speakers = 0;
  for (const d of draft) {
    const seg = byId.get(d.id);
    if (!seg) continue;
    if (d.removed) {
      removed += 1;
      continue;
    }
    if (d.text.replace(/\s+/g, ' ').trim() !== sourceOf(seg).trim()) edited += 1;
    if (d.speaker !== speakerOf(seg)) speakers += 1;
  }
  return { edited, removed, speakers, total: edited + removed + speakers };
};
