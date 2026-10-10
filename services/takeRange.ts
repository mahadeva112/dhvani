import type { SyncEditPart } from './syncEditModel.ts';

export interface TakeWord { index: number; text: string; start: number; end: number }

/** Match timeline seconds to measured words in this specific edited part.
 * Never guess timestamps or select words cut by a trim/split boundary. */
export const wordsInTakeRange = (words: TakeWord[], part: SyncEditPart, a: number, b: number) => {
  if (![a, b, part.start, part.from, part.to, part.rate].every(Number.isFinite) || part.rate <= 0 || part.muted) return null;
  const lo = Math.max(part.from, part.from + (Math.min(a, b) - part.start) * part.rate);
  const hi = Math.min(part.to, part.from + (Math.max(a, b) - part.start) * part.rate);
  if (hi < lo) return null;
  const picked = words.filter(w => w.start >= part.from && w.end <= part.to && w.end > lo && w.start < hi);
  if (!picked.length) return null;
  const first = picked[0], last = picked[picked.length - 1];
  return {
    from: first.index, to: last.index,
    start: part.start + (first.start - part.from) / part.rate,
    end: part.start + (last.end - part.from) / part.rate,
    text: picked.map(w => w.text).join(' '),
  };
};
