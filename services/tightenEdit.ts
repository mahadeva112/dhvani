import { silenceLevel, quietStretches } from '../server/lib/syncRender.js';
import { partEnd, type SyncEditPart } from './syncEditModel.ts';

/**
 * Tighten silences in Edit timing: by hand, on the lines the user picks.
 *
 * A part is split where its line goes quiet and the silence between the
 * pieces is taken out; the pieces then play back to back, the first sound
 * where it was. Only silence is cut: every piece is the line's own samples,
 * at the part's own speed, gain and fades, so nothing the voice said changes.
 * Words forced alignment heard (`protect`) are never cut into, nor `margin`
 * either side of them. Silence is read in short windows (quietStretches, as
 * Sync reads it), so a pause on room tone with a little hiss or a click in it
 * is still one pause.
 *
 * Split at pauses (D) uses the same reading but takes nothing out: the part is
 * cut in the middle of every pause longer than `minPause`, and each piece
 * stays where it was, as REAPER's Dynamic split does without "Remove silent
 * areas".
 */

export interface TightenSettings {
  /** Silence is below this (dBFS), or 'auto': a little above the line's own room tone (see silenceLevel). */
  levelDb: number | 'auto';
  /** A pause between sounds keeps at least this, in seconds. */
  minPause: number;
  /** Silence left before and after every sound, in seconds. */
  margin: number;
  /** 'remove': the silence is taken out; 'keep': the part is only split, in the middle of each pause. */
  silence: 'remove' | 'keep';
}

export const DEFAULT_TIGHTEN: TightenSettings = { levelDb: 'auto', minPause: 0.12, margin: 0.06, silence: 'remove' };
/** Split at pauses: a pause is one when it runs longer than `minPause`, and nothing is taken out. */
export const DEFAULT_SPLIT: TightenSettings = { ...DEFAULT_TIGHTEN, silence: 'keep' };

/** Silence shorter than this is a gap inside a word, not a pause. */
const MIN_SILENCE_SECONDS = 0.02;

export interface TightenedPart {
  /** The part's pieces, back to back from where its first sound was. */
  parts: SyncEditPart[];
  /** What is cut, as seconds into the line; a split that takes nothing out has `from` equal to `to`. */
  cuts: { from: number; to: number }[];
  /** Seconds the part now ends sooner on the timeline. */
  removed: number;
  /** The silence level used, in dBFS. */
  levelDb: number;
}

/** The silence level `settings` asks for on `samples` (a whole line), in dBFS. */
export const tightenLevelDb = (samples: Float32Array, sampleRate: number, settings: TightenSettings) =>
  settings.levelDb === 'auto' ? 20 * Math.log10(silenceLevel(samples, sampleRate)) : settings.levelDb;

/**
 * `part` of a line with its silences taken out (or, with `silence: 'keep'`,
 * split at them). `samples` are the whole line's at `sampleRate`; `protect`
 * the line's words as `{ start, end }` seconds into it. The pieces play back
 * to back from the first sound, or with `inPlace` (and always when only
 * split) each where it was. A part with nothing to cut comes back as it was.
 */
