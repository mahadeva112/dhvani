import type { AudioSegment, WordTimestamp } from '../types';
import { suggestDubBreak } from './cueEdit.ts';

/*
 * Splitting and merging the transcript's segments on the transcript screen,
 * before (or without) translating it.
 *
 * The text is cut, never rebuilt: a split takes the segment's own text apart
 * at the whitespace before a word, so every letter, mark and punctuation sign
 * stays where it was and only the space at the new boundary goes. A word, and
 * with it every grapheme cluster of Hindi or Bengali, is never broken.
 *
 * Times come from the word timings when they still match the text word for
 * word. Otherwise the split time is a guess the user checks and confirms, and
 * the halves are marked 'derived', never presented as measured.
 */

/** No segment is made shorter than this by a split, in seconds. */
export const MIN_SEGMENT_SECONDS = 0.05;

export const sourceOf = (seg: AudioSegment) => String(seg.textSource ?? seg.originalText ?? seg.text ?? '');
const targetOf = (seg: AudioSegment) => String(seg.textTarget || seg.targetText || '');

/** A word of a text and where it sits in it, in UTF-16 offsets. */
export interface TextWord {
  text: string;
  from: number;
  to: number;
}

/** The text's words: its runs of non-space characters. */
export const textWords = (text: string): TextWord[] =>
  [...text.matchAll(/\S+/gu)].map((m) => ({ text: m[0], from: m.index!, to: m.index! + m[0].length }));

/** The text in two at the whitespace before its word `k`; only that whitespace goes. */
const cutText = (text: string, k: number): [string, string] | null => {
  const words = textWords(text);
  if (!Number.isInteger(k) || k < 1 || k >= words.length) return null;
  return [text.slice(0, words[k - 1].to).trimStart(), text.slice(words[k].from).trimEnd()];
};

const measuredWords = (seg: AudioSegment): WordTimestamp[] =>
  (seg.words || []).filter((w) => w && w.text && Number.isFinite(w.start) && Number.isFinite(w.end));

/** The segment's timing can be split: finite, and longer than two shortest segments. */
const hasRoom = (seg: AudioSegment) =>
  Number.isFinite(seg.startTime) && Number.isFinite(seg.endTime) && seg.endTime - seg.startTime >= 2 * MIN_SEGMENT_SECONDS;

export type SplitPlan =
  | { kind: 'measured'; firstEnd: number; secondStart: number; pause: number }
  | { kind: 'estimated'; estimate: number; min: number; max: number }
  | { kind: 'refused'; reason: 'edge' | 'timing' };

/**
 * Where splitting before word `k` would put the boundary: the measured word
 * gap when the word timings match the text, else an estimate from the words'
 * lengths with the range a chosen time must stay inside.
 */
export const planSplit = (seg: AudioSegment, k: number): SplitPlan => {
  const words = textWords(sourceOf(seg));
  if (!Number.isInteger(k) || k < 1 || k >= words.length) return { kind: 'refused', reason: 'edge' };
  if (!hasRoom(seg)) return { kind: 'refused', reason: 'timing' };
  const timed = measuredWords(seg);
  if (timed.length === words.length) {
    const firstEnd = timed[k - 1].end;
    const secondStart = Math.max(firstEnd, timed[k].start);
    if (firstEnd > seg.startTime && secondStart < seg.endTime) {
      return { kind: 'measured', firstEnd, secondStart, pause: secondStart - firstEnd };
    }
  }
  const min = seg.startTime + MIN_SEGMENT_SECONDS;
  const max = seg.endTime - MIN_SEGMENT_SECONDS;
  const letters = (list: TextWord[]) => list.reduce((sum, w) => sum + [...w.text].length, 0);
  const share = letters(words.slice(0, k)) / (letters(words) || 1);
  const estimate = Math.min(max, Math.max(min, seg.startTime + share * (seg.endTime - seg.startTime)));
  return { kind: 'estimated', estimate, min, max };
};

/**
 * The word a split at `time` starts the second half with: the word gap
 * nearest it, measured when the word timings match the text, else spread over
 * the segment by the words' lengths. Null when the segment has under two words.
 */
export const cutNearTime = (seg: AudioSegment, time: number): number | null => {
  const words = textWords(sourceOf(seg));
  if (words.length < 2) return null;
  const timed = measuredWords(seg);
  let gaps: number[];
  if (timed.length === words.length) {
    gaps = timed.slice(1).map((w, i) => (timed[i].end + w.start) / 2);
  } else {
    const letters = words.map((w) => [...w.text].length);
    const total = letters.reduce((a, b) => a + b, 0) || 1;
    let done = 0;
    gaps = letters.slice(0, -1).map((n) => seg.startTime + ((done += n) / total) * (seg.endTime - seg.startTime));
  }
  let best = 1;
  gaps.forEach((gap, i) => {
    if (Math.abs(gap - time) < Math.abs(gaps[best - 1] - time)) best = i + 1;
  });
  return best;
};

const withText = (seg: AudioSegment, source: string, target: string | null): AudioSegment => {
  const out: AudioSegment = { ...seg, textSource: source };
  if (seg.originalText !== undefined) out.originalText = source;
  if (seg.text !== undefined) out.text = source;
  if (target !== null) {
    out.textTarget = target;
    if (seg.targetText !== undefined) out.targetText = target;
  }
  return out;
};

const timedAs = (seg: AudioSegment, startTime: number, endTime: number, words: WordTimestamp[] | null): AudioSegment => ({
  ...seg,
  startTime,
  endTime,
  duration: Math.max(0, endTime - startTime),
  words: words ?? [],
  timingSource: words ? seg.timingSource || 'elevenlabs' : 'derived',
});

/**
 * Splits a segment before its word `k`. The first half keeps the id (and the
 * line's trim), the second gets `newId`. A segment without matching word
 * timings needs `at`, the confirmed split time, inside the plan's range.
 * A translation on the segment is divided at the punctuation nearest the cut.
 */
export const splitSegment = (
  seg: AudioSegment,
  k: number,
  newId: string | number,
  at?: number
): { first: AudioSegment; second: AudioSegment; measured: boolean } | null => {
  const plan = planSplit(seg, k);
  if (plan.kind === 'refused') return null;
  const halves = cutText(sourceOf(seg), k)!;

  let firstEnd: number;
  let secondStart: number;
  let words: [WordTimestamp[], WordTimestamp[]] | null = null;
  if (plan.kind === 'measured') {
    firstEnd = plan.firstEnd;
    secondStart = plan.secondStart;
    const timed = measuredWords(seg).map((w) => ({ ...w }));
    words = [timed.slice(0, k), timed.slice(k)];
  } else {
    if (typeof at !== 'number' || !Number.isFinite(at) || at < plan.min || at > plan.max) return null;
    firstEnd = secondStart = at;
  }

  const target = targetOf(seg);
  let targets: [string | null, string | null] = [null, null];
  if (target.trim()) {
    const dubWords = textWords(target);
    const cut = suggestDubBreak(dubWords.map((w) => w.text), k / textWords(sourceOf(seg)).length);
    targets = cut > 0 && cut < dubWords.length ? cutText(target, cut)! : cut === 0 ? ['', target.trim()] : [target.trim(), ''];
  } else if (seg.textTarget !== undefined || seg.targetText !== undefined) {
    targets = ['', ''];
  }

  const first = timedAs(withText(seg, halves[0], targets[0]), seg.startTime, firstEnd, words?.[0] ?? null);
  const { dubTargetSeconds: _trim, ...rest } = seg;
  const second = timedAs(withText({ ...rest, id: newId }, halves[1], targets[1]), secondStart, seg.endTime, words?.[1] ?? null);
  return { first, second, measured: plan.kind === 'measured' };
};

/** Why two segments can't be merged, or null when they can. */
export const mergeBlocker = (a: AudioSegment, b: AudioSegment): string | null =>
  (a.speaker || '') !== (b.speaker || '') ? 'These segments have different speakers.' : null;

/** Merges a segment with the one after it, under the first's id. */
export const mergeSegments = (a: AudioSegment, b: AudioSegment): AudioSegment => {
  const join = (x: string, y: string) => [x.trimEnd(), y.trimStart()].filter(Boolean).join(' ');
  const targetA = targetOf(a);
  const targetB = targetOf(b);
  const hasTarget = Boolean(targetA.trim() || targetB.trim()) || a.textTarget !== undefined || b.textTarget !== undefined;
  // Word timings are kept only when both halves have them; a half-timed list would mislead.
  const wordsA = measuredWords(a);
  const wordsB = measuredWords(b);
  const both = wordsA.length > 0 && wordsB.length > 0;
  const { dubTargetSeconds: _trim, ...first } = a;
  const merged = withText(first, join(sourceOf(a), sourceOf(b)), hasTarget ? join(targetA, targetB) : null);
  return {
    ...merged,
    startTime: a.startTime,
    endTime: b.endTime,
    duration: Math.max(0, b.endTime - a.startTime),
    words: both ? [...wordsA, ...wordsB].map((w) => ({ ...w })) : [],
    // Its outer times are the halves' own; it is estimated only if either half was.
    timingSource: a.timingSource === 'derived' || b.timingSource === 'derived' ? 'derived' : a.timingSource,
  };
};

/** The transcript as one text, with runs of whitespace as single spaces: what a split or merge must keep. */
export const transcriptText = (segments: AudioSegment[]) =>
  segments
    .map((s) => sourceOf(s).trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/gu, ' ');

export type TimingProblemKind = 'invalid' | 'reversed' | 'zero' | 'overlap';

export interface TimingProblem {
  index: number;
  id: string | number;
  kind: TimingProblemKind;
  start: number;
  end: number;
}

/** Segments whose times can't make a subtitle: missing, reversed, no length, or starting before the one before ends. */
export const timingProblems = (segments: AudioSegment[]): TimingProblem[] => {
  const problems: TimingProblem[] = [];
  segments.forEach((seg, index) => {
    const { startTime: start, endTime: end } = seg;
    const base = { index, id: seg.id, start, end };
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) problems.push({ ...base, kind: 'invalid' });
    else if (end < start) problems.push({ ...base, kind: 'reversed' });
    else if (end === start) problems.push({ ...base, kind: 'zero' });
    else if (index > 0 && Number.isFinite(segments[index - 1].endTime) && start < segments[index - 1].endTime - 1e-6) {
      problems.push({ ...base, kind: 'overlap' });
    }
  });
  return problems;
};

/**
 * The segments as they were before the first split or merge, with every work
 * done since kept on the segments that are still the same: a segment whose
 * id, times and text are unchanged comes back as it is now (its speaker, its
 * translation), so a reset undoes only the cutting.
 */
export const resetSegments = (before: AudioSegment[], now: AudioSegment[]): AudioSegment[] => {
  const current = new Map(now.map((s) => [String(s.id), s]));
  return before.map((seg) => {
    const same = current.get(String(seg.id));
    return same && same.startTime === seg.startTime && same.endTime === seg.endTime && sourceOf(same) === sourceOf(seg) ? same : seg;
  });
};

/** Whether two lists cut the transcript the same way: the same ids with the same times, in the same order. */
export const sameCuts = (a: AudioSegment[], b: AudioSegment[]) =>
  a.length === b.length &&
  a.every((s, i) => String(s.id) === String(b[i].id) && s.startTime === b[i].startTime && s.endTime === b[i].endTime);