export const tightenPart = (
  samples: Float32Array,
  sampleRate: number,
  part: SyncEditPart,
  settings: TightenSettings,
  protect: { start: number; end: number }[] = [],
  { inPlace = false }: { inPlace?: boolean } = {}
): TightenedPart => {
  const splitOnly = settings.silence === 'keep';
  const levelDb = tightenLevelDb(samples, sampleRate, settings);
  const level = 10 ** (levelDb / 20);
  const margin = Math.max(0, settings.margin);
  const keep = Math.max(settings.minPause, 2 * margin);
  const from = Math.max(0, Math.round(part.from * sampleRate));
  const to = Math.min(samples.length, Math.round(part.to * sampleRate));
  const guards = protect.map((word) => ({ start: word.start - margin, end: word.end + margin }));

  // Quiet stretches inside the part, in seconds into the line, less any word.
  const quiet: { from: number; to: number }[] = [];
  for (const stretch of quietStretches(samples, sampleRate, level, { from, to })) {
    let pieces = [{ from: stretch.start / sampleRate, to: stretch.end / sampleRate }];
    for (const guard of guards) {
      pieces = pieces.flatMap((p) =>
        guard.end <= p.from || guard.start >= p.to ? [p] : [{ from: p.from, to: guard.start }, { from: guard.end, to: p.to }].filter((q) => q.to > q.from)
      );
    }
    quiet.push(...pieces.filter((p) => p.to - p.from >= MIN_SILENCE_SECONDS));
  }

  const head = part.from;
  const tail = part.to;
  const cuts: { from: number; to: number }[] = [];
  for (const q of quiet) {
    const atHead = q.from <= head + 1 / sampleRate;
    const atTail = q.to >= tail - 1 / sampleRate;
    if (atHead && atTail) continue; // all silence: left as it is
    if (splitOnly) {
      const mid = (q.from + q.to) / 2;
      if (!atHead && !atTail && q.to - q.from > settings.minPause) cuts.push({ from: mid, to: mid });
    } else if (atHead) {
      if (q.to - margin > q.from) cuts.push({ from: q.from, to: q.to - margin });
    } else if (atTail) {
      if (q.from + margin < q.to) cuts.push({ from: q.from + margin, to: q.to });
    } else if (q.to - q.from > keep) {
      const take = q.to - q.from - keep;
      const mid = (q.from + q.to) / 2;
      cuts.push({ from: mid - take / 2, to: mid + take / 2 });
    }
  }
  if (cuts.length === 0) return { parts: [part], cuts, removed: 0, levelDb };

  // What is left, back to back from where its first sound was (or where it was).
  const kept: { from: number; to: number }[] = [];
  let at = head;
  for (const cut of cuts) {
    if (cut.from > at) kept.push({ from: at, to: cut.from });
    at = cut.to;
  }
  if (tail > at) kept.push({ from: at, to: tail });
  const stay = inPlace || splitOnly;
  let time = part.start + (kept[0].from - head) / part.rate;
  const parts = kept.map((piece, n) => {
    if (stay) time = part.start + (piece.from - head) / part.rate;
    const next: SyncEditPart = {
      ...part,
      id: `${part.id}~${n}`,
      start: time,
      from: piece.from,
      to: piece.to,
      fadeIn: n === 0 ? part.fadeIn : 0,
      fadeOut: n === kept.length - 1 ? part.fadeOut : 0,
    };
    time += (piece.to - piece.from) / part.rate;
    return next;
  });
  const oldEnd = part.start + (tail - head) / part.rate;
  return { parts, cuts, removed: stay ? 0 : Math.max(0, oldEnd - time), levelDb };
};

/**
 * Close up: parts that follow one another play back to back. Going through
 * every part that plays, in timeline order, a part `joins` says may move
 * starts `gap` seconds after everything before it (or as far after as it
 * was, when that was less), when the part just before it may move too; it
 * only ever moves earlier. A part that may not
 * move (a line not picked, a clip of the original) stays where it is, and
 * so does the first part after it, which is where the next scene starts.
 * Returns each line's parts that changed, by key, how many parts moved and
 * the most any one moved, in seconds.
 */
export const closeUpParts = (
  lines: { key: string; parts: SyncEditPart[] }[],
  joins: (part: SyncEditPart, key: string) => boolean,
  gap: number
) => {
  const playing = lines
    .flatMap(({ key, parts }) => parts.filter((part) => !part.muted).map((part) => ({ key, part })))
    .sort((a, b) => a.part.start - b.part.start);
  const starts = new Map<string, number>();
  // Where everything so far ends, as it was and as it is now.
  let endBefore = -Infinity;
  let end = -Infinity;
  let follows = false;
  let moved = 0;
  let shift = 0;
  for (const { key, part } of playing) {
    const joined = joins(part, key);
    let start = part.start;
    // A pause already shorter than `gap` (the pieces of one tightened part: none) stays as it was.
    const wanted = end + Math.min(gap, Math.max(0, part.start - endBefore));
    if (joined && follows && wanted < start - 1e-6) {
      start = wanted;
      starts.set(part.id, start);
      moved++;
      shift = Math.max(shift, part.start - start);
    }
    endBefore = Math.max(endBefore, partEnd(part));
    end = Math.max(end, partEnd({ ...part, start }));
    follows = joined;
  }
  const parts = new Map<string, SyncEditPart[]>();
  for (const line of lines) {
    if (line.parts.some((part) => starts.has(part.id))) parts.set(line.key, line.parts.map((part) => (starts.has(part.id) ? { ...part, start: starts.get(part.id) as number } : part)));
  }
  return { parts, moved, shift };
};
